const prisma = require("../config/prisma");

/**
 * GET /api/v1/challans/my
 * Returns all challans for vehicles owned by the authenticated citizen.
 */
exports.getMyChallans = async (req, res) => {
    try {
        const challans = await prisma.challan.findMany({
            where: {
                vehicle: {
                    ownerId: req.user.id
                }
            },
            include: {
                violation: {
                    include: {
                        evidence: true
                    }
                },
                vehicle: true
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        return res.json({
            success: true,
            challans
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
 * GET /api/v1/challans/:id
 * Returns a single challan by ID (with vehicle ownership check for citizens).
 */
exports.getChallanById = async (req, res) => {
    try {
        const challan = await prisma.challan.findUnique({
            where: { id: req.params.id },
            include: {
                violation: {
                    include: {
                        evidence: true
                    }
                },
                vehicle: {
                    include: {
                        owner: true
                    }
                },
                grievances: true
            }
        });

        if (!challan) {
            return res.status(404).json({
                success: false,
                message: "Challan not found"
            });
        }

        // Citizens can only view their own challans
        if (
            req.user.role === "CITIZEN" &&
            challan.vehicle.ownerId !== req.user.id
        ) {
            return res.status(403).json({
                success: false,
                message: "Access denied"
            });
        }

        return res.json({
            success: true,
            challan
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
 * GET /api/v1/challans
 * Admin endpoint: returns all challans with optional status filter.
 */
exports.listAllChallans = async (req, res) => {
    try {
        const { status } = req.query;

        const where = {};
        if (status && status !== "ALL") {
            where.status = status;
        }

        const challans = await prisma.challan.findMany({
            where,
            include: {
                violation: {
                    include: {
                        evidence: true
                    }
                },
                vehicle: true
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        return res.json({
            success: true,
            challans
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
