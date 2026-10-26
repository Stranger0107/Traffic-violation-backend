/**
 * Demo payment module tests.
 *
 * Framework: Node's built-in `node:test` runner (no new dependencies). The app is started
 * on an ephemeral port and exercised over real HTTP with real JWTs and the real database.
 *
 * Run: npm test   (or: node --test tests/)
 *
 * Every fixture is created with a unique "paytest.<timestamp>." email prefix and removed in
 * the `after` hook, so the development database is left as it was found.
 */

require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../src/config/prisma");
const app = require("../src/app");

const RUN_ID = `${Date.now()}.${crypto.randomBytes(3).toString("hex")}`;
const createdUserIds = [];
let server;
let baseUrl;

// ── fixtures ──────────────────────────────────────────────────────────────

const uniq = () => crypto.randomBytes(4).toString("hex").toUpperCase();

async function makeUser(role = "CITIZEN", label = "citizen") {
    const user = await prisma.user.create({
        data: {
            fullName: `Pay Test ${label}`,
            email: `paytest.${RUN_ID}.${label}.${uniq()}@example.com`,
            password: "not-a-real-hash",
            role
        }
    });
    createdUserIds.push(user.id);
    return user;
}

async function makeVehicle(ownerId) {
    return prisma.vehicle.create({
        data: { registrationNumber: `PYTEST${uniq()}`, ownerId }
    });
}

async function makeChallan(vehicleId, { status = "ISSUED", fineAmount = 500 } = {}) {
    const violation = await prisma.violation.create({
        data: {
            modelEventId: crypto.randomUUID(),
            vehicleId,
            violationType: "NO_HELMET",
            detectedPlate: "KA01AB1234",
            normalizedPlate: "KA01AB1234",
            ocrConfidence: 0.91,
            detectedAt: new Date(),
            cameraId: "CAM-TEST",
            areaCode: "AREA-TEST",
            modelVersion: "test-1.0.0",
            rawModelPayload: { source: "payment-tests" },
            recommendation: "AUTO_VERIFY",
            status: "CHALLAN_GENERATED"
        }
    });

    return prisma.challan.create({
        data: {
            challanNumber: `CH-TEST-${uniq()}`,
            vehicleId,
            violationId: violation.id,
            status,
            fineAmount,
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
    });
}

async function makePayableChallanFor(user) {
    const vehicle = await makeVehicle(user.id);
    return makeChallan(vehicle.id);
}

const tokenFor = (user) => jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });

