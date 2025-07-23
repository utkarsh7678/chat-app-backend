const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireRole, requireGroupAccess } = require('../middleware/auth');
const { uploadFile, deleteFile } = require('../utils/storage');
const Group = require('../models/Group');
const User = require('../models/User');

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for group avatars
  }
});

// Create new group
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, isPrivate } = req.body;
    
    const group = new Group({
      name,
      description,
      creator: req.user.userId,
      admins: [req.user.userId],
      members: [{
        user: req.user.userId,
        role: 'admin',
        joinedAt: new Date()
      }],
      settings: {
        isPrivate: isPrivate || false
      },
      metadata: {
        memberCount: 1
      }
    });

    await group.save();
    
    // Add group to user's groups
    await User.findByIdAndUpdate(req.user.userId, {
      $push: { groups: group._id }
    });

    res.status(201).json({
      message: 'Group created successfully',
      group: await group.populate('members.user', 'username profilePicture')
    });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ message: 'Error creating group', error: error.message });
  }
});

// Get group details
router.get('/:groupId', authenticate, requireGroupAccess, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId)
      .populate('members.user', 'username profilePicture isOnline lastSeen')
      .populate('admins', 'username profilePicture');
    
    res.json(group);
  } catch (error) {
    console.error('Error fetching group details:', error);
    res.status(500).json({ message: 'Error fetching group details', error: error.message });
  }
});

// Update group settings
router.put('/:groupId/settings', authenticate, requireGroupAccess, async (req, res) => {
  try {
    const { name, description, isPrivate, allowInvites, messageRetention, maxFileSize } = req.body;
    
    // Check if user is admin
    const isAdmin = req.group.admins.includes(req.user.userId);
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can update group settings' });
    }

    if (name) req.group.name = name;
    if (description) req.group.description = description;
    if (typeof isPrivate === 'boolean') req.group.settings.isPrivate = isPrivate;
    if (typeof allowInvites === 'boolean') req.group.settings.allowInvites = allowInvites;
    if (messageRetention) req.group.settings.messageRetention = messageRetention;
    if (maxFileSize) req.group.settings.maxFileSize = maxFileSize;

    await req.group.save();
    res.json({ message: 'Group settings updated successfully' });
  } catch (error) {
    console.error('Error updating group settings:', error);
    res.status(500).json({ message: 'Error updating group settings', error: error.message });
  }
});

// Upload group avatar
router.post('/:groupId/avatar', authenticate, requireGroupAccess, upload.single('avatar'), async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.group.admins.includes(req.user.userId);
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can update group avatar' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Delete old avatar if exists
    if (req.group.avatar?.key) {
      await deleteFile(req.group.avatar.key, req.group.avatar.provider);
    }

    // Upload new avatar
    const result = await uploadFile(req.file, {
      provider: 's3',
      folder: 'group-avatars',
      processImage: true,
      imageOptions: {
        width: 400,
        height: 400,
        format: 'jpeg',
        quality: 90
      }
    });

    req.group.avatar = {
      url: result.url,
      key: result.key,
      provider: 's3',
      lastUpdated: new Date()
    };

    await req.group.save();
    res.json({ message: 'Group avatar updated', url: result.url });
  } catch (error) {
    console.error('Error uploading group avatar:', error);
    res.status(500).json({ message: 'Error uploading group avatar', error: error.message });
  }
});

// Invite user to group
router.post('/:groupId/invite/:userId', authenticate, requireGroupAccess, async (req, res) => {
  try {
    // Check if group allows invites
    if (!req.group.settings.allowInvites) {
      return res.status(403).json({ message: 'This group does not allow invites' });
    }

    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is already a member
    const isMember = req.group.members.some(
      member => member.user.toString() === targetUser._id.toString()
    );

    if (isMember) {
      return res.status(400).json({ message: 'User is already a member' });
    }

    // Add user to group
    await req.group.addMember(targetUser._id);
    
    // Add group to user's groups
    await User.findByIdAndUpdate(targetUser._id, {
      $push: { groups: req.group._id }
    });

    res.json({ message: 'User invited to group successfully' });
  } catch (error) {
    console.error('Error inviting user to group:', error);
    res.status(500).json({ message: 'Error inviting user to group', error: error.message });
  }
});

// Remove user from group
router.delete('/:groupId/members/:userId', authenticate, requireGroupAccess, async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.group.admins.includes(req.user.userId);
    if (!isAdmin && req.user.userId.toString() !== req.params.userId) {
      return res.status(403).json({ message: 'Not authorized to remove members' });
    }

    // Check if trying to remove the last admin
    if (isAdmin && req.group.admins.length === 1 && req.group.admins[0].toString() === req.params.userId) {
      return res.status(400).json({ message: 'Cannot remove the last admin' });
    }

    await req.group.removeMember(req.params.userId);
    
    // Remove group from user's groups
    await User.findByIdAndUpdate(req.params.userId, {
      $pull: { groups: req.group._id }
    });

    res.json({ message: 'User removed from group successfully' });
  } catch (error) {
    console.error('Error removing user from group:', error);
    res.status(500).json({ message: 'Error removing user from group', error: error.message });
  }
});

// Update member role
router.put('/:groupId/members/:userId/role', authenticate, requireGroupAccess, async (req, res) => {
  try {
    const { role } = req.body;
    
    // Check if user is admin
    const isAdmin = req.group.admins.includes(req.user.userId);
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can update member roles' });
    }

    // Validate role
    if (!['admin', 'moderator', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    await req.group.updateMemberRole(req.params.userId, role);

    // Update admins list if role is admin
    if (role === 'admin') {
      req.group.admins.push(req.params.userId);
    } else {
      req.group.admins = req.group.admins.filter(
        admin => admin.toString() !== req.params.userId
      );
    }

    await req.group.save();
    res.json({ message: 'Member role updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating member role' });
  }
});

// Leave group
router.post('/:groupId/leave', authenticate, requireGroupAccess, async (req, res) => {
  try {
    // Check if trying to leave as last admin
    if (
      req.group.admins.length === 1 &&
      req.group.admins[0].toString() === req.user.userId.toString()
    ) {
      return res.status(400).json({ message: 'Cannot leave as the last admin' });
    }

    await req.group.removeMember(req.user.userId);
    
    // Remove group from user's groups
    await User.findByIdAndUpdate(req.user.userId, {
      $pull: { groups: req.group._id }
    });

    res.json({ message: 'Left group successfully' });
  } catch (error) {
    console.error('Error leaving group:', error);
    res.status(500).json({ message: 'Error leaving group', error: error.message });
  }
});

// Delete group
router.delete('/:groupId', authenticate, requireGroupAccess, async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.group.admins.includes(req.user.userId);
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can delete the group' });
    }

    await req.group.softDelete();
    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ message: 'Error deleting group', error: error.message });
  }
});

module.exports = router; 