const manualViolationService = require("../services/manualViolation.service");
const { z } = require("zod");
const { createWorker } = require("tesseract.js");

const manualViolationSchema = z.object({
    violationType: z.enum([
        "NO_HELMET",
        "NO_SEATBELT",
        "RED_LIGHT_JUMP",
        "SPEEDING",
        "WRONG_SIDE",
        "ILLEGAL_PARKING",
        "LANE_VIOLATION",
        "MORE_THAN_2_PEOPLE_ON_BIKE",
    ]),
    detectedPlate: z.string().min(1, "Plate number is required"),
    locationText: z.string().optional(),
    areaCode: z.string().min(1, "Area code is required"),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
});

/**
 * POST /api/v1/officer/manual-violations
 * Traffic officer uploads a photo of a violation they witnessed.
 */
exports.uploadManualViolation = async (req, res) => {
    try {
        const image = req.files?.image?.[0];
        if (!image) {
            return res.status(400).json({
                success: false,
                message: "Image file is required",
            });
        }

        if (!req.body.metadata) {
            return res.status(400).json({
                success: false,
                message: "Metadata is required",
            });
        }

        let parsedMetadata;
        try {
            parsedMetadata = JSON.parse(req.body.metadata);
        } catch {
            return res.status(400).json({
                success: false,
                message: "Metadata must be valid JSON",
            });
        }

        const metadataResult = manualViolationSchema.safeParse(parsedMetadata);
        if (!metadataResult.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid metadata",
                errors: metadataResult.error.flatten().fieldErrors,
            });
        }

        const violation = await manualViolationService.createManualViolation({
            officerId: req.user.id,
            file: image,
            metadata: metadataResult.data,
        });

        return res.status(201).json({
            success: true,
            violation,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

/**
 * POST /api/v1/officer/detect-plate
 * Accept an image and auto-detect the license plate number using OCR.
 */
exports.detectPlate = async (req, res) => {
    try {
        const image = req.files?.image?.[0];
        if (!image) {
            return res.status(400).json({
                success: false,
                message: "Image file is required",
            });
        }

        // Run Tesseract OCR on the uploaded image
        const worker = await createWorker("eng");
        const { data: { text, confidence } } = await worker.recognize(image.buffer);
        await worker.terminate();

        // Clean and extract plate-like text
        const rawText = text.trim();
        const cleaned = rawText.replace(/[^A-Z0-9]/gi, "").toUpperCase();

        // Try to find a plate pattern in the OCR output
        // Indian plates: 2 letters + 1-2 digits + 1-2 letters + 1-4 digits
        const platePatterns = [
            /[A-Z]{2}\d{1,2}[A-Z]{1,2}\d{1,4}/,  // Full: MH12AB1234
            /[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}/,       // Newer: MH12AB1234
            /[A-Z]{2}\d{1,2}/,                      // Partial: MH12
        ];

        let detectedPlate = null;
        let plateConfidence = 0;

        for (const pattern of platePatterns) {
            const match = cleaned.match(pattern);
            if (match && match[0].length >= 4) {
                detectedPlate = match[0];
                plateConfidence = Math.min(confidence, 100);
                break;
            }
        }

        // If no pattern matched, try the full cleaned text
        if (!detectedPlate && cleaned.length >= 4 && cleaned.length <= 12) {
            detectedPlate = cleaned;
            plateConfidence = Math.min(confidence, 60);
        }

        return res.json({
            success: true,
            detectedPlate: detectedPlate || null,
            confidence: Math.round(plateConfidence),
            rawText: rawText.substring(0, 200), // first 200 chars for debugging
        });
    } catch (err) {
        console.error("Plate detection error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to detect plate: " + err.message,
        });
    }
};

/**
 * GET /api/v1/officer/manual-violations
 * List manual violations uploaded by the authenticated officer.
 */
exports.getMyManualViolations = async (req, res) => {
    try {
        const violations = await manualViolationService.getManualViolationsByOfficer(
            req.user.id
        );

        return res.json({
            success: true,
            violations,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};
