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
const userRoute= require("./routes/users");
const uploadRoutes = require("./routes/upload");
const friendRoutes = require("./routes/friends");
const chatRoutes = require("./routes/chat");
const User = require("./models/User"); // ✅ Ensure this path is correct
const ensureAbsoluteAvatarUrls = require('./middleware/avatarUrlMiddleware');

const app = express();
//app.use('/api/user', require('./routes/user'));

// Increase the request size limit for JSON and URL-encoded data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Create HTTP server with increased timeout
const server = http.createServer(app);
server.timeout = 300000; // 5 minutes timeout for large uploads

// Apply middleware to ensure avatar URLs are absolute
app.use(ensureAbsoluteAvatarUrls);

// Serve static files from uploads directory
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('Uploads directory created at:', uploadsPath);
}
app.use('/uploads', express.static(uploadsPath));
console.log('Serving static files from:', uploadsPath);

// Global request logger to debug all incoming requests
app.use((req, res, next) => {
  console.log('Incoming request:', req.method, req.originalUrl);
  next();
});

// Allowed origins for CORS
const allowedOrigins = [
    "http://localhost:5173",
    "https://chat-app-frontend-ozpy.onrender.com",
    "https://realtime-chat-app-frontend.onrender.com",
    "https://realtime-chat-frontend.onrender.com",
    "https://realtime-chat-app-z27k.onrender.com"  // Add production API URL
];

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    console.error('CORS blocked for origin:', origin);
    return callback(new Error(msg), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma',
    'Expires'
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
  maxAge: 600, // Cache preflight request for 10 minutes
  preflightContinue: false
};

// Apply CORS with options
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Log CORS errors
app.use((err, req, res, next) => {
  if (err) {
    console.error('CORS Error:', err);
    res.status(403).json({ 
      success: false,
      message: 'CORS Error', 
      error: err.message 
    });
  } else {
    next();
  }
});

// Mount routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoute);
app.use('/api/upload', uploadRoutes); 
app.use('/api/friends', friendRoutes);
app.use('/api/chat', chatRoutes);

// Middleware with helmet configured for static files
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "*"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"]
    }
  }
}));
app.use(compression());

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
// Serve static files with CORS headers
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
}, express.static(path.join(__dirname, 'uploads')));

console.log('Static file serving configured for /uploads with CORS headers');
// ✅ API Routes
console.log('Registering routes...');
app.use("/auth", authRoutes);
app.use("/api", chatRoutes);
app.use("/api/upload", uploadRoutes);
console.log('Registering /api/user routes...');
app.use("/api/user", userRoutes);
console.log('Registering /api/users routes...');
app.use("/api/users", userRoute);

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

// Error handling middleware
app.use(function (err, req, res, next) {
  // Log the error for debugging
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      error: err.message
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }

  // Handle multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'File too large. Maximum size is 5MB.'
    });
  }

  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      success: false,
      message: 'Invalid file type. Only images are allowed.'
    });
  }

  // Handle 404 for missing files in uploads
  if (err.status === 404 && req.path.startsWith('/uploads/')) {
    return res.status(404).json({
      success: false,
      message: 'Avatar not found',
      error: 'The requested avatar was not found on the server.'
    });
  }
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
