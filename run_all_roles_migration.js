/**
 * Run All Roles Enhanced Permissions Migration
 * เพิ่มสิทธิ์ให้ทุก Roles
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const MIGRATION_PATH = path.join(__dirname, 'migrations', '004_all_roles_enhanced_permissions.sql');

console.log('🚀 Starting All Roles Enhanced Permissions Migration...\n');

// Read migration file
console.log('📖 Reading migration file...');
const migrationSQL = fs.readFileSync(MIGRATION_PATH, 'utf8');

// Connect to database
console.log('📦 Connecting to database...');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Failed to connect to database:', err.message);
    process.exit(1);
  }
});

// Execute migration
console.log('⚙️  Executing migration...\n');

db.exec(migrationSQL, (err) => {
  if (err) {
    console.error('❌ Migration failed:', err.message);
    db.close();
    process.exit(1);
  }
  
  console.log('✅ Migration completed successfully!\n');
  
  // Show permissions for all roles
  console.log('📊 Permissions Summary by Role:');
  console.log('═'.repeat(80));
  
  db.all(`
    SELECT 
      r.role_name,
      r.role_code,
      r.level,
      COUNT(rp.permission_id) as permission_count
    FROM roles r
    LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
    GROUP BY r.role_id
    ORDER BY r.level, r.role_name
  `, (err, roles) => {
    if (err) {
      console.error('❌ Query failed:', err.message);
      db.close();
      process.exit(1);
    }
    
    roles.forEach((role) => {
      const levelIcon = role.level === 1 ? '👑' : 
                       role.level === 2 ? '🏛️' : 
                       role.level === 3 ? '📋' : '👤';
      
      console.log(`${levelIcon} ${role.role_name.padEnd(25)} [${role.role_code.padEnd(18)}] → ${role.permission_count} permissions`);
    });
    
    console.log('═'.repeat(80));
    
    // Show detailed permissions for each role
    console.log('\n📋 Detailed Permissions by Role:\n');
    
    const rolesToShow = ['TAMBON_OFFICER', 'AMPHOE_OFFICER', 'RESEARCHER', 'TRADER', 'TRANSPORTER', 'GROUP_LEADER'];
    
    let processed = 0;
    rolesToShow.forEach((roleCode) => {
      db.all(`
        SELECT p.permission_code, p.description
        FROM role_permissions rp
        JOIN roles r ON rp.role_id = r.role_id
        JOIN permissions p ON rp.permission_id = p.permission_id
        WHERE r.role_code = ?
        ORDER BY p.resource, p.action
      `, [roleCode], (err, permissions) => {
        if (err) {
          console.error('❌ Query failed:', err.message);
        } else {
          console.log(`\n🎯 ${roleCode} (${permissions.length} permissions):`);
          console.log('─'.repeat(80));
          permissions.forEach((perm, index) => {
            console.log(`   ${(index + 1).toString().padStart(2)}. ${perm.permission_code.padEnd(25)} - ${perm.description}`);
          });
        }
        
        processed++;
        if (processed === rolesToShow.length) {
          // Close database
          db.close((err) => {
            if (err) {
              console.error('❌ Failed to close database:', err.message);
            }
          });
          
          console.log('\n' + '═'.repeat(80));
          console.log('\n🎉 Migration completed successfully!');
          console.log('\n💡 Next steps:');
          console.log('   1. Restart backend server (node server.js)');
          console.log('   2. Users logout and login again to get new permissions');
          console.log('   3. Check dashboard to see new cards based on roles\n');
        }
      });
    });
  });
});
