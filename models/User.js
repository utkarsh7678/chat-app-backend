const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
    },
    profilePicture: {
        url: String,
        key: String,
        lastUpdated: Date
    },
    isActive: {
        type: Boolean,
        default: false,
    },
    friends: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
    friendRequests: [{
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "Group" }],
    encryptionKey: {
        type: String,
        required: true
    },
    backupSettings: {
        provider: {
            type: String,
            enum: ['mongodb', 'google_drive', 'aws_s3'],
            default: 'mongodb'
        },
        lastBackup: Date,
        autoBackup: {
            type: Boolean,
            default: false
        }
    },
    securitySettings: {
        twoFactorEnabled: {
            type: Boolean,
            default: false
        },
        lastLogin: Date,
        loginAttempts: {
            type: Number,
            default: 0
        },
        accountLocked: {
            type: Boolean,
            default: false
        }
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: Date,
    createdAt: {
        type: Date,
        default: Date.now
    },
    deletedAt: Date
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Method to soft delete user
userSchema.methods.softDelete = async function() {
    this.deletedAt = new Date();
    await this.save();
};

// Method to check if user is deleted
userSchema.methods.isDeleted = function() {
    return !!this.deletedAt;
};

module.exports = mongoose.model("User", userSchema);




