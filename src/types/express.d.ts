import type { JWTPayload } from "jose"

/** Identity taken from a verified Better Auth JWT. */
export interface AuthInfo {
  /** Better Auth user id (the token's `sub`) */
  userId: string
  /** Full verified token payload (claims may be up to 15 minutes old) */
  payload: JWTPayload
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `verifyJWT` on protected routes. */
      auth?: AuthInfo
    }
  }
}
