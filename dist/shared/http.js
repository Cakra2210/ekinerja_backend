"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendError = exports.asyncHandler = exports.fail = exports.sendSuccess = exports.AppError = void 0;
class AppError extends Error {
    constructor(message, statusCode = 500, details) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.details = details;
    }
}
exports.AppError = AppError;
const sendSuccess = (res, data, message, statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        ...(message ? { message } : {}),
        data
    });
};
exports.sendSuccess = sendSuccess;
const fail = (message, statusCode = 400, details) => {
    throw new AppError(message, statusCode, details);
};
exports.fail = fail;
const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};
exports.asyncHandler = asyncHandler;
const sendError = (res, error, fallbackMessage = "Terjadi kesalahan pada server") => {
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {})
        });
    }
    return res.status(500).json({
        success: false,
        message: fallbackMessage
    });
};
exports.sendError = sendError;
