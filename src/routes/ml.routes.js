const express = require("express");
const multer = require("multer");
const mlController = require("../controllers/ml.controller");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
});

router.post(
    "/violations",
    upload.fields([
        { name: "image", maxCount: 1 },
        { name: "plateCrop", maxCount: 1 }
    ]),
    mlController.receiveViolation
);

module.exports = router;