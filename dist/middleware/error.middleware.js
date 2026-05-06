"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.notFoundHandler = void 0;
const http_1 = require("../shared/http");
const notFoundHandler = (req, _res, next) => {
    next(new http_1.AppError(`Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`, 404));
};
exports.notFoundHandler = notFoundHandler;
const errorHandler = (error, req, res, _next) => {
    if (!(error instanceof http_1.AppError)) {
        console.error(`[${req.method} ${req.originalUrl}]`, error);
    }
    return (0, http_1.sendError)(res, error);
};
exports.errorHandler = errorHandler;
