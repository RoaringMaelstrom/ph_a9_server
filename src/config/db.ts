import mongoose from "mongoose"

import { env } from "./env.js"

mongoose.set("strictQuery", true)

// Reuse one connection across hot reloads and serverless invocations.
let connecting: Promise<typeof mongoose> | null = null

/** Connects to MongoDB (the same database Better Auth uses on the client). */
export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose
  if (!connecting) {
    connecting = mongoose
      .connect(env.mongodbUri, {
        dbName: env.dbName,
        serverSelectionTimeoutMS: 10_000,
      })
      .catch((err) => {
        connecting = null
        throw err
      })
  }
  return connecting
}

export async function disconnectDB() {
  await mongoose.disconnect()
  connecting = null
}

mongoose.connection.on("connected", () =>
  console.log(`[db] connected to "${env.dbName}"`)
)
mongoose.connection.on("disconnected", () => console.warn("[db] disconnected"))
mongoose.connection.on("error", (err) => console.error("[db] error:", err.message))
