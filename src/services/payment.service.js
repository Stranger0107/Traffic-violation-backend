const crypto = require("crypto");
const prisma = require("../config/prisma");

/**
 * Demo-only e-challan payment service.
 *
 * Ground rules implemented here:
 *  - The payable amount always comes from the database (Challan.fineAmount), never the client.
 *  - No payment credentials (card number/CVV/expiry/UPI PIN) are accepted or stored.
 *    A dummy UPI handle may be supplied for display, but only a masked form is echoed back.
 *  - A payment never marks a challan PAID just because it was created. Only the
 *    server-controlled simulation step may do that, inside a serializable transaction.
 *  - Outcomes are decided by the server; a client may only *request* an outcome and only
 *    while demo payment simulation is enabled (see resolveOutcome).
 */

const CURRENCY = "INR";
const PAYABLE_CHALLAN_STATUSES = ["ISSUED", "PENDING_PAYMENT"];
const PAYMENT_METHODS = ["UPI", "CREDIT_CARD", "DEBIT_CARD"];
const PAYMENT_STATUSES = ["PENDING", "SUCCESS", "FAILED"];
const DEMO_LABEL = "DEMO — NO REAL MONEY TRANSFERRED";
// Time budget (ms) for retrying a transaction aborted by a serialization conflict.
// A remote database means each attempt costs hundreds of ms, so retries are bounded by
// wall-clock time rather than attempt count.
const CONFLICT_RETRY_BUDGET_MS = Number(process.env.PAYMENT_CONFLICT_RETRY_MS || 10000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class PaymentError extends Error {
    /**
     * @param {string} code Machine-readable error code used by the controller for HTTP mapping
     * @param {string} message Human-readable message
     * @param {object} [extra] Extra sanitized details (never credentials)
     */
    constructor(code, message, extra) {
        super(message);
        this.name = "PaymentError";
        this.code = code;
        this.extra = extra;
    }
}

// ── demo mode / outcome policy ────────────────────────────────────────────

const demoPaymentsEnabled = () => process.env.DEMO_PAYMENTS_ENABLED !== "false";

/**
 * Whether a client-supplied demo outcome may be honored.
 * Explicit env flag wins; otherwise it is enabled outside production only.
 */
const clientOutcomeAllowed = () => {
    if (process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME === "true") return true;
    if (process.env.DEMO_PAYMENT_ALLOW_CLIENT_OUTCOME === "false") return false;
    return process.env.NODE_ENV !== "production";
};

const normalizeOutcome = (value) => {
    if (!value) return null;
    const normalized = String(value).toUpperCase();
    return PAYMENT_STATUSES.includes(normalized) ? normalized : null;
};

/**
 * Server-side decision for a simulated outcome.
 * Precedence: requested outcome (only if allowed) -> configured default -> SUCCESS.
 */
const resolveOutcome = (requestedOutcome) => {
    const requested = normalizeOutcome(requestedOutcome);
    if (requested && clientOutcomeAllowed()) {
        return { outcome: requested, source: "client-request" };
    }
    const configured = normalizeOutcome(process.env.DEMO_PAYMENT_DEFAULT_OUTCOME);
    return { outcome: configured || "SUCCESS", source: "server-config" };
};

// ── helpers ───────────────────────────────────────────────────────────────

const money = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value.toFixed(2);
    if (typeof value === "string") return Number(value).toFixed(2);
    if (typeof value.toFixed === "function") return value.toFixed(2); // Prisma.Decimal
    return String(value);
};

const generateReference = () => {
    const year = new Date().getFullYear();
    const suffix = crypto.randomBytes(5).toString("hex").toUpperCase();
    return `DEMO-PAY-${year}-${suffix}`;
};

/** Mask a demo UPI handle for display only. Never persisted. */
const maskUpiId = (upiId) => {
    if (!upiId) return null;
    const [local, domain] = String(upiId).split("@");
    if (!domain) return "***";
    const visible = local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};

