// Middleware to ensure all avatar URLs use Cloudinary
const ensureAbsoluteAvatarUrls = (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(data) {
        // Process user data in the response
        const processUser = (user) => {
            if (!user || !user.profilePicture) return user;
            
            const { profilePicture } = user;
            const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
            
            if (!cloudName) {
                console.error('CLOUDINARY_CLOUD_NAME is not set in environment variables');
                return user;
            }
            
            const baseUrl = `https://res.cloudinary.com/${cloudName}/image/upload`;
            
            // Case 1: Already has a Cloudinary URL
            if (profilePicture.url && profilePicture.url.includes('cloudinary.com')) {
                // Ensure it's using HTTPS
                profilePicture.url = profilePicture.url.replace('http://', 'https://');
                return user;
            }
            
            // Case 2: Has a publicId but URL is missing or incorrect
            if (profilePicture.publicId) {
                profilePicture.url = `${baseUrl}/${profilePicture.publicId}`;
                
                // Create versions if they don't exist
                profilePicture.versions = profilePicture.versions || {};
                profilePicture.versions.original = profilePicture.versions.original || profilePicture.url;
                profilePicture.versions.thumbnail = profilePicture.versions.thumbnail || 
                    `${baseUrl}/c_fill,w_150,h_150/${profilePicture.publicId}`;
                profilePicture.versions.medium = profilePicture.versions.medium || 
                    `${baseUrl}/c_limit,w_300/${profilePicture.publicId}`;
                
                return user;
            }
            
            // Case 3: Has a local file path (old format)
            if (profilePicture.url) {
                // Extract filename and create publicId
                const filename = profilePicture.url
                    .replace(/^.*[\\/]/, '') // Remove path
                    .replace(/\.[^/.]+$/, ''); // Remove extension
                
                if (filename) {
                    const publicId = `avatars/${filename}`;
                    profilePicture.publicId = publicId;
                    profilePicture.url = `${baseUrl}/${publicId}`;
                    
                    // Create versions
                    profilePicture.versions = {
                        original: profilePicture.url,
                        thumbnail: `${baseUrl}/c_fill,w_150,h_150/${publicId}`,
                        medium: `${baseUrl}/c_limit,w_300/${publicId}`
                    };
                }
                
                return user;
            }
            
            return user;
        };
        
        // Process the response data
        try {
            // Handle single user object
            if (data?.user) {
                data.user = processUser(data.user);
            }
            // Handle array of users
            else if (Array.isArray(data)) {
                data = data.map(processUser);
            }
            // Handle direct user object
            else if (data?.profilePicture) {
                data = processUser(data);
            }
            // Handle users array in data.users
            else if (data?.users && Array.isArray(data.users)) {
                data.users = data.users.map(processUser);
            }
            // Handle direct user object with _id
            else if (data?._id) {
                data = processUser(data);
            }
        } catch (error) {
            console.error('Error processing avatar URLs:', error);
        }
        
        // Call the original json function with the processed data
        originalJson.call(this, data);
    };
    
    next();
};

module.exports = ensureAbsoluteAvatarUrls;
