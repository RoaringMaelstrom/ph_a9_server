import express from "express"
import cors from "cors"
import mongoose from "mongoose"

import { env } from "./config/env.js"
import { errorHandler } from "./middlewares/errorHandler.js"
import { notFound } from "./middlewares/notFound.js"
import { sendData } from "./utils/sendResponse.js"

export const app = express()

app.disable("x-powered-by")
// Correct client IPs / protocol behind a hosting proxy (Render, Vercel...).
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

// NOTE: the Stripe webhook route needs the *raw* body for signature checks,
// so it will be mounted here, before express.json(), in the payments step.

app.use(express.json({ limit: "1mb" }))

// --- Routes ---
app.get("/", (_req, res) => {
  sendData(res, { name: "SalonBook API", docs: "See README.md" })
})

/** Health check: is the API up and is MongoDB connected? */
app.get("/api/health", (_req, res) => {
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

// Feature routers (/api/services, /api/appointments, ...) are added in later steps.

// --- Errors (keep last) ---
app.use(notFound)
app.use(errorHandler)
