import type { SortOrder } from "mongoose"

import { SERVICE_CATEGORIES } from "../constants.js"
import { AppError } from "./AppError.js"

export const SERVICE_SORTS = [
  "newest",
  "price-asc",
  "price-desc",
  "duration-asc",
  "duration-desc",
] as const

export type ServiceSort = (typeof SERVICE_SORTS)[number]

const SORTS: Record<ServiceSort, Record<string, SortOrder>> = {
  newest: { createdAt: -1 },
  "price-asc": { price: 1 },
  "price-desc": { price: -1 },
  "duration-asc": { duration: 1 },
  "duration-desc": { duration: -1 },
}

const MAX_SEARCH_LENGTH = 100
const MAX_LIMIT = 100

/** Escapes regex special characters so a search like "a+b" is literal. */
export function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function first(value: unknown): string {
  if (Array.isArray(value)) return first(value[0])
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Turns `?search=&category=&sort=&limit=` into a MongoDB filter, sort and
 * limit for the PUBLIC service list. Always restricted to active services.
 * Throws 400 for values the client never sends (bad category/sort/limit).
 */
export function buildPublicServiceQuery(query: Record<string, unknown>) {
  const filter: Record<string, unknown> = { status: "active" }

  const search = first(query.search).slice(0, MAX_SEARCH_LENGTH)
  if (search) filter.serviceName = { $regex: escapeRegex(search), $options: "i" }

  const category = first(query.category)
  if (category) {
    if (!(SERVICE_CATEGORIES as readonly string[]).includes(category)) {
      throw new AppError(400, "Unknown service category.")
    }
    filter.category = category
  }

  const sortKey = first(query.sort) || "newest"
  if (!(SERVICE_SORTS as readonly string[]).includes(sortKey)) {
    throw new AppError(400, `Sort must be one of: ${SERVICE_SORTS.join(", ")}.`)
  }
  // _id as a tie-breaker keeps the order stable between requests.
  const sort: Record<string, SortOrder> = { ...SORTS[sortKey as ServiceSort], _id: -1 }

  const rawLimit = first(query.limit)
  let limit: number | undefined
  if (rawLimit) {
    limit = Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new AppError(400, "Limit must be a positive whole number.")
    }
    limit = Math.min(limit, MAX_LIMIT)
  }

  return { filter, sort, limit }
}
