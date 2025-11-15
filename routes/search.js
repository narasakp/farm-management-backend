const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { authenticateToken } = require('../middleware/auth');

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// =============================================
// GET /api/search
// ค้นหาจาก livestock, surveys, transactions
// =============================================
router.get('/', authenticateToken, async (req, res) => {
  const { q, category } = req.query; // q = search query, category = filter
  
  if (!q || q.trim().length === false) {
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
  
  try {
    const searchTerm = `%${q.trim()}%`;
    
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
    
    // Search Livestock (from farm_surveys + survey_livestock)
    if (shouldSearchCategory('ปศุสัตว์')) {
      const englishType = searchThaiToEnglish(searchTerm);
      const typeSearchTerm = englishType ? `%${englishType}%` : searchTerm;
      
      const livestockResult = await pool.query(`
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
        WHERE sl.livestock_type ILIKE $1 
           OR sl.livestock_type ILIKE $2
           OR fs.farmer_first_name ILIKE $3
           OR fs.farmer_last_name ILIKE $4
        ORDER BY sl.created_at DESC
        LIMIT 20
      `, [searchTerm, typeSearchTerm, searchTerm, searchTerm]);
      
      results.livestock = livestockResult.rows.map(row => {
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
    
    // Search Surveys (เกษตรกร)
    if (shouldSearchCategory('เกษตรกร')) {
      const surveysResult = await pool.query(`
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
        WHERE fs.farmer_first_name ILIKE $1 
           OR fs.farmer_last_name ILIKE $2 
           OR fs.farmer_phone ILIKE $3
        GROUP BY fs.id
        ORDER BY fs.created_at DESC
        LIMIT 20
      `, [searchTerm, searchTerm, searchTerm]);
      
      results.surveys = surveysResult.rows.map(row => {
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
  
    // Search Transactions (ธุกรรม) - placeholder for future
    // TODO: Implement when transactions table is created
    
    res.json({
      success: true,
      query: q,
      category: category || 'ทั้งหมด',
      results
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการค้นหา'
    });
  }
});

module.exports = router;
