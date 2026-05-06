"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUploadedFiles = exports.validateUploadedFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const http_1 = require("./http");
const RULES = {
    profile_image: { extensions: new Set([".jpg", ".jpeg", ".png", ".webp"]), mimeTypes: new Set(["image/jpeg", "image/png", "image/webp"]), maxBytes: 2 * 1024 * 1024 },
    support_document: { extensions: new Set([".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"]), mimeTypes: new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png", "image/webp"]), maxBytes: 5 * 1024 * 1024 },
    evidence_document: { extensions: new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".jpg", ".jpeg", ".png", ".webp"]), mimeTypes: new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "image/jpeg", "image/png", "image/webp"]), maxBytes: 10 * 1024 * 1024 }
};
const readHeader = (filePath) => {
    const descriptor = fs_1.default.openSync(filePath, "r");
    try {
        const buffer = Buffer.alloc(512);
        const bytesRead = fs_1.default.readSync(descriptor, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
    }
    finally {
        fs_1.default.closeSync(descriptor);
    }
};
const hasMagic = (buffer, values) => values.every((value, index) => buffer[index] === value);
const looksLikeCsvText = (buffer) => !!buffer.length && !buffer.includes(0) && /^[\u0009\u000a\u000d\u0020-\u007e\u00a0-\uffff]*$/.test(buffer.toString("utf8"));
const detectSignature = (buffer) => {
    if (hasMagic(buffer, [0xff, 0xd8, 0xff]))
        return "image/jpeg";
    if (hasMagic(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        return "image/png";
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
        return "image/webp";
    if (buffer.subarray(0, 5).toString("ascii") === "%PDF-")
        return "application/pdf";
    if (hasMagic(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
        return "application/msword";
    if (hasMagic(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasMagic(buffer, [0x50, 0x4b, 0x05, 0x06]) || hasMagic(buffer, [0x50, 0x4b, 0x07, 0x08]))
        return "application/zip";
    if (looksLikeCsvText(buffer))
        return "text/plain";
    return "unknown";
};
const removeFileQuietly = (filePath) => { try {
    fs_1.default.unlinkSync(filePath);
}
catch (_error) { } };
const validateUploadedFile = (file, kind) => {
    if (!file)
        return;
    const rule = RULES[kind];
    const extension = path_1.default.extname(file.originalname || file.filename || "").toLowerCase();
    const detectedMime = detectSignature(readHeader(file.path));
    const normalizedMime = String(file.mimetype || "").toLowerCase();
    const failAndDelete = (message) => { removeFileQuietly(file.path); throw new http_1.AppError(message, 400); };
    if (!rule.extensions.has(extension))
        failAndDelete("Ekstensi file tidak diizinkan.");
    if (!rule.mimeTypes.has(normalizedMime))
        failAndDelete("Jenis MIME file tidak diizinkan.");
    if (file.size > rule.maxBytes)
        failAndDelete("Ukuran file melebihi batas yang diizinkan.");
    const signatureMatches = (() => {
        if ([".jpg", ".jpeg"].includes(extension))
            return detectedMime === "image/jpeg";
        if (extension === ".png")
            return detectedMime === "image/png";
        if (extension === ".webp")
            return detectedMime === "image/webp";
        if (extension === ".pdf")
            return detectedMime === "application/pdf";
        if (extension === ".doc")
            return detectedMime === "application/msword";
        if ([".docx", ".xlsx"].includes(extension))
            return detectedMime === "application/zip";
        if (extension === ".xls")
            return detectedMime === "application/msword" || detectedMime === "application/zip";
        if (extension === ".csv")
            return detectedMime === "text/plain";
        return false;
    })();
    if (!signatureMatches)
        failAndDelete("Isi file tidak sesuai dengan ekstensi atau jenis file yang dikirim.");
};
exports.validateUploadedFile = validateUploadedFile;
const validateUploadedFiles = (files, kind) => {
    if (!files)
        return;
    if (Array.isArray(files)) {
        files.forEach((file) => (0, exports.validateUploadedFile)(file, kind));
        return;
    }
    Object.values(files).forEach((value) => value.forEach((file) => (0, exports.validateUploadedFile)(file, kind)));
};
exports.validateUploadedFiles = validateUploadedFiles;
