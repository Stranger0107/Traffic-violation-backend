const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

/**
 * Middleware to authenticate requests via JWT Bearer Token.
 * Extracted user info is appended to `req.user`.
 */
const userAuth = async (req, res, next) => {
    try {
        const authHeader = req.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication token is required"
            });
        }

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return res.status(500).json({
                success: false,
                message: "JWT secret is not configured on the server"
            });
        }

        const decoded = jwt.verify(token, jwtSecret);
        
        const user = await prisma.user.findUnique({
            where: { id: decoded.id }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found or account is inactive"
            });
        }

        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            fullName: user.fullName
        };

        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: "Invalid, expired, or malformed authentication token",
            error: err.message
        });
    }
};

/**
 * Role authorization middleware builder.
 * Assumes `userAuth` middleware was executed first to populate `req.user`.
 * 
 * @param {...string} roles Allowed roles (e.g., 'ADMIN', 'TRAFFIC_OFFICER')
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(500).json({
                success: false,
                message: "Authorization middleware invoked before authentication"
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied: Role '${req.user.role}' is not authorized for this resource`
            });
        }

        next();
    };
};

module.exports = {
    userAuth,
    authorize
};
