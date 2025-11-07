const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkData() {
  const client = await pool.connect();
  try {
    console.log('\n=== ตรวจสอบข้อมูลในฐานข้อมูล ===\n');

    // 1. ตรวจสอบจำนวนปศุสัตว์ทั้งหมด
    const livestockTotal = await client.query(`
      SELECT COUNT(*) as total, SUM(count) as total_animals 
      FROM survey_livestock
    `);
    console.log('📊 ปศุสัตว์ทั้งหมดในฐานข้อมูล:', livestockTotal.rows[0]);

    // 2. ตรวจสอบการสำรวจทั้งหมด
    const surveys = await client.query(`
      SELECT id, farmer_name, survey_date, surveyor_id, created_at
      FROM farm_surveys
      ORDER BY created_at DESC
    `);
    console.log('\n📋 การสำรวจทั้งหมด:', surveys.rows.length, 'ครั้ง');
    console.log('\nรายการสำรวจ:');
    surveys.rows.forEach((survey, idx) => {
      console.log(`${idx + 1}. ID: ${survey.id}, เกษตรกร: ${survey.farmer_name}, วันที่: ${survey.survey_date}, ผู้สำรวจ: ${survey.surveyor_id}`);
    });

    // 3. ตรวจสอบปศุสัตว์แต่ละการสำรวจ
    console.log('\n🐮 ปศุสัตว์แต่ละการสำรวจ:');
    for (const survey of surveys.rows) {
      const livestock = await client.query(`
        SELECT livestock_type, count
        FROM survey_livestock
        WHERE survey_id = $1
      `, [survey.id]);
      
      const totalCount = livestock.rows.reduce((sum, item) => sum + item.count, 0);
      console.log(`\nID ${survey.id} - ${survey.farmer_name}:`);
      console.log(`  รวม: ${totalCount} ตัว`);
      livestock.rows.forEach(item => {
        console.log(`    - ${item.livestock_type}: ${item.count} ตัว`);
      });
    }

    // 4. ตรวจสอบเกษตรกรที่ไม่ซ้ำ
    const uniqueFarmers = await client.query(`
      SELECT DISTINCT farmer_name, COUNT(*) as survey_count
      FROM farm_surveys
      GROUP BY farmer_name
      ORDER BY survey_count DESC
    `);
    console.log('\n👨‍🌾 เกษตรกรทั้งหมด:', uniqueFarmers.rows.length, 'คน');
    uniqueFarmers.rows.forEach((farmer, idx) => {
      console.log(`${idx + 1}. ${farmer.farmer_name} - สำรวจ ${farmer.survey_count} ครั้ง`);
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    client.release();
  }
}

async function deleteTestData() {
  const client = await pool.connect();
  try {
    console.log('\n=== เริ่มลบข้อมูลทดสอบ ===\n');

    // ขอยืนยันก่อนลบ
    console.log('⚠️  WARNING: จะลบข้อมูลที่ surveyor_id = "unknown_user" หรือ "test_*"');
    console.log('กดปุ่ม Ctrl+C ภายใน 5 วินาที หากต้องการยกเลิก...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    await client.query('BEGIN');

    // ค้นหา survey IDs ที่เป็นข้อมูลทดสอบ
    const testSurveys = await client.query(`
      SELECT id, farmer_name, surveyor_id
      FROM farm_surveys
      WHERE surveyor_id LIKE 'unknown_user' OR surveyor_id LIKE 'test_%'
    `);

    console.log(`\n🗑️  พบข้อมูลทดสอบ ${testSurveys.rows.length} รายการ:`);
    testSurveys.rows.forEach((survey, idx) => {
      console.log(`${idx + 1}. ID: ${survey.id}, เกษตรกร: ${survey.farmer_name}, ผู้สำรวจ: ${survey.surveyor_id}`);
    });

    if (testSurveys.rows.length > 0) {
      const surveyIds = testSurveys.rows.map(s => s.id);

      // ลบปศุสัตว์ที่เกี่ยวข้อง
      const deletedLivestock = await client.query(`
        DELETE FROM survey_livestock
        WHERE survey_id = ANY($1)
        RETURNING *
      `, [surveyIds]);
      console.log(`\n✅ ลบปศุสัตว์แล้ว: ${deletedLivestock.rows.length} รายการ`);

      // ลบการสำรวจ
      const deletedSurveys = await client.query(`
        DELETE FROM farm_surveys
        WHERE id = ANY($1)
        RETURNING *
      `, [surveyIds]);
      console.log(`✅ ลบการสำรวจแล้ว: ${deletedSurveys.rows.length} รายการ`);

      await client.query('COMMIT');
      console.log('\n✅ ลบข้อมูลทดสอบเรียบร้อยแล้ว!');
    } else {
      await client.query('ROLLBACK');
      console.log('\n❌ ไม่พบข้อมูลทดสอบที่ต้องลบ');
    }

    // ตรวจสอบข้อมูลหลังลบ
    console.log('\n=== ข้อมูลหลังลบ ===\n');
    await checkData();

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err);
  } finally {
    client.release();
    pool.end();
  }
}

// เรียกใช้งาน
const args = process.argv.slice(2);
if (args[0] === 'check') {
  checkData().then(() => pool.end());
} else if (args[0] === 'delete') {
  deleteTestData();
} else {
  console.log('Usage:');
  console.log('  node cleanup_test_data.js check   - ตรวจสอบข้อมูล');
  console.log('  node cleanup_test_data.js delete  - ลบข้อมูลทดสอบ');
  pool.end();
}
