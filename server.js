// Production Authentication Server with MySQL Database
// Persistent data storage for production use

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== BRUTE FORCE PROTECTION ====================
// In-memory store for IP-based rate limiting
const ipLoginAttempts = new Map(); // IP -> { count, lastAttempt, blockedUntil }

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipLoginAttempts.entries()) {
    if (now - data.lastAttempt > 5 * 60 * 1000) { // 5 minutes old
      ipLoginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost and 127.0.0.1 with any port
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
      return callback(null, true);
    }
    
    // Allow specific origins
    const allowedOrigins = [
      'http://localhost:8096',
      'http://127.0.0.1:8096',
      'http://localhost:8100', 
      'http://127.0.0.1:8100',
      'http://localhost:3000',
      'https://manifestative-alva-blindly.ngrok-free.dev' // ngrok HTTPS tunnel
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.log('❌ CORS blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Version']
}));

// Increase body size limit for avatar uploads (Base64 images)
// MUST be BEFORE rate limiter to avoid 413 errors
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting - เพิ่มจำนวน requests สำหรับ development
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (เพิ่มจาก 100)
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Database connection with fallback to SQLite for testing
let db;
let otpStorage = new Map(); // Store OTP codes temporarily
const isDevelopment = process.env.NODE_ENV !== 'production';

async function initDatabase() {
  if (isDevelopment) {
    // Use SQLite for development/testing
    const sqlite3 = require('sqlite3').verbose();
    const { open } = require('sqlite');
    
    db = await open({
      filename: './farm_auth.db',  // ✅ เรียกจาก backend directory ใช้ relative path
      driver: sqlite3.Database
    });
    
    // Configure SQLite for better concurrency and foreign keys
    await db.exec('PRAGMA foreign_keys = ON;'); // Enable foreign key constraints
    await db.exec('PRAGMA journal_mode = WAL;'); // Write-Ahead Logging
    await db.exec('PRAGMA busy_timeout = 5000;'); // Wait 5 seconds if locked

    // Create tables for SQLite
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'farmer',
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        photo_url TEXT,
        oauth_provider TEXT,
        oauth_uid TEXT,
        phone TEXT,
        is_active BOOLEAN DEFAULT 1,
        is_verified BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        lock_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        refresh_token_hash TEXT NOT NULL,
        device_info TEXT,
        ip_address TEXT,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS auth_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS farm_surveys (
        id TEXT PRIMARY KEY,
        farmer_id TEXT NOT NULL,
        surveyor_id TEXT,
        survey_date DATETIME NOT NULL,
        farmer_title TEXT NOT NULL,
        farmer_first_name TEXT NOT NULL,
        farmer_last_name TEXT NOT NULL,
        farmer_id_card TEXT NOT NULL,
        farmer_phone TEXT,
        farmer_photo_base64 TEXT,
        address_house_number TEXT NOT NULL,
        address_village TEXT,
        address_moo TEXT NOT NULL,
        address_tambon TEXT NOT NULL,
        address_amphoe TEXT NOT NULL,
        address_province TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        farm_area REAL,
        gps_address TEXT,
        crop_area REAL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS survey_livestock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id TEXT NOT NULL,
        livestock_type TEXT NOT NULL,
        age_group TEXT,
        count INTEGER NOT NULL,
        daily_milk_production REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (survey_id) REFERENCES farm_surveys(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS production_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        livestock_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        production_date DATE NOT NULL,
        production_type TEXT NOT NULL CHECK(production_type IN ('milk', 'egg', 'weight')),
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_production_livestock ON production_records(livestock_id);
      CREATE INDEX IF NOT EXISTS idx_production_date ON production_records(production_date);
      CREATE INDEX IF NOT EXISTS idx_production_type ON production_records(production_type);

      -- livestock_surveys table REMOVED (ไม่ใช้แล้ว - ใช้ farm_surveys + survey_livestock แทน)
    `);

    // Add lock_count column if it doesn't exist (for existing databases)
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN lock_count INTEGER DEFAULT 0`);
      console.log('✅ Added lock_count column to users table');
    } catch (error) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.log('⚠️ lock_count column already exists');
      }
    }

    // Migration: Add avatar_url column if not exists
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT;`);
      console.log('✅ Migration: avatar_url column added');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.log('⚠️ Migration warning:', error.message);
      }
    }

    // Migration: Add photo_url column for OAuth (🆕)
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN photo_url TEXT;`);
      console.log('✅ Migration: photo_url column added');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.log('⚠️ Migration warning:', error.message);
      }
    }

    // Migration: Add oauth_provider column (🆕)
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN oauth_provider TEXT;`);
      console.log('✅ Migration: oauth_provider column added');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.log('⚠️ Migration warning:', error.message);
      }
    }

    // Migration: Add oauth_uid column (🆕)
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN oauth_uid TEXT;`);
      console.log('✅ Migration: oauth_uid column added');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.log('⚠️ Migration warning:', error.message);
      }
    }
    
    console.log('🗄️ SQLite database initialized for development');
    
    // Migration: Fix NULL votes in feedback_replies
    try {
      await db.run('UPDATE feedback_replies SET votes = 0 WHERE votes IS NULL');
      console.log('✅ Migrated NULL votes to 0');
    } catch (err) {
      // Table might not exist yet, ignore
      console.log('⚠️ Votes migration skipped (table may not exist)');
    }
  } else {
    // Use MySQL for production
    db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'farm_management_db',
      port: process.env.DB_PORT || 3306
    });
    console.log('🗄️ MySQL database connected for production');
  }
}

// Helper functions
const JWT_SECRET = process.env.JWT_SECRET || 'farm_management_secret_key_2024';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'farm_refresh_secret_2024';

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'ไม่พบ Access Token'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Access Token ไม่ถูกต้องหรือหมดอายุ'
      });
    }
    req.user = user;
    next();
  });
}

function generateTokens(user) {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  const refreshToken = jwt.sign(
    { userId: user.id, username: user.username },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
}

// Assign default permissions based on role
async function assignDefaultPermissions(userId, roleCode) {
  try {
    // Get all permissions for the role
    const permQuery = isDevelopment
      ? `SELECT p.permission_code 
         FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.permission_id
         JOIN roles r ON rp.role_id = r.role_id
         WHERE r.role_code = ? AND rp.has_permission = 1`
      : `SELECT p.permission_code 
         FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.permission_id
         JOIN roles r ON rp.role_id = r.role_id
         WHERE r.role_code = ? AND rp.has_permission = 1`;
    
    let permissions;
    if (isDevelopment) {
      permissions = await db.all(permQuery, [roleCode]);
    } else {
      const [rows] = await db.execute(permQuery, [roleCode]);
      permissions = rows;
    }
    
    console.log(`📋 Found ${permissions.length} permissions for role: ${roleCode}`);
    
    // Assign each permission to the user
    for (const perm of permissions) {
      const insertQuery = isDevelopment
        ? `INSERT INTO user_permissions (user_id, permission_code, granted_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, permission_code) DO NOTHING`
        : `INSERT INTO user_permissions (user_id, permission_code, granted_at)
           VALUES (?, ?, NOW())
           ON DUPLICATE KEY UPDATE granted_at = NOW()`;
      
      if (isDevelopment) {
        await db.run(insertQuery, [userId, perm.permission_code]);
      } else {
        await db.execute(insertQuery, [userId, perm.permission_code]);
      }
    }
    
    console.log(`✅ Assigned ${permissions.length} permissions to user ${userId}`);
    return true;
  } catch (error) {
    console.error('❌ Error assigning default permissions:', error);
    return false;
  }
}

async function logAuthEvent(userId, username, action, req) {
  try {
    const query = isDevelopment 
      ? `INSERT INTO auth_logs (user_id, username, action, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`
      : `INSERT INTO auth_logs (user_id, username, action, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`;
    
    if (isDevelopment) {
      await db.run(query, [userId, username, action, req.ip, req.get('User-Agent')]);
    } else {
      await db.execute(query, [userId, username, action, req.ip, req.get('User-Agent')]);
    }
  } catch (error) {
    console.error('❌ Error logging auth event:', error);
  }
}

// Routes

// Import RBAC routes
const rbacRoutes = require('./routes/rbac');
const farmsRoutes = require('./routes/farms');
const searchRoutes = require('./routes/search');
const privacyRoutes = require('./routes/privacy');
const feedbackRoutes = require('./routes/feedback');
const webboardRoutes = require('./routes/webboard');
const uploadRoutes = require('./routes/upload');
const notificationsRoutes = require('./routes/notifications');
const userProfileRoutes = require('./routes/user_profile');
const moderatorRoutes = require('./routes/moderator');

// Serve static files for uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
console.log('✅ Static uploads folder served at /uploads');

// Register RBAC routes (non-admin routes)
app.use('/api/rbac', rbacRoutes);
app.use('/api/farms', farmsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/forum', webboardRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationsRoutes.router);
app.use('/api/profile', userProfileRoutes);
app.use('/api/moderator', moderatorRoutes);
console.log('✅ RBAC routes registered');
console.log('✅ Search routes registered');
console.log('✅ Privacy routes registered');
console.log('✅ Feedback routes registered');
console.log('✅ Webboard (Forum) routes registered at /api/forum');
console.log('✅ Upload routes registered');
console.log('✅ Moderator routes registered at /api/moderator');
console.log('✅ Notifications routes registered');
console.log('✅ User Profile routes registered at /api/profile');

// User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    console.log('📝 Registration request received');
    console.log('📋 Request body:', req.body);
    console.log('🌐 Origin:', req.headers.origin);
    console.log('🔗 Referer:', req.headers.referer);
    
    let { username, email, password, role = 'farmer', display_name } = req.body;
    
    // Convert role to uppercase to match database (FARMER, not farmer)
    role = role.toUpperCase();

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
      });
    }

    // Password validation (REQUIRED: Letters + Numbers)
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
      });
    }

    if (password.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านต้องไม่เกิน 20 ตัวอักษร'
      });
    }

    // REQUIRED: Must have letters (English or Thai)
    const hasLetters = /[a-zA-Zก-๙]/.test(password);
    if (!hasLetters) {
      return res.status(400).json({
        success: false,
        message: 'ต้องมีตัวอักษร (ไทยหรืออังกฤษ)'
      });
    }

    // REQUIRED: Must have numbers
    const hasNumbers = /\d/.test(password);
    if (!hasNumbers) {
      return res.status(400).json({
        success: false,
        message: 'ต้องมีตัวเลข (0-9)'
      });
    }

    // Block common weak passwords
    const blockedPasswords = ['123456', 'password', '111111', '000000', '123123', 'qwerty', 'abc123'];
    if (blockedPasswords.includes(password.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านนี้ไม่ปลอดภัย กรุณาเปลี่ยนรหัสผ่าน'
      });
    }

    // Check if user exists
    const checkQuery = isDevelopment
      ? `SELECT id FROM users WHERE username = ? OR email = ?`
      : `SELECT id FROM users WHERE username = ? OR email = ?`;
    
    let existingUser;
    if (isDevelopment) {
      existingUser = await db.get(checkQuery, [username, email]);
    } else {
      const [rows] = await db.execute(checkQuery, [username, email]);
      existingUser = rows[0];
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว'
      });
    }

    // Hash password
    const saltRounds = 12;
    const salt = await bcrypt.genSalt(saltRounds);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const insertQuery = isDevelopment
      ? `INSERT INTO users (username, email, password_hash, salt, role, display_name, is_verified) VALUES (?, ?, ?, ?, ?, ?, 1)`
      : `INSERT INTO users (username, email, password_hash, salt, role, display_name, is_verified) VALUES (?, ?, ?, ?, ?, ?, TRUE)`;
    
    let result;
    if (isDevelopment) {
      result = await db.run(insertQuery, [username, email, passwordHash, salt, role, display_name]);
    } else {
      result = await db.execute(insertQuery, [username, email, passwordHash, salt, role, display_name]);
    }

    const userId = isDevelopment ? result.lastID : result[0].insertId;

    await logAuthEvent(userId, username, 'register_success', req);

    console.log(`✅ ลงทะเบียนสำเร็จ: ${username} (${email})`);

    res.json({
      success: true,
      message: 'ลงทะเบียนสำเร็จ',
      user: {
        id: userId,
        username,
        email,
        role,
        displayName: username
      }
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการลงทะเบียน'
    });
  }
});