async function api(path, { method = "GET", token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    return { status: res.status, body: json };
}

const createPayment = (token, challanId, extra = {}) =>
    api("/api/v1/payments", {
        method: "POST",
        token,
        body: { challanId, method: "UPI", ...extra }
    });

const simulate = (token, paymentId, outcome) =>
    api(`/api/v1/payments/${paymentId}/simulate`, {
        method: "POST",
        token,
        body: outcome ? { outcome } : {}
    });

// ── lifecycle ─────────────────────────────────────────────────────────────

test.before(async () => {
    assert.ok(process.env.JWT_SECRET, "JWT_SECRET must be set to run payment tests");
    // The module is opt-in; tests exercise the enabled configuration explicitly
    // (test 14 covers the fail-closed behaviour when these are absent).
    process.env.DEMO_PAYMENTS_ENABLED = "true";
    process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME = "true";
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (createdUserIds.length) {
        await prisma.payment.deleteMany({ where: { citizenId: { in: createdUserIds } } });
        const vehicles = await prisma.vehicle.findMany({
            where: { ownerId: { in: createdUserIds } },
            select: { id: true }
        });
        const vehicleIds = vehicles.map((v) => v.id);
        if (vehicleIds.length) {
            const challans = await prisma.challan.findMany({
                where: { vehicleId: { in: vehicleIds } },
                select: { id: true }
            });
            const challanIds = challans.map((c) => c.id);
            if (challanIds.length) {
                await prisma.grievance.deleteMany({ where: { challanId: { in: challanIds } } });
                await prisma.refund.deleteMany({ where: { challanId: { in: challanIds } } });
            }
            await prisma.challan.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
            await prisma.violation.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
            await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
        }
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
});

// ── 1. successful demo payment ────────────────────────────────────────────

test("1. successful demo payment marks the challan paid and yields a receipt", async () => {
    const citizen = await makeUser("CITIZEN", "success");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const created = await createPayment(token, challan.id, { upiId: "demo.user@okhdfc" });
    assert.equal(created.status, 201);
    assert.equal(created.body.payment.status, "PENDING");
    assert.equal(created.body.payment.amount, "500.00");
    assert.equal(created.body.payment.currency, "INR");
    assert.equal(created.body.payment.method, "UPI");
    assert.match(created.body.payment.reference, /^DEMO-PAY-\d{4}-[A-F0-9]{10}$/);
    // QR payload is illustrative and explicitly non-scannable.
    assert.equal(created.body.checkout.scannable, false);
    assert.match(created.body.checkout.upi.qrPayload, /NOT-A-REAL-PAYMENT/);
    // UPI handle is masked in the response.
    assert.equal(created.body.checkout.upi.vpaMasked, "de*******@okhdfc");

    // Creating a payment must not pay the challan.
    let dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "ISSUED");
    assert.equal(dbChallan.paidAt, null);

    const simulated = await simulate(token, created.body.payment.id, "SUCCESS");
    assert.equal(simulated.status, 200);
    assert.equal(simulated.body.outcome, "SUCCESS");
    assert.equal(simulated.body.payment.status, "SUCCESS");
    assert.ok(simulated.body.payment.completedAt);
    assert.ok(simulated.body.receipt);
    assert.equal(simulated.body.receipt.demoLabel, "DEMO — NO REAL MONEY TRANSFERRED");
    assert.equal(simulated.body.receipt.amount, "500.00");
    assert.equal(simulated.body.receipt.challanNumber, challan.challanNumber);

    dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "PAID");
    assert.ok(dbChallan.paidAt, "challan.paidAt must be set on success");

    const receipt = await api(`/api/v1/payments/${created.body.payment.id}/receipt`, { token });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.receipt.status, "SUCCESS");
});

// ── 2. failed demo payment ────────────────────────────────────────────────

test("2. failed demo payment leaves the challan unpaid and produces no receipt", async () => {
    const citizen = await makeUser("CITIZEN", "failed");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const created = await createPayment(token, challan.id);
    const simulated = await simulate(token, created.body.payment.id, "FAILED");
    assert.equal(simulated.status, 200);
    assert.equal(simulated.body.payment.status, "FAILED");
    assert.equal(simulated.body.payment.failureReason, "DEMO_SIMULATED_FAILURE");
    assert.equal(simulated.body.receipt, null);

    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "ISSUED");
    assert.equal(dbChallan.paidAt, null);

    const receipt = await api(`/api/v1/payments/${created.body.payment.id}/receipt`, { token });
    assert.equal(receipt.status, 409);
    assert.equal(receipt.body.code, "RECEIPT_NOT_AVAILABLE");
});

// ── 3. pending demo payment ───────────────────────────────────────────────

test("3. pending demo payment keeps challan unpaid and payment PENDING", async () => {
    const citizen = await makeUser("CITIZEN", "pending");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const created = await createPayment(token, challan.id, { method: "DEBIT_CARD" });
    assert.equal(created.body.payment.method, "DEBIT_CARD");

    const simulated = await simulate(token, created.body.payment.id, "PENDING");
    assert.equal(simulated.status, 200);
    assert.equal(simulated.body.payment.status, "PENDING");
    assert.equal(simulated.body.payment.completedAt, null);
    assert.equal(simulated.body.receipt, null);

    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "ISSUED");
    assert.equal(dbChallan.paidAt, null);
});

// ── 4. already-paid challan ───────────────────────────────────────────────

