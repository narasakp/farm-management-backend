/**
 * RBAC API Routes
 * จัดการ Roles, Permissions และการตรวจสอบสิทธิ์
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { getUserPermissions, requirePermission, logAuditAction } = require('../middleware/rbac');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

// =============================================
// GET /api/rbac/me/permissions
// ดึงข้อมูล role และ permissions ของผู้ใช้ปัจจุบัน
// =============================================
router.get('/me/permissions', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 GET /me/permissions - User ID:', req.user.id);
    console.log('🔍 req.user:', req.user);
    
    const userPermissions = await getUserPermissions(req.user.id);
    
    console.log('✅ User permissions:', userPermissions);
    
    if (!userPermissions) {
      return res.status(404).json({ 
        error: 'Not Found',
        message: 'ไม่พบข้อมูลผู้ใช้' 
      });
    }

    res.json({
      success: true,
      data: userPermissions
    });
  } catch (error) {
    console.error('❌ Get user permissions error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' 
    });
  }
});

// =============================================
// POST /api/rbac/check-permission
// ตรวจสอบว่าผู้ใช้มี permission หรือไม่
// =============================================
router.post('/check-permission', authenticateToken, async (req, res) => {
  try {
    const { permission_code } = req.body;
    
    if (!permission_code) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'กรุณาระบุ permission_code' 
      });
    }

    const db = new sqlite3.Database(DB_PATH);
    
    db.get(`
      SELECT 1
      FROM permissions p
      JOIN role_permissions rp ON p.permission_id = rp.permission_id
      JOIN roles r ON rp.role_id = r.role_id
      JOIN users u ON u.role = r.role_code
      WHERE u.id = ? AND p.permission_code = ?
    `, [req.user.id, permission_code], (err, row) => {
      db.close();
      
      if (err) {
        console.error('Check permission error:', err);
        return res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาด' 
        });
      }

      res.json({
        success: true,
        has_permission: !!row,
        permission_code
      });
    });
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// =============================================
// GET /api/rbac/users
// ดึงรายชื่อ users ทั้งหมด (Admin only)
// =============================================
router.get('/users', authenticateToken, requirePermission('dashboard.all'), (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  db.all(`
    SELECT 
      u.id,
      u.username,
      u.email,
      u.display_name,
      u.role,
      u.phone,
      u.is_active,
      u.is_verified,
      u.province_code,
      u.amphoe_code,
      u.tambon_code,
      u.created_at,
      u.last_login_at,
      r.role_name
    FROM users u
    LEFT JOIN roles r ON u.role = r.role_code
    ORDER BY u.created_at DESC
  `, (err, users) => {
    db.close();
    
    if (err) {
      console.error('Get users error:', err);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
      });
    }

    console.log('📧 [RBAC] Returning users:', users?.length || 0);
    console.log('📧 [RBAC] Sample user emails:', users?.slice(0, 3).map(u => ({ username: u.username, email: u.email })));

    res.json({
      success: true,
      users: users || []
    });
  });
});

// =============================================
// GET /api/rbac/roles
// ดึงรายการ roles ทั้งหมด
// =============================================
router.get('/roles', authenticateToken, requirePermission('dashboard.all'), (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  db.all(`
    SELECT 
      r.*,
      COUNT(rp.permission_id) as permission_count
    FROM roles r
    LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
    WHERE r.is_active = 1
    GROUP BY r.role_id
    ORDER BY r.level, r.role_name
  `, (err, rows) => {
    db.close();
    
    if (err) {
      console.error('Get roles error:', err);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
      });
    }

    res.json({
      success: true,
      roles: rows
    });
  });
});

// =============================================
// GET /api/rbac/roles/:roleCode/permissions
// ดึง permissions ของ role
// =============================================
router.get('/roles/:roleCode/permissions', authenticateToken, requirePermission('dashboard.all'), async (req, res) => {
  const { roleCode } = req.params;
  const db = new sqlite3.Database(DB_PATH);
  
  db.all(`
    SELECT 
      p.permission_id,
      p.permission_name,
      p.permission_code,
      p.resource,
      p.action,
      p.description
    FROM permissions p
    JOIN role_permissions rp ON p.permission_id = rp.permission_id
    JOIN roles r ON rp.role_id = r.role_id
    WHERE r.role_code = ?
    ORDER BY p.resource, p.action
  `, [roleCode], (err, rows) => {
    db.close();
    
    if (err) {
      console.error('Get role permissions error:', err);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
      });
    }

    res.json({
      success: true,
      role_code: roleCode,
      permissions: rows
    });
  });
});

// =============================================
// PUT /api/rbac/roles/:roleCode/permissions
// อัปเดต permissions ของ role (Admin only)
// =============================================
router.put('/roles/:roleCode/permissions', authenticateToken, requirePermission('dashboard.all'), async (req, res) => {
  const { roleCode } = req.params;
  const { permission_codes } = req.body;
  
  if (!Array.isArray(permission_codes)) {
    return res.status(400).json({ 
      error: 'Bad Request',
      message: 'permission_codes must be an array' 
    });
  }
  
  const db = new sqlite3.Database(DB_PATH);
  
  // Get role_id
  db.get('SELECT role_id, role_name FROM roles WHERE role_code = ?', [roleCode], (err1, role) => {
    if (err1) {
      db.close();
      console.error('Get role error:', err1);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
      });
    }
    
    if (!role) {
      db.close();
      return res.status(404).json({ 
        error: 'Not Found',
        message: 'ไม่พบ role' 
      });
    }
    
    // ป้องกันการแก้ไข SUPER_ADMIN
    if (roleCode === 'SUPER_ADMIN') {
      db.close();
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'ไม่สามารถแก้ไข permissions ของ SUPER_ADMIN' 
      });
    }
    
    // ลบ permissions เดิม
    db.run('DELETE FROM role_permissions WHERE role_id = ?', [role.role_id], (err2) => {
      if (err2) {
        db.close();
        console.error('Delete permissions error:', err2);
        return res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาด' 
        });
      }
      
      if (permission_codes.length === 0) {
        db.close();
        
        // Log audit
        logAuditAction({
          user_id: req.user.id,
          username: req.user.username,
          role: req.user.role,
          action: 'UPDATE_ROLE_PERMISSIONS',
          resource: 'roles',
          resource_id: role.role_id,
          details: JSON.stringify({
            role_code: roleCode,
            permission_count: 0
          }),
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        });
        
        return res.json({
          success: true,
          message: 'อัปเดต permissions สำเร็จ',
          role_code: roleCode,
          permission_count: 0
        });
      }
      
      // Get permission_ids
      const placeholders = permission_codes.map(() => '?').join(',');
      db.all(
        `SELECT permission_id FROM permissions WHERE permission_code IN (${placeholders})`,
        permission_codes,
        (err3, perms) => {
          if (err3) {
            db.close();
            console.error('Get permissions error:', err3);
            return res.status(500).json({ 
              error: 'Internal Server Error',
              message: 'เกิดข้อผิดพลาด' 
            });
          }
          
          if (perms.length === 0) {
            db.close();
            return res.status(400).json({ 
              error: 'Bad Request',
              message: 'ไม่พบ permissions ที่ระบุ' 
            });
          }
          
          // Insert new permissions
          let inserted = 0;
          perms.forEach((perm, index) => {
            db.run(
              'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
              [role.role_id, perm.permission_id],
              (err4) => {
                if (err4) {
                  console.error('Insert permission error:', err4);
                }
                
                inserted++;
                if (inserted === perms.length) {
                  db.close();
                  
                  // Log audit
                  logAuditAction({
                    user_id: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    action: 'UPDATE_ROLE_PERMISSIONS',
                    resource: 'roles',
                    resource_id: role.role_id,
                    details: JSON.stringify({
                      role_code: roleCode,
                      permission_count: perms.length
                    }),
                    ip_address: req.ip,
                    user_agent: req.get('user-agent')
                  });
                  
                  res.json({
                    success: true,
                    message: 'อัปเดต permissions สำเร็จ',
                    role_code: roleCode,
                    permission_count: perms.length
                  });
                }
              }
            );
          });
        }
      );
    });
  });
});

// =============================================
// GET /api/rbac/permissions
// ดึงรายการ permissions ทั้งหมด
// =============================================
router.get('/permissions', authenticateToken, requirePermission('dashboard.all'), (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  db.all(`
    SELECT *
    FROM permissions
    ORDER BY resource, action
  `, (err, rows) => {
    db.close();
    
    if (err) {
      console.error('Get permissions error:', err);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
      });
    }

    // Group by resource
    const grouped = {};
    rows.forEach((perm) => {
      if (!grouped[perm.resource]) {
        grouped[perm.resource] = [];
      }
      grouped[perm.resource].push(perm);
    });

    res.json({
      success: true,
      permissions: rows,
      grouped: grouped,
      total: rows.length
    });
  });
});

// =============================================
// GET /api/rbac/permission-matrix
// ดึง permission matrix (roles x permissions)
// =============================================
router.get('/permission-matrix', authenticateToken, requirePermission('dashboard.all'), (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  // Get all roles
  db.all('SELECT * FROM roles ORDER BY level, role_code', (err1, roles) => {
    if (err1) {
      db.close();
      console.error('Get roles error:', err1);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
      });
    }
    
    // Get all permissions
    db.all('SELECT * FROM permissions ORDER BY resource, action', (err2, permissions) => {
      if (err2) {
        db.close();
        console.error('Get permissions error:', err2);
        return res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาด' 
        });
      }
      
      // Get role-permission mappings
      db.all(`
        SELECT r.role_code, p.permission_code
        FROM role_permissions rp
        JOIN roles r ON rp.role_id = r.role_id
        JOIN permissions p ON rp.permission_id = p.permission_id
      `, (err3, mappings) => {
        db.close();
        
        if (err3) {
          console.error('Get mappings error:', err3);
          return res.status(500).json({ 
            error: 'Internal Server Error',
            message: 'เกิดข้อผิดพลาด' 
          });
        }
        
        // Build matrix
        const matrix = {};
        roles.forEach((role) => {
          matrix[role.role_code] = {};
          permissions.forEach((perm) => {
            matrix[role.role_code][perm.permission_code] = false;
          });
        });
        
        // Fill matrix with actual permissions
        mappings.forEach((mapping) => {
          if (matrix[mapping.role_code]) {
            matrix[mapping.role_code][mapping.permission_code] = true;
          }
        });
        
        res.json({
          success: true,
          roles,
          permissions,
          matrix
        });
      });
    });
  });
});

// =============================================
// PUT /api/rbac/users/:userId/role
// เปลี่ยน role ของผู้ใช้ (Admin only)
// =============================================
router.put('/users/:userId/role', authenticateToken, requirePermission('dashboard.all'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, tambon_code, amphoe_code, province_code } = req.body;

    if (!role) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'กรุณาระบุ role' 
      });
    }

    const db = new sqlite3.Database(DB_PATH);

    // ตรวจสอบว่า role มีอยู่จริง
    db.get('SELECT role_code FROM roles WHERE role_code = ?', [role], (err, roleRow) => {
      if (err || !roleRow) {
        db.close();
        return res.status(400).json({ 
          error: 'Bad Request',
          message: 'Role ไม่ถูกต้อง' 
        });
      }

      // อัปเดต role
      db.run(`
        UPDATE users 
        SET role = ?, tambon_code = ?, amphoe_code = ?, province_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [role, tambon_code || null, amphoe_code || null, province_code || null, userId], function(err) {
        if (err) {
          db.close();
          console.error('Update role error:', err);
          return res.status(500).json({ 
            error: 'Internal Server Error',
            message: 'เกิดข้อผิดพลาดในการอัปเดต' 
          });
        }

        if (this.changes === 0) {
          db.close();
          return res.status(404).json({ 
            error: 'Not Found',
            message: 'ไม่พบผู้ใช้' 
          });
        }

        db.close();

        // Log audit
        logAuditAction({
          user_id: req.user.id,
          username: req.user.username,
          role: req.user.role,
          action: 'UPDATE_USER_ROLE',
          resource: 'users',
          resource_id: userId,
          details: JSON.stringify({ new_role: role }),
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        });

        res.json({
          success: true,
          message: 'อัปเดต role สำเร็จ'
        });
      });
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// =============================================
// PUT /api/rbac/users/:userId/status
// เปิด/ปิดการใช้งานผู้ใช้ (Admin only)
// =============================================
router.put('/users/:userId/status', authenticateToken, requirePermission('dashboard.all'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'กรุณาระบุ is_active (true/false)' 
      });
    }

    const db = new sqlite3.Database(DB_PATH);

    // อัปเดตสถานะ
    db.run(`
      UPDATE users 
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [is_active ? 1 : 0, userId], function(err) {
      if (err) {
        db.close();
        console.error('Update user status error:', err);
        return res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาดในการอัปเดต' 
        });
      }

      if (this.changes === 0) {
        db.close();
        return res.status(404).json({ 
          error: 'Not Found',
          message: 'ไม่พบผู้ใช้' 
        });
      }

      db.close();

      // Log audit
      logAuditAction({
        user_id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        action: is_active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        resource: 'users',
        resource_id: userId,
        details: JSON.stringify({ is_active }),
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      res.json({
        success: true,
        message: is_active ? 'เปิดการใช้งานสำเร็จ' : 'ปิดการใช้งานสำเร็จ'
      });
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// =============================================
// GET /api/rbac/stats
// ดึงสถิติภาพรวม (Admin only)
// =============================================
router.get('/stats', authenticateToken, requirePermission('dashboard.all'), async (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  
  try {
    // Total users
    db.get('SELECT COUNT(*) as total FROM users', (err1, totalUsers) => {
      if (err1) throw err1;
      
      // Active users
      db.get('SELECT COUNT(*) as total FROM users WHERE is_active = 1', (err2, activeUsers) => {
        if (err2) throw err2;
        
        // Total roles
        db.get('SELECT COUNT(*) as total FROM roles', (err3, totalRoles) => {
          if (err3) throw err3;
          
          // Total permissions
          db.get('SELECT COUNT(*) as total FROM permissions', (err4, totalPerms) => {
            if (err4) throw err4;
            
            // Users by role
            db.all(`
              SELECT 
                r.role_name as role, 
                r.role_code as role_code,
                COUNT(u.id) as count 
              FROM roles r 
              LEFT JOIN users u ON r.role_code = u.role 
              GROUP BY r.role_id, r.role_name, r.role_code
              ORDER BY count DESC
            `, (err5, usersByRole) => {
              db.close();
              
              if (err5) throw err5;
              
              res.json({
                success: true,
                total_users: totalUsers?.total || 0,
                active_users: activeUsers?.total || 0,
                total_roles: totalRoles?.total || 0,
                total_permissions: totalPerms?.total || 0,
                users_by_role: usersByRole || []
              });
            });
          });
        });
      });
    });
  } catch (error) {
    db.close();
    console.error('Get stats error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// =============================================
// DELETE /api/rbac/users/:userId
// ลบผู้ใช้ (Admin only) - CASCADE DELETE related records
// =============================================
router.delete('/users/:userId', authenticateToken, requirePermission('dashboard.all'), async (req, res) => {
  try {
    const { userId } = req.params;

    // ป้องกันการลบตัวเอง
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'ไม่สามารถลบผู้ใช้ของตัวเองได้' 
      });
    }

    const db = new sqlite3.Database(DB_PATH);

    // ตรวจสอบว่าผู้ใช้มีอยู่จริง
    db.get('SELECT id, username, role FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        db.close();
        console.error('Get user error:', err);
        return res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'เกิดข้อผิดพลาด' 
        });
      }

      if (!user) {
        db.close();
        return res.status(404).json({ 
          error: 'Not Found',
          message: 'ไม่พบผู้ใช้' 
        });
      }

      // ป้องกันการลบ SUPER_ADMIN
      if (user.role === 'SUPER_ADMIN') {
        db.close();
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'ไม่สามารถลบ SUPER_ADMIN ได้' 
        });
      }

      // ลบ related records ก่อน (เพราะ SQLite ไม่รองรับ CASCADE DELETE ในบาง version)
      // 1. ลบ user_sessions
      db.run('DELETE FROM user_sessions WHERE user_id = ?', [userId], (err1) => {
        if (err1) console.error('Delete user_sessions error:', err1);
        
        // 2. ลบ password_reset_tokens
        db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId], (err2) => {
          if (err2) console.error('Delete password_reset_tokens error:', err2);
          
          // 3. ลบ production_records
          db.run('DELETE FROM production_records WHERE user_id = ?', [userId], (err3) => {
            if (err3) console.error('Delete production_records error:', err3);
            
            // 4. SET NULL auth_logs (เก็บ history ไว้)
            db.run('UPDATE auth_logs SET user_id = NULL WHERE user_id = ?', [userId], (err4) => {
              if (err4) console.error('Update auth_logs error:', err4);
              
              // 5. ลบ user
              db.run('DELETE FROM users WHERE id = ?', [userId], function(err5) {
                db.close();
                
                if (err5) {
                  console.error('Delete user error:', err5);
                  return res.status(500).json({ 
                    error: 'Internal Server Error',
                    message: 'เกิดข้อผิดพลาดในการลบผู้ใช้' 
                  });
                }

                if (this.changes === 0) {
                  return res.status(404).json({ 
                    error: 'Not Found',
                    message: 'ไม่พบผู้ใช้' 
                  });
                }

                // Log audit
                logAuditAction({
                  user_id: req.user.id,
                  username: req.user.username,
                  role: req.user.role,
                  action: 'DELETE_USER',
                  resource: 'users',
                  resource_id: userId,
                  details: JSON.stringify({ deleted_username: user.username }),
                  ip_address: req.ip,
                  user_agent: req.get('user-agent')
                });

                res.json({
                  success: true,
                  message: 'ลบผู้ใช้สำเร็จ'
                });
              });
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// =============================================
// GET /api/rbac/audit-logs
// ดึง audit logs (Admin only)
// =============================================
router.get('/audit-logs', authenticateToken, requirePermission('dashboard.all'), (req, res) => {
  const { limit = 100, offset = 0, user_id, action, resource } = req.query;
  const db = new sqlite3.Database(DB_PATH);
  
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  let params = [];

  if (user_id) {
    query += ' AND user_id = ?';
    params.push(user_id);
  }

  if (action) {
    query += ' AND action = ?';
    params.push(action);
  }

  if (resource) {
    query += ' AND resource = ?';
    params.push(resource);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    db.close();
    
    if (err) {
      console.error('Get audit logs error:', err);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาด' 
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

module.exports = router;
