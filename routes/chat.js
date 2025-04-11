const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");

// Send a message
router.post("/send", async (req, res) => {
    const { senderId, receiverId, text } = req.body;
    
    if (!senderId || !receiverId || !text) {
        return res.status(400).json({ error: "All fields are required" });
    }

    try {
        const message = new Message({ senderId, receiverId, text });
        await message.save();
        res.status(201).json({ message });
    } catch (error) {
        res.status(500).json({ error: "Failed to send message" });
    }
});

// Get messages between two users
router.get("/messages/:user1/:user2", async (req, res) => {
    const { user1, user2 } = req.params;
    
    try {
        const messages = await Message.find({
            $or: [
                { senderId: user1, receiverId: user2 },
                { senderId: user2, receiverId: user1 }
            ]
        }).sort({ createdAt: 1 });

        res.json({ messages });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

module.exports = router;