test("4. paying an already-paid challan is rejected with 409", async () => {
    const citizen = await makeUser("CITIZEN", "already-paid");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const first = await createPayment(token, challan.id);
    const paid = await simulate(token, first.body.payment.id, "SUCCESS");
    assert.equal(paid.body.payment.status, "SUCCESS");

    // A brand new attempt must be refused, with a different method to bypass reuse.
    const second = await createPayment(token, challan.id, { method: "CREDIT_CARD" });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, "ALREADY_PAID");

    const successCount = await prisma.payment.count({
        where: { challanId: challan.id, status: "SUCCESS" }
    });
    assert.equal(successCount, 1);
});

// ── 5. another citizen's challan ──────────────────────────────────────────

test("5. a citizen cannot pay another citizen's challan", async () => {
    const owner = await makeUser("CITIZEN", "owner");
    const intruder = await makeUser("CITIZEN", "intruder");
    const challan = await makePayableChallanFor(owner);

    const attempt = await createPayment(tokenFor(intruder), challan.id);
    assert.equal(attempt.status, 403);
    assert.equal(attempt.body.code, "FORBIDDEN");

    const count = await prisma.payment.count({ where: { challanId: challan.id } });
    assert.equal(count, 0, "no payment row may be created for a foreign challan");

    // And the intruder cannot read the owner's payment either.
    const ownerPayment = await createPayment(tokenFor(owner), challan.id);
    const read = await api(`/api/v1/payments/${ownerPayment.body.payment.id}`, {
        token: tokenFor(intruder)
    });
    assert.equal(read.status, 403);
});

// ── 6. invalid / nonexistent challan ──────────────────────────────────────

test("6. invalid or nonexistent challan ids are rejected", async () => {
    const citizen = await makeUser("CITIZEN", "missing");
    const token = tokenFor(citizen);

    const notFound = await createPayment(token, crypto.randomUUID());
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.code, "CHALLAN_NOT_FOUND");

    const malformed = await createPayment(token, "not-a-uuid");
    assert.equal(malformed.status, 400);
    assert.ok(malformed.body.errors.challanId);

    const missingPayment = await api(`/api/v1/payments/${crypto.randomUUID()}`, { token });
    assert.equal(missingPayment.status, 404);
});

// ── 7. duplicate request / idempotency ────────────────────────────────────

test("7. duplicate creation and repeated simulation are idempotent", async () => {
    const citizen = await makeUser("CITIZEN", "idempotent");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const key = `idem-${uniq()}-${uniq()}`;
    const first = await createPayment(token, challan.id, { idempotencyKey: key });
    assert.equal(first.status, 201);

    const replay = await createPayment(token, challan.id, { idempotencyKey: key });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(replay.body.payment.id, first.body.payment.id);

    assert.equal(
        await prisma.payment.count({ where: { challanId: challan.id } }),
        1,
        "a retried request must not create a second payment row"
    );

    const paid = await simulate(token, first.body.payment.id, "SUCCESS");
    assert.equal(paid.body.payment.status, "SUCCESS");
    const paidAt = paid.body.payment.completedAt;

    const again = await simulate(token, first.body.payment.id, "SUCCESS");
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotent, true);
    assert.equal(again.body.payment.completedAt, paidAt, "completedAt must not shift on replay");

    // Replaying a simulation must never regress the challan.
    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "PAID");

    // A different challan with the same key is a conflict, not a silent cross-write.
    const other = await makePayableChallanFor(citizen);
    const mismatch = await createPayment(token, other.id, { idempotencyKey: key });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.code, "IDEMPOTENCY_MISMATCH");
});

test("7b. a pending attempt is reused instead of duplicated", async () => {
    const citizen = await makeUser("CITIZEN", "reuse");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const a = await createPayment(token, challan.id);
    const b = await createPayment(token, challan.id);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.idempotent, true);
    assert.equal(a.body.payment.id, b.body.payment.id);
});

// ── 8. concurrent payment attempts ────────────────────────────────────────

