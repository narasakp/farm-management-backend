/**
 * Data Masking Utilities
 * ฟังก์ชันสำหรับปิดบังข้อมูลอ่อนไหวตาม Role
 */

/**
 * Mask เลขบัตรประชาชน 13 หลัก
 * @param {string} idCard - เลขบัตร เช่น "1301700136939"
 * @param {string} role - Role ของผู้ใช้
 * @returns {string} - เลขบัตรที่ Mask แล้ว
 */
function maskIDCard(idCard, role) {
  if (!idCard) return '-';
  
  const roleUpper = (role || '').toUpperCase();
  
  // SUPER_ADMIN, ADMIN เห็นเต็ม
  if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'ADMIN') {
    return idCard;
  }
  
  // OFFICER, RESEARCHER เห็นแบบ Masked (4 หลักแรก + *** + 4 หลักท้าย)
  if (roleUpper.includes('OFFICER') || roleUpper === 'RESEARCHER') {
    if (idCard.length < 13) return '***';
    const first4 = idCard.substring(0, 4);
    const last4 = idCard.substring(9, 13);
    return `${first4}*****${last4}`;
  }
  
  // FARMER ซ่อนทั้งหมด
  return '*************';
}

/**
 * Mask เบอร์โทรศัพท์ 10 หลัก
 * @param {string} phone - เบอร์โทร เช่น "0903599265"
 * @param {string} role - Role ของผู้ใช้
 * @returns {string} - เบอร์ที่ Mask แล้ว
 */
function maskPhoneNumber(phone, role) {
  if (!phone) return '-';
  
  const roleUpper = (role || '').toUpperCase();
  
  // SUPER_ADMIN, ADMIN เห็นเต็ม
  if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'ADMIN') {
    return phone;
  }
  
  // OFFICER, RESEARCHER เห็นแบบ Masked (6 หลักแรก + xxxx)
  if (roleUpper.includes('OFFICER') || roleUpper === 'RESEARCHER') {
    if (phone.length < 10) return 'xxx-xxx-xxxx';
    const first3 = phone.substring(0, 3);
    const next3 = phone.substring(3, 6);
    return `${first3}-${next3}-xxxx`;
  }
  
  // FARMER ซ่อนทั้งหมด
  return 'xxx-xxx-xxxx';
}

/**
 * Mask ที่อยู่
 * @param {object} address - Object ที่อยู่
 * @param {string} role - Role ของผู้ใช้
 * @returns {object} - ที่อยู่ที่ Mask แล้ว
 */
function maskAddress(address, role) {
  if (!address) return { full: '-' };
  
  const roleUpper = (role || '').toUpperCase();
  
  // SUPER_ADMIN, ADMIN เห็นเต็ม
  if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'ADMIN') {
    return address;
  }
  
  // OFFICER และ RESEARCHER ซ่อนบ้านเลขที่ (แสดง ตำบล + อำเภอ + จังหวัด + รหัสไปรษณีย์)
  if (roleUpper.includes('OFFICER') || roleUpper === 'RESEARCHER') {
    const parts = [];
    if (address.tambon) parts.push(`ตำบล${address.tambon}`);
    if (address.amphoe) parts.push(`อำเภอ${address.amphoe}`);
    if (address.province) parts.push(`จังหวัด${address.province}`);
    if (address.postal_code || address.postalCode) {
      parts.push(address.postal_code || address.postalCode);
    }
    
    return {
      ...address,
      house_number: '***',
      village: '***',
      moo: '***',
      full: parts.join(' ')
    };
  }
  
  // FARMER ซ่อนทั้งหมด
  return { full: 'ไม่มีสิทธิ์เข้าถึง' };
}

/**
 * Mask ชื่อ-นามสกุล
 * @param {string} firstName - ชื่อ
 * @param {string} lastName - นามสกุล
 * @param {string} role - Role ของผู้ใช้
 * @param {string} farmerId - ID ของเกษตรกร (สำหรับ RESEARCHER)
 * @returns {string} - ชื่อที่ Mask แล้ว
 */
function maskName(firstName, lastName, role, farmerId = null) {
  if (!firstName && !lastName) return '-';
  
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  const roleUpper = (role || '').toUpperCase();
  
  // SUPER_ADMIN, ADMIN, OFFICER, RESEARCHER เห็นเต็ม
  if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'ADMIN' || roleUpper.includes('OFFICER') || roleUpper === 'RESEARCHER') {
    return fullName;
  }
  
  // FARMER ซ่อน
  return '***';
}

/**
 * Mask GPS Location
 * @param {string} gpsLocation - GPS ในรูปแบบ "latitude,longitude" เช่น "15.636285,102.025936"
 * @param {string} role - Role ของผู้ใช้
 * @returns {string} - GPS ที่ Mask แล้ว
 */
function maskGPSLocation(gpsLocation, role) {
  if (!gpsLocation) return '-';
  
  const roleUpper = (role || '').toUpperCase();
  
  // SUPER_ADMIN, ADMIN เห็นเต็ม
  if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'ADMIN') {
    return gpsLocation;
  }
  
  // OFFICER, RESEARCHER ซ่อน (ต้อง Click-to-Reveal หรือ Emergency Access)
  if (roleUpper.includes('OFFICER') || roleUpper === 'RESEARCHER') {
    return '***.*****,***.*****';
  }
  
  // FARMER ซ่อนทั้งหมด
  return '***.*****,***.*****';
}

/**
 * ตรวจสอบว่ามีสิทธิ์ Export หรือไม่
 * @param {string} role - Role ของผู้ใช้
 * @returns {object} - { allowed: boolean, type: string }
 */
function getExportPermission(role) {
  const permissions = {
    super_admin: { allowed: true, type: 'all' },
    admin: { allowed: true, type: 'limited' },
    officer: { allowed: false, type: 'none' },
    researcher: { allowed: true, type: 'aggregated' },
    farmer: { allowed: true, type: 'own' }
  };
  
  return permissions[role] || { allowed: false, type: 'none' };
}

/**
 * Mask ข้อมูลทั้งหมดตาม Role
 * @param {object} data - ข้อมูลต้นฉบับ
 * @param {string} role - Role ของผู้ใช้
 * @returns {object} - ข้อมูลที่ Mask แล้ว
 */
function maskSensitiveData(data, role) {
  if (!data) return null;
  
  const roleUpper = (role || '').toUpperCase();
  
  return {
    ...data,
    id_card: maskIDCard(data.id_card, role),
    phone: maskPhoneNumber(data.phone, role),
    address: maskAddress(data.address, role),
    full_name: maskName(data.first_name, data.last_name, role, data.id),
    // ข้อมูลปศุสัตว์ไม่ mask
    livestock: data.livestock,
    // เพิ่มข้อมูลว่า mask หรือไม่
    _masked: roleUpper !== 'SUPER_ADMIN' && roleUpper !== 'ADMIN',
    _role: role
  };
}

module.exports = {
  maskIDCard,
  maskPhoneNumber,
  maskAddress,
  maskName,
  maskGPSLocation,
  getExportPermission,
  maskSensitiveData
};