// Test endpoint to debug request body
app.post('/api/auth/test-request', (req, res) => {
  console.log('');
  console.log('='.repeat(60));
  console.log('🧪 TEST REQUEST RECEIVED');
  console.log('  Body:', JSON.stringify(req.body, null, 2));
  console.log('  Username:', req.body.username);
  console.log('  Password:', req.body.password);
  console.log('  Password type:', typeof req.body.password);
  console.log('  Password length:', req.body.password ? req.body.password.length : 0);
  console.log('='.repeat(60));
  
  res.json({
    received: {
      username: req.body.username,
      password: req.body.password,
      passwordLength: req.body.password ? req.body.password.length : 0
    }
  });
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('');
    console.log('='.repeat(60));
    console.log(`🔐 คำขอเข้าสู่ระบบ: ${username}`);
    console.log(`🔐 Password received: ${password}`);
    console.log(`🔐 Password type: ${typeof password}`);
    console.log(`🔐 Password length: ${password ? password.length : 0}`);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'
      });
    }

    // ==================== IP RATE LIMITING ====================
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();
    let ipData = ipLoginAttempts.get(clientIp) || { count: 0, lastAttempt: now, blockedUntil: null };
    
    // Check if IP is temporarily blocked
    if (ipData.blockedUntil && now < ipData.blockedUntil) {
      const remainingSeconds = Math.ceil((ipData.blockedUntil - now) / 1000);
      console.log(`🚫 IP ${clientIp} is blocked for ${remainingSeconds}s`);
      return res.status(429).json({
        success: false,
        message: `คำขอเข้าสู่ระบบมากเกินไป\nกรุณารออีก ${remainingSeconds} วินาที`
      });
    }
    
    // Reset counter if last attempt was > 1 minute ago
    if (now - ipData.lastAttempt > 60 * 1000) {
      ipData.count = 0;
    }
    
    // Check rate limit: max 15 attempts per minute per IP
    if (ipData.count >= 15) {
      ipData.blockedUntil = now + (2 * 60 * 1000); // Block for 2 minutes
      ipLoginAttempts.set(clientIp, ipData);
      console.log(`🚫 IP ${clientIp} blocked for 2 minutes (15 attempts in 1 minute)`);
      return res.status(429).json({
        success: false,
        message: 'คำขอเข้าสู่ระบบมากเกินไป\nกรุณารอ 2 นาที แล้วลองใหม่อีกครั้ง'
      });
    }
    
    // Increment counter
    ipData.count++;
    ipData.lastAttempt = now;
    ipLoginAttempts.set(clientIp, ipData);
    console.log(`📊 IP ${clientIp}: ${ipData.count}/15 attempts in current window`);
    // ==================== END IP RATE LIMITING ====================

    // Find user
    const userQuery = isDevelopment
      ? `SELECT * FROM users WHERE username = ? OR email = ?`
      : `SELECT * FROM users WHERE username = ? OR email = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [username, username]);
    } else {
      const [rows] = await db.execute(userQuery, [username, username]);
      user = rows[0];
    }

    if (!user) {
      console.log(`❌ ไม่พบผู้ใช้: ${username}`);
      await logAuthEvent(null, username, 'login_failed', req);
      return res.status(401).json({
        success: false,
        message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      // Calculate remaining time
      const remainingMs = new Date(user.locked_until) - new Date();
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      const lockCount = user.lock_count || 0;
      
      // Format time display
      let timeDisplay;
      if (remainingMinutes >= 60) {
        const hours = Math.ceil(remainingMinutes / 60);
        timeDisplay = `${hours} ชั่วโมง`;
      } else {
        timeDisplay = `${remainingMinutes} นาที`;
      }
      
      // Progressive lock message
      const lockMessages = {
        1: `บัญชีถูกล็อคชั่วคราว (ครั้งที่ 1)\nกรุณารออีก ${timeDisplay} แล้วลองใหม่อีกครั้ง`,
        2: `บัญชีถูกล็อคชั่วคราว (ครั้งที่ 2)\nกรุณารออีก ${timeDisplay} แล้วลองใหม่อีกครั้ง`,
        3: `บัญชีถูกล็อคชั่วคราว (ครั้งที่ 3)\nกรุณารออีก ${timeDisplay} แล้วลองใหม่อีกครั้ง`,
      };
      
      const adminContact = `📧 อีเมล: ${process.env.ADMIN_EMAIL || 'admin@farm.com'}\n📱 โทร: ${process.env.ADMIN_PHONE || '02-xxx-xxxx'}\n💬 LINE: ${process.env.ADMIN_LINE || '@farmadmin'}`;
      
      const message = lockCount >= 4
        ? `บัญชีถูกล็อค 24 ชั่วโมง (ครั้งที่ ${lockCount})\n\nกรุณารออีก ${timeDisplay} หรือติดต่อผู้ดูแลระบบ:\n${adminContact}`
        : lockMessages[lockCount] || `บัญชีถูกล็อคชั่วคราว\nกรุณารออีก ${timeDisplay} แล้วลองใหม่อีกครั้ง`;
      
      return res.status(423).json({
        success: false,
        message: message
      });
    }

    // ==================== PROGRESSIVE DELAY ====================
    // Apply delay based on failed attempts to slow down brute force
    const failedAttempts = user.failed_login_attempts || 0;
    if (failedAttempts > 0) {
      // Exponential backoff: 0s, 1s, 2s, 4s, 8s (max 10s)
      const delaySeconds = Math.min(Math.pow(2, failedAttempts - 1), 10);
      console.log(`⏳ Applying ${delaySeconds}s delay (${failedAttempts} previous failed attempts)`);
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }
    // ==================== END PROGRESSIVE DELAY ====================

    // Verify password
    console.log('==================== PASSWORD VERIFICATION ====================');
    console.log('🔐 Verifying password for user:', username);
    console.log('🔐 Password from request:', password);
    console.log('🔐 Password from request (type):', typeof password);
    console.log('🔐 Password from request (length):', password ? password.length : 0);
    console.log('🔐 Password hash from DB:', user.password_hash);
    console.log('🔐 Password hash from DB (type):', typeof user.password_hash);
    console.log('🔐 Hash starts with $2b$?', user.password_hash ? user.password_hash.startsWith('$2b$') : false);
    
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    console.log('🔐 Password valid?', isValidPassword);
    console.log('===============================================================');

    if (!isValidPassword) {
      // ==================== PROGRESSIVE LOCK MECHANISM ====================
      const failedAttempts = (user.failed_login_attempts || 0) + 1;
      let lockUntil = null;
      let lockCount = user.lock_count || 0;

      if (failedAttempts >= 5) {
        // Increment lock count
        lockCount++;
        
        // Progressive lock durations based on lock count
        let lockMinutes;
        switch (lockCount) {
          case 1:
            lockMinutes = 15; // 1st lock: 15 minutes
            break;
          case 2:
            lockMinutes = 30; // 2nd lock: 30 minutes
            break;
          case 3:
            lockMinutes = 60; // 3rd lock: 1 hour
            break;
          default:
            lockMinutes = 24 * 60; // 4th+ lock: 24 hours
        }
        
        lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
        console.log(`🔒 Account locked (count: ${lockCount}, duration: ${lockMinutes} min)`);
      }

      const updateQuery = isDevelopment
        ? `UPDATE users SET failed_login_attempts = ?, locked_until = ?, lock_count = ? WHERE id = ?`
        : `UPDATE users SET failed_login_attempts = ?, locked_until = ?, lock_count = ? WHERE id = ?`;
      
      if (isDevelopment) {
        await db.run(updateQuery, [failedAttempts, lockUntil, lockCount, user.id]);
      } else {
        await db.execute(updateQuery, [failedAttempts, lockUntil, lockCount, user.id]);
      }

      await logAuthEvent(user.id, username, 'login_failed', req);
      
      return res.status(401).json({
        success: false,
        message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      });
      // ==================== END PROGRESSIVE LOCK MECHANISM ====================
    }

    // ==================== CHECK ACCOUNT STATUS ====================
    // Check if account is active
    if (!user.is_active) {
      console.log(`🚫 Account suspended: ${username}`);
      await logAuthEvent(user.id, username, 'login_failed_suspended', req);
      return res.status(403).json({
        success: false,
        message: 'บัญชีนี้ถูกระงับการใช้งาน\nกรุณาติดต่อผู้ดูแลระบบ'
      });
    }
    // ==================== END CHECK ACCOUNT STATUS ====================

    // Reset failed attempts, lock count, and update last login on successful login
    const updateQuery = isDevelopment
      ? `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, lock_count = 0, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`
      : `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, lock_count = 0, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`;
    
    if (isDevelopment) {
      await db.run(updateQuery, [user.id]);
    } else {
      await db.execute(updateQuery, [user.id]);
    }
    
    console.log(`✅ Login successful - Progressive lock reset for user: ${username}`);

    // Reset IP rate limit counter on successful login
    ipLoginAttempts.delete(clientIp);
    console.log(`✅ IP ${clientIp} counter reset (successful login)`);

    // Generate tokens
    const tokens = generateTokens(user);

    // Store session
    const sessionQuery = isDevelopment
      ? `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
      : `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`;
    
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    if (isDevelopment) {
      await db.run(sessionQuery, [
        user.id,
        tokens.accessToken.substring(0, 50),
        tokens.refreshToken.substring(0, 50),
        req.get('User-Agent'),
        req.ip,
        expiresAt
      ]);
    } else {
      await db.execute(sessionQuery, [
        user.id,
        tokens.accessToken.substring(0, 50),
        tokens.refreshToken.substring(0, 50),
        req.get('User-Agent'),
        req.ip,
        expiresAt
      ]);
    }

    await logAuthEvent(user.id, username, 'login_success', req);

    console.log(`✅ เข้าสู่ระบบสำเร็จ: ${username}`);

    res.json({
      success: true,
      message: 'เข้าสู่ระบบสำเร็จ',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name || user.username
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error message:', error.message);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ',
      error: isDevelopment ? error.message : undefined
    });
  }
});

