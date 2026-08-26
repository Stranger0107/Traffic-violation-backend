const prisma = require("../config/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const otpService = require("../services/otp.service");

// Define registration validation schema
const registerSchema = z.object({
    fullName: z.string().min(2, "Full name must be at least 2 characters"),
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
});

// Define login validation schema
const loginSchema = z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required")
});

/**
 * Generates a standard JWT for the authenticated user.
 */
const generateToken = (user) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error("JWT_SECRET is not configured on the server");
    }
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        jwtSecret,
        { expiresIn: "24h" }
    );
};

/**
 * Register a new user (Citizen by default).
 * Requires phone OTP verification first.
 */
exports.register = async (req, res) => {
    try {
        const validation = registerSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: validation.error.flatten().fieldErrors
            });
        }

        const { fullName, email, password, phone } = validation.data;
        const role = "CITIZEN";
        const normalizedPhone = phone.replace(/\s/g, "").trim();

        // Check if phone was OTP-verified via the OTP service
        if (!otpService.isPhoneVerified(normalizedPhone)) {
            return res.status(400).json({
                success: false,
                message: "Phone number not verified. Please complete OTP verification first."
            });
        }

        // Check if user already exists by email
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "Email is already registered"
            });
        }

        // Check if phone is already taken
        const existingPhone = await prisma.user.findUnique({
            where: { phone: normalizedPhone }
        });
        if (existingPhone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is already registered"
            });
        }

        // Hash the password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create the user record with verified phone
        const newUser = await prisma.user.create({
            data: {
                fullName,
                email,
                password: passwordHash,
                phone: normalizedPhone,
                phoneVerified: true,
                role
            }
        });

        // Generate token
        const token = generateToken(newUser);

        return res.status(201).json({
            success: true,
            message: "User registered successfully",
            token,
            user: {
                id: newUser.id,
                fullName: newUser.fullName,
                email: newUser.email,
                role: newUser.role,
                createdAt: newUser.createdAt
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error registering user",
            error: err.message
        });
    }
};

/**
 * Send OTP to a phone number.
 */
exports.sendOtp = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone number is required" });
        }

        const result = await otpService.sendOtp(phone);
        return res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
};

/**
 * Verify OTP and mark phone as verified for registration.
 */
exports.verifyOtp = async (req, res) => {
    try {
        const { phone, code } = req.body;
        if (!phone || !code) {
            return res.status(400).json({ success: false, message: "Phone and code are required" });
        }

        const result = await otpService.verifyOtp(phone, code);
        return res.json(result);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to verify OTP" });
    }
};

/**
 * Get OTP status for a phone number (for resend button state).
 */
exports.otpStatus = async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone query param is required" });
        }
        const status = otpService.getStatus(phone);
        return res.json({ success: true, ...status });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to get OTP status" });
    }
};

// Cleanup function — started by server.js (delegates to otpService)
let _cleanupInterval = null;
exports.startCleanup = () => {
    if (!_cleanupInterval) {
        // Auth controller cleanup is now handled by otpService.startCleanup()
        console.log("[Auth] Cleanup delegated to OTP service");
    }
};

/**
 * Login handler to authenticate user credentials.
 */
exports.login = async (req, res) => {
    try {
        const validation = loginSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: validation.error.flatten().fieldErrors
            });
        }

        const { email, password } = validation.data;

        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Generate token
        const token = generateToken(user);

        return res.json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error authenticating user",
            error: err.message
        });
    }
};

/**
 * Fetches the currently logged in user's profile details.
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User profile not found"
            });
        }

        return res.json({
            success: true,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error fetching user profile",
            error: err.message
        });
    }
};