/**
 * Runs a function in a SERIALIZABLE transaction, retrying on Postgres serialization
 * failures (P2034). Serializability is what keeps concurrent payment attempts safe:
 * two racing simulations cannot both read "challan is unpaid" and both write PAID.
 */
const runSerializable = async (fn, startedAt = Date.now(), attempt = 1) => {
    try {
        return await prisma.$transaction(fn, {
            isolationLevel: "Serializable",
            // maxWait: how long a request may queue for a pooled connection before the
            // transaction even starts. Genuine contention must not surface as an error.
            maxWait: 15000,
            timeout: 20000
        });
    } catch (err) {
        // P2034 = serialization failure, P2028 = could not start/keep the transaction
        // (e.g. waited too long for a pooled connection). Both are retryable.
        const retryable = err.code === "P2034" || err.code === "P2028";
        if (retryable && Date.now() - startedAt < CONFLICT_RETRY_BUDGET_MS) {
            // Jittered, capped backoff so racing transactions do not livelock.
            await sleep(Math.min(40 * attempt, 250) + Math.floor(Math.random() * 30));
            return runSerializable(fn, startedAt, attempt + 1);
        }
        throw err;
    }
};

/** Only identification data leaves the service — never credentials. */
const serializePayment = (payment) => ({
    id: payment.id,
    reference: payment.reference,
    challanId: payment.challanId,
    citizenId: payment.citizenId,
    amount: money(payment.amount),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    isDemo: payment.isDemo,
    failureReason: payment.failureReason || null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    completedAt: payment.completedAt,
    demoNotice: DEMO_LABEL
});

const buildDemoCheckout = ({ method, payment, upiId }) => {
    const base = {
        demoMode: true,
        scannable: false,
        notice: DEMO_LABEL
    };

    if (method === "UPI") {
        return {
            ...base,
            upi: {
                // Echoed back for display only; it is never written to the database.
                vpaMasked: maskUpiId(upiId) || "demo@echallan",
                payeeName: "E-Challan Demo Treasury",
                // Illustrative placeholder string. Not a valid UPI intent — cannot move money.
                qrPayload: `DEMO-ECHALLAN|PAY|${payment.reference}|${money(payment.amount)}|NOT-A-REAL-PAYMENT`,
                qrImageUrl: null,
                note: "Illustrative QR only. It is not scannable and cannot initiate a real payment."
            }
        };
    }

    return {
        ...base,
        card: {
            acceptedNetworks: ["VISA", "MASTERCARD", "RUPAY"],
            cardholderNameRequired: true,
            credentialsStored: false,
            note: "Enter any dummy card details. Nothing is sent to a card network and nothing is stored."
        }
    };
};

const assertPayableChallan = (challan) => {
    if (challan.status === "PAID") {
        throw new PaymentError("ALREADY_PAID", "This challan has already been paid");
    }
    if (!PAYABLE_CHALLAN_STATUSES.includes(challan.status)) {
        throw new PaymentError(
            "CHALLAN_NOT_PAYABLE",
            `Challan status ${challan.status} cannot be paid`
        );
    }
};

// ── create ────────────────────────────────────────────────────────────────

/**
 * Creates (or reuses) a PENDING demo payment for a challan the citizen owns.
 * Never marks the challan paid.
 */
