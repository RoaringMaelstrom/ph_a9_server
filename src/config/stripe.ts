import Stripe from "stripe"

import { AppError } from "../utils/AppError.js"
import { env } from "./env.js"

let client: Stripe | null = null

/**
 * The Stripe client (created on first use). Throws 503 if STRIPE_SECRET_KEY
 * isn't set, so a missing key only breaks payments, not the whole API.
 */
export function getStripe(): Stripe {
  if (!env.stripeSecretKey) {
    throw new AppError(503, "Online payments are not available right now. Please try again later.")
  }
  client ??= new Stripe(env.stripeSecretKey, { maxNetworkRetries: 2, timeout: 10_000 })
  return client
}

/** Stripe amounts are integers in the smallest unit: $45.50 → 4550. */
export function toMinorUnits(amount: number) {
  return Math.round(amount * 100)
}
