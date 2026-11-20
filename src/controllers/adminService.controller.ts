import type { Request, Response } from "express"
import { isValidObjectId } from "mongoose"

import { Service } from "../models/Service.js"
import { AppError } from "../utils/AppError.js"
import { sendData } from "../utils/sendResponse.js"

/** Fields an admin may set. Anything else in the body (e.g. _id, createdAt) is ignored. */
const EDITABLE_FIELDS = [
  "serviceName",
  "category",
  "description",
  "price",
  "duration",
  "image",
  "status",
] as const

function pickEditable(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Request body must be a JSON object.")
  }
  const input = body as Record<string, unknown>
  return Object.fromEntries(
    EDITABLE_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]])
  )
}

function serviceIdParam(req: Request) {
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw new AppError(404, "Service not found.")
  return id
}

/**
 * GET /api/admin/services (ADMIN)
 * Every service, including inactive ones, newest first.
 */
export async function listAllServices(_req: Request, res: Response) {
  const services = await Service.find().sort({ createdAt: -1, _id: -1 }).lean()
  sendData(res, services)
}

/**
 * POST /api/services (ADMIN)
 * Body: { serviceName, category, description, price, duration, image, status? }
 * Validation (positive price/duration, category, image host...) is in the model.
 */
export async function createService(req: Request, res: Response) {
  const service = await Service.create(pickEditable(req.body))
  sendData(res, service, 201)
}

/**
 * PATCH /api/services/:id (ADMIN)
 * Partial update of the editable fields (also used to activate/deactivate).
 */
export async function updateService(req: Request, res: Response) {
  const id = serviceIdParam(req)
  const updates = pickEditable(req.body)
  if (Object.keys(updates).length === 0) {
    throw new AppError(400, "Nothing to update.")
  }

  const service = await Service.findByIdAndUpdate(id, updates, {
    returnDocument: "after",
    runValidators: true,
  })
  if (!service) throw new AppError(404, "Service not found.")

  sendData(res, service)
}

/**
 * DELETE /api/services/:id (ADMIN)
 * Existing appointments keep their own copy of the price and show the service
 * as deleted on the client.
 */
export async function deleteService(req: Request, res: Response) {
  const id = serviceIdParam(req)
  const service = await Service.findByIdAndDelete(id)
  if (!service) throw new AppError(404, "Service not found.")

  sendData(res, { _id: service._id })
}