// ==================== GOOGLE OAUTH LOGIN ====================
app.post('/api/auth/google-login', async (req, res) => {
  try {
    const { email, name, photo_url, id_token, uid } = req.body;
    console.log('🔵 Google OAuth login request:', email);
    console.log('📸 Photo URL:', photo_url ? photo_url : '❌ NO PHOTO URL');

    if (!email || !id_token) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูล Google OAuth ไม่ครบถ้วน'
      });
    }

    // Find or create user
    const userQuery = isDevelopment
      ? `SELECT * FROM users WHERE email = ?`
      : `SELECT * FROM users WHERE email = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [email]);
    } else {
      const [rows] = await db.execute(userQuery, [email]);
      user = rows[0];
    }

    // Create new user if doesn't exist
    if (!user) {
      console.log('🆕 Creating new Google OAuth user:', email);
      const username = email.split('@')[0] + '_google';
      const displayName = name || username;
      
      const insertQuery = isDevelopment
        ? `INSERT INTO users (username, email, display_name, role, photo_url, oauth_provider, oauth_uid, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO users (username, email, display_name, role, photo_url, oauth_provider, oauth_uid, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
      
      // Use dummy password hash and salt for OAuth users
      const dummySalt = crypto.randomBytes(16).toString('hex');
      const dummyHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      
      if (isDevelopment) {
        const result = await db.run(insertQuery, [username, email, displayName, 'FARMER', photo_url, 'google', uid, dummyHash, dummySalt]);
        user = await db.get(`SELECT * FROM users WHERE id = ?`, [result.lastID]);
      } else {
        const [result] = await db.execute(insertQuery, [username, email, displayName, 'FARMER', photo_url, 'google', uid, dummyHash, dummySalt]);
        const [rows] = await db.execute(`SELECT * FROM users WHERE id = ?`, [result.insertId]);
        user = rows[0];
      }
      console.log('✅ New Google OAuth user created:', username);
    } else {
      // Update photo_url if changed
      if (photo_url && photo_url !== user.photo_url) {
        const updateQuery = isDevelopment
          ? `UPDATE users SET photo_url = ?, oauth_provider = ?, oauth_uid = ? WHERE id = ?`
          : `UPDATE users SET photo_url = ?, oauth_provider = ?, oauth_uid = ? WHERE id = ?`;
        
        if (isDevelopment) {
          await db.run(updateQuery, [photo_url, 'google', uid, user.id]);
        } else {
          await db.execute(updateQuery, [photo_url, 'google', uid, user.id]);
        }
        user.photo_url = photo_url;
      }
    }

    // ==================== CHECK ACCOUNT STATUS ====================
    // Check if account is active
    if (!user.is_active) {
      console.log(`🚫 Account suspended (Google OAuth): ${email}`);
      await logAuthEvent(user.id, user.username, 'google_login_failed_suspended', req);
      return res.status(403).json({
        success: false,
        message: 'บัญชีนี้ถูกระงับการใช้งาน\nกรุณาติดต่อผู้ดูแลระบบ'
      });
    }
    // ==================== END CHECK ACCOUNT STATUS ====================

    // Generate tokens
    const tokens = generateTokens(user);

    // Store session
    const sessionQuery = isDevelopment
      ? `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
      : `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`;
    
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    if (isDevelopment) {
      await db.run(sessionQuery, [user.id, tokens.accessToken.substring(0, 50), tokens.refreshToken.substring(0, 50), req.get('User-Agent'), req.ip, expiresAt]);
    } else {
      await db.execute(sessionQuery, [user.id, tokens.accessToken.substring(0, 50), tokens.refreshToken.substring(0, 50), req.get('User-Agent'), req.ip, expiresAt]);
    }

    await logAuthEvent(user.id, user.username, 'google_login_success', req);

    console.log(`✅ Google OAuth login successful: ${email}`);

    res.json({
      success: true,
      message: 'เข้าสู่ระบบด้วย Google สำเร็จ',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name || user.username,
        photoUrl: user.photo_url
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });

  } catch (error) {
    console.error('❌ Google OAuth error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google',
      error: isDevelopment ? error.message : undefined
    });
  }
});

// ==================== FACEBOOK OAUTH LOGIN ====================
app.post('/api/auth/facebook-login', async (req, res) => {
  try {
    const { email, name, photo_url, access_token, user_id } = req.body;
    console.log('🔵 Facebook OAuth login request:', email || name);

    if (!access_token || !user_id) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูล Facebook OAuth ไม่ครบถ้วน'
      });
    }

    const userEmail = email || `${user_id}@facebook.com`; // Fallback if no email

    // Find or create user
    const userQuery = isDevelopment
      ? `SELECT * FROM users WHERE email = ? OR oauth_uid = ?`
      : `SELECT * FROM users WHERE email = ? OR oauth_uid = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [userEmail, user_id]);
    } else {
      const [rows] = await db.execute(userQuery, [userEmail, user_id]);
      user = rows[0];
    }

    // Create new user if doesn't exist
    if (!user) {
      console.log('🆕 Creating new Facebook OAuth user:', userEmail);
      const username = name ? name.replace(/\s/g, '_').toLowerCase() + '_fb' : `fb_${user_id}`;
      const displayName = name || username;
      
      const insertQuery = isDevelopment
        ? `INSERT INTO users (username, email, display_name, role, photo_url, oauth_provider, oauth_uid, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO users (username, email, display_name, role, photo_url, oauth_provider, oauth_uid, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
      
      // Use dummy password hash for OAuth users
      const dummyHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      
      if (isDevelopment) {
        const result = await db.run(insertQuery, [username, userEmail, displayName, 'user', photo_url, 'facebook', user_id, dummyHash]);
        user = await db.get(`SELECT * FROM users WHERE id = ?`, [result.lastID]);
      } else {
        const [result] = await db.execute(insertQuery, [username, userEmail, displayName, 'user', photo_url, 'facebook', user_id, dummyHash]);
        const [rows] = await db.execute(`SELECT * FROM users WHERE id = ?`, [result.insertId]);
        user = rows[0];
      }
      console.log('✅ New Facebook OAuth user created:', username);
    } else {
      // Update photo_url if changed
      if (photo_url && photo_url !== user.photo_url) {
        const updateQuery = isDevelopment
          ? `UPDATE users SET photo_url = ?, oauth_provider = ?, oauth_uid = ? WHERE id = ?`
          : `UPDATE users SET photo_url = ?, oauth_provider = ?, oauth_uid = ? WHERE id = ?`;
        
        if (isDevelopment) {
          await db.run(updateQuery, [photo_url, 'facebook', user_id, user.id]);
        } else {
          await db.execute(updateQuery, [photo_url, 'facebook', user_id, user.id]);
        }
        user.photo_url = photo_url;
      }
    }

    // ==================== CHECK ACCOUNT STATUS ====================
    // Check if account is active
    if (!user.is_active) {
      console.log(`🚫 Account suspended (Facebook OAuth): ${userEmail}`);
      await logAuthEvent(user.id, user.username, 'facebook_login_failed_suspended', req);
      return res.status(403).json({
        success: false,
        message: 'บัญชีนี้ถูกระงับการใช้งาน\nกรุณาติดต่อผู้ดูแลระบบ'
      });
    }
    // ==================== END CHECK ACCOUNT STATUS ====================

    // Generate tokens
    const tokens = generateTokens(user);

    // Store session
    const sessionQuery = isDevelopment
      ? `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
      : `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`;
    
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    if (isDevelopment) {
      await db.run(sessionQuery, [user.id, tokens.accessToken.substring(0, 50), tokens.refreshToken.substring(0, 50), req.get('User-Agent'), req.ip, expiresAt]);
    } else {
      await db.execute(sessionQuery, [user.id, tokens.accessToken.substring(0, 50), tokens.refreshToken.substring(0, 50), req.get('User-Agent'), req.ip, expiresAt]);
    }

    await logAuthEvent(user.id, user.username, 'facebook_login_success', req);

    console.log(`✅ Facebook OAuth login successful: ${userEmail}`);

    res.json({
      success: true,
      message: 'เข้าสู่ระบบด้วย Facebook สำเร็จ',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name || user.username,
        photoUrl: user.photo_url
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });

  } catch (error) {
    console.error('❌ Facebook OAuth error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Facebook',
      error: isDevelopment ? error.message : undefined
    });
  }
});

