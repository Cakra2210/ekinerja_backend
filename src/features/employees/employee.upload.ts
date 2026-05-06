import fs from "fs";
import path from "path";
import multer from "multer";
import { Request } from "express";
import { AppError } from "../../shared/http";

const profilePhotoDir = path.resolve(process.cwd(), "uploads", "profile-photos");
fs.mkdirSync(profilePhotoDir, { recursive: true });

const sanitizeFileName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-");

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, profilePhotoDir);
  },
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const baseName = path.basename(file.originalname || "profile-photo", ext);
    callback(
      null,
      `${Date.now()}-${sanitizeFileName(baseName).slice(0, 60)}${ext}`
    );
  }
});

const fileFilter = (_req: Request, file: Express.Multer.File, callback: multer.FileFilterCallback) => {
  if (!file.mimetype.startsWith("image/")) {
    callback(new AppError("File foto profil harus berupa gambar", 400));
    return;
  }

  callback(null, true);
};

export const employeeProfilePhotoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024
  }
});
