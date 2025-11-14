/**
 * RBAC Middleware
 * Role-Based Access Control สำหรับตรวจสอบสิทธิ์การเข้าถึง
 */

const { Pool } = require('pg');

// Shared PostgreSQL pool (DATABASE_URL must be set in environment)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

/**
 * ตรวจสอบว่าผู้ใช้มี permission หรือไม่
 */
async function checkPermission(userId, permissionCode) {
  const result = await pool.query(
    `SELECT p.permission_id, p.permission_code, p.resource, p.action
     FROM permissions p
     JOIN role_permissions rp ON p.permission_id = rp.permission_id
     JOIN roles r ON rp.role_id = r.role_id
     JOIN users u ON u.role = r.role_code
     WHERE u.id = $1 AND p.permission_code = $2`,
    [userId, permissionCode]
  );

  return result.rows.length > 0;
}

/**
 * ตรวจสอบหลาย permissions พร้อมกัน
 */
async function checkPermissions(userId, permissionCodes) {
  if (!permissionCodes || permissionCodes.length === 0) return true;

  const placeholders = permissionCodes.map((_, idx) => `$${idx + 2}`).join(',');

  const result = await pool.query(
    `SELECT p.permission_code
     FROM permissions p
     JOIN role_permissions rp ON p.permission_id = rp.permission_id
     JOIN roles r ON rp.role_id = r.role_id
     JOIN users u ON u.role = r.role_code
     WHERE u.id = $1 AND p.permission_code IN (${placeholders})`,
    [userId, ...permissionCodes]
  );

  const rows = result.rows || [];
  const hasAll = permissionCodes.every(code => 
    rows.some(row => row.permission_code === code)
  );

  return hasAll;
}

/**
 * ดึงข้อมูล role และ permissions ของผู้ใช้
 */
async function getUserPermissions(userId) {
  const result = await pool.query(
    `SELECT 
        u.id as user_id,
        u.username,
        u.role,
        r.role_name,
        r.level,
        p.permission_code,
        p.resource,
        p.action
     FROM users u
     JOIN roles r ON u.role = r.role_code
     JOIN role_permissions rp ON r.role_id = rp.role_id
     JOIN permissions p ON rp.permission_id = p.permission_id
     WHERE u.id = $1`,
    [userId]
  );

  const rows = result.rows || [];
  if (rows.length === 0) return null;

  return {
    user_id: rows[0].user_id,
    username: rows[0].username,
    role: rows[0].role,
    role_name: rows[0].role_name,
    level: rows[0].level,
    permissions: rows.map(row => ({
      code: row.permission_code,
      resource: row.resource,
      action: row.action
    }))
  };
}

/**
 * Middleware: ตรวจสอบ permission
 */
function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'กรุณาเข้าสู่ระบบ' 
        });
      }

      const hasPermission = await checkPermission(req.user.id, permissionCode);
      
      if (!hasPermission) {
        // Log unauthorized access
        await logAuditAction({
          user_id: req.user.id,
          username: req.user.username,
          role: req.user.role,
          action: 'ACCESS_DENIED',
          resource: permissionCode,
          success: 0,
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        });

        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'คุณไม่มีสิทธิ์เข้าถึงฟีเจอร์นี้',
          required_permission: permissionCode
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' 
      });
    }
  };
}

/**
 * Middleware: ตรวจสอบหลาย permissions (ต้องมีทั้งหมด)
 */
function requireAllPermissions(...permissionCodes) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'กรุณาเข้าสู่ระบบ' 
        });
      }

      const hasAll = await checkPermissions(req.user.id, permissionCodes);
      
      if (!hasAll) {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'คุณไม่มีสิทธิ์เข้าถึงฟีเจอร์นี้',
          required_permissions: permissionCodes
        });
      }

      next();
    } catch (error) {
      console.error('Permissions check error:', error);
      res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' 
      });
    }
  };
}

/**
 * Middleware: ตรวจสอบ resource ownership
 */
function requireOwnership(resourceType, idParam = 'id') {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'กรุณาเข้าสู่ระบบ' 
        });
      }

      const resourceId = req.params[idParam];
      const userId = req.user.id;
      const userRole = req.user.role;

      // Officers และ Researchers สามารถเข้าถึงได้ทั้งหมด (ตาม area)
      if (['SUPER_ADMIN', 'AMPHOE_OFFICER', 'TAMBON_OFFICER', 'RESEARCHER'].includes(userRole)) {
        return next();
      }

      // ตรวจสอบ ownership
      const isOwner = await checkResourceOwnership(resourceType, resourceId, userId);
      
      if (!isOwner) {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้' 
        });
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' 
      });
    }
  };
}

/**
 * ตรวจสอบ ownership ของ resource
 */
async function checkResourceOwnership(resourceType, resourceId, userId) {
  let query = '';
  let params = [];

  switch(resourceType) {
    case 'farm':
      query = 'SELECT 1 FROM farms WHERE farm_id = $1 AND owner_id = $2';
      params = [resourceId, userId];
      break;
    
    case 'livestock':
      query = `
        SELECT 1 FROM livestock l 
        JOIN farms f ON l.farm_id = f.farm_id 
        WHERE l.livestock_id = $1 AND f.owner_id = $2
      `;
      params = [resourceId, userId];
      break;
    
    case 'survey':
      query = `
        SELECT 1 FROM farm_surveys 
        WHERE survey_id = $1 AND (farmer_id = $2 OR surveyor_id = $2)
      `;
      params = [resourceId, userId];
      break;

    default:
      throw new Error('Unknown resource type: ' + resourceType);
  }

  const result = await pool.query(query, params);
  return result.rows.length > 0;
}

/**
 * ตรวจสอบว่าผู้ใช้สามารถเข้าถึง area นี้ได้หรือไม่
 */
function requireAreaAccess(areaType = 'tambon') {
  return async (req, res, next) => {
    try {
      const userRole = req.user.role;
      
      // Admin และ Researcher เข้าถึงได้ทุก area
      if (['SUPER_ADMIN', 'RESEARCHER'].includes(userRole)) {
        return next();
      }

      const resourceAreaCode = req.query.area_code || req.body.area_code;
      
      if (areaType === 'tambon' && userRole === 'TAMBON_OFFICER') {
        if (req.user.tambon_code !== resourceAreaCode) {
          return res.status(403).json({ 
            error: 'Forbidden',
            message: 'คุณไม่มีสิทธิ์เข้าถึงพื้นที่นี้' 
          });
        }
      }
      
      if (areaType === 'amphoe' && userRole === 'AMPHOE_OFFICER') {
        if (req.user.amphoe_code !== resourceAreaCode) {
          return res.status(403).json({ 
            error: 'Forbidden',
            message: 'คุณไม่มีสิทธิ์เข้าถึงพื้นที่นี้' 
          });
        }
      }

      next();
    } catch (error) {
      console.error('Area access check error:', error);
      res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' 
      });
    }
  };
}

/**
 * บันทึก audit log
 */
async function logAuditAction(data) {
  await pool.query(
    `INSERT INTO audit_logs (
        user_id, username, role, action, resource, resource_id,
        details, ip_address, user_agent, success
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      data.user_id,
      data.username,
      data.role,
      data.action,
      data.resource || null,
      data.resource_id || null,
      data.details || null,
      data.ip_address || null,
      data.user_agent || null,
      data.success !== undefined ? data.success : 1
    ]
  );
}

module.exports = {
  checkPermission,
  checkPermissions,
  getUserPermissions,
  requirePermission,
  requireAllPermissions,
  requireOwnership,
  requireAreaAccess,
  logAuditAction
};
