const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateEncryptionKey } = require('../utils/security');
const { uploadAvatar, deleteAvatar } = require('../utils/cloudinary');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');

// Configure multer for memory storage (file will be in memory before upload to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'), false);
    }
  }
});

// Error handling middleware for multer
router.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: 'Multer error', error: err.message });
  }
  next(err);
});

// Single endpoint for avatar upload
router.put('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    console.log('Avatar upload request received');
    
    if (!req.file) {
      console.error('No file in request');
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded. Please select an image to upload.' 
      });
    }

    console.log('File received:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer ? `Buffer(${req.file.buffer.length} bytes)` : 'No buffer'
    });

    const user = await User.findById(req.user.userId);
    if (!user) {
      console.error('User not found:', req.user.userId);
      return res.status(404).json({ 
        success: false,
        message: 'User not found. Please log in again.' 
      });
    }

    // Delete old avatar if exists
    if (user.profilePicture?.publicId) {
      try {
        console.log('Deleting old avatar with publicId:', user.profilePicture.publicId);
        await deleteAvatar(user.profilePicture.publicId);
      } catch (error) {
        console.error('Error deleting old avatar:', error);
        // Continue with upload even if deletion fails
      }
    }

    console.log('Uploading new avatar to Cloudinary...');
    
    // Upload new avatar to Cloudinary using buffer directly
    const result = await uploadAvatar({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    }, user._id.toString());

    if (!result || !result.versions) {
      console.error('Invalid upload result:', result);
      throw new Error('Invalid response from Cloudinary. Please try again.');
    }

    console.log('Avatar upload successful, updating user...');
    
    // Update user with new avatar
    user.profilePicture = {
      versions: result.versions,
      publicId: result.publicId,
      lastUpdated: new Date()
    };

    await user.save();
    console.log('User updated with new avatar');

    return res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      profilePicture: user.profilePicture
    });
    
  } catch (error) {
    console.error('Avatar upload error:', error);
    
    // More specific error handling
    let errorMessage = 'Error uploading avatar';
    let statusCode = 500;
    
    if (error.message.includes('File too large')) {
      statusCode = 413;
      errorMessage = 'File is too large. Maximum size is 5MB.';
    } else if (error.message.includes('Invalid file type')) {
      statusCode = 400;
      errorMessage = 'Invalid file type. Only JPG, PNG, GIF, and WebP images are allowed.';
    } else if (error.message.includes('Cloudinary')) {
      errorMessage = 'Error uploading to image service. Please try again.';
    }
    
    res.status(statusCode).json({ 
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    console.log("req.user in /profile:", req.user);

    const user = await User.findById(req.user.userId)
      .select('-password -encryptionKey')
      .populate('friends', 'username profilePicture isOnline lastSeen');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Return user data in the format expected by frontend
    res.json({ user });
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

// Debug route to check avatar in database
router.get('/avatar-check', authenticate, async (req, res) => {
  console.log('=== AVATAR DATABASE CHECK ===');
  console.log('User ID:', req.user?.userId);
  
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('User found in database');
    console.log('User profilePicture field:', user.profilePicture);
    
    const avatarInfo = {
      userId: user._id,
      username: user.username,
      email: user.email,
      hasProfilePicture: !!user.profilePicture,
      profilePicture: user.profilePicture,
      lastUpdated: user.profilePicture?.lastUpdated
    };
    
    console.log('Avatar info response:', avatarInfo);
    res.json(avatarInfo);
    
  } catch (error) {
    console.error('=== AVATAR CHECK ERROR ===');
    console.error('Error details:', error);
    res.status(500).json({ 
      message: 'Error checking avatar', 
      error: error.message 
    });
  }
});

module.exports = router;
