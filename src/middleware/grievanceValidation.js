const { z } = require("zod");

const grievanceSchema = z.object({
    challanId: z.string().uuid(),

    reason: z.enum([
        "FALSE_DETECTION",
        "VEHICLE_NOT_MINE",
        "NOT_MYSELF_DRIVING",
        "CHALLAN_ALREADY_PAID",
        "OTHER"
    ]),

    description: z.string().max(500).optional()
});

module.exports = (req, res, next) => {

    const result = grievanceSchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            success: false,
            message: "Invalid grievance request",
            errors: result.error.flatten().fieldErrors
        });
    }

    req.body = result.data;

    next();
};