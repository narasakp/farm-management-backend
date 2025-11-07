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

async function checkAllLivestock() {
  try {
    console.log('\n=== ตรวจสอบ survey_livestock ทั้งหมด ===\n');

    // ดึงข้อมูลทั้งหมดจาก survey_livestock
    const allLivestock = await runQuery(`
      SELECT sl.*, fs.farmer_first_name, fs.farmer_last_name
      FROM survey_livestock sl
      LEFT JOIN farm_surveys fs ON sl.survey_id = fs.id
      ORDER BY sl.survey_id, sl.id
    `);

    console.log(`📊 จำนวน Records ทั้งหมด: ${allLivestock.length}\n`);

    // Group by survey_id
    const groupedBySurvey = {};
    allLivestock.forEach(item => {
      if (!groupedBySurvey[item.survey_id]) {
        groupedBySurvey[item.survey_id] = {
          farmerName: `${item.farmer_first_name} ${item.farmer_last_name}`,
          items: []
        };
      }
      groupedBySurvey[item.survey_id].items.push(item);
    });

    let totalAnimals = 0;
    console.log('📋 รายละเอียดแต่ละการสำรวจ:\n');
    
    for (const [surveyId, data] of Object.entries(groupedBySurvey)) {
      const surveyTotal = data.items.reduce((sum, item) => sum + item.count, 0);
      totalAnimals += surveyTotal;
      
      console.log(`Survey ID: ${surveyId}`);
      console.log(`เกษตรกร: ${data.farmerName}`);
      console.log(`จำนวน Records: ${data.items.length}`);
      console.log(`รวม: ${surveyTotal} ตัว`);
      console.log('รายการ:');
      
      data.items.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ID:${item.id} - ${item.livestock_type}: ${item.count} ตัว (age_group: ${item.age_group || 'N/A'})`);
      });
      console.log('');
    }

    console.log(`\n✅ รวมทั้งหมด: ${totalAnimals} ตัว`);
    console.log(`\n📌 สรุป:`);
    console.log(`   - จำนวนการสำรวจ: ${Object.keys(groupedBySurvey).length} ครั้ง`);
    console.log(`   - จำนวน Records: ${allLivestock.length} records`);
    console.log(`   - จำนวนปศุสัตว์: ${totalAnimals} ตัว`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    db.close();
  }
}

checkAllLivestock();
