import type { Request, Response } from "express"
import { isValidObjectId } from "mongoose"

import { Service } from "../models/Service.js"
import { AppError } from "../utils/AppError.js"
import { sendData } from "../utils/sendResponse.js"
import { buildPublicServiceQuery } from "../utils/serviceQuery.js"

/**
 * GET /api/services (PUBLIC)
 * Active services only, with optional search (by name), category filter,
 * sort (newest | price-asc | price-desc | duration-asc | duration-desc) and limit.
 */
export async function listPublicServices(req: Request, res: Response) {
  const { filter, sort, limit } = buildPublicServiceQuery(req.query)

  const query = Service.find(filter).sort(sort)
  if (limit) query.limit(limit)

  sendData(res, await query.lean())
}

/**
 * GET /api/services/categories (PUBLIC)
 * `[{ category, count }]`: number of ACTIVE services in each category.
 */
export async function listServiceCategories(_req: Request, res: Response) {
  const counts = await Service.aggregate<{ category: string; count: number }>([
    { $match: { status: "active" } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $project: { _id: 0, category: "$_id", count: 1 } },
    { $sort: { category: 1 } },
  ])

  sendData(res, counts)
}

/**
 * GET /api/services/:id (PUBLIC)
 * One service, active or inactive (the details page explains when an
 * inactive service can't be booked). 404 for unknown or malformed ids.
 */
export async function getServiceById(req: Request, res: Response) {
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw new AppError(404, "Service not found.")

  const service = await Service.findById(id).lean()
  if (!service) throw new AppError(404, "Service not found.")

  sendData(res, service)
}
