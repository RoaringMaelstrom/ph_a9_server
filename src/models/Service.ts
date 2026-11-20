import { Schema, model, type InferSchemaType } from "mongoose"

import { SERVICE_CATEGORIES, SERVICE_STATUSES } from "../constants.js"

/** A salon service on the menu (`services` collection). */
const serviceSchema = new Schema(
  {
    serviceName: {
      type: String,
      required: [true, "Service name is required."],
      trim: true,
      minlength: [3, "Service name must be at least 3 characters."],
      maxlength: [80, "Service name must be 80 characters or fewer."],
    },
    category: {
      type: String,
      required: [true, "Category is required."],
      enum: { values: SERVICE_CATEGORIES, message: "Please choose a valid category." },
    },
    description: {
      type: String,
      required: [true, "Description is required."],
      trim: true,
      minlength: [20, "Description must be at least 20 characters."],
      maxlength: [1000, "Description must be 1000 characters or fewer."],
    },
    price: {
      type: Number,
      required: [true, "Price is required."],
      min: [0.01, "Price must be a positive number."],
    },
    /** Estimated duration in minutes */
    duration: {
      type: Number,
      required: [true, "Duration is required."],
      min: [1, "Duration must be a positive number."],
      max: [720, "Duration can't be more than 12 hours."],
      validate: {
        validator: Number.isInteger,
        message: "Duration must be a whole number of minutes.",
      },
    },
    /** ImgBB URL (uploaded by the admin, not a pasted link) */
    image: {
      type: String,
      required: [true, "Service image is required."],
      trim: true,
    },
    status: {
      type: String,
      enum: { values: SERVICE_STATUSES, message: "Status must be active or inactive." },
      default: "active",
    },
  },
  {
    collection: "services",
    timestamps: true,
    versionKey: false,
  }
)

// Browse Services: active services by category / newest / price / duration.
serviceSchema.index({ status: 1, category: 1 })
serviceSchema.index({ status: 1, createdAt: -1 })

export type ServiceDoc = InferSchemaType<typeof serviceSchema>

export const Service = model("Service", serviceSchema)
