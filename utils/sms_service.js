/**
 * SMS Service
 * ส่ง SMS ผ่าน SMS Gateway
 */

const axios = require('axios');

/**
 * ส่ง SMS ผ่าน ThaiSMS.com (ตัวอย่าง)
 * @param {string} phone - เบอร์โทรศัพท์ (เช่น "0903599265")
 * @param {string} message - ข้อความ
 * @returns {Promise<object>} - { success: boolean, message: string }
 */
async function sendSMS(phone, message) {
  try {
    // ตรวจสอบว่ามี API Key หรือไม่
    const apiKey = process.env.SMS_API_KEY;
    const apiSecret = process.env.SMS_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      console.log('⚠️ SMS API Key not configured (using mock)');
      console.log('📱 Mock SMS to:', phone);
      console.log('📱 Message:', message);
      return {
        success: true,
        message: 'SMS sent (mock)',
        mock: true
      };
    }
    
    // ส่ง SMS จริง (ตัวอย่าง ThaiSMS.com)
    const response = await axios.post('https://api.thaisms.com/v1/send', {
      api_key: apiKey,
      api_secret: apiSecret,
      phone: phone,
      message: message
    }, {
      timeout: 10000
    });
    
    if (response.data.status === 'success') {
      console.log('✅ SMS sent successfully to:', phone);
      return {
        success: true,
        message: 'SMS sent successfully',
        sms_id: response.data.sms_id
      };
    } else {
      console.error('❌ SMS send failed:', response.data);
      return {
        success: false,
        message: 'SMS send failed',
        error: response.data.message
      };
    }
  } catch (error) {
    console.error('❌ SMS error:', error.message);
    return {
      success: false,
      message: 'SMS error',
      error: error.message
    };
  }
}

module.exports = {
  sendSMS
};