const createPayment = async ({ citizenId, challanId, method, upiId, idempotencyKey }) => {
    if (!demoPaymentsEnabled()) {
        throw new PaymentError("DEMO_DISABLED", "Demo payments are disabled on this server");
    }

    // Fast path: retried request with a known idempotency key.
    if (idempotencyKey) {
        const existing = await prisma.payment.findUnique({
            where: { citizenId_idempotencyKey: { citizenId, idempotencyKey } }
        });
        if (existing) {
            if (existing.challanId !== challanId || existing.method !== method) {
                throw new PaymentError(
                    "IDEMPOTENCY_MISMATCH",
                    "Idempotency key was already used for a different challan or payment method"
                );
            }
            return { payment: existing, idempotent: true, checkout: null };
        }
    }

    try {
        return await runSerializable(async (tx) => {
            const challan = await tx.challan.findUnique({
                where: { id: challanId },
                include: { vehicle: { select: { ownerId: true, registrationNumber: true } } }
            });

            if (!challan) {
                throw new PaymentError("CHALLAN_NOT_FOUND", "Challan not found");
            }
            if (!challan.vehicle || challan.vehicle.ownerId !== citizenId) {
                throw new PaymentError(
                    "FORBIDDEN",
                    "You can only pay challans issued against your own vehicle"
                );
            }
            assertPayableChallan(challan);

            // A successful payment already exists for this challan (partial unique index).
            const alreadySuccessful = await tx.payment.findFirst({
                where: { challanId, status: "SUCCESS" }
            });
            if (alreadySuccessful) {
                throw new PaymentError("ALREADY_PAID", "This challan has already been paid");
            }

            // Reuse an outstanding PENDING attempt instead of piling up duplicates.
            const pending = await tx.payment.findFirst({
                where: { challanId, citizenId, method, status: "PENDING" },
                orderBy: { createdAt: "desc" }
            });
            if (pending) {
                return { payment: pending, idempotent: true, checkout: null };
            }

            const payment = await tx.payment.create({
                data: {
                    reference: generateReference(),
                    challanId,
                    citizenId,
                    // Amount snapshot taken from the database, never from the request body.
                    amount: challan.fineAmount,
                    currency: CURRENCY,
                    method,
                    status: "PENDING",
                    isDemo: true,
                    idempotencyKey: idempotencyKey || null
                }
            });

            return { payment, idempotent: false, checkout: null };
        });
    } catch (err) {
        // Unique violation on (citizenId, idempotencyKey) — another request won the race.
        if (err.code === "P2002" && idempotencyKey) {
            const existing = await prisma.payment.findUnique({
                where: { citizenId_idempotencyKey: { citizenId, idempotencyKey } }
            });
            if (existing) return { payment: existing, idempotent: true, checkout: null };
        }
        if (err.code === "P2034" || err.code === "P2028") {
            throw new PaymentError(
                "CONCURRENCY_CONFLICT",
                "Too many concurrent payment attempts on this challan. Please retry."
            );
        }
        throw err;
    }
};

/** Convenience wrapper that adds the demo checkout metadata for the response body. */
const createPaymentWithCheckout = async (params) => {
    const result = await createPayment(params);
    return {
        ...result,
        checkout: buildDemoCheckout({
            method: result.payment.method,
            payment: result.payment,
            upiId: params.upiId
        })
    };
};

// ── simulate ──────────────────────────────────────────────────────────────

/**
 * Server-side demo transaction simulation. Only the owner (or an admin demo operator)
 * may trigger it, and only while demo payments are enabled.
 */
