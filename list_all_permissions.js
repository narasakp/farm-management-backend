const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Using database: ${DB_PATH}`);
console.log('');
console.log('🔍 Listing all permissions in database...\n');

db.all('SELECT * FROM permissions ORDER BY resource, action', (err, permissions) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }

  if (!permissions || permissions.length === 0) {
    console.log('⚠️  No permissions found in database');
    db.close();
    return;
  }

  console.log(`✅ Found ${permissions.length} permissions:\n`);
  
  // Group by resource
  const byResource = {};
  permissions.forEach(p => {
    if (!byResource[p.resource]) {
      byResource[p.resource] = [];
    }
    byResource[p.resource].push(p);
  });

  Object.keys(byResource).sort().forEach(resource => {
    console.log(`📦 ${resource}:`);
    byResource[resource].forEach(p => {
      console.log(`   ${p.permission_code.padEnd(30)} - ${p.action}`);
    });
    console.log('');
  });

  console.log('═'.repeat(60));
  console.log(`\n📊 Summary:`);
  Object.keys(byResource).forEach(resource => {
    console.log(`   ${resource}: ${byResource[resource].length} permissions`);
  });

  db.close();
});
