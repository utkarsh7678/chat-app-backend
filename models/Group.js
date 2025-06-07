const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  avatar: {
    url: String,
    key: String,
    lastUpdated: Date
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['admin', 'moderator', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  settings: {
    isPrivate: {
      type: Boolean,
      default: false
    },
    allowInvites: {
      type: Boolean,
      default: true
    },
    messageRetention: {
      type: Number, // in days, 0 for unlimited
      default: 0
    },
    maxFileSize: {
      type: Number, // in bytes
      default: 2147483648 // 2GB
    }
  },
  metadata: {
    lastActivity: Date,
    messageCount: {
      type: Number,
      default: 0
    },
    memberCount: {
      type: Number,
      default: 0
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  deletedAt: Date
}, {
  timestamps: true
});

// Indexes for efficient querying
groupSchema.index({ name: 'text', description: 'text' });
groupSchema.index({ 'members.user': 1 });
groupSchema.index({ 'metadata.lastActivity': -1 });

// Method to add member
groupSchema.methods.addMember = async function(userId, role = 'member') {
  if (!this.members.some(member => member.user.toString() === userId.toString())) {
    this.members.push({
      user: userId,
      role,
      joinedAt: new Date()
    });
    this.metadata.memberCount += 1;
    await this.save();
  }
};

// Method to remove member
groupSchema.methods.removeMember = async function(userId) {
  const memberIndex = this.members.findIndex(member => member.user.toString() === userId.toString());
  if (memberIndex !== -1) {
    this.members.splice(memberIndex, 1);
    this.metadata.memberCount -= 1;
    await this.save();
  }
};

// Method to update member role
groupSchema.methods.updateMemberRole = async function(userId, newRole) {
  const member = this.members.find(member => member.user.toString() === userId.toString());
  if (member) {
    member.role = newRole;
    await this.save();
  }
};

// Method to soft delete group
groupSchema.methods.softDelete = async function() {
  this.deletedAt = new Date();
  await this.save();
};

const Group = mongoose.model("Group", groupSchema);

module.exports = Group;
