/**
 * Script: Fix Social Login Permissions
 * Purpose: เพิ่ม permissions ให้ user ที่ login ด้วย Google/Facebook แล้วไม่มี permissions
 * Usage: node fix_social_login_permissions.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database path
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

async function fixPermissions() {
  return new Promise((resolve, reject) => {
    // Find all users with Google/Facebook OAuth (no password)
    const query = `
      SELECT u.id, u.username, u.email, u.role
      FROM users u
      WHERE (u.password_hash = 'google_oauth_user' OR u.password_hash = 'facebook_oauth_user')
        AND u.id NOT IN (
          SELECT DISTINCT user_id FROM user_permissions
        )
    `;

    db.all(query, [], async (err, users) => {
      if (err) {
        console.error('❌ Error finding users:', err);
        reject(err);
        return;
      }

      console.log(`📋 Found ${users.length} Social Login users without permissions`);
      console.log('');

      if (users.length === 0) {
        console.log('✅ All Social Login users already have permissions');
        resolve();
        return;
      }

      // Process each user
      let fixed = 0;
      for (const user of users) {
        console.log(`🔧 Fixing user: ${user.username} (${user.email})`);
        console.log(`   Role: ${user.role}`);

        try {
          // Get permissions for role
          const permQuery = `
            SELECT p.permission_code
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.permission_id
            JOIN roles r ON rp.role_id = r.role_id
            WHERE r.role_code = ? AND rp.has_permission = 1
          `;

          const permissions = await new Promise((resolve, reject) => {
            db.all(permQuery, [user.role], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          console.log(`   📋 Found ${permissions.length} permissions for role: ${user.role}`);

          // Assign permissions
          for (const perm of permissions) {
            const insertQuery = `
              INSERT INTO user_permissions (user_id, permission_code, granted_at)
              VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id, permission_code) DO NOTHING
            `;

            await new Promise((resolve, reject) => {
              db.run(insertQuery, [user.id, perm.permission_code], (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }

          console.log(`   ✅ Assigned ${permissions.length} permissions`);
          console.log('');
          fixed++;
        } catch (error) {
          console.error(`   ❌ Error fixing user ${user.username}:`, error);
          console.log('');
        }
      }

      console.log('='.repeat(50));
      console.log(`✅ Fixed ${fixed} out of ${users.length} users`);
      console.log('');
      console.log('⚠️  Users need to LOGOUT and LOGIN again to see changes');
      resolve();
    });
  });
}

// Run the fix
console.log('🔧 Starting Social Login Permissions Fix...');
console.log('='.repeat(50));
console.log('');

fixPermissions()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    db.close();
    process.exit(1);
  });
