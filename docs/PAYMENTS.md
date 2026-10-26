# Demo Payment Module (E-Challan)

Backend-only demonstration of paying an issued challan through simulated UPI / credit card /
debit card checkout. **No real money moves.** No payment gateway, card network, UPI switch or
government treasury is contacted, and no payment credentials are ever stored.

---

## 1. What already existed (audit summary)

| Area | Existing state |
|---|---|
| Runtime | Node.js 24, CommonJS, Express 5 (`src/app.js`) |
| Database | PostgreSQL (Neon) via Prisma 7.8 + `@prisma/adapter-pg` (`src/config/prisma.js`) |
| Auth | JWT Bearer — `userAuth` + `authorize(...roles)` in `src/middleware/userAuth.js` |
| Validation | `zod` middleware under `src/middleware/` |
| Layers | `routes/` → `controllers/` → `services/`, error envelope `{ success, message }`, `console.error` + typed `err.code` mapping |
| Challan model | `Challan` with `status` (`ISSUED`, `PENDING_PAYMENT`, `PAID`, `CANCELLED`, `CLOSED`, `DISPUTED`), `fineAmount Decimal(10,2)`, `paidAt`, owner via `challan.vehicle.ownerId` |
| Payment model | **Did not exist.** Only the `ChallanStatus.PENDING_PAYMENT` enum value existed. Nothing was duplicated. |

Because nothing payment-related existed, the module adds one new model and reuses every
existing convention (JWT middleware, zod validation, service layer, error codes, `/api/v1`).

---

## 2. Data model

```prisma
enum PaymentMethod { UPI CREDIT_CARD DEBIT_CARD }
enum PaymentStatus { PENDING SUCCESS FAILED }

model Payment {
  id             String        @id @default(uuid())
  reference      String        @unique   // DEMO-PAY-2026-9F3A1C7B2D
  challanId      String
  citizenId      String
  amount         Decimal       @db.Decimal(10, 2)  // snapshot of challan.fineAmount
  currency       String        @default("INR")
  method         PaymentMethod
  status         PaymentStatus @default(PENDING)
  isDemo         Boolean       @default(true)
  idempotencyKey String?
  failureReason  String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  completedAt    DateTime?
  challan        Challan       @relation(fields: [challanId], references: [id])
  citizen        User          @relation(fields: [citizenId], references: [id])

  @@unique([citizenId, idempotencyKey])
  @@index([challanId]) @@index([citizenId]) @@index([status]) @@index([createdAt])
}
```

Migration: [`prisma/migrations/20261026000000_add_payment_module/migration.sql`](../prisma/migrations/20261026000000_add_payment_module/migration.sql)

Key database decisions:

- **`amount` is a snapshot**, copied from `Challan.fineAmount` inside the same transaction that
  creates the payment. A later change to the fine cannot retroactively alter a receipt, and the
  API never accepts an amount from the client.
- **`CREATE UNIQUE INDEX "Payment_one_success_per_challan" ON "Payment"("challanId") WHERE status = 'SUCCESS'`** —
  a partial unique index, so at most one successful payment can ever exist per challan. This holds
  even if two requests race past the application checks. Failed/pending rows are unaffected.
- **`CHECK ("amount" > 0)`** — no zero/negative payments.
- `@@unique([citizenId, idempotencyKey])` makes a retried create request resolve to the same row.
- No column exists for card number, CVV, expiry, UPI handle or UPI PIN — there is nowhere to store
  them, by design.

---

## 3. Endpoints

All routes are mounted under `/api/v1` (`src/routes/payment.routes.js`). Every route requires a
JWT: `Authorization: Bearer <token>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/payments` | CITIZEN | Create (or reuse) a pending demo payment |
| POST | `/payments/:id/simulate` | CITIZEN (owner), ADMIN | Server-controlled demo transaction |
| GET | `/payments/my` | CITIZEN | Own payment history (`?status=&limit=`) |
| GET | `/payments/:id` | owner, ADMIN | One payment |
| GET | `/payments/reference/:reference` | owner, ADMIN | Lookup by demo reference |
| GET | `/payments/:id/receipt` | owner, ADMIN | Receipt, SUCCESS only |
| GET | `/admin/payments` | ADMIN | All payments (`?status=&limit=`) |

### 3.1 Create a payment

