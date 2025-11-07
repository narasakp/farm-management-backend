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

async function deleteTestSurveys() {
  try {
    console.log('\n=== ลบข้อมูลทดสอบ (TEST-*) ===\n');

    // ค้นหา livestock ที่ survey_id ขึ้นต้นด้วย TEST-
    const testLivestock = await runQuery(`
      SELECT DISTINCT survey_id FROM survey_livestock WHERE survey_id LIKE 'TEST-%'
    `);

    console.log(`🗑️  พบข้อมูลทดสอบใน survey_livestock: ${testLivestock.length} survey`);
    testLivestock.forEach((item, idx) => {
      console.log(`${idx + 1}. Survey ID: ${item.survey_id}`);
    });

    if (testLivestock.length === 0) {
      console.log('\n✅ ไม่มีข้อมูลทดสอบที่ต้องลบ');
      return;
    }

    // นับจำนวนปศุสัตว์ที่จะลบ
    const livestockToDelete = await runQuery(`
      SELECT COUNT(*) as count, SUM(count) as total 
      FROM survey_livestock WHERE survey_id LIKE 'TEST-%'
    `);
    console.log(`\n📊 จะลบ: ${livestockToDelete[0].count} records (${livestockToDelete[0].total} ตัว)`);

    console.log('\nกำลังลบ...');

    // ลบ livestock ที่เกี่ยวข้อง
    const deletedLivestock = await runExec(`
      DELETE FROM survey_livestock WHERE survey_id LIKE 'TEST-%'
    `);
    console.log(`✅ ลบ survey_livestock แล้ว: ${deletedLivestock.changes} records`);

    // ลบ surveys (ถ้ามี)
    const deletedSurveys = await runExec(`
      DELETE FROM farm_surveys WHERE id LIKE 'TEST-%'
    `);
    console.log(`✅ ลบ farm_surveys แล้ว: ${deletedSurveys.changes} records`);

    // ตรวจสอบข้อมูลหลังลบ
    const afterTotal = await runQuery(`
      SELECT COUNT(*) as count, SUM(count) as total FROM survey_livestock
    `);
    const afterSurveys = await runQuery(`
      SELECT COUNT(*) as count FROM farm_surveys
    `);

    console.log('\n📊 ข้อมูลหลังลบ:');
    console.log(`   - จำนวนการสำรวจ: ${afterSurveys[0].count} ครั้ง`);
    console.log(`   - จำนวนปศุสัตว์: ${afterTotal[0].total} ตัว`);
    console.log('\n✅ ลบข้อมูลทดสอบเรียบร้อยแล้ว!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    db.close();
  }
}

deleteTestSurveys();
