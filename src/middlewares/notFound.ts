import type { Request, Response } from "express"

/** 404 for any route that wasn't matched. */
export function notFound(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  })
}
