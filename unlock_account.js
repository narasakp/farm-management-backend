const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('farm_auth.db');

const username = process.argv[2];

if (!username) {
  console.log('❌ Usage: node unlock_account.js <username>');
  console.log('   Example: node unlock_account.js nara');
  process.exit(1);
}

console.log(`🔓 Unlocking account: ${username}\n`);

db.run(`
  UPDATE users 
  SET 
    failed_login_attempts = 0,
    locked_until = NULL,
    lock_count = 0
  WHERE username = ?
`, [username], function(err) {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }
  
  if (this.changes === 0) {
    console.log(`❌ User "${username}" not found!`);
  } else {
    console.log('✅ Account unlocked successfully!');
    console.log(`   - Failed attempts reset to 0`);
    console.log(`   - Lock removed`);
    console.log(`   - Lock count reset to 0 (Progressive lock cleared)`);
    console.log(`\n✅ User "${username}" can now login.`);
  }
  
  db.close();
});
