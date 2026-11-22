import type { Request, Response } from "express"
import { isValidObjectId } from "mongoose"

import { APPOINTMENT_STATUSES, type AppointmentStatus } from "../constants.js"
import { Appointment } from "../models/Appointment.js"
import { AppError } from "../utils/AppError.js"
import { sendData } from "../utils/sendResponse.js"
import { SERVICE_SUMMARY_FIELDS } from "./appointment.controller.js"
import { closeCheckoutSession } from "./payment.controller.js"

/** Customer fields embedded in admin lists (never auth or internal fields). */
export const CUSTOMER_SUMMARY_FIELDS = "name email image phone"

const MAX_LIMIT = 100

/**
 * Status changes an admin may make, and the statuses each is allowed from.
 * Confirm only from pending; cancel from pending or confirmed.
 */
const ALLOWED_FROM: Record<"confirmed" | "cancelled", AppointmentStatus[]> = {
  confirmed: ["pending"],
  cancelled: ["pending", "confirmed"],
}

/**
 * GET /api/admin/appointments (ADMIN)
 * Every appointment, newest first, with `service` and `customer` populated
 * (`null` if deleted). Query: status? (pending|confirmed|cancelled), limit? (1-100)
 */
export async function listAllAppointments(req: Request, res: Response) {
  const filter: { status?: AppointmentStatus } = {}

  const status = req.query.status
  if (status !== undefined && status !== "") {
    if (typeof status !== "string" || !(APPOINTMENT_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(400, "Status must be pending, confirmed or cancelled.")
    }
    filter.status = status as AppointmentStatus
  }

  let limit = 0 // 0 = no limit
  if (req.query.limit !== undefined && req.query.limit !== "") {
    limit = Number(req.query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new AppError(400, `Limit must be a whole number from 1 to ${MAX_LIMIT}.`)
    }
  }

  const appointments = await Appointment.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .populate({ path: "service", select: SERVICE_SUMMARY_FIELDS })
    .populate({ path: "customer", select: CUSTOMER_SUMMARY_FIELDS })
    .lean()

  sendData(res, appointments)
}

/**
 * PATCH /api/admin/appointments/:id/status (ADMIN)
 * Body: { status: "confirmed" | "cancelled" }. Only `status` is read: payment
 * fields can never be changed here (only the Stripe webhook marks "paid").
 */
export async function updateAppointmentStatus(req: Request, res: Response) {
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw new AppError(404, "Appointment not found.")

  const next = (req.body as { status?: unknown } | undefined)?.status
  if (next !== "confirmed" && next !== "cancelled") {
    throw new AppError(400, 'Status must be "confirmed" or "cancelled".')
  }

  // Atomic: only updates if the current status allows this change.
  const appointment = await Appointment.findOneAndUpdate(
    { _id: id, status: { $in: ALLOWED_FROM[next] } },
    { status: next },
    { returnDocument: "after" }
  )
    .populate({ path: "service", select: SERVICE_SUMMARY_FIELDS })
    .populate({ path: "customer", select: CUSTOMER_SUMMARY_FIELDS })

  if (appointment) {
    if (next === "cancelled" && appointment.paymentStatus === "unpaid") {
      // Close any open Stripe Checkout page so a cancelled appointment can't be paid.
      const { checkoutSessionId } =
        (await Appointment.findById(id).select("+checkoutSessionId").lean()) ?? {}
      if (checkoutSessionId) await closeCheckoutSession(checkoutSessionId)
    }
    return sendData(res, appointment)
  }

  const existing = await Appointment.findById(id).select("status").lean()
  if (!existing) throw new AppError(404, "Appointment not found.")

  if (existing.status === next) {
    throw new AppError(409, `This appointment is already ${next}.`)
  }
  throw new AppError(
    409,
    next === "confirmed"
      ? "Only pending appointments can be confirmed."
      : "Only pending or confirmed appointments can be cancelled."
  )
}
