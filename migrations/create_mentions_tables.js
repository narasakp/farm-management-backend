/**
 * Migration: Create Mentions Tables
 * สำหรับระบบ @mention ใน threads และ replies
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

async function migrate() {
  console.log('🔧 Creating mentions tables...');
  
  const db = new sqlite3.Database(DB_PATH);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Table: thread_mentions
      db.run(`
        CREATE TABLE IF NOT EXISTS thread_mentions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL,
          mentioned_user_id TEXT NOT NULL,
          mentioned_username TEXT NOT NULL,
          mentioned_by_id TEXT NOT NULL,
          mentioned_by_username TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creating thread_mentions:', err);
          reject(err);
        } else {
          console.log('✅ thread_mentions table created successfully');
        }
      });

      // Table: reply_mentions
      db.run(`
        CREATE TABLE IF NOT EXISTS reply_mentions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reply_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          mentioned_user_id TEXT NOT NULL,
          mentioned_username TEXT NOT NULL,
          mentioned_by_id TEXT NOT NULL,
          mentioned_by_username TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (reply_id) REFERENCES forum_replies(id) ON DELETE CASCADE,
          FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creating reply_mentions:', err);
          reject(err);
        } else {
          console.log('✅ reply_mentions table created successfully');
        }
      });

      // Indexes for thread_mentions
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_thread_mentions_thread 
        ON thread_mentions(thread_id)
      `, (err) => {
        if (err) console.error('❌ Error creating index:', err);
        else console.log('✅ Index created on thread_mentions(thread_id)');
      });

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_thread_mentions_user 
        ON thread_mentions(mentioned_user_id)
      `, (err) => {
        if (err) console.error('❌ Error creating index:', err);
        else console.log('✅ Index created on thread_mentions(mentioned_user_id)');
      });

      // Indexes for reply_mentions
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_reply_mentions_reply 
        ON reply_mentions(reply_id)
      `, (err) => {
        if (err) console.error('❌ Error creating index:', err);
        else console.log('✅ Index created on reply_mentions(reply_id)');
      });

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_reply_mentions_user 
        ON reply_mentions(mentioned_user_id)
      `, (err) => {
        if (err) {
          console.error('❌ Error creating index:', err);
          reject(err);
        } else {
          console.log('✅ Index created on reply_mentions(mentioned_user_id)');
          console.log('✅ Mentions tables migration completed');
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
