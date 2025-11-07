/**
 * File Upload Routes
 * จัดการอัปโหลดไฟล์สำหรับ Feedback
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// กำหนด upload directory
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'feedback');

// สร้าง directory ถ้ายังไม่มี
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log(`✅ Created upload directory: ${UPLOAD_DIR}`);
}

// กำหนดขนาดไฟล์สูงสุดตามประเภท (bytes)
const FILE_SIZE_LIMITS = {
  image: 5 * 1024 * 1024,      // 5 MB for images
  pdf: 10 * 1024 * 1024,       // 10 MB for PDF
  document: 5 * 1024 * 1024,   // 5 MB for documents
  video: 50 * 1024 * 1024,     // 50 MB for videos
  audio: 10 * 1024 * 1024,     // 10 MB for audio
  archive: 20 * 1024 * 1024,   // 20 MB for archives
  default: 5 * 1024 * 1024,    // 5 MB default
};

// รายการไฟล์ที่อนุญาต
const ALLOWED_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.svg'],
  pdf: ['.pdf'],
  document: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'],
  video: ['.mp4', '.avi', '.mov'],
  audio: ['.mp3', '.wav'],
  archive: ['.zip', '.rar', '.7z'],
};

// รวมไฟล์ที่อนุญาตทั้งหมด
const ALL_ALLOWED_EXTENSIONS = Object.values(ALLOWED_EXTENSIONS).flat();

// ฟังก์ชันเช็คประเภทไฟล์
function getFileCategory(ext) {
  ext = ext.toLowerCase();
  for (const [category, extensions] of Object.entries(ALLOWED_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'default';
}

// ฟังก์ชันเช็คขนาดไฟล์ตามประเภท
function getMaxFileSize(ext) {
  const category = getFileCategory(ext);
  return FILE_SIZE_LIMITS[category] || FILE_SIZE_LIMITS.default;
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    // ทำความสะอาดชื่อไฟล์ (remove special chars)
    const cleanBasename = basename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${timestamp}-${randomStr}-${cleanBasename}${ext}`;
    cb(null, filename);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  // เช็คว่าเป็นไฟล์ที่อนุญาตหรือไม่
  if (!ALL_ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new Error(`ไม่อนุญาตให้อัปโหลดไฟล์ประเภท ${ext}. อนุญาตเฉพาะ: ${ALL_ALLOWED_EXTENSIONS.join(', ')}`),
      false
    );
  }
  
  cb(null, true);
};

// Custom file size limiter (ตามประเภทไฟล์)
const customFileSizeLimiter = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next();
  }
  
  // เช็คขนาดแต่ละไฟล์
  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const maxSize = getMaxFileSize(ext);
    const category = getFileCategory(ext);
    
    if (file.size > maxSize) {
      // ลบไฟล์ที่อัปโหลดแล้ว
      fs.unlinkSync(file.path);
      
      return res.status(413).json({
        success: false,
        error: `ไฟล์ ${file.originalname} มีขนาดเกินกำหนด`,
        details: `ประเภท ${category} อนุญาตสูงสุด ${(maxSize / (1024 * 1024)).toFixed(1)} MB`,
        fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      });
    }
  }
  
  next();
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // Global limit 50 MB (will be checked per type)
    files: 10, // Max 10 files
  },
});

// ==========================================
// POST /api/upload/feedback
// อัปโหลดไฟล์สำหรับ Feedback
// ==========================================
router.post('/feedback', upload.array('files', 10), customFileSizeLimiter, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ไม่มีไฟล์ที่ต้องการอัปโหลด',
      });
    }
    
    // สร้าง URL สำหรับแต่ละไฟล์
    const fileUrls = req.files.map(file => {
      const ext = path.extname(file.originalname).toLowerCase();
      const category = getFileCategory(ext);
      
      return {
        originalName: file.originalname,
        filename: file.filename,
        url: `/uploads/feedback/${file.filename}`,
        size: file.size,
        mimetype: file.mimetype,
        category: category,
        uploadedAt: new Date().toISOString(),
      };
    });
    
    res.json({
      success: true,
      message: `อัปโหลด ${fileUrls.length} ไฟล์สำเร็จ`,
      files: fileUrls,
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    
    // ถ้ามี error ให้ลบไฟล์ที่อัปโหลดไปแล้ว
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์',
      details: error.message,
    });
  }
});

// ==========================================
// DELETE /api/upload/feedback/:filename
// ลบไฟล์
// ==========================================
router.delete('/feedback/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(UPLOAD_DIR, filename);
    
    // เช็คว่าไฟล์มีอยู่จริง
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'ไม่พบไฟล์',
      });
    }
    
    // ลบไฟล์
    fs.unlinkSync(filePath);
    
    res.json({
      success: true,
      message: 'ลบไฟล์สำเร็จ',
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการลบไฟล์',
      details: error.message,
    });
  }
});

// ==========================================
// GET /api/upload/limits
// ดึงข้อมูลขนาดไฟล์ที่อนุญาต
// ==========================================
router.get('/limits', (req, res) => {
  const limitsInMB = {};
  for (const [category, bytes] of Object.entries(FILE_SIZE_LIMITS)) {
    limitsInMB[category] = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  
  res.json({
    success: true,
    limits: limitsInMB,
    allowedExtensions: ALLOWED_EXTENSIONS,
    maxFiles: 10,
  });
});

// ==========================================
// POST /api/upload/image
// อัปโหลดรูปภาพสำหรับ Rich Text Editor
// ==========================================
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const imageDir = path.join(__dirname, '..', 'uploads', 'images');
      if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
      }
      cb(null, imageDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = crypto.randomBytes(16).toString('hex');
      const ext = path.extname(file.originalname);
      cb(null, `${uniqueName}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.image.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น'));
    }
  },
  limits: {
    fileSize: FILE_SIZE_LIMITS.image
  }
});

router.post('/image', imageUpload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาอัปโหลดรูปภาพ'
      });
    }

    const imageUrl = `/uploads/images/${req.file.filename}`;
    
    console.log(`✅ Image uploaded: ${imageUrl}`);
    
    res.json({
      success: true,
      url: imageUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ'
    });
  }
});

module.exports = router;
