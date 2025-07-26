
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Upload avatar with multiple sizes
const uploadAvatar = async (file, userId) => {
  try {
    // Generate unique public ID with user ID and timestamp
    const publicId = `avatars/${userId}_${Date.now()}`;
    
    // Upload original
    const result = await cloudinary.uploader.upload(file.tempFilePath, {
      public_id: publicId,
      folder: 'chat-app/avatars',
      resource_type: 'auto',
      transformation: [
        { width: 512, height: 512, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' }
      ]
    });

    // Generate different sizes
    const avatarVersions = {
      original: result.secure_url,
      large: cloudinary.url(publicId, {
        width: 200,
        height: 200,
        crop: 'fill',
        gravity: 'face',
        secure: true
      }),
      medium: cloudinary.url(publicId, {
        width: 100,
        height: 100,
        crop: 'fill',
        gravity: 'face',
        secure: true
      }),
      small: cloudinary.url(publicId, {
        width: 50,
        height: 50,
        crop: 'fill',
        gravity: 'face',
        secure: true
      })
    };

    return {
      success: true,
      versions: avatarVersions,
      publicId: publicId
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Delete old avatar from Cloudinary
const deleteAvatar = async (publicId) => {
  try {
    if (!publicId) return { success: true };
    
    // Delete all versions of the image
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: 'image'
    });
    
    return { success: result.result === 'ok' };
  } catch (error) {
    console.error('Error deleting avatar from Cloudinary:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  uploadAvatar,
  deleteAvatar
};