test("8. concurrent simulations on one challan produce exactly one successful payment", async () => {
    const citizen = await makeUser("CITIZEN", "concurrent");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    // Two different methods => two separate pending payments for the same challan.
    const p1 = await createPayment(token, challan.id, { method: "UPI" });
    const p2 = await createPayment(token, challan.id, { method: "CREDIT_CARD" });
    assert.notEqual(p1.body.payment.id, p2.body.payment.id);

    const results = await Promise.all([
        simulate(token, p1.body.payment.id, "SUCCESS"),
        simulate(token, p2.body.payment.id, "SUCCESS")
    ]);

    const successes = results.filter((r) => r.status === 200 && r.body.payment?.status === "SUCCESS");
    assert.equal(successes.length, 1, `expected exactly one success, got ${JSON.stringify(results.map((r) => [r.status, r.body?.payment?.status]))}`);

    const dbSuccesses = await prisma.payment.count({ where: { challanId: challan.id, status: "SUCCESS" } });
    assert.equal(dbSuccesses, 1);

    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "PAID");
});

test("8b. duplicated simulation requests in parallel stay single-success", async () => {
    const citizen = await makeUser("CITIZEN", "concurrent-same");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);

    const results = await Promise.all(
        Array.from({ length: 5 }, () => simulate(token, payment.body.payment.id, "SUCCESS"))
    );

    assert.ok(
        results.every((r) => r.status === 200),
        `all replays must answer 200, got ${JSON.stringify(
            results.map((r) => [r.status, r.body?.code || r.body?.payment?.status])
        )}`
    );
    const changed = results.filter((r) => r.body.idempotent === false);
    assert.equal(changed.length, 1, "only one request may actually settle the payment");

    const dbPayment = await prisma.payment.findUnique({ where: { id: payment.body.payment.id } });
    assert.equal(dbPayment.status, "SUCCESS");
    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "PAID");
});

// ── 9. invalid payment method ─────────────────────────────────────────────

test("9. invalid payment method is rejected and no payment is created", async () => {
    const citizen = await makeUser("CITIZEN", "badmethod");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const res = await createPayment(token, challan.id, { method: "BITCOIN" });
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.method);

    assert.equal(await prisma.payment.count({ where: { challanId: challan.id } }), 0);
});

test("9b. amount is taken from the database, never from the client", async () => {
    const citizen = await makeUser("CITIZEN", "amount");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const res = await api("/api/v1/payments", {
        method: "POST",
        token,
        body: { challanId: challan.id, method: "UPI", amount: 1, status: "SUCCESS" }
    });
    // Unknown/strict keys are rejected outright rather than silently ignored.
    assert.equal(res.status, 400);

    const ok = await createPayment(token, challan.id);
    assert.equal(ok.body.payment.amount, "500.00");
    const dbPayment = await prisma.payment.findUnique({ where: { id: ok.body.payment.id } });
    assert.equal(Number(dbPayment.amount), 500);
    assert.equal(dbPayment.status, "PENDING");
});

// ── 10. receipt before success ────────────────────────────────────────────

test("10. receipt is refused until the payment succeeds", async () => {
    const citizen = await makeUser("CITIZEN", "receipt-gate");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);

    const before = await api(`/api/v1/payments/${payment.body.payment.id}/receipt`, { token });
    assert.equal(before.status, 409);
    assert.equal(before.body.code, "RECEIPT_NOT_AVAILABLE");
    assert.equal(before.body.receipt, undefined);
});

// ── 11. unauthorized simulation attempts ──────────────────────────────────

