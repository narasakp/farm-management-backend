const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Database: ${DB_PATH}\n`);
console.log('🔄 Updating feedback table for file attachments...\n');

// Check current schema
db.all('PRAGMA table_info(feedback)', (err, columns) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }
  
  console.log('Current schema:');
  columns.forEach(col => {
    console.log(`  ${col.name} (${col.type})`);
  });
  
  // Check if attachments column exists
  const attachmentsCol = columns.find(col => col.name === 'attachments');
  
  if (attachmentsCol) {
    console.log('\n✅ attachments column already exists');
    console.log(`   Type: ${attachmentsCol.type}`);
    
    if (attachmentsCol.type === 'TEXT') {
      console.log('\n✅ Column type is TEXT (can store JSON)');
      console.log('📝 Note: Store file URLs as JSON array:');
      console.log('   Example: ["url1.jpg", "url2.pdf"]');
    } else {
      console.log(`\n⚠️  Column type is ${attachmentsCol.type}`);
      console.log('💡 You may want to alter it to TEXT for JSON storage');
    }
  } else {
    console.log('\n❌ attachments column does NOT exist');
    console.log('Adding column...\n');
    
    db.run('ALTER TABLE feedback ADD COLUMN attachments TEXT', (err) => {
      if (err) {
        console.error('❌ Error adding column:', err);
      } else {
        console.log('✅ attachments column added successfully!');
        console.log('📝 Type: TEXT (can store JSON array)');
      }
      db.close();
    });
    return;
  }
  
  db.close();
});
