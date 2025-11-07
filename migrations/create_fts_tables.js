/**
 * Migration: Create FTS (Full-Text Search) Virtual Tables
 * สำหรับการค้นหาข้อความแบบ Full-Text Search
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

async function migrate() {
  console.log('🔍 Creating FTS virtual tables...');
  
  const db = new sqlite3.Database(DB_PATH);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // FTS5 Virtual Table for forum_threads
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS forum_threads_fts 
        USING fts5(
          id UNINDEXED,
          title,
          content,
          author_name,
          tags,
          category UNINDEXED,
          tokenize = 'porter unicode61'
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creating forum_threads_fts:', err);
          reject(err);
        } else {
          console.log('✅ forum_threads_fts virtual table created');
        }
      });

      // FTS5 Virtual Table for forum_replies
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS forum_replies_fts 
        USING fts5(
          id UNINDEXED,
          content,
          author_name,
          thread_id UNINDEXED,
          tokenize = 'porter unicode61'
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creating forum_replies_fts:', err);
          reject(err);
        } else {
          console.log('✅ forum_replies_fts virtual table created');
        }
      });

      // Populate FTS tables with existing data
      console.log('📊 Populating FTS tables with existing data...');

      // Populate threads
      db.run(`
        INSERT INTO forum_threads_fts (id, title, content, author_name, tags, category)
        SELECT id, title, content, author_name, tags, category 
        FROM forum_threads
        WHERE id NOT IN (SELECT id FROM forum_threads_fts)
      `, (err) => {
        if (err && !err.message.includes('UNIQUE constraint failed')) {
          console.error('⚠️ Error populating forum_threads_fts:', err.message);
        } else {
          console.log('✅ forum_threads_fts populated');
        }
      });

      // Populate replies
      db.run(`
        INSERT INTO forum_replies_fts (id, content, author_name, thread_id)
        SELECT id, content, author_name, thread_id 
        FROM forum_replies
        WHERE id NOT IN (SELECT id FROM forum_replies_fts)
      `, (err) => {
        if (err && !err.message.includes('UNIQUE constraint failed')) {
          console.error('⚠️ Error populating forum_replies_fts:', err.message);
        } else {
          console.log('✅ forum_replies_fts populated');
        }
      });

      // Create triggers to keep FTS in sync
      console.log('🔗 Creating triggers for automatic FTS sync...');

      // Trigger: INSERT thread
      db.run(`
        CREATE TRIGGER IF NOT EXISTS forum_threads_ai 
        AFTER INSERT ON forum_threads 
        BEGIN
          INSERT INTO forum_threads_fts (id, title, content, author_name, tags, category)
          VALUES (new.id, new.title, new.content, new.author_name, new.tags, new.category);
        END
      `, (err) => {
        if (err) console.error('⚠️ Error creating trigger:', err.message);
        else console.log('✅ Trigger: forum_threads_ai created');
      });

      // Trigger: UPDATE thread
      db.run(`
        CREATE TRIGGER IF NOT EXISTS forum_threads_au 
        AFTER UPDATE ON forum_threads 
        BEGIN
          UPDATE forum_threads_fts 
          SET title = new.title, 
              content = new.content, 
              author_name = new.author_name,
              tags = new.tags,
              category = new.category
          WHERE id = old.id;
        END
      `, (err) => {
        if (err) console.error('⚠️ Error creating trigger:', err.message);
        else console.log('✅ Trigger: forum_threads_au created');
      });

      // Trigger: DELETE thread
      db.run(`
        CREATE TRIGGER IF NOT EXISTS forum_threads_ad 
        AFTER DELETE ON forum_threads 
        BEGIN
          DELETE FROM forum_threads_fts WHERE id = old.id;
        END
      `, (err) => {
        if (err) console.error('⚠️ Error creating trigger:', err.message);
        else console.log('✅ Trigger: forum_threads_ad created');
      });

      // Trigger: INSERT reply
      db.run(`
        CREATE TRIGGER IF NOT EXISTS forum_replies_ai 
        AFTER INSERT ON forum_replies 
        BEGIN
          INSERT INTO forum_replies_fts (id, content, author_name, thread_id)
          VALUES (new.id, new.content, new.author_name, new.thread_id);
        END
      `, (err) => {
        if (err) console.error('⚠️ Error creating trigger:', err.message);
        else console.log('✅ Trigger: forum_replies_ai created');
      });

      // Trigger: UPDATE reply
      db.run(`
        CREATE TRIGGER IF NOT EXISTS forum_replies_au 
        AFTER UPDATE ON forum_replies 
        BEGIN
          UPDATE forum_replies_fts 
          SET content = new.content, 
              author_name = new.author_name
          WHERE id = old.id;
        END
      `, (err) => {
        if (err) console.error('⚠️ Error creating trigger:', err.message);
        else console.log('✅ Trigger: forum_replies_au created');
      });

      // Trigger: DELETE reply
      db.run(`
        CREATE TRIGGER IF NOT EXISTS forum_replies_ad 
        AFTER DELETE ON forum_replies 
        BEGIN
          DELETE FROM forum_replies_fts WHERE id = old.id;
        END
      `, (err) => {
        if (err) {
          console.error('❌ Error creating trigger:', err);
          reject(err);
        } else {
          console.log('✅ Trigger: forum_replies_ad created');
          console.log('✅ FTS migration completed');
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
    console.log('✅ FTS Migration successful');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ FTS Migration failed:', err);
    process.exit(1);
  });
