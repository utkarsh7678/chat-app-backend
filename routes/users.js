const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authenticate = require("../middleware/authenticate");

// ✅ Get Active Users
router.get("/active", authenticate, async (req, res) => {
  try {
    const activeUsers = await User.find({ isActive: true }).select("_id username email profilePicture");
    res.json(activeUsers);
  } catch (error) {
    console.error("❌ Error fetching active users:", error);
    res.status(500).json({ error: "Server error while fetching active users" });
  }
});

// ✅ Get Friends List
router.get("/friends", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .populate("friends", "_id username email profilePicture isActive");

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user.friends);
  } catch (error) {
    console.error("❌ Error fetching friends:", error);
    res.status(500).json({ error: "Error fetching friends" });
  }
});

// ✅ Add a Friend by Email
router.post("/friends/add-friend", authenticate, async (req, res) => {
  const { email } = req.body;

  try {
    const friend = await User.findOne({ email });
    if (!friend) return res.status(404).json({ error: "❌ User not found" });

    const user = await User.findById(req.user.userId);

    if (!user) return res.status(404).json({ error: "❌ Your account not found" });

    if (user.friends.includes(friend._id)) {
      return res.status(400).json({ error: "⚠️ Already friends" });
    }

    user.friends.push(friend._id);
    await user.save();

    res.json({ message: "✅ Friend added successfully" });
  } catch (error) {
    console.error("❌ Error adding friend:", error);
    res.status(500).json({ error: "Server error adding friend" });
  }
});

// ✅ Get User Details by Email
router.get("/:email", authenticate, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email })
      .select("_id username email profilePicture isActive");

    if (!user) return res.status(404).json({ error: "❌ User not found" });

    res.json(user);
  } catch (error) {
    console.error("❌ Error fetching user by email:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

