const express = require("express");
const challanController = require("../controllers/challan.controller");
const { userAuth, authorize } = require("../middleware/userAuth");

const router = express.Router();

// Citizen endpoints
router.get(
    "/challans/my",
    userAuth,
    authorize("CITIZEN"),
    challanController.getMyChallans
);

router.get(
    "/challans/:id",
    userAuth,
    challanController.getChallanById
);

// Admin endpoints
router.get(
    "/challans",
    userAuth,
    authorize("ADMIN"),
    challanController.listAllChallans
);

module.exports = router;
