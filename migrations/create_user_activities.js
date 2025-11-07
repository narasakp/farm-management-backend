/**
 * Migration: Create User Activities Table
 * สำหรับ track กิจกรรมของผู้ใช้ในระบบ
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

async function migrate() {
  console.log('🔧 Creating user_activities table...');
  
  const db = new sqlite3.Database(DB_PATH);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Table: user_activities
      db.run(`
        CREATE TABLE IF NOT EXISTS user_activities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          activity_type TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          target_title TEXT,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creating user_activities:', err);
          reject(err);
        } else {
          console.log('✅ user_activities table created successfully');
        }
      });

      // Index: user_id for filtering by user
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_activities_user 
        ON user_activities(user_id)
      `, (err) => {
        if (err) console.error('❌ Error creating index:', err);
        else console.log('✅ Index created on user_activities(user_id)');
      });

      // Index: activity_type for filtering by type
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_activities_type 
        ON user_activities(activity_type)
      `, (err) => {
        if (err) console.error('❌ Error creating index:', err);
        else console.log('✅ Index created on user_activities(activity_type)');
      });

      // Index: created_at for sorting
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_activities_created 
        ON user_activities(created_at DESC)
      `, (err) => {
        if (err) {
          console.error('❌ Error creating index:', err);
          reject(err);
        } else {
          console.log('✅ Index created on user_activities(created_at)');
          console.log('✅ User activities migration completed');
          db.close();
          resolve();
        }
      });
    });
  });
}

// Run migration
migrate()
  .then(() => {
    console.log('✅ Migration successful');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
