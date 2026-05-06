"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const competency_controller_1 = require("./competency.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const uploadSecurity_1 = require("../../shared/uploadSecurity");
const competencyRoutes = (0, express_1.Router)();
const manageCompetencyAccess = (0, auth_middleware_1.authorizeRoles)("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "reviewer");
const uploadDirectory = path_1.default.resolve(process.cwd(), "uploads", "competency-development");
fs_1.default.mkdirSync(uploadDirectory, { recursive: true });
const sanitizeFileName = (originalName) => {
    const extension = path_1.default.extname(originalName);
    const baseName = path_1.default.basename(originalName, extension);
    const safeBaseName = baseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return `${Date.now()}-${safeBaseName || "dokumen"}${extension.toLowerCase()}`;
};
const storage = multer_1.default.diskStorage({
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
const upload = (0, multer_1.default)({
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
const uploadActivityDocuments = (req, res, next) => {
    upload.fields([
        { name: "invitationFile", maxCount: 1 },
        { name: "certificateFile", maxCount: 1 }
    ])(req, res, (error) => {
        if (!error) {
            try {
                (0, uploadSecurity_1.validateUploadedFiles)(req.files, "support_document");
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
competencyRoutes.get("/", competency_controller_1.getCompetencyDevelopmentRecap);
competencyRoutes.post("/", manageCompetencyAccess, uploadActivityDocuments, competency_controller_1.createCompetencyDevelopmentActivity);
competencyRoutes.put("/:id", manageCompetencyAccess, uploadActivityDocuments, competency_controller_1.updateCompetencyDevelopmentActivity);
competencyRoutes.delete("/:id", manageCompetencyAccess, competency_controller_1.deleteCompetencyDevelopmentActivity);
exports.default = competencyRoutes;
