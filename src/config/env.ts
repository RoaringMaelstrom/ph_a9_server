import { existsSync } from "node:fs"

// Load .env in local development. On Vercel the variables come from the
// project settings, so a missing file is fine.
if (existsSync(".env")) process.loadEnvFile(".env")

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". See README.md → Environment variables.`
    )
  }
  return value
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback
}

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "")

const nodeEnv = optional("NODE_ENV", "development")

/** Validated configuration. Import this instead of reading process.env directly. */
export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: Number(optional("PORT", "5000")),

  /** MongoDB connection string (same cluster the client's Better Auth uses). */
  mongodbUri: required("MONGODB_URI"),
  dbName: optional("DB_NAME", "SalonBook"),

  /** Allowed browser origins for CORS (CLIENT_URL may be comma-separated). */
  clientUrls: required("CLIENT_URL")
    .split(",")
    .map((url) => stripTrailingSlash(url.trim()))
    .filter(Boolean),

  /**
   * The Next.js app running Better Auth (its `baseURL`). JWTs are verified
   * against its public keys at `${betterAuthUrl}/api/auth/jwks`, and must
   * have this URL as issuer and audience.
   */
  betterAuthUrl: stripTrailingSlash(required("BETTER_AUTH_URL")),
} as const