test("11. simulation requires authentication, ownership and enabled demo mode", async () => {
    const owner = await makeUser("CITIZEN", "sim-owner");
    const intruder = await makeUser("CITIZEN", "sim-intruder");
    const officer = await makeUser("TRAFFIC_OFFICER", "sim-officer");
    const challan = await makePayableChallanFor(owner);
    const payment = await createPayment(tokenFor(owner), challan.id);

    const anonymous = await api(`/api/v1/payments/${payment.body.payment.id}/simulate`, {
        method: "POST",
        body: { outcome: "SUCCESS" }
    });
    assert.equal(anonymous.status, 401);

    const foreign = await simulate(tokenFor(intruder), payment.body.payment.id, "SUCCESS");
    assert.equal(foreign.status, 403);

    const wrongRole = await simulate(tokenFor(officer), payment.body.payment.id, "SUCCESS");
    assert.equal(wrongRole.status, 403);

    // Nothing above may have settled the payment.
    const dbPayment = await prisma.payment.findUnique({ where: { id: payment.body.payment.id } });
    assert.equal(dbPayment.status, "PENDING");

    // Demo mode disabled => simulation is refused even for the owner.
    const previous = process.env.DEMO_PAYMENTS_ENABLED;
    process.env.DEMO_PAYMENTS_ENABLED = "false";
    try {
        const disabled = await simulate(tokenFor(owner), payment.body.payment.id, "SUCCESS");
        assert.equal(disabled.status, 403);
        assert.equal(disabled.body.code, "DEMO_DISABLED");
    } finally {
        if (previous === undefined) delete process.env.DEMO_PAYMENTS_ENABLED;
        else process.env.DEMO_PAYMENTS_ENABLED = previous;
    }

    const stillPending = await prisma.payment.findUnique({ where: { id: payment.body.payment.id } });
    assert.equal(stillPending.status, "PENDING");
});

test("11b. server config decides the outcome when the client sends none", async () => {
    const citizen = await makeUser("CITIZEN", "outcome-policy");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);

    const previous = process.env.DEMO_PAYMENT_DEFAULT_OUTCOME;
    process.env.DEMO_PAYMENT_DEFAULT_OUTCOME = "FAILED";
    try {
        const res = await simulate(token, payment.body.payment.id);
        assert.equal(res.status, 200);
        assert.equal(res.body.outcome, "FAILED");
        assert.equal(res.body.outcomeSource, "server-config");
    } finally {
        if (previous === undefined) delete process.env.DEMO_PAYMENT_DEFAULT_OUTCOME;
        else process.env.DEMO_PAYMENT_DEFAULT_OUTCOME = previous;
    }
});

test("11c. payment history is scoped to the caller", async () => {
    const a = await makeUser("CITIZEN", "history-a");
    const b = await makeUser("CITIZEN", "history-b");
    const challan = await makePayableChallanFor(a);
    await createPayment(tokenFor(a), challan.id);

    const mine = await api("/api/v1/payments/my", { token: tokenFor(a) });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.payments.length, 1);

    const others = await api("/api/v1/payments/my", { token: tokenFor(b) });
    assert.equal(others.body.payments.length, 0);

    // Admin listing still works through the existing role rules.
    const admin = await makeUser("ADMIN", "history-admin");
    const all = await api("/api/v1/admin/payments", { token: tokenFor(admin) });
    assert.equal(all.status, 200);
    assert.ok(all.body.payments.some((p) => p.citizenId === a.id));

    const forbidden = await api("/api/v1/admin/payments", { token: tokenFor(b) });
    assert.equal(forbidden.status, 403);
});

// ── 12. no credentials stored ─────────────────────────────────────────────

test("12. payment credentials are rejected and never stored", async () => {
    const citizen = await makeUser("CITIZEN", "no-credentials");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const withCard = await api("/api/v1/payments", {
        method: "POST",
        token,
        body: {
            challanId: challan.id,
            method: "CREDIT_CARD",
            cardNumber: "4111111111111111",
            cvv: "123",
            expiry: "12/30",
            upiPin: "1234"
        }
    });
    assert.equal(withCard.status, 400, "cards/CVV/expiry/UPI PIN must be rejected, not accepted");
    // The rejection names the offending keys (names only, never values) so the cause is obvious.
    const rejection = JSON.stringify(withCard.body);
    for (const key of ["cardNumber", "cvv", "expiry", "upiPin"]) {
        assert.ok(rejection.includes(key), `rejection should name ${key}: ${rejection}`);
    }
    assert.ok(!rejection.includes("4111111111111111"), "the card value itself must not be echoed");

    const created = await createPayment(token, challan.id, { method: "UPI" });
    assert.equal(created.status, 201);

    // No column in the payment table can hold credentials.
    const columns = await prisma.$queryRaw`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'Payment'
    `;
    const names = columns.map((c) => c.column_name.toLowerCase()).join(",");
    for (const forbidden of ["card", "cvv", "cvc", "expiry", "pin", "upiid"]) {
        assert.ok(!names.includes(forbidden), `Payment must not have a ${forbidden} column (found: ${names})`);
    }

    const row = await prisma.payment.findUnique({ where: { id: created.body.payment.id } });
    const serialized = JSON.stringify(row);
    for (const secret of ["4111111111111111", "1234", "12/30", "123"]) {
        assert.ok(!serialized.includes(`"${secret}"`), `stored row must not contain ${secret}`);
    }
    assert.ok(!serialized.includes("okhdfc"), "dummy UPI handle must not be persisted");

    // And the create response does not echo anything usable either.
    assert.ok(!JSON.stringify(created.body).includes("4111111111111111"));
});

