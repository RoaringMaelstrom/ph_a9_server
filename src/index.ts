/**
 * Vercel entry point (zero-config Express).
 *
 * Vercel looks for `src/index.ts` and uses its *default export* as the
 * handler. Don't call `app.listen()` here; local development uses
 * `src/dev.ts` (`npm run dev`), which imports this same app.
 */
import express from "express"
import type { NextFunction, Request, Response } from "express"
import cors from "cors"
import mongoose from "mongoose"

import { env } from "./config/env.js"
import { connectDB } from "./config/db.js"
import { errorHandler } from "./middlewares/errorHandler.js"
import { notFound } from "./middlewares/notFound.js"
import { sendData } from "./utils/sendResponse.js"

const app = express()

app.disable("x-powered-by")
// Correct client IPs / protocol behind Vercel's proxy.
app.set("trust proxy", 1)

// --- CORS: only the SalonBook client may call this API from a browser ---
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: server-to-server calls, curl, Stripe webhooks.
      if (!origin || env.clientUrls.includes(origin)) return callback(null, true)
      return callback(null, false)
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
)

app.use(express.json({ limit: "1mb" }))

// --- Routes that don't need the database ---
app.get("/", (_req, res) => {
  sendData(res, { name: "SalonBook API" })
})

/** Health check: is the API up and is MongoDB connected? */
app.get("/api/health", async (_req, res) => {
  try {
    await connectDB()
  } catch {
    // Reported as "disconnected" below.
  }
  const dbConnected = mongoose.connection.readyState === 1
  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    data: {
      status: dbConnected ? "ok" : "degraded",
      database: dbConnected ? "connected" : "disconnected",
      uptime: Math.round(process.uptime()),
    },
  })
})

// --- Database: Vercel functions have no startup phase, so make sure MongoDB
// is connected before handling each request (the connection is cached). ---
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  await connectDB()
  next()
})

// --- API routes are added in the next steps ---

// --- 404 + central error handler (keep last) ---
app.use(notFound)
app.use(errorHandler)

export default app
