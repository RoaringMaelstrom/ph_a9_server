/**
 * Shared values. Keep in sync with the client (lib/site.ts, lib/booking.ts
 * and app/components/types/*).
 */

export const SERVICE_CATEGORIES = [
  "Haircut & Styling",
  "Hair Coloring",
  "Hair Treatment",
  "Facial & Skincare",
  "Makeup",
  "Manicure & Pedicure",
  "Spa & Massage",
] as const

export const SERVICE_STATUSES = ["active", "inactive"] as const

/** Predefined appointment start times (24h "HH:mm"). */
export const TIME_SLOTS = [
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
] as const

export const APPOINTMENT_STATUSES = ["pending", "confirmed", "cancelled"] as const

/** Appointments in these states hold their time slot (cancelled ones don't). */
export const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed"] as const

export const PAYMENT_STATUSES = ["unpaid", "paid"] as const

/** Transactions are only written by the verified Stripe webhook. */
export const TRANSACTION_STATUSES = ["paid", "failed"] as const

export const USER_ROLES = ["customer", "admin"] as const

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]
export type ServiceStatus = (typeof SERVICE_STATUSES)[number]
export type TimeSlot = (typeof TIME_SLOTS)[number]
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]
export type UserRole = (typeof USER_ROLES)[number]

/** How far ahead customers can book (days). Matches the client's date picker. */
export const BOOKING_WINDOW_DAYS = 60

/** Sunday closes at 4 PM, so the last Sunday start time is 15:00. */
export const SUNDAY_LAST_TIME_SLOT = "15:00"
