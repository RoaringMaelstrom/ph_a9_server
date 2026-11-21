import type { Request, Response } from "express"

import { Transaction } from "../models/Transaction.js"
import { sendData } from "../utils/sendResponse.js"
import { SERVICE_SUMMARY_FIELDS } from "./appointment.controller.js"
import { CUSTOMER_SUMMARY_FIELDS } from "./adminAppointment.controller.js"

type PopulatedAppointment = {
  appointmentDate?: string
  service?: Record<string, unknown> | null
} | null

/**
 * Transactions (filtered by `filter`), newest first, shaped as the client's
 * `TransactionDetails`: the stored fields plus `customer`, `service` and the
 * appointment's `appointmentDate` (each `null` if the record was deleted).
 */
async function findTransactionDetails(filter: Record<string, unknown>) {
  const transactions = await Transaction.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .populate({
      path: "appointment",
      select: "appointmentDate serviceId",
      populate: { path: "service", select: SERVICE_SUMMARY_FIELDS },
    })
    .populate({ path: "customer", select: CUSTOMER_SUMMARY_FIELDS })
    .lean()

  return transactions.map((t) => {
    const { appointment, ...rest } = t as typeof t & { appointment?: PopulatedAppointment }
    return {
      ...rest,
      customer: (t as { customer?: unknown }).customer ?? null,
      service: appointment?.service ?? null,
      appointmentDate: appointment?.appointmentDate ?? null,
    }
  })
}

/**
 * GET /api/transactions/me (CUSTOMER)
 * The caller's own payment history. Read-only.
 */
export async function listMyTransactions(req: Request, res: Response) {
  sendData(res, await findTransactionDetails({ customerId: req.user!.id }))
}

/**
 * GET /api/admin/transactions (ADMIN)
 * Every transaction. Read-only: transactions are only written by the
 * verified Stripe webhook, and no endpoint edits them.
 */
export async function listAllTransactions(_req: Request, res: Response) {
  sendData(res, await findTransactionDetails({}))
}
