const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('farm_auth.db');

console.log('🔧 Fixing user "nara" role...\n');

// Update role to FARMER
db.run(`UPDATE users SET role = 'FARMER' WHERE username = 'nara'`, (err) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }
  
  console.log('✅ Updated role to FARMER');
  
  // Verify
  db.get('SELECT username, role FROM users WHERE username = ?', ['nara'], (err, user) => {
    if (err) {
      console.error('❌ Error:', err);
      db.close();
      return;
    }
    
    console.log(`\n👤 User: ${user.username}`);
    console.log(`📋 Role: ${user.role}\n`);
    
    // Check permissions
    db.all(`
      SELECT COUNT(*) as count
      FROM users u
      JOIN roles r ON u.role = r.role_code
      JOIN role_permissions rp ON r.role_id = rp.role_id
      WHERE u.username = ?
    `, ['nara'], (err, result) => {
      if (err) {
        console.error('❌ Error:', err);
      } else {
        console.log(`📊 Permissions: ${result[0].count}`);
        
        if (result[0].count === 19) {
          console.log('✅ User now has correct 19 permissions!');
        } else {
          console.log(`⚠️  Expected 19, got ${result[0].count}`);
        }
      }
      
      db.close();
    });
  });
});
