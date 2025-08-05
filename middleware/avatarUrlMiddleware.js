const path = require('path');

// Middleware to ensure avatar URLs are absolute and use Cloudinary
const ensureAbsoluteAvatarUrls = (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(data) {
        // Only process if data is an object and has a user or profilePicture field
        if (data && typeof data === 'object') {
            const processUser = (user) => {
                if (!user) return user;
                
                // Process profilePicture
                if (user.profilePicture) {
                    // If we have a publicId, construct Cloudinary URL
                    if (user.profilePicture.publicId) {
                        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
                        const baseUrl = `https://res.cloudinary.com/${cloudName}/image/upload`;
                        
                        // Create versions object with Cloudinary transformations
                        user.profilePicture.versions = user.profilePicture.versions || {};
                        
                        // Original version
                        user.profilePicture.versions.original = 
                            user.profilePicture.versions.original || 
                            `${baseUrl}/${user.profilePicture.publicId}`;
                            
                        // Thumbnail version (150x150 cropped)
                        user.profilePicture.versions.thumbnail = 
                            user.profilePicture.versions.thumbnail ||
                            `${baseUrl}/c_fill,w_150,h_150/${user.profilePicture.publicId}`;
                            
                        // Medium version (300x300)
                        user.profilePicture.versions.medium = 
                            user.profilePicture.versions.medium ||
                            `${baseUrl}/c_limit,w_300/${user.profilePicture.publicId}`;
                    }
                    
                    // Ensure all versions are absolute URLs
                    if (user.profilePicture.versions) {
                        Object.keys(user.profilePicture.versions).forEach(version => {
                            const url = user.profilePicture.versions[version];
                            if (url && !url.startsWith('http')) {
                                // If it's a local path, convert to Cloudinary URL if possible
                                if (user.profilePicture.publicId) {
                                    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
                                    user.profilePicture.versions[version] = 
                                        `https://res.cloudinary.com/${cloudName}/image/upload/${user.profilePicture.publicId}`;
                                }
                            }
                        });
                    }
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
