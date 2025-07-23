require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `avatar-register-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

let otpStore = {}; // Temporary in-memory storage

// ✅ Enhanced Email Setup with multiple providers
const createTransporter = () => {
    // Check if we have email credentials
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log("⚠️ Email credentials not configured. Using console fallback.");
        return null;
    }

    try {
        return nodemailer.createTransport({
            service: "gmail",
            auth: { 
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS 
            },
            tls: {
                rejectUnauthorized: false
            }
        });
    } catch (error) {
        console.error("❌ Email transporter creation failed:", error);
        return null;
    }
};

const transporter = createTransporter();

// ✅ Enhanced Email Sending Function
const sendEmail = async (to, subject, text) => {
    if (!transporter) {
        // Fallback: Log OTP to console for development
        console.log("📧 EMAIL NOT SENT (no transporter)");
        console.log("📧 To:", to);
        console.log("📧 Subject:", subject);
        console.log("📧 Content:", text);
        console.log("📧 OTP:", text.match(/\d{6}/)?.[0] || "No OTP found");
        return true; // Simulate success for development
    }

    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            text: text,
            html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
                    <div style="background-color: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #333; text-align: center;">${subject}</h2>
                        <p style="color: #666; font-size: 16px; line-height: 1.6;">${text}</p>
                        <div style="text-align: center; margin-top: 20px;">
                            <div style="background-color: #007bff; color: white; padding: 15px 30px; border-radius: 5px; font-size: 18px; font-weight: bold; display: inline-block;">
                                ${text.match(/\d{6}/)?.[0] || "OTP"}
                            </div>
                        </div>
                        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
                            This code will expire in 5 minutes.
                        </p>
                    </div>
                </div>`
        };

        const result = await transporter.sendMail(mailOptions);
        console.log("✅ Email sent successfully:", result.messageId);
        return true;
    } catch (error) {
        console.error("❌ Email sending failed:", error);
        // Fallback: Log to console
        console.log("📧 EMAIL FAILED - FALLBACK TO CONSOLE:");
        console.log("📧 To:", to);
        console.log("📧 Subject:", subject);
        console.log("📧 Content:", text);
        console.log("📧 OTP:", text.match(/\d{6}/)?.[0] || "No OTP found");
        return false;
    }
};

// ✅ JWT Middleware
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access Denied" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(400).json({ error: "Invalid Token" });
    }
};

// 1️⃣ Login
router.post("/login", async (req, res) => {
    console.log("Login request received",req.body);
    const { email, password } = req.body;
    const lowerEmail = email.toLowerCase();

    try {
        const user = await User.findOne({ email: lowerEmail });
        if (!user) return res.status(400).json({ error: "❌ Invalid email or password" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "❌ Invalid email or password" });

        const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token, message: "✅ Login successful!" });
    } catch {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// 2️⃣ Send OTP (Registration)
router.post("/send-otp", async (req, res) => {
    console.log("Send OTP request received:", req.body);
    const { email } = req.body;
    
    // Validate email
    if (!email) {
        return res.status(400).json({ error: "❌ Email is required" });
    }
    
    const lowerEmail = email.toLowerCase();
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lowerEmail)) {
        return res.status(400).json({ error: "❌ Invalid email format" });
    }

    try {
        // Check if user already exists
        const user = await User.findOne({ email: lowerEmail });
        if (user) {
            return res.status(400).json({ error: "❌ Email already registered. Please login instead." });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        const hashedOTP = await bcrypt.hash(otp.toString(), 10);
        otpStore[lowerEmail] = { 
            hashedOTP, 
            expiresAt: Date.now() + 5 * 60 * 1000,
            attempts: 0
        };

        console.log("Generated OTP for:", lowerEmail, "OTP:", otp);

        // Send email
        const emailSent = await sendEmail(
            lowerEmail, 
            "Your OTP Code", 
            `Your OTP is: ${otp}. It will expire in 5 minutes.`
        );

        if (emailSent) {
            res.json({ 
                message: "✅ OTP sent successfully",
                email: lowerEmail
            });
        } else {
            // If email fails, still return success but log OTP
            console.log("📧 OTP for development:", otp);
            res.json({ 
                message: "✅ OTP sent successfully (check console for development)",
                email: lowerEmail
            });
        }
        
    } catch (error) {
        console.error("❌ Send OTP error:", error);
        res.status(500).json({ 
            error: "❌ Error sending OTP. Please try again." 
        });
    }
});

