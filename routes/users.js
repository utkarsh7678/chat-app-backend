const express = require("express");
const router = express.Router();
const User = require("../models/User"); // Ensure you have a User model
const authenticate = require("../middleware/authenticate"); // Middleware for authentication

// ✅ Get Active Users
router.get("/active", authenticate, async (req, res) => {
    try {
        const activeUsers = await User.find({ isActive: true }).select("username email");
        res.json(activeUsers);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error while fetching active users" });
    }
});

// ✅ Get User Details by Email
router.get("/:email", authenticate, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email }).select("username email");
        if (!user) return res.status(404).json({ error: "❌ User not found" });

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;

