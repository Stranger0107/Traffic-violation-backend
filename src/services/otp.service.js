/**
 * OTP Service — Twilio Verify (auto-provisioned) + Console fallback
 *
 * Uses Twilio Verify API which works on FREE trial accounts.
 * If no TWILIO_VERIFY_SERVICE_SID is set, auto-creates one on startup.
 * Falls back to console log when Twilio credentials are missing.
 *
 * Required .env vars (for real delivery):
 *   TWILIO_ACCOUNT_SID     — Twilio account SID
 *   TWILIO_AUTH_TOKEN      — Twilio auth token
 *
 * Optional .env vars:
 *   TWILIO_VERIFY_SERVICE_SID — Pre-existing Verify service SID (auto-provisioned if missing)
 *   OTP_EXPIRY_SECONDS     — OTP validity in seconds (default: 300 = 5 min)
 *   OTP_MAX_ATTEMPTS       — Max wrong attempts before OTP is invalidated (default: 5)
 *   OTP_RESEND_COOLDOWN    — Seconds between resends (default: 30)
 */

const crypto = require("crypto");

// ─── Configuration ───────────────────────────────────────────
const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS) || 300;
const OTP_EXPIRY_MS = OTP_EXPIRY_SECONDS * 1000;
const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;
const RESEND_COOLDOWN_MS = (parseInt(process.env.OTP_RESEND_COOLDOWN) || 30) * 1000;
const DUPLICATE_REQUEST_WINDOW_MS = 5000;

// ─── In-memory store ─────────────────────────────────────────
// Map<phone, { code, expiresAt, attempts, sentAt }>
const otpStore = new Map();

// Verified phones store (for registration flow)
const verifiedPhones = new Map();

// ─── Twilio client (lazy init) ───────────────────────────────
let twilioClient = null;
let verifyServiceSid = null; // auto-provisioned if not in env

function isPlaceholder(value) {
    return !value || /^(your_|replace_|example|changeme)/i.test(String(value).trim());
}

function getTwilioCredentials() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (isPlaceholder(accountSid) || isPlaceholder(authToken)) {
        return null;
    }

    return { accountSid, authToken };
}

function getTwilioClient() {
    if (twilioClient) return twilioClient;

    const credentials = getTwilioCredentials();
    if (!credentials) {
        return null;
    }

    try {
        const twilio = require("twilio");
        twilioClient = twilio(credentials.accountSid, credentials.authToken);
        console.log("[OTP] Twilio client initialized");
        return twilioClient;
    } catch (err) {
        console.error("[OTP] Failed to initialize Twilio:", err.message);
        return null;
    }
}

// ─── Auto-provision Twilio Verify Service ────────────────────
async function ensureVerifyService() {
    // If already resolved (from env or previous call), return it
    if (verifyServiceSid) return verifyServiceSid;

    const client = getTwilioClient();
    if (!client) return null;

    // Check if user provided one in env
    const envSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (envSid && !isPlaceholder(envSid) && /^VA[a-f0-9]{32}$/i.test(envSid.trim())) {
        verifyServiceSid = envSid.trim();
        console.log(`[OTP] Using existing Verify service: ${verifyServiceSid}`);
        return verifyServiceSid;
    }

    // Auto-create a Verify service
    try {
        console.log("[OTP] No TWILIO_VERIFY_SERVICE_SID found. Auto-provisioning a new Verify service...");
        const service = await client.verify.v2.services.create({
            friendlyName: "Traffic Mama OTP",
        });
        verifyServiceSid = service.sid;
        console.log(`[OTP] ✅ Verify service created: ${verifyServiceSid}`);
        console.log(`[OTP] 💡 Tip: Add this to your .env for persistence:`);
        console.log(`[OTP]    TWILIO_VERIFY_SERVICE_SID=${verifyServiceSid}`);
        return verifyServiceSid;
    } catch (err) {
        console.error("[OTP] Failed to auto-provision Verify service:", err.message);
        console.log("[OTP] Falling back to console OTP delivery");
        return null;
    }
}

// ─── Generate 6-digit OTP ────────────────────────────────────
function generateCode() {
    return crypto.randomInt(100000, 999999).toString();
}

