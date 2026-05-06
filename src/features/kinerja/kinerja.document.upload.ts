import fs from "fs";
import path from "path";
import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { validateUploadedFile } from "../../shared/uploadSecurity";

const uploadDirectory = path.resolve(process.cwd(), "uploads", "kinerja-evidence");
fs.mkdirSync(uploadDirectory, { recursive: true });

const sanitizeFileName = (originalName: string) => {
  const extension = path.extname(originalName).toLowerCase();
  const baseName = path
    .basename(originalName, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${Date.now()}-${baseName || "bukti"}${extension}`;
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (_req, file, callback) => {
    callback(null, sanitizeFileName(file.originalname || "bukti"));
  }
});

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new Error("File bukti harus berupa PDF, DOC, DOCX, XLS, XLSX, CSV, JPG, PNG, atau WEBP"));
  }
});

export const uploadKinerjaEvidenceFile = (req: Request, res: Response, next: NextFunction) => {
  upload.single("evidenceFile")(req, res, (error) => {
    if (!error) {
      try { validateUploadedFile(req.file, "evidence_document"); next(); } catch (validationError) { next(validationError); }
      return;
    }

    if (error instanceof multer.MulterError) {
      res.status(400).json({
        success: false,
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran file maksimal 10 MB"
            : "Upload file bukti gagal"
      });
      return;
    }

    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Upload bukti gagal"
    });
  });
};
