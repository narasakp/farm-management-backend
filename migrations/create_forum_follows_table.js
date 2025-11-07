const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

function createForumFollowsTable() {
  const db = new sqlite3.Database(DB_PATH);

  console.log('🔧 Creating forum_follows table...');

  db.serialize(() => {
    // สร้างตาราง forum_follows
    db.run(`
      CREATE TABLE IF NOT EXISTS forum_follows (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        notify_on_reply INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(thread_id, user_id),
        FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating forum_follows table:', err);
      } else {
        console.log('✅ forum_follows table created successfully');
      }
    });

    // เพิ่ม notify_on_reply column ถ้ายังไม่มี
    db.run(`
      ALTER TABLE forum_follows ADD COLUMN notify_on_reply INTEGER DEFAULT 1
    `, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding notify_on_reply:', err);
      } else {
        console.log('✅ notify_on_reply column added to forum_follows');
      }
    });

    // เพิ่มคอลัมน์ is_edited และ is_deleted ใน forum_threads (ถ้ายังไม่มี)
    db.run(`
      ALTER TABLE forum_threads ADD COLUMN is_edited INTEGER DEFAULT 0
    `, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding is_edited to forum_threads:', err);
      } else {
        console.log('✅ is_edited column added to forum_threads');
      }
    });

    db.run(`
      ALTER TABLE forum_threads ADD COLUMN is_deleted INTEGER DEFAULT 0
    `, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding is_deleted to forum_threads:', err);
      } else {
        console.log('✅ is_deleted column added to forum_threads');
      }
    });

    // เพิ่มคอลัมน์ is_edited และ is_deleted ใน forum_replies (ถ้ายังไม่มี)
    db.run(`
      ALTER TABLE forum_replies ADD COLUMN is_edited INTEGER DEFAULT 0
    `, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding is_edited to forum_replies:', err);
      } else {
        console.log('✅ is_edited column added to forum_replies');
      }
    });

    db.run(`
      ALTER TABLE forum_replies ADD COLUMN is_deleted INTEGER DEFAULT 0
    `, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding is_deleted to forum_replies:', err);
      } else {
        console.log('✅ is_deleted column added to forum_replies');
      }
    });

    // สร้าง index
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_forum_follows_user 
      ON forum_follows(user_id)
    `, (err) => {
      if (err) {
        console.error('❌ Error creating index:', err);
      } else {
        console.log('✅ Index created on forum_follows(user_id)');
      }
    });

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_forum_follows_thread 
      ON forum_follows(thread_id)
    `, (err) => {
      if (err) {
        console.error('❌ Error creating index:', err);
      } else {
        console.log('✅ Index created on forum_follows(thread_id)');
      }
      
      db.close(() => {
        console.log('✅ Forum follows migration completed');
      });
    });
  });
}

// Run migration
createForumFollowsTable();

module.exports = { createForumFollowsTable };
