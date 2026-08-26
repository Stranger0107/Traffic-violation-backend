const prisma = require("../config/prisma");

/**
 * GET /api/v1/violations
 * Admin endpoint: list all violations with optional filters.
 * Query params: status, type, search (plate/camera/location)
 */
exports.listViolations = async (req, res) => {
    try {
        const { status, type, search } = req.query;

        const where = {};

        if (status && status !== "ALL") {
            where.status = status;
        }

        if (type && type !== "ALL") {
            where.violationType = type;
        }

        if (search) {
            where.OR = [
                { detectedPlate: { contains: search, mode: "insensitive" } },
                { cameraId: { contains: search, mode: "insensitive" } },
                { locationText: { contains: search, mode: "insensitive" } }
            ];
        }

        const violations = await prisma.violation.findMany({
            where,
            include: {
                evidence: true,
                vehicle: true,
                challan: true
            },
            orderBy: {
                detectedAt: "desc"
            }
        });

        return res.json({
            success: true,
            violations
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

/**
 * GET /api/v1/violations/:id
 * Admin endpoint: get a single violation with all related data.
 */
exports.getViolationById = async (req, res) => {
    try {
        const violation = await prisma.violation.findUnique({
            where: { id: req.params.id },
            include: {
                evidence: true,
                vehicle: {
                    include: {
                        owner: true
                    }
                },
                challan: true
            }
        });

        if (!violation) {
            return res.status(404).json({
                success: false,
                message: "Violation not found"
            });
        }

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
