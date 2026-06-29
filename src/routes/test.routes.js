const express = require("express");
const multer = require("multer");
const { uploadEvidence } = require("../services/storage.service");

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

            const result = await uploadEvidence(
                req.file.buffer,
                req.file.originalname
            );

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

module.exports = router;