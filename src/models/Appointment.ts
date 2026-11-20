import { Schema, model, type InferSchemaType } from "mongoose"

import {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUSES,
  TIME_SLOTS,
} from "../constants.js"

/** "YYYY-MM-DD" that is a real calendar date (e.g. not 2026-02-30). */
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** A customer's appointment request (`appointments` collection). */
const appointmentSchema = new Schema(
  {
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: [true, "Service is required."],
    },
    /** Better Auth user `_id` (from the verified JWT, never from the body) */
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Calendar day "YYYY-MM-DD" */
    appointmentDate: {
      type: String,
      required: [true, "Appointment date is required."],
      validate: { validator: isCalendarDate, message: "Appointment date is invalid." },
    },
    /** Start time "HH:mm" from the predefined list */
    timeSlot: {
      type: String,
      required: [true, "Time slot is required."],
      enum: { values: TIME_SLOTS, message: "Please choose an available time slot." },
    },
    message: {
      type: String,
      trim: true,
      maxlength: [500, "Message must be 500 characters or fewer."],
      default: "",
    },
    /** Price copied from the service when the request is made */
    servicePrice: {
      type: Number,
      required: true,
      min: [0.01, "Price must be a positive number."],
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "unpaid",
    },
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: "pending",
    },
  },
  {
    collection: "appointments",
    timestamps: true,
    versionKey: false,
    // Expose populated `service` / `customer` (see virtuals below) in JSON.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    id: false,
  }
)

// The client expects `service` and `customer` objects, so populate these
// virtuals instead of overwriting serviceId/customerId.
appointmentSchema.virtual("service", {
  ref: "Service",
  localField: "serviceId",
  foreignField: "_id",
  justOne: true,
})
appointmentSchema.virtual("customer", {
  ref: "User",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
})

// "My appointments" (customer) and admin lists, newest first.
appointmentSchema.index({ customerId: 1, createdAt: -1 })
appointmentSchema.index({ status: 1, createdAt: -1 })
// One active (pending/confirmed) booking per service + date + time slot.
// The controller checks first for a friendly message; this unique index stops
// two simultaneous requests from both getting through. Cancelled appointments
// are outside the index, so a cancelled slot can be booked again.
appointmentSchema.index(
  { serviceId: 1, appointmentDate: 1, timeSlot: 1 },
  {
    name: "unique_active_slot",
    unique: true,
    partialFilterExpression: { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
  }
)

export type AppointmentDoc = InferSchemaType<typeof appointmentSchema>

export const Appointment = model("Appointment", appointmentSchema)