// ── 13. database consistency when the simulation transaction fails ────────

test("13. a failure inside the simulation transaction rolls back completely", async () => {
    const citizen = await makeUser("CITIZEN", "rollback");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);

    // Force the last write of the transaction (challan update) to fail, then check that the
    // payment update that ran before it was rolled back too.
    const originalTransaction = prisma.$transaction.bind(prisma);
    let patched = false;

    prisma.$transaction = async (fn, options) =>
        originalTransaction(async (tx) => {
            const originalUpdate = tx.challan.update.bind(tx.challan);
            tx.challan.update = async () => {
                throw new Error("forced failure for rollback test");
            };
            patched = tx.challan.update !== originalUpdate;
            return fn(tx);
        }, options);

    let res;
    try {
        res = await simulate(token, payment.body.payment.id, "SUCCESS");
    } finally {
        prisma.$transaction = originalTransaction;
    }

    assert.ok(patched, "test harness could not intercept the transaction client");
    assert.equal(res.status, 500);

    const dbPayment = await prisma.payment.findUnique({ where: { id: payment.body.payment.id } });
    assert.equal(dbPayment.status, "PENDING", "payment must not be left SUCCESS after a rollback");
    assert.equal(dbPayment.completedAt, null);

    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "ISSUED");
    assert.equal(dbChallan.paidAt, null);

    // The retry then behaves exactly like a first attempt.
    const retry = await simulate(token, payment.body.payment.id, "SUCCESS");
    assert.equal(retry.status, 200);
    assert.equal(retry.body.payment.status, "SUCCESS");
});

// ── 14. fail-closed defaults (opt-in demo mode) ───────────────────────────

test("14. with the demo flags unset, create and simulate fail closed", async () => {
    const citizen = await makeUser("CITIZEN", "fail-closed");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);
    assert.equal(payment.status, 201);

    const enabled = process.env.DEMO_PAYMENTS_ENABLED;
    const allowClient = process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME;
    delete process.env.DEMO_PAYMENTS_ENABLED;
    delete process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME;
    try {
        const createAttempt = await createPayment(token, (await makePayableChallanFor(citizen)).id);
        assert.equal(createAttempt.status, 403);
        assert.equal(createAttempt.body.code, "DEMO_DISABLED");

        const simAttempt = await simulate(token, payment.body.payment.id, "SUCCESS");
        assert.equal(simAttempt.status, 403);
        assert.equal(simAttempt.body.code, "DEMO_DISABLED");
    } finally {
        process.env.DEMO_PAYMENTS_ENABLED = enabled;
        process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME = allowClient;
    }

    const dbPayment = await prisma.payment.findUnique({ where: { id: payment.body.payment.id } });
    assert.equal(dbPayment.status, "PENDING");
    // ...and the module works again once enabled.
    const nowWorks = await simulate(token, payment.body.payment.id, "SUCCESS");
    assert.equal(nowWorks.status, 200);
});

test("14b. without explicit client-outcome permission the server outcome wins", async () => {
    const citizen = await makeUser("CITIZEN", "server-outcome");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);

    const previous = process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME;
    process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME = "false";
    try {
        // Client asks for FAILED, server default is SUCCESS.
        const res = await simulate(token, payment.body.payment.id, "FAILED");
        assert.equal(res.status, 200);
        assert.equal(res.body.outcomeSource, "server-config");
        assert.equal(res.body.payment.status, "SUCCESS");
    } finally {
        process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME = previous;
    }
});

