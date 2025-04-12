const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
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

   // Handle user joining by email and username
   socket.on("user-online", async (email) => {
    // Fetch user data from DB by email
    const user = await User.findOneAndUpdate(
        { email },
        { isActive: true }, // Set user as active
        { new: true }
    );

    if (user) {
        // Store user with socket ID and username
        users[socket.id] = { email: user.email, username: user.username };
        console.log(`${user.username} is online`);

        io.emit("userList", Object.values(users).map(user => ({
            username: user.username, email: user.email
        })));
    }
});
socket.on("user-offline", async (email) => {
    // Update the user's isActive status to false when they disconnect
    await User.findOneAndUpdate({ email }, { isActive: false });

    // Remove the user from the connected users list
    delete users[socket.id];

    io.emit("userList", Object.values(users).map(user => ({
        username: user.username, email: user.email
    })));
});

     // Handle user disconnecting
     socket.on("disconnect", async () => {
        const user = users[socket.id];
        if (user) {
            await User.findOneAndUpdate({ email: user.email }, { isActive: false });
            console.log(`${user.username} disconnected`);

            delete users[socket.id];

            io.emit("userList", Object.values(users).map(user => ({
                username: user.username, email: user.email
            })));
        }
    });
    // Handle sending messages
    socket.on("sendMessage", (data) => {
        io.emit("receiveMessage", data); // Broadcast message to all
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