const simulatePayment = async ({ paymentId, userId, role, requestedOutcome }) => {
    if (!demoPaymentsEnabled()) {
        throw new PaymentError("DEMO_DISABLED", "Demo payment simulation is disabled on this server");
    }
    if (role !== "CITIZEN" && role !== "ADMIN") {
        throw new PaymentError("FORBIDDEN", "This role cannot simulate demo payments");
    }

    const { outcome, source } = resolveOutcome(requestedOutcome);

    // Fast path for replays: a settled payment needs no transaction at all. Ownership and
    // the not-found case are both resolved here so they never depend on a retry.
    const existing = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!existing) {
        throw new PaymentError("PAYMENT_NOT_FOUND", "Payment not found");
    }
    if (existing.citizenId !== userId && role !== "ADMIN") {
        throw new PaymentError("FORBIDDEN", "Access denied");
    }
    if (existing.status === "SUCCESS" || existing.status === "FAILED") {
        return { payment: existing, outcome: existing.status, outcomeSource: source, changed: false };
    }

    let conflict = null;

    const result = await (async () => {
        try {
            return await runSerializable(async (tx) => {
                const payment = await tx.payment.findUnique({
                    where: { id: paymentId },
                    include: { challan: { select: { id: true, status: true, challanNumber: true } } }
                });

                if (!payment) {
                    throw new PaymentError("PAYMENT_NOT_FOUND", "Payment not found");
                }
                // Ownership is derived from the stored record, not from the request body.
                if (payment.citizenId !== userId && role !== "ADMIN") {
                    throw new PaymentError("FORBIDDEN", "Access denied");
                }

                // Idempotent replays: a settled payment is returned unchanged.
                if (payment.status === "SUCCESS" || payment.status === "FAILED") {
                    return { payment, outcome: payment.status, source, changed: false };
                }

                // No explicit `SELECT ... FOR UPDATE` here on purpose: SERIALIZABLE already
                // aborts conflicting writers (surfacing as retryable P2034), while a raw
                // query would surface the same conflict as an opaque P2010 that cannot be
                // safely retried. The unique partial index on SUCCESS payments is the final
                // database-level backstop against a double payment.
                const challan = await tx.challan.findUnique({
                    where: { id: payment.challanId }
                });
                if (!challan) {
                    throw new PaymentError("CHALLAN_NOT_FOUND", "Challan not found");
                }

                if (outcome === "PENDING") {
                    return { payment, outcome, source, changed: false };
                }

                if (outcome === "FAILED") {
                    const failed = await tx.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: "FAILED",
                            failureReason: "DEMO_SIMULATED_FAILURE",
                            completedAt: new Date()
                        }
                    });
                    // Challan is deliberately untouched: a failed payment must not mark it paid.
                    return { payment: failed, outcome, source, changed: true };
                }

                // outcome === SUCCESS — guarded by the challan's current state.
                try {
                    assertPayableChallan(challan);
                } catch (err) {
                    if (err instanceof PaymentError) {
                        const failed = await tx.payment.update({
                            where: { id: payment.id },
                            data: {
                                status: "FAILED",
                                failureReason: err.code === "ALREADY_PAID"
                                    ? "CHALLAN_ALREADY_PAID"
                                    : "CHALLAN_NOT_PAYABLE",
                                completedAt: new Date()
                            }
                        });
                        conflict = { code: err.code, message: err.message, payment: serializePayment(failed) };
                        return null;
                    }
                    throw err;
                }

                const completedAt = new Date();
                const succeeded = await tx.payment.update({
                    where: { id: payment.id },
                    data: { status: "SUCCESS", completedAt, failureReason: null }
                });
                await tx.challan.update({
                    where: { id: challan.id },
                    data: { status: "PAID", paidAt: completedAt }
                });

                return { payment: succeeded, outcome, source, changed: true };
            });
        } catch (err) {
            // Race on the one-success-per-challan index: another attempt already paid it.
            if (err.code === "P2002") {
                const fresh = await prisma.payment.findUnique({ where: { id: paymentId } });
                if (fresh && fresh.status === "SUCCESS") {
                    return { payment: fresh, outcome: "SUCCESS", source, changed: false };
                }
                throw new PaymentError("CHALLAN_ALREADY_PAID", "This challan has already been paid");
            }
            // Retries exhausted (serialization failure or transaction start/queue timeout):
            // if a concurrent request already settled it, answer idempotently with the
            // settled state instead of surfacing an error.
            if (err.code === "P2034" || err.code === "P2028") {
                const fresh = await prisma.payment.findUnique({ where: { id: paymentId } });
                if (fresh && (fresh.status === "SUCCESS" || fresh.status === "FAILED")) {
                    return { payment: fresh, outcome: fresh.status, source, changed: false };
                }
                throw new PaymentError(
                    "CONCURRENCY_CONFLICT",
                    "This payment is being processed by another request. Please retry."
                );
            }
            throw err;
        }
    })();

    if (conflict) {
        return { conflict };
    }

    return {
        payment: result.payment,
        outcome: result.outcome,
        outcomeSource: result.source,
        changed: result.changed
    };
};

