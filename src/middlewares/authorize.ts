import type { NextFunction, Request, RequestHandler, Response } from "express"
import { isValidObjectId } from "mongoose"

import type { UserRole } from "../constants.js"
import { User } from "../models/User.js"
import { AppError } from "../utils/AppError.js"
import { verifyJWT } from "./verifyJWT.js"

/**
 * Authorization middleware. Use after `verifyJWT`.
 *
 * Loads the user from the database (NOT from the token: its claims can be up
 * to 15 minutes old, so a block or role change would take effect late), then:
 * - 401 if the account no longer exists
 * - 403 if the account is blocked (applies to every protected route)
 * - 403 if the user's role isn't one of `roles`
 * On success sets `req.user`.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const userId = req.auth?.userId
    if (!userId) {
      // verifyJWT didn't run: a wiring mistake, never trust the request.
      throw new AppError(401, "Please sign in to continue.")
    }
    if (!isValidObjectId(userId)) {
      throw new AppError(401, "Invalid session. Please sign in again.")
    }

    const user = await User.findById(userId)
      .select("name email role isBlocked")
      .lean()

    if (!user) throw new AppError(401, "Your account no longer exists. Please sign in again.")

    if (user.isBlocked) {
      throw new AppError(
        403,
        "Your account has been blocked. Please contact the salon for help."
      )
    }

    const role = (user.role ?? "customer") as UserRole
    if (!roles.includes(role)) {
      throw new AppError(403, "You don't have permission to do that.")
    }

    req.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role,
      isBlocked: false,
    }
    next()
  }
}

/** Signed-in, non-blocked customer. Spread into a route: `api.get(path, ...customerOnly, handler)`. */
export const customerOnly: RequestHandler[] = [verifyJWT, requireRole("customer")]

/** Signed-in, non-blocked admin. Spread into a route: `api.get(path, ...adminOnly, handler)`. */
export const adminOnly: RequestHandler[] = [verifyJWT, requireRole("admin")]
