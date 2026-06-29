const prisma = require("../config/prisma");

exports.createViolation = async (metadata) => {

    const violation = await prisma.violation.create({

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

            latitude: metadata.latitude,

            longitude: metadata.longitude,

            duplicateFlag: metadata.duplicateFlag,

            duplicateConfidence: metadata.duplicateConfidence,

            modelVersion: metadata.modelVersion,

            rawModelPayload: metadata

        }

    });

    return violation;

};