```http
POST /api/v1/payments
Authorization: Bearer <citizen token>
Content-Type: application/json

{
  "challanId": "9f0f6a0e-1c1b-4e2f-9a6d-6d6f0c2b1a11",
  "method": "UPI",
  "upiId": "demo.user@okhdfc",         // optional, UPI only, never stored
  "idempotencyKey": "order-9f0f6a0e-1" // optional, 8..128 chars
}
```

`201 Created` (or `200 OK` when an existing pending attempt / same idempotency key is reused):

```json
{
  "success": true,
  "idempotent": false,
  "payment": {
    "id": "0b0c7f0c-6b0e-4f0e-9c02-5f1f0a5c9b31",
    "reference": "DEMO-PAY-2026-9F3A1C7B2D",
    "challanId": "9f0f6a0e-1c1b-4e2f-9a6d-6d6f0c2b1a11",
    "citizenId": "3a4b5c6d-7e8f-4a9b-8c1d-2e3f4a5b6c7d",
    "amount": "500.00",
    "currency": "INR",
    "method": "UPI",
    "status": "PENDING",
    "isDemo": true,
    "failureReason": null,
    "createdAt": "2026-10-26T09:12:44.512Z",
    "updatedAt": "2026-10-26T09:12:44.512Z",
    "completedAt": null,
    "demoNotice": "DEMO — NO REAL MONEY TRANSFERRED"
  },
  "checkout": {
    "demoMode": true,
    "scannable": false,
    "notice": "DEMO — NO REAL MONEY TRANSFERRED",
    "upi": {
      "vpaMasked": "de*******@okhdfc",
      "payeeName": "E-Challan Demo Treasury",
      "qrPayload": "DEMO-ECHALLAN|PAY|DEMO-PAY-2026-9F3A1C7B2D|500.00|NOT-A-REAL-PAYMENT",
      "qrImageUrl": null,
      "note": "Illustrative QR only. It is not scannable and cannot initiate a real payment."
    }
  }
}
```

For `CREDIT_CARD` / `DEBIT_CARD` the `upi` block is replaced by:

```json
"card": {
  "acceptedNetworks": ["VISA", "MASTERCARD", "RUPAY"],
  "cardholderNameRequired": true,
  "credentialsStored": false,
  "note": "Enter any dummy card details. Nothing is sent to a card network and nothing is stored."
}
```

The `qrPayload` is a plain placeholder string, not a UPI deep link — the frontend may render a
decorative QR from it; it cannot initiate a payment.

### 3.2 Simulate the transaction (server-controlled outcome)

```http
POST /api/v1/payments/:id/simulate
Authorization: Bearer <citizen token>
Content-Type: application/json

{ "outcome": "SUCCESS" }
```

Body may be empty (`{}`) — the server then applies its configured default. `outcome` is a
**request**, not an assertion: it is honored only while demo payments are enabled and
`DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME` permits it (default: allowed outside `NODE_ENV=production`).
The status written to the database is always the server's decision, returned as `outcomeSource`.

`200 OK` (success):

```json
{
  "success": true,
  "outcome": "SUCCESS",
  "outcomeSource": "client-request",
  "idempotent": false,
  "payment": { "...": "...", "status": "SUCCESS", "completedAt": "2026-10-26T09:13:10.004Z" },
  "receipt": {
    "receiptNumber": "RCPT-DEMO-PAY-2026-9F3A1C7B2D",
    "reference": "DEMO-PAY-2026-9F3A1C7B2D",
    "challanId": "9f0f6a0e-...",
    "challanNumber": "CH-2026-A1B2C3D4",
    "vehicleRegistrationNumber": "KA01AB1234",
    "violationType": "NO_HELMET",
    "payerName": "Asha Rao",
    "amount": "500.00",
    "currency": "INR",
    "method": "UPI",
    "status": "SUCCESS",
    "paidAt": "2026-10-26T09:13:10.004Z",
    "challanPaidAt": "2026-10-26T09:13:10.004Z",
    "isDemo": true,
    "demoLabel": "DEMO — NO REAL MONEY TRANSFERRED"
  }
}
```

Replaying the same call on an already settled payment returns `200`, `idempotent: true` and the
unchanged record (the timestamp does not move). A `FAILED` or `PENDING` payment returns
`receipt: null`.