// ── 15. challan state gating ──────────────────────────────────────────────

test("15. only payable challan statuses can be paid", async () => {
    const citizen = await makeUser("CITIZEN", "status-gate");
    const token = tokenFor(citizen);
    const vehicle = await makeVehicle(citizen.id);

    for (const status of ["CANCELLED", "DISPUTED", "CLOSED"]) {
        const challan = await makeChallan(vehicle.id, { status });
        const res = await createPayment(token, challan.id);
        assert.equal(res.status, 409, `${status} must not be payable`);
        assert.equal(res.body.code, "CHALLAN_NOT_PAYABLE");
    }

    const payable = await makeChallan(vehicle.id, { status: "PENDING_PAYMENT" });
    const ok = await createPayment(token, payable.id);
    assert.equal(ok.status, 201);
});

// ── 16. route/schema hardening ────────────────────────────────────────────

test("16. malformed ids, unknown payments and bad bodies are rejected", async () => {
    const citizen = await makeUser("CITIZEN", "hardening");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);

    const unknown = await simulate(token, crypto.randomUUID(), "SUCCESS");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, "PAYMENT_NOT_FOUND");

    const malformed = await simulate(token, "not-a-uuid", "SUCCESS");
    assert.equal(malformed.status, 400);

    const badOutcome = await simulate(token, payment.body.payment.id, "PAID");
    assert.equal(badOutcome.status, 400);

    // An arbitrary success-ish flag must not be accepted as an outcome.
    const successFlag = await api(`/api/v1/payments/${payment.body.payment.id}/simulate`, {
        method: "POST",
        token,
        body: { success: true }
    });
    assert.equal(successFlag.status, 400);

    const upiOnCard = await createPayment(token, challan.id, { method: "CREDIT_CARD", upiId: "x@y" });
    assert.equal(upiOnCard.status, 400);
});

// ── 17. every read path is ownership checked ──────────────────────────────

test("17. cross-citizen reads are refused on every route", async () => {
    const owner = await makeUser("CITIZEN", "read-owner");
    const intruder = await makeUser("CITIZEN", "read-intruder");
    const admin = await makeUser("ADMIN", "read-admin");
    const challan = await makePayableChallanFor(owner);
    const payment = await createPayment(tokenFor(owner), challan.id);
    const { id, reference } = payment.body.payment;

    for (const path of [
        `/api/v1/payments/${id}`,
        `/api/v1/payments/reference/${reference}`,
        `/api/v1/payments/${id}/receipt`
    ]) {
        const res = await api(path, { token: tokenFor(intruder) });
        assert.equal(res.status, 403, `${path} leaked data or wrong status`);
    }

    // Admin is allowed to read; owner obviously is.
    assert.equal((await api(`/api/v1/payments/${id}`, { token: tokenFor(admin) })).status, 200);
    assert.equal((await api(`/api/v1/payments/reference/${reference}`, { token: tokenFor(owner) })).status, 200);
});

test("17b. an admin may operate another citizen's demo payment", async () => {
    const citizen = await makeUser("CITIZEN", "admin-sim");
    const admin = await makeUser("ADMIN", "admin-sim-operator");
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(tokenFor(citizen), challan.id);

    const res = await simulate(tokenFor(admin), payment.body.payment.id, "SUCCESS");
    assert.equal(res.status, 200);
    assert.equal(res.body.payment.status, "SUCCESS");

    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "PAID");
});

// ── 18. retry semantics of pending and failed payments ────────────────────

