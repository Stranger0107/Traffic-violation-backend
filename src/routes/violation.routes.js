const express = require("express");
const violationController = require("../controllers/violation.controller");
const { userAuth, authorize } = require("../middleware/userAuth");

const router = express.Router();

// Admin endpoints
router.get(
    "/violations",
    userAuth,
    authorize("ADMIN"),
    violationController.listViolations
);

router.get(
    "/violations/:id",
    userAuth,
    authorize("ADMIN"),
    violationController.getViolationById
);

module.exports = router;
