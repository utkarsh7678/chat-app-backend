const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireGroupAccess } = require('../middleware/auth');
const { uploadFile, deleteFile } = require('../utils/storage');
const { encryptMessage, decryptMessage } = require('../utils/security');
const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB limit
  }
});

// Send message to user
router.post('/user/:userId', authenticate, async (req, res) => {
  try {
    const { content, isSelfDestructing, selfDestructTime } = req.body;
    const recipient = await User.findById(req.params.userId);
    
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    // Encrypt message
    const encryptedData = encryptMessage(content, recipient.encryptionKey);

    const message = new Message({
      sender: req.user.userId,
      recipient: recipient._id,
      content,
      encryptedContent: encryptedData.encrypted,
      metadata: {
        isEncrypted: true,
        isSelfDestructing: isSelfDestructing || false,
        selfDestructAt: isSelfDestructing ? new Date(Date.now() + selfDestructTime) : null
      }
    });

    await message.save();
    res.json({ message: 'Message sent successfully', messageId: message._id });
  } catch (error) {
    res.status(500).json({ message: 'Error sending message' });
  }
});

// Send message to group
router.post('/group/:groupId', authenticate, requireGroupAccess, async (req, res) => {
  try {
    const { content, isSelfDestructing, selfDestructTime } = req.body;
    
    // Encrypt message for each group member
    const encryptedContents = await Promise.all(
      req.group.members.map(async (member) => {
        const user = await User.findById(member.user);
        const encryptedData = encryptMessage(content, user.encryptionKey);
        return {
          userId: user._id,
          encrypted: encryptedData.encrypted
        };
      })
    );

    const message = new Message({
      sender: req.user.userId,
      group: req.group._id,
      content,
      encryptedContent: encryptedContents,
      metadata: {
        isEncrypted: true,
        isSelfDestructing: isSelfDestructing || false,
        selfDestructAt: isSelfDestructing ? new Date(Date.now() + selfDestructTime) : null
      }
    });

    await message.save();
    
    // Update group metadata
    req.group.metadata.lastActivity = new Date();
    req.group.metadata.messageCount += 1;
    await req.group.save();

    res.json({ message: 'Message sent successfully', messageId: message._id });
  } catch (error) {
    res.status(500).json({ message: 'Error sending message' });
  }
});

// Upload file attachment
router.post('/attachment', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const result = await uploadFile(req.file, {
      provider: 's3',
      folder: 'attachments'
    });

    res.json({
      message: 'File uploaded successfully',
      attachment: {
        type: req.file.mimetype.split('/')[0],
        url: result.url,
        key: result.key,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        uploadedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading file' });
  }
});

// Get messages between users
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user.userId, recipient: req.params.userId },
        { sender: req.params.userId, recipient: req.user.userId }
      ],
      deletedAt: null
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('sender', 'username profilePicture')
    .populate('recipient', 'username profilePicture');

    // Decrypt messages
    const decryptedMessages = messages.map(message => {
      if (message.metadata.isEncrypted) {
        const decrypted = decryptMessage(
          { encrypted: message.encryptedContent, iv: message.iv },
          req.user.encryptionKey
        );
        return { ...message.toObject(), content: decrypted };
      }
      return message;
    });

    res.json(decryptedMessages);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

// Get group messages
router.get('/group/:groupId', authenticate, requireGroupAccess, async (req, res) => {
  try {
    const messages = await Message.find({
      group: req.group._id,
      deletedAt: null
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('sender', 'username profilePicture');

    // Decrypt messages
    const decryptedMessages = messages.map(message => {
      if (message.metadata.isEncrypted) {
        const userEncrypted = message.encryptedContent.find(
          enc => enc.userId.toString() === req.user.userId.toString()
        );
        if (userEncrypted) {
          const decrypted = decryptMessage(
            { encrypted: userEncrypted.encrypted, iv: message.iv },
            req.user.encryptionKey
          );
          return { ...message.toObject(), content: decrypted };
        }
      }
      return message;
    });

    res.json(decryptedMessages);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

// Delete message
router.delete('/:messageId', authenticate, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check if user is authorized to delete
    if (
      message.sender.toString() !== req.user.userId.toString() &&
      !(message.group && req.group?.admins.includes(req.user.userId))
    ) {
      return res.status(403).json({ message: 'Not authorized to delete this message' });
    }

    await message.softDelete();
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting message' });
  }
});

// Cleanup self-destructing messages
const cleanupSelfDestructingMessages = async () => {
  try {
    const messages = await Message.find({
      'metadata.isSelfDestructing': true,
      'metadata.selfDestructAt': { $lte: new Date() }
    });

    for (const message of messages) {
      await message.softDelete();
    }
  } catch (error) {
    console.error('Error cleaning up self-destructing messages:', error);
  }
};

// Run cleanup every minute
setInterval(cleanupSelfDestructingMessages, 60 * 1000);

module.exports = router; 