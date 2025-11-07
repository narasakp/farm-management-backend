/**
 * Test Hierarchical RBAC
 * ทดสอบการเช็ค permission แบบ hierarchical
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Using database: ${DB_PATH}`);

console.log('🧪 Testing Hierarchical RBAC\n');
console.log('═'.repeat(80));

// ดึงข้อมูล users และ roles
db.all(`
  SELECT 
    u.id,
    u.username,
    u.role,
    r.role_name,
    r.level,
    r.is_protected
  FROM users u
  JOIN roles r ON u.role = r.role_code
  ORDER BY r.level, u.username
`, (err, users) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }

  console.log('\n👥 Users ในระบบ:\n');
  
  const byLevel = {};
  users.forEach(u => {
    if (!byLevel[u.level]) {
      byLevel[u.level] = [];
    }
    byLevel[u.level].push(u);
  });

  // แสดง users แยกตาม level
  Object.keys(byLevel).sort().forEach(level => {
    console.log(`\n📊 Level ${level}:`);
    byLevel[level].forEach(u => {
      const protectedBadge = u.is_protected ? '🛡️ Protected' : '';
      console.log(`   • ${u.username.padEnd(20)} - ${u.role_name} ${protectedBadge}`);
      console.log(`     User ID: ${u.id}`);
    });
  });

  console.log('\n' + '═'.repeat(80));
  console.log('\n🧪 Test Scenarios:\n');

  // สมมติว่ามี ADMIN user (level 2)
  const adminUser = users.find(u => u.role === 'ADMIN');
  const superAdminUser = users.find(u => u.role === 'SUPER_ADMIN');
  const farmerUser = users.find(u => u.role === 'FARMER');

  if (!adminUser) {
    console.log('⚠️  ไม่พบ ADMIN user ในระบบ');
    console.log('💡 กรุณารัน: node backend/add_admin_role.js');
    console.log('💡 จากนั้นสร้าง user ที่มี role = ADMIN');
    db.close();
    return;
  }

  console.log(`\n🔐 Testing as: ${adminUser.username} (${adminUser.role_name}, Level ${adminUser.level})\n`);

  // Test Case 1: ADMIN ลบ FARMER
  if (farmerUser) {
    const canDelete = farmerUser.level > adminUser.level;
    const icon = canDelete ? '✅' : '❌';
    console.log(`${icon} Test 1: ลบ ${farmerUser.username} (${farmerUser.role_name}, Level ${farmerUser.level})`);
    console.log(`   Result: ${canDelete ? 'อนุญาต' : 'ไม่อนุญาต'} (${farmerUser.level} > ${adminUser.level})`);
  }

  // Test Case 2: ADMIN ลบ ADMIN (user อื่น)
  const anotherAdmin = users.find(u => u.role === 'ADMIN' && u.id !== adminUser.id);
  if (anotherAdmin) {
    const canDelete = anotherAdmin.level > adminUser.level;
    const icon = canDelete ? '✅' : '❌';
    console.log(`\n${icon} Test 2: ลบ ${anotherAdmin.username} (${anotherAdmin.role_name}, Level ${anotherAdmin.level})`);
    console.log(`   Result: ${canDelete ? 'อนุญาต' : 'ไม่อนุญาต'} (${anotherAdmin.level} == ${adminUser.level}) - สิทธิ์เท่ากัน`);
  }

  // Test Case 3: ADMIN ลบ SUPER_ADMIN
  if (superAdminUser) {
    const canDelete = superAdminUser.level > adminUser.level;
    const icon = canDelete ? '✅' : '❌';
    console.log(`\n${icon} Test 3: ลบ ${superAdminUser.username} (${superAdminUser.role_name}, Level ${superAdminUser.level})`);
    console.log(`   Result: ${canDelete ? 'อนุญาต' : 'ไม่อนุญาต'} (${superAdminUser.level} < ${adminUser.level}) - สิทธิ์สูงกว่า`);
    if (superAdminUser.is_protected) {
      console.log(`   ⚠️  นอกจากนี้ ${superAdminUser.role_name} ยัง Protected (ลบไม่ได้อยู่แล้ว)`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('\n📋 สรุป Rule:');
  console.log('   • สามารถจัดการได้เฉพาะ users/roles ที่มี level สูงกว่า (ตัวเลขมากกว่า)');
  console.log('   • Level ต่ำ = สิทธิ์สูง (1 = สูงสุด, 4 = ต่ำสุด)');
  console.log('   • ADMIN (level 2) จัดการ level 3-4 ได้');
  console.log('   • ADMIN (level 2) จัดการ level 1-2 ไม่ได้');
  console.log('   • Protected roles ลบไม่ได้ไม่ว่ากรณีใด');
  console.log('\n' + '═'.repeat(80));

  // แสดง permissions ของ ADMIN
  console.log('\n🔑 Permissions ของ ADMIN:\n');
  
  db.all(`
    SELECT p.permission_code, p.action, p.resource
    FROM permissions p
    JOIN role_permissions rp ON p.permission_id = rp.permission_id
    JOIN roles r ON rp.role_id = r.role_id
    WHERE r.role_code = 'ADMIN' AND rp.has_permission = 1
    ORDER BY p.resource, p.action
  `, (err2, permissions) => {
    if (err2) {
      console.error('❌ Error:', err2);
    } else if (permissions.length === 0) {
      console.log('⚠️  ADMIN role ยังไม่มี permissions');
      console.log('💡 กรุณารัน: node backend/add_admin_role.js');
    } else {
      const byResource = {};
      permissions.forEach(p => {
        if (!byResource[p.resource]) {
          byResource[p.resource] = [];
        }
        byResource[p.resource].push(p);
      });

      Object.keys(byResource).sort().forEach(resource => {
        console.log(`\n📦 ${resource}:`);
        byResource[resource].forEach(p => {
          const hierarchical = (resource === 'users' || resource === 'roles') ? 
            ' (Hierarchical - เฉพาะ level ต่ำกว่า)' : '';
          console.log(`   • ${p.permission_code}${hierarchical}`);
        });
      });

      console.log('\n💡 Hierarchical Permissions:');
      console.log('   • users.delete - ลบผู้ใช้ที่ level ต่ำกว่าได้');
      console.log('   • roles.* - จัดการ roles ที่ level ต่ำกว่าได้');
    }
    
    db.close();
  });
});
