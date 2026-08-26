const express = require("express");
const adminController = require("../controllers/admin.controller");
const { userAuth, authorize } = require("../middleware/userAuth");

const router = express.Router();

// Admin user management
router.get(
    "/admin/users",
    userAuth,
    authorize("ADMIN"),
    adminController.listUsers
);

router.post(
    "/admin/users",
    userAuth,
    authorize("ADMIN"),
    adminController.createUser
);

module.exports = router;
