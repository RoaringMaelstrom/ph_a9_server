# SalonBook Server

REST API for **SalonBook**, a salon appointment booking platform. Customers browse services, request appointments and pay with Stripe. Admins manage services, appointments, users and transactions.

> Work in progress. Features are added step by step.

## Tech stack

- Node.js + Express 5 (TypeScript)
- MongoDB with Mongoose (shares the database with the client's Better Auth)
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

## Environment variables

Create a `.env` file in the project root (locally) or add these in the Vercel project settings. Never commit real values.

| Name | Purpose |
| --- | --- |
| `PORT` | Local port (default 5000) |
| `NODE_ENV` | `development` or `production` |
| `MONGODB_URI` | **Required.** MongoDB connection string (same cluster as the client) |
| `DB_NAME` | Database name (default `SalonBook`) |
| `CLIENT_URL` | **Required.** Allowed client origin(s) for CORS, comma-separated |

## Links

- Live API: _TBD_
- Client repository: _TBD_
- Server repository: _TBD_
