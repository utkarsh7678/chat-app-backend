const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
    },
    profilePicture: {
        type: String, // URL of uploaded profile picture
        default: "",  // or a placeholder image URL
    },
    isActive: {
        type: Boolean,
        default: false,
    },
    friends: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    }],
     groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "Group" }],
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);


