const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { authenticateToken } = require('../middleware/auth');

const DB_PATH = path.join(__dirname, '../farm_auth.db');

// =============================================
// GET /api/search
// ค้นหาจาก livestock, surveys, transactions
// =============================================
router.get('/', authenticateToken, (req, res) => {
  const { q, category } = req.query; // q = search query, category = filter
  
  if (!q || q.trim().length === 0) {
    return res.json({
      success: true,
      results: {
        livestock: [],
        surveys: [],
        transactions: [],
        total: 0
      }
    });
  }
  
  const searchTerm = `%${q.trim()}%`;
  const db = new sqlite3.Database(DB_PATH);
  
  const results = {
    livestock: [],
    surveys: [],
    transactions: [],
    total: 0
  };
  
  const shouldSearchCategory = (cat) => {
    if (!category || category === 'ทั้งหมด') return true;
    return category === cat;
  };
  
  // Livestock type mapping (ตรงกับฐานข้อมูล)
  const livestockTypeMap = {
    'buffaloLocal': 'ควายพื้นเมือง',
    'buffaloMurrah': 'ควายมูร่าห์',
    'beefCattleLocal': 'โคเนื้อพื้นเมือง',
    'beefCattleCrossbred': 'โคเนื้อลูกผสม',
    'dairyCow': 'โคนม',
    'goat': 'แพะ',
    'sheep': 'แกะ',
    'pig': 'สุกร',
    'chickenLocal': 'ไก่พื้นเมือง',
    'chickenLayer': 'ไก่ไข่',
    'chickenBroiler': 'ไก่เนื้อ',
    'duckEgg': 'เป็ดไข่',
    'duckMeat': 'เป็ดเนื้อ',
    'duckMuscovy': 'เป็ดพะยูน',
    'dog': 'สุนัข',
    'cat': 'แมว'
  };
  
  // Search Livestock (from farm_surveys + survey_livestock)
  const searchLivestock = new Promise((resolve) => {
    if (!shouldSearchCategory('ปศุสัตว์')) {
      return resolve();
    }
    
    // Convert Thai to English type for search
    const searchThaiToEnglish = (searchQuery) => {
      const query = searchQuery.toLowerCase().replace(/%/g, '');
      for (const [engType, thaiName] of Object.entries(livestockTypeMap)) {
        if (thaiName.includes(query)) {
          return engType;
        }
      }
      return null;
    };
    
    const englishType = searchThaiToEnglish(searchTerm);
    const typeSearchTerm = englishType ? `%${englishType}%` : searchTerm;
    
    db.all(`
      SELECT 
        sl.id,
        sl.survey_id,
        sl.livestock_type,
        sl.count as total_count,
        sl.created_at,
        fs.farmer_first_name,
        fs.farmer_last_name,
        fs.farmer_phone,
        fs.address_tambon,
        fs.address_amphoe,
        fs.address_province
      FROM survey_livestock sl
      LEFT JOIN farm_surveys fs ON sl.survey_id = fs.id
      WHERE sl.livestock_type LIKE ? 
         OR sl.livestock_type LIKE ?
         OR fs.farmer_first_name LIKE ?
         OR fs.farmer_last_name LIKE ?
      ORDER BY sl.created_at DESC
      LIMIT 20
    `, [searchTerm, typeSearchTerm, searchTerm, searchTerm], (err, rows) => {
      if (!err && rows) {
        results.livestock = rows.map(row => {
          const farmerName = `${row.farmer_first_name || ''} ${row.farmer_last_name || ''}`.trim();
          const livestockName = livestockTypeMap[row.livestock_type] || row.livestock_type;
          return {
            id: row.id,
            type: 'livestock',
            title: `${livestockName} (${row.total_count || 0} ตัว)`,
            subtitle: `เกษตรกร: ${farmerName || 'ไม่ระบุ'}`,
            description: `${row.address_tambon || ''}, ${row.address_amphoe || ''}, ${row.address_province || ''}`,
            created_at: row.created_at,
            data: row
          };
        });
        results.total += results.livestock.length;
      }
      resolve();
    });
  });
  
  // Search Surveys (เกษตรกร)
  const searchSurveys = new Promise((resolve) => {
    if (!shouldSearchCategory('เกษตรกร')) {
      return resolve();
    }
    
    db.all(`
      SELECT 
        fs.id,
        fs.farmer_first_name,
        fs.farmer_last_name,
        fs.farmer_phone,
        fs.address_tambon,
        fs.address_amphoe,
        fs.address_province,
        fs.created_at,
        COUNT(sl.id) as livestock_count
      FROM farm_surveys fs
      LEFT JOIN survey_livestock sl ON fs.id = sl.survey_id
      WHERE fs.farmer_first_name LIKE ? 
         OR fs.farmer_last_name LIKE ? 
         OR fs.farmer_phone LIKE ?
      GROUP BY fs.id
      ORDER BY fs.created_at DESC
      LIMIT 20
    `, [searchTerm, searchTerm, searchTerm], (err, rows) => {
      if (!err && rows) {
        results.surveys = rows.map(row => {
          const farmerName = `${row.farmer_first_name || ''} ${row.farmer_last_name || ''}`.trim();
          return {
            id: row.id,
            type: 'survey',
            title: farmerName || 'ไม่ระบุชื่อ',
            subtitle: `โทร: ${row.farmer_phone || 'ไม่ระบุ'}`,
            description: `มีปศุสัตว์ ${row.livestock_count} ประเภท - ${row.address_tambon || ''}, ${row.address_amphoe || ''}`,
            phone: row.farmer_phone,
            created_at: row.created_at,
            data: row
          };
        });
        results.total += results.surveys.length;
      }
      resolve();
    });
  });
  
  // Search Transactions (ธุรกรรม) - placeholder for future
  const searchTransactions = new Promise((resolve) => {
    if (!shouldSearchCategory('ธุรกรรม')) {
      return resolve();
    }
    
    // For now, return empty as we don't have transactions table yet
    // TODO: Implement when transactions table is created
    resolve();
  });
  
  // Execute all searches
  Promise.all([searchLivestock, searchSurveys, searchTransactions])
    .then(() => {
      db.close();
      
      res.json({
        success: true,
        query: q,
        category: category || 'ทั้งหมด',
        results
      });
    })
    .catch((error) => {
      db.close();
      console.error('Search error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'เกิดข้อผิดพลาดในการค้นหา'
      });
    });
});

module.exports = router;
