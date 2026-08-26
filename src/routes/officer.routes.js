const express = require("express");
const multer = require("multer");
const manualViolationController = require("../controllers/manualViolation.controller");
const { userAuth, authorize } = require("../middleware/userAuth");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image uploads are allowed"), false);
        }
        cb(null, true);
    },
});

// Traffic officer: upload a manual violation
router.post(
    "/officer/manual-violations",
    userAuth,
    authorize("TRAFFIC_OFFICER"),
    upload.fields([{ name: "image", maxCount: 1 }]),
    manualViolationController.uploadManualViolation
);

// Traffic officer: list own uploads
router.get(
    "/officer/manual-violations",
    userAuth,
    authorize("TRAFFIC_OFFICER"),
    manualViolationController.getMyManualViolations
);

module.exports = router;
