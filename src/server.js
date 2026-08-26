require("dotenv").config();

const app = require("./app");
const otpService = require("./services/otp.service");
const authController = require("./controllers/auth.controller");

const PORT = process.env.PORT || 5000;

// Start cleanup timers for OTP store and verified phones
otpService.startCleanup();
authController.startCleanup();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});