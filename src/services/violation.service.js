const prisma = require("../config/prisma");
const vehicleService = require("./vehicle.service");

const getInitialStatus = ({ vehicle, recommendation }) => {
    if (!vehicle) {
        return "VEHICLE_NOT_FOUND";
    }

    if (recommendation === "AUTO_VERIFY") {
        return "VERIFIED";
    }

    if (recommendation === "OFFICER_REVIEW") {
        return "MANUAL_REVIEW";
    }

    if (recommendation === "REJECT") {
        return "REJECTED";
    }

    return "RECEIVED";
};

exports.createViolation = async ({ metadata, uploadResult }) => {

    const violation = await prisma.$transaction(async (tx) => {
        const normalizedPlate = vehicleService.normalizePlate(metadata.detectedPlate);
        const vehicle = await vehicleService.findVehicleByPlate(normalizedPlate, tx);
        const status = getInitialStatus({
            vehicle,
            recommendation: metadata.recommendation
        });

        const newViolation = await tx.violation.create({

            data: {

                modelEventId: metadata.modelEventId,

                violationType: metadata.violationType,

                detectedPlate: metadata.detectedPlate,

                normalizedPlate,

                vehicleId: vehicle?.id,

                ocrConfidence: metadata.ocrConfidence,

                recommendation: metadata.recommendation,

                frameNumber: metadata.frameNumber,

                videoTimestampSec: metadata.videoTimestampSec,

                detectedAt: new Date(metadata.detectedAt),

                cameraId: metadata.cameraId,

                areaCode: metadata.areaCode,

                locationText: metadata.locationText,

                duplicateFlag: metadata.duplicateFlag,

                duplicateConfidence: metadata.duplicateConfidence,

                modelVersion: metadata.modelVersion,

                rawModelPayload: metadata,

                status,

                evidence: {
                    create: {
                        imageUrl: uploadResult.url,
                        imageKitFileId: uploadResult.fileId,
                        uploadedBy: "ML_MODEL"
                    }
                }

            },
            include: {
                evidence: true
            }

        });

        return newViolation;
    });

    return violation;
};