// Check user exists (for password reset)
app.post('/api/auth/check-user', async (req, res) => {
  try {
    const { email } = req.body;
    console.log('🔍 Checking user by email:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกอีเมล'
      });
    }

    const userQuery = isDevelopment
      ? `SELECT id, username, email FROM users WHERE email = ?`
      : `SELECT id, username, email FROM users WHERE email = ?`;
    
    console.log('🔍 Query:', userQuery);
    console.log('🔍 Email parameter:', email);
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [email]);
    } else {
      const [rows] = await db.execute(userQuery, [email]);
      user = rows[0];
    }

    console.log('🔍 User found:', user);

    if (!user) {
      console.log('❌ User not found for email:', email);
      return res.status(404).json({
        success: false,
        message: 'ไม่พบผู้ใช้งานในระบบ'
      });
    }

    res.json({
      success: true,
      message: 'พบผู้ใช้งานในระบบ',
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error('❌ Check user error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการตรวจสอบผู้ใช้'
    });
  }
});

// Send OTP for password reset
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกอีเมล'
      });
    }

    // Check if user exists
    console.log(`🔍 [SEND-OTP] Checking email: ${email}`);
    const userQuery = isDevelopment
      ? `SELECT id, username, email FROM users WHERE email = ?`
      : `SELECT id, username, email FROM users WHERE email = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [email]);
    } else {
      const [rows] = await db.execute(userQuery, [email]);
      user = rows[0];
    }

    console.log(`🔍 [SEND-OTP] User found:`, user);

    if (!user) {
      console.log(`❌ [SEND-OTP] No user found for email: ${email}`);
      return res.status(404).json({
        success: false,
        message: 'ไม่พบผู้ใช้งานในระบบ'
      });
    }

    console.log(`✅ [SEND-OTP] User found - ID: ${user.id}, Username: ${user.username}`);

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store OTP
    otpStorage.set(email, {
      otp,
      expiresAt,
      userId: user.id
    });

    console.log(`📧 OTP สำหรับ ${email}: ${otp}`);

    res.json({
      success: true,
      message: 'ส่งรหัส OTP แล้ว',
      otp: otp // For testing only, remove in production
    });

  } catch (error) {
    console.error('❌ Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการส่ง OTP'
    });
  }
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกอีเมลและรหัส OTP'
      });
    }

    const storedOTP = otpStorage.get(email);

    if (!storedOTP) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบ OTP สำหรับอีเมลนี้'
      });
    }

    if (Date.now() > storedOTP.expiresAt) {
      otpStorage.delete(email);
      return res.status(400).json({
        success: false,
        message: 'รหัส OTP หมดอายุแล้ว'
      });
    }

    if (storedOTP.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'รหัส OTP ไม่ถูกต้อง'
      });
    }

    console.log(`✅ OTP ยืนยันสำเร็จ: ${email}`);

    res.json({
      success: true,
      message: 'ยืนยัน OTP สำเร็จ'
    });

  } catch (error) {
    console.error('❌ Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการยืนยัน OTP'
    });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    console.log(`🔑 [RESET-PASSWORD] Request received for email: ${email}`);

    if (!email || !newPassword) {
      console.log(`❌ [RESET-PASSWORD] Missing email or password`);
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
      });
    }

    // Password validation (REQUIRED: Letters + Numbers)
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
      });
    }

    if (newPassword.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านต้องไม่เกิน 20 ตัวอักษร'
      });
    }

    // REQUIRED: Must have letters (English or Thai)
    const hasLetters = /[a-zA-Zก-๙]/.test(newPassword);
    if (!hasLetters) {
      return res.status(400).json({
        success: false,
        message: 'ต้องมีตัวอักษร (ไทยหรืออังกฤษ)'
      });
    }

    // REQUIRED: Must have numbers
    const hasNumbers = /\d/.test(newPassword);
    if (!hasNumbers) {
      return res.status(400).json({
        success: false,
        message: 'ต้องมีตัวเลข (0-9)'
      });
    }

    // Block common weak passwords
    const blockedPasswords = ['123456', 'password', '111111', '000000', '123123', 'qwerty', 'abc123'];
    if (blockedPasswords.includes(newPassword.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านนี้ไม่ปลอดภัย กรุณาเปลี่ยนรหัสผ่าน'
      });
    }

    // Find user
    const userQuery = isDevelopment
      ? `SELECT * FROM users WHERE email = ?`
      : `SELECT * FROM users WHERE email = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [email]);
    } else {
      const [rows] = await db.execute(userQuery, [email]);
      user = rows[0];
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบผู้ใช้งานในระบบ'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const salt = await bcrypt.genSalt(saltRounds);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password and unlock account
    console.log(`🔑 [RESET-PASSWORD] Updating password for user ID: ${user.id}`);
    const updateQuery = isDevelopment
      ? `UPDATE users SET password_hash = ?, salt = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE email = ?`
      : `UPDATE users SET password_hash = ?, salt = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE email = ?`;
    
    if (isDevelopment) {
      await db.run(updateQuery, [passwordHash, salt, email]);
    } else {
      await db.execute(updateQuery, [passwordHash, salt, email]);
    }

    console.log(`✅ [RESET-PASSWORD] Password updated in database`);
    await logAuthEvent(user.id, user.username, 'password_reset', req);

    console.log(`🔑 รีเซ็ตรหัสผ่านสำเร็จ: ${email}`);

    res.json({
      success: true,
      message: 'รีเซ็ตรหัสผ่านสำเร็จ บัญชีถูกปลดล็อกแล้ว'
    });

  } catch (error) {
    console.error('❌ Password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน'
    });
  }
});

