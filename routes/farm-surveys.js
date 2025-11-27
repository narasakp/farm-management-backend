/**
 * Farm Survey API Routes
 * จัดการข้อมูลการสำรวจฟาร์ม
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Helper function to check if user has permission to modify
function hasPermission(userRole) {
  return ['SUPER_ADMIN', 'OFFICER', 'RESEARCHER'].includes(userRole?.toUpperCase());
}

// =============================================
// POST /api/farm-surveys
// บันทึกข้อมูลการสำรวจใหม่
// =============================================
router.post('/', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { 
      farmerId, 
      surveyDate, 
      farmerInfo, 
      livestockData, 
      farmArea, 
      cropArea, 
      notes, 
      gpsLocation 
    } = req.body;

    const surveyId = Date.now().toString();

    await db.execute(`
      INSERT INTO farm_surveys (
        id, farmer_id, surveyor_id,
        survey_date, farmer_title, farmer_first_name, farmer_last_name,
        farmer_id_card, farmer_phone, farmer_photo_base64,
        address_house_number, address_village, address_moo,
        address_tambon, address_amphoe, address_province, address_postal_code,
        farm_area, crop_area, notes, gps_address,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      surveyId,
      farmerId || req.user.userId,
      req.user.userId,
      surveyDate,
      farmerInfo.title,
      farmerInfo.firstName,
      farmerInfo.lastName,
      farmerInfo.idCard,
      farmerInfo.phoneNumber,
      farmerInfo.photoBase64,
      farmerInfo.address.houseNumber,
      farmerInfo.address.village,
      farmerInfo.address.moo,
      farmerInfo.address.tambon,
      farmerInfo.address.amphoe,
      farmerInfo.address.province,
      farmerInfo.address.postalCode,
      farmArea,
      cropArea,
      notes,
      gpsLocation
    ]);

    // Insert livestock data
    if (livestockData && livestockData.length > 0) {
      for (const livestock of livestockData) {
        await db.execute(`
          INSERT INTO survey_livestock (
            survey_id, livestock_type, age_group, 
            count, daily_milk_production
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          surveyId,
          livestock.type,
          livestock.ageGroup,
          livestock.count,
          livestock.dailyMilkProduction
        ]);
      }
    }

    console.log(`✅ Survey created: ${surveyId}`);
    res.status(201).json({
      success: true,
      message: 'บันทึกข้อมูลการสำรวจเรียบร้อย',
      surveyId
    });
  } catch (error) {
    console.error('Error creating survey:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
    });
  }
});

// =============================================
// GET /api/farm-surveys
// ดึงรายการข้อมูลการสำรวจ
// =============================================
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const surveys = await db.query(`
      SELECT 
        fs.id, fs.farmer_id, fs.surveyor_id,
        fs.survey_date, fs.farmer_title, fs.farmer_first_name, fs.farmer_last_name,
        fs.farmer_id_card, fs.farmer_phone, fs.farmer_photo_base64,
        fs.address_house_number, fs.address_village, fs.address_moo,
        fs.address_tambon, fs.address_amphoe, fs.address_province, fs.address_postal_code,
        fs.farm_area, fs.crop_area, fs.notes, fs.gps_address,
        fs.created_at,
        (SELECT COUNT(*) FROM survey_livestock WHERE survey_id = fs.id) as livestock_count
      FROM farm_surveys fs
      ORDER BY fs.survey_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Get livestock data for each survey
    const surveyData = await Promise.all(surveys.map(async (survey) => {
      const livestock = await db.query(`
        SELECT * FROM survey_livestock WHERE survey_id = ?
      `, [survey.id]);

      return {
        id: survey.id,
        farmerId: survey.farmer_id,
        surveyorId: survey.surveyor_id,
        surveyorName: 'Unknown', // Not in DB, use default
        surveyorRole: 'OFFICER', // Not in DB, use default
        surveyDate: survey.survey_date,
        farmerInfo: {
          title: survey.farmer_title,
          firstName: survey.farmer_first_name,
          lastName: survey.farmer_last_name,
          idCard: survey.farmer_id_card,
          phoneNumber: survey.farmer_phone,
          photoBase64: survey.farmer_photo_base64,
          address: {
            houseNumber: survey.address_house_number,
            village: survey.address_village,
            moo: survey.address_moo,
            tambon: survey.address_tambon,
            amphoe: survey.address_amphoe,
            province: survey.address_province,
            postalCode: survey.address_postal_code
          }
        },
        livestockData: livestock,
        farmArea: survey.farm_area,
        cropArea: survey.crop_area,
        notes: survey.notes,
        gpsLocation: survey.gps_address,
        createdAt: survey.created_at,
        updatedAt: survey.created_at // Use created_at since no updated_at
      };
    }));

    res.json({
      success: true,
      data: surveyData,
      page,
      limit
    });
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูล'
    });
  }
});

// =============================================
// PUT /api/farm-surveys/:id
// อัปเดตข้อมูลการสำรวจ
// =============================================
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id } = req.params;
    const { 
      surveyDate, 
      farmerInfo, 
      livestockData, 
      farmArea, 
      cropArea, 
      notes, 
      gpsLocation 
    } = req.body;

    // Check permission
    if (!hasPermission(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'คุณไม่มีสิทธิ์แก้ไขข้อมูล'
      });
    }

    // Check if survey exists
    const existingResult = await db.query(`
      SELECT id FROM farm_surveys WHERE id = ?
    `, [id]);
    const existing = existingResult[0];

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'ไม่พบข้อมูลการสำรวจ'
      });
    }

    // Update survey
    await db.execute(`
      UPDATE farm_surveys SET
        survey_date = ?,
        farmer_title = ?,
        farmer_first_name = ?,
        farmer_last_name = ?,
        farmer_id_card = ?,
        farmer_phone = ?,
        farmer_photo_base64 = ?,
        address_house_number = ?,
        address_village = ?,
        address_moo = ?,
        address_tambon = ?,
        address_amphoe = ?,
        address_province = ?,
        address_postal_code = ?,
        farm_area = ?,
        crop_area = ?,
        notes = ?,
        gps_address = ?
      WHERE id = ?
    `, [
      surveyDate,
      farmerInfo.title,
      farmerInfo.firstName,
      farmerInfo.lastName,
      farmerInfo.idCard,
      farmerInfo.phoneNumber,
      farmerInfo.photoBase64,
      farmerInfo.address.houseNumber,
      farmerInfo.address.village,
      farmerInfo.address.moo,
      farmerInfo.address.tambon,
      farmerInfo.address.amphoe,
      farmerInfo.address.province,
      farmerInfo.address.postalCode,
      farmArea,
      cropArea,
      notes,
      gpsLocation,
      id
    ]);

    // Delete old livestock data
    await db.execute(`DELETE FROM survey_livestock WHERE survey_id = ?`, [id]);

    // Insert new livestock data
    if (livestockData && livestockData.length > 0) {
      for (const livestock of livestockData) {
        await db.execute(`
          INSERT INTO survey_livestock (
            survey_id, livestock_type, age_group, 
            count, daily_milk_production
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          id,
          livestock.type,
          livestock.ageGroup,
          livestock.count,
          livestock.dailyMilkProduction
        ]);
      }
    }

    console.log(`✅ Survey updated: ${id}`);
    res.json({
      success: true,
      message: 'อัปเดตข้อมูลการสำรวจเรียบร้อย'
    });
  } catch (error) {
    console.error('Error updating survey:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล'
    });
  }
});

// =============================================
// DELETE /api/farm-surveys/:id
// ลบข้อมูลการสำรวจ (Soft delete)
// =============================================
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id } = req.params;

    // Check permission
    if (!hasPermission(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'คุณไม่มีสิทธิ์ลบข้อมูล'
      });
    }

    // Check if survey exists
    const existingResult = await db.query(`
      SELECT id FROM farm_surveys WHERE id = ?
    `, [id]);
    const existing = existingResult[0];

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'ไม่พบข้อมูลการสำรวจ'
      });
    }

    // Hard delete (no soft delete column available)
    // First delete related livestock data
    await db.execute(`DELETE FROM survey_livestock WHERE survey_id = ?`, [id]);
    
    // Then delete the survey
    await db.execute(`DELETE FROM farm_surveys WHERE id = ?`, [id]);

    console.log(`✅ Survey deleted: ${id} by ${req.user.username}`);
    res.json({
      success: true,
      message: 'ลบข้อมูลการสำรวจเรียบร้อย'
    });
  } catch (error) {
    console.error('Error deleting survey:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการลบข้อมูล'
    });
  }
});

// =============================================
// GET /api/farm-surveys/statistics/livestock
// สถิติปศุสัตว์
// =============================================
router.get('/statistics/livestock', async (req, res) => {
  try {
    const db = req.app.locals.db;

    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT fs.id) as totalFarms,
        SUM(sl.count) as totalLivestock,
        sl.livestock_type as type,
        SUM(sl.count) as count
      FROM farm_surveys fs
      JOIN survey_livestock sl ON fs.id = sl.survey_id
      GROUP BY sl.livestock_type
    `);

    const totalFarms = stats.length > 0 ? stats[0].totalfarms : 0;
    const totalLivestock = stats.reduce((sum, s) => sum + Number(s.count), 0);
    const livestockByType = {};

    stats.forEach(s => {
      livestockByType[s.type] = Number(s.count);
    });

    res.json({
      success: true,
      data: {
        totalFarms,
        totalLivestock,
        livestockByType
      }
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการดึงสถิติ'
    });
  }
});

module.exports = router;
