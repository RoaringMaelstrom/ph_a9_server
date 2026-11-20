import type { Request, Response } from "express"
import { isValidObjectId } from "mongoose"

import {
  ACTIVE_APPOINTMENT_STATUSES,
  BOOKING_WINDOW_DAYS,
  SUNDAY_LAST_TIME_SLOT,
  TIME_SLOTS,
  type TimeSlot,
} from "../constants.js"
import { Appointment, isCalendarDate } from "../models/Appointment.js"
import { Service } from "../models/Service.js"
import { AppError } from "../utils/AppError.js"
import { sendData } from "../utils/sendResponse.js"

const DAY_MS = 24 * 60 * 60 * 1000

/** Service fields embedded in the customer's appointment list. */
export const SERVICE_SUMMARY_FIELDS = "serviceName category image price"

/** "YYYY-MM-DD" of a UTC date, offset by `days`. */
function utcDateKey(days = 0) {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Checks the date and time slot. Dates are the customer's local calendar day,
 * and the server doesn't know their time zone, so "today" allows one day
 * either side of UTC. (The client also hides slots that have already passed
 * today.)
 */
function validateSlot(appointmentDate: unknown, timeSlot: unknown) {
  if (typeof appointmentDate !== "string" || !isCalendarDate(appointmentDate)) {
    throw new AppError(400, "Please choose a valid appointment date.")
  }
  if (typeof timeSlot !== "string" || !(TIME_SLOTS as readonly string[]).includes(timeSlot)) {
    throw new AppError(400, "Please choose an available time slot.")
  }
  if (appointmentDate < utcDateKey(-1)) {
    throw new AppError(400, "You can't book an appointment in the past.")
  }
  if (appointmentDate > utcDateKey(BOOKING_WINDOW_DAYS + 1)) {
    throw new AppError(
      400,
      `Appointments can be booked up to ${BOOKING_WINDOW_DAYS} days in advance.`
    )
  }
  // Day of week of a calendar date is the same in every time zone.
  const isSunday = new Date(`${appointmentDate}T00:00:00Z`).getUTCDay() === 0
  if (isSunday && timeSlot > SUNDAY_LAST_TIME_SLOT) {
    throw new AppError(400, "The salon closes at 4 PM on Sundays. Please choose an earlier time.")
  }
  return { appointmentDate, timeSlot: timeSlot as TimeSlot }
}

const SLOT_TAKEN_MESSAGE =
  "This time slot is already booked for this service. Please choose another date or time."

function isDuplicateKeyError(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000
}

/**
 * POST /api/appointments (CUSTOMER)
 * Body: { serviceId, appointmentDate: "YYYY-MM-DD", timeSlot: "HH:mm", message? }
 * The customer comes from the verified JWT and the price from the service;
 * status/paymentStatus always start as pending/unpaid (body values ignored).
 */
export async function createAppointment(req: Request, res: Response) {
  const body = req.body
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Request body must be a JSON object.")
  }

  const { serviceId, message } = body as Record<string, unknown>
  if (typeof serviceId !== "string" || !isValidObjectId(serviceId)) {
    throw new AppError(400, "Please choose a valid service.")
  }
  if (message !== undefined && message !== null && typeof message !== "string") {
    throw new AppError(400, "Message must be text.")
  }
  const { appointmentDate, timeSlot } = validateSlot(body.appointmentDate, body.timeSlot)

  const service = await Service.findById(serviceId).select("price status").lean()
  if (!service) throw new AppError(404, "This service no longer exists.")
  if (service.status !== "active") {
    throw new AppError(400, "This service is currently unavailable for booking.")
  }

  const activeStatuses = [...ACTIVE_APPOINTMENT_STATUSES]
  const customerId = req.user!.id

  const [slotTaken, alreadyBooked] = await Promise.all([
    Appointment.exists({ serviceId, appointmentDate, timeSlot, status: { $in: activeStatuses } }),
    // A customer can't be in two places at once.
    Appointment.exists({ customerId, appointmentDate, timeSlot, status: { $in: activeStatuses } }),
  ])
  if (slotTaken) throw new AppError(409, SLOT_TAKEN_MESSAGE)
  if (alreadyBooked) {
    throw new AppError(
      409,
      "You already have an appointment at this date and time. Please choose another slot."
    )
  }

  try {
    const appointment = await Appointment.create({
      serviceId,
      customerId,
      appointmentDate,
      timeSlot,
      message: message ?? "",
      servicePrice: service.price,
    })
    sendData(res, appointment, 201)
  } catch (err) {
    // Another request took the slot between the check and the insert.
    if (isDuplicateKeyError(err)) throw new AppError(409, SLOT_TAKEN_MESSAGE)
    throw err
  }
}

/**
 * GET /api/appointments/me (CUSTOMER)
 * The caller's own appointments, newest first, with `service` populated
 * (`null` if the service has been deleted).
 */
export async function listMyAppointments(req: Request, res: Response) {
  const appointments = await Appointment.find({ customerId: req.user!.id })
    .sort({ createdAt: -1, _id: -1 })
    .populate({ path: "service", select: SERVICE_SUMMARY_FIELDS })
    .lean()

  sendData(res, appointments)
}

/**
 * PATCH /api/appointments/:id/cancel (CUSTOMER)
 * Only the owner, only while "pending". Someone else's appointment is a 404
 * (we don't reveal that it exists); a non-pending one is a 409.
 */
export async function cancelMyAppointment(req: Request, res: Response) {
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw new AppError(404, "Appointment not found.")
  const customerId = req.user!.id

  // Atomic: the status can't change between the check and the update.
  const appointment = await Appointment.findOneAndUpdate(
    { _id: id, customerId, status: "pending" },
    { status: "cancelled" },
    { returnDocument: "after" }
  )
  if (appointment) return sendData(res, appointment)

  const existing = await Appointment.findOne({ _id: id, customerId }).select("status").lean()
  if (!existing) throw new AppError(404, "Appointment not found.")
  throw new AppError(
    409,
    existing.status === "cancelled"
      ? "This appointment is already cancelled."
      : "Only pending appointments can be cancelled. Please contact the salon to cancel a confirmed appointment."
  )
}