test("18. pending settles later; failed is terminal but recoverable with a new payment", async () => {
    const citizen = await makeUser("CITIZEN", "retry-semantics");
    const token = tokenFor(citizen);

    // PENDING -> still settleable afterwards.
    const pendingChallan = await makePayableChallanFor(citizen);
    const pending = await createPayment(token, pendingChallan.id);
    const stillPending = await simulate(token, pending.body.payment.id, "PENDING");
    assert.equal(stillPending.body.payment.status, "PENDING");
    assert.equal(
        (await prisma.challan.findUnique({ where: { id: pendingChallan.id } })).status,
        "ISSUED"
    );
    const settled = await simulate(token, pending.body.payment.id, "SUCCESS");
    assert.equal(settled.body.payment.status, "SUCCESS");

    // FAILED -> replaying never resurrects or settles it.
    const failedChallan = await makePayableChallanFor(citizen);
    const failedPayment = await createPayment(token, failedChallan.id);
    await simulate(token, failedPayment.body.payment.id, "FAILED");

    const replay = await simulate(token, failedPayment.body.payment.id, "SUCCESS");
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(replay.body.payment.status, "FAILED");
    assert.equal(replay.body.receipt, null);
    assert.equal(
        (await prisma.challan.findUnique({ where: { id: failedChallan.id } })).status,
        "ISSUED",
        "a failed payment must not settle the challan"
    );

    // A fresh payment on the same challan is allowed and can succeed.
    const second = await createPayment(token, failedChallan.id);
    assert.equal(second.status, 201);
    assert.notEqual(second.body.payment.id, failedPayment.body.payment.id);
    const success = await simulate(token, second.body.payment.id, "SUCCESS");
    assert.equal(success.body.payment.status, "SUCCESS");
});

// ── 19. amount snapshot is immutable ──────────────────────────────────────

test("19. the stored amount is a snapshot and ignores later fine changes", async () => {
    const citizen = await makeUser("CITIZEN", "snapshot");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const payment = await createPayment(token, challan.id);
    assert.equal(payment.body.payment.amount, "500.00");

    await prisma.challan.update({ where: { id: challan.id }, data: { fineAmount: 9999 } });

    const reread = await api(`/api/v1/payments/${payment.body.payment.id}`, { token });
    assert.equal(reread.body.payment.amount, "500.00");

    const settled = await simulate(token, payment.body.payment.id, "SUCCESS");
    assert.equal(settled.body.receipt.amount, "500.00");
});

// ── 20. idempotency key collision across methods ──────────────────────────

test("20. reusing an idempotency key with another method is a conflict", async () => {
    const citizen = await makeUser("CITIZEN", "key-collision");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);
    const key = `key-${uniq()}-${uniq()}`;

    const first = await createPayment(token, challan.id, { idempotencyKey: key });
    assert.equal(first.status, 201);

    const otherMethod = await createPayment(token, challan.id, {
        idempotencyKey: key,
        method: "DEBIT_CARD"
    });
    assert.equal(otherMethod.status, 409);
    assert.equal(otherMethod.body.code, "IDEMPOTENCY_MISMATCH");
    assert.equal(await prisma.payment.count({ where: { challanId: challan.id } }), 1);
});

// ── 21. a sibling pending payment can never double-pay ────────────────────

test("21. a pending sibling of a settled payment cannot pay the challan again", async () => {
    const citizen = await makeUser("CITIZEN", "sibling");
    const token = tokenFor(citizen);
    const challan = await makePayableChallanFor(citizen);

    const upi = await createPayment(token, challan.id, { method: "UPI" });
    const debit = await createPayment(token, challan.id, { method: "DEBIT_CARD" });
    await simulate(token, upi.body.payment.id, "SUCCESS");

    // The sibling was left PENDING; settling it must be refused, not applied.
    const attempt = await simulate(token, debit.body.payment.id, "SUCCESS");
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body.code, "ALREADY_PAID");
    assert.equal(attempt.body.payment.status, "FAILED");

    assert.equal(
        await prisma.payment.count({ where: { challanId: challan.id, status: "SUCCESS" } }),
        1
    );
    const dbChallan = await prisma.challan.findUnique({ where: { id: challan.id } });
    assert.equal(dbChallan.status, "PAID");

    // Its receipt stays unavailable.
    const receipt = await api(`/api/v1/payments/${debit.body.payment.id}/receipt`, { token });
    assert.equal(receipt.status, 409);
});

