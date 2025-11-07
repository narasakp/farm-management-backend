/**
 * Run FARMER Additional Permissions Migration
 * เพิ่มสิทธิ์ให้เกษตรกร
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const MIGRATION_PATH = path.join(__dirname, 'migrations', '003_farmer_additional_permissions.sql');

console.log('🚀 Starting FARMER Additional Permissions Migration...\n');

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
  
  // Query to show FARMER permissions count
  db.get(`
    SELECT COUNT(*) as count
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.role_id
    WHERE r.role_code = 'FARMER'
  `, (err, result) => {
    if (err) {
      console.error('❌ Query failed:', err.message);
      db.close();
      process.exit(1);
    }
    
    console.log(`📊 FARMER now has ${result.count} permissions\n`);
    
    // Show all FARMER permissions
    console.log('📋 FARMER Permissions:');
    console.log('─'.repeat(60));
    
    db.all(`
      SELECT p.permission_code, p.permission_name, p.description
      FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.role_id
      JOIN permissions p ON rp.permission_id = p.permission_id
      WHERE r.role_code = 'FARMER'
      ORDER BY p.resource, p.action
    `, (err, permissions) => {
      if (err) {
        console.error('❌ Query failed:', err.message);
        db.close();
        process.exit(1);
      }
      
      permissions.forEach((perm, index) => {
        console.log(`${index + 1}. ${perm.permission_code.padEnd(25)} - ${perm.description}`);
      });
      
      console.log('─'.repeat(60));
      console.log(`\n✨ Total: ${permissions.length} permissions`);
      
      // Close database
      db.close((err) => {
        if (err) {
          console.error('❌ Failed to close database:', err.message);
        }
      });
      
      console.log('\n🎉 Migration completed successfully!');
      console.log('\n💡 Next steps:');
      console.log('   1. Restart backend server (node server.js)');
      console.log('   2. Logout and login again to get new permissions');
      console.log('   3. Check dashboard to see new cards\n');
    });
  });
});
