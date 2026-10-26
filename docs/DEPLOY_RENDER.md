# Deploying the backend on Render

The service is a plain Node/Express app that talks to PostgreSQL through Prisma,
so Render only needs a build command, a start command and environment variables.
Evidence images go to ImageKit, so nothing depends on local disk.

---

## 0. What you need before starting

| Value | Where to get it |
|---|---|
| `DATABASE_URL` | Neon dashboard → your project → **Connection string**. Choose the **direct** host (no `-pooler`) and keep `?sslmode=require`. |
| `JWT_SECRET` | Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `MODEL_API_KEY` | Same value you put in `traffic-Violation-detection/.env` |
| `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` / `IMAGEKIT_URL_ENDPOINT` | ImageKit dashboard → Developer options |

> `migrate deploy` was verified against Neon's pooled host (`-pooler`), so the
> same string works for build, migrations and runtime. Switch to the direct host
> only if you ever see advisory-lock timeouts while deploying.

---

## 1. Deploy from the blueprint (recommended)

The repo contains [`render.yaml`](../render.yaml), which encodes the build/start
commands, the health check and every environment variable name.

1. Push the backend repo (branch `restart-backend`).
2. Render dashboard → **New +** → **Blueprint**.
3. Connect `Stranger0107/Traffic-violation-backend` and pick the `restart-backend`
   branch. Render reads `render.yaml` and shows one service, `traffic-mama-backend`.
4. It asks for the `sync: false` values listed in the file. Paste them in.
5. **Apply**. First build takes a few minutes (install + `prisma generate`).

## 1b. Or create the service by hand

If you prefer not to use the blueprint:

| Setting | Value |
|---|---|
| Type | Web Service |
| Runtime | Node |
| Branch | `restart-backend` |
| Region | Singapore (closest to India) |
| Build Command | `npm ci && npx prisma generate` |
| Start Command | `npx prisma migrate deploy && node src/server.js` |
| Health Check Path | `/api/health` |
| Instance | Free |

Then add the environment variables from step 2.

---

## 2. Environment variables

Set these in **Environment** on the service. Full descriptions live in
[`.env.example`](../.env.example).

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon direct connection string |
| `JWT_SECRET` | 96-char hex string (never reuse your local one) |
| `MODEL_API_KEY` | shared secret for `/api/v1/model/*` |
| `IMAGEKIT_PUBLIC_KEY` | from ImageKit |
| `IMAGEKIT_PRIVATE_KEY` | from ImageKit |
| `IMAGEKIT_URL_ENDPOINT` | from ImageKit |
| `DEMO_PAYMENTS_ENABLED` | `true` for the college demo, `false` for a real deployment |
| `DEMO_PAYMENT_DEFAULT_OUTCOME` | `SUCCESS` |
| `DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME` | `true` while demonstrating all three outcomes |
| `PAYMENT_CONFLICT_RETRY_MS` | `10000` |

Do **not** set `PORT`: Render injects it, and `src/server.js` already falls back
to 5000 locally.

Optional, only if you want SMS OTP instead of the console fallback:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`,
`OTP_EXPIRY_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN`.
Without them, OTPs are printed to the Render logs.

---

## 3. Verify the deployment

Replace `<host>` with the URL Render shows (`https://traffic-mama-backend.onrender.com`).

```bash
# 1. Liveness — no database involved
curl https://<host>/api/health
# {"status":"ok","service":"traffic-violation-backend","uptimeSeconds":12}

# 2. Database connectivity through Prisma
curl https://<host>/api/test/db
# {"success":true,"message":"Database Connected"}

# 3. Auth works
curl -X POST https://<host>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"citizen@test.com","password":"test123"}'

# 4. Transactions are readable with that token
curl https://<host>/api/v1/payments/my -H "Authorization: Bearer <token>"
```

A `502` at step 1 means the process never bound its port — open **Logs** and read
the first error, it is almost always a missing or malformed environment variable.

---

## 4. Point the other two pieces at it

**Detection model** — in `traffic-Violation-detection/.env`:

```env
TVD_BACKEND_URL=https://<host>
MODEL_API_KEY=<same value as the backend>
```

**Frontend** — `src/api/client.js` uses the relative base `/api/v1`, which is
rewritten by the Vite dev proxy (`vite.config.js` → `http://localhost:5000`). To
use the deployed API, either change that proxy target to `https://<host>`, or, when
you host the frontend itself, set the base to an absolute URL:

```js
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
```

`cors()` is currently open to every origin, so a deployed frontend on any host can
call the API. Restrict it once the frontend URL is final:

```js
app.use(cors({ origin: ["https://your-frontend.example"] }));
```

---

## 5. Free-tier behaviour to expect

- **Cold starts:** the instance sleeps after 15 minutes of inactivity and the next
  request waits roughly 50 seconds. Open the API once before your demo, or use a
  paid instance, so the first judge-click is not the slow one.
- **Ephemeral disk:** nothing is written to disk (uploads stream to ImageKit), so a
  restart loses no evidence. Do not add file writes later without changing this.
- **Single instance:** no background workers or cron; the OTP cleanup timers run
  inside the web process, which is fine for one instance.
- **Logs** are the only place console OTPs appear — they are wiped on redeploy.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails at `prisma generate` | `prisma` must stay in `dependencies` (it is); also check `NODE_ENV` is not set to `production` during build if you move it to devDependencies. |
| `P1001: Can't reach database server` | Wrong `DATABASE_URL`, or Neon's IP allow-list / project paused. |
| `P3018` / migration error on start | The database is ahead of or behind the repo. Inspect with `npx prisma migrate status` locally against the same URL. |
| `502` on every request | Start command failed — check logs; usually `JWT_SECRET` missing, since the app guards on it at request time, or a typo in `startCommand`. |
| Payments answer `403 DEMO_DISABLED` | `DEMO_PAYMENTS_ENABLED` is not exactly `true` (this is the intended fail-safe). |
| Evidence upload fails | One of the three `IMAGEKIT_*` values is wrong or empty. |
| Model submissions rejected `401` | `MODEL_API_KEY` differs between Render and the detection machine. |
