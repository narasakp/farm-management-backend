const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

/**
 * Log admin action to audit trail
 * @param {Object} params - Audit log parameters
 * @param {string} params.adminId - Admin user ID
 * @param {string} params.adminUsername - Admin username
 * @param {string} params.action - Action performed (create, edit, delete, approve, reject)
 * @param {string} params.resourceType - Type of resource (feedback, reply, user)
 * @param {string} params.resourceId - ID of the resource
 * @param {Object} params.details - Additional details (optional)
 * @param {string} params.ipAddress - IP address (optional)
 * @param {string} params.userAgent - User agent (optional)
 */
async function logAdminAction({
  adminId,
  adminUsername,
  action,
  resourceType,
  resourceId,
  details = null,
  ipAddress = null,
  userAgent = null
}) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const detailsJson = details ? JSON.stringify(details) : null;
    
    db.run(`
      INSERT INTO admin_audit_log (
        id, admin_id, admin_username, action, 
        resource_type, resource_id, details,
        ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      id, adminId, adminUsername, action,
      resourceType, resourceId, detailsJson,
      ipAddress, userAgent
    ], (err) => {
      db.close();
      
      if (err) {
        console.error('❌ [Audit Log] Error:', err);
        reject(err);
      } else {
        console.log(`✅ [Audit Log] ${adminUsername} ${action} ${resourceType} ${resourceId}`);
        resolve(id);
      }
    });
  });
}

/**
 * Save edit history for feedback
 */
async function saveFeedbackEditHistory({
  feedbackId,
  editedBy,
  fieldName,
  oldValue,
  newValue
}) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    db.run(`
      INSERT INTO feedback_edit_history (
        id, feedback_id, edited_by, edited_at,
        field_name, old_value, new_value
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `, [id, feedbackId, editedBy, fieldName, oldValue, newValue], (err) => {
      db.close();
      
      if (err) {
        console.error('❌ [Edit History] Error:', err);
        reject(err);
      } else {
        console.log(`📝 [Edit History] Saved: ${fieldName} changed for feedback ${feedbackId}`);
        resolve(id);
      }
    });
  });
}

/**
 * Save edit history for reply
 */
async function saveReplyEditHistory({
  replyId,
  editedBy,
  fieldName,
  oldValue,
  newValue
}) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    db.run(`
      INSERT INTO reply_edit_history (
        id, reply_id, edited_by, edited_at,
        field_name, old_value, new_value
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `, [id, replyId, editedBy, fieldName, oldValue, newValue], (err) => {
      db.close();
      
      if (err) {
        console.error('❌ [Edit History] Error:', err);
        reject(err);
      } else {
        console.log(`📝 [Edit History] Saved: ${fieldName} changed for reply ${replyId}`);
        resolve(id);
      }
    });
  });
}

/**
 * Get edit history for feedback
 */
async function getFeedbackEditHistory(feedbackId) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    db.all(`
      SELECT * FROM feedback_edit_history
      WHERE feedback_id = ?
      ORDER BY edited_at DESC
    `, [feedbackId], (err, rows) => {
      db.close();
      
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Get edit history for reply
 */
async function getReplyEditHistory(replyId) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    db.all(`
      SELECT * FROM reply_edit_history
      WHERE reply_id = ?
      ORDER BY edited_at DESC
    `, [replyId], (err, rows) => {
      db.close();
      
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Get audit logs with filters
 */
async function getAuditLogs({
  adminId = null,
  resourceType = null,
  resourceId = null,
  action = null,
  limit = 100,
  offset = 0
}) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    
    let query = 'SELECT * FROM admin_audit_log WHERE 1=1';
    const params = [];
    
    if (adminId) {
      query += ' AND admin_id = ?';
      params.push(adminId);
    }
    if (resourceType) {
      query += ' AND resource_type = ?';
      params.push(resourceType);
    }
    if (resourceId) {
      query += ' AND resource_id = ?';
      params.push(resourceId);
    }
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    db.all(query, params, (err, rows) => {
      db.close();
      
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

module.exports = {
  logAdminAction,
  saveFeedbackEditHistory,
  saveReplyEditHistory,
  getFeedbackEditHistory,
  getReplyEditHistory,
  getAuditLogs
};
