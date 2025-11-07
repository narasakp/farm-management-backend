/**
 * Migration Runner Script
 * ใช้สำหรับรัน SQL Migration files
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');
const MIGRATIONS_DIR = __dirname;

// เปิดการเชื่อมต่อฐานข้อมูล
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to database:', DB_PATH);
});

// สร้างตาราง migrations_history ถ้ายังไม่มี
db.run(`
  CREATE TABLE IF NOT EXISTS migrations_history (
    migration_id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('❌ Error creating migrations_history table:', err.message);
    process.exit(1);
  }
  console.log('✅ Migrations history table ready');
  runMigrations();
});

// ฟังก์ชันสำหรับรัน migration
function runMigrations() {
  // อ่านไฟล์ migration ทั้งหมด
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('ℹ️  No migration files found');
    db.close();
    return;
  }

  console.log(`\n📁 Found ${files.length} migration file(s)\n`);

  let completed = 0;

  files.forEach((file, index) => {
    // ตรวจสอบว่า migration นี้เคยรันแล้วหรือไม่
    db.get(
      'SELECT * FROM migrations_history WHERE filename = ?',
      [file],
      (err, row) => {
        if (err) {
          console.error(`❌ Error checking migration ${file}:`, err.message);
          return;
        }

        if (row) {
          console.log(`⏭️  ${index + 1}. ${file} - Already executed`);
          completed++;
          if (completed === files.length) {
            finish();
          }
          return;
        }

        // อ่านไฟล์ SQL
        const filePath = path.join(MIGRATIONS_DIR, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        console.log(`⏳ ${index + 1}. Executing ${file}...`);

        // รัน SQL (SQLite จะรัน transaction ทั้งหมดใน file)
        db.exec(sql, (err) => {
          if (err) {
            console.error(`❌ Error executing ${file}:`, err.message);
            console.error('   Rolling back...');
            completed++;
            if (completed === files.length) {
              finish();
            }
            return;
          }

          // บันทึกว่ารัน migration นี้แล้ว
          db.run(
            'INSERT INTO migrations_history (filename) VALUES (?)',
            [file],
            (err) => {
              if (err) {
                console.error(`❌ Error recording migration ${file}:`, err.message);
              } else {
                console.log(`✅ ${index + 1}. ${file} - Executed successfully`);
              }

              completed++;
              if (completed === files.length) {
                finish();
              }
            }
          );
        });
      }
    );
  });
}

// ฟังก์ชันสรุปผล
function finish() {
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Migration completed!');
  console.log('='.repeat(50) + '\n');

  // แสดงข้อมูลสถิติ
  db.all(`
    SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM roles) as total_roles,
      (SELECT COUNT(*) FROM permissions) as total_permissions,
      (SELECT COUNT(*) FROM role_permissions) as total_role_permissions,
      (SELECT COUNT(*) FROM farms) as total_farms
  `, (err, rows) => {
    if (err) {
      console.error('❌ Error getting statistics:', err.message);
    } else if (rows && rows[0]) {
      console.log('📊 Database Statistics:');
      console.log(`   Users:              ${rows[0].total_users}`);
      console.log(`   Roles:              ${rows[0].total_roles}`);
      console.log(`   Permissions:        ${rows[0].total_permissions}`);
      console.log(`   Role-Permissions:   ${rows[0].total_role_permissions}`);
      console.log(`   Farms:              ${rows[0].total_farms}`);
      console.log('');
    }

    // แสดง roles
    db.all('SELECT role_code, role_name, level FROM roles ORDER BY level', (err, roles) => {
      if (!err && roles) {
        console.log('👥 Available Roles:');
        roles.forEach(role => {
          console.log(`   ${role.role_code.padEnd(20)} - ${role.role_name} (Level ${role.level})`);
        });
        console.log('');
      }

      db.close((err) => {
        if (err) {
          console.error('❌ Error closing database:', err.message);
        } else {
          console.log('✅ Database connection closed');
        }
      });
    });
  });
}
