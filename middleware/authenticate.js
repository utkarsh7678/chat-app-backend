const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    console.log('Authorization header:', req.header("Authorization")); // Debug log
    const token = req.header("Authorization")?.split(" ")[1];
    console.log('Extracted token:', token ? 'Present' : 'Missing'); // Debug log
    if (!token) return res.status(401).json({ error: "❌ Unauthorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded token:', decoded); // Debug log
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Token verification failed:', error.message); // Debug log
        res.status(401).json({ error: "❌ Invalid Token" });
    }
};
