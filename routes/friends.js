const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authenticate = require("../middleware/authenticate");

// ✅ Add Friend by Email with mutual friendship
router.post("/add-friend", authenticate, async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findById(req.user.userId);
        const friend = await User.findOne({ email });

        if (!friend) return res.status(404).json({ error: "❌ User not found" });
        if (friend._id.equals(user._id)) return res.status(400).json({ error: "❌ You can't add yourself" });
        if (user.friends.includes(friend._id)) return res.status(400).json({ error: "❌ Already a friend" });

        // Add friend to user's friend list
        user.friends.push(friend._id);
        await user.save();

        // Add user to friend's friend list if not already
        if (!friend.friends.includes(user._id)) {
            friend.friends.push(user._id);
            await friend.save();
        }

        res.json({ message: "✅ Friend added successfully" });
    } catch (error) {
        console.error("❌ Error adding friend:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});
// ✅ Remove a Friend
router.delete("/remove-friend/:friendId", authenticate, async (req, res) => {
    const { friendId } = req.params;

    try {
        const user = await User.findById(req.user.userId);
        const friend = await User.findById(friendId);

        if (!friend) return res.status(404).json({ error: "❌ Friend not found" });

        // Remove friend from user's friend list
        user.friends = user.friends.filter(fId => fId.toString() !== friendId);
        await user.save();

        // Remove user from friend's friend list
        friend.friends = friend.friends.filter(uId => uId.toString() !== req.user.userId);
        await friend.save();

        res.json({ message: "✅ Friend removed successfully" });
    } catch (error) {
        console.error("❌ Error removing friend:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});


// ✅ Get Friend List with Online Status
router.get("/", authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .populate("friends", "username email profilePicture isActive");

        const friendsList = user.friends.map(friend => ({
            _id: friend._id,
            username: friend.username,
            email: friend.email,
            profilePicture: friend.profilePicture,
            isActive: friend.isActive
        }));

        res.json(friendsList);
    } catch (error) {
        console.error("❌ Error fetching friends:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;

