const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    console.log('--- AUTH DEBUG ---');
    console.log('JWT_SECRET:', process.env.JWT_SECRET);
    console.log('Authorization header:', req.header("Authorization"));
    const token = req.header("Authorization")?.split(" ")[1];
    console.log('Extracted token:', token ? 'Present' : 'Missing');
    if (!token) return res.status(401).json({ error: "❌ Unauthorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded token:', decoded);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Token verification failed:', error.message);
        res.status(401).json({ error: "❌ Invalid Token" });
    }
};
