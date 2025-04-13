require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const router = express.Router();

let otpStore = {}; // Temporary in-memory storage

// ✅ Email Setup
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

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
    const email = req.body.email.toLowerCase();
    const user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: "❌ Email already used" });

    const otp = Math.floor(100000 + Math.random() * 900000);
    const hashedOTP = await bcrypt.hash(otp.toString(), 10);
    otpStore[email] = { hashedOTP, expiresAt: Date.now() + 5 * 60 * 1000 };

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your OTP Code",
            text: `Your OTP is: ${otp}. It will expire in 5 minutes.`,
        });
        res.json({ message: "✅ OTP sent successfully" });
    } catch {
        res.status(500).json({ error: "❌ Error sending OTP" });
    }
});

// 3️⃣ Register
router.post("/register", async (req, res) => {
    const { username, email, password, otp } = req.body;
    const lowerEmail = email.toLowerCase();

    if (!otpStore[lowerEmail]) return res.status(400).json({ error: "❌ OTP not found. Request again." });

    const isValid = await bcrypt.compare(otp.toString(), otpStore[lowerEmail].hashedOTP);
    if (!isValid || Date.now() > otpStore[lowerEmail].expiresAt) {
        delete otpStore[lowerEmail];
        return res.status(400).json({ error: "❌ Invalid or expired OTP" });
    }

    try {
        const existingUser = await User.findOne({ email: lowerEmail });
        if (existingUser) return res.status(400).json({ error: "❌ Email already used" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email: lowerEmail, password: hashedPassword });
        await newUser.save();

        delete otpStore[lowerEmail];
        res.json({ message: "✅ User registered successfully!" });
    } catch {
        res.status(500).json({ error: "❌ Server error" });
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
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "🔑 Password Reset OTP",
            text: `Your OTP is: ${otp}. It expires in 5 minutes.`,
        });
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





