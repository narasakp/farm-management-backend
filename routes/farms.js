/**
 * Farms API Routes with RBAC
 * จัดการข้อมูลฟาร์มพร้อม Role-Based Access Control
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { Pool } = require('pg');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission, requireOwnership, logAuditAction } = require('../middleware/rbac');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

// PostgreSQL pool สำหรับ production (ใช้สำหรับ statistics และฟีเจอร์ที่ย้ายแล้ว)
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// Helper: สร้าง WHERE clause ตาม role
function buildWhereClause(userRole, userId, tambonCode, amphoeCode) {
  let where = 'WHERE 1=1';
  let params = [];

  switch(userRole) {
    case 'FARMER':
      where += ' AND f.owner_id = ?';
      params.push(userId);
      break;
    
    case 'TRADER':
      where += ' AND f.status = "ACTIVE"';
      break;
    
    case 'TAMBON_OFFICER':
      where += ' AND f.tambon_code = ?';
      params.push(tambonCode);
      break;
    
    case 'AMPHOE_OFFICER':
      where += ' AND f.amphoe_code = ?';
      params.push(amphoeCode);
      break;
    
    case 'GROUP_LEADER':
      // ดูเฉพาะฟาร์มในกลุ่ม (จะต้องมี junction table)
      where += ' AND f.status = "ACTIVE"';
      break;
    
    // RESEARCHER, SUPER_ADMIN ดูได้ทั้งหมด
  }

  return { where, params };
}

// =============================================
// GET /api/farms
// ดูรายการฟาร์ม (กรองตาม role)
// =============================================
router.get('/', authenticateToken, requirePermission('farms.read'), (req, res) => {
  const { search, status, farm_type, limit = 50, offset = 0 } = req.query;
  const db = new sqlite3.Database(DB_PATH);

  // สร้าง WHERE clause ตาม role
  const { where, params } = buildWhereClause(
    req.user.role,
    req.user.id,
    req.user.tambon_code,
    req.user.amphoe_code
  );

  let query = `
    SELECT 
      f.*,
      u.username as owner_username,
      u.email as owner_email,
      (SELECT COUNT(*) FROM farm_surveys WHERE farm_id = f.farm_id) as survey_count
    FROM farms f
    JOIN users u ON f.owner_id = u.id
    ${where}
  `;

  // เพิ่มเงื่อนไขการค้นหา
  if (search) {
    query += ' AND (f.farm_name LIKE ? OR f.farm_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (status) {
    query += ' AND f.status = ?';
    params.push(status);
  }

  if (farm_type) {
    query += ' AND f.farm_type = ?';
    params.push(farm_type);
  }

  query += ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    db.close();

    if (err) {
      console.error('Get farms error:', err);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
      });
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: rows.length
      }
    });
  });
});

// =============================================
// GET /api/farms/:id
// ดูรายละเอียดฟาร์ม
// =============================================
router.get('/:id', authenticateToken, requirePermission('farms.read'), (req, res) => {
  const { id } = req.params;
  const db = new sqlite3.Database(DB_PATH);

  // สร้าง WHERE clause ตาม role
  const { where, params } = buildWhereClause(
    req.user.role,
    req.user.id,
    req.user.tambon_code,
    req.user.amphoe_code
  );

  params.unshift(id); // เพิ่ม farm_id เป็น parameter แรก

  const query = `
    SELECT 
      f.*,
      u.username as owner_username,
      u.email as owner_email,
      u.role as owner_role,
      (SELECT COUNT(*) FROM farm_surveys WHERE farm_id = f.farm_id) as survey_count,
      (SELECT COUNT(*) FROM survey_livestock sl 
       JOIN farm_surveys fs ON sl.survey_id = fs.survey_id 
       WHERE fs.farm_id = f.farm_id) as livestock_count
    FROM farms f
    JOIN users u ON f.owner_id = u.id
    ${where.replace('WHERE 1=1', 'WHERE f.farm_id = ?')}
  `;

  db.get(query, params, (err, row) => {
    db.close();

    if (err) {
      console.error('Get farm error:', err);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด'
      });
    }

    if (!row) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'ไม่พบข้อมูลฟาร์ม หรือคุณไม่มีสิทธิ์เข้าถึง'
      });
    }

    res.json({
      success: true,
      data: row
    });
  });
});

// =============================================
// POST /api/farms
// สร้างฟาร์มใหม่
// =============================================
router.post('/', authenticateToken, requirePermission('farms.crud'), async (req, res) => {
  try {
    const {
      farm_name,
      farm_code,
      address,
      tambon_code,
      amphoe_code,
      province_code,
      latitude,
      longitude,
      farm_type,
      total_area
    } = req.body;

    if (!farm_name) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'กรุณาระบุชื่อฟาร์ม'
      });
    }

    const db = new sqlite3.Database(DB_PATH);

    // ตรวจสอบ farm_code ซ้ำ
    if (farm_code) {
      const existing = await new Promise((resolve, reject) => {
        db.get('SELECT farm_id FROM farms WHERE farm_code = ?', [farm_code], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existing) {
        db.close();
        return res.status(400).json({
          error: 'Bad Request',
          message: 'รหัสฟาร์มนี้มีอยู่แล้ว'
        });
      }
    }

    // สร้างฟาร์มใหม่
    db.run(`
      INSERT INTO farms (
        owner_id, farm_name, farm_code, address,
        tambon_code, amphoe_code, province_code,
        latitude, longitude, farm_type, total_area
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user.id,
      farm_name,
      farm_code || null,
      address || null,
      tambon_code || null,
      amphoe_code || null,
      province_code || null,
      latitude || null,
      longitude || null,
      farm_type || null,
      total_area || null
    ], function(err) {
      if (err) {
        db.close();
        console.error('Create farm error:', err);
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาดในการสร้างฟาร์ม'
        });
      }

      const farmId = this.lastID;
      db.close();

      // Log audit
      logAuditAction({
        user_id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        action: 'CREATE_FARM',
        resource: 'farms',
        resource_id: farmId,
        details: JSON.stringify({ farm_name }),
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      res.status(201).json({
        success: true,
        message: 'สร้างฟาร์มสำเร็จ',
        data: { farm_id: farmId }
      });
    });
  } catch (error) {
    console.error('Create farm error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

// =============================================
// PUT /api/farms/:id
// แก้ไขข้อมูลฟาร์ม (เจ้าของเท่านั้น)
// =============================================
router.put('/:id',
  authenticateToken,
  requirePermission('farms.crud'),
  requireOwnership('farm'),
  (req, res) => {
    const { id } = req.params;
    const {
      farm_name,
      farm_code,
      address,
      tambon_code,
      amphoe_code,
      province_code,
      latitude,
      longitude,
      farm_type,
      total_area,
      status
    } = req.body;

    const db = new sqlite3.Database(DB_PATH);

    db.run(`
      UPDATE farms SET
        farm_name = COALESCE(?, farm_name),
        farm_code = COALESCE(?, farm_code),
        address = COALESCE(?, address),
        tambon_code = COALESCE(?, tambon_code),
        amphoe_code = COALESCE(?, amphoe_code),
        province_code = COALESCE(?, province_code),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        farm_type = COALESCE(?, farm_type),
        total_area = COALESCE(?, total_area),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE farm_id = ?
    `, [
      farm_name, farm_code, address,
      tambon_code, amphoe_code, province_code,
      latitude, longitude, farm_type, total_area, status,
      id
    ], function(err) {
      db.close();

      if (err) {
        console.error('Update farm error:', err);
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาด'
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'ไม่พบฟาร์ม'
        });
      }

      // Log audit
      logAuditAction({
        user_id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        action: 'UPDATE_FARM',
        resource: 'farms',
        resource_id: id,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      res.json({
        success: true,
        message: 'อัปเดตฟาร์มสำเร็จ'
      });
    });
  }
);

// =============================================
// DELETE /api/farms/:id
// ลบฟาร์ม (เจ้าของเท่านั้น)
// =============================================
router.delete('/:id',
  authenticateToken,
  requirePermission('farms.crud'),
  requireOwnership('farm'),
  (req, res) => {
    const { id } = req.params;
    const db = new sqlite3.Database(DB_PATH);

    // Soft delete
    db.run(`
      UPDATE farms 
      SET status = 'DELETED', updated_at = CURRENT_TIMESTAMP
      WHERE farm_id = ?
    `, [id], function(err) {
      db.close();

      if (err) {
        console.error('Delete farm error:', err);
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาด'
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'ไม่พบฟาร์ม'
        });
      }

      // Log audit
      logAuditAction({
        user_id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        action: 'DELETE_FARM',
        resource: 'farms',
        resource_id: id,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      res.json({
        success: true,
        message: 'ลบฟาร์มสำเร็จ'
      });
    });
  }
);

// =============================================
// GET /api/farms/statistics/summary
// สถิติฟาร์ม (ตาม role) - ใช้ PostgreSQL
// =============================================
router.get('/statistics/summary', authenticateToken, requirePermission('farms.read'), async (req, res) => {
  try {
    // เนื่องจากตาราง farms ยังไม่ได้ย้ายมาเต็ม เราใช้ farm_surveys + survey_livestock ที่ migrate มาแล้ว

    // เกษตรกรทั้งหมด = จำนวนนับไม่ซ้ำของ farmer_id ใน farm_surveys
    const farmersResult = await pgPool.query(
      `SELECT COUNT(DISTINCT farmer_id) AS total_farmers FROM farm_surveys`
    );

    // ปศุสัตว์ทั้งหมด = SUM(count) จาก survey_livestock
    const livestockResult = await pgPool.query(
      `SELECT COALESCE(SUM(count), 0) AS total_livestock FROM survey_livestock`
    );

    const totalFarmers = Number(farmersResult.rows[0]?.total_farmers || 0);
    const totalLivestock = Number(livestockResult.rows[0]?.total_livestock || 0);

    // ส่งค่าในรูปแบบเดิม (field name เดิมบางส่วนใช้ไม่ได้แล้ว จึง map เท่าที่จำเป็นให้ frontend ใช้ได้)
    res.json({
      success: true,
      data: {
        total_farms: totalFarmers, // ถ้าต้องการจำนวนฟาร์มแท้จริง ค่อยปรับภายหลังเมื่อมีตาราง farms ใน PG
        total_farmers: totalFarmers,
        total_livestock: totalLivestock
      }
    });
  } catch (err) {
    console.error('Get statistics (PostgreSQL) error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

module.exports = router;
