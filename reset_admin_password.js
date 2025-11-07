const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');

async function resetPassword(username, newPassword) {
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    db.run(
      `UPDATE users SET password = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE username = ?`,
      [hashedPassword, username],
      function(err) {
        db.close();
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

(async () => {
  try {
    const username = 'admin_test';
    const password = 'password123';
    
    console.log(`🔄 กำลัง reset password สำหรับ: ${username}`);
    console.log(`🔑 Password ใหม่: ${password}\n`);
    
    const changes = await resetPassword(username, password);
    
    if (changes > 0) {
      console.log(`✅ Reset password สำเร็จ!`);
      console.log(`\n📝 สามารถ login ด้วย:`);
      console.log(`   Username: ${username}`);
      console.log(`   Password: ${password}`);
    } else {
      console.log(`❌ ไม่พบ user: ${username}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
})();
