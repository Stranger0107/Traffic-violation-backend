const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mlRoutes = require("./routes/ml.routes");


const app = express(); 

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Routes
const testRoutes = require("./routes/test.routes");
app.use("/api/test", testRoutes);

app.use("/api/v1/model", mlRoutes);

module.exports = app;