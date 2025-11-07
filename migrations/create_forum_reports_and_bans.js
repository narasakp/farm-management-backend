const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

function createForumReportsAndBans() {
  const db = new sqlite3.Database(DB_PATH);

  console.log('🔧 Creating forum_reports and user_bans tables...');

  db.serialize(() => {
    // ตาราง forum_reports - เก็บรายงานจากผู้ใช้
    db.run(`
      CREATE TABLE IF NOT EXISTS forum_reports (
        id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        content_id TEXT NOT NULL,
        reporter_id TEXT NOT NULL,
        reporter_name TEXT,
        reason TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating forum_reports table:', err);
      } else {
        console.log('✅ forum_reports table created successfully');
      }
    });

    // ตาราง user_bans - เก็บข้อมูลผู้ใช้ที่ถูกแบน
    db.run(`
      CREATE TABLE IF NOT EXISTS user_bans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT,
        banned_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        ban_type TEXT DEFAULT 'temporary',
        ban_until TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        unbanned_at TEXT,
        unbanned_by TEXT
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creating user_bans table:', err);
      } else {
        console.log('✅ user_bans table created successfully');
      }
    });

    // Index สำหรับ forum_reports
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_forum_reports_content 
      ON forum_reports(content_type, content_id)
    `, (err) => {
      if (err) {
        console.error('❌ Error creating index:', err);
      } else {
        console.log('✅ Index created on forum_reports(content_type, content_id)');
      }
    });

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_forum_reports_status 
      ON forum_reports(status)
    `, (err) => {
      if (err) {
        console.error('❌ Error creating index:', err);
      } else {
        console.log('✅ Index created on forum_reports(status)');
      }
    });

    // Index สำหรับ user_bans
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_bans_user 
      ON user_bans(user_id)
    `, (err) => {
      if (err) {
        console.error('❌ Error creating index:', err);
      } else {
        console.log('✅ Index created on user_bans(user_id)');
      }
    });

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_bans_active 
      ON user_bans(is_active)
    `, (err) => {
      if (err) {
        console.error('❌ Error creating index:', err);
      } else {
        console.log('✅ Index created on user_bans(is_active)');
      }
      
      db.close(() => {
        console.log('✅ Forum reports and bans migration completed');
      });
    });
  });
}

// Run migration
createForumReportsAndBans();

module.exports = { createForumReportsAndBans };
