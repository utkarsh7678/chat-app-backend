const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Encryption utilities
const generateEncryptionKey = () => {
  return crypto.randomBytes(32).toString('hex');
};

const encryptMessage = (message, key) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  
  let encrypted = cipher.update(message, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex')
  };
};

const decryptMessage = (encryptedData, key) => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(encryptedData.iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

// JWT utilities
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    logger.error('Token verification failed:', error);
    return null;
  }
};

// AI-based security detection


// Rate limiting helper
const createRateLimiter = (windowMs, max) => {
  const requests = new Map();
  
  return (userId) => {
    const now = Date.now();
    const userRequests = requests.get(userId) || [];
    
    // Remove old requests
    const validRequests = userRequests.filter(time => now - time < windowMs);
    
    if (validRequests.length >= max) {
      return false;
    }
    
    validRequests.push(now);
    requests.set(userId, validRequests);
    return true;
  };
};

module.exports = {
  generateEncryptionKey,
  encryptMessage,
  decryptMessage,
  generateToken,
  verifyToken,
  detectMaliciousActivity,
  createRateLimiter,
  logger
}; 