// Google OAuth Login
app.post('/api/auth/google-login', async (req, res) => {
  try {
    const { access_token, id_token, email, name, photo_url } = req.body;
    console.log(`🔍 Google OAuth login attempt for: ${email}`);
    console.log(`📋 Request body:`, { access_token, id_token, email, name, photo_url });
    console.log(`📸 Photo URL:`, photo_url ? photo_url : '❌ NO PHOTO URL');

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูล Google OAuth ไม่ครบถ้วน (ต้องการ email และ name)'
      });
    }

    // Verify Google token (simplified - in production, verify with Google API)
    // For now, we trust the token since it comes from Google Sign In library
    
    // Check if user exists
    const userQuery = isDevelopment
      ? `SELECT * FROM users WHERE email = ?`
      : `SELECT * FROM users WHERE email = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [email]);
    } else {
      const [rows] = await db.execute(userQuery, [email]);
      user = rows[0];
    }

    if (!user) {
      // Create new user from Google account
      let baseUsername = email.split('@')[0]; // Use email prefix as username
      let username = baseUsername;
      const role = 'FARMER'; // Default role (uppercase to match database)
      
      // Check if username already exists and create unique one
      let counter = 1;
      while (true) {
        const checkQuery = isDevelopment
          ? `SELECT id FROM users WHERE username = ?`
          : `SELECT id FROM users WHERE username = ?`;
        
        let existingUser;
        if (isDevelopment) {
          existingUser = await db.get(checkQuery, [username]);
        } else {
          const [rows] = await db.execute(checkQuery, [username]);
          existingUser = rows[0];
        }
        
        if (!existingUser) {
          break; // Username is available
        }
        
        // Try next username
        username = `${baseUsername}_${counter}`;
        counter++;
      }
      
      const insertQuery = isDevelopment
        ? `INSERT INTO users (username, email, password_hash, salt, role, display_name, photo_url, oauth_provider, oauth_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        : `INSERT INTO users (username, email, password_hash, salt, role, display_name, photo_url, oauth_provider, oauth_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
      
      // For Google OAuth users, we don't need password
      const dummyHash = 'google_oauth_user';
      const dummySalt = 'google_oauth_salt';
      
      let result;
      if (isDevelopment) {
        result = await db.run(insertQuery, [username, email, dummyHash, dummySalt, role, name || username, photo_url, 'google', id_token]);
      } else {
        result = await db.execute(insertQuery, [username, email, dummyHash, dummySalt, role, name || username, photo_url, 'google', id_token]);
      }

      const userId = isDevelopment ? result.lastID : result[0].insertId;
      
      user = {
        id: userId,
        username: username,
        email: email,
        role: role,
        display_name: name || username,
        photo_url: photo_url
      };

      await logAuthEvent(userId, username, 'google_register', req);
      console.log(`✅ Google user registered: ${email} with username: ${username}`);
      
      // ✅ Assign default permissions for FARMER role
      console.log(`🔐 Assigning default permissions for role: ${role}`);
      await assignDefaultPermissions(userId, role);
      console.log(`✅ Default permissions assigned for user: ${username}`);
    } else {
      // Update photo_url if changed for existing user
      if (photo_url && photo_url !== user.photo_url) {
        const updateQuery = isDevelopment
          ? `UPDATE users SET photo_url = ?, oauth_provider = ?, oauth_uid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          : `UPDATE users SET photo_url = ?, oauth_provider = ?, oauth_uid = ?, updated_at = NOW() WHERE id = ?`;
        
        if (isDevelopment) {
          await db.run(updateQuery, [photo_url, 'google', id_token, user.id]);
        } else {
          await db.execute(updateQuery, [photo_url, 'google', id_token, user.id]);
        }
        user.photo_url = photo_url;
        console.log(`✅ Updated photo_url for existing user: ${email}`);
      }
    }

    // Generate tokens
    const tokens = generateTokens(user);

    // Store session
    const sessionQuery = isDevelopment
      ? `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
      : `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`;
    
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    if (isDevelopment) {
      await db.run(sessionQuery, [
        user.id,
        tokens.accessToken.substring(0, 50),
        tokens.refreshToken.substring(0, 50),
        'Google OAuth Client',
        req.ip,
        expiresAt
      ]);
    } else {
      await db.execute(sessionQuery, [
        user.id,
        tokens.accessToken.substring(0, 50),
        tokens.refreshToken.substring(0, 50),
        'Google OAuth Client',
        req.ip,
        expiresAt
      ]);
    }

    await logAuthEvent(user.id, user.username, 'google_login_success', req);

    console.log(`✅ Google OAuth login successful: ${email}`);

    res.json({
      success: true,
      message: 'เข้าสู่ระบบด้วย Google สำเร็จ',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name || user.username,
        photoUrl: user.photo_url
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });

  } catch (error) {
    console.error('❌ Google OAuth login error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google'
    });
  }
});

// Facebook OAuth Login
app.post('/api/auth/facebook-login', async (req, res) => {
  try {
    const { access_token, user_id, email, name, photo_url } = req.body;
    console.log(`🔍 Facebook OAuth login attempt for: ${email || user_id}`);
    console.log(`📋 Request body:`, { access_token, user_id, email, name, photo_url });

    if (!user_id || !name) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูล Facebook OAuth ไม่ครบถ้วน (ต้องการ user_id และ name)'
      });
    }

    // Use Facebook user_id as email if email not provided
    const effectiveEmail = email || `facebook_${user_id}@facebook.oauth`;

    // Verify Facebook token (simplified - in production, verify with Facebook Graph API)
    // For now, we trust the token since it comes from Facebook SDK
    
    // Check if user exists
    const userQuery = isDevelopment
      ? `SELECT * FROM users WHERE email = ?`
      : `SELECT * FROM users WHERE email = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(userQuery, [effectiveEmail]);
    } else {
      const [rows] = await db.execute(userQuery, [effectiveEmail]);
      user = rows[0];
    }

    if (!user) {
      // Create new user from Facebook account
      let baseUsername = effectiveEmail.split('@')[0]; // Use email prefix as username
      let username = baseUsername;
      const role = 'FARMER'; // Default role (uppercase to match database)
      
      // Check if username already exists and create unique one
      let counter = 1;
      while (true) {
        const checkQuery = isDevelopment
          ? `SELECT id FROM users WHERE username = ?`
          : `SELECT id FROM users WHERE username = ?`;
        
        let existingUser;
        if (isDevelopment) {
          existingUser = await db.get(checkQuery, [username]);
        } else {
          const [rows] = await db.execute(checkQuery, [username]);
          existingUser = rows[0];
        }
        
        if (!existingUser) {
          break; // Username is available
        }
        
        // Try next username
        username = `${baseUsername}_${counter}`;
        counter++;
      }
      
      const insertQuery = isDevelopment
        ? `INSERT INTO users (username, email, password_hash, salt, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        : `INSERT INTO users (username, email, password_hash, salt, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`;
      
      // For Facebook OAuth users, we don't need password
      const dummyHash = 'facebook_oauth_user';
      const dummySalt = 'facebook_oauth_salt';
      
      let result;
      if (isDevelopment) {
        result = await db.run(insertQuery, [username, effectiveEmail, dummyHash, dummySalt, role, name || username]);
      } else {
        result = await db.execute(insertQuery, [username, effectiveEmail, dummyHash, dummySalt, role, name || username]);
      }

      const userId = isDevelopment ? result.lastID : result[0].insertId;
      
      user = {
        id: userId,
        username: username,
        email: effectiveEmail,
        role: role,
        display_name: name || username
      };

      await logAuthEvent(userId, username, 'facebook_register', req);
      console.log(`✅ Facebook user registered: ${effectiveEmail} with username: ${username}`);
      
      // ✅ Assign default permissions for FARMER role
      console.log(`🔐 Assigning default permissions for role: ${role}`);
      await assignDefaultPermissions(userId, role);
      console.log(`✅ Default permissions assigned for user: ${username}`);
    }

    // Generate tokens
    const tokens = generateTokens(user);

    // Store session
    const sessionQuery = isDevelopment
      ? `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
      : `INSERT INTO user_sessions (user_id, token_hash, refresh_token_hash, device_info, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)`;
    
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    if (isDevelopment) {
      await db.run(sessionQuery, [
        user.id,
        tokens.accessToken.substring(0, 50),
        tokens.refreshToken.substring(0, 50),
        'Facebook OAuth Client',
        req.ip,
        expiresAt
      ]);
    } else {
      await db.execute(sessionQuery, [
        user.id,
        tokens.accessToken.substring(0, 50),
        tokens.refreshToken.substring(0, 50),
        'Facebook OAuth Client',
        req.ip,
        expiresAt
      ]);
    }

    await logAuthEvent(user.id, user.username, 'facebook_login_success', req);

    console.log(`✅ Facebook OAuth login successful: ${email}`);

    res.json({
      success: true,
      message: 'เข้าสู่ระบบด้วย Facebook สำเร็จ',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name || user.username
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });

  } catch (error) {
    console.error('❌ Facebook OAuth login error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Facebook'
    });
  }
});

// Validate Token
app.get('/api/auth/validate', authenticateToken, async (req, res) => {
  try {
    // Token is already validated by authenticateToken middleware
    // If we reach here, token is valid
    res.json({
      success: true,
      message: 'Token is valid',
      user: {
        id: req.user.userId,
        username: req.user.username,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error('❌ Token validation error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการตรวจสอบ token'
    });
  }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      // Delete session from database
      const deleteQuery = isDevelopment
        ? `DELETE FROM user_sessions WHERE user_id = ? AND token_hash = ?`
        : `DELETE FROM user_sessions WHERE user_id = ? AND token_hash = ?`;
      
      if (isDevelopment) {
        await db.run(deleteQuery, [userId, token.substring(0, 50)]);
      } else {
        await db.execute(deleteQuery, [userId, token.substring(0, 50)]);
      }
    }
    
    await logAuthEvent(userId, req.user.username, 'logout_success', req);
    console.log(`✅ User logged out: ${req.user.username}`);
    
    res.json({
      success: true,
      message: 'ออกจากระบบสำเร็จ'
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการออกจากระบบ'
    });
  }
});

// === OLD LIVESTOCK SURVEY ENDPOINTS (REMOVED) ===
// ตาราง livestock_surveys ไม่ได้ใช้งานแล้ว
// ระบบใหม่ใช้ farm_surveys + survey_livestock แทน

// === NEW FARM SURVEY ENDPOINTS (Form Version 2.0) ===

// บันทึกข้อมูลการสำรวจใหม่
app.post('/api/farm-surveys', async (req, res) => {
  try {
    const {
      id,
      farmerId,
      surveyorId,
      surveyDate,
      farmerInfo,
      livestockData,
      farmArea,
      cropArea,
      notes,
      gpsLocation
    } = req.body;

    // Validate required fields
    if (!id || !farmerId || !farmerInfo || !livestockData || livestockData.length === 0) {
      return res.status(400).json({
        error: 'ข้อมูลไม่ครบถ้วน',
        details: 'กรุณากรอกข้อมูลเกษตรกรและปศุสัตว์อย่างน้อย 1 รายการ'
      });
    }

    // เริ่ม transaction
    await db.run('BEGIN TRANSACTION');

    try {
      // 1. บันทึกข้อมูลการสำรวจหลัก
      // แยก latitude และ longitude จาก gpsLocation
      let latitude = null;
      let longitude = null;
      if (gpsLocation) {
        const parts = gpsLocation.split(',');
        if (parts.length === 2) {
          latitude = parseFloat(parts[0].trim());
          longitude = parseFloat(parts[1].trim());
        }
      }

      await db.run(`
        INSERT INTO farm_surveys (
          id, farmer_id, surveyor_id, survey_date,
          farmer_title, farmer_first_name, farmer_last_name, 
          farmer_id_card, farmer_phone, farmer_photo_base64,
          address_house_number, address_village, address_moo,
          address_tambon, address_amphoe, address_province, address_postal_code,
          latitude, longitude, gps_address,
          farm_area, crop_area, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        farmerId,
        surveyorId || null,
        surveyDate || new Date().toISOString(),
        farmerInfo.title,
        farmerInfo.firstName,
        farmerInfo.lastName,
        farmerInfo.idCard,
        farmerInfo.phoneNumber,
        farmerInfo.photoBase64 || null,
        farmerInfo.address.houseNumber,
        farmerInfo.address.village,
        farmerInfo.address.moo,
        farmerInfo.address.tambon,
        farmerInfo.address.amphoe,
        farmerInfo.address.province,
        farmerInfo.address.postalCode || null,
        latitude,
        longitude,
        gpsLocation || null,
        farmArea || null,
        cropArea || null,
        notes || null
      ]);

      // 2. บันทึกข้อมูลปศุสัตว์แต่ละรายการ
      for (const livestock of livestockData) {
        await db.run(`
          INSERT INTO survey_livestock (
            survey_id, livestock_type, age_group, count, daily_milk_production
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          id,
          livestock.type,
          livestock.ageGroup || null,
          livestock.count,
          livestock.dailyMilkProduction || null
        ]);
      }

      // Commit transaction
      await db.run('COMMIT');

      console.log(`✅ Saved survey: ${id} for farmer: ${farmerInfo.firstName} ${farmerInfo.lastName}`);
      if (gpsLocation) {
        console.log(`📍 GPS Location saved: ${gpsLocation} (Lat: ${latitude}, Lng: ${longitude})`);
      }

      res.status(201).json({
        success: true,
        message: 'บันทึกข้อมูลการสำรวจเรียบร้อยแล้ว',
        surveyId: id
      });

    } catch (error) {
      // Rollback on error
      await db.run('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error saving survey:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล',
      details: error.message
    });
  }
});

