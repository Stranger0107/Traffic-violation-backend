const paymentService = require("../services/payment.service");

const STATUS_BY_CODE = {
    CHALLAN_NOT_FOUND: 404,
    PAYMENT_NOT_FOUND: 404,
    FORBIDDEN: 403,
    DEMO_DISABLED: 403,
    ALREADY_PAID: 409,
    CHALLAN_NOT_PAYABLE: 409,
    IDEMPOTENCY_MISMATCH: 409,
    RECEIPT_NOT_AVAILABLE: 409,
    CONCURRENCY_CONFLICT: 409
};

const toHttpStatus = (code) => STATUS_BY_CODE[code] || 500;

/**
 * Central error responder. Only the error's own message/code is exposed — request bodies
 * are never echoed, so no payment credentials can leak into a response or a log.
 */
const fail = (res, err, fallback = "Payment request failed") => {
    if (err && err.name === "PaymentError") {
        const body = { success: false, code: err.code, message: err.message };
        return res.status(toHttpStatus(err.code)).json(body);
    }
    console.error("[payments] unexpected error:", err?.code || err?.name, err?.message);
    return res.status(500).json({ success: false, message: fallback });
};

/**
 * POST /api/v1/payments
 * Creates (or reuses) a PENDING demo payment. Amount comes from the challan in the DB.
 */
exports.createPayment = async (req, res) => {
    try {
        const { challanId, method, upiId, idempotencyKey } = req.body;
        const result = await paymentService.createPayment({
            citizenId: req.user.id,
            challanId,
            method,
            upiId,
            idempotencyKey
        });

        return res.status(result.idempotent ? 200 : 201).json({
            success: true,
            idempotent: result.idempotent,
            payment: paymentService.serializePayment(result.payment),
            checkout: result.checkout
        });
    } catch (err) {
        return fail(res, err, "Could not create payment");
    }
};

/**
 * POST /api/v1/payments/:id/simulate
 * Server-controlled demo transaction. Demo mode must be enabled; the client can only
 * request an outcome, never assert one.
 */
exports.simulatePayment = async (req, res) => {
    try {
        const result = await paymentService.simulatePayment({
            paymentId: req.params.id,
            userId: req.user.id,
            role: req.user.role,
            requestedOutcome: req.body?.outcome
        });

        if (result.conflict) {
            return res.status(409).json({
                success: false,
                code: result.conflict.code,
                message: result.conflict.message,
                payment: result.conflict.payment
            });
        }

        return res.json({
            success: true,
            outcome: result.outcome,
            outcomeSource: result.outcomeSource,
            idempotent: !result.changed,
            payment: paymentService.serializePayment(result.payment),
            receipt: result.outcome === "SUCCESS"
                ? await paymentService.buildReceipt({
                    paymentId: result.payment.id,
                    user: req.user
                })
                : null
        });
    } catch (err) {
        return fail(res, err, "Could not simulate payment");
    }
};

/**
 * GET /api/v1/payments/:id
 */
exports.getPayment = async (req, res) => {
    try {
        const payment = await paymentService.getPaymentById({
            paymentId: req.params.id,
            user: req.user
        });
        return res.json({
            success: true,
            payment: paymentService.serializePayment(payment),
            challan: payment.challan
        });
    } catch (err) {
        return fail(res, err, "Could not fetch payment");
    }
};

/**
 * GET /api/v1/payments/reference/:reference
 */
exports.getPaymentByReference = async (req, res) => {
    try {
        const payment = await paymentService.getPaymentByReference({
            reference: req.params.reference,
            user: req.user
        });
        return res.json({
            success: true,
            payment: paymentService.serializePayment(payment)
        });
    } catch (err) {
        return fail(res, err, "Could not fetch payment");
    }
};

/**
 * GET /api/v1/payments/my
 */
exports.getMyPayments = async (req, res) => {
    try {
        const { status, limit } = req.validatedQuery || {};
        const payments = await paymentService.listMyPayments({
            citizenId: req.user.id,
            status,
            limit
        });
        return res.json({
            success: true,
            count: payments.length,
            payments: payments.map(paymentService.serializePayment)
        });
    } catch (err) {
        return fail(res, err, "Could not fetch payment history");
    }
};

/**
 * GET /api/v1/payments/:id/receipt
 */
exports.getReceipt = async (req, res) => {
    try {
        const receipt = await paymentService.buildReceipt({
            paymentId: req.params.id,
            user: req.user
        });
        return res.json({ success: true, receipt });
    } catch (err) {
        return fail(res, err, "Could not generate receipt");
    }
};

/**
 * GET /api/v1/admin/payments — administrative listing.
 */
exports.listAllPayments = async (req, res) => {
    try {
        const { status, limit } = req.validatedQuery || {};
        const payments = await paymentService.listAllPayments({ status, limit });
        return res.json({
            success: true,
            count: payments.length,
            payments: payments.map((p) => ({
                ...paymentService.serializePayment(p),
                citizen: p.citizen,
                challan: p.challan
            }))
        });
    } catch (err) {
        return fail(res, err, "Could not fetch payments");
    }
};
