const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Using database: ${DB_PATH}`);
console.log('🔐 Fixing SUPER_ADMIN permissions...\n');
console.log('SUPER_ADMIN should have ALL permissions that ADMIN has\n');

// Step 1: Get ADMIN permissions that SUPER_ADMIN doesn't have
db.all(`
  SELECT DISTINCT p.permission_id, p.permission_code, p.permission_name
  FROM permissions p
  JOIN role_permissions rp_admin ON p.permission_id = rp_admin.permission_id
  JOIN roles r_admin ON rp_admin.role_id = r_admin.role_id
  WHERE r_admin.role_code = 'ADMIN'
  AND p.permission_id NOT IN (
    SELECT rp_super.permission_id
    FROM role_permissions rp_super
    JOIN roles r_super ON rp_super.role_id = r_super.role_id
    WHERE r_super.role_code = 'SUPER_ADMIN'
  )
  ORDER BY p.resource, p.action
`, (err, missingPerms) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }

  if (!missingPerms || missingPerms.length === 0) {
    console.log('✅ SUPER_ADMIN already has all ADMIN permissions!');
    db.close();
    return;
  }

  console.log(`📊 Found ${missingPerms.length} permissions to add to SUPER_ADMIN:\n`);
  missingPerms.forEach(p => {
    console.log(`   • ${p.permission_code}`);
  });
  console.log('');

  // Step 2: Get SUPER_ADMIN role_id
  db.get('SELECT role_id FROM roles WHERE role_code = ?', ['SUPER_ADMIN'], (err2, superRole) => {
    if (err2 || !superRole) {
      console.error('❌ Error getting SUPER_ADMIN role:', err2);
      db.close();
      return;
    }

    const superRoleId = superRole.role_id;
    console.log(`✅ Found SUPER_ADMIN role (ID: ${superRoleId})\n`);

    // Step 3: Insert missing permissions
    let added = 0;
    let completed = 0;

    missingPerms.forEach(perm => {
      db.run(`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (?, ?)
      `, [superRoleId, perm.permission_id], (err3) => {
        if (err3) {
          console.error(`❌ Error adding ${perm.permission_code}:`, err3.message);
        } else {
          console.log(`✅ Added: ${perm.permission_code}`);
          added++;
        }
        
        completed++;
        if (completed === missingPerms.length) {
          console.log('');
          console.log('═'.repeat(60));
          console.log('✅ SUPER_ADMIN permissions fixed!');
          console.log(`   Added: ${added}/${missingPerms.length}`);
          console.log('');
          
          // Get final counts
          db.all(`
            SELECT r.role_code, r.level, COUNT(rp.permission_id) as count
            FROM roles r
            LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
            WHERE r.role_code IN ('SUPER_ADMIN', 'ADMIN', 'RESEARCHER', 'AMPHOE_OFFICER')
            GROUP BY r.role_id
            ORDER BY r.level
          `, (err4, counts) => {
            if (!err4 && counts) {
              console.log('📊 Final permission counts:\n');
              counts.forEach(c => {
                console.log(`   ${c.role_code.padEnd(20)} Level ${c.level}    ${c.count} permissions`);
              });
              
              const superCount = counts.find(c => c.role_code === 'SUPER_ADMIN')?.count || 0;
              const adminCount = counts.find(c => c.role_code === 'ADMIN')?.count || 0;
              
              console.log('');
              if (superCount > adminCount) {
                console.log('✅ CORRECT: SUPER_ADMIN > ADMIN');
              } else if (superCount === adminCount) {
                console.log('✅ EQUAL: SUPER_ADMIN = ADMIN (both have all permissions)');
              } else {
                console.log('❌ PROBLEM: SUPER_ADMIN < ADMIN (still needs fixing)');
              }
            }
            console.log('═'.repeat(60));
            db.close();
          });
        }
      });
    });
  });
});
