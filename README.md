# SalonBook Server

REST API for **SalonBook**, a salon appointment booking platform. Customers browse services, request appointments and pay with Stripe. Admins manage services, appointments, users and transactions.

## Features

- **Public service catalogue:** active services with search, category filter, sorting and limits, plus per-category counts.
- **Appointment booking:** customers request a date and time slot; double bookings, past dates and closed hours are rejected, and a unique index prevents race conditions.
- **JWT authentication:** Better Auth tokens are verified against the client's JWKS in a dedicated middleware.
- **Server-side authorization:** every protected route re-reads the user's role and blocked status from the database.
- **Admin tools:** service CRUD, confirm/cancel appointments, block/unblock customers (blocking also signs them out), overview statistics and a read-only transaction list.
- **Stripe payments:** Checkout for confirmed appointments; only the signature-verified webhook marks an appointment paid and records the transaction.

## Tech stack

- Node.js + Express 5 (TypeScript)
- MongoDB with Mongoose (shares the database with the client's Better Auth)
- JWT verification of Better Auth tokens with `jose` (JWKS)
- Stripe Checkout + webhooks (`stripe`)
- Deployed on Vercel (zero-config Express; entry: `src/index.ts`)

## Getting started

```bash
npm install
# create a .env file with the variables listed below
npm run dev   # http://localhost:5000
```

Check it's running: `GET http://localhost:5000/api/health` (also reports whether MongoDB is connected).

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start locally with auto-reload (`src/dev.ts`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server locally |
| `npm run typecheck` | Type-check without emitting |

## API

All routes are under `/api`. Responses are `{ success: true, data }` or `{ success: false, message }`.

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | API and database status |
| GET | `/api/services` | Public | Active services. Query: `search` (name), `category`, `sort` (`newest`, `price-asc`, `price-desc`, `duration-asc`, `duration-desc`), `limit` (max 100) |
| GET | `/api/services/categories` | Public | `[{ category, count }]` of active services |
| GET | `/api/services/:id` | Public | One service (404 if not found) |
| GET | `/api/admin/services` | Admin | All services, including inactive |
| POST | `/api/services` | Admin | Create a service (`serviceName, category, description, price, duration, image, status?`) |
| PATCH | `/api/services/:id` | Admin | Update any of those fields (e.g. `{ "status": "inactive" }`) |
| DELETE | `/api/services/:id` | Admin | Delete a service |
| POST | `/api/appointments` | Customer | Request an appointment (`serviceId, appointmentDate (YYYY-MM-DD), timeSlot (HH:mm), message?`). Saved as `pending` + `unpaid` |
| GET | `/api/appointments/me` | Customer | The caller's own appointments, newest first, with `service` populated (`null` if deleted) |
| PATCH | `/api/appointments/:id/cancel` | Customer | Cancel own appointment, only while `pending` |
| GET | `/api/admin/appointments` | Admin | All appointments, newest first, with `service` and `customer` populated. Query: `status` (`pending`, `confirmed`, `cancelled`), `limit` (1-100) |
| PATCH | `/api/admin/appointments/:id/status` | Admin | `{ status: "confirmed" }` (only from `pending`) or `{ status: "cancelled" }` (from `pending` or `confirmed`). Payment fields can't be changed |
| GET | `/api/admin/users` | Admin | Registered customers (admins aren't listed), newest first, with `appointmentCount` |
| PATCH | `/api/admin/users/:id/block` | Admin | `{ isBlocked: true | false }`. Admin accounts can't be blocked. Blocking also signs the user out |
| GET | `/api/admin/stats` | Admin | `{ totalCustomers, activeServices, totalAppointments, pendingAppointments, confirmedAppointments, successfulPayments }` |
| POST | `/api/payments/checkout-session` | Customer | `{ appointmentId }` → `{ url }`: Stripe Checkout for the caller's own **confirmed + unpaid** appointment (`201` new session, `200` existing open session reused) |
| GET | `/api/payments/checkout-session/:sessionId` | Customer | Read-only status of the caller's own Checkout Session (Payment Success page) |
| POST | `/api/payments/webhook` | Stripe | Signature-verified webhook. The only place that sets `paymentStatus: "paid"` and creates transactions |
| GET | `/api/transactions/me` | Customer | The caller's own payment history, newest first, with `service`, `customer` and `appointmentDate` |
| GET | `/api/admin/transactions` | Admin | All transactions, same shape. Read-only: no endpoint edits transactions |

Service validation: price and duration must be positive (duration in whole minutes), category must be one of the 7 salon categories, and the image must be an `https` URL on ImgBB (`i.ibb.co`) or Unsplash (`images.unsplash.com`), the hosts the client can display.

Booking rules (`POST /api/appointments`):

- The customer comes from the verified JWT and `servicePrice` from the service. `status`, `paymentStatus`, `customerId` or a price in the body are ignored.
- Only **active** services can be booked (`400`; unknown service `404`).
- The date must be a real date, not in the past and at most 60 days ahead. The time must be one of the hourly slots `10:00`–`17:00` (Sundays until `15:00`, the salon closes at 4 PM).
- `409` if that service already has a pending or confirmed appointment at the same date and time, or if the customer already has one at that date and time. A unique partial index on `appointments` also stops two simultaneous requests from taking the same slot. Cancelled appointments free the slot.
- Customers only ever see and cancel their **own** appointments; someone else's appointment is a `404`. Cancelling anything that isn't `pending` is a `409`.

Payment rules:

- Only the appointment's own customer can pay, only when it's `confirmed` and `unpaid` (someone else's appointment is a `404`, other states a `409`). Admins and blocked users get `403`.
- The amount is taken from the stored appointment (`servicePrice`), never from the request. Stripe redirects back only to an allowed `CLIENT_URL` origin.
- The webhook rejects requests without a valid Stripe signature (`400`). It also checks that the session's appointment, customer, amount and currency match the database before marking anything paid, and it is idempotent: one transaction per Checkout Session, however often Stripe retries.
- One payable Checkout Session per appointment, so a customer can't pay twice (e.g. from two tabs). Pressing Pay Now again reuses the open session (`200`); if it has expired or has under 5 minutes left, it's closed and a new one is created (`201`). If the previous session was already completed, the request is a `409`. When several requests arrive at once, only one session is kept and the others are expired. When an admin cancels an unpaid appointment, its open Checkout page is expired too.
- Admins can't change payment status or transactions; cancelling a paid appointment doesn't refund it automatically.

### Authentication

Protected endpoints require `Authorization: Bearer <token>`, where the token is a Better Auth JWT (the client gets it from `/api/auth/token`). The `verifyJWT` middleware checks the signature against the client's public keys at `${BETTER_AUTH_URL}/api/auth/jwks`, plus the algorithm (EdDSA), issuer, audience and expiry. Missing or invalid tokens get `401`.

### Authorization

After the token is verified, `requireRole` loads the user **from the database** (not from the token, whose claims can be up to 15 minutes old) and enforces access on the server:

- Blocked accounts get `403` on every protected endpoint.
- Customer endpoints (`...customerOnly`) accept only `role: "customer"`.
- Admin endpoints (`...adminOnly`) accept only `role: "admin"`.
- Accounts that no longer exist get `401`.

Admin accounts are never created through public sign-up; the `admin` role is assigned directly in the database.

**Blocking a user** sets `isBlocked: true` and deletes their Better Auth `session` documents, so they're signed out on every device. Their API access stops immediately anyway, because every protected endpoint reads `isBlocked` from the database. Unblocking lets them sign in again.

## Data model

MongoDB database `SalonBook`, shared with the client's Better Auth. Mongoose models are in `src/models/`.

| Collection | Model | Notes |
| --- | --- | --- |
| `user` | `User` | Owned by Better Auth. The API reads it and only changes `isBlocked`. Fields used: `name, email, image, role (customer/admin), isBlocked, phone` |
| `services` | `Service` | `serviceName, category, description, price (> 0), duration (minutes, > 0), image, status (active/inactive, default active), createdAt` |
| `appointments` | `Appointment` | `serviceId → services, customerId → user, appointmentDate (YYYY-MM-DD), timeSlot (HH:mm), message, servicePrice, paymentStatus (unpaid/paid), status (pending/confirmed/cancelled), createdAt` |
| `transactions` | `Transaction` | `appointmentId → appointments, customerId → user, amount, currency, stripeSessionId (unique), status (paid/failed), createdAt`. Written only by the Stripe webhook |

## Sample data

`seed/services.json` contains 38 sample services across all 7 categories (35 active, 3 inactive), enough to try search, category filters, sorting and pagination (MongoDB Extended JSON). If you already imported an earlier version, delete the old documents first, or they will appear twice. Import them into the `services` collection with MongoDB Compass (**Add Data → Import JSON**), or:

```bash
mongoimport --uri "<MONGODB_URI>" --db SalonBook --collection services --jsonArray --file seed/services.json
```

## Environment variables

Create a `.env` file in the project root (locally) or add these in the Vercel project settings. Never commit real values.

| Name | Purpose |
| --- | --- |
| `PORT` | Local port (default 5000) |
| `NODE_ENV` | `development` or `production` |
| `MONGODB_URI` | **Required.** MongoDB connection string (same cluster as the client) |
| `DB_NAME` | Database name (default `SalonBook`) |
| `CLIENT_URL` | **Required.** Allowed client origin(s) for CORS, comma-separated |
| `BETTER_AUTH_URL` | **Required.** URL of the Next.js app running Better Auth (its `baseURL`), used to verify JWTs |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` for test mode). Payment routes answer 503 without it |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint `POST /api/payments/webhook` (`whsec_...`) |
| `CURRENCY` | Checkout currency, ISO 4217 (default `usd`) |

### Stripe webhook

Payments are only marked **paid** by the signed Stripe webhook. Subscribe the endpoint `https://<api-host>/api/payments/webhook` to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Locally, forward events with the Stripe CLI and use the `whsec_...` it prints:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

## Links

- Live API: _TBD_
- Client repository: https://github.com/RoaringMaelstrom/ph-a9
- Server repository: https://github.com/RoaringMaelstrom/ph_a9_server
