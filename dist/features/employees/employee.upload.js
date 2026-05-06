"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.employeeProfilePhotoUpload = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const http_1 = require("../../shared/http");
const profilePhotoDir = path_1.default.resolve(process.cwd(), "uploads", "profile-photos");
fs_1.default.mkdirSync(profilePhotoDir, { recursive: true });
const sanitizeFileName = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-");
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, callback) => {
        callback(null, profilePhotoDir);
    },
    filename: (_req, file, callback) => {
        const ext = path_1.default.extname(file.originalname || "").toLowerCase() || ".jpg";
        const baseName = path_1.default.basename(file.originalname || "profile-photo", ext);
        callback(null, `${Date.now()}-${sanitizeFileName(baseName).slice(0, 60)}${ext}`);
    }
});
const fileFilter = (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
        callback(new http_1.AppError("File foto profil harus berupa gambar", 400));
        return;
    }
    callback(null, true);
};
exports.employeeProfilePhotoUpload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: 2 * 1024 * 1024
    }
});
