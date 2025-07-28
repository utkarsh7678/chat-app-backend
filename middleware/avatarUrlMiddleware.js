const path = require('path');

// Middleware to ensure avatar URLs are absolute
const ensureAbsoluteAvatarUrls = (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(data) {
        // Only process if data is an object and has a user or profilePicture field
        if (data && typeof data === 'object') {
            const processUser = (user) => {
                if (!user) return user;
                
                const baseUrl = process.env.NODE_ENV === 'production' 
                    ? 'https://realtime-chat-api-z27k.onrender.com' 
                    : 'http://localhost:5000';
                
                // Process profilePicture
                if (user.profilePicture && user.profilePicture.versions) {
                    const versions = user.profilePicture.versions;
                    
                    // Ensure all versions have absolute URLs
                    Object.keys(versions).forEach(version => {
                        if (versions[version] && !versions[version].startsWith('http')) {
                            versions[version] = `${baseUrl}${versions[version].startsWith('/') ? '' : '/'}${versions[version]}`;
                        }
                    });
                }
                
                return user;
            };
            
            // Process single user response
            if (data.user) {
                data.user = processUser(data.user);
            }
            
            // Process array of users (e.g., in friends list)
            if (Array.isArray(data)) {
                data = data.map(user => processUser(user));
            } else if (data.users && Array.isArray(data.users)) {
                data.users = data.users.map(user => processUser(user));
            }
            
            // Process direct user object
            if (data._id) {
                data = processUser(data);
            }
        }
        
        originalJson.call(this, data);
    };
    
    next();
};

module.exports = ensureAbsoluteAvatarUrls;
