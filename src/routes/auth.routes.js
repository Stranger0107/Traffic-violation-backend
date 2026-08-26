const express = require("express");
const authController = require("../controllers/auth.controller");
const { userAuth } = require("../middleware/userAuth");

const router = express.Router();

// Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);
router.get("/otp-status", authController.otpStatus);

// Protected routes
router.get("/profile", userAuth, authController.getProfile);

module.exports = router;
