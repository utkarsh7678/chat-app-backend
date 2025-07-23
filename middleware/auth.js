const { verifyToken, detectMaliciousActivity, createRateLimiter, logger } = require('../utils/security');
const User = require('../models/User');

// Create rate limiters
const loginLimiter = createRateLimiter(15 * 60 * 1000, 5); // 5 attempts per 15 minutes
const apiLimiter = createRateLimiter(60 * 1000, 100); // 100 requests per minute

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Use decoded.userId instead of decoded.id
    const user = await User.findById(decoded.userId);
    if (!user || user.isDeleted()) {
      return res.status(401).json({ message: 'User not found or deleted' });
    }

    // Check for suspicious activity
    const activityData = {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: Date.now(),
      endpoint: req.path,
      method: req.method
    };

    const securityCheck = await detectMaliciousActivity(activityData);
    if (securityCheck.isMalicious) {
      logger.warn('Suspicious activity detected:', {
        userId: user._id,
        activityData,
        confidence: securityCheck.confidence
      });
      
      // Lock account if confidence is high
      if (securityCheck.confidence > 0.9) {
        user.securitySettings.accountLocked = true;
        await user.save();
        return res.status(403).json({ message: 'Account locked due to suspicious activity' });
      }
    }

    // Rate limiting
    if (!apiLimiter(user._id.toString())) {
      return res.status(429).json({ message: 'Too many requests' });
    }

    // Update user's last activity
    user.lastSeen = new Date();
    await user.save();

    req.user = {
      ...user.toObject(),
      userId: user._id.toString()
    };
    
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Login middleware
const loginMiddleware = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    // Check rate limit
    if (!loginLimiter(email)) {
      return res.status(429).json({ message: 'Too many login attempts' });
    }

    const user = await User.findOne({ email });
    if (user?.securitySettings.accountLocked) {
      return res.status(403).json({ message: 'Account is locked' });
    }

    next();
  } catch (error) {
    logger.error('Login middleware error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Role-based access control
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
};

// Group access control
const requireGroupAccess = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const isMember = group.members.some(member => 
      member.user.toString() === userId.toString()
    );

    if (!isMember) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    req.group = group;
    next();
  } catch (error) {
    logger.error('Group access control error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  authenticate,
  loginMiddleware,
  requireRole,
  requireGroupAccess
}; 