import type { Request, Response } from "express"
import mongoose, { isValidObjectId } from "mongoose"

import { Appointment } from "../models/Appointment.js"
import { User } from "../models/User.js"
import { AppError } from "../utils/AppError.js"
import { sendData } from "../utils/sendResponse.js"

/** Fields returned for each account (never auth/internal fields). */
const USER_FIELDS = "name email image phone role isBlocked createdAt"

/** Better Auth's session collection (sign-in sessions). */
const SESSION_COLLECTION = "session"

/**
 * GET /api/admin/users (ADMIN)
 * Registered customers (admins are not listed), newest first, each with
 * `appointmentCount`.
 */
export async function listUsers(_req: Request, res: Response) {
  const users = await User.find({ role: { $ne: "admin" } })
    .select(USER_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .lean()

  const counts = await Appointment.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { customerId: { $in: users.map((u) => u._id) } } },
    { $group: { _id: "$customerId", count: { $sum: 1 } } },
  ])
  const countById = new Map(counts.map((c) => [String(c._id), c.count]))

  sendData(
    res,
    users.map((u) => ({
      ...u,
      role: u.role ?? "customer",
      isBlocked: u.isBlocked ?? false,
      appointmentCount: countById.get(String(u._id)) ?? 0,
    }))
  )
}

/**
 * PATCH /api/admin/users/:id/block (ADMIN)
 * Body: { isBlocked: boolean }. Admin accounts can't be blocked (that includes
 * the caller). Blocking also deletes the user's Better Auth sessions, so they
 * are signed out everywhere. Their API access stops immediately either way,
 * because every protected route checks `isBlocked` in the database.
 */
export async function setUserBlocked(req: Request, res: Response) {
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw new AppError(404, "User not found.")

  const isBlocked = (req.body as { isBlocked?: unknown } | undefined)?.isBlocked
  if (typeof isBlocked !== "boolean") {
    throw new AppError(400, "isBlocked must be true or false.")
  }

  const target = await User.findById(id).select("role").lean()
  if (!target) throw new AppError(404, "User not found.")
  if (target.role === "admin") {
    throw new AppError(403, "Admin accounts can't be blocked.")
  }

  // `role: { $ne: "admin" }` again so a role change in between can't slip through.
  const user = await User.findOneAndUpdate(
    { _id: id, role: { $ne: "admin" } },
    { $set: { isBlocked, updatedAt: new Date() } },
    { returnDocument: "after", projection: USER_FIELDS }
  ).lean()
  if (!user) throw new AppError(404, "User not found.")

  if (isBlocked) {
    // Better Auth stores session.userId as an ObjectId; match a string too.
    await mongoose.connection
      .collection(SESSION_COLLECTION)
      .deleteMany({ userId: { $in: [new mongoose.Types.ObjectId(id), id] } })
  }

  sendData(res, { ...user, role: user.role ?? "customer", isBlocked: user.isBlocked ?? false })
}
