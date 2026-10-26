const express = require("express");
const paymentController = require("../controllers/payment.controller");
const { userAuth, authorize } = require("../middleware/userAuth");
const {
    createPaymentValidation,
    simulatePaymentValidation,
    idParamValidation,
    referenceParamValidation,
    listQueryValidation
} = require("../middleware/paymentValidation");

const router = express.Router();

// ── Citizen endpoints ─────────────────────────────────────────────────────
// Static paths are declared before "/:id" so "my" is never parsed as an id.

router.post(
    "/payments",
    userAuth,
    authorize("CITIZEN"),
    createPaymentValidation,
    paymentController.createPayment
);

router.get(
    "/payments/my",
    userAuth,
    authorize("CITIZEN"),
    listQueryValidation,
    paymentController.getMyPayments
);

// Demo transaction simulation. Demo mode is enforced in the service (DEMO_PAYMENTS_ENABLED).
router.post(
    "/payments/:id/simulate",
    userAuth,
    authorize("CITIZEN", "ADMIN"),
    idParamValidation,
    simulatePaymentValidation,
    paymentController.simulatePayment
);

router.get(
    "/payments/reference/:reference",
    userAuth,
    referenceParamValidation,
    paymentController.getPaymentByReference
);

router.get(
    "/payments/:id/receipt",
    userAuth,
    idParamValidation,
    paymentController.getReceipt
);

router.get(
    "/payments/:id",
    userAuth,
    idParamValidation,
    paymentController.getPayment
);

// ── Admin endpoints ───────────────────────────────────────────────────────

router.get(
    "/admin/payments",
    userAuth,
    authorize("ADMIN"),
    listQueryValidation,
    paymentController.listAllPayments
);

module.exports = router;
