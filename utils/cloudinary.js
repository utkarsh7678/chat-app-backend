const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Configure Cloudinary
console.log('=== CLOUDINARY CONFIGURATION ===');

// Check if Cloudinary is properly configured
const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
                             process.env.CLOUDINARY_API_KEY && 
                             process.env.CLOUDINARY_API_SECRET;

console.log('Cloudinary Status:', isCloudinaryConfigured ? 'Configured' : 'Not Configured');
console.log('Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME || 'Not set');
console.log('API Key:', process.env.CLOUDINARY_API_KEY ? '*** Set ***' : 'Missing!');
console.log('API Secret:', process.env.CLOUDINARY_API_SECRET ? '*** Set ***' : 'Missing!');

// Initialize Cloudinary only if all required variables are present
if (isCloudinaryConfigured) {
  console.log('Initializing Cloudinary with secure connection...');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

console.log('✅ Cloudinary configured successfully');

// Upload avatar with multiple sizes
const uploadAvatar = async (file, userId) => {
  try {
    console.log('=== CLOUDINARY UPLOAD STARTED ===');
    console.log('File info:', {
      hasFile: !!file,
      hasBuffer: file?.buffer ? true : false,
      bufferSize: file?.buffer?.length || 0,
      mimeType: file?.mimetype,
      originalName: file?.originalname,
      userId: userId
    });
    
    if (!file || !file.buffer) {
      const error = new Error('No file buffer provided');
      console.error('Upload error - No buffer:', { file, userId });
      throw error;
    }

    // Generate unique public ID with user ID and timestamp
    const publicId = `chat-app/avatars/${userId}_${Date.now()}`;
    
    // Convert buffer to data URL
    let dataUri;
    try {
      dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      console.log('Data URI created, length:', dataUri.length);
    } catch (error) {
      console.error('Error creating data URI:', error);
      throw new Error('Failed to process image file');
    }
    
    // Upload to Cloudinary
    console.log('Starting Cloudinary upload...');
    let result;
    try {
      // First upload the original image
      result = await cloudinary.uploader.upload(dataUri, {
        public_id: publicId,
        resource_type: 'auto',
        overwrite: true,
        invalidate: true,
      folder: 'chat-app/avatars',
      resource_type: 'auto',
      transformation: [
        { width: 512, height: 512, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' }
      ]
      });
      console.log('Cloudinary upload result:', {
        success: !!result,
        url: result?.secure_url ? 'URL present' : 'No URL',
        publicId: result?.public_id || 'No public ID',
        format: result?.format,
        bytes: result?.bytes,
        width: result?.width,
        height: result?.height
      });
    } catch (uploadError) {
      console.error('Cloudinary upload error:', {
        name: uploadError.name,
        message: uploadError.message,
        http_code: uploadError.http_code,
        code: uploadError.code,
        stack: uploadError.stack
      });
      throw new Error(`Cloudinary upload failed: ${uploadError.message}`);
    }

    if (!result || !result.secure_url) {
      const error = new Error('Failed to upload image to Cloudinary - No secure URL in response');
      console.error('Upload failed - No secure URL:', result);
      throw error;
    }

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

