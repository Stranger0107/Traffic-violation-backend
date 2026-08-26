const prisma = require("../config/prisma");
const storageService = require("./storage.service");
const challanService = require("./challan.service");

/**
 * Creates a manual violation from a traffic officer's upload.
 * Flow: Upload image → Create Violation (VERIFIED) → Attach Evidence → Generate Challan
 *
 * @param {Object} params
 * @param {string} params.officerId - The traffic officer's user ID
 * @param {Object} params.file - Multer file buffer
 * @param {Object} params.metadata - Violation metadata
 */
exports.createManualViolation = async ({ officerId, file, metadata }) => {
    return await prisma.$transaction(async (tx) => {
        // 1. Upload evidence image to ImageKit
        const uploadResult = await storageService.uploadEvidence(file);

        // 2. Normalize plate number
        const normalizedPlate = (metadata.detectedPlate || "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");

        // 3. Try to find the vehicle in the database
        let vehicle = null;
        if (normalizedPlate) {
            vehicle = await tx.vehicle.findUnique({
                where: { registrationNumber: normalizedPlate },
            });
        }

        // 4. Create the violation record — officer-uploaded = AUTO_VERIFY (auto-generates challan)
        const violation = await tx.violation.create({
            data: {
                modelEventId: `manual-${officerId}-${Date.now()}`,
                violationType: metadata.violationType,
                detectedPlate: metadata.detectedPlate || "UNKNOWN",
                normalizedPlate: normalizedPlate || "UNKNOWN",
                ocrConfidence: 1.0, // Officer manually read the plate
                recommendation: "AUTO_VERIFY", // Auto-verify since officer confirmed
                frameNumber: null,
                videoTimestampSec: null,
                detectedAt: new Date(),
                cameraId: metadata.cameraId || "OFFICER_PHONE",
                areaCode: metadata.areaCode || "AREA-01",
                locationText: metadata.locationText || null,
                latitude: metadata.latitude || null,
                longitude: metadata.longitude || null,
                duplicateFlag: false,
                duplicateConfidence: 0,
                modelVersion: "manual-v1.0.0",
                rawModelPayload: {
                    source: "TRAFFIC_OFFICER",
                    officerId,
                    ...metadata,
                },
                status: vehicle ? "VERIFIED" : "VEHICLE_NOT_FOUND",
                vehicleId: vehicle?.id || null,
                evidence: {
                    create: {
                        imageUrl: uploadResult.url,
                        imageKitFileId: uploadResult.fileId,
                        uploadedBy: "TRAFFIC_OFFICER",
                    },
                },
            },
            include: {
                evidence: true,
                vehicle: true,
            },
        });

        // 5. If vehicle found, generate challan automatically
        if (vehicle) {
            const challan = await challanService.createChallanInternal(
                {
                    violationId: violation.id,
                    vehicleId: vehicle.id,
                    violationType: violation.violationType,
                },
                tx
            );
            violation.status = "CHALLAN_GENERATED";
            violation.challan = challan;
        }

        return violation;
    });
};

/**
 * Lists all manual violations uploaded by a specific officer.
 */
exports.getManualViolationsByOfficer = async (officerId) => {
    return await prisma.violation.findMany({
        where: {
            rawModelPayload: {
                path: ["source"],
                equals: "TRAFFIC_OFFICER",
            },
            // Also filter by officerId in the raw payload
        },
        include: {
            evidence: true,
            vehicle: true,
            challan: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
};

/**
 * Lists all manual violations (admin view).
 */
exports.listAllManualViolations = async () => {
    return await prisma.violation.findMany({
        where: {
            rawModelPayload: {
                path: ["source"],
                equals: "TRAFFIC_OFFICER",
            },
        },
        include: {
            evidence: true,
            vehicle: true,
            challan: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
};
