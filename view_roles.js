const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');

/**
 * แสดง roles ทั้งหมดในระบบ
 */
function viewAllRoles() {
  const db = new sqlite3.Database(DB_PATH);

  console.log('\n📋 ระบบ Role-Based Access Control (RBAC)\n');
  console.log('='.repeat(80));
  console.log('\n🎭 Roles ทั้งหมดในระบบ:\n');

  db.all(
    `SELECT role_id, role_code, role_name, level, description 
     FROM roles 
     ORDER BY level`,
    [],
    (err, roles) => {
      if (err) {
        console.error('❌ Error:', err);
        db.close();
        return;
      }

      if (roles.length === 0) {
        console.log('⚠️  ไม่มี roles ในระบบ');
        db.close();
        return;
      }

      // แสดง roles
      roles.forEach((role, index) => {
        console.log(`${index + 1}. ${role.role_name} (${role.role_code})`);
        console.log(`   Level: ${role.level}`);
        console.log(`   คำอธิบาย: ${role.description}`);
        console.log('');
      });

      console.log('='.repeat(80));
      console.log('\n📊 สรุป Roles:\n');

      // Group by level
      const byLevel = {
        1: roles.filter(r => r.level === 1),
        2: roles.filter(r => r.level === 2),
        3: roles.filter(r => r.level === 3),
        4: roles.filter(r => r.level === 4),
      };

      console.log('Level 1 (Super Admin):');
      byLevel[1].forEach(r => console.log(`  - ${r.role_name} (${r.role_code})`));
      
      console.log('\nLevel 2 (Provincial Admin):');
      byLevel[2].forEach(r => console.log(`  - ${r.role_name} (${r.role_code})`));
      
      console.log('\nLevel 3 (Officers & Leaders):');
      byLevel[3].forEach(r => console.log(`  - ${r.role_name} (${r.role_code})`));
      
      console.log('\nLevel 4 (End Users):');
      byLevel[4].forEach(r => console.log(`  - ${r.role_name} (${r.role_code})`));

      console.log('\n='.repeat(80));
      console.log('\n📝 Users ในแต่ละ Role:\n');

      // Count users per role
      db.all(
        `SELECT role, COUNT(*) as count 
         FROM users 
         GROUP BY role`,
        [],
        (err, counts) => {
          if (err) {
            console.error('❌ Error counting users:', err);
          } else {
            const roleCounts = {};
            counts.forEach(c => {
              roleCounts[c.role] = c.count;
            });

            roles.forEach(role => {
              const count = roleCounts[role.role_code] || 0;
              console.log(`${role.role_name}: ${count} คน`);
            });
          }

          console.log('\n='.repeat(80));
          db.close();
        }
      );
    }
  );
}

// Run
viewAllRoles();
