import type { Request, Response } from "express"
import { isValidObjectId } from "mongoose"
import type Stripe from "stripe"

import { env } from "../config/env.js"
import { getStripe, toMinorUnits } from "../config/stripe.js"
import { Appointment } from "../models/Appointment.js"
import { Transaction } from "../models/Transaction.js"
import type { TransactionStatus } from "../constants.js"
import { AppError } from "../utils/AppError.js"
import { sendData } from "../utils/sendResponse.js"
import { SERVICE_SUMMARY_FIELDS } from "./appointment.controller.js"

/** Unpaid Checkout pages expire after 30 minutes (Stripe's minimum). */
const CHECKOUT_EXPIRES_IN_SECONDS = 30 * 60

/** Checkout Session ids look like "cs_test_a1B2..." / "cs_live_a1B2...". */
const SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/

type ServiceSummary = { serviceName?: string; image?: string } | null

/**
 * Where Stripe sends the customer back. The request's Origin is used only if
 * it's one of the allowed CLIENT_URL origins (so it can't be pointed at
 * another site); otherwise the first CLIENT_URL.
 */
function clientOrigin(req: Request) {
  const origin = req.get("origin")?.replace(/\/+$/, "")
  if (origin && env.clientUrls.includes(origin)) return origin
  return env.clientUrls[0]
}

/**
 * POST /api/payments/checkout-session (CUSTOMER)
 * Body: { appointmentId } → { url }
 *
 * `customerOnly` already rejected guests, admins and blocked users (role and
 * isBlocked are read from the database). Here we check that the appointment
 * belongs to the caller and is confirmed + unpaid. The amount comes from the
 * stored appointment, never from the request.
 */
export async function createCheckoutSession(req: Request, res: Response) {
  const appointmentId = (req.body as { appointmentId?: unknown } | undefined)?.appointmentId
  if (typeof appointmentId !== "string" || !isValidObjectId(appointmentId)) {
    throw new AppError(400, "Please choose a valid appointment.")
  }
  const customer = req.user!

  // Someone else's appointment is a 404: we don't reveal that it exists.
  const appointment = await Appointment.findOne({ _id: appointmentId, customerId: customer.id })
    .select("+checkoutSessionId")
    .populate({ path: "service", select: "serviceName image" })
    .lean()
  if (!appointment) throw new AppError(404, "Appointment not found.")

  if (appointment.paymentStatus === "paid") {
    throw new AppError(409, "This appointment has already been paid.")
  }
  if (appointment.status !== "confirmed") {
    throw new AppError(
      409,
      appointment.status === "pending"
        ? "You can pay once the salon confirms your appointment."
        : "This appointment was cancelled, so it can't be paid."
    )
  }

  const stripe = getStripe()

  // One payable session per appointment: reuse the previous one if it's still
  // open, refuse if it was already paid, otherwise start a new one.
  const previousSessionId = appointment.checkoutSessionId ?? null
  const reusableUrl = await settlePreviousSession(stripe, previousSessionId)
  if (reusableUrl) return sendData(res, { url: reusableUrl }, 200)

  const service = (appointment as unknown as { service?: ServiceSummary }).service ?? null
  const origin = clientOrigin(req)
  // Ids we wrote ourselves; Stripe echoes them back in the signed webhook.
  const metadata = { appointmentId, customerId: customer.id }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customer.email,
    client_reference_id: appointmentId,
    metadata,
    payment_intent_data: { metadata },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: env.currency,
          unit_amount: toMinorUnits(appointment.servicePrice),
          product_data: {
            name: service?.serviceName ?? "Salon appointment",
            description: `Appointment on ${appointment.appointmentDate} at ${appointment.timeSlot}`,
            ...(service?.image && { images: [service.image] }),
          },
        },
      },
    ],
    success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/payment/cancel?appointment_id=${appointmentId}`,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_IN_SECONDS,
    })
  } catch (err) {
    console.error("[payments] creating checkout session failed:", (err as Error).message)
    throw new AppError(502, "We couldn't start the payment with Stripe. Please try again.")
  }

  if (!session.url) throw new AppError(502, "Stripe didn't return a checkout page. Please try again.")

  // Save it as the appointment's session, but only if no other request (e.g.
  // a second tab) replaced the previous one in the meantime.
  const claimed = await Appointment.updateOne(
    { _id: appointmentId, customerId: customer.id, checkoutSessionId: previousSessionId },
    { checkoutSessionId: session.id }
  )
  if (claimed.modifiedCount === 0) {
    await closeCheckoutSession(session.id)
    throw new AppError(
      409,
      "A payment for this appointment was just started in another tab or window. Please continue there, or try again."
    )
  }

  sendData(res, { url: session.url }, 201)
}

/** An open session is reused only if it has at least this long left. */
const MIN_REUSE_SECONDS = 5 * 60

/**
 * Makes sure the appointment's previous Checkout Session can't be paid
 * alongside a new one:
 * - open with enough time left → returns its URL (reuse it)
 * - open but about to expire → expires it, returns null (start a new one)
 * - expired / unknown / none → returns null (start a new one)
 * - completed → 409: already paid, or a delayed payment is still processing
 */
async function settlePreviousSession(stripe: Stripe, sessionId: string | null) {
  if (!sessionId) return null

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) return null
    console.error("[payments] retrieving previous checkout session failed:", (err as Error).message)
    throw new AppError(502, "We couldn't reach Stripe. Please try again in a moment.")
  }

  if (session.status === "open") {
    const secondsLeft = session.expires_at - Math.floor(Date.now() / 1000)
    if (session.url && secondsLeft >= MIN_REUSE_SECONDS) return session.url
    session = (await closeCheckoutSession(sessionId)) ?? session
    if (session.status === "open") {
      throw new AppError(502, "We couldn't reach Stripe. Please try again in a moment.")
    }
  }

  if (session.status === "complete") {
    throw new AppError(
      409,
      session.payment_status === "paid"
        ? "This appointment has already been paid. It can take a moment to show as paid."
        : "Your payment for this appointment is being processed."
    )
  }
  return null
}

/**
 * Expires a Checkout Session so it can no longer be paid. Best effort: never
 * throws. Returns the session's state afterwards (it may have completed just
 * before), or null if Stripe couldn't be reached.
 */
export async function closeCheckoutSession(sessionId: string) {
  let stripe: Stripe
  try {
    stripe = getStripe()
  } catch {
    return null
  }
  try {
    return await stripe.checkout.sessions.expire(sessionId)
  } catch {
    // Not open any more (completed or already expired): report its real state.
    try {
      return await stripe.checkout.sessions.retrieve(sessionId)
    } catch (err) {
      console.error(`[payments] couldn't close checkout session ${sessionId}:`, (err as Error).message)
      return null
    }
  }
}

/**
 * GET /api/payments/checkout-session/:sessionId (CUSTOMER)
 * Status for the Payment Success page. Only the customer who started the
 * session can see it. "Paid" is reported from OUR database.
 *
 * Fallback for a missed or delayed webhook: if Stripe says the session is
 * paid but no transaction exists yet, the payment is recorded here with the
 * same checks as the webhook (`recordPayment`). The session comes from our own
 * authenticated call to Stripe, never from the request, so it can't be faked.
 */
export async function getCheckoutSessionStatus(req: Request, res: Response) {
  const sessionId = String(req.params.sessionId)
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new AppError(404, "Payment not found.")
  const customerId = req.user!.id

  let session: Stripe.Checkout.Session
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId)
  } catch (err) {
    if (err instanceof AppError) throw err
    if ((err as { statusCode?: number }).statusCode === 404) {
      throw new AppError(404, "Payment not found.")
    }
    console.error("[payments] retrieving checkout session failed:", err)
    throw new AppError(502, "We couldn't reach Stripe. Please try again in a moment.")
  }

  const appointmentId = session.metadata?.appointmentId
  if (session.metadata?.customerId !== customerId || !isValidObjectId(appointmentId)) {
    throw new AppError(404, "Payment not found.")
  }

  const findTransaction = () =>
    Transaction.findOne({ stripeSessionId: sessionId, customerId }).lean()

  let transaction = await findTransaction()
  if (!transaction && session.status === "complete" && session.payment_status === "paid") {
    try {
      await recordPayment(session, "paid")
      transaction = await findTransaction()
      if (transaction) console.warn(`[payments] session ${sessionId}: recorded by the status-check fallback (webhook not received yet).`)
    } catch (err) {
      // The webhook (or the next status check) will try again.
      console.error(`[payments] session ${sessionId}: status-check fallback failed:`, err)
    }
  }

  const appointment = await Appointment.findOne({ _id: appointmentId, customerId })
    .populate({ path: "service", select: SERVICE_SUMMARY_FIELDS })
    .lean()

  sendData(res, {
    sessionId,
    checkoutStatus: session.status,
    stripePaymentStatus: session.payment_status,
    amount: (session.amount_total ?? 0) / 100,
    currency: session.currency ?? env.currency,
    appointment,
    transaction,
  })
}

