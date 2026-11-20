/**
 * An expected error with an HTTP status and a message that's safe to show
 * to the user. Throw it from any route; the error handler formats it.
 *
 * @example throw new AppError(404, "Service not found")
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /** Optional field-level details, e.g. validation errors */
    public readonly details?: Record<string, string>
  ) {
    super(message)
    this.name = "AppError"
  }
}
