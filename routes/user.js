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
router.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: 'Multer error', error: err.message });
  }
  next(err);
});

// Upload user avatar
router.put('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Save file to temp location for Cloudinary upload
    const tempFilePath = path.join(__dirname, '..', 'temp', `temp_${Date.now()}_${req.file.originalname}`);
    
    // Ensure temp directory exists
    if (!fs.existsSync(path.dirname(tempFilePath))) {
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
    }
    
    // Write buffer to temp file
    await fs.promises.writeFile(tempFilePath, req.file.buffer);
    
    // Upload to Cloudinary
    const uploadResult = await uploadAvatar({
      tempFilePath,
      originalname: req.file.originalname
    }, user._id.toString());
    
    // Delete temp file
    await fs.promises.unlink(tempFilePath).catch(console.error);
    
    if (!uploadResult.success) {
      return res.status(500).json({ 
        message: 'Failed to upload avatar', 
        error: uploadResult.error 
      });
    }
    
    // Delete old avatar if exists
    if (user.profilePicture?.publicId) {
      await deleteAvatar(user.profilePicture.publicId);
    }
    
    // Update user with new avatar URLs
    user.profilePicture = {
      versions: uploadResult.versions,
      publicId: uploadResult.publicId,
      lastUpdated: new Date()
    };
    
    await user.save();
    
    res.json({ 
      message: 'Avatar uploaded successfully',
      profilePicture: user.profilePicture
    });
    
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ 
      message: 'Error uploading avatar', 
      error: error.message 
    });
  }
});

// Test route to check if user exists
router.get('/test/:userId', async (req, res) => {
  try {
    console.log('Authenticated user ID:', req.user?.userId);

    const user = await User.findById(req.params.userId);
    res.json({ 
      exists: !!user, 
      userId: req.params.userId,
      user: user ? { id: user._id, username: user.username, email: user.email } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// Upload profile picture
router.post('/profile/picture', authenticate, upload.single('picture'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file uploaded in avatar route');
      return res.status(400).json({ message: 'No file uploaded' });
    }
console.log("req.user in /avatar:", req.user);

    const user = await User.findById(req.user.userId);
    
    // Delete old profile picture if exists
    if (user.profilePicture?.key) {
      try{
      await deleteFile(user.profilePicture.key, user.profilePicture.provider);
    } catch(error){
       console.warn('Failed to delete old profile picture:', error.message);
      }
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

// Test route to verify routing works
router.get('/test-avatar', (req, res) => {
  res.json({ message: 'Avatar route is working', timestamp: new Date() });
});

// Test 1: Basic PUT route without middleware
router.put('/test-put', (req, res) => {
  console.log('Basic PUT route hit');
  res.json({ message: 'PUT route works', method: req.method });
});

// Test 2: PUT route with authentication only
router.put('/test-auth', authenticate, (req, res) => {
  console.log('Auth test - User:', req.user?.userId);
  res.json({ 
    message: 'Authentication works', 
    userId: req.user?.userId,
    username: req.user?.username 
  });
});

// Test 3: PUT route with multer only (no auth)
router.put('/test-multer', upload.single('avatar'), (req, res) => {
  console.log('Multer test - File:', req.file?.filename);
  res.json({ 
    message: 'Multer works',
    file: req.file ? {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    } : null
  });
});

// Test route to check multer middleware
router.post('/test-upload', authenticate, upload.single('avatar'), (req, res) => {
  try {
    console.log('Test upload - User:', req.user?.userId);
    console.log('Test upload - File:', req.file);
    res.json({ 
      message: 'Multer test successful',
      user: req.user?.userId,
      file: req.file ? {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size
      } : null
    });
  } catch (error) {
    console.error('Test upload error:', error);
    res.status(500).json({ message: 'Test upload failed', error: error.message });
  }
});

// Complete avatar upload with encryptionKey fix
router.put('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  console.log('=== AVATAR UPLOAD STARTED ===');
  console.log('User ID:', req.user?.userId);
  console.log('File uploaded:', !!req.file);
  
  try {
    if (!req.file) {
      console.error('No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    console.log('File details:', {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    });
    
    console.log('Finding user in database...');
    const user = await User.findById(req.user.userId);
    if (!user) {
      console.error('User not found for avatar update');
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('User found, checking encryptionKey...');
    
    // Fix: Ensure encryptionKey exists (required field in schema)
    if (!user.encryptionKey) {
      console.log('Generating missing encryptionKey...');
      user.encryptionKey = generateEncryptionKey();
    }
    
    console.log('Updating user profile picture...');
    const avatarPath = `/uploads/${req.file.filename}`;
    
    user.profilePicture = {
      url: avatarPath,
      key: req.file.filename,
      lastUpdated: new Date()
    };
    
    console.log('Saving user to database...');
    await user.save();
    console.log('User profile picture updated successfully');
    
    // Return the response format expected by frontend
    const response = {
      message: 'Avatar updated successfully',
      path: avatarPath,
      user: {
        id: user._id,
        profilePicture: user.profilePicture
      }
    };
    
    console.log('Sending response:', response);
    res.json(response);
    
  } catch (error) {
    console.error('=== AVATAR UPLOAD ERROR ===');
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Error updating avatar', 
      error: error.message 
    });
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
      avatarUrl: user.profilePicture?.url,
      avatarKey: user.profilePicture?.key,
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

// Avatar upload
router.put('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete old avatar if exists
    if (user.profilePicture?.publicId) {
      try {
        await deleteAvatar(user.profilePicture.publicId);
      } catch (error) {
        console.error('Error deleting old avatar:', error);
        // Continue with upload even if deletion fails
      }
    }

    // Upload new avatar to Cloudinary
    const result = await uploadAvatar({
      buffer: req.file.buffer,
      originalname: req.file.originalname
    }, user._id.toString());

    // Update user with new avatar
    user.profilePicture = {
      versions: result.versions,
      publicId: result.publicId,
      lastUpdated: new Date()
    };

    await user.save();

    res.status(200).json({
      message: 'Avatar uploaded successfully',
      profilePicture: user.profilePicture
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ 
      message: 'Error uploading avatar',
      error: error.message 
    });
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