// ดึงรายการข้อมูลการสำรวจทั้งหมด
app.get('/api/farm-surveys', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // นับจำนวนทั้งหมด
    const countResult = await db.get(`SELECT COUNT(*) as total FROM farm_surveys`);

    // ดึงข้อมูลพร้อม pagination และ JOIN กับ users เพื่อดึงชื่อผู้สำรวจ
    const surveys = await db.all(`
      SELECT 
        fs.*,
        u.display_name as surveyor_name,
        u.username as surveyor_username,
        u.role as surveyor_role
      FROM farm_surveys fs
      LEFT JOIN users u ON fs.surveyor_id = u.username OR fs.surveyor_id = CAST(u.id AS TEXT)
      ORDER BY fs.survey_date DESC
      LIMIT ? OFFSET ?
    `, [parseInt(limit), offset]);

    // แปลงข้อมูลให้ตรงกับ Flutter model format
    const formattedSurveys = [];
    for (const survey of surveys) {
      const livestock = await db.all(`
        SELECT * FROM survey_livestock WHERE survey_id = ?
      `, [survey.id]);
      
      formattedSurveys.push({
        id: survey.id,
        farmerId: survey.farmer_id,
        surveyorId: survey.surveyor_id,
        surveyorName: survey.surveyor_name || survey.surveyor_username || 'unknown_user',
        surveyorRole: survey.surveyor_role,
        surveyDate: survey.survey_date,
        farmerInfo: {
          title: survey.farmer_title,
          firstName: survey.farmer_first_name,
          lastName: survey.farmer_last_name,
          idCard: survey.farmer_id_card,
          phoneNumber: survey.farmer_phone || '',
          photoBase64: survey.farmer_photo_base64 || null,
          address: {
            houseNumber: survey.address_house_number,
            village: survey.address_village || '',
            moo: survey.address_moo,
            tambon: survey.address_tambon,
            amphoe: survey.address_amphoe,
            province: survey.address_province,
            postalCode: survey.address_postal_code || null,
          }
        },
        livestockData: livestock.map(l => ({
          type: l.livestock_type,
          ageGroup: l.age_group || '',
          count: l.count,
          dailyMilkProduction: l.daily_milk_production || null,
        })),
        farmArea: survey.farm_area,
        cropArea: survey.crop_area,
        notes: survey.notes || '',
        gpsLocation: survey.gps_address || null,
        createdAt: survey.created_at
      });
    }

    res.json({
      success: true,
      data: formattedSurveys,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูล',
      details: error.message
    });
  }
});

// อัปเดตข้อมูลการสำรวจ
app.put('/api/farm-surveys/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { surveyDate, farmerInfo, livestockData, farmArea, cropArea, notes, gpsLocation } = req.body;

    // เช็คว่า survey นี้มีอยู่หรือไม่
    const existingSurvey = await db.get('SELECT id FROM farm_surveys WHERE id = ?', [id]);
    if (!existingSurvey) {
      return res.status(404).json({
        error: 'ไม่พบข้อมูลการสำรวจที่ต้องการอัปเดต'
      });
    }

    // เริ่ม transaction
    await db.run('BEGIN TRANSACTION');

    try {
      // 1. อัปเดตข้อมูลการสำรวจหลัก
      // แยก latitude และ longitude จาก gpsLocation
      let latitude = null;
      let longitude = null;
      if (gpsLocation) {
        const parts = gpsLocation.split(',');
        if (parts.length === 2) {
          latitude = parseFloat(parts[0].trim());
          longitude = parseFloat(parts[1].trim());
        }
      }

      await db.run(`
        UPDATE farm_surveys SET
          survey_date = ?,
          farmer_title = ?,
          farmer_first_name = ?,
          farmer_last_name = ?,
          farmer_id_card = ?,
          farmer_phone = ?,
          farmer_photo_base64 = ?,
          address_house_number = ?,
          address_village = ?,
          address_moo = ?,
          address_tambon = ?,
          address_amphoe = ?,
          address_province = ?,
          address_postal_code = ?,
          latitude = ?,
          longitude = ?,
          gps_address = ?,
          farm_area = ?,
          crop_area = ?,
          notes = ?
        WHERE id = ?
      `, [
        surveyDate,
        farmerInfo.title,
        farmerInfo.firstName,
        farmerInfo.lastName,
        farmerInfo.idCard,
        farmerInfo.phoneNumber,
        farmerInfo.photoBase64,
        farmerInfo.address.houseNumber,
        farmerInfo.address.village,
        farmerInfo.address.moo,
        farmerInfo.address.tambon,
        farmerInfo.address.amphoe,
        farmerInfo.address.province,
        farmerInfo.address.postalCode || null,
        latitude,
        longitude,
        gpsLocation || null,
        farmArea,
        cropArea,
        notes,
        id
      ]);

      // 2. ลบข้อมูลปศุสัตว์เดิม
      await db.run('DELETE FROM survey_livestock WHERE survey_id = ?', [id]);

      // 3. เพิ่มข้อมูลปศุสัตว์ใหม่
      for (const livestock of livestockData) {
        await db.run(`
          INSERT INTO survey_livestock (
            survey_id, livestock_type, age_group, count, daily_milk_production
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          id,
          livestock.type,
          livestock.ageGroup || '',
          livestock.count,
          livestock.dailyMilkProduction || null
        ]);
      }

      await db.run('COMMIT');

      console.log(`✅ Survey updated successfully: ${id}`);
      if (gpsLocation) {
        console.log(`📍 GPS Location updated: ${gpsLocation} (Lat: ${latitude}, Lng: ${longitude})`);
      }
      res.json({
        success: true,
        message: 'อัปเดตข้อมูลการสำรวจสำเร็จ',
        surveyId: id
      });

    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error updating survey:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล',
      details: error.message
    });
  }
});

// ดึงสถิติปศุสัตว์ทั้งหมดจากฐานข้อมูล (สำหรับ Dashboard)
app.get('/api/statistics/livestock', async (req, res) => {
  try {
    // นับปศุสัตว์ทั้งหมดจากตาราง survey_livestock
    const totalLivestockResult = await db.get(`
      SELECT SUM(count) as total FROM survey_livestock
    `);

    // นับจำนวนฟาร์มทั้งหมด
    const totalFarmsResult = await db.get(`
      SELECT COUNT(*) as total FROM farm_surveys
    `);

    // นับปศุสัตว์แยกตามประเภท
    const livestockByTypeResult = await db.all(`
      SELECT livestock_type, SUM(count) as count
      FROM survey_livestock
      GROUP BY livestock_type
    `);

    // แปลงเป็น object
    const livestockByType = {};
    for (const row of livestockByTypeResult) {
      livestockByType[row.livestock_type] = row.count;
    }

    res.json({
      success: true,
      data: {
        totalLivestock: totalLivestockResult?.total || 0,
        totalFarms: totalFarmsResult?.total || 0,
        livestockByType: livestockByType
      }
    });

  } catch (error) {
    console.error('Error fetching livestock statistics:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการดึงสถิติ',
      details: error.message
    });
  }
});

// ==================== PRODUCTION RECORDS API ====================

// Create production record
app.post('/api/production-records', authenticateToken, async (req, res) => {
  try {
    const { livestockId, productionDate, productionType, quantity, unit, notes } = req.body;
    const userId = req.user.id;

    // Validation
    if (!livestockId || !productionDate || !productionType || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
      });
    }

    // Validate production type
    const validTypes = ['milk', 'egg', 'weight'];
    if (!validTypes.includes(productionType)) {
      return res.status(400).json({
        success: false,
        message: 'ประเภทการผลิตไม่ถูกต้อง'
      });
    }

    const result = await db.run(
      `INSERT INTO production_records (livestock_id, user_id, production_date, production_type, quantity, unit, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [livestockId, userId, productionDate, productionType, quantity, unit, notes || null]
    );

    res.status(201).json({
      success: true,
      message: 'บันทึกผลผลิตสำเร็จ',
      data: {
        id: result.lastID,
        livestockId,
        productionDate,
        productionType,
        quantity,
        unit,
        notes
      }
    });

  } catch (error) {
    console.error('Error creating production record:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกผลผลิต',
      error: error.message
    });
  }
});

// Get production records by livestock ID
app.get('/api/production-records/livestock/:livestockId', authenticateToken, async (req, res) => {
  try {
    const { livestockId } = req.params;
    const { startDate, endDate, productionType } = req.query;

    let query = `SELECT * FROM production_records WHERE livestock_id = ?`;
    let params = [livestockId];

    if (startDate) {
      query += ` AND production_date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND production_date <= ?`;
      params.push(endDate);
    }

    if (productionType) {
      query += ` AND production_type = ?`;
      params.push(productionType);
    }

    query += ` ORDER BY production_date DESC`;

    const records = await db.all(query, params);

    res.json({
      success: true,
      data: records
    });

  } catch (error) {
    console.error('Error fetching production records:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลผลผลิต',
      error: error.message
    });
  }
});

// Get production statistics
app.get('/api/production-records/livestock/:livestockId/statistics', authenticateToken, async (req, res) => {
  try {
    const { livestockId } = req.params;
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    let params = [livestockId];

    if (startDate && endDate) {
      dateFilter = ` AND production_date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    // Get statistics by production type
    const stats = await db.all(`
      SELECT 
        production_type,
        COUNT(*) as record_count,
        SUM(quantity) as total_quantity,
        AVG(quantity) as avg_quantity,
        MIN(quantity) as min_quantity,
        MAX(quantity) as max_quantity,
        unit
      FROM production_records
      WHERE livestock_id = ?${dateFilter}
      GROUP BY production_type, unit
    `, params);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching production statistics:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงสถิติผลผลิต',
      error: error.message
    });
  }
});

// Update production record
app.put('/api/production-records/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { productionDate, quantity, notes } = req.body;
    const userId = req.user.id;

    // Check ownership
    const existing = await db.get('SELECT user_id FROM production_records WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลผลผลิต'
      });
    }

    if (existing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้'
      });
    }

    await db.run(
      `UPDATE production_records 
       SET production_date = ?, quantity = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [productionDate, quantity, notes, id]
    );

    res.json({
      success: true,
      message: 'อัปเดตผลผลิตสำเร็จ'
    });

  } catch (error) {
    console.error('Error updating production record:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการอัปเดตผลผลิต',
      error: error.message
    });
  }
});

