const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { logger } = require('./utils/security');
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Created uploads directory');
}

dotenv.config();
require("./config"); // MongoDB connection

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const uploadRoutes = require("./routes/upload");
const friendRoutes = require("./routes/friends");
const chatRoutes = require("./routes/chat");
const User = require("./models/User"); // ✅ Ensure this path is correct

const app = express();

app.use(express.json()); 
const server = http.createServer(app);

// Global request logger to debug all incoming requests
app.use((req, res, next) => {
  console.log('Incoming request:', req.method, req.originalUrl);
  next();
});

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

// Middleware
app.use(helmet());
app.use(compression());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

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
app.use("/uploads", express.static(path.join(__dirname, 'uploads')));
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

// WebSocket connection handling
const connectedUsers = new Map();

io.on('connection', (socket) => {
    logger.info('New client connected:', socket.id);

    // Handle user authentication
    socket.on('authenticate', async (token) => {
        try {
            const decoded = require('./utils/security').verifyToken(token);
            if (!decoded) {
                socket.disconnect();
                return;
            }

            const user = await require('./models/User').findById(decoded.id);
            if (!user) {
                socket.disconnect();
                return;
            }

            // Update user's online status
            user.isOnline = true;
            user.lastSeen = new Date();
            await user.save();

            // Store socket connection
            connectedUsers.set(user._id.toString(), socket.id);
            socket.userId = user._id.toString();

            // Notify friends about online status
            const friends = await require('./models/User').find({
                _id: { $in: user.friends }
            });

            friends.forEach(friend => {
                const friendSocketId = connectedUsers.get(friend._id.toString());
                if (friendSocketId) {
                    io.to(friendSocketId).emit('friendStatus', {
                        userId: user._id,
                        isOnline: true,
                        lastSeen: user.lastSeen
                    });
                }
            });

            // Join user's groups
            const groups = await require('./models/Group').find({
                'members.user': user._id
            });

            groups.forEach(group => {
                socket.join(`group:${group._id}`);
            });

        } catch (error) {
            logger.error('Socket authentication error:', error);
            socket.disconnect();
        }
    });

    // Handle private messages
    socket.on('privateMessage', async (data) => {
        try {
            const { recipientId, content, isSelfDestructing, selfDestructTime } = data;
            const recipientSocketId = connectedUsers.get(recipientId);

            // Save message to database
            const message = new (require('./models/Message'))({
                sender: socket.userId,
                recipient: recipientId,
                content,
                metadata: {
                    isEncrypted: true,
                    isSelfDestructing,
                    selfDestructAt: isSelfDestructing ? new Date(Date.now() + selfDestructTime) : null
                }
            });

            await message.save();

            // Send message to recipient if online
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('newMessage', {
                    messageId: message._id,
                    sender: socket.userId,
                    content,
                    timestamp: message.createdAt
                });
            }

            // Send confirmation to sender
            socket.emit('messageSent', {
                messageId: message._id,
                timestamp: message.createdAt
            });

        } catch (error) {
            logger.error('Private message error:', error);
            socket.emit('error', { message: 'Error sending message' });
        }
    });

    // Handle group messages
    socket.on('groupMessage', async (data) => {
        try {
            const { groupId, content, isSelfDestructing, selfDestructTime } = data;

            // Save message to database
            const message = new (require('./models/Message'))({
                sender: socket.userId,
                group: groupId,
                content,
                metadata: {
                    isEncrypted: true,
                    isSelfDestructing,
                    selfDestructAt: isSelfDestructing ? new Date(Date.now() + selfDestructTime) : null
                }
            });

            await message.save();

            // Broadcast to group
            io.to(`group:${groupId}`).emit('newGroupMessage', {
                messageId: message._id,
                sender: socket.userId,
                content,
                timestamp: message.createdAt
            });

        } catch (error) {
            logger.error('Group message error:', error);
            socket.emit('error', { message: 'Error sending group message' });
        }
    });

    // Handle typing indicators
    socket.on('typing', (data) => {
        const { recipientId, isTyping } = data;
        const recipientSocketId = connectedUsers.get(recipientId);

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('userTyping', {
                userId: socket.userId,
                isTyping
            });
        }
    });

    // Handle group typing indicators
    socket.on('groupTyping', (data) => {
        const { groupId, isTyping } = data;
        socket.to(`group:${groupId}`).emit('userTypingGroup', {
            userId: socket.userId,
            groupId,
            isTyping
        });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        try {
            if (socket.userId) {
                const user = await require('./models/User').findById(socket.userId);
                if (user) {
                    user.isOnline = false;
                    user.lastSeen = new Date();
                    await user.save();

                    // Notify friends about offline status
                    const friends = await require('./models/User').find({
                        _id: { $in: user.friends }
                    });

                    friends.forEach(friend => {
                        const friendSocketId = connectedUsers.get(friend._id.toString());
                        if (friendSocketId) {
                            io.to(friendSocketId).emit('friendStatus', {
                                userId: user._id,
                                isOnline: false,
                                lastSeen: user.lastSeen
                            });
                        }
                    });
                }

                connectedUsers.delete(socket.userId);
            }
        } catch (error) {
            logger.error('Disconnect error:', error);
        }
    });
});

// Add this at the end of your server.js, after all routes
const multer = require('multer');
app.use(function (err, req, res, next) {
  if (err instanceof multer.MulterError) {
    console.error('Global Multer error:', err);
    return res.status(400).json({ message: 'Multer error', error: err.message });
  }
  next(err);
});

// ✅ Server listener
console.log("🛠 Starting backend server...");

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        logger.info('Connected to MongoDB');

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            logger.info(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch((error) => {
        logger.error('❌ MongoDB connection error:', error.stack);
        process.exit(1);
    });

process.on('unhandledRejection', (error) => {
    logger.error('❌ Unhandled rejection:', error.stack);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    logger.error('❌ Uncaught exception:', error.stack);
    process.exit(1);
});


// Error handling
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});



