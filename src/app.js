const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mlRoutes = require("./routes/ml.routes");
const authRoutes = require("./routes/auth.routes");
const grievanceRoutes = require("./routes/grievance.routes");
const challanRoutes = require("./routes/challan.routes");
const violationRoutes = require("./routes/violation.routes");
const adminRoutes = require("./routes/admin.routes");
const officerRoutes = require("./routes/officer.routes");
const paymentRoutes = require("./routes/payment.routes");


const app = express(); 

// Behind a hosting proxy (Render, Railway, etc.) the client IP and protocol
// arrive in X-Forwarded-* headers; trusting one hop keeps logs and rate signals correct.
app.set("trust proxy", 1);

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Liveness probe. Deliberately independent of the database so a platform health
// check reflects "the process is serving" rather than "Postgres is reachable".
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        service: "traffic-violation-backend",
        uptimeSeconds: Math.round(process.uptime())
    });
});

// Routes
const testRoutes = require("./routes/test.routes");
app.use("/api/test", testRoutes);

app.use("/api/v1/model", mlRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", grievanceRoutes);
app.use("/api/v1", challanRoutes);
app.use("/api/v1", violationRoutes);
app.use("/api/v1", adminRoutes);
app.use("/api/v1", officerRoutes);
app.use("/api/v1", paymentRoutes);

module.exports = app;