`409 Conflict` when the outcome cannot be applied (e.g. the challan was already paid by another
attempt). The payment is then stored as `FAILED` with `failureReason: CHALLAN_ALREADY_PAID`.

`403 DEMO_DISABLED` when `DEMO_PAYMENTS_ENABLED=false`.

### 3.3 Read payment / history / receipt

```http
GET /api/v1/payments/:id
GET /api/v1/payments/reference/DEMO-PAY-2026-9F3A1C7B2D
GET /api/v1/payments/my?status=SUCCESS&limit=20
GET /api/v1/payments/:id/receipt
```

Receipt before success:

```json
{ "success": false, "code": "RECEIPT_NOT_AVAILABLE", "message": "Receipt is only available for successful payments (current status: PENDING)" }
```

### 3.4 Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | — (`errors` map) | Validation failure (bad UUID, unknown method, unexpected keys) |
| 401 | — | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Not your challan/payment, or wrong role |
| 403 | `DEMO_DISABLED` | Demo payment simulation turned off |
| 404 | `CHALLAN_NOT_FOUND` / `PAYMENT_NOT_FOUND` | Unknown id |
| 409 | `ALREADY_PAID` | Challan already settled |
| 409 | `CHALLAN_NOT_PAYABLE` | Challan `CANCELLED` / `DISPUTED` / `CLOSED` |
| 409 | `IDEMPOTENCY_MISMATCH` | Key reused for a different challan/method |
| 409 | `RECEIPT_NOT_AVAILABLE` | Receipt requested for non-SUCCESS payment |
| 409 | `CONCURRENCY_CONFLICT` | Too much contention, request may be retried |

---

## 4. Payment lifecycle

```
             create (amount snapshot from DB)
   ┌──────────────────────────────────────────┐
   │ Challan: ISSUED / PENDING_PAYMENT        │
   │ Payment: PENDING  ───────────────────────┼──► challan untouched
   └──────────────────────────────────────────┘
                    │
        simulate (server decides outcome)
        ┌───────────┼─────────────┐
        ▼           ▼             ▼
     SUCCESS      FAILED       PENDING
        │           │             │
 Payment SUCCESS,  Payment FAILED,  no change;
 challan PAID +    challan stays    a later simulate
 paidAt set        unpaid           can still settle it
        │
   receipt only here
```

Guarantees enforced in code and in the database:

1. **Creating never pays.** Only the simulate step writes `Challan.status = PAID`.
2. **Amount is server-derived.** `challan.fineAmount` is read inside the transaction.
3. **One success per challan.** Enforced by a partial unique index; concurrent attempts are
   resolved by `SERIALIZABLE` transactions (retried on `P2034`/`P2028`) and by that index.
4. **No silent overwrite.** A settled (`SUCCESS`/`FAILED`) payment is returned unchanged on replay;
   a `SUCCESS` row is never rewritten to `FAILED`/`PENDING`, and the challan never regresses.
5. **Atomicity.** Payment + challan updates happen in one transaction; a failure rolls both back
   (test 13 proves this).
6. **Retries are safe.** `idempotencyKey` (or an existing PENDING attempt for the same
   challan+method) returns the same payment instead of a duplicate row.

---

## 5. Security & demo-mode controls

| Requirement | How it is met |
|---|---|
| No credentials stored/logged | The zod schema is `.strict()` and rejects `cardNumber`, `cvv`, `expiry`, `upiPin`; `Payment` has no such columns; controllers never log request bodies. A dummy `upiId` is validated, masked in the response (`de*******@okhdfc`) and **not persisted**. |
| Client can't declare success | `outcome` is only a request. The server decides, records `outcomeSource`, and holds the only code path that writes `Challan.status = PAID`. |
| No unrestricted "mark paid" endpoint | Only `/payments/:id/simulate` on a specific pending payment of your own challan; role-limited to CITIZEN/ADMIN; disabled entirely by `DEMO_PAYMENTS_ENABLED=false`. |
| Ownership | Derived from `challan.vehicle.ownerId` / `payment.citizenId` server-side — never from a client-supplied user id. |
| Demo disabled in production | `DEMO_PAYMENTS_ENABLED=false` disables creation *and* simulation. `DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME` defaults to `false` when `NODE_ENV=production`, so only the server-configured outcome applies. |
| No fake claims of real transfer | Every payment/receipt/checkout carries `isDemo: true` and/or `demoLabel: "DEMO — NO REAL MONEY TRANSFERRED"`; `checkout.scannable: false`. |