// ── read ──────────────────────────────────────────────────────────────────

const canAccess = (payment, user) =>
    payment.citizenId === user.id || user.role === "ADMIN";

const getPaymentById = async ({ paymentId, user }) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            challan: {
                select: {
                    id: true,
                    challanNumber: true,
                    status: true,
                    fineAmount: true,
                    dueDate: true,
                    vehicle: { select: { registrationNumber: true } }
                }
            }
        }
    });
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", "Payment not found");
    if (!canAccess(payment, user)) throw new PaymentError("FORBIDDEN", "Access denied");
    return payment;
};

const getPaymentByReference = async ({ reference, user }) => {
    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", "Payment not found");
    if (!canAccess(payment, user)) throw new PaymentError("FORBIDDEN", "Access denied");
    return payment;
};

const listMyPayments = async ({ citizenId, status, limit }) => {
    return prisma.payment.findMany({
        where: { citizenId, ...(status ? { status } : {}) },
        include: {
            challan: { select: { id: true, challanNumber: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        take: limit || 50
    });
};

const listAllPayments = async ({ status, limit }) => {
    return prisma.payment.findMany({
        where: status ? { status } : {},
        include: {
            challan: { select: { id: true, challanNumber: true, status: true } },
            citizen: { select: { id: true, fullName: true, email: true } }
        },
        orderBy: { createdAt: "desc" },
        take: limit || 100
    });
};

// ── receipt ───────────────────────────────────────────────────────────────

/**
 * Receipt is only available for SUCCESS payments. Anything else is rejected — a failed or
 * pending payment must never produce a paid receipt.
 */
const buildReceipt = async ({ paymentId, user }) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            challan: {
                select: {
                    id: true,
                    challanNumber: true,
                    status: true,
                    paidAt: true,
                    vehicle: { select: { registrationNumber: true } },
                    violation: { select: { violationType: true, detectedAt: true, cameraId: true } }
                }
            },
            citizen: { select: { fullName: true } }
        }
    });

    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", "Payment not found");
    if (!canAccess(payment, user)) throw new PaymentError("FORBIDDEN", "Access denied");
    if (payment.status !== "SUCCESS") {
        throw new PaymentError(
            "RECEIPT_NOT_AVAILABLE",
            `Receipt is only available for successful payments (current status: ${payment.status})`
        );
    }

    return {
        receiptNumber: `RCPT-${payment.reference}`,
        reference: payment.reference,
        challanId: payment.challanId,
        challanNumber: payment.challan?.challanNumber || null,
        vehicleRegistrationNumber: payment.challan?.vehicle?.registrationNumber || null,
        violationType: payment.challan?.violation?.violationType || null,
        violationDetectedAt: payment.challan?.violation?.detectedAt || null,
        payerName: payment.citizen?.fullName || null,
        amount: money(payment.amount),
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        paidAt: payment.completedAt,
        challanPaidAt: payment.challan?.paidAt || null,
        issuedAt: new Date().toISOString(),
        isDemo: payment.isDemo,
        demoLabel: DEMO_LABEL
    };
};

module.exports = {
    PaymentError,
    PAYMENT_METHODS,
    PAYMENT_STATUSES,
    CURRENCY,
    DEMO_LABEL,
    demoPaymentsEnabled,
    clientOutcomeAllowed,
    resolveOutcome,
    maskUpiId,
    money,
    serializePayment,
    buildDemoCheckout,
    createPayment: createPaymentWithCheckout,
    simulatePayment,
    getPaymentById,
    getPaymentByReference,
    listMyPayments,
    listAllPayments,
    buildReceipt
};
