const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission, logAuditAction } = require('../middleware/rbac');

/**
 * Admin Routes - PostgreSQL Version
 * สำหรับ SUPER_ADMIN เท่านั้น
 * แก้ไขทั้งหมดให้ใช้ pool.query() แทน db.all(), db.get(), db.run()
 */

module.exports = function(pool) {
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
    console.log('👥 GET /api/admin/users - Fetching all users...');
    
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
        u.created_at,
        u.last_login_at,
        r.role_name
      FROM users u
      LEFT JOIN roles r ON u.role = r.role_code
      ORDER BY u.created_at DESC
    `;

    const users = await pool.query(query);
    console.log(`✅ Found ${users.length} users`);
    console.log('📊 First user:', users[0] ? users[0].username : 'No users');
    
    res.json({ users });
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/admin/users/:id
 * ดูรายละเอียด user
 */
router.get('/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // ดึงข้อมูล user
    const userResult = await pool.query(
      `SELECT 
        u.*,
        r.role_name,
        r.level as role_level
      FROM users u
      LEFT JOIN roles r ON u.role = r.role_code
      WHERE u.id = $1`,
      [id]
    );

    if (userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult[0];

    // ดึง permissions ของ user
    const permResult = await pool.query(
      `SELECT p.permission_code, p.resource, p.action, p.description
       FROM permissions p
       JOIN role_permissions rp ON p.permission_id = rp.permission_id
       JOIN roles r ON rp.role_id = r.role_id
       WHERE r.role_code = $1`,
      [user.role]
    );

    res.json({
      user,
      permissions: permResult || [],
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
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
    const roleResult = await pool.query('SELECT role_code FROM roles WHERE role_code = $1', [role]);
    
    if (roleResult.length === 0) {
      console.log(`❌ [API] Invalid role: ${role}`);
      return res.status(400).json({ error: 'Invalid role' });
    }

    // ดึงข้อมูล user ก่อน update
    const userResult = await pool.query('SELECT username, role as old_role FROM users WHERE id = $1', [id]);
    
    if (userResult.length === 0) {
      console.log(`❌ [API] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult[0];

    // Update role
    await pool.query(
      'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [role, id]
    );

    console.log(`✅ [API] Role updated: ${user.username} from ${user.old_role} to ${role}`);

    // Log audit (optional - don't fail if audit table doesn't exist)
    try {
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
    } catch (auditError) {
      console.warn('⚠️ [API] Audit log failed (table may not exist):', auditError.message);
    }

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
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    
    if (userResult.length === 0) {
      console.log(`❌ [API] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult[0];

    await pool.query(
      'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [is_active, id]
    );

    console.log(`✅ [API] Status updated: ${user.username} is_active=${is_active}`);

    // Log audit (optional - don't fail if audit table doesn't exist)
    try {
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
    } catch (auditError) {
      console.warn('⚠️ [API] Audit log failed (table may not exist):', auditError.message);
    }

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
    const userResult = await pool.query('SELECT username, display_name FROM users WHERE id = $1', [id]);
    
    if (userResult.length === 0) {
      console.log(`❌ [API] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult[0];

    // PostgreSQL: CASCADE delete will handle related records automatically if FK constraints are set
    // Otherwise, delete manually:
    console.log('🗑️ Deleting related records...');
    await pool.query('DELETE FROM farms WHERE owner_id = $1', [id]);
    await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM production_records WHERE user_id = $1', [id]);
    await pool.query('UPDATE admin_audit_log SET user_id = NULL WHERE user_id = $1', [id]);
    
    // ลบ user
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    console.log(`✅ [API] User deleted: ${user.username}`);

    // Log audit (optional - don't fail if audit table doesn't exist)
    try {
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
    } catch (auditError) {
      console.warn('⚠️ [API] Audit log failed (table may not exist):', auditError.message);
    }

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
    const roles = await pool.query(
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
router.get('/roles/:roleCode/permissions', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { roleCode } = req.params;

  try {
    const permissions = await pool.query(
      `SELECT p.permission_id, p.permission_code, p.resource, p.action, p.description
       FROM permissions p
       JOIN role_permissions rp ON p.permission_id = rp.permission_id
       JOIN roles r ON rp.role_id = r.role_id
       WHERE r.role_code = $1
       ORDER BY p.resource, p.action`,
      [roleCode]
    );

    res.json({ role_code: roleCode, permissions });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

/**
 * GET /api/admin/permissions
 * ดึง permissions ทั้งหมด
 */
router.get('/permissions', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const permissions = await pool.query('SELECT * FROM permissions ORDER BY resource, action');

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
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

/**
 * GET /api/admin/permission-matrix
 * ดึง permission matrix (roles x permissions)
 */
router.get('/permission-matrix', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // Get all roles
    const roles = await pool.query('SELECT * FROM roles ORDER BY level, role_code');

    // Get all permissions
    const permissions = await pool.query('SELECT * FROM permissions ORDER BY resource, action');

    // Get role-permission mappings
    const mappings = await pool.query(
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
    const totalUsersResult = await pool.query('SELECT COUNT(*) as total FROM users');
    stats.total_users = parseInt(totalUsersResult[0].total) || 0;

    // Active users
    const activeUsersResult = await pool.query('SELECT COUNT(*) as total FROM users WHERE is_active = true');
    stats.active_users = parseInt(activeUsersResult[0].total) || 0;

    // Total roles
    const totalRolesResult = await pool.query('SELECT COUNT(*) as total FROM roles');
    stats.total_roles = parseInt(totalRolesResult[0].total) || 0;

    // Total permissions
    const totalPermsResult = await pool.query('SELECT COUNT(*) as total FROM permissions');
    stats.total_permissions = parseInt(totalPermsResult[0].total) || 0;

    // Users by role
    const usersByRoleResult = await pool.query(
      'SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC'
    );
    stats.users_by_role = usersByRoleResult || [];

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

  return router;
};