// ─── Send via Twilio Verify ──────────────────────────────────
async function sendViaVerify(phone) {
    const client = getTwilioClient();
    const serviceSid = await ensureVerifyService();

    if (!client || !serviceSid) {
        throw new Error("Twilio Verify is not available.");
    }

    await client.verify.v2.services(serviceSid).verifications.create({
        to: phone,
        channel: "sms",
    });

    console.log(`[OTP] Twilio Verify SMS started for ${phone}`);
}

// ─── Console fallback (dev mode) ─────────────────────────────
function logToConsole(phone, code) {
    console.log("");
    console.log("┌──────────────────────────────────────────┐");
    console.log("│           📱 OTP DELIVERY (DEV)          │");
    console.log("├──────────────────────────────────────────┤");
    console.log(`│  Phone:  ${phone}`);
    console.log(`│  Code:   ${code}`);
    console.log(`│  Valid:  ${Math.floor(OTP_EXPIRY_MS / 60000)} minutes`);
    console.log("└──────────────────────────────────────────┘");
    console.log("");
}

// ─── Public: Send OTP ────────────────────────────────────────
exports.sendOtp = async (phone, options = {}) => {
    const normalized = phone.replace(/\s/g, "").trim();

    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
        return {
            success: false,
            message: "Enter a valid phone number in international format, for example +919876543210.",
        };
    }

    // Rate limit check
    const existing = otpStore.get(normalized);
    if (existing && Date.now() - existing.sentAt < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000);

        // Duplicate request window — allow the same request within 5s
        if (Date.now() - existing.sentAt < DUPLICATE_REQUEST_WINDOW_MS) {
            return {
                success: true,
                message: "OTP was already sent. Please use the code you received.",
                provider: "twilio-verify",
                cooldown: remaining,
                duplicate: true,
            };
        }

        return {
            success: false,
            message: `Please wait ${remaining} seconds before requesting a new OTP`,
            cooldown: remaining,
        };
    }

    const client = getTwilioClient();
    const useTwilioVerify = !!client;
    const code = useTwilioVerify ? null : generateCode(); // Verify generates its own code
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    // Try to send via Twilio Verify (works on trial accounts!)
    if (useTwilioVerify) {
        try {
            await sendViaVerify(normalized);
        } catch (err) {
            console.error(`[OTP] Failed to send via Twilio Verify:`, err.message);
            // Fall back to console — generate our own code
            const fallbackCode = generateCode();
            logToConsole(normalized, fallbackCode);

            otpStore.set(normalized, {
                code: fallbackCode,
                expiresAt,
                attempts: 0,
                sentAt: Date.now(),
            });

            return {
                success: true,
                message: "OTP generated (Twilio delivery failed — check server console for code).",
                provider: "console",
                cooldown: Math.ceil(RESEND_COOLDOWN_MS / 1000),
            };
        }
    } else {
        // No Twilio — console fallback
        logToConsole(normalized, code);
    }

    // Store OTP (for Verify, we store null code and verify via API later;
    // for console, we store the generated code)
    otpStore.set(normalized, {
        code, // null for Verify (verified via API), actual code for console
        expiresAt,
        attempts: 0,
        sentAt: Date.now(),
    });

    return {
        success: true,
        message: useTwilioVerify
            ? "OTP sent to your phone via SMS"
            : "OTP generated — check server console for the code",
        provider: useTwilioVerify ? "twilio-verify" : "console",
        cooldown: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    };
};

