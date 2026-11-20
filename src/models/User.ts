import { Schema, model, type InferSchemaType } from "mongoose"

import { USER_ROLES } from "../constants.js"

/**
 * Better Auth's `user` collection (owned by the client's Better Auth).
 *
 * The API reads it (roles, admin lists, populating customers) and only ever
 * changes `isBlocked`. It never creates users or touches auth fields.
 * Better Auth stores `_id` as an ObjectId and manages createdAt/updatedAt.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String, default: null },
    role: { type: String, enum: USER_ROLES, default: "customer" },
    isBlocked: { type: Boolean, default: false },
    phone: { type: String, default: null },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  {
    collection: "user",
    // Better Auth owns this collection's indexes and timestamps.
    autoIndex: false,
    timestamps: false,
    versionKey: false,
    // Keep any extra fields Better Auth (or its plugins) stores.
    strict: false,
    id: false,
  }
)

export type UserDoc = InferSchemaType<typeof userSchema>

export const User = model("User", userSchema)
