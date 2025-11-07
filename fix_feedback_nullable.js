const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Database: ${DB_PATH}\n`);
console.log('🔧 Fixing feedback table - Making email and phone NULLABLE...\n');

// SQLite doesn't support ALTER COLUMN, so we need to:
// 1. Create new table with correct schema
// 2. Copy data
// 3. Drop old table
// 4. Rename new table

const steps = [
  // Step 1: Create new table
  `CREATE TABLE feedback_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    rating INTEGER DEFAULT 5,
    attachments TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    admin_response TEXT,
    responded_at DATETIME,
    votes INTEGER DEFAULT 0,
    last_activity DATETIME,
    views INTEGER DEFAULT 0
  )`,
  
  // Step 2: Copy data
  `INSERT INTO feedback_new 
   SELECT * FROM feedback`,
  
  // Step 3: Drop old table
  `DROP TABLE feedback`,
  
  // Step 4: Rename new table
  `ALTER TABLE feedback_new RENAME TO feedback`
];

function executeStep(index) {
  if (index >= steps.length) {
    console.log('\n✅ Successfully updated feedback table!');
    console.log('📝 email and phone are now NULLABLE');
    db.close();
    return;
  }
  
  console.log(`[${index + 1}/${steps.length}] Executing...`);
  
  db.run(steps[index], (err) => {
    if (err) {
      console.error(`❌ Error at step ${index + 1}:`, err);
      db.close();
      return;
    }
    
    console.log(`✅ Step ${index + 1} complete`);
    executeStep(index + 1);
  });
}

// Start execution
executeStep(0);
