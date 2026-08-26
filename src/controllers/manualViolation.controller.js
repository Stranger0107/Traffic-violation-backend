const manualViolationService = require("../services/manualViolation.service");
const { z } = require("zod");

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
