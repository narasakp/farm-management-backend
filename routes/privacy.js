/**
 * Privacy API Routes
 * จัดการการเข้าถึงข้อมูลอ่อนไหวตาม PDPA
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { logAuditAction } = require('../middleware/rbac');
const { maskSensitiveData, getExportPermission, maskGPSLocation } = require('../utils/data_masking');
const {
  grantTemporaryAccess,
  checkTemporaryAccess,
  revokeTemporaryAccess,
  checkRateLimit,
  grantEmergencyAccess
} = require('../utils/temporary_access');

const DB_PATH = path.join(__dirname, '../farm_auth.db');

// =============================================
// POST /api/privacy/click-to-reveal
// ขอดูข้อมูลเต็ม (สำหรับ OFFICER)
// =============================================
router.post('/click-to-reveal', authenticateToken, async (req, res) => {
  try {
    const { target_user_id, reason, access_fields } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log('🔍 [Click-to-Reveal] Request received');
    console.log('👤 User ID:', userId);
    console.log('🎭 User Role:', userRole);
    console.log('🎯 Target User:', target_user_id);
    console.log('📝 Reason:', reason);
    console.log('📋 Access Fields:', access_fields);
    
    // ตรวจสอบ Role (รองรับทั้ง lowercase และ UPPERCASE)
    const roleUpper = (userRole || '').toUpperCase();
    console.log('🔄 Role Uppercase:', roleUpper);
    
    // อนุญาต: SUPER_ADMIN, TAMBON_OFFICER, AMPHOE_OFFICER, RESEARCHER
    const allowedRoles = ['SUPER_ADMIN', 'TAMBON_OFFICER', 'AMPHOE_OFFICER', 'RESEARCHER'];
    const hasAccess = allowedRoles.some(role => roleUpper === role || roleUpper.includes(role));
    
    if (!hasAccess) {
      console.log('❌ Access DENIED - Invalid Role:', roleUpper);
      return res.status(403).json({
        success: false,
        message: 'เฉพาะ OFFICER และ RESEARCHER เท่านั้น'
      });
    }
    
    console.log('✅ Role check PASSED');
    
    // ตรวจสอบ Rate Limit
    if (checkRateLimit(userId, 10)) {
      return res.status(429).json({
        success: false,
        message: 'คุณขอดูข้อมูลเกินจำนวนที่กำหนด (10 ครั้ง/วัน)'
      });
    }
    
    // ตรวจสอบว่ามี Reason หรือไม่
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุเหตุผลในการขอดูข้อมูล'
      });
    }
    
    // Grant Temporary Access (2 hours)
    const accessData = grantTemporaryAccess({
      userId,
      targetUserId: target_user_id,
      reason,
      type: 'click_to_reveal',
      duration: 2 * 60 * 60 * 1000, // 2 hours
      accessFields: access_fields || ['id_card', 'phone'] // Default: ทั้งหมด
    });
    
    // Log Audit
    await logAuditAction({
      user_id: userId,
      username: req.user.username,
      role: userRole,
      action: 'CLICK_TO_REVEAL',
      resource: 'privacy',
      resource_id: target_user_id,
      details: `ขอดูข้อมูลของ User ID: ${target_user_id} | เหตุผล: ${reason}`,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      success: 1
    });
    
    res.json({
      success: true,
      message: 'สามารถดูข้อมูลเต็มได้ 2 ชั่วโมง',
      access_id: accessData.accessId,
      expires_at: accessData.expiresAt
    });
    
  } catch (error) {
    console.error('❌ Click-to-Reveal error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

// =============================================
// POST /api/privacy/emergency-access
// ขอเข้าถึงฉุกเฉิน (สำหรับ OFFICER, ADMIN)
// =============================================
router.post('/emergency-access', authenticateToken, async (req, res) => {
  try {
    const { target_user_id, reason, emergency_type, access_fields } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // ตรวจสอบ Role (รองรับทั้ง lowercase และ UPPERCASE)
    const roleUpper = (userRole || '').toUpperCase();
    
    // อนุญาต: SUPER_ADMIN, TAMBON_OFFICER, AMPHOE_OFFICER, RESEARCHER
    const allowedRoles = ['SUPER_ADMIN', 'TAMBON_OFFICER', 'AMPHOE_OFFICER', 'RESEARCHER'];
    const hasAccess = allowedRoles.some(role => roleUpper === role || roleUpper.includes(role));
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'เฉพาะ OFFICER และ RESEARCHER เท่านั้น'
      });
    }
    
    // ตรวจสอบ Emergency Type
    const validTypes = ['โรคระบาด', 'อุบัติเหตุ', 'ภัยพิบัติ', 'อื่นๆ'];
    if (!emergency_type || !validTypes.includes(emergency_type)) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุประเภทความฉุกเฉิน'
      });
    }
    
    // Grant Emergency Access (2 hours)
    const accessData = grantEmergencyAccess({
      userId,
      targetUserId: target_user_id,
      reason,
      emergencyType: emergency_type,
      accessFields: access_fields || ['id_card', 'phone']
    });
    
    // Log Audit (High Priority)
    await logAuditAction({
      user_id: userId,
      username: req.user.username,
      role: userRole,
      action: 'EMERGENCY_ACCESS',
      resource: 'privacy',
      resource_id: target_user_id,
      details: `🚨 ขอเข้าถึงฉุกเฉิน: ${emergency_type} | User ID: ${target_user_id} | เหตุผล: ${reason}`,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      success: 1
    });
    
    res.json({
      success: true,
      message: `สามารถเข้าถึงข้อมูลได้ 2 ชั่วโมง (ฉุกเฉิน: ${emergency_type})`,
      access_id: accessData.accessId,
      expires_at: accessData.expiresAt
    });
    
  } catch (error) {
    console.error('❌ Emergency Access error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

// =============================================
// POST /api/privacy/request-callback
// ขอให้เกษตรกรโทรกลับ
// =============================================
router.post('/request-callback', authenticateToken, async (req, res) => {
  try {
    // ✅ เช็ค Feature Flag
    if (process.env.FEATURE_REQUEST_CALLBACK !== 'true') {
      return res.status(503).json({
        success: false,
        message: 'ฟีเจอร์นี้ยังไม่เปิดใช้งาน',
        feature_disabled: true
      });
    }
    
    const { target_user_id, message } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // ตรวจสอบ Role (รองรับทั้ง lowercase และ UPPERCASE)
    const roleUpper = (userRole || '').toUpperCase();
    
    // อนุญาต: SUPER_ADMIN, TAMBON_OFFICER, AMPHOE_OFFICER, RESEARCHER
    const allowedRoles = ['SUPER_ADMIN', 'TAMBON_OFFICER', 'AMPHOE_OFFICER', 'RESEARCHER'];
    const hasAccess = allowedRoles.some(role => roleUpper === role || roleUpper.includes(role));
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งาน (เฉพาะ OFFICER และ RESEARCHER)'
      });
    }
    
    const db = new sqlite3.Database(DB_PATH);
    
    // ดึงข้อมูลเกษตรกรจาก farm_surveys
    db.get(`
      SELECT 
        id,
        farmer_first_name,
        farmer_last_name,
        farmer_phone as phone,
        farmer_id_card
      FROM farm_surveys
      WHERE farmer_id_card = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [target_user_id], async (err, farmer) => {
      if (err || !farmer) {
        db.close();
        console.log('❌ Farmer not found for id_card:', target_user_id);
        return res.status(404).json({
          success: false,
          message: 'ไม่พบข้อมูลเกษตรกร'
        });
      }
      
      console.log('✅ Farmer found:', farmer.farmer_first_name, farmer.farmer_last_name);
      
      // ดึงข้อมูลเจ้าหน้าที่
      db.get(`
        SELECT 
          username,
          display_name,
          phone
        FROM users
        WHERE id = ?
      `, [userId], async (err2, officer) => {
        db.close();
        
        if (err2 || !officer) {
          return res.status(404).json({
            success: false,
            message: 'ไม่พบข้อมูลผู้ใช้'
          });
        }
        
        // ส่ง SMS
        const { sendSMS } = require('../utils/sms_service');
        
        const farmerName = `${farmer.farmer_first_name || ''} ${farmer.farmer_last_name || ''}`.trim();
        const officerPhone = officer.phone || '073-234567'; // เบอร์ default ถ้าไม่มี
        
        const smsMessage = `สวัสดีครับคุณ${farmerName}
เจ้าหน้าที่ปศุสัตว์ ${officer.display_name || officer.username}
ขอให้โทรกลับที่ ${officerPhone}
เรื่อง: ${message || 'ติดตามข้อมูลการสำรวจ'}`;
        
        console.log('📱 SMS to send:', smsMessage);
        console.log('📱 To:', farmer.phone);
        console.log('📱 Officer phone:', officerPhone);
        
        // ส่ง SMS (จะเป็น mock ถ้าไม่มี API Key)
        const smsResult = await sendSMS(farmer.phone, smsMessage);
        
        // Log Audit
        await logAuditAction({
          user_id: userId,
          username: req.user.username,
          role: userRole,
          action: 'REQUEST_CALLBACK',
          resource: 'privacy',
          resource_id: target_user_id,
          details: `ขอให้ ${farmer.display_name} (ID: ${target_user_id}) โทรกลับ | ข้อความ: ${message}`,
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
          success: 1
        });
        
        res.json({
          success: true,
          message: 'ส่งข้อความขอให้โทรกลับแล้ว',
          sms_sent: smsResult.success,
          sms_mock: smsResult.mock || false,
          preview_message: smsMessage
        });
      });
    });
    
  } catch (error) {
    console.error('❌ Request Callback error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

// =============================================
// GET /api/privacy/farmer/:id
// ดึงข้อมูลเกษตรกร (พร้อม Masking ตาม Role)
// =============================================
router.get('/farmer/:id', authenticateToken, async (req, res) => {
  console.log('🔍 [GET /farmer/:id] Request received');
  console.log('📋 Farmer ID:', req.params.id);
  console.log('👤 User ID:', req.user?.id);
  console.log('🎭 User Role:', req.user?.role);
  
  try {
    const farmerId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // ดึงข้อมูลจาก farm_surveys (หาจาก farmer_id_card)
    db.get(`
      SELECT 
        id,
        farmer_first_name,
        farmer_last_name,
        farmer_id_card,
        farmer_phone,
        address_house_number,
        address_village,
        address_moo,
        address_tambon,
        address_amphoe,
        address_province,
        address_postal_code,
        gps_address,
        created_at
      FROM farm_surveys
      WHERE farmer_id_card = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [farmerId], async (err, farmer) => {
      console.log('📊 Query result:', { err: err?.message, farmerFound: !!farmer });
      
      db.close();
      
      if (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({
          success: false,
          message: 'เกิดข้อผิดพลาดในการค้นหาข้อมูล'
        });
      }
      
      if (!farmer) {
        console.log('❌ Farmer not found in database');
        return res.status(404).json({
          success: false,
          message: 'ไม่พบข้อมูลเกษตรกร'
        });
      }
      
      console.log('✅ Farmer found:', farmer.id);
      
      // แปลงเป็น format ที่ mask function ต้องการ
      const farmerData = {
        id: farmer.id,
        first_name: farmer.farmer_first_name,
        last_name: farmer.farmer_last_name,
        id_card: farmer.farmer_id_card,
        phone: farmer.farmer_phone,
        address: {
          house_number: farmer.address_house_number,
          village: farmer.address_village,
          moo: farmer.address_moo,
          tambon: farmer.address_tambon,
          amphoe: farmer.address_amphoe,
          province: farmer.address_province,
          postal_code: farmer.address_postal_code,
          full: `${farmer.address_house_number || ''} หมู่${farmer.address_moo || ''} ${farmer.address_village || ''} ${farmer.address_tambon || ''} ${farmer.address_amphoe || ''} ${farmer.address_province || ''}`
        },
        gps_location: farmer.gps_address,
        created_at: farmer.created_at
      };
      
      // ตรวจสอบ Temporary Access
      const hasTemporaryAccess = checkTemporaryAccess(userId, farmerId);
      console.log('🔑 Temporary Access:', hasTemporaryAccess ? 'YES' : 'NO');
      if (hasTemporaryAccess) {
        console.log('📋 Access Fields:', hasTemporaryAccess.accessFields);
      }
      
      // Mask ข้อมูล (ใช้ role ปกติ, Frontend จะ unmask based on access_fields)
      const maskedData = maskSensitiveData(farmerData, userRole);
      console.log('📋 Data masked:', maskedData._masked);
      
      // Mask GPS Location แยกต่างหาก
      maskedData.gps_location = maskGPSLocation(farmerData.gps_location, userRole);
      
      // แปลง address object เป็น string สำหรับ frontend
      if (maskedData.address && typeof maskedData.address === 'object') {
        maskedData.address_string = maskedData.address.full || 'ไม่มีข้อมูล';
      }
      
      // เพิ่มข้อมูล Temporary Access ถ้ามี
      if (hasTemporaryAccess) {
        const accessFields = hasTemporaryAccess.accessFields || ['id_card', 'phone'];
        
        maskedData._temporary_access = {
          granted: true,
          type: hasTemporaryAccess.type,
          expires_at: hasTemporaryAccess.expiresAt,
          reason: hasTemporaryAccess.reason,
          access_fields: accessFields,
          fieldReasons: hasTemporaryAccess.fieldReasons || {}, // เพิ่ม fieldReasons
          fieldExpiries: hasTemporaryAccess.fieldExpiries || {} // เพิ่ม fieldExpiries
        };
        
        // ส่งข้อมูลเต็มของ field ที่มี access
        maskedData._unmasked_data = {};
        if (accessFields.includes('id_card')) {
          maskedData._unmasked_data.id_card = farmerData.id_card;
          console.log('📤 Sending unmasked id_card:', farmerData.id_card);
        }
        if (accessFields.includes('phone')) {
          maskedData._unmasked_data.phone = farmerData.phone;
          console.log('📤 Sending unmasked phone:', farmerData.phone);
        }
        if (accessFields.includes('gps')) {
          maskedData._unmasked_data.gps_location = farmerData.gps_location;
          console.log('📤 Sending unmasked gps_location:', farmerData.gps_location);
        }
        if (accessFields.includes('address')) {
          // ส่งที่อยู่เต็ม
          const fullAddress = `บ้านเลขที่ ${farmerData.address.house_number || ''} ${farmerData.address.village ? 'บ้าน' + farmerData.address.village : ''} หมู่ที่ ${farmerData.address.moo || ''} ตำบล${farmerData.address.tambon || ''} อำเภอ${farmerData.address.amphoe || ''} จังหวัด${farmerData.address.province || ''} ${farmerData.address.postal_code || ''}`.trim();
          maskedData._unmasked_data.address = fullAddress;
          console.log('📤 Sending unmasked address:', fullAddress);
        }
        console.log('📦 Final _unmasked_data:', maskedData._unmasked_data);
      }
      
      // Log Audit (เฉพาะกรณีดูข้อมูลเต็ม)
      if (hasTemporaryAccess) {
        await logAuditAction({
          user_id: userId,
          username: req.user.username,
          role: userRole,
          action: 'VIEW_SENSITIVE_DATA',
          resource: 'privacy',
          resource_id: farmerId,
          details: `ดูข้อมูลเต็มของ Farmer ID: ${farmerId} (Temporary Access)`,
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
          success: 1
        });
      }
      
      // ✅ เพิ่ม Feature Flags
      maskedData._feature_flags = {
        request_callback: process.env.FEATURE_REQUEST_CALLBACK === 'true'
      };
      
      res.json({
        success: true,
        data: maskedData
      });
    });
    
  } catch (error) {
    console.error('❌ Get Farmer error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

// =============================================
// POST /api/privacy/revoke-access
// ยกเลิก Temporary Access
// =============================================
router.post('/revoke-access', authenticateToken, async (req, res) => {
  try {
    const { access_id } = req.body;
    const userId = req.user.id;
    
    revokeTemporaryAccess(access_id, 'manual');
    
    await logAuditAction({
      user_id: userId,
      username: req.user.username,
      role: req.user.role,
      action: 'REVOKE_ACCESS',
      resource: 'privacy',
      resource_id: access_id,
      details: `ยกเลิก Temporary Access: ${access_id}`,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      success: 1
    });
    
    res.json({
      success: true,
      message: 'ยกเลิกการเข้าถึงแล้ว'
    });
    
  } catch (error) {
    console.error('❌ Revoke Access error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

module.exports = router;
