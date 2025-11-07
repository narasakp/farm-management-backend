const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log('📋 รายชื่อ Users ทั้งหมดในระบบ:\n');

db.all(`
  SELECT 
    u.id,
    u.username,
    u.display_name,
    u.email,
    u.role,
    r.role_name,
    u.is_active,
    u.created_at
  FROM users u
  LEFT JOIN roles r ON u.role = r.role_code
  ORDER BY u.id
`, (err, users) => {
  if (err) {
    console.error('❌ Error:', err);
  } else if (users.length === 0) {
    console.log('❌ ไม่มี users ในระบบ!');
  } else {
    console.log(`✅ พบ ${users.length} users:\n`);
    users.forEach((user, index) => {
      console.log(`${index + 1}. Username: ${user.username}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Display Name: ${user.display_name}`);
      console.log(`   Email: ${user.email || '-'}`);
      console.log(`   Role: ${user.role} (${user.role_name || '-'})`);
      console.log(`   Status: ${user.is_active === 1 ? 'Active ✅' : 'Inactive ❌'}`);
      console.log(`   Created: ${user.created_at}`);
      console.log('');
    });
  }
  
  db.close();
});
