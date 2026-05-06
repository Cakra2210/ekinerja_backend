import { NextFunction, Request, Response } from "express";
import { AppError, sendError } from "../shared/http";

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`, 404));
};

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (!(error instanceof AppError)) {
    console.error(`[${req.method} ${req.originalUrl}]`, error);
  }

  return sendError(res, error);
};
