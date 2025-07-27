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
router.post("/profile-picture/:userId", (req, res, next) => {
    console.log("=== UPLOAD REQUEST RECEIVED ===");
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Params:", req.params);
    
    // Handle the upload with multer
    upload.single("profilePic")(req, res, async (err) => {
        try {
            // Handle multer errors
            if (err) {
                console.error('Multer error:', err);
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({
                        success: false,
                        error: 'File too large. Maximum size is 5MB.'
                    });
                }
                return res.status(400).json({
                    success: false,
                    error: 'Error uploading file: ' + err.message
                });
            }

            console.log("File info:", req.file);
            console.log("Request body:", req.body);

            if (!req.file) {
                console.error("No file received in the request");
                return res.status(400).json({ 
                    success: false,
                    error: "No file uploaded or invalid file format. Please upload an image file (JPG, PNG, GIF)." 
                });
            }

            const filePath = `/uploads/${req.file.filename}`;  // Add leading slash for URL
            
            // Update user with the new profile picture
            const user = await User.findByIdAndUpdate(
                req.params.userId,
                {
                    profilePicture: {
                        url: filePath,
                        key: req.file.filename,
                        lastUpdated: new Date(),
                        versions: {
                            original: filePath,
                            small: filePath,
                            medium: filePath,
                            large: filePath
                        }
                    }
                },
                { new: true, runValidators: true }
            );

            if (!user) {
                console.error('User not found:', req.params.userId);
                // Clean up the uploaded file if user not found
                fs.unlinkSync(req.file.path);
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            console.log('Profile picture updated successfully for user:', user._id);
            res.json({
                success: true,
                message: 'Profile picture updated successfully',
                profilePicture: {
                    url: filePath,
                    key: req.file.filename,
                    lastUpdated: new Date(),
                    versions: {
                        original: filePath,
                        small: filePath,
                        medium: filePath,
                        large: filePath
                    }
                }
            });
        } catch (error) {
            console.error('Error updating profile picture:', error);
            
            // Clean up the uploaded file in case of error
            if (req.file && req.file.path) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (unlinkError) {
                    console.error('Error cleaning up file:', unlinkError);
                }
            }
            
            res.status(500).json({
                success: false,
                error: 'Failed to update profile picture',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });  // Close upload.single callback
});  // Close router.post

module.exports = router;

