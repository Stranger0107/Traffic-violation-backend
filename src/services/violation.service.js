const prisma = require("../config/prisma");

exports.createViolation = async ({ metadata, uploadResult }) => {

    const violation = await prisma.$transaction(async (tx) => {
        const newViolation = await tx.violation.create({

            data: {

                modelEventId: metadata.modelEventId,

                violationType: metadata.violationType,

                detectedPlate: metadata.detectedPlate,

                normalizedPlate: metadata.detectedPlate.toUpperCase(),

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