// Delete production record
app.delete('/api/production-records/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check ownership
    const existing = await db.get('SELECT user_id FROM production_records WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลผลผลิต'
      });
    }

    if (existing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'คุณไม่มีสิทธิ์ลบข้อมูลนี้'
      });
    }

    await db.run('DELETE FROM production_records WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'ลบผลผลิตสำเร็จ'
    });

  } catch (error) {
    console.error('Error deleting production record:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการลบผลผลิต',
      error: error.message
    });
  }
});

// ==================== END PRODUCTION RECORDS API ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: isDevelopment ? 'SQLite' : 'MySQL'
  });
});

// ==================== PROFILE MANAGEMENT ====================

// Get current user profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const query = isDevelopment
      ? `SELECT id, username, email, display_name, avatar_url, photo_url, role, created_at FROM users WHERE id = ?`
      : `SELECT id, username, email, display_name, avatar_url, photo_url, role, created_at FROM users WHERE id = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(query, [userId]);
    } else {
      const [rows] = await db.execute(query, [userId]);
      user = rows[0];
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลผู้ใช้'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        photoUrl: user.photo_url,  // 🆕 OAuth photo URL
        role: user.role,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์'
    });
  }
});

// Update user profile
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email, displayName } = req.body;
    
    // Validation
    if (!email || !displayName) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
      });
    }
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'รูปแบบอีเมลไม่ถูกต้อง'
      });
    }
    
    // Check if email is already used by another user
    const emailCheckQuery = isDevelopment
      ? `SELECT id FROM users WHERE email = ? AND id != ?`
      : `SELECT id FROM users WHERE email = ? AND id != ?`;
    
    let existingUser;
    if (isDevelopment) {
      existingUser = await db.get(emailCheckQuery, [email, userId]);
    } else {
      const [rows] = await db.execute(emailCheckQuery, [email, userId]);
      existingUser = rows[0];
    }
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'อีเมลนี้ถูกใช้งานแล้ว'
      });
    }
    
    // Update profile
    const updateQuery = isDevelopment
      ? `UPDATE users SET email = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      : `UPDATE users SET email = ?, display_name = ?, updated_at = NOW() WHERE id = ?`;
    
    if (isDevelopment) {
      await db.run(updateQuery, [email, displayName, userId]);
    } else {
      await db.execute(updateQuery, [email, displayName, userId]);
    }
    
    await logAuthEvent(userId, req.user.username, 'profile_update', req);
    
    res.json({
      success: true,
      message: 'อัปเดตโปรไฟล์สำเร็จ'
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์'
    });
  }
});

// Upload avatar (Base64)
app.put('/api/auth/upload-avatar', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { avatarBase64 } = req.body;
    
    console.log('📤 Avatar upload request from userId:', userId);
    console.log('📊 Avatar data length:', avatarBase64 ? avatarBase64.length : 0);
    
    // Allow empty string to remove avatar
    if (avatarBase64 === '' || avatarBase64 === null) {
      const updateQuery = isDevelopment
        ? `UPDATE users SET avatar_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        : `UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = ?`;
      
      if (isDevelopment) {
        await db.run(updateQuery, [userId]);
      } else {
        await db.execute(updateQuery, [userId]);
      }
      
      await logAuthEvent(userId, req.user.username, 'avatar_remove', req);
      
      return res.json({
        success: true,
        message: 'ลบรูปโปรไฟล์สำเร็จ',
        avatarUrl: null
      });
    }
    
    // Validation
    if (!avatarBase64) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาเลือกรูปภาพ'
      });
    }
    
    // Validate base64 format
    if (!avatarBase64.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        message: 'รูปแบบไฟล์ไม่ถูกต้อง'
      });
    }
    
    // Check size (max 2MB for base64)
    const sizeInBytes = (avatarBase64.length * 3) / 4;
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (sizeInBytes > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'ขนาดไฟล์ต้องไม่เกิน 2MB'
      });
    }
    
    // Update avatar_url in database
    const updateQuery = isDevelopment
      ? `UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      : `UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE id = ?`;
    
    if (isDevelopment) {
      await db.run(updateQuery, [avatarBase64, userId]);
    } else {
      await db.execute(updateQuery, [avatarBase64, userId]);
    }
    
    await logAuthEvent(userId, req.user.username, 'avatar_update', req);
    
    console.log('✅ Avatar uploaded successfully for userId:', userId);
    
    res.json({
      success: true,
      message: 'อัปเดตรูปโปรไฟล์สำเร็จ',
      avatarUrl: avatarBase64
    });
  } catch (error) {
    console.error('❌ Error uploading avatar:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการอัพโหลดรูปภาพ: ' + error.message
    });
  }
});

// Change password
app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;
    
    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลให้ครบถ้วน'
      });
    }
    
    // Password strength validation
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร'
      });
    }
    
    // Get current user
    const query = isDevelopment
      ? `SELECT password_hash FROM users WHERE id = ?`
      : `SELECT password_hash FROM users WHERE id = ?`;
    
    let user;
    if (isDevelopment) {
      user = await db.get(query, [userId]);
    } else {
      const [rows] = await db.execute(query, [userId]);
      user = rows[0];
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูลผู้ใช้'
      });
    }
    
    console.log('🔐 Verifying current password for user:', userId);
    console.log('🔐 Current hash from DB:', user.password_hash.substring(0, 20) + '...');
    
    // Verify current password using bcrypt
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    
    console.log('🔐 Current password valid?', isCurrentPasswordValid);
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
      });
    }
    
    // Generate new hash using bcrypt
    console.log('🔐 Generating new bcrypt hash...');
    const newHash = await bcrypt.hash(newPassword, 12);
    console.log('🔐 New hash generated:', newHash.substring(0, 20) + '...');
    
    // Update password (bcrypt has built-in salt, no separate salt column needed)
    const updateQuery = isDevelopment
      ? `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      : `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`;
    
    console.log('🔄 Updating password for user:', userId);
    
    if (isDevelopment) {
      const result = await db.run(updateQuery, [newHash, userId]);
      console.log('✅ SQLite UPDATE result:', result);
    } else {
      const [result] = await db.execute(updateQuery, [newHash, userId]);
      console.log('✅ MySQL UPDATE result:', result);
    }
    
    // Verify update
    const verifyQuery = isDevelopment
      ? `SELECT password_hash FROM users WHERE id = ?`
      : `SELECT password_hash FROM users WHERE id = ?`;
    
    let updatedUser;
    if (isDevelopment) {
      updatedUser = await db.get(verifyQuery, [userId]);
    } else {
      const [rows] = await db.execute(verifyQuery, [userId]);
      updatedUser = rows[0];
    }
    console.log('🔍 Verify - Hash updated:', updatedUser.password_hash === newHash);
    console.log('🔍 Verify - Can login with new password:', await bcrypt.compare(newPassword, updatedUser.password_hash));
    
    await logAuthEvent(userId, req.user.username, 'password_change', req);
    
    res.json({
      success: true,
      message: 'เปลี่ยนรหัสผ่านสำเร็จ'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน'
    });
  }
});

// ==================== AVATAR PROXY ====================
// Proxy Google avatar images to bypass rate limiting
app.get('/api/proxy/avatar', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url || !url.startsWith('https://lh3.googleusercontent.com/')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid avatar URL'
      });
    }
    
    console.log('🖼️ Proxying avatar:', url);
    
    const https = require('https');
    https.get(url, (proxyRes) => {
      // Set cache headers
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24 hours
      
      // Stream the image
      proxyRes.pipe(res);
    }).on('error', (error) => {
      console.error('❌ Proxy error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch avatar'
      });
    });
  } catch (error) {
    console.error('❌ Avatar proxy error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการโหลดรูปโปรไฟล์'
    });
  }
});

// Start server
async function startServer() {
  try {
    await initDatabase();
    
    // ✅ Migrate old 'user' role to 'FARMER'
    if (isDevelopment) {
      await db.run(`UPDATE users SET role = 'FARMER' WHERE role = 'user'`);
      console.log('✅ Migrated old "user" role to "FARMER"');
    } else {
      await db.execute(`UPDATE users SET role = 'FARMER' WHERE role = 'user'`);
      console.log('✅ Migrated old "user" role to "FARMER"');
    }
    
    // Register admin routes after DB is initialized
    const adminRoutes = require('./routes/admin');
    app.use('/api/admin', adminRoutes(db));
    console.log('✅ Admin routes registered');
    console.log('✅ Profile routes registered (with avatar support)');
    
    app.listen(PORT, '127.0.0.1', () => {
      console.log('🚀 Production Authentication Server เริ่มทำงานแล้ว');
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`🗄️ Database: ${isDevelopment ? 'SQLite (Development)' : 'MySQL (Production)'}`);
      console.log('🔒 พร้อมรับคำขอ Authentication');
      console.log('==================================================');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// ====================================
// FEEDBACK API ENDPOINTS
// ====================================

// GET /api/feedback - ดึงข้อมูล feedback ทั้งหมด
app.get('/api/feedback', async (req, res) => {
  try {
    const { userId, status, type, category } = req.query;
    
    let query = 'SELECT * FROM feedback WHERE 1=1';
    const params = [];
    
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const feedbacks = await db.all(query, params);
    
    // นับจำนวน replies สำหรับแต่ละ feedback
    const feedbacksWithReplyCount = await Promise.all(
      feedbacks.map(async (f) => {
        const replyCountResult = await db.get(
          'SELECT COUNT(*) as count FROM feedback_replies WHERE feedback_id = ?',
          [f.id]
        );
        return {
          ...f,
          replyCount: replyCountResult?.count || 0
        };
      })
    );
    
    res.json({
      success: true,
      data: feedbacksWithReplyCount.map(f => ({
        id: f.id,
        userId: f.user_id,
        userName: f.user_name || 'ผู้เยี่ยมชม',
        email: f.email,
        phone: f.phone,
        type: f.type,
        category: f.category,
        subject: f.subject,
        message: f.message,
        rating: f.rating,
        attachments: f.attachments ? JSON.parse(f.attachments) : [],
        priority: f.priority,
        status: f.status,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
        adminResponse: f.admin_response,
        respondedByUserName: f.responded_by_user_name,
        respondedAt: f.responded_at,
        votes: f.votes || 0,
        views: f.views || 0,
        lastActivity: f.last_activity || f.created_at,
        replyCount: f.replyCount || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูล',
      details: error.message
    });
  }
});

// POST /api/feedback - บันทึก feedback ใหม่
app.post('/api/feedback', async (req, res) => {
  try {
    const {
      id,
      userId,
      userName,
      email,
      phone,
      type,
      category,
      subject,
      message,
      rating,
      attachments,
      priority
    } = req.body;
    
    // Validate required fields (email และ phone เป็น optional สำหรับ user ที่ login แล้ว)
    if (!id || !userId || !userName || !type || !category || !subject || !message) {
      return res.status(400).json({
        error: 'ข้อมูลไม่ครบถ้วน'
      });
    }
    
    await db.run(`
      INSERT INTO feedback (
        id, user_id, user_name, email, phone,
        type, category, subject, message, rating,
        attachments, priority, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `, [
      id,
      userId,
      userName,
      email || null,  // ใส่ null ถ้า email ว่าง
      phone || null,  // ใส่ null ถ้า phone ว่าง
      type,
      category,
      subject,
      message,
      rating || 5,
      attachments ? JSON.stringify(attachments) : null,
      priority || 'medium'
    ]);
    
    console.log(`✅ Feedback created: ${id}`);
    res.json({
      success: true,
      message: 'บันทึกข้อเสนอแนะสำเร็จ',
      feedbackId: id
    });
  } catch (error) {
    console.error('Error creating feedback:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการบันทึก',
      details: error.message
    });
  }
});

// PUT /api/feedback/:id - อัปเดตสถานะและ admin response
app.put('/api/feedback/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminResponse, respondedByUserName } = req.body;
    
    // Check if feedback exists
    const existing = await db.get('SELECT id FROM feedback WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        error: 'ไม่พบข้อเสนอแนะ'
      });
    }
    
    await db.run(`
      UPDATE feedback SET
        status = ?,
        admin_response = ?,
        responded_by_user_name = ?,
        responded_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      status,
      adminResponse || null,
      respondedByUserName || null,
      adminResponse ? new Date().toISOString() : null,
      id
    ]);
    
    console.log(`✅ Feedback updated: ${id}`);
    res.json({
      success: true,
      message: 'อัปเดตข้อเสนอแนะสำเร็จ'
    });
  } catch (error) {
    console.error('Error updating feedback:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการอัปเดต',
      details: error.message
    });
  }
});

