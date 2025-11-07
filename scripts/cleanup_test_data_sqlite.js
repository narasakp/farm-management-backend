const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'farm_auth.db');
const db = new sqlite3.Database(dbPath);

async function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function runExec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function checkData() {
  try {
    console.log('\n=== ตรวจสอบข้อมูลในฐานข้อมูล ===\n');

    // 1. ตรวจสอบจำนวนปศุสัตว์ทั้งหมด
    const livestockTotal = await runQuery(`
      SELECT COUNT(*) as total, SUM(count) as total_animals 
      FROM survey_livestock
    `);
    console.log('📊 ปศุสัตว์ทั้งหมดในฐานข้อมูล:');
    console.log(`   Records: ${livestockTotal[0].total}`);
    console.log(`   รวมทั้งหมด: ${livestockTotal[0].total_animals} ตัว\n`);

    // 2. ตรวจสอบการสำรวจทั้งหมด
    const surveys = await runQuery(`
      SELECT id, farmer_first_name, farmer_last_name, survey_date, surveyor_id, created_at
      FROM farm_surveys
      ORDER BY created_at DESC
    `);
    console.log(`📋 การสำรวจทั้งหมด: ${surveys.length} ครั้ง`);
    console.log('\nรายการสำรวจ:');
    surveys.forEach((survey, idx) => {
      const farmerName = `${survey.farmer_first_name} ${survey.farmer_last_name}`;
      console.log(`${idx + 1}. ID: ${survey.id}, เกษตรกร: ${farmerName}, วันที่: ${survey.survey_date}, ผู้สำรวจ: ${survey.surveyor_id}`);
    });

    // 3. ตรวจสอบปศุสัตว์แต่ละการสำรวจ
    console.log('\n🐮 ปศุสัตว์แต่ละการสำรวจ:');
    for (const survey of surveys) {
      const livestock = await runQuery(`
        SELECT livestock_type, count
        FROM survey_livestock
        WHERE survey_id = ?
      `, [survey.id]);
      
      const farmerName = `${survey.farmer_first_name} ${survey.farmer_last_name}`;
      const totalCount = livestock.reduce((sum, item) => sum + item.count, 0);
      console.log(`\nID ${survey.id} - ${farmerName}:`);
      console.log(`  รวม: ${totalCount} ตัว`);
      livestock.forEach(item => {
        console.log(`    - ${item.livestock_type}: ${item.count} ตัว`);
      });
    }

    // 4. ตรวจสอบเกษตรกรที่ไม่ซ้ำ
    const uniqueFarmers = await runQuery(`
      SELECT DISTINCT farmer_first_name, farmer_last_name, COUNT(*) as survey_count
      FROM farm_surveys
      GROUP BY farmer_first_name, farmer_last_name
      ORDER BY survey_count DESC
    `);
    console.log('\n👨‍🌾 เกษตรกรทั้งหมด:', uniqueFarmers.length, 'คน');
    uniqueFarmers.forEach((farmer, idx) => {
      const farmerName = `${farmer.farmer_first_name} ${farmer.farmer_last_name}`;
      console.log(`${idx + 1}. ${farmerName} - สำรวจ ${farmer.survey_count} ครั้ง`);
    });

  } catch (err) {
    console.error('Error:', err);
  }
}

async function deleteTestData() {
  try {
    console.log('\n=== เริ่มลบข้อมูลทดสอบ ===\n');

    // ค้นหา survey IDs ที่เป็นข้อมูลทดสอบ
    const testSurveys = await runQuery(`
      SELECT id, farmer_first_name, farmer_last_name, surveyor_id
      FROM farm_surveys
      WHERE surveyor_id = 'unknown_user' OR surveyor_id LIKE 'test_%'
    `);

    console.log(`\n🗑️  พบข้อมูลทดสอบ ${testSurveys.length} รายการ:`);
    if (testSurveys.length === 0) {
      console.log('\n❌ ไม่พบข้อมูลทดสอบที่ต้องลบ (surveyor_id = unknown_user หรือ test_*)');
      console.log('\n💡 ตรวจสอบรายละเอียดข้อมูลทั้งหมดด้วย: node cleanup_test_data_sqlite.js check');
      return;
    }

    testSurveys.forEach((survey, idx) => {
      const farmerName = `${survey.farmer_first_name} ${survey.farmer_last_name}`;
      console.log(`${idx + 1}. ID: ${survey.id}, เกษตรกร: ${farmerName}, ผู้สำรวจ: ${survey.surveyor_id}`);
    });

    console.log('\n⚠️  WARNING: กำลังจะลบข้อมูลทดสอบข้างต้น');
    console.log('กำลังรอ 3 วินาที... (กด Ctrl+C เพื่อยกเลิก)\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    const surveyIds = testSurveys.map(s => s.id);

    // นับปศุสัตว์ที่จะลบ
    const livestockToDelete = await runQuery(`
      SELECT SUM(count) as total
      FROM survey_livestock
      WHERE survey_id IN (${surveyIds.map(() => '?').join(',')})
    `, surveyIds);

    console.log(`🗑️  จะลบปศุสัตว์: ${livestockToDelete[0].total} ตัว`);

    // ลบปศุสัตว์ที่เกี่ยวข้อง
    await runExec(`
      DELETE FROM survey_livestock
      WHERE survey_id IN (${surveyIds.map(() => '?').join(',')})
    `, surveyIds);
    console.log(`✅ ลบปศุสัตว์แล้ว`);

    // ลบการสำรวจ
    await runExec(`
      DELETE FROM farm_surveys
      WHERE id IN (${surveyIds.map(() => '?').join(',')})
    `, surveyIds);
    console.log(`✅ ลบการสำรวจแล้ว`);

    console.log('\n✅ ลบข้อมูลทดสอบเรียบร้อยแล้ว!');

    // ตรวจสอบข้อมูลหลังลบ
    console.log('\n=== ข้อมูลหลังลบ ===\n');
    await checkData();

  } catch (err) {
    console.error('Error:', err);
  }
}

// เรียกใช้งาน
const args = process.argv.slice(2);
if (args[0] === 'check') {
  checkData().then(() => db.close());
} else if (args[0] === 'delete') {
  deleteTestData().then(() => db.close());
} else {
  console.log('Usage:');
  console.log('  node cleanup_test_data_sqlite.js check   - ตรวจสอบข้อมูล');
  console.log('  node cleanup_test_data_sqlite.js delete  - ลบข้อมูลทดสอบ');
  db.close();
}
