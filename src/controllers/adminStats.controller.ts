import type { Request, Response } from "express"

import { Appointment } from "../models/Appointment.js"
import { Service } from "../models/Service.js"
import { Transaction } from "../models/Transaction.js"
import { User } from "../models/User.js"
import { sendData } from "../utils/sendResponse.js"

/**
 * GET /api/admin/stats (ADMIN)
 * Counts for the admin overview cards (the client's `AdminStats`).
 * "Customers" matches the Manage Users list: every account except admins.
 */
export async function getAdminStats(_req: Request, res: Response) {
  const [
    totalCustomers,
    activeServices,
    totalAppointments,
    pendingAppointments,
    confirmedAppointments,
    successfulPayments,
  ] = await Promise.all([
    User.countDocuments({ role: { $ne: "admin" } }),
    Service.countDocuments({ status: "active" }),
    Appointment.countDocuments(),
    Appointment.countDocuments({ status: "pending" }),
    Appointment.countDocuments({ status: "confirmed" }),
    Transaction.countDocuments({ status: "paid" }),
  ])

  sendData(res, {
    totalCustomers,
    activeServices,
    totalAppointments,
    pendingAppointments,
    confirmedAppointments,
    successfulPayments,
  })
}
