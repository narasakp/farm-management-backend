const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Using database: ${DB_PATH}`);
console.log('');
console.log('🔍 Checking permissions table schema...\n');

db.all("PRAGMA table_info(permissions)", (err, columns) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }

  console.log('📋 Columns in permissions table:\n');
  columns.forEach(col => {
    const notNull = col.notnull ? 'NOT NULL' : 'nullable';
    const pk = col.pk ? '🔑 PRIMARY KEY' : '';
    const def = col.dflt_value ? `DEFAULT ${col.dflt_value}` : '';
    
    console.log(`   ${col.name.padEnd(25)} ${col.type.padEnd(15)} ${notNull.padEnd(10)} ${pk} ${def}`);
  });

  console.log('');
  console.log('═'.repeat(80));
  
  // Show sample data
  db.get('SELECT * FROM permissions LIMIT 1', (err2, sample) => {
    if (err2 || !sample) {
      console.log('\n⚠️  No sample data available');
      db.close();
      return;
    }

    console.log('\n📊 Sample permission:\n');
    Object.keys(sample).forEach(key => {
      console.log(`   ${key}: ${sample[key]}`);
    });
    
    db.close();
  });
});
