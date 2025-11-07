/**
 * Hierarchical RBAC Middleware
 * เช็ค permission โดยคำนึงถึง role hierarchy
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * ดึงข้อมูล role level ของผู้ใช้
 */
async function getUserRoleLevel(userId) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    db.get(`
      SELECT r.level, r.role_code, r.role_name
      FROM users u
      JOIN roles r ON u.role = r.role_code
      WHERE u.id = ?
    `, [userId], (err, row) => {
      db.close();
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

/**
 * ดึงข้อมูล role level จาก role_code
 */
async function getRoleLevel(roleCode) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    db.get(`
      SELECT level, role_code, role_name, is_protected
      FROM roles
      WHERE role_code = ?
    `, [roleCode], (err, row) => {
      db.close();
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

/**
 * เช็คว่า user สามารถจัดการ target user ได้หรือไม่
 * ตาม role hierarchy (level ต่ำกว่าเท่านั้น)
 */
async function canManageUser(currentUserId, targetUserId) {
  try {
    const currentUserRole = await getUserRoleLevel(currentUserId);
    const targetUserRole = await getUserRoleLevel(targetUserId);
    
    if (!currentUserRole || !targetUserRole) {
      return {
        allowed: false,
        reason: 'ไม่พบข้อมูล role ของผู้ใช้'
      };
    }
    
    // เช็ค level: สามารถจัดการได้เฉพาะ level ที่สูงกว่า (ตัวเลขมากกว่า)
    if (targetUserRole.level > currentUserRole.level) {
      return {
        allowed: true,
        currentLevel: currentUserRole.level,
        targetLevel: targetUserRole.level
      };
    }
    
    return {
      allowed: false,
      reason: `ไม่สามารถจัดการผู้ใช้ที่มีสิทธิ์เท่ากันหรือสูงกว่าได้\n` +
              `คุณ: ${currentUserRole.role_name} (Level ${currentUserRole.level})\n` +
              `เป้าหมาย: ${targetUserRole.role_name} (Level ${targetUserRole.level})`,
      currentLevel: currentUserRole.level,
      targetLevel: targetUserRole.level
    };
  } catch (error) {
    return {
      allowed: false,
      reason: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์',
      error: error.message
    };
  }
}

/**
 * เช็คว่า user สามารถจัดการ role ได้หรือไม่
 * ตาม role hierarchy (level ต่ำกว่าเท่านั้น)
 */
async function canManageRole(currentUserId, targetRoleCode) {
  try {
    const currentUserRole = await getUserRoleLevel(currentUserId);
    const targetRole = await getRoleLevel(targetRoleCode);
    
    if (!currentUserRole || !targetRole) {
      return {
        allowed: false,
        reason: 'ไม่พบข้อมูล role'
      };
    }
    
    // เช็ค protected role
    if (targetRole.is_protected) {
      return {
        allowed: false,
        reason: `ไม่สามารถจัดการ "${targetRole.role_name}" ได้ (Protected Role)`,
        currentLevel: currentUserRole.level,
        targetLevel: targetRole.level
      };
    }
    
    // เช็ค level: สามารถจัดการได้เฉพาะ level ที่สูงกว่า (ตัวเลขมากกว่า)
    if (targetRole.level > currentUserRole.level) {
      return {
        allowed: true,
        currentLevel: currentUserRole.level,
        targetLevel: targetRole.level
      };
    }
    
    return {
      allowed: false,
      reason: `ไม่สามารถจัดการ role ที่มีสิทธิ์เท่ากันหรือสูงกว่าได้\n` +
              `คุณ: ${currentUserRole.role_name} (Level ${currentUserRole.level})\n` +
              `เป้าหมาย: ${targetRole.role_name} (Level ${targetRole.level})`,
      currentLevel: currentUserRole.level,
      targetLevel: targetRole.level
    };
  } catch (error) {
    return {
      allowed: false,
      reason: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์',
      error: error.message
    };
  }
}

/**
 * Middleware: เช็คว่าสามารถลบ user ได้หรือไม่
 */
function requireCanDeleteUser(req, res, next) {
  const targetUserId = req.params.userId || req.body.userId;
  
  if (!targetUserId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'กรุณาระบุ userId'
    });
  }
  
  canManageUser(req.user.id, targetUserId)
    .then(result => {
      if (result.allowed) {
        req.hierarchicalCheck = result;
        next();
      } else {
        res.status(403).json({
          error: 'Forbidden',
          message: result.reason,
          details: {
            currentLevel: result.currentLevel,
            targetLevel: result.targetLevel
          }
        });
      }
    })
    .catch(error => {
      console.error('Hierarchical check error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์'
      });
    });
}

/**
 * Middleware: เช็คว่าสามารถจัดการ role ได้หรือไม่
 */
function requireCanManageRole(req, res, next) {
  const targetRoleCode = req.params.roleCode || req.body.roleCode;
  
  if (!targetRoleCode) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'กรุณาระบุ roleCode'
    });
  }
  
  canManageRole(req.user.id, targetRoleCode)
    .then(result => {
      if (result.allowed) {
        req.hierarchicalCheck = result;
        next();
      } else {
        res.status(403).json({
          error: 'Forbidden',
          message: result.reason,
          details: {
            currentLevel: result.currentLevel,
            targetLevel: result.targetLevel
          }
        });
      }
    })
    .catch(error => {
      console.error('Hierarchical check error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์'
      });
    });
}

module.exports = {
  canManageUser,
  canManageRole,
  requireCanDeleteUser,
  requireCanManageRole,
  getUserRoleLevel,
  getRoleLevel
};
