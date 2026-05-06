"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadKinerjaEvidenceFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const uploadSecurity_1 = require("../../shared/uploadSecurity");
const uploadDirectory = path_1.default.resolve(process.cwd(), "uploads", "kinerja-evidence");
fs_1.default.mkdirSync(uploadDirectory, { recursive: true });
const sanitizeFileName = (originalName) => {
    const extension = path_1.default.extname(originalName).toLowerCase();
    const baseName = path_1.default
        .basename(originalName, extension)
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return `${Date.now()}-${baseName || "bukti"}${extension}`;
};
const storage = multer_1.default.diskStorage({
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
const upload = (0, multer_1.default)({
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
const uploadKinerjaEvidenceFile = (req, res, next) => {
    upload.single("evidenceFile")(req, res, (error) => {
        if (!error) {
            try {
                (0, uploadSecurity_1.validateUploadedFile)(req.file, "evidence_document");
                next();
            }
            catch (validationError) {
                next(validationError);
            }
            return;
        }
        if (error instanceof multer_1.default.MulterError) {
            res.status(400).json({
                success: false,
                message: error.code === "LIMIT_FILE_SIZE"
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
exports.uploadKinerjaEvidenceFile = uploadKinerjaEvidenceFile;
