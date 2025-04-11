const express = require("express");
const router = express.Router();
const User = require("../models/User"); // Ensure you have a User model
const authenticate = require("../middleware/authenticate"); // Middleware for authentication

// ✅ Add Friend by Email
router.post("/add-friend", authenticate, async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findById(req.user.userId);
        const friend = await User.findOne({ email });

        if (!friend) return res.status(404).json({ error: "❌ User not found" });
        if (user.friends.includes(friend._id)) return res.status(400).json({ error: "❌ Already a friend" });

        user.friends.push(friend._id);
        await user.save();

        res.json({ message: "✅ Friend added successfully" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// ✅ Get Friends List
router.get("/", authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate("friends", "username email");
        res.json(user.friends);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;