### Environment variables

```env
# Demo payment module
DEMO_PAYMENTS_ENABLED=true                 # false disables create + simulate entirely
DEMO_PAYMENT_DEFAULT_OUTCOME=SUCCESS        # SUCCESS | FAILED | PENDING (used when the client sends nothing)
DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME=true      # defaults to (NODE_ENV !== 'production')
PAYMENT_CONFLICT_RETRY_MS=10000              # serialization-retry budget in ms
```

See [`.env.example`](../.env.example). No secrets are required — this module contacts no gateway.

---

## 6. Tests

Framework: Node's built-in `node:test` (no new dependency). The suite boots the real Express app on
an ephemeral port, mints real JWTs and uses the configured database; fixtures are removed in an
`after` hook.

```bash
npm test                 # all tests
npm run test:payments    # payment module only
```

| # | Requirement | Test |
|---|---|---|
| 1 | Successful demo payment | `1. successful demo payment marks the challan paid and yields a receipt` |
| 2 | Failed demo payment | `2. failed demo payment leaves the challan unpaid...` |
| 3 | Pending payment | `3. pending demo payment keeps challan unpaid...` |
| 4 | Already-paid challan | `4. paying an already-paid challan is rejected with 409` |
| 5 | Another citizen's challan | `5. a citizen cannot pay another citizen's challan` |
| 6 | Invalid/nonexistent challan | `6. invalid or nonexistent challan ids are rejected` |
| 7 | Duplicate request / idempotency | `7.`, `7b.` |
| 8 | Concurrent attempts | `8.`, `8b.` (parallel simulations: exactly one settles) |
| 9 | Invalid payment method | `9.`, plus `9b.` amount-never-from-client |
| 10 | Receipt before success | `10. receipt is refused until the payment succeeds` |
| 11 | Unauthorized simulation | `11.` (anonymous 401, foreign 403, wrong role 403, demo disabled 403), `11b.`, `11c.` |
| 12 | Credentials not stored | `12. payment credentials are rejected and never stored` |
| 13 | DB consistency on failure | `13. a failure inside the simulation transaction rolls back completely` |

Result of the last run: **18/18 passing**.

---

## 7. Postman

Import [`payments.postman_collection.json`](./payments.postman_collection.json).

1. Set collection variables `baseUrl` (default `http://localhost:5000`) and `token`.
2. Run **Auth → Login** (citizen) and paste the returned `token` into the collection variable.
3. Run **Challans → My challans**, copy an `id` where `status` is `ISSUED`, set variable `challanId`.
4. **Payments → Create payment** → stores `paymentId`.
5. **Payments → Simulate (SUCCESS / FAILED / PENDING)** → see the receipt in the response.
6. **Payments → Get receipt** (fails with 409 before a success).

Useful manual runs:

```bash
# login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"citizen@example.com","password":"YourPassword"}'

# create
curl -X POST http://localhost:5000/api/v1/payments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"challanId":"<uuid>","method":"UPI","upiId":"demo@okhdfc"}'

# simulate
curl -X POST http://localhost:5000/api/v1/payments/<paymentId>/simulate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"SUCCESS"}'
```

---

## 8. Files created / modified

Created:

- `prisma/migrations/20261026000000_add_payment_module/migration.sql`
- `src/services/payment.service.js`
- `src/controllers/payment.controller.js`
- `src/routes/payment.routes.js`
- `src/middleware/paymentValidation.js`
- `tests/payment.test.js`
- `docs/PAYMENTS.md`, `docs/payments.postman_collection.json`
- `.env.example`

Modified:

- `prisma/schema.prisma` — `Payment` model, `PaymentMethod`/`PaymentStatus` enums, back-relations on
  `User` and `Challan` (nothing else changed)
- `src/app.js` — mounts `payment.routes` at `/api/v1`
- `package.json` — real `test` / `test:payments` scripts (previously a placeholder)

Not touched: React frontend, AI detection pipeline, existing challan/grievance/auth logic.

---

## 9. Applying the change elsewhere

```bash
npx prisma migrate deploy   # applies 20261026000000_add_payment_module
npx prisma generate
npm test
```
