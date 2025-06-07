const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
    },
    content: {
        type: String,
        required: true
    },
    encryptedContent: {
        type: String,
        required: true
    },
    attachments: [{
        type: {
            type: String,
            enum: ['image', 'video', 'document', 'audio'],
            required: true
        },
        url: String,
        key: String,
        name: String,
        size: Number,
        mimeType: String,
        uploadedAt: Date
    }],
    metadata: {
        isEncrypted: {
            type: Boolean,
            default: true
        },
        isSelfDestructing: {
            type: Boolean,
            default: false
        },
        selfDestructAt: Date,
        isPrivate: {
            type: Boolean,
            default: false
        },
        readBy: [{
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            },
            readAt: Date
        }]
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read', 'deleted'],
        default: 'sent'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    deletedAt: Date
}, {
    timestamps: true
});

// Index for efficient querying
messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
messageSchema.index({ group: 1, createdAt: -1 });
messageSchema.index({ 'metadata.selfDestructAt': 1 });

// Method to mark message as read
messageSchema.methods.markAsRead = async function(userId) {
    if (!this.metadata.readBy.some(read => read.user.toString() === userId.toString())) {
        this.metadata.readBy.push({
            user: userId,
            readAt: new Date()
        });
        this.status = 'read';
        await this.save();
    }
};

// Method to soft delete message
messageSchema.methods.softDelete = async function() {
    this.deletedAt = new Date();
    this.status = 'deleted';
    await this.save();
};

// Method to check if message should be self-destructed
messageSchema.methods.shouldSelfDestruct = function() {
    if (!this.metadata.isSelfDestructing) return false;
    return this.metadata.selfDestructAt && new Date() >= this.metadata.selfDestructAt;
};

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;

