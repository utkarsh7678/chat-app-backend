// routes/upload.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const User = require("../models/User");
const fs = require("fs");
const router = express.Router();
const uploadPath = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
}

// Ensure uploads directory exists with full path
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created uploads directory at:', uploadDir);
}

// Set storage engine with absolute paths
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, 'avatar-' + uniqueSuffix);
    }
});

const upload = multer({ storage });

// Upload profile picture
router.post("/profile-picture/:userId", upload.single("profilePic"), async (req, res) => {
    try {
        console.log("Received upload for userId:", req.params.userId);
        console.log("Uploaded file:", req.file);

        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = `uploads/${req.file.filename}`;
        const user = await User.findByIdAndUpdate(req.params.userId, {
            profilePicture: {
                url: filePath,
                key: req.file.filename,
                lastUpdated: new Date()
            }
        }, { new: true });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.status(200).json({ message: "✅ Profile picture uploaded", path: filePath });
    } catch (err) {
        console.error("Upload failed:", err);
        res.status(500).json({ error: "❌ Upload failed" });
    }
});


module.exports = router;
