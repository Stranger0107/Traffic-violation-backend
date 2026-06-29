const storageService = require("../services/storage.service");
const violationService = require("../services/violation.service");
const { z } = require("zod");

const metadataSchema = z.object({
    modelEventId: z.string().min(1),
    violationType: z.enum([
        "NO_HELMET",
        "NO_SEATBELT",
        "RED_LIGHT_JUMP",
        "SPEEDING",
        "WRONG_SIDE",
        "ILLEGAL_PARKING",
        "LANE_VIOLATION"
    ]),
    detectedPlate: z.string().min(1),
    ocrConfidence: z.number().min(0).max(1),
    recommendation: z.enum(["AUTO_VERIFY", "OFFICER_REVIEW", "REJECT"]),
    frameNumber: z.number().int().optional(),
    videoTimestampSec: z.number().optional(),
    detectedAt: z.string().datetime(),
    cameraId: z.string().min(1),
    areaCode: z.string().min(1),
    locationText: z.string().optional(),
    duplicateFlag: z.boolean().default(false),
    duplicateConfidence: z.number().min(0).max(1).default(0),
    modelVersion: z.string().min(1)
});

exports.receiveViolation = async (req, res) => {

    try {

        const image = req.files?.image?.[0];

        if (!image) {
            return res.status(400).json({
                success: false,
                message: "image file is required"
            });
        }

        if (!req.body.metadata) {
            return res.status(400).json({
                success: false,
                message: "metadata is required"
            });
        }

        let parsedMetadata;

        try {
            parsedMetadata = JSON.parse(req.body.metadata);
        } catch {
            return res.status(400).json({
                success: false,
                message: "metadata must be valid JSON"
            });
        }

        const metadataResult = metadataSchema.safeParse(parsedMetadata);

        if (!metadataResult.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid metadata",
                errors: metadataResult.error.flatten().fieldErrors
            });
        }

        const uploadResult = await storageService.uploadEvidence(
            image
        );

        const violation = await violationService.createViolation({
            metadata: metadataResult.data,
            uploadResult
        });

        return res.json({
            success: true,
            violation
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};