// DELETE /api/feedback/:id - ลบ feedback
app.delete('/api/feedback/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = await db.get('SELECT id FROM feedback WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        error: 'ไม่พบข้อเสนอแนะ'
      });
    }
    
    await db.run('DELETE FROM feedback WHERE id = ?', [id]);
    
    console.log(`✅ Feedback deleted: ${id}`);
    res.json({
      success: true,
      message: 'ลบข้อเสนอแนะสำเร็จ'
    });
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการลบ',
      details: error.message
    });
  }
});

// ====================================
// FEEDBACK REPLIES API ENDPOINTS
// ====================================

// GET /api/feedback/:id/replies - ดึง replies ทั้งหมดของ feedback
app.get('/api/feedback/:id/replies', async (req, res) => {
  try {
    const { id } = req.params;
    
    const replies = await db.all(
      'SELECT * FROM feedback_replies WHERE feedback_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
      [id]
    );
    
    res.json({
      success: true,
      data: replies.map(r => ({
        id: r.id,
        feedbackId: r.feedback_id,
        parentReplyId: r.parent_reply_id,
        userId: r.user_id,
        userName: r.user_name,
        message: r.message,
        votes: r.votes || 0,  // แปลง NULL เป็น 0
        createdAt: r.created_at,
        editedAt: r.edited_at,
        editedBy: r.edited_by,
      }))
    });
  } catch (error) {
    console.error('Error fetching replies:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูล',
      details: error.message
    });
  }
});

// POST /api/feedback/:id/vote - Vote feedback (up/down)
app.post('/api/feedback/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, voteType } = req.body; // voteType: 'up' or 'down'
    
    if (!userId || !voteType || !['up', 'down'].includes(voteType)) {
      return res.status(400).json({ error: 'Invalid vote data' });
    }
    
    // Check existing vote
    const existingVote = await db.get(
      'SELECT * FROM feedback_votes WHERE feedback_id = ? AND user_id = ?',
      [id, userId]
    );
    
    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        // Remove vote (toggle off)
        await db.run('DELETE FROM feedback_votes WHERE id = ?', [existingVote.id]);
        await db.run(
          `UPDATE feedback SET votes = votes ${voteType === 'up' ? '-' : '+'} 1 WHERE id = ?`,
          [id]
        );
        return res.json({ success: true, action: 'removed' });
      } else {
        // Change vote
        await db.run(
          'UPDATE feedback_votes SET vote_type = ? WHERE id = ?',
          [voteType, existingVote.id]
        );
        await db.run(
          `UPDATE feedback SET votes = votes ${voteType === 'up' ? '+' : '-'} 2 WHERE id = ?`,
          [id]
        );
        return res.json({ success: true, action: 'changed' });
      }
    }
    
    // Add new vote
    const voteId = Date.now().toString();
    await db.run(
      'INSERT INTO feedback_votes (id, feedback_id, user_id, vote_type) VALUES (?, ?, ?, ?)',
      [voteId, id, userId, voteType]
    );
    await db.run(
      `UPDATE feedback SET votes = votes ${voteType === 'up' ? '+' : '-'} 1 WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, action: 'added' });
  } catch (error) {
    console.error('Error voting feedback:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/feedback/:id/views - Increment views
app.post('/api/feedback/:id/views', async (req, res) => {
  try {
    const { id } = req.params;
    await db.run('UPDATE feedback SET views = views + 1 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error incrementing views:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/feedback/:id/replies/:replyId/vote - Vote reply
app.post('/api/feedback/:id/replies/:replyId/vote', async (req, res) => {
  try {
    const { replyId } = req.params;
    const { userId, voteType } = req.body;
    
    if (!userId || !voteType || !['up', 'down'].includes(voteType)) {
      return res.status(400).json({ error: 'Invalid vote data' });
    }
    
    const existingVote = await db.get(
      'SELECT * FROM reply_votes WHERE reply_id = ? AND user_id = ?',
      [replyId, userId]
    );
    
    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        await db.run('DELETE FROM reply_votes WHERE id = ?', [existingVote.id]);
        await db.run(
          `UPDATE feedback_replies SET votes = COALESCE(votes, 0) ${voteType === 'up' ? '-' : '+'} 1 WHERE id = ?`,
          [replyId]
        );
        return res.json({ success: true, action: 'removed' });
      } else {
        await db.run(
          'UPDATE reply_votes SET vote_type = ? WHERE id = ?',
          [voteType, existingVote.id]
        );
        await db.run(
          `UPDATE feedback_replies SET votes = COALESCE(votes, 0) ${voteType === 'up' ? '+' : '-'} 2 WHERE id = ?`,
          [replyId]
        );
        return res.json({ success: true, action: 'changed' });
      }
    }
    
    const voteId = Date.now().toString();
    
    await db.run(
      'INSERT INTO reply_votes (id, reply_id, user_id, vote_type) VALUES (?, ?, ?, ?)',
      [voteId, replyId, userId, voteType]
    );
    
    await db.run(
      `UPDATE feedback_replies SET votes = COALESCE(votes, 0) ${voteType === 'up' ? '+' : '-'} 1 WHERE id = ?`,
      [replyId]
    );
    
    res.json({ success: true, action: 'added' });
  } catch (error) {
    console.error('Error voting reply:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/feedback/:id/replies - เพิ่ม reply ใหม่
app.post('/api/feedback/:id/replies', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userName, message, parentReplyId } = req.body;
    
    // Validate required fields
    if (!userId || !userName || !message) {
      return res.status(400).json({
        error: 'ข้อมูลไม่ครบถ้วน'
      });
    }
    
    // Check if feedback exists
    const feedback = await db.get('SELECT id FROM feedback WHERE id = ?', [id]);
    if (!feedback) {
      return res.status(404).json({
        error: 'ไม่พบข้อเสนอแนะ'
      });
    }
    
    // Validate nesting level (max 2 levels)
    if (parentReplyId) {
      const parentReply = await db.get(
        'SELECT parent_reply_id FROM feedback_replies WHERE id = ?',
        [parentReplyId]
      );
      
      if (!parentReply) {
        return res.status(404).json({
          error: 'ไม่พบ reply ที่ต้องการตอบกลับ'
        });
      }
      
      // ถ้า parent มี parent_reply_id แสดงว่าเป็น level 2 แล้ว ไม่อนุญาตให้ reply ต่อ
      if (parentReply.parent_reply_id) {
        return res.status(400).json({
          error: 'สามารถตอบกลับได้สูงสุด 2 ชั้นเท่านั้น กรุณาใช้ @mention แทน'
        });
      }
    }
    
    const replyId = Date.now().toString();
    
    await db.run(`
      INSERT INTO feedback_replies (
        id, feedback_id, parent_reply_id, user_id, user_name, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [replyId, id, parentReplyId || null, userId, userName, message]);
    
    // Update last_activity ของ feedback
    await db.run(
      'UPDATE feedback SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
    
    console.log(`✅ Reply added to feedback ${id} by ${userName}${parentReplyId ? ' (nested)' : ''}`);
    res.json({
      success: true,
      message: 'ตอบกลับสำเร็จ',
      replyId: replyId
    });
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({
      error: 'เกิดข้อผิดพลาดในการตอบกลับ',
      details: error.message
    });
  }
});

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  if (db) {
    if (isDevelopment) {
      await db.close();
    } else {
      await db.end();
    }
  }
  process.exit(0);
});
