# 📧 Email Setup Guide

## 🚨 Current Issue
OTP emails are not being delivered. This guide will help you fix this.

## 🔧 Setup Steps

### 1. Create Environment File
Create a `.env` file in the backend directory with:

```env
# Database Configuration
MONGODB_URI=your_mongodb_connection_string

# JWT Secret
JWT_SECRET=your_jwt_secret_key

# Email Configuration (Gmail)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Server Configuration
PORT=5000
NODE_ENV=production
```

### 2. Gmail App Password Setup

#### Step 1: Enable 2-Factor Authentication
1. Go to your Google Account settings
2. Navigate to Security
3. Enable 2-Step Verification

#### Step 2: Generate App Password
1. Go to Security → 2-Step Verification
2. Click "App passwords"
3. Select "Mail" and "Other (Custom name)"
4. Name it "ChatApp"
5. Copy the 16-character password

#### Step 3: Use App Password
- Use the generated app password in `EMAIL_PASS`
- NOT your regular Gmail password

### 3. Alternative Email Providers

If Gmail doesn't work, you can use:

#### Option A: Outlook/Hotmail
```javascript
const transporter = nodemailer.createTransporter({
    service: "outlook",
    auth: { 
        user: "your_email@outlook.com", 
        pass: "your_password" 
    }
});
```

#### Option B: Custom SMTP
```javascript
const transporter = nodemailer.createTransporter({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { 
        user: "your_email@gmail.com", 
        pass: "your_app_password" 
    }
});
```

### 4. Testing

After setup:
1. Restart your backend server
2. Try sending OTP again
3. Check console logs for email status
4. Check your email inbox (and spam folder)

### 5. Development Fallback

If email setup fails, the system will:
- Log OTP to console
- Show OTP in server logs
- Continue working for development

## 🔍 Debugging

Check these logs in your backend console:
- `⚠️ Email credentials not configured` - Missing .env file
- `❌ Email transporter creation failed` - Invalid credentials
- `✅ Email sent successfully` - Working correctly
- `❌ Email sending failed` - Network/credential issues

## 📱 Current Status

The app now has a fallback system that will:
1. Try to send email normally
2. If it fails, log OTP to console
3. Show OTP in server logs for development
4. Continue working without email

Check your backend console logs to see the OTP! 