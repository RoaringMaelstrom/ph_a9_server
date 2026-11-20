import { Schema, model, type InferSchemaType } from "mongoose"

import { TRANSACTION_STATUSES } from "../constants.js"

/**
 * A payment record (`transactions` collection). Created ONLY by the verified
 * Stripe webhook; there are no endpoints that edit it.
 */
const transactionSchema = new Schema(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Amount in major units (e.g. dollars), as charged by Stripe */
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    /** ISO 4217, lowercase as Stripe reports it, e.g. "usd" */
    currency: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    stripeSessionId: {
      type: String,
      required: true,
      // One record per Checkout Session, so a retried webhook can't create
      // a second transaction.
      unique: true,
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      required: true,
    },
  },
  {
    collection: "transactions",
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    id: false,
  }
)

transactionSchema.virtual("appointment", {
  ref: "Appointment",
  localField: "appointmentId",
  foreignField: "_id",
  justOne: true,
})
transactionSchema.virtual("customer", {
  ref: "User",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
})

// Customer payment history and admin list, newest first.
transactionSchema.index({ customerId: 1, createdAt: -1 })
transactionSchema.index({ createdAt: -1 })

export type TransactionDoc = InferSchemaType<typeof transactionSchema>

export const Transaction = model("Transaction", transactionSchema)
