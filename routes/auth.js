require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const router = express.Router();
const jwt = require("jsonwebtoken");
let otpStore = {}; // Temporary OTP storage (Consider Redis for production)

// ✅ Nodemailer Setup
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// 1️⃣ **User Login**
router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ error: "❌ Invalid email or password" });

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(400).json({ error: "❌ Invalid email or password" });
        const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

        res.json({ token, message: "✅ Login successful!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error, please try again" });
    }
});

// 2️⃣ **Send OTP for Registration**
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
    } catch (error) {
        console.error("Error sending OTP:", error);
        res.status(500).json({ error: "❌ Error sending OTP" });
    }
});

// 3️⃣ **Register User after OTP Verification**
router.post("/register", async (req, res) => {
    const { username, email, password, otp } = req.body;
    const lowerEmail = email.toLowerCase();

    if (!otpStore[lowerEmail]) return res.status(400).json({ error: "❌ OTP not found. Request a new one." });
    
    const isValidOTP = await bcrypt.compare(otp.toString(), otpStore[lowerEmail].hashedOTP);
    if (!isValidOTP || Date.now() > otpStore[lowerEmail].expiresAt) {
        delete otpStore[lowerEmail];
        return res.status(400).json({ error: "❌ Invalid or expired OTP" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email: lowerEmail, password: hashedPassword });
        await newUser.save();
        delete otpStore[lowerEmail];
        res.json({ message: "✅ User registered successfully!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error, please try again" });
    }
});

// 4️⃣ **Send OTP for Password Reset**
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
    } catch (error) {
        console.error("Error sending OTP:", error);
        res.status(500).json({ error: "❌ Error sending OTP" });
    }
});

// 5️⃣ **Reset Password**
router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const lowerEmail = email.toLowerCase();

    if (!otpStore[lowerEmail]) return res.status(400).json({ error: "❌ No OTP found, request again" });

    const isValidOTP = await bcrypt.compare(otp.toString(), otpStore[lowerEmail].hashedOTP);
    if (!isValidOTP || Date.now() > otpStore[lowerEmail].expiresAt) {
        delete otpStore[lowerEmail];
        return res.status(400).json({ error: "❌ Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ email: lowerEmail }, { password: hashedPassword });
    delete otpStore[lowerEmail];
    res.json({ message: "✅ Password reset successful!" });
});
router.get("/friends", async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId).populate("friends", "username isActive");
        res.json(user.friends);
    } catch (error) {
        res.status(500).json({ error: "Server Error" });
    }
});
router.post("/add-friend", async (req, res) => {
    const { email } = req.body;
    const userId = req.user.userId;

    try {
        const user = await User.findById(userId);
        const friend = await User.findOne({ email });

        if (!friend) return res.status(404).json({ error: "User not found" });

        if (user.friends.includes(friend._id)) {
            return res.status(400).json({ error: "Already friends!" });
        }

        user.friends.push(friend._id);
        friend.friends.push(user._id);

        await user.save();
        await friend.save();

        res.json({ message: "Friend added successfully!" });
    } catch (error) {
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;




