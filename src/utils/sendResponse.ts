import type { Response } from "express"

/**
 * Standard success response: `{ success: true, data }`.
 * The client reads `json.data` (see the client's lib/api.ts).
 */
export function sendData<T>(res: Response, data: T, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data })
}
