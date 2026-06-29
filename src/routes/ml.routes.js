const express = require("express");

const router = express.Router();

const mlController = require("../controllers/ml.controller");
router.post("/violations", mlController.receiveViolation);

module.exports = router;