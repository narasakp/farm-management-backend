/**
 * Temporary Access Management
 * จัดการการเข้าถึงข้อมูลชั่วคราว (Click-to-Reveal, Emergency Access)
 */

// In-memory storage (ใช้ Redis ใน Production)
const temporaryAccess = new Map();

/**
 * สร้าง Temporary Access
 * @param {object} params - { userId, targetUserId, reason, type, duration, accessFields }
 * @returns {object} - Access token และข้อมูล
 */
function grantTemporaryAccess({ userId, targetUserId, reason, type = 'click_to_reveal', duration = 2 * 60 * 60 * 1000, accessFields = [] }) {
  const accessId = `${userId}_${targetUserId}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + duration);
  
  const accessData = {
    accessId,
    userId,
    targetUserId,
    reason,
    type, // 'click_to_reveal', 'emergency_access', 'temporary_approval'
    accessFields: accessFields.length > 0 ? accessFields : ['id_card', 'phone'], // Default: ทั้งหมด
    grantedAt: new Date(),
    expiresAt,
    revoked: false,
    autoRevoke: true
  };
  
  temporaryAccess.set(accessId, accessData);
  
  console.log(`✅ Temporary Access Granted:`, accessData);
  
  // Auto-revoke after duration
  setTimeout(() => {
    revokeTemporaryAccess(accessId, 'auto');
  }, duration);
  
  return accessData;
}

/**
 * ตรวจสอบว่ามี Temporary Access หรือไม่
 * @param {string} userId - User ID
 * @param {string} targetUserId - Target User ID
 * @returns {object|null} - Access data ถ้ามี (รวม accessFields จากทุก access), null ถ้าไม่มี
 */
function checkTemporaryAccess(userId, targetUserId) {
  // หา access ทั้งหมดที่ match และยัง active
  const allAccessFields = new Set();
  const fieldReasons = {}; // เก็บ reason สำหรับแต่ละ field
  const fieldExpiries = {}; // เก็บ expiry สำหรับแต่ละ field
  let latestAccess = null;
  
  for (const [accessId, accessData] of temporaryAccess.entries()) {
    if (
      accessData.userId === userId &&
      accessData.targetUserId === targetUserId &&
      !accessData.revoked &&
      new Date() < new Date(accessData.expiresAt)
    ) {
      // รวม access_fields จากทุก access
      if (accessData.accessFields && Array.isArray(accessData.accessFields)) {
        accessData.accessFields.forEach(field => {
          allAccessFields.add(field);
          // เก็บ reason และ expiry สำหรับแต่ละ field
          fieldReasons[field] = accessData.reason;
          fieldExpiries[field] = accessData.expiresAt;
        });
      }
      // เก็บ access ล่าสุด (สำหรับข้อมูลอื่นๆ)
      if (!latestAccess || new Date(accessData.grantedAt) > new Date(latestAccess.grantedAt)) {
        latestAccess = accessData;
      }
    }
  }
  
  if (allAccessFields.size === 0) {
    return null;
  }
  
  // Return access ล่าสุด แต่รวม accessFields และ fieldReasons จากทุก active access
  return {
    ...latestAccess,
    accessFields: Array.from(allAccessFields),
    fieldReasons, // เพิ่ม reason สำหรับแต่ละ field
    fieldExpiries // เพิ่ม expiry สำหรับแต่ละ field
  };
}

/**
 * Revoke Temporary Access
 * @param {string} accessId - Access ID
 * @param {string} revokeType - 'auto' หรือ 'manual'
 */
function revokeTemporaryAccess(accessId, revokeType = 'manual') {
  const accessData = temporaryAccess.get(accessId);
  
  if (accessData) {
    accessData.revoked = true;
    accessData.revokedAt = new Date();
    accessData.revokeType = revokeType;
    
    console.log(`🔒 Temporary Access Revoked (${revokeType}):`, accessId);
    
    // ลบออกจาก memory หลัง revoke
    setTimeout(() => {
      temporaryAccess.delete(accessId);
    }, 5 * 60 * 1000); // เก็บไว้ 5 นาทีเพื่อ audit
  }
}

/**
 * รับรายการ Temporary Access ทั้งหมด (สำหรับ Admin)
 * @returns {array} - รายการ access ทั้งหมด
 */
function getAllTemporaryAccess() {
  return Array.from(temporaryAccess.values());
}

/**
 * ตรวจสอบว่าเกิน Rate Limit หรือไม่
 * @param {string} userId - User ID
 * @param {number} limit - จำนวนครั้งที่อนุญาต (default: 10 ครั้ง/วัน)
 * @returns {boolean} - true ถ้าเกิน limit
 */
function checkRateLimit(userId, limit = 10) {
  const today = new Date().toDateString();
  const userAccess = Array.from(temporaryAccess.values()).filter(
    access => access.userId === userId && 
              new Date(access.grantedAt).toDateString() === today
  );
  
  return userAccess.length >= limit;
}

/**
 * สร้าง Emergency Access
 * @param {object} params - { userId, targetUserId, reason, emergencyType, accessFields }
 * @returns {object} - Access data
 */
function grantEmergencyAccess({ userId, targetUserId, reason, emergencyType, accessFields = [] }) {
  // Emergency Access = 2 ชั่วโมง
  const duration = 2 * 60 * 60 * 1000;
  
  const accessData = grantTemporaryAccess({
    userId,
    targetUserId,
    reason: `[EMERGENCY: ${emergencyType}] ${reason}`,
    type: 'emergency_access',
    duration,
    accessFields
  });
  
  console.log(`🚨 Emergency Access Granted:`, accessData);
  
  return accessData;
}

/**
 * ทำความสะอาด Expired Access
 */
function cleanupExpiredAccess() {
  const now = new Date();
  let cleaned = 0;
  
  for (const [accessId, accessData] of temporaryAccess.entries()) {
    if (new Date(accessData.expiresAt) < now || accessData.revoked) {
      temporaryAccess.delete(accessId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired temporary access`);
  }
}

// ทำความสะอาดทุก 1 ชั่วโมง
setInterval(cleanupExpiredAccess, 60 * 60 * 1000);

module.exports = {
  grantTemporaryAccess,
  checkTemporaryAccess,
  revokeTemporaryAccess,
  getAllTemporaryAccess,
  checkRateLimit,
  grantEmergencyAccess,
  cleanupExpiredAccess
};
