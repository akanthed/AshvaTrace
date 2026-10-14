import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error & { statusCode?: number; details?: unknown }, _req: Request, res: Response, _next: NextFunction) {
  const status = err.statusCode || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  console.error(`[ERROR] ${status}: ${err.message}`, err.stack);

  res.status(status).json({
    error: message,
    ...(status === 500 ? {} : { details: err.details }),
  });
}
