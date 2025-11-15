// Run PostgreSQL Migration Script
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 เริ่มต้น PostgreSQL Migration...');
    console.log('📡 กำลังเชื่อมต่อ Database...');

    // Read SQL file
    const sqlPath = path.join(__dirname, 'migration_plan_postgresql.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📄 อ่านไฟล์ migration_plan_postgresql.sql สำเร็จ');
    console.log(`📊 ขนาดไฟล์: ${(sql.length / 1024).toFixed(2)} KB`);
    
    // Execute SQL
    console.log('⚙️ กำลัง execute SQL...');
    await pool.query(sql);
    
    console.log('✅ Migration สำเร็จ!');
    console.log('🎉 สร้างตารางทั้งหมดเรียบร้อยแล้ว');
    
    // Test query
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log(`\n📋 ตารางที่สร้างแล้ว (${result.rows.length} ตาราง):`);
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ Migration Error:', error.message);
    console.error('📍 Detail:', error);
  } finally {
    await pool.end();
    console.log('\n🔌 ปิดการเชื่อมต่อ Database แล้ว');
  }
}

runMigration();
