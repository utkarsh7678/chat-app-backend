const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateEncryptionKey } = require('../utils/security');
const { uploadAvatar, deleteAvatar } = require('../utils/cloudinary');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');

// Default avatar configuration
const DEFAULT_AVATARS = {
  small: 'https://res.cloudinary.com/demo/image/upload/w_50,h_50,g_face,c_thumb,r_max/avatar.png',
  medium: 'https://res.cloudinary.com/demo/image/upload/w_150,h_150,g_face,c_thumb,r_max/avatar.png',
  large: 'https://res.cloudinary.com/demo/image/upload/w_300,h_300,g_face,c_thumb,r_max/avatar.png',
  original: 'https://res.cloudinary.com/demo/image/upload/avatar.png'
};

// Generate avatar URLs based on configuration
const getAvatarUrls = (profilePicture, userId) => {
  // If no profile picture exists, return default avatars
  if (!profilePicture || !profilePicture.versions) {
    return {
      original: DEFAULT_AVATARS.original,
      large: DEFAULT_AVATARS.large,
      medium: DEFAULT_AVATARS.medium,
      small: DEFAULT_AVATARS.small,
      thumbnail: DEFAULT_AVATARS.small,
      isDefault: true
    };
  }

  const { versions, publicId } = profilePicture;
  const isCloudinary = publicId && publicId.includes('/');
  
  // If using Cloudinary
  if (isCloudinary) {
    const baseUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
    return {
      original: versions.original || `${baseUrl}/${publicId}`,
      large: versions.large || `${baseUrl}/c_fill,w_300,h_300,g_face/${publicId}`,
      medium: versions.medium || `${baseUrl}/c_fill,w_150,h_150,g_face/${publicId}`,
      small: versions.small || `${baseUrl}/c_thumb,w_50,h_50,g_face,r_max/${publicId}`,
      thumbnail: versions.thumbnail || `${baseUrl}/c_thumb,w_50,h_50,g_face,r_max/${publicId}`,
      isDefault: false
    };
  }
  
  // For local files
  const baseUrl = process.env.API_URL || 'http://localhost:5000';
  return {
    original: versions.original ? `${baseUrl}/uploads/${versions.original}` : DEFAULT_AVATARS.original,
    large: versions.large ? `${baseUrl}/uploads/${versions.large}` : DEFAULT_AVATARS.large,
    medium: versions.medium ? `${baseUrl}/uploads/${versions.medium}` : DEFAULT_AVATARS.medium,
    small: versions.small ? `${baseUrl}/uploads/${versions.small}` : DEFAULT_AVATARS.small,
    thumbnail: versions.thumbnail ? `${baseUrl}/uploads/${versions.thumbnail}` : DEFAULT_AVATARS.small,
    isDefault: false
  };
};

// Configure multer for memory storage (file will be in memory before upload to Cloudinary)
const storage = multer.memoryStorage();

// Create a new multer instance with better error handling
const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1,
    fields: 5,
    parts: 10
  },
  fileFilter: (req, file, cb) => {
    console.log('Processing file:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    
    const error = new Error('Invalid file type. Only images are allowed.');
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }
});

