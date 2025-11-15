// Create forum tables manually with fixed BOOLEAN defaults
const { Pool } = require('pg');
require('dotenv').config();

async function createForumTables() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 สร้างตาราง Forum...\n');

    // 1. forum_threads
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_avatar TEXT,
        email TEXT,
        phone TEXT,
        category TEXT NOT NULL,
        tags TEXT,
        status TEXT DEFAULT 'open',
        view_count INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        upvote_count INTEGER DEFAULT 0,
        downvote_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_reply_at TIMESTAMP,
        last_reply_by TEXT,
        is_pinned BOOLEAN DEFAULT false,
        is_locked BOOLEAN DEFAULT false,
        is_featured BOOLEAN DEFAULT false,
        has_accepted_answer BOOLEAN DEFAULT false,
        accepted_answer_id TEXT,
        allow_reply BOOLEAN DEFAULT true,
        attachments TEXT,
        is_edited INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0
      );
    `);
    console.log('   ✅ forum_threads');

    // 2. forum_replies
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_replies (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_avatar TEXT,
        is_answer BOOLEAN DEFAULT false,
        is_staff_reply BOOLEAN DEFAULT false,
        is_expert_reply BOOLEAN DEFAULT false,
        parent_reply_id TEXT,
        level INTEGER DEFAULT 0,
        upvote_count INTEGER DEFAULT 0,
        downvote_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        edited_at TIMESTAMP,
        is_edited BOOLEAN DEFAULT false,
        is_hidden BOOLEAN DEFAULT false,
        hidden_reason TEXT,
        attachments TEXT,
        is_deleted INTEGER DEFAULT 0
      );
    `);
    console.log('   ✅ forum_replies');

    // 3. forum_thread_votes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_thread_votes (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        vote_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(thread_id, user_id)
      );
    `);
    console.log('   ✅ forum_thread_votes');

    // 4. forum_reply_votes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_reply_votes (
        id TEXT PRIMARY KEY,
        reply_id TEXT NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        vote_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(reply_id, user_id)
      );
    `);
    console.log('   ✅ forum_reply_votes');

    // 5. forum_bookmarks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, thread_id)
      );
    `);
    console.log('   ✅ forum_bookmarks');

    // 6. forum_follows
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_follows (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        notify_on_reply BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, thread_id)
      );
    `);
    console.log('   ✅ forum_follows');

    // 7. thread_mentions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS thread_mentions (
        id SERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        mentioned_user_id TEXT NOT NULL,
        mentioned_username TEXT NOT NULL,
        mentioned_by_id TEXT NOT NULL,
        mentioned_by_username TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('   ✅ thread_mentions');

    // 8. reply_mentions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reply_mentions (
        id SERIAL PRIMARY KEY,
        reply_id TEXT NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        mentioned_user_id TEXT NOT NULL,
        mentioned_username TEXT NOT NULL,
        mentioned_by_id TEXT NOT NULL,
        mentioned_by_username TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('   ✅ reply_mentions');

    console.log('\n✅ สร้างตาราง Forum ทั้งหมดสำเร็จ!');

    // Create indexes
    console.log('\n🔧 สร้าง Indexes...');
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category);
      CREATE INDEX IF NOT EXISTS idx_forum_threads_author ON forum_threads(author_id);
      CREATE INDEX IF NOT EXISTS idx_forum_threads_created ON forum_threads(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_forum_threads_status ON forum_threads(status);
      
      CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies(thread_id);
      CREATE INDEX IF NOT EXISTS idx_forum_replies_author ON forum_replies(author_id);
      CREATE INDEX IF NOT EXISTS idx_forum_replies_created ON forum_replies(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_forum_bookmarks_user ON forum_bookmarks(user_id);
      CREATE INDEX IF NOT EXISTS idx_forum_follows_user ON forum_follows(user_id);
    `);
    
    console.log('   ✅ Indexes สร้างเสร็จแล้ว');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
    console.log('\n🔌 ปิดการเชื่อมต่อ PostgreSQL แล้ว');
  }
}

createForumTables();
