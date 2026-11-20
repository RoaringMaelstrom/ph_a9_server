import type { NextFunction, Request, Response } from "express"
import mongoose from "mongoose"

import { env } from "../config/env.js"
import { AppError } from "../utils/AppError.js"

type ErrorBody = {
  success: false
  message: string
  errors?: Record<string, string>
}

/**
 * Central error handler. Every error becomes `{ success: false, message }`,
 * which the client shows in its toasts. Express 5 forwards errors thrown in
 * async handlers here automatically.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error handlers by their 4 arguments.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  let status = 500
  const body: ErrorBody = { success: false, message: "Something went wrong. Please try again." }

  if (err instanceof AppError) {
    status = err.statusCode
    body.message = err.message
    if (err.details) body.errors = err.details
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400
    body.message = "Some fields are invalid."
    body.errors = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    )
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400
    body.message = `Invalid ${err.path}.`
  } else if (isDuplicateKeyError(err)) {
    status = 409
    body.message = "This record already exists."
  } else if (isBodyParseError(err)) {
    status = 400
    body.message = "The request body is not valid JSON."
  }

  if (status >= 500) {
    console.error("[error]", err)
    // Show the real message only in development.
    if (!env.isProduction && err instanceof Error) body.message = err.message
  }

  res.status(status).json(body)
}

function isDuplicateKeyError(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000
}

function isBodyParseError(err: unknown) {
  return (
    err instanceof SyntaxError &&
    (err as { type?: string }).type === "entity.parse.failed"
  )
}
