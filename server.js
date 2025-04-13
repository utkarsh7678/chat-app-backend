const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
require("./config"); // MongoDB connection

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const uploadRoutes = require("./routes/upload");
const friendRoutes = require("./routes/friends");
const chatRoutes = require("./routes/chat");
const User = require("./models/User"); // ✅ Ensure this path is correct

const app = express();
const server = http.createServer(app);

// ✅ Allowed origins for CORS
const allowedOrigins = [
    "http://localhost:5173",
    "https://chat-app-frontend-ozpy.onrender.com"
];

// ✅ Express CORS setup
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("CORS Not Allowed: " + origin));
        }
    },
    credentials: true
}));

app.use(express.json());

// ✅ Socket.IO with CORS config
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// ✅ API Routes
app.use("/auth", authRoutes);
app.use("/api", chatRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);

let users = {}; // For tracking online users

// ✅ Socket.IO events
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("user-online", async (email) => {
        const user = await User.findOneAndUpdate(
            { email },
            { isActive: true },
            { new: true }
        );

        if (user) {
            users[socket.id] = { email: user.email, username: user.username };
            console.log(`${user.username} is online`);

            io.emit("userList", Object.values(users).map(user => ({
                username: user.username,
                email: user.email
            })));
        }
    });

    socket.on("user-offline", async (email) => {
        await User.findOneAndUpdate({ email }, { isActive: false });
        delete users[socket.id];

        io.emit("userList", Object.values(users).map(user => ({
            username: user.username,
            email: user.email
        })));
    });

    socket.on("disconnect", async () => {
        const user = users[socket.id];
        if (user) {
            await User.findOneAndUpdate({ email: user.email }, { isActive: false });
            console.log(`${user.username} disconnected`);
            delete users[socket.id];

            io.emit("userList", Object.values(users).map(user => ({
                username: user.username,
                email: user.email
            })));
        }
    });

    socket.on("sendMessage", (data) => {
        io.emit("receiveMessage", data);
    });
});

// ✅ Server listener
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
}).on("error", (err) => {
    console.error("❌ Server Error:", err.message);
    process.exit(1);
});



