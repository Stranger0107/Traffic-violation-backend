const prisma = require("../config/prisma");
const bcrypt = require("bcrypt");
const { z } = require("zod");

const createUserSchema = z.object({
    fullName: z.string().min(2, "Full name must be at least 2 characters"),
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum(["TRAFFIC_OFFICER", "GRIEVANCE_OFFICER", "ADMIN"]),
});

/**
 * GET /api/v1/admin/users
 * Admin endpoint: list all users with optional role filter.
 * Query params: role, search (name/email)
 */
exports.listUsers = async (req, res) => {
    try {
        const { role, search } = req.query;

        const where = {};

        if (role && role !== "ALL") {
            where.role = role;
        }

        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } }
            ];
        }

        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        return res.json({
            success: true,
            users
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
 * POST /api/v1/admin/users
 * Admin endpoint: create a new officer or admin account.
 */
exports.createUser = async (req, res) => {
    try {
        const validation = createUserSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: validation.error.flatten().fieldErrors
            });
        }

        const { fullName, email, password, role } = validation.data;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "Email is already registered"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: { fullName, email, password: passwordHash, role },
            select: { id: true, fullName: true, email: true, role: true, createdAt: true }
        });

        return res.status(201).json({
            success: true,
            message: `${role.replace(/_/g, ' ').toLowerCase()} account created successfully`,
            user: newUser
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
