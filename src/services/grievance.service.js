const prisma = require("../config/prisma");
const storageService = require("./storage.service");

const MAX_ACTIVE_GRIEVANCES = parseInt(process.env.MAX_ACTIVE_GRIEVANCES || "3", 10);

exports.createGrievance = async ({ citizenId, challanId, reason, description, file }) => {

    return await prisma.$transaction(async (tx) => {

        const challan = await tx.challan.findUnique({
            where: { id: challanId },
            include: { vehicle: { include: { owner: true } }, violation: true }
        });

        if (!challan) {
            const err = new Error("Challan not found");
            err.code = "NOT_FOUND";
            throw err;
        }

        if (!challan.vehicle || challan.vehicle.ownerId !== citizenId) {
            const err = new Error("You can only raise grievances for your own challans");
            err.code = "FORBIDDEN";
            throw err;
        }

        // Prevent more than MAX_ACTIVE_GRIEVANCES for this citizen
        const activeCount = await tx.grievance.count({
            where: { citizenId, status: { in: ["PENDING", "UNDER_REVIEW"] } }
        });

        if (activeCount >= MAX_ACTIVE_GRIEVANCES) {
            const err = new Error("Maximum number of active grievances exceeded");
            err.code = "TOO_MANY";
            throw err;
        }

        // Prevent duplicate active grievance on same challan
        const existingActive = await tx.grievance.findFirst({
            where: { challanId, citizenId, status: { in: ["PENDING", "UNDER_REVIEW"] } }
        });

        if (existingActive) {
            const err = new Error("Active grievance already exists for this challan");
            err.code = "CONFLICT";
            throw err;
        }

        // Create grievance
        const grievance = await tx.grievance.create({
            data: {
                challanId,
                citizenId,
                reason,
                description,
                status: "PENDING"
            },
            include: {
                challan: true,
                citizen: true
            }
        });

        // If file provided, upload and attach as GrievanceEvidence
        if (file) {
            const uploadResult = await storageService.uploadEvidence(file);

            await tx.grievanceEvidence.create({
                data: {
                    grievanceId: grievance.id,
                    imageUrl: uploadResult.url,
                    imageKitFileId: uploadResult.fileId,
                    uploadedBy: "CITIZEN"
                }
            });
        }

        // Mark challan as disputed (do not cancel)
        await tx.challan.update({
            where: { id: challanId },
            data: { status: "DISPUTED" }
        });

        return grievance;
    });
};

exports.getMyGrievances = async (citizenId) => {
    return await prisma.grievance.findMany({
        where: { citizenId },
        include: { challan: { include: { vehicle: true } } },
        orderBy: { createdAt: 'desc' }
    });
};

exports.getGrievanceByIdForCitizen = async (id, citizenId) => {
    const grievance = await prisma.grievance.findUnique({
        where: { id },
        include: { challan: true, citizen: true }
    });
    if (!grievance) return null;
    if (grievance.citizenId !== citizenId) {
        const err = new Error("Access denied");
        err.code = "FORBIDDEN";
        throw err;
    }
    return grievance;
};

exports.listGrievancesForOfficer = async () => {
    return await prisma.grievance.findMany({
        include: { challan: { include: { vehicle: { include: { owner: true } } } }, citizen: true },
        orderBy: { createdAt: 'desc' }
    });
};

exports.getGrievanceByIdForOfficer = async (id) => {
    return await prisma.grievance.findUnique({
        where: { id },
        include: { challan: { include: { vehicle: { include: { owner: true } }, violation: true } }, citizen: true }
    });
};

exports.startReview = async ({ grievanceId, officerId }) => {
    return await prisma.$transaction(async (tx) => {
        const g = await tx.grievance.findUnique({ where: { id: grievanceId } });
        if (!g) throw Object.assign(new Error('Grievance not found'), { code: 'NOT_FOUND' });
        if (g.status !== 'PENDING') throw Object.assign(new Error('Invalid state transition'), { code: 'INVALID_STATE' });

        const updated = await tx.grievance.update({
            where: { id: grievanceId },
            data: { status: 'UNDER_REVIEW', reviewedBy: officerId, reviewedAt: new Date() }
        });
        return updated;
    });
};

exports.approveGrievance = async ({ grievanceId, officerId, officerNote }) => {
    return await prisma.$transaction(async (tx) => {
        const g = await tx.grievance.findUnique({ where: { id: grievanceId }, include: { challan: true } });
        if (!g) throw Object.assign(new Error('Grievance not found'), { code: 'NOT_FOUND' });
        if (g.status !== 'UNDER_REVIEW') throw Object.assign(new Error('Invalid state transition'), { code: 'INVALID_STATE' });

        // Update grievance
        await tx.grievance.update({ where: { id: grievanceId }, data: { status: 'APPROVED', reviewedBy: officerId, reviewedAt: new Date(), officerNote } });

        const challan = await tx.challan.findUnique({ where: { id: g.challanId }, include: { violation: true } });
        if (!challan) throw Object.assign(new Error('Associated challan not found'), { code: 'NOT_FOUND' });

        // Cancel challan
        await tx.challan.update({ where: { id: challan.id }, data: { status: 'CANCELLED' } });

        // Update violation status to REJECTED (or appropriate)
        if (challan.violation) {
            await tx.violation.update({ where: { id: challan.violation.id }, data: { status: 'REJECTED' } });
        }

        // If challan was paid create refund record (idempotent)
        if (challan.paidAt) {
            const existing = await tx.refund.findFirst({ where: { challanId: challan.id } });
            if (!existing) {
                await tx.refund.create({ data: { challanId: challan.id, amount: challan.fineAmount } });
            }
        }

        return { success: true };
    });
};

exports.rejectGrievance = async ({ grievanceId, officerId, officerNote }) => {
    const g = await prisma.grievance.findUnique({ where: { id: grievanceId } });
    if (!g) throw Object.assign(new Error('Grievance not found'), { code: 'NOT_FOUND' });
    if (g.status !== 'UNDER_REVIEW') throw Object.assign(new Error('Invalid state transition'), { code: 'INVALID_STATE' });

    const updated = await prisma.grievance.update({ where: { id: grievanceId }, data: { status: 'REJECTED', reviewedBy: officerId, reviewedAt: new Date(), officerNote } });
    return updated;
};