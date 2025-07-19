const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadFile, deleteFile } = require('../utils/storage');
const { generateEncryptionKey } = require('../utils/security');
const User = require('../models/User');

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Get user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-password -encryptionKey')
      .populate('friends', 'username profilePicture isOnline lastSeen');
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Error fetching profile', error: error.message });
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, email, bio, profilePicture } = req.body;
    const updateFields = {};
    if (username) updateFields.username = username;
    if (email) updateFields.email = email;
    if (bio !== undefined) updateFields.bio = bio;
    if (profilePicture) updateFields.profilePicture = profilePicture;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('-password -encryptionKey');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
});

// Upload profile picture
router.post('/profile/picture', authenticate, upload.single('picture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const user = await User.findById(req.user.userId);
    
    // Delete old profile picture if exists
    if (user.profilePicture?.key) {
      await deleteFile(user.profilePicture.key, user.profilePicture.provider);
    }

    // Upload new picture
    const result = await uploadFile(req.file, {
      provider: 's3',
      folder: 'profile-pictures',
      processImage: true,
      imageOptions: {
        width: 400,
        height: 400,
        format: 'jpeg',
        quality: 90
      }
    });

    user.profilePicture = {
      url: result.url,
      key: result.key,
      provider: 's3',
      lastUpdated: new Date()
    };

    await user.save();
    res.json({ message: 'Profile picture updated', url: result.url });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading profile picture' });
  }
});

// Update user avatar
router.put('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    console.log('Avatar upload - User from token:', req.user); // Debug log
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const user = await User.findById(req.user.userId);
    console.log('Avatar upload - Found user:', user ? 'Yes' : 'No'); // Debug log
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.profilePicture = {
      url: `/uploads/${req.file.filename}`,
      lastUpdated: new Date()
    };
    await user.save();
    res.json({ message: 'Avatar updated', user });
  } catch (error) {
    console.error('Error updating avatar:', error);
    res.status(500).json({ message: 'Error updating avatar', error: error.message });
  }
});

// Friend management
router.post('/friends/request/:userId', authenticate, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if request already exists
    const existingRequest = targetUser.friendRequests.find(
      request => request.from.toString() === req.user.userId.toString()
    );

    if (existingRequest) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }

    targetUser.friendRequests.push({
      from: req.user.userId,
      status: 'pending'
    });

    await targetUser.save();
    res.json({ message: 'Friend request sent' });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({ message: 'Error sending friend request', error: error.message });
  }
});

// Accept friend request
router.post('/friends/accept/:requestId', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const request = user.friendRequests.id(req.params.requestId);

    if (!request) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    request.status = 'accepted';
    
    // Add to friends list for both users
    user.friends.push(request.from);
    const friend = await User.findById(request.from);
    friend.friends.push(user._id);
    
    await Promise.all([user.save(), friend.save()]);
    res.json({ message: 'Friend request accepted' });
  } catch (error) {
    console.error('Error accepting friend request:', error);
    res.status(500).json({ message: 'Error accepting friend request', error: error.message });
  }
});

// Security settings
router.put('/security/2fa', authenticate, async (req, res) => {
  try {
    const { enable } = req.body;
    const user = await User.findById(req.user.userId);
    
    user.securitySettings.twoFactorEnabled = enable;
    await user.save();
    
    res.json({ message: `Two-factor authentication ${enable ? 'enabled' : 'disabled'}` });
  } catch (error) {
    res.status(500).json({ message: 'Error updating security settings' });
  }
});

// Backup settings
router.put('/backup/settings', authenticate, async (req, res) => {
  try {
    const { provider, autoBackup } = req.body;
    const user = await User.findById(req.user.userId);
    
    user.backupSettings.provider = provider;
    user.backupSettings.autoBackup = autoBackup;
    await user.save();
    
    res.json({ message: 'Backup settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating backup settings' });
  }
});

// Account deletion
router.delete('/account', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    // Soft delete user
    await user.softDelete();
    
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting account' });
  }
});

module.exports = router; 