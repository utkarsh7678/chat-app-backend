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
router.put('/avatar', (req, res, next) => {
  // First authenticate the request
  authenticate(req, res, (err) => {
    if (err) return next(err);
    
    // Then handle the file upload
    upload.single('avatar')(req, res, async (uploadErr) => {
      try {
        if (uploadErr) {
          console.error('File upload error:', uploadErr);
          if (uploadErr.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
              success: false,
              message: 'File size too large. Maximum size is 5MB.'
            });
          }
          if (uploadErr.message === 'Invalid file type. Only images are allowed.') {
            return res.status(400).json({
              success: false,
              message: uploadErr.message
            });
          }
          throw uploadErr;
        }
        
        // If we get here, the file was uploaded successfully
        await handleAvatarUpload(req, res);
      } catch (error) {
        next(error);
      }
    });
  });
});

// Separate function to handle the avatar upload logic
async function handleAvatarUpload(req, res) {
  try {
    console.log('=== AVATAR UPLOAD REQUEST ===');
    console.log('User ID:', req.user?.userId);
    console.log('Request headers:', {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
      'authorization': req.headers['authorization'] ? 'Bearer [token]' : 'No token'
    });
    
    if (!req.file) {
      console.error('No file in request');
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded. Please select an image to upload.' 
      });
    }
    
    console.log('File info:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer ? `Buffer(${req.file.buffer.length} bytes)` : 'No buffer'
    });

    // Verify Cloudinary config
    const cloudinaryConfig = {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET ? '***' + process.env.CLOUDINARY_API_SECRET.slice(-4) : 'Not set'
    };
    
    console.log('Cloudinary config check:', {
      hasCloudName: !!cloudinaryConfig.cloudName,
      hasApiKey: !!cloudinaryConfig.apiKey,
      hasApiSecret: !!process.env.CLOUDINARY_API_SECRET
    });
    
    if (!cloudinaryConfig.cloudName || !cloudinaryConfig.apiKey || !process.env.CLOUDINARY_API_SECRET) {
      const errorMsg = 'Cloudinary configuration is missing or incomplete';
      console.error(errorMsg, cloudinaryConfig);
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        error: 'Image upload service is temporarily unavailable',
        debug: process.env.NODE_ENV === 'development' ? cloudinaryConfig : undefined
      });
    }

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

    // Log the full result for debugging
    console.log('Cloudinary upload result:', {
      hasResult: !!result,
      secureUrl: result?.secure_url ? 'URL present' : 'No URL',
      publicId: result?.public_id ? 'ID present' : 'No public ID',
      versions: result?.versions ? Object.keys(result.versions) : 'No versions'
    });

    if (!result) {
      console.error('No response received from image service');
      throw new Error('No response received from image service');
    }
    
    if (!result.secure_url && !(result.versions?.original?.url)) {
      console.error('Invalid upload result - missing URL:', {
        hasSecureUrl: !!result.secure_url,
        hasVersions: !!result.versions,
        originalUrl: result.versions?.original?.url ? 'present' : 'missing'
      });
      throw new Error('Invalid response from image service: Missing image URL');
    }

    console.log('Avatar upload successful, updating user...');
    
    // Extract avatar data with fallbacks
    const avatarData = {
      url: result.secure_url || result.versions?.original?.url,
      publicId: result.public_id || result.versions?.original?.public_id,
      width: result.width || result.versions?.original?.width,
      height: result.height || result.versions?.original?.height,
      format: result.format || result.versions?.original?.format
    };
    
    // Validate required fields
    if (!avatarData.url || !avatarData.publicId) {
      console.error('Missing required avatar data:', {
        hasUrl: !!avatarData.url,
        hasPublicId: !!avatarData.publicId,
        resultKeys: Object.keys(result)
      });
      throw new Error('Incomplete data received from image service');
    }

    // Update user's profile picture
    user.profilePicture = avatarData;

    await user.save();

    console.log('Avatar updated successfully');
    return res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      profilePicture: user.profilePicture
    });
  } catch (error) {
    console.error('Error in avatar upload:', error);
    
    let errorMessage = 'Failed to upload avatar';
    let statusCode = 500;
    
    if (error.message.includes('Cloudinary')) {
      errorMessage = 'Error uploading to image service. Please try again.';
      statusCode = 502; // Bad Gateway
    } else if (error.message.includes('file size')) {
      errorMessage = 'File is too large. Maximum size is 5MB.';
      statusCode = 400;
    } else if (error.message.includes('Invalid file type')) {
      errorMessage = 'Invalid file type. Only images are allowed.';
      statusCode = 400;
    }
    
    res.status(statusCode).json({ 
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Upload avatar route
router.post('/upload-avatar', authenticate, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded or invalid file type'
      });
    }

    console.log('File received for upload:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Process the avatar upload
    const result = await uploadAvatar(req.file, req.user.userId);
    
    if (!result || !result.secure_url) {
      throw new Error('Failed to upload image to Cloudinary');
    }

    // Update user's profile picture in the database
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If user already has an avatar, delete the old one from Cloudinary
    if (user.profilePicture && user.profilePicture.publicId) {
      try {
        await deleteAvatar(user.profilePicture.publicId);
      } catch (error) {
        console.error('Error deleting old avatar:', error);
        // Continue even if deletion fails
      }
    }

    // Update user's profile picture
    user.profilePicture = {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format
    };

    await user.save();

    // Return the updated user data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.encryptionKey;

    res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      user: userResponse
    });
  } catch (error) {
    console.error('Error in avatar upload:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar',
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
