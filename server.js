const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const cors = require("cors");
const authRoutes = require("./routes/auth");

const userRoutes = require("./routes/users");
const uploadRoutes = require("./routes/upload");
const friendRoutes = require("./routes/friends");
require("dotenv").config();
require("./config"); // Ensure MongoDB connection is established

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || "*",
        methods: ["GET", "POST"],
    },
});

app.use(cors());
app.use(express.json());

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/auth", authRoutes);
app.use("/api", require("./routes/chat"));
app.use("/api/upload", uploadRoutes);
app.use("/uploads", express.static("uploads")); // to serve images publicly

app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
let users = {}; // Store connected users

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join", (username) => {
        users[socket.id] = username;
        io.emit("userList", Object.values(users));
    });

    socket.on("sendMessage", (data) => {
        io.emit("receiveMessage", data);
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
        io.emit("userList", Object.values(users));
        console.log("User disconnected:", socket.id);
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
}).on("error", (err) => {
    console.error("❌ Server Error:", err.message);
    process.exit(1);
});


