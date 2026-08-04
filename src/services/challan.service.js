const prisma = require("../config/prisma");

const FINE_AMOUNTS = {
    NO_HELMET: 500.00,
    NO_SEATBELT: 1000.00,
    RED_LIGHT_JUMP: 2000.00,
    SPEEDING: 2000.00,
    WRONG_SIDE: 1500.00,
    ILLEGAL_PARKING: 1000.00,
    LANE_VIOLATION: 500.00,
    MORE_THAN_2_PEOPLE_ON_BIKE: 800.00,
};

const generateChallanNumber = () => {
    const year = new Date().getFullYear();
    const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `CH-${year}-${randomPart}`;
};

const getDueDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date;
};

/**
 * Creates a Challan record and updates the Violation status to CHALLAN_GENERATED.
 * Runs within an existing transaction context if provided.
 * 
 * @param {Object} params
 * @param {string} params.violationId
 * @param {string} params.vehicleId
 * @param {string} params.violationType
 * @param {Object} [tx] Optional Prisma transaction client
 */
exports.createChallanInternal = async ({ violationId, vehicleId, violationType }, tx) => {
    const client = tx || prisma;

    // Generate unique challan number
    let challanNumber;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
        attempts++;
        challanNumber = generateChallanNumber();
        const existing = await client.challan.findUnique({
            where: { challanNumber }
        });
        if (!existing) {
            isUnique = true;
        }
    }

    if (!isUnique) {
        throw new Error("Failed to generate a unique challan number after multiple attempts");
    }

    const fineAmount = FINE_AMOUNTS[violationType] || 1000.00;
    const dueDate = getDueDate();

    // Create the Challan
    const challan = await client.challan.create({
        data: {
            challanNumber,
            vehicleId,
            violationId,
            fineAmount,
            dueDate,
            status: "ISSUED"
        }
    });

    // Update Violation status to CHALLAN_GENERATED
    await client.violation.update({
        where: { id: violationId },
        data: { status: "CHALLAN_GENERATED" }
    });

    return challan;
};

/**
 * Public service method to create a Challan for a given violation.
 * Handles transaction management internally.
 * 
 * @param {string} violationId
 */
exports.createChallan = async (violationId) => {
    return await prisma.$transaction(async (tx) => {
        const violation = await tx.violation.findUnique({
            where: { id: violationId }
        });

        if (!violation) {
            throw new Error(`Violation with ID ${violationId} not found`);
        }

        if (!violation.vehicleId) {
            throw new Error(`Cannot generate challan for violation ${violationId} as no registered vehicle is linked`);
        }

        return await exports.createChallanInternal({
            violationId: violation.id,
            vehicleId: violation.vehicleId,
            violationType: violation.violationType
        }, tx);
    });
};
