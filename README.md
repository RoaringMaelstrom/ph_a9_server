# SalonBook Server

REST API for **SalonBook**, a salon appointment booking platform. Customers browse services, request appointments and pay with Stripe. Admins manage services, appointments, users and transactions.

> Work in progress. Features are added step by step.

## Tech stack

- Node.js + Express 5 (TypeScript)
- MongoDB with Mongoose (shares the database with the client's Better Auth)
- JWT verification of Better Auth tokens with `jose` (JWKS)
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

Other endpoints (appointments, payments, admin) are being implemented.

### Authentication

Protected endpoints require `Authorization: Bearer <token>`, where the token is a Better Auth JWT (the client gets it from `/api/auth/token`). The `verifyJWT` middleware checks the signature against the client's public keys at `${BETTER_AUTH_URL}/api/auth/jwks`, plus the algorithm (EdDSA), issuer, audience and expiry. Missing or invalid tokens get `401`.

## Data model

MongoDB database `SalonBook`, shared with the client's Better Auth. Mongoose models are in `src/models/`.

| Collection | Model | Notes |
| --- | --- | --- |
| `user` | `User` | Owned by Better Auth. The API reads it and only changes `isBlocked`. Fields used: `name, email, image, role (customer/admin), isBlocked, phone` |
| `services` | `Service` | `serviceName, category, description, price (> 0), duration (minutes, > 0), image, status (active/inactive, default active), createdAt` |
| `appointments` | `Appointment` | `serviceId → services, customerId → user, appointmentDate (YYYY-MM-DD), timeSlot (HH:mm), message, servicePrice, paymentStatus (unpaid/paid), status (pending/confirmed/cancelled), createdAt` |
| `transactions` | `Transaction` | `appointmentId → appointments, customerId → user, amount, currency, stripeSessionId (unique), status (paid/failed), createdAt`. Written only by the Stripe webhook |

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

## Links

- Live API: _TBD_
- Client repository: _TBD_
- Server repository: _TBD_
