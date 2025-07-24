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