// Add error handling for file size limits
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', {
      code: err.code,
      message: err.message,
      field: err.field,
      name: err.name,
      stack: err.stack
    });
    
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.'
      });
    }
    
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message
    });
  } else if (err) {
    console.error('File upload error:', {
      message: err.message,
      code: err.code,
      stack: err.stack
    });
    
    return res.status(500).json({
      success: false,
      message: 'An error occurred during file upload',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
  
  next();
};

// Get user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    console.log('Fetching profile for user:', req.user.userId);
    
    // Find user by ID and exclude sensitive fields
    const user = await User.findById(req.user.userId).select('-password -__v');
    
    if (!user) {
      console.error('User not found with ID:', req.user.userId);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Convert user to plain object
    const userObj = user.toObject({ getters: true });
    
    // Handle profile picture with professional CDN-style URLs
    userObj.avatar = getAvatarUrls(userObj.profilePicture, userObj._id);
    
    // Keep the original profilePicture for backward compatibility
    if (!userObj.profilePicture) {
      userObj.profilePicture = {
        versions: {
          original: userObj.avatar.original,
          large: userObj.avatar.large,
          medium: userObj.avatar.medium,
          small: userObj.avatar.small,
          thumbnail: userObj.avatar.thumbnail
        },
        isDefault: true
      };
    }
    
    console.log('Profile found:', { userId: user._id, email: user.email });
    
    // Return user data
    res.status(200).json({
      success: true,
      user: userObj
    });
    
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
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
  console.log('=== AVATAR UPLOAD REQUEST STARTED ===');
  console.log('Request method:', req.method);
  console.log('Request headers:', {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'authorization': req.headers['authorization'] ? 'Bearer [token]' : 'No token'
  });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // First authenticate the request
  return authenticate(req, res, (err) => {
    if (err) {
      console.error('Authentication error:', err);
      return res.status(401).json({
        success: false,
        message: 'Authentication failed',
        error: err.message
      });
    }

    console.log('User authenticated:', req.user?.userId);
    
    // Log request details
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request file present:', !!req.file);
    
    // Handle the file upload with better error handling
    const uploadHandler = upload.single('avatar');
    
    uploadHandler(req, res, async (uploadErr) => {
      try {
        console.log('Multer processing completed. Error:', uploadErr);
        
        // Handle multer errors
        if (uploadErr) {
          console.error('File upload error details:', {
            name: uploadErr.name,
            message: uploadErr.message,
            code: uploadErr.code,
            stack: uploadErr.stack
          });
          
          if (uploadErr.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              success: false,
              message: 'File size too large. Maximum size is 5MB.'
            });
          }
          
          if (uploadErr.code === 'INVALID_FILE_TYPE') {
            return res.status(400).json({
              success: false,
              message: uploadErr.message || 'Invalid file type. Only images are allowed.'
            });
          }
          
          // For other multer errors
          return res.status(400).json({
            success: false,
            message: 'File upload failed',
            error: uploadErr.message
          });
        }
        
        // Check if file exists
        if (!req.file) {
          console.error('No file was uploaded');
          return res.status(400).json({
            success: false,
            message: 'No file was uploaded. Please select an image to upload.'
          });
        }
        
        console.log('File uploaded successfully:', {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size
        });
        
        // At this point, the file has been processed by multer
        // and is available in req.file.buffer
        
        // For now, just return a success response
        // We'll add the Cloudinary upload logic next
        return res.status(200).json({
          success: true,
          message: 'File uploaded successfully',
          file: {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
          }
        });
        
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

    // Check if Cloudinary is properly configured
    const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
                                 process.env.CLOUDINARY_API_KEY && 
                                 process.env.CLOUDINARY_API_SECRET;
    
    console.log('Cloudinary config check:', {
      isConfigured: isCloudinaryConfigured,
      hasCloudName: !!process.env.CLOUDINARY_CLOUD_NAME,
      hasApiKey: !!process.env.CLOUDINARY_API_KEY,
      hasApiSecret: !!process.env.CLOUDINARY_API_SECRET
    });
    
    if (!isCloudinaryConfigured) {
      console.warn('Cloudinary is not configured - using placeholder avatar');
      
      // First get the user
      const user = await User.findById(req.user.userId);
      if (!user) {
        console.error('User not found for default avatar:', req.user.userId);
        return res.status(404).json({ 
          success: false,
          message: 'User not found. Please log in again.' 
        });
      }
      
      // Use a placeholder service or return a default avatar URL
      const defaultAvatarUrl = 'https://ui-avatars.com/api/?name=' + 
                             encodeURIComponent(user.username || 'User') + 
                             '&background=random';
      
      // Update user with default avatar
      user.profilePicture = {
        url: defaultAvatarUrl,
        publicId: null,
        source: 'default'
      };
      
      await user.save();
      
      return res.status(200).json({
        success: true,
        message: 'Default avatar assigned',
        user: {
          ...user.toObject(),
          password: undefined,
          __v: undefined
        },
        profilePicture: user.profilePicture
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
  console.log('=== AVATAR UPLOAD REQUEST ===');
  console.log('Request headers:', {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'authorization': req.headers['authorization'] ? 'Bearer [token]' : 'No token'
  });
  
  try {
    if (!req.file) {
      console.error('No file in request or invalid file type');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded or invalid file type'
      });
    }

    console.log('File received for upload:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferLength: req.file.buffer?.length || 0
    });

    try {
      console.log('Starting avatar upload process...');
      
      // Process the avatar upload
      const result = await uploadAvatar(req.file, req.user.userId);
      
      console.log('Cloudinary upload result:', {
        success: result?.success,
        hasVersions: !!result?.versions,
        publicId: result?.publicId,
        hasOriginalUrl: !!result?.versions?.original
      });
      
      if (!result || !result.success || !result.versions || !result.versions.original) {
        const errorMessage = result?.error || 'Failed to process image upload';
        console.error('Avatar upload failed:', errorMessage);
        return res.status(400).json({
          success: false,
          message: errorMessage,
          code: result?.code || 'UPLOAD_FAILED'
        });
      }

      // Update user's profile picture in the database
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }
      
      // If user already has an avatar, delete the old one from Cloudinary
      if (user.profilePicture && user.profilePicture.publicId) {
        try {
          await deleteAvatar(user.profilePicture.publicId);
        } catch (deleteError) {
          console.error('Error deleting old avatar:', deleteError);
          // Continue with the update even if deletion fails
        }
      }
      
      // Store the Cloudinary public ID and URLs
      user.profilePicture = {
        publicId: result.publicId,
        url: result.versions.original,
        versions: result.versions
      };
      
      await user.save();
      
      // Return the updated user with proper avatar URLs
      const userObj = user.toObject({ getters: true });
      if (userObj.profilePicture) {
        // The middleware will handle making these URLs absolute
        userObj.profilePicture = {
          ...userObj.profilePicture,
          url: result.versions.original,
          versions: result.versions
        };
      }
      
      return res.status(200).json({
        success: true,
        user: userObj,
        message: 'Avatar updated successfully'
      });
    } catch (error) {
      console.error('Error in avatar upload:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload avatar',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        code: error.code || 'UPLOAD_ERROR'
      });
    }
  } catch (error) {
    console.error('Error in avatar upload route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during avatar upload',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'INTERNAL_SERVER_ERROR'
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

