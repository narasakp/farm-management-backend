/**
 * Authentication Middleware
 * ใช้สำหรับตรวจสอบ JWT Token
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'farm_management_secret_key_2024';

/**
 * JWT Authentication Middleware
 * ตรวจสอบ Access Token จาก Authorization header
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'ไม่พบ Access Token'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Access Token ไม่ถูกต้องหรือหมดอายุ'
      });
    }
    
    // เก็บข้อมูล user จาก token ไว้ใน req.user
    // user จะมี: userId, username, role
    req.user = {
      id: user.userId,  // สำหรับ RBAC
      userId: user.userId,
      username: user.username,
      role: user.role
    };
    
    next();
  });
}

module.exports = {
  authenticateToken
};
