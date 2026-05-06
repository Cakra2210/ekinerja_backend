import { NextFunction, Request, RequestHandler, Response } from "express";

export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const sendSuccess = <T>(res: Response, data: T, message?: string, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    data
  });
};

export const fail = (message: string, statusCode = 400, details?: unknown): never => {
  throw new AppError(message, statusCode, details);
};

export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export const sendError = (
  res: Response,
  error: unknown,
  fallbackMessage = "Terjadi kesalahan pada server"
) => {
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
