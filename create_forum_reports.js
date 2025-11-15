// Create forum_reports table for moderator routes
const { Pool } = require('pg');
require('dotenv').config();

async function createForumReportsTable() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 สร้างตาราง forum_reports...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        reporter_name TEXT NOT NULL,
        content_type VARCHAR(20) NOT NULL, -- 'thread' or 'reply'
        content_id TEXT NOT NULL,
        reason VARCHAR(100) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_forum_reports_status ON forum_reports(status);
      CREATE INDEX IF NOT EXISTS idx_forum_reports_content ON forum_reports(content_type, content_id);
      CREATE INDEX IF NOT EXISTS idx_forum_reports_created_at ON forum_reports(created_at);
    `);

    console.log('✅ สร้างตาราง forum_reports สำเร็จ!');
    
    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'forum_reports'
      ORDER BY ordinal_position
    `);
    
    console.log(`\n📋 ฟิลด์ในตาราง forum_reports (${result.rows.length} ฟิลด์):`);
    result.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
    console.log('\n🔌 ปิดการเชื่อมต่อ Database แล้ว');
  }
}

createForumReportsTable();
