const express = require("express");
const multer = require("multer");
const { uploadEvidence } = require("../services/storage.service");
const prisma = require("../config/prisma");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
});

router.post(
    "/upload",
    upload.single("image"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "No image uploaded"
                });
            }

            const result = await uploadEvidence(req.file);

            res.json({
                success: true,
                image: result
            });

        } catch (err) {
            console.error(err);

            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }
);

router.get("/db", async (req, res) => {
    try {
        await prisma.$connect();

        res.json({
            success: true,
            message: "Database Connected"
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

module.exports = router;
