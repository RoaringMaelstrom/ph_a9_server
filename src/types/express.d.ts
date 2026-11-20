import type { JWTPayload } from "jose"

import type { UserRole } from "../constants.js"

/** Identity taken from a verified Better Auth JWT. */
export interface AuthInfo {
  /** Better Auth user id (the token's `sub`) */
  userId: string
  /** Full verified token payload (claims may be up to 15 minutes old) */
  payload: JWTPayload
}

/** The signed-in user, loaded fresh from the database by `requireRole`. */
export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  isBlocked: boolean
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `verifyJWT` on protected routes. */
      auth?: AuthInfo
      /** Set by `requireRole` after the role and blocked checks pass. */
      user?: AuthUser
    }
  }
}
