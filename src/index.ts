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
import { adminOnly, customerOnly } from "./middlewares/authorize.js"
import { sendData } from "./utils/sendResponse.js"
import {
  getServiceById,
  listPublicServices,
  listServiceCategories,
} from "./controllers/service.controller.js"
import {
  createService,
  deleteService,
  listAllServices,
  updateService,
} from "./controllers/adminService.controller.js"
import {
  cancelMyAppointment,
  createAppointment,
  listMyAppointments,
} from "./controllers/appointment.controller.js"
import {
  listAllAppointments,
  updateAppointmentStatus,
} from "./controllers/adminAppointment.controller.js"
import { listUsers, setUserBlocked } from "./controllers/adminUser.controller.js"

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

/** Stripe webhook path. It must receive the raw body (signature check). */
const STRIPE_WEBHOOK_PATH = "/api/payments/webhook"

// --- JSON bodies (except the Stripe webhook, which needs the raw body) ---
const parseJson = express.json({ limit: "1mb" })
app.use((req, res, next) =>
  req.path === STRIPE_WEBHOOK_PATH ? next() : parseJson(req, res, next)
)

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

// ===========================================================================
// API endpoints (mounted under /api; the client's NEXT_PUBLIC_API_URL ends
// with /api). Each one is a stub that answers 501 until it's implemented.
//   PUBLIC   no login needed
//   CUSTOMER valid JWT + role "customer" + not blocked
//   ADMIN    valid JWT + role "admin" + not blocked
//   STRIPE   called by Stripe only; verified by webhook signature
// ===========================================================================

/** Placeholder handler: replace with the real implementation. */
function notImplemented(req: Request, res: Response) {
  res.status(501).json({
    success: false,
    message: `Not implemented yet: ${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
  })
}

const api = express.Router()

// --- Services ---------------------------------------------------------------

// PUBLIC: list ACTIVE services. Query: search, category,
// sort=newest|price-asc|price-desc|duration-asc|duration-desc, limit.
// Used by: home Featured + New Arrivals, Browse Services page.
api.get("/services", listPublicServices)

// PUBLIC: [{ category, count }] of ACTIVE services per category.
// Used by: home Categories section. (Must stay above /services/:id.)
api.get("/services/categories", listServiceCategories)

// PUBLIC: one service by id (active or inactive). 404 if unknown.
// Used by: service details page.
api.get("/services/:id", getServiceById)

// ADMIN: create a service. Body: ServiceInput (price > 0, duration > 0).
api.post("/services", ...adminOnly, createService)

// ADMIN: update a service (partial ServiceInput, incl. status).
api.patch("/services/:id", ...adminOnly, updateService)

// ADMIN: delete a service.
api.delete("/services/:id", ...adminOnly, deleteService)

// --- Appointments (customer) ------------------------------------------------

// CUSTOMER: request an appointment.
// Body: { serviceId, appointmentDate: "YYYY-MM-DD", timeSlot: "HH:mm", message? }
// Saved as status "pending" + paymentStatus "unpaid"; price taken from the service.
// 400 inactive service / invalid input, 403 admin or blocked, 409 slot taken
// (same service + date + time) or the customer already booked that date + time.
api.post("/appointments", ...customerOnly, createAppointment)

// CUSTOMER: the caller's own appointments, with `service` populated.
api.get("/appointments/me", ...customerOnly, listMyAppointments)

// CUSTOMER: cancel own appointment, only while "pending" (409 otherwise).
api.patch("/appointments/:id/cancel", ...customerOnly, cancelMyAppointment)

// --- Payments & transactions ------------------------------------------------

// CUSTOMER: start Stripe Checkout for own "confirmed" + "unpaid" appointment.
// Body: { appointmentId } → { url }
api.post("/payments/checkout-session", ...customerOnly, notImplemented)

// STRIPE: webhook (checkout.session.completed). The ONLY place that marks an
// appointment "paid" and creates the transaction. Receives the raw body.
api.post(
  STRIPE_WEBHOOK_PATH.replace("/api", ""),
  express.raw({ type: "application/json" }),
  notImplemented
)

// CUSTOMER: the caller's own transactions (payment history).
api.get("/transactions/me", ...customerOnly, notImplemented)

// --- Admin --------------------------------------------------------------------

// ADMIN: overview counts { totalCustomers, activeServices, totalAppointments,
// pendingAppointments, confirmedAppointments, successfulPayments }.
api.get("/admin/stats", ...adminOnly, notImplemented)

// ADMIN: all services, including inactive ones.
api.get("/admin/services", ...adminOnly, listAllServices)

// ADMIN: all appointments with `service` + `customer` populated.
// Query: status?, limit?
api.get("/admin/appointments", ...adminOnly, listAllAppointments)

// ADMIN: confirm (from "pending" only) or cancel (from "pending"/"confirmed").
// Body: { status: "confirmed" | "cancelled" }. Never changes paymentStatus.
api.patch("/admin/appointments/:id/status", ...adminOnly, updateAppointmentStatus)

// ADMIN: registered customers (admins not listed), with appointmentCount.
api.get("/admin/users", ...adminOnly, listUsers)

// ADMIN: block/unblock a customer (never an admin). Body: { isBlocked }.
// When blocking, also delete their Better Auth sessions.
api.patch("/admin/users/:id/block", ...adminOnly, setUserBlocked)

// ADMIN: all transactions (read-only; no write endpoints exist).
api.get("/admin/transactions", ...adminOnly, notImplemented)

app.use("/api", api)

// --- 404 + central error handler (keep last) ---
app.use(notFound)
app.use(errorHandler)

export default app
