require("dotenv").config();

const prisma = require("../src/config/prisma");

async function main() {
    const vehicleId = "c59b57ec-9208-4394-8bea-7136eb68552e";

    // Create test violation
    const violation = await prisma.violation.create({
        data: {
            modelEventId: `GRIEVANCE-TEST-${Date.now()}`,
            vehicleId,

            violationType: "NO_HELMET",

            detectedPlate: "MH12GRV9999",
            normalizedPlate: "MH12GRV9999",

            ocrConfidence: 0.98,

            frameNumber: 123,
            videoTimestampSec: 4.2,

            detectedAt: new Date(),

            cameraId: "TEST-CAM-001",
            areaCode: "TEST-MUM",
            locationText: "Test Location",

            duplicateFlag: false,
            duplicateConfidence: 0,

            modelVersion: "TEST-v1",

            rawModelPayload: {
                test: true,
                source: "grievance-testing"
            },

            recommendation: "AUTO_VERIFY",
            status: "VERIFIED"
        }
    });

    console.log("Violation created:");
    console.log(JSON.stringify(violation, null, 2));

    // Create test challan
    const challan = await prisma.challan.create({
        data: {
            challanNumber: `GRV-TEST-${Date.now()}`,

            vehicleId,
            violationId: violation.id,

            fineAmount: 500,

            status: "PENDING_PAYMENT",

            dueDate: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
            )
        }
    });

    console.log("\nChallan created:");
    console.log(JSON.stringify(challan, null, 2));

    console.log("\n========== TEST DATA ==========");
    console.log("Vehicle ID:", vehicleId);
    console.log("Violation ID:", violation.id);
    console.log("Challan ID:", challan.id);
    console.log("Challan Number:", challan.challanNumber);
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });