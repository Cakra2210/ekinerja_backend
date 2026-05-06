import fs from "fs";
import path from "path";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import {
  createCompetencyDevelopmentActivity,
  deleteCompetencyDevelopmentActivity,
  getCompetencyDevelopmentRecap,
  updateCompetencyDevelopmentActivity
} from "./competency.controller";
import { authorizeRoles } from "../../middleware/auth.middleware";
import { validateUploadedFiles } from "../../shared/uploadSecurity";

const competencyRoutes = Router();
const manageCompetencyAccess = authorizeRoles("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "reviewer");
const uploadDirectory = path.resolve(process.cwd(), "uploads", "competency-development");

fs.mkdirSync(uploadDirectory, { recursive: true });

const sanitizeFileName = (originalName: string) => {
  const extension = path.extname(originalName);
  const baseName = path.basename(originalName, extension);
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${Date.now()}-${safeBaseName || "dokumen"}${extension.toLowerCase()}`;
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (_req, file, callback) => {
    callback(null, sanitizeFileName(file.originalname));
  }
});

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new Error("File pendukung harus berupa PDF, DOC, DOCX, JPG, PNG, atau WEBP"));
  }
});

const uploadActivityDocuments = (req: Request, res: Response, next: NextFunction) => {
  upload.fields([
    { name: "invitationFile", maxCount: 1 },
    { name: "certificateFile", maxCount: 1 }
  ])(req, res, (error) => {
    if (!error) {
      try { validateUploadedFiles(req.files, "support_document"); next(); } catch (validationError) { next(validationError); }
      return;
    }

    if (error instanceof multer.MulterError) {
      res.status(400).json({
        success: false,
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran file maksimal 5 MB untuk setiap dokumen"
            : "Upload dokumen pengembangan kompetensi gagal"
      });
      return;
    }

    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Upload dokumen gagal"
    });
  });
};

competencyRoutes.get("/", getCompetencyDevelopmentRecap);
competencyRoutes.post("/", manageCompetencyAccess, uploadActivityDocuments, createCompetencyDevelopmentActivity);
competencyRoutes.put("/:id", manageCompetencyAccess, uploadActivityDocuments, updateCompetencyDevelopmentActivity);
competencyRoutes.delete("/:id", manageCompetencyAccess, deleteCompetencyDevelopmentActivity);

export default competencyRoutes;
