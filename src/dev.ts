// Local development only (`npm run dev`). On Vercel, src/index.ts is the entry.
import app from "./index.js"
import { connectDB, disconnectDB } from "./config/db.js"
import { env } from "./config/env.js"

async function main() {
  // Connect up front locally so a bad MONGODB_URI fails immediately.
  await connectDB()

  const server = app.listen(env.port, () => {
    console.log(`[api] SalonBook API listening on http://localhost:${env.port}`)
    console.log(`[api] allowed client origins: ${env.clientUrls.join(", ")}`)
  })

  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down...`)
    server.close(async () => {
      await disconnectDB()
      process.exit(0)
    })
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandled promise rejection:", reason)
})

main().catch((err) => {
  console.error("[api] failed to start:", err instanceof Error ? err.message : err)
  process.exit(1)
})
