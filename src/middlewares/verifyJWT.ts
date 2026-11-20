import type { NextFunction, Request, Response } from "express"
import { createRemoteJWKSet, errors, jwtVerify } from "jose"

import { env } from "../config/env.js"
import { AppError } from "../utils/AppError.js"

/**
 * Better Auth's public keys (JWKS), fetched from the client app and cached by
 * jose. Unknown key ids trigger a refetch, so key rotation just works.
 */
const jwks = createRemoteJWKSet(new URL(`${env.betterAuthUrl}/api/auth/jwks`), {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
})

// Better Auth sets iss/aud to its baseURL, with or without a trailing slash.
const ISSUERS = [env.betterAuthUrl, `${env.betterAuthUrl}/`]

/**
 * JWT verification middleware (authentication).
 *
 * Expects `Authorization: Bearer <token>`, where the token comes from Better
 * Auth's `/api/auth/token` (the client's `authClient.token()`). Verifies the
 * signature against the JWKS, plus the algorithm, issuer, audience and expiry.
 * On success it sets `req.auth = { userId, payload }`.
 *
 * This proves *who* the caller is. Role and blocked checks (which must use
 * the database, not the token) are done by the authorization middleware.
 */
export async function verifyJWT(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ""
  const [scheme, token] = header.split(" ")

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AppError(401, "Please sign in to continue.")
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["EdDSA"],
      issuer: ISSUERS,
      audience: ISSUERS,
    })

    if (!payload.sub) throw new AppError(401, "Invalid session. Please sign in again.")

    req.auth = { userId: payload.sub, payload }
    next()
  } catch (err) {
    if (err instanceof AppError) throw err
    if (err instanceof errors.JWTExpired) {
      throw new AppError(401, "Your session has expired. Please sign in again.")
    }
    if (err instanceof errors.JWKSTimeout || isNetworkError(err)) {
      // Can't reach the auth server to get keys: not the caller's fault.
      console.error("[auth] could not fetch JWKS:", err)
      throw new AppError(503, "Authentication is temporarily unavailable. Please try again.")
    }
    // Bad signature, wrong issuer/audience/alg, malformed token, unknown key...
    throw new AppError(401, "Invalid session. Please sign in again.")
  }
}

function isNetworkError(err: unknown) {
  return (
    err instanceof TypeError ||
    (err instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message))
  )
}
