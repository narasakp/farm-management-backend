const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission, logAuditAction } = require('../middleware/rbac');

/**
 * Admin Routes - สำหรับ SUPER_ADMIN เท่านั้น
 * ต้องมี permission: admin.users, admin.roles
 */

// Export function that takes db as parameter
module.exports = function(db) {
  const router = express.Router();

  // Middleware: ตรวจสอบว่าเป็น SUPER_ADMIN
  const requireSuperAdmin = (req, res, next) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Super Admin only' });
    }
    next();
  };

// ==================== USER MANAGEMENT ====================

/**
 * GET /api/admin/users
 * ดึงรายชื่อ users ทั้งหมด
 */
router.get('/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const query = `
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
    `;

    // PostgreSQL: pool.query() แทน db.all()
    const result = await db.query(query);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/admin/users/:id
 * ดูรายละเอียด user
 */
router.get('/users/:id', authenticateToken, requireSuperAdmin, (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT 
      u.*,
      r.role_name,
      r.level as role_level
    FROM users u
    LEFT JOIN roles r ON u.role = r.role_code
    WHERE u.id = ?`,
    [id],
    (err, user) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).json({ error: 'Failed to fetch user' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // ดึง permissions ของ user
      db.all(
        `SELECT p.permission_code, p.resource, p.action, p.description
         FROM permissions p
         JOIN role_permissions rp ON p.permission_id = rp.permission_id
         JOIN roles r ON rp.role_id = r.role_id
         WHERE r.role_code = ?`,
        [user.role],
        (err, permissions) => {
          if (err) {
            console.error('Error fetching permissions:', err);
          }

          res.json({
            user,
            permissions: permissions || [],
          });
        }
      );
    }
  );
});

/**
 * PUT /api/admin/users/:id/role
 * เปลี่ยน role ของ user
 */