// ---------------------------------------------------------------------------
// Stripe webhook
// ---------------------------------------------------------------------------

/**
 * POST /api/payments/webhook (STRIPE)
 * The main way payments are recorded (the status check above is only a
 * fallback). Both go through `recordPayment`. Requests without a valid Stripe signature are rejected, so nobody can fake
 * a payment by calling this URL. Receives the raw body (see index.ts).
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  if (!env.stripeWebhookSecret) {
    console.error("[payments] STRIPE_WEBHOOK_SECRET is not set; webhook rejected.")
    throw new AppError(503, "Webhook not configured.")
  }
  const signature = req.get("stripe-signature")
  if (!signature || !Buffer.isBuffer(req.body)) {
    throw new AppError(400, "Missing Stripe signature.")
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, env.stripeWebhookSecret)
  } catch {
    throw new AppError(400, "Invalid Stripe signature.")
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session
      // "unpaid" here means a delayed payment method; wait for async_payment_succeeded.
      if (session.payment_status === "paid") await recordPayment(session, "paid")
      break
    }
    case "checkout.session.async_payment_failed":
      await recordPayment(event.data.object as Stripe.Checkout.Session, "failed")
      break
    default:
      // Other events aren't used; acknowledge them so Stripe doesn't retry.
      break
  }

  res.json({ received: true })
}

/**
 * Applies a verified Checkout result. Idempotent: Stripe may deliver the same
 * event more than once, and there is one transaction per session id.
 * Errors are thrown (→ 500) so Stripe retries the event later.
 */
async function recordPayment(session: Stripe.Checkout.Session, status: TransactionStatus) {
  const { appointmentId, customerId } = session.metadata ?? {}
  if (
    !isValidObjectId(appointmentId) ||
    !isValidObjectId(customerId) ||
    session.client_reference_id !== appointmentId
  ) {
    console.error(`[payments] session ${session.id} has no valid appointment metadata; ignored.`)
    return
  }

  // Already handled (Stripe retried or re-sent the event).
  if (await Transaction.exists({ stripeSessionId: session.id })) return

  const appointment = await Appointment.findOne({ _id: appointmentId, customerId })
    .select("servicePrice status paymentStatus")
    .lean()
  if (!appointment) {
    console.error(`[payments] session ${session.id}: appointment ${appointmentId} not found; ignored.`)
    return
  }

  // The amount Stripe charged must be the appointment's price in our currency.
  const amountMinor = session.amount_total ?? 0
  if (amountMinor !== toMinorUnits(appointment.servicePrice) || session.currency !== env.currency) {
    console.error(
      `[payments] session ${session.id}: charged ${amountMinor} ${session.currency}, ` +
        `expected ${toMinorUnits(appointment.servicePrice)} ${env.currency}; not marked paid.`
    )
    return
  }

  if (status === "paid") {
    if (appointment.status !== "confirmed" || appointment.paymentStatus === "paid") {
      // Still record what Stripe charged, but flag it for the salon (refund by hand).
      console.warn(
        `[payments] session ${session.id}: appointment ${appointmentId} was ` +
          `${appointment.status}/${appointment.paymentStatus} when the payment arrived.`
      )
    }
    await Appointment.updateOne({ _id: appointmentId, customerId }, { paymentStatus: "paid" })
  }

  try {
    await Transaction.updateOne(
      { stripeSessionId: session.id },
      {
        $setOnInsert: {
          appointmentId,
          customerId,
          amount: amountMinor / 100,
          currency: session.currency,
          stripeSessionId: session.id,
          status,
        },
      },
      { upsert: true }
    )
  } catch (err) {
    // Two deliveries of the same event raced; the other one saved it.
    if ((err as { code?: number }).code !== 11000) throw err
  }
}
