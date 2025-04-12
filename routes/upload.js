// routes/upload.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const User = require("../models/User");

const router = express.Router();

// Set storage engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/"); // store inside /uploads folder
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + path.extname(file.originalname);
        cb(null, file.fieldname + "-" + uniqueSuffix);
    }
});

const upload = multer({ storage });

// Upload profile picture
router.post("/profile-picture/:userId", upload.single("profilePic"), async (req, res) => {
    try {
        const filePath = `uploads/${req.file.filename}`;
        await User.findByIdAndUpdate(req.params.userId, { profilePicture: filePath });
        res.json({ message: "✅ Profile picture uploaded", path: filePath });
    } catch (err) {
        res.status(500).json({ error: "❌ Upload failed" });
    }
});

module.exports = router;