// ─── Public: Verify OTP ──────────────────────────────────────
exports.verifyOtp = async (phone, code) => {
    const normalized = phone.replace(/\s/g, "").trim();
    const trimmedCode = (code || "").trim();

    const stored = otpStore.get(normalized);

    if (!stored) {
        return { success: false, message: "No OTP found. Please request a new one." };
    }

    if (Date.now() > stored.expiresAt) {
        otpStore.delete(normalized);
        return { success: false, message: "OTP has expired. Please request a new one." };
    }

    if (stored.attempts >= MAX_ATTEMPTS) {
        otpStore.delete(normalized);
        return { success: false, message: "Too many failed attempts. Please request a new OTP." };
    }

    stored.attempts++;

    // If code is null, it was sent via Twilio Verify (which manages its own codes)
    if (stored.code === null) {
        const client = getTwilioClient();
        const serviceSid = await ensureVerifyService();

        if (client && serviceSid) {
            try {
                const verification = await client.verify
                    .v2.services(serviceSid)
                    .verificationChecks.create({
                        to: normalized,
                        code: trimmedCode,
                    });

                if (verification.status === "approved") {
                    otpStore.delete(normalized);
                    verifiedPhones.set(normalized, { verifiedAt: Date.now() });
                    return { success: true, message: "Phone number verified successfully" };
                }

                return {
                    success: false,
                    message: `Invalid OTP. ${MAX_ATTEMPTS - stored.attempts} attempts remaining.`,
                    attemptsRemaining: MAX_ATTEMPTS - stored.attempts,
                };
            } catch (err) {
                console.error("[OTP] Twilio Verify check failed:", err.message);
                return {
                    success: false,
                    message: `OTP verification failed. ${MAX_ATTEMPTS - stored.attempts} attempts remaining.`,
                    attemptsRemaining: MAX_ATTEMPTS - stored.attempts,
                };
            }
        }
    }

    // Local code comparison (console fallback mode)
    if (stored.code !== trimmedCode) {
        return {
            success: false,
            message: `Invalid OTP. ${MAX_ATTEMPTS - stored.attempts} attempts remaining.`,
            attemptsRemaining: MAX_ATTEMPTS - stored.attempts,
        };
    }

    // Verified — remove from store
    otpStore.delete(normalized);
    verifiedPhones.set(normalized, { verifiedAt: Date.now() });
    return { success: true, message: "Phone number verified successfully" };
};

// ─── Public: Check if a phone was recently verified ───────────
exports.isPhoneVerified = (phone) => {
    const normalized = phone.replace(/\s/g, "").trim();
    const record = verifiedPhones.get(normalized);

    if (!record) return false;

    // Valid for 15 minutes
    if (Date.now() - record.verifiedAt > 15 * 60 * 1000) {
        verifiedPhones.delete(normalized);
        return false;
    }

    return true;
};

// ─── Public: Get OTP status (for resend button) ──────────────
exports.getStatus = (phone) => {
    const normalized = phone.replace(/\s/g, "").trim();
    const stored = otpStore.get(normalized);

    if (!stored) {
        return { exists: false, canResend: true, secondsUntilResend: 0, expiresInSeconds: 0 };
    }

    const cooldownRemaining = Math.max(
        0,
        Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - stored.sentAt)) / 1000)
    );
    const expiresInSeconds = Math.max(0, Math.ceil((stored.expiresAt - Date.now()) / 1000));

    return {
        exists: true,
        canResend: cooldownRemaining === 0,
        secondsUntilResend: cooldownRemaining,
        expiresInSeconds,
        attemptsUsed: stored.attempts,
        attemptsRemaining: MAX_ATTEMPTS - stored.attempts,
    };
};

// ─── Public: Cleanup ─────────────────────────────────────────
exports.cleanup = () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [phone, data] of otpStore) {
        if (now > data.expiresAt) {
            otpStore.delete(phone);
            cleaned++;
        }
    }
    // Also clean verified phones older than 15 min
    for (const [phone, data] of verifiedPhones) {
        if (now - data.verifiedAt > 15 * 60 * 1000) {
            verifiedPhones.delete(phone);
        }
    }
    if (cleaned > 0) {
        console.log(`[OTP] Cleaned up ${cleaned} expired OTP(s)`);
    }
};

// ─── Public: Start cleanup interval ──────────────────────────
let _cleanupInterval = null;
exports.startCleanup = () => {
    if (!_cleanupInterval) {
        _cleanupInterval = setInterval(exports.cleanup, 60 * 1000);
        console.log("[OTP] Cleanup interval started");
    }
};

// ─── Expose config for reference ─────────────────────────────
exports.config = {
    expiryMinutes: Math.floor(OTP_EXPIRY_MS / 60000),
    maxAttempts: MAX_ATTEMPTS,
    resendCooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
    twilioConfigured: !!getTwilioCredentials(),
};
