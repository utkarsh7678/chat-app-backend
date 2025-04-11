const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    message: String,
    timestamp: { type: Date, default: Date.now },
    expiresAt: { type: Date, expires: '60s', default: Date.now } // Auto-delete after 60 seconds
});

module.exports = mongoose.model("Message", MessageSchema);