router.put('/users/:id/role', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  console.log(`🔄 [API] Change role: user_id=${id}, new_role=${role}`);

  if (!role) {
    return res.status(400).json({ error: 'Role is required' });
  }

  try {
    // ตรวจสอบว่า role มีอยู่จริง
    const roleData = await db.get('SELECT role_code FROM roles WHERE role_code = ?', [role]);
    
    if (!roleData) {
      console.log(`❌ [API] Invalid role: ${role}`);
      return res.status(400).json({ error: 'Invalid role' });
    }

    // ดึงข้อมูล user ก่อน update
    const user = await db.get('SELECT username, role as old_role FROM users WHERE id = ?', [id]);
    
    if (!user) {
      console.log(`❌ [API] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Update role
    await db.run(
      'UPDATE users SET role = ?, updated_at = datetime("now") WHERE id = ?',
      [role, id]
    );

    console.log(`✅ [API] Role updated: ${user.username} from ${user.old_role} to ${role}`);

    // Log audit
    await logAuditAction({
      user_id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'CHANGE_USER_ROLE',
      resource: 'users',
      resource_id: id,
      details: JSON.stringify({
        target_user: user.username,
        old_role: user.old_role,
        new_role: role,
      }),
      success: true,
    });

    res.json({
      message: 'Role updated successfully',
      user_id: id,
      username: user.username,
      old_role: user.old_role,
      new_role: role,
    });
  } catch (error) {
    console.error('❌ [API] Error changing role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * PUT /api/admin/users/:id/status
 * เปิด/ปิดการใช้งาน user
 */
router.put('/users/:id/status', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  console.log(`🔄 [API] Toggle status: user_id=${id}, is_active=${is_active}`);

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be boolean' });
  }

  // ป้องกันการปิด account ตัวเอง
  if (req.user.id === parseInt(id) && !is_active) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  try {
    const user = await db.get('SELECT username FROM users WHERE id = ?', [id]);
    
    if (!user) {
      console.log(`❌ [API] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    await db.run(
      'UPDATE users SET is_active = ?, updated_at = datetime("now") WHERE id = ?',
      [is_active ? 1 : 0, id]
    );

    console.log(`✅ [API] Status updated: ${user.username} is_active=${is_active}`);

    // Log audit
    await logAuditAction({
      user_id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: is_active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      resource: 'users',
      resource_id: id,
      details: JSON.stringify({ target_user: user.username }),
      success: true,
    });

    res.json({
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`,
      user_id: id,
      username: user.username,
      is_active,
    });
  } catch (error) {
    console.error('❌ [API] Error updating status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * ลบผู้ใช้ (CASCADE DELETE related records)
 */
router.delete('/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  console.log(`🗑️ [API] Delete user: user_id=${id}`);

  // ป้องกันการลบ account ตัวเอง
  if (req.user.id === parseInt(id)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const user = await db.get('SELECT username, display_name FROM users WHERE id = ?', [id]);
    
    if (!user) {
      console.log(`❌ [API] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // ปิด foreign key check ชั่วคราว
    await db.run('PRAGMA foreign_keys = OFF');
    
    try {
      // ลบ related records
      console.log('🗑️ Deleting related records...');
      await db.run('DELETE FROM farms WHERE owner_id = ?', [id]);
      await db.run('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      await db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [id]);
      await db.run('DELETE FROM production_records WHERE user_id = ?', [id]);
      await db.run('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?', [id]);
      
      // ลบ user
      await db.run('DELETE FROM users WHERE id = ?', [id]);

      console.log(`✅ [API] User deleted: ${user.username}`);
    } finally {
      // เปิด foreign key check กลับ (ต้องทำเสมอ!)
      await db.run('PRAGMA foreign_keys = ON');
    }

    // Log audit
    await logAuditAction({
      user_id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'DELETE_USER',
      resource: 'users',
      resource_id: id,
      details: JSON.stringify({
        deleted_user: user.username,
        display_name: user.display_name,
      }),
      success: true,
    });

    res.json({
      message: 'User deleted successfully',
      user_id: id,
      username: user.username,
    });
  } catch (error) {
    console.error('❌ [API] Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ==================== ROLE MANAGEMENT ====================

/**
 * GET /api/admin/roles
 * ดึง roles ทั้งหมดพร้อมจำนวน permissions
 */
router.get('/roles', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const roles = await db.all(
      `SELECT 
        r.role_id,
        r.role_code,
        r.role_name,
        r.description,
        r.level,
        r.is_active,
        COUNT(DISTINCT rp.permission_id) as permission_count,
        (SELECT COUNT(*) FROM users WHERE role = r.role_code) as user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
      GROUP BY r.role_id
      ORDER BY r.level, r.role_code`
    );

    // 🔍 DEBUG: ดู user_count ใน console
    console.log('✅ Roles with user_count:', JSON.stringify(roles, null, 2));

    res.json({ roles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

/**
 * GET /api/admin/roles/:roleCode/permissions
 * ดึง permissions ของ role
 */
router.get('/roles/:roleCode/permissions', authenticateToken, requireSuperAdmin, (req, res) => {
  const { roleCode } = req.params;

  db.all(
    `SELECT p.permission_id, p.permission_code, p.resource, p.action, p.description
     FROM permissions p
     JOIN role_permissions rp ON p.permission_id = rp.permission_id
     JOIN roles r ON rp.role_id = r.role_id
     WHERE r.role_code = ?
     ORDER BY p.resource, p.action`,
    [roleCode],
    (err, permissions) => {
      if (err) {
        console.error('Error fetching permissions:', err);
        return res.status(500).json({ error: 'Failed to fetch permissions' });
      }

      res.json({ role_code: roleCode, permissions });
    }
  );
});

/**
 * PUT /api/admin/roles/:roleCode/permissions
 * อัปเดต permissions ของ role
 */
router.put('/roles/:roleCode/permissions', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { roleCode } = req.params;
  const { permission_codes } = req.body; // Array of permission codes

  if (!Array.isArray(permission_codes)) {
    return res.status(400).json({ error: 'permission_codes must be an array' });
  }

  try {
    // Get role_id
    const role = await db.get('SELECT role_id, role_name FROM roles WHERE role_code = ?', [roleCode]);
    
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // ป้องกันการแก้ไข SUPER_ADMIN
    if (roleCode === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot modify SUPER_ADMIN permissions' });
    }

    // Start transaction
    await db.run('BEGIN TRANSACTION');

    try {
      // ลบ permissions เดิมทั้งหมด
      await db.run('DELETE FROM role_permissions WHERE role_id = ?', [role.role_id]);

      if (permission_codes.length === 0) {
        // ถ้าไม่มี permissions commit เลย
        await db.run('COMMIT');

        await logAuditAction({
          user_id: req.user.id,
          username: req.user.username,
          role: req.user.role,
          action: 'UPDATE_ROLE_PERMISSIONS',
          resource: 'roles',
          resource_id: role.role_id,
          details: JSON.stringify({
            role_code: roleCode,
            permission_count: 0,
          }),
          success: true,
        });

        return res.json({
          message: 'Permissions updated successfully',
          role_code: roleCode,
          permission_count: 0,
        });
      }

      // เพิ่ม permissions ใหม่
      const placeholders = permission_codes.map(() => '?').join(',');
      const perms = await db.all(
        `SELECT permission_id FROM permissions WHERE permission_code IN (${placeholders})`,
        permission_codes
      );

      if (perms.length === 0) {
        await db.run('ROLLBACK');
        return res.status(400).json({ error: 'No valid permissions found' });
      }

      // Insert new permissions
      for (const perm of perms) {
        await db.run(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
          [role.role_id, perm.permission_id]
        );
      }

      // Commit transaction
      await db.run('COMMIT');

      await logAuditAction({
        user_id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        action: 'UPDATE_ROLE_PERMISSIONS',
        resource: 'roles',
        resource_id: role.role_id,
        details: JSON.stringify({
          role_code: roleCode,
          permission_count: perms.length,
          permissions: permission_codes,
        }),
        success: true,
      });

      res.json({
        message: 'Permissions updated successfully',
        role_code: roleCode,
        role_name: role.role_name,
        permission_count: perms.length,
      });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating role permissions:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// ==================== PERMISSION MANAGEMENT ====================

/**
 * GET /api/admin/permissions
 * ดึง permissions ทั้งหมด
 */
router.get('/permissions', authenticateToken, requireSuperAdmin, (req, res) => {
  db.all(
    'SELECT * FROM permissions ORDER BY resource, action',
    [],
    (err, permissions) => {
      if (err) {
        console.error('Error fetching permissions:', err);
        return res.status(500).json({ error: 'Failed to fetch permissions' });
      }

      // Group by resource
      const grouped = {};
      permissions.forEach((perm) => {
        if (!grouped[perm.resource]) {
          grouped[perm.resource] = [];
        }
        grouped[perm.resource].push(perm);
      });

      res.json({
        permissions,
        grouped,
        total: permissions.length,
      });
    }
  );
});

/**
 * GET /api/admin/permission-matrix
 * ดึง permission matrix (roles x permissions)
 */
router.get('/permission-matrix', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // Get all roles
    const roles = await db.all('SELECT * FROM roles ORDER BY level, role_code');

    // Get all permissions
    const permissions = await db.all('SELECT * FROM permissions ORDER BY resource, action');

    // Get role-permission mappings
    const mappings = await db.all(
      `SELECT r.role_code, p.permission_code
       FROM role_permissions rp
       JOIN roles r ON rp.role_id = r.role_id
       JOIN permissions p ON rp.permission_id = p.permission_id`
    );

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
      roles,
      permissions,
      matrix,
    });
  } catch (error) {
    console.error('Error fetching permission matrix:', error);
    res.status(500).json({ error: 'Failed to fetch permission matrix' });
  }
});

// ==================== STATISTICS ====================

/**
 * GET /api/admin/stats
 * สถิติภาพรวม
 */
router.get('/stats', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const stats = {};

    // Total users
    const totalUsers = await db.get('SELECT COUNT(*) as total FROM users');
    stats.total_users = totalUsers?.total || 0;

    // Active users
    const activeUsers = await db.get('SELECT COUNT(*) as total FROM users WHERE is_active = 1');
    stats.active_users = activeUsers?.total || 0;

    // Total roles
    const totalRoles = await db.get('SELECT COUNT(*) as total FROM roles');
    stats.total_roles = totalRoles?.total || 0;

    // Total permissions
    const totalPerms = await db.get('SELECT COUNT(*) as total FROM permissions');
    stats.total_permissions = totalPerms?.total || 0;

    // Users by role
    const usersByRole = await db.all(
      'SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC'
    );
    stats.users_by_role = usersByRole || [];

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

  return router;
};
