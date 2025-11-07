const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Using database: ${DB_PATH}`);
console.log('🔐 Upgrading ADMIN permissions...\n');
console.log('Adding permissions from RESEARCHER and AMPHOE_OFFICER roles\n');

// Permissions that ADMIN should have
const missingPermissions = [
  'breeding.read',
  'dashboard.amphoe',
  'farms.read',
  'farms.summary',
  'feed.read',
  'finance.fund',
  'finance.own',
  'groups.member',
  'health.read',
  'livestock.market',
  'livestock.read',
  'livestock.summary',
  'production.read',
  'production.summary',
  'research.crud',
  'surveys.crud',
  'surveys.read',
  'trading.read',
  'transport.book',
  'transport.crud',
  'transport.read'
];

// Step 1: Get ADMIN role_id
db.get('SELECT role_id FROM roles WHERE role_code = ?', ['ADMIN'], (err, adminRole) => {
  if (err) {
    console.error('❌ Error getting ADMIN role:', err);
    db.close();
    return;
  }

  if (!adminRole) {
    console.error('❌ ADMIN role not found!');
    db.close();
    return;
  }

  const adminRoleId = adminRole.role_id;
  console.log(`✅ Found ADMIN role (ID: ${adminRoleId})\n`);

  // Step 2: Get permission IDs
  const placeholders = missingPermissions.map(() => '?').join(',');
  db.all(`
    SELECT permission_id, permission_code, permission_name
    FROM permissions
    WHERE permission_code IN (${placeholders})
  `, missingPermissions, (err2, permissions) => {
    if (err2) {
      console.error('❌ Error getting permissions:', err2);
      db.close();
      return;
    }

    if (!permissions || permissions.length === 0) {
      console.log('⚠️  No permissions found');
      db.close();
      return;
    }

    console.log(`📊 Found ${permissions.length}/${missingPermissions.length} permissions\n`);

    // Step 3: Insert role_permissions (skip existing)
    let added = 0;
    let skipped = 0;
    let completed = 0;

    permissions.forEach(perm => {
      // Check if already exists
      db.get(`
        SELECT 1 FROM role_permissions 
        WHERE role_id = ? AND permission_id = ?
      `, [adminRoleId, perm.permission_id], (err3, existing) => {
        if (err3) {
          console.error(`❌ Error checking ${perm.permission_code}:`, err3.message);
          completed++;
          checkCompletion();
          return;
        }

        if (existing) {
          console.log(`⏭️  Skipped: ${perm.permission_code} (already exists)`);
          skipped++;
          completed++;
          checkCompletion();
          return;
        }

        // Insert new permission
        db.run(`
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES (?, ?)
        `, [adminRoleId, perm.permission_id], (err4) => {
          if (err4) {
            console.error(`❌ Error adding ${perm.permission_code}:`, err4.message);
          } else {
            console.log(`✅ Added: ${perm.permission_code}`);
            added++;
          }
          
          completed++;
          checkCompletion();
        });
      });
    });

    function checkCompletion() {
      if (completed === permissions.length) {
        console.log('');
        console.log('═'.repeat(60));
        console.log('✅ ADMIN permissions upgraded!');
        console.log(`   Added: ${added}`);
        console.log(`   Skipped: ${skipped}`);
        console.log(`   Total: ${added + skipped}`);
        console.log('');
        
        // Get final count
        db.get(`
          SELECT COUNT(*) as count
          FROM role_permissions
          WHERE role_id = ?
        `, [adminRoleId], (err5, result) => {
          if (!err5 && result) {
            console.log(`📊 ADMIN now has ${result.count} permissions`);
          }
          console.log('');
          console.log('💡 Next steps:');
          console.log('   1. Logout and login again as admin');
          console.log('   2. You should now see all dashboard cards');
          console.log('═'.repeat(60));
          
          db.close();
        });
      }
    }
  });
});
