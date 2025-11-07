const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../farm_auth.db');
const migrationPath = path.join(__dirname, '006_notifications_table.sql');

console.log('🔄 Running migration: 006_notifications_table.sql');
console.log(`📂 Database: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error connecting to database:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to database');
});

const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

db.exec(migrationSQL, (err) => {
  if (err) {
    console.error('❌ Migration failed:', err.message);
    db.close();
    process.exit(1);
  }
  
  console.log('✅ Migration completed successfully');
  
  // Verify table creation
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'", (err, row) => {
    if (err) {
      console.error('❌ Error verifying table:', err.message);
    } else if (row) {
      console.log('✅ Table "notifications" created successfully');
      
      // Show table schema
      db.all("PRAGMA table_info(notifications)", (err, columns) => {
        if (!err && columns) {
          console.log('\n📋 Table schema:');
          columns.forEach(col => {
            console.log(`  - ${col.name} (${col.type})`);
          });
        }
      });
      
      // Show indexes
      db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'", (err, indexes) => {
        if (!err && indexes) {
          console.log('\n📌 Indexes created:');
          indexes.forEach(idx => {
            console.log(`  - ${idx.name}`);
          });
        }
        
        db.close((err) => {
          if (err) {
            console.error('❌ Error closing database:', err.message);
          } else {
            console.log('\n✅ Database connection closed');
          }
        });
      });
    } else {
      console.log('⚠️  Table "notifications" was not created');
      db.close();
    }
  });
});
