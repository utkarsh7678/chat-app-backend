const AWS = require('aws-sdk');
const { google } = require('googleapis');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('./security');

// Configure AWS
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Configure Google Drive
const drive = google.drive({
  version: 'v3',
  auth: new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  })
});

// Image processing
const processImage = async (buffer, options = {}) => {
  const {
    width = 800,
    height = 800,
    quality = 80,
    format = 'jpeg'
  } = options;

  return sharp(buffer)
    .resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .toFormat(format, { quality })
    .toBuffer();
};

// File upload to S3
const uploadToS3 = async (file, options = {}) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${options.folder || 'uploads'}/${Date.now()}-${file.originalname}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'private'
    };

    const result = await s3.upload(params).promise();
    return {
      url: result.Location,
      key: result.Key
    };
  } catch (error) {
    logger.error('S3 upload error:', error);
    throw error;
  }
};

// File upload to Google Drive
const uploadToGoogleDrive = async (file, options = {}) => {
  try {
    const fileMetadata = {
      name: `${Date.now()}-${file.originalname}`,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
    };

    const media = {
      mimeType: file.mimetype,
      body: file.buffer
    };

    const result = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink'
    });

    return {
      url: result.data.webViewLink,
      key: result.data.id
    };
  } catch (error) {
    logger.error('Google Drive upload error:', error);
    throw error;
  }
};

// File upload to local storage
const uploadToLocal = async (file, options = {}) => {
  try {
    const uploadDir = path.join(process.cwd(), 'uploads', options.folder || '');
    await fs.mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${file.originalname}`;
    const filepath = path.join(uploadDir, filename);
    
    await fs.writeFile(filepath, file.buffer);
    
    return {
      url: `/uploads/${options.folder || ''}/${filename}`,
      key: filepath
    };
  } catch (error) {
    logger.error('Local storage upload error:', error);
    throw error;
  }
};

// Main upload function
const uploadFile = async (file, options = {}) => {
  const {
    provider = 'local',
    processImage: shouldProcessImage = false,
    imageOptions = {}
  } = options;

  try {
    let processedFile = file;

    // Process image if needed
    if (shouldProcessImage && file.mimetype.startsWith('image/')) {
      const processedBuffer = await processImage(file.buffer, imageOptions);
      processedFile = {
        ...file,
        buffer: processedBuffer
      };
    }

    // Upload to selected provider
    switch (provider) {
      case 's3':
        return await uploadToS3(processedFile, options);
      case 'google-drive':
        return await uploadToGoogleDrive(processedFile, options);
      case 'local':
      default:
        return await uploadToLocal(processedFile, options);
    }
  } catch (error) {
    logger.error('File upload error:', error);
    throw error;
  }
};

// File deletion
const deleteFile = async (key, provider = 'local') => {
  try {
    switch (provider) {
      case 's3':
        await s3.deleteObject({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key
        }).promise();
        break;
      case 'google-drive':
        await drive.files.delete({ fileId: key });
        break;
      case 'local':
        await fs.unlink(key);
        break;
    }
  } catch (error) {
    logger.error('File deletion error:', error);
    throw error;
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  processImage
}; 