// 3️⃣ Register
router.post("/register", upload.single('avatar'), async (req, res) => {
    console.log("Register request received:", req.body);
    const { username, email, password, otp } = req.body;
    
    // Validate required fields
    if (!username || !email || !password || !otp) {
        return res.status(400).json({ 
            error: "❌ Missing required fields: username, email, password, otp" 
        });
    }
    
    const lowerEmail = email.toLowerCase();

    try {
        // Check if OTP exists
        if (!otpStore[lowerEmail]) {
            return res.status(400).json({ 
                error: "❌ OTP not found. Please request a new OTP." 
            });
        }

        // Validate OTP
        const isValid = await bcrypt.compare(otp.toString(), otpStore[lowerEmail].hashedOTP);
        if (!isValid || Date.now() > otpStore[lowerEmail].expiresAt) {
            delete otpStore[lowerEmail];
            return res.status(400).json({ 
                error: "❌ Invalid or expired OTP. Please request a new one." 
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: lowerEmail });
        if (existingUser) {
            delete otpStore[lowerEmail];
            return res.status(400).json({ 
                error: "❌ Email already registered. Please login instead." 
            });
        }

        // Handle avatar upload
        let profilePicture = undefined;
        if (req.file) {
            profilePicture = {
                url: `/uploads/${req.file.filename}`,
                lastUpdated: new Date()
            };
        }
        // Create new user
        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = new User({ 
            username, 
            email: lowerEmail, 
            password: hashedPassword,
            encryptionKey: Math.random().toString(36).substring(2, 15), // Add required field
            isActive: true, // Ensure user is active on registration
            ...(profilePicture && { profilePicture })
        });
        
        console.log("Saving new user:", { username, email: lowerEmail });
        await newUser.save();
        console.log("✅ User saved successfully");

        // Clean up OTP
        delete otpStore[lowerEmail];
        
        res.json({ 
            message: "✅ User registered successfully!",
            user: {
                id: newUser._id,
                username: newUser.username,
                email: newUser.email,
                profilePicture: newUser.profilePicture
            }
        });
        
    } catch (error) {
        console.error("❌ Registration error:", error);
        
        // Clean up OTP on error
        if (otpStore[lowerEmail]) {
            delete otpStore[lowerEmail];
        }
        
        // Provide specific error messages
        if (error.code === 11000) {
            return res.status(400).json({ 
                error: "❌ Email or username already exists" 
            });
        }
        
        if (error.name === 'ValidationError') {
            const validationErrors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ 
                error: `❌ Validation error: ${validationErrors.join(', ')}` 
            });
        }
        
        res.status(500).json({ 
            error: "❌ Server error during registration. Please try again." 
        });
    }
});

// 4️⃣ Send OTP for Password Reset
router.post("/send-reset-otp", async (req, res) => {
    const email = req.body.email.toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "❌ Email not registered" });

    const otp = Math.floor(100000 + Math.random() * 900000);
    const hashedOTP = await bcrypt.hash(otp.toString(), 10);
    otpStore[email] = { hashedOTP, expiresAt: Date.now() + 5 * 60 * 1000 };

    try {
        await sendEmail(email, "🔑 Password Reset OTP", `Your OTP is: ${otp}. It expires in 5 minutes.`);
        res.json({ message: "✅ OTP sent successfully" });
    } catch {
        res.status(500).json({ error: "❌ Error sending OTP" });
    }
});

// 5️⃣ Reset Password
router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const lowerEmail = email.toLowerCase();

    if (!otpStore[lowerEmail]) return res.status(400).json({ error: "❌ No OTP found" });

    const isValid = await bcrypt.compare(otp.toString(), otpStore[lowerEmail].hashedOTP);
    if (!isValid || Date.now() > otpStore[lowerEmail].expiresAt) {
        delete otpStore[lowerEmail];
        return res.status(400).json({ error: "❌ Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ email: lowerEmail }, { password: hashedPassword });

    delete otpStore[lowerEmail];
    res.json({ message: "✅ Password reset successful!" });
});

// 6️⃣ Friends List (Protected)
router.get("/friends", verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate("friends", "username isActive");
        res.json(user.friends);
    } catch {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// 7️⃣ Add Friend (Protected)
router.post("/add-friend", verifyToken, async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findById(req.user.userId);
        const friend = await User.findOne({ email });

        if (!friend) return res.status(404).json({ error: "❌ User not found" });
        if (user.friends.includes(friend._id)) return res.status(400).json({ error: "⚠️ Already friends" });

        user.friends.push(friend._id);
        friend.friends.push(user._id);

        await user.save();
        await friend.save();

        res.json({ message: "✅ Friend added successfully" });
    } catch {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;





