const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./farm_auth.db');

console.log('🔄 Migrating feedback table to make email and phone nullable...');

// SQLite doesn't support ALTER COLUMN, so we need to:
// 1. Create new table with nullable columns
// 2. Copy data
// 3. Drop old table
// 4. Rename new table

const migrationSteps = [
  // Step 1: Create new table with nullable email and phone
  `CREATE TABLE IF NOT EXISTS feedback_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 5,
    attachments TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    admin_response TEXT,
    responded_at DATETIME,
    responded_by_user_name TEXT
  )`,
  
  // Step 2: Copy data from old table to new table (only existing columns)
  `INSERT INTO feedback_new (
    id, user_id, user_name, email, phone,
    type, category, subject, message, rating,
    attachments, priority, status, created_at, updated_at,
    admin_response, responded_at
  )
  SELECT 
    id, user_id, user_name, email, phone,
    type, category, subject, message, rating,
    attachments, priority, status, created_at, updated_at,
    admin_response, responded_at
  FROM feedback`,
  
  // Step 3: Drop old table
  `DROP TABLE feedback`,
  
  // Step 4: Rename new table to original name
  `ALTER TABLE feedback_new RENAME TO feedback`
];

// Execute migration steps sequentially
function runMigration(steps, index = 0) {
  if (index >= steps.length) {
    console.log('✅ Migration completed successfully!');
    
    // Verify schema
    db.all('PRAGMA table_info(feedback)', (err, columns) => {
      if (err) {
        console.error('Error:', err);
      } else {
        console.log('\n📋 Updated table schema:');
        columns.forEach(col => {
          const nullable = col.notnull === 0 ? '(nullable)' : '(NOT NULL)';
          console.log(`  ${col.name} ${col.type} ${nullable}`);
        });
      }
      db.close();
    });
    return;
  }
  
  console.log(`\n🔄 Step ${index + 1}/${steps.length}...`);
  db.run(steps[index], (err) => {
    if (err) {
      console.error(`❌ Error at step ${index + 1}:`, err);
      db.close();
    } else {
      console.log(`✅ Step ${index + 1} completed`);
      runMigration(steps, index + 1);
    }
  });
}

// Start migration
runMigration(migrationSteps);
