const { z } = require("zod");

/**
 * Validation for the demo payment module.
 *
 * Deliberately strict about what a client may send: only an identifier of the payment
 * method and optional dummy display data. Card numbers, CVVs, expiry dates and UPI PINs
 * are rejected outright (unknown keys) so they can never reach a controller or a log.
 */

const PAYMENT_METHODS = ["UPI", "CREDIT_CARD", "DEBIT_CARD"];
const OUTCOMES = ["SUCCESS", "FAILED", "PENDING"];

// Demo UPI handle only. It is displayed (masked) and never persisted.
const upiIdSchema = z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,64}$/, "UPI ID must look like name@bank");

const createPaymentSchema = z
    .object({
        challanId: z.string().uuid("challanId must be a valid UUID"),
        method: z.enum(PAYMENT_METHODS),
        upiId: upiIdSchema.optional(),
        idempotencyKey: z
            .string()
            .trim()
            .min(8, "idempotencyKey must be at least 8 characters")
            .max(128)
            .regex(/^[A-Za-z0-9._:-]+$/, "idempotencyKey may contain letters, digits and . _ : -")
            .optional()
    })
    .strict()
    .refine((data) => !(data.method !== "UPI" && data.upiId), {
        message: "upiId is only allowed when method is UPI",
        path: ["upiId"]
    });

const simulatePaymentSchema = z
    .object({
        // A *request*, not an assertion: the service decides whether it is honored.
        outcome: z.enum(OUTCOMES).optional()
    })
    .strict();

const idParamSchema = z.object({
    id: z.string().uuid("id must be a valid UUID")
});

const referenceParamSchema = z.object({
    reference: z
        .string()
        .trim()
        .min(8)
        .max(64)
        .regex(/^[A-Z0-9-]+$/, "Invalid payment reference format")
});

const listQuerySchema = z.object({
    status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
});

const respond = (res, result) => {
    const flat = result.error.flatten();
    return res.status(400).json({
        success: false,
        message: "Invalid payment request",
        errors: flat.fieldErrors,
        // Unrecognized keys surface here as key *names* only (e.g. "cardNumber"), so a
        // caller sending credentials sees why it was rejected without the value ever
        // being echoed back into a response or a log.
        ...(flat.formErrors.length ? { formErrors: flat.formErrors } : {})
    });
};

module.exports = {
    PAYMENT_METHODS,
    OUTCOMES,
    createPaymentValidation: (req, res, next) => {
        const result = createPaymentSchema.safeParse(req.body);
        if (!result.success) return respond(res, result);
        req.body = result.data;
        next();
    },
    simulatePaymentValidation: (req, res, next) => {
        // An empty body is valid: the server then applies its configured outcome.
        const result = simulatePaymentSchema.safeParse(req.body ?? {});
        if (!result.success) return respond(res, result);
        req.body = result.data;
        next();
    },
    idParamValidation: (req, res, next) => {
        const result = idParamSchema.safeParse(req.params);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment id",
                errors: result.error.flatten().fieldErrors
            });
        }
        req.params = result.data;
        next();
    },
    referenceParamValidation: (req, res, next) => {
        const result = referenceParamSchema.safeParse(req.params);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment reference",
                errors: result.error.flatten().fieldErrors
            });
        }
        req.params = result.data;
        next();
    },
    listQueryValidation: (req, res, next) => {
        const result = listQuerySchema.safeParse(req.query);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid query parameters",
                errors: result.error.flatten().fieldErrors
            });
        }
        // req.query is read-only in Express 5, so expose the parsed values separately.
        req.validatedQuery = result.data;
        next();
    }
};
