/**
 * Feedback API Routes
 * จัดการข้อเสนอแนะและความคิดเห็น
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const path = require('path');
const {
  logAdminAction,
  saveFeedbackEditHistory,
  saveReplyEditHistory
} = require('../utils/audit_logger');
const { createNotification } = require('./notifications');

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ==========================================
// GET /api/feedback
// ดึงรายการ feedback ทั้งหมด
// ==========================================
router.get('/', async (req, res) => {
  try {
    // Using PostgreSQL pool
    
    const { userId, status, type, category } = req.query;
    
    // JOIN กับ feedback_replies เพื่อนับจำนวน replies
    // Exclude soft deleted items
    let query = `
      SELECT 
        f.*,
        COUNT(DISTINCT CASE WHEN fr.id IS NOT NULL AND fr.deleted_at IS NULL THEN fr.id END) as reply_count
      FROM feedback f
      LEFT JOIN feedback_replies fr ON f.id = fr.feedback_id
      WHERE f.deleted_at IS NULL
    `;
    const params = [];
    
    if (userId) {
      query += ' AND f.user_id = $1';
      params.push(userId);
    }
    if (status) {
      query += ' AND f.status = $2';
      params.push(status);
    }
    if (type) {
      query += ' AND f.type = $3';
      params.push(type);
    }
    if (category) {
      query += ' AND f.category = $4';
      params.push(category);
    }
    
    query += ' GROUP BY f.id ORDER BY f.created_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get feedbacks error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' 
    });
  }
});

// ==========================================
// POST /api/feedback
// สร้าง feedback ใหม่
// ==========================================
router.post('/', async (req, res) => {
  try {
    const {
      id, userId, userName, email, phone,
      type, category, subject, message,
      rating, attachments, priority, status
    } = req.body;
    
    // 🔍 DEBUG: พิมพ์ข้อมูลที่ได้รับ
    console.log('📝 POST /api/feedback - Creating new feedback:');
    console.log(`  - id: ${id}`);
    console.log(`  - userId: ${userId}`);
    console.log(`  - userName: ${userName}`);
    console.log(`  - subject: ${subject}`);
    
    // Using PostgreSQL pool
    
    await pool.query(`
      INSERT INTO feedback (
        id, user_id, user_name, email, phone,
        type, category, subject, message,
        rating, attachments, priority, status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
    `, [
      id, userId, userName, email, phone,
      type, category, subject, message,
      rating, Array.isArray(attachments) ? JSON.stringify(attachments) : attachments,
      priority, status || 'pending'
    ]);
    
    res.json({
      success: true,
      message: 'บันทึกข้อเสนอแนะสำเร็จ',
      data: { id }
    });
  } catch (error) {
    console.error('Create feedback error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' 
    });
  }
});

// ==========================================
// GET /api/feedback/hidden
// ดึงรายการ feedback และ replies ที่ถูกซ่อน (soft deleted)
// ⚠️ MUST be before /:id routes!
// ==========================================
router.get('/hidden', async (req, res) => {
  try {
    console.log('🔍 GET /api/feedback/hidden - Fetching hidden feedback');
    // Using PostgreSQL pool
    
    // ดึง feedback ที่ถูกซ่อน
    const result = await pool.query(
      `SELECT 
        f.*,
        COUNT(DISTINCT CASE WHEN fr.id IS NOT NULL AND fr.deleted_at IS NULL THEN fr.id END) as reply_count
      FROM feedback f
      LEFT JOIN feedback_replies fr ON f.id = fr.feedback_id
      WHERE f.deleted_at IS NOT NULL
      GROUP BY f.id
      ORDER BY f.deleted_at DESC`
    );
    
    console.log(`✅ Found ${result.rows.length} hidden feedback(s)`);
    console.log('📋 Hidden feedbacks:', JSON.stringify(result.rows, null, 2));
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get hidden feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล feedback ที่ซ่อน'
    });
  }
});

// ==========================================
// GET /api/feedback/hidden/replies
// ดึงรายการ replies ที่ถูกซ่อน (soft deleted)
// ⚠️ MUST be before /:id routes!
// ==========================================
router.get('/hidden/replies', async (req, res) => {
  try {
    console.log('🔍 GET /api/feedback/hidden/replies - Fetching hidden replies');
    // Using PostgreSQL pool
    
    // ดึง replies ที่ถูกซ่อน พร้อม feedback info
    const result = await pool.query(
      `SELECT 
        fr.*,
        f.subject as feedback_subject,
        f.id as feedback_id
      FROM feedback_replies fr
      JOIN feedback f ON fr.feedback_id = f.id
      WHERE fr.deleted_at IS NOT NULL
      ORDER BY fr.deleted_at DESC`
    );
    
    console.log(`✅ Found ${result.rows.length} hidden reply(s)`);
    console.log('📋 Hidden replies:', JSON.stringify(result.rows, null, 2));
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get hidden replies error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล replies ที่ซ่อน'
    });
  }
});

// ==========================================
// GET /api/feedback/audit/logs
// ดึง audit logs (SUPER_ADMIN/ADMIN only)
// ⚠️ MUST be before /:id routes!
// ==========================================
router.get('/audit/logs', async (req, res) => {
  try {
    const { adminId, resourceType, resourceId, action, limit, offset } = req.query;
    
    const logs = await getAuditLogs({
      adminId,
      resourceType,
      resourceId,
      action,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    });
    
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึง audit logs'
    });
  }
});

// ==========================================
// PUT /api/feedback/:id
// อัปเดต feedback (แก้ไขเนื้อหาหรือเปลี่ยนสถานะ)
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, message, status, adminResponse, respondedByUserName, editedBy, adminId, adminUsername } = req.body;
    
    // First, get old values for edit history
    const oldResult = await pool.query('SELECT * FROM feedback WHERE id = $1', [id]);
    const oldFeedback = oldResult.rows[0];
    
    if (!oldFeedback) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูล'
      });
    }
    
    // Build dynamic UPDATE query with proper placeholders
    let updateFields = [];
    let updateValues = [];
    let paramIndex = true;
    
    // Track if content was edited (not just status change)
    let contentEdited = false;
    const editHistory = [];
    
    if (subject !== undefined && subject !== oldFeedback.subject) {
      updateFields.push(`subject = $${paramIndex++}`);
      updateValues.push(subject);
      contentEdited = true;
      editHistory.push({ field: 'subject', oldValue: oldFeedback.subject, newValue: subject });
    }
    if (message !== undefined && message !== oldFeedback.message) {
      updateFields.push(`message = $${paramIndex++}`);
      updateValues.push(message);
      contentEdited = true;
      editHistory.push({ field: 'message', oldValue: oldFeedback.message, newValue: message });
    }
    if (status !== undefined && status !== oldFeedback.status) {
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(status);
      editHistory.push({ field: 'status', oldValue: oldFeedback.status, newValue: status });
    }
    if (adminResponse !== undefined) {
      updateFields.push(`admin_response = $${paramIndex++}`);
      updateValues.push(adminResponse);
    }
    
    // If content was edited, record edit metadata
    if (contentEdited && editedBy) {
      updateFields.push('edited_at = CURRENT_TIMESTAMP');
      updateFields.push(`edited_by = $${paramIndex++}`);
      updateValues.push(editedBy);
    }
    
    // Always update timestamp
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    
    if (updateFields.length === true) { // Only timestamp
      return res.status(400).json({
        success: false,
        message: 'ไม่มีข้อมูลที่ต้องการอัปเดต'
      });
    }
    
    updateValues.push(id); // Add id for WHERE clause
    const query = `UPDATE feedback SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`;
    
    const updateResult = await pool.query(query, updateValues);
    
    if (updateResult.rowCount === false) {
      return res.status(404).json({ 
        success: false,
        error: 'Not Found',
        message: 'ไม่พบข้อมูลที่ต้องการอัปเดต' 
      });
    }
    
    // Save edit history for each changed field
    if (editedBy && editHistory.length > 0) {
      for (const change of editHistory) {
        try {
          await saveFeedbackEditHistory({
            feedbackId: id,
            editedBy: editedBy,
            fieldName: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue
          });
        } catch (histErr) {
          console.error('Error saving edit history:', histErr);
        }
      }
    }
    
    // Log admin action
    if (adminId && adminUsername) {
      try {
        await logAdminAction({
          adminId,
          adminUsername,
          action: 'edit',
          resourceType: 'feedback',
          resourceId: id,
          details: { changes: editHistory }
        });
      } catch (auditErr) {
        console.error('Error logging audit:', auditErr);
      }
    }
    
    // 🔔 Send notification when status changes
    console.log(`🔍 DEBUG: Checking notification conditions...`);
    console.log(`  - status: ${status}, oldFeedback.status: ${oldFeedback.status}`);
    console.log(`  - status !== undefined: ${status !== undefined}`);
    console.log(`  - status !== oldFeedback.status: ${status !== oldFeedback.status}`);
    
    if (status !== undefined && status !== oldFeedback.status) {
      console.log(`✅ Status changed! Old: ${oldFeedback.status} → New: ${status}`);
      
      try {
        // Don't notify if status changed to pending (initial state)
        console.log(`  - status !== 'pending': ${status !== 'pending'}`);
        console.log(`  - oldFeedback.user_id: ${oldFeedback.user_id}`);
        
        if (status !== 'pending' && oldFeedback.user_id) {
          console.log(`🔔 Creating notification for user ${oldFeedback.user_id}...`);
          
          const statusTextMap = {
            approved: 'อนุมัติแล้ว',
            rejected: 'ปฏิเสธ',
            inProgress: 'กำลังดำเนินการ',
            resolved: 'แก้ไขแล้ว',
            closed: 'ปิดเรื่อง'
          };
          
          const notificationData = {
            userId: oldFeedback.user_id,
            type: 'status_change',
            title: 'สถานะข้อเสนอแนะเปลี่ยนแปลง',
            message: `ข้อเสนอแนะ "${oldFeedback.subject}" เปลี่ยนสถานะเป็น "${statusTextMap[status] || status}"`,
            link: `/feedback/${id}`,
            relatedFeedbackId: id,
            relatedUserId: adminId,
            relatedUserName: respondedByUserName || adminUsername
          };
          
          console.log(`📋 Notification data:`, JSON.stringify(notificationData, null, 2));
          
          const result = await createNotification(notificationData);
          console.log(`✅ Notification created successfully!`, result);
          console.log(`🔔 Notification sent to ${oldFeedback.user_id} for status change to ${status}`);
        } else {
          console.log(`⚠️ Skipped notification: status=${status}, user_id=${oldFeedback.user_id}`);
        }
      } catch (notifErr) {
        console.error('❌ Error sending notification:', notifErr);
        console.error('❌ Error stack:', notifErr.stack);
        // Don't fail the request if notification fails
      }
    } else {
      console.log(`ℹ️ No status change detected, skipping notification`);
    }
    
    res.json({
      success: true,
      message: 'อัปเดตข้อเสนอแนะสำเร็จ'
    });
  } catch (error) {
    console.error('Update feedback error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// DELETE /api/feedback/:id
// ลบ feedback (Soft Delete)
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { deletedBy, adminId, adminUsername } = req.body;
    
    // Soft delete: update deleted_at and deleted_by instead of hard delete
    const result = await pool.query(`
      UPDATE feedback 
      SET deleted_at = CURRENT_TIMESTAMP,
          deleted_by = $1
      WHERE id = $2 AND deleted_at IS NULL
    `, [deletedBy || 'unknown', id]);
    
    if (result.rowCount === false) {
      return res.status(404).json({ 
        success: false,
        error: 'Not Found',
        message: 'ไม่พบข้อมูลที่ต้องการลบ' 
      });
    }
    
    // Log admin action
    if (adminId && adminUsername) {
      try {
        await logAdminAction({
          adminId,
          adminUsername,
          action: 'delete',
          resourceType: 'feedback',
          resourceId: id,
          details: { soft_delete: true }
        });
      } catch (auditErr) {
        console.error('Error logging audit:', auditErr);
      }
    }
    
    res.json({
      success: true,
      message: 'ลบข้อเสนอแนะสำเร็จ'
    });
  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// POST /api/feedback/:feedbackId/replies
// เพิ่ม reply ใหม่
// ==========================================
router.post('/:feedbackId/replies', async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { id, userId, userName, message, parentReplyId } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อความ'
      });
    }
    
    // Get feedback info for notification
    const feedbackResult = await pool.query(
      'SELECT user_id, user_name, subject FROM feedback WHERE id = $1',
      [feedbackId]
    );
    const feedback = feedbackResult.rows[0];
    
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อเสนอแนะ'
      });
    }
    
    // Insert reply
    await pool.query(`
      INSERT INTO feedback_replies (
        id, feedback_id, user_id, user_name, message, parent_reply_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [id, feedbackId, userId, userName, message.trim(), parentReplyId || null]);
    
    // 🔔 Send notification to feedback owner (if not replying to own feedback)
    if (parentReplyId) {
      // Reply to comment - get parent reply owner
      try {
        const parentResult = await pool.query(
          'SELECT user_id, user_name FROM feedback_replies WHERE id = $1',
          [parentReplyId]
        );
        const parentReplyOwner = parentResult.rows[0];
        
        if (parentReplyOwner && parentReplyOwner.user_id !== userId) {
          await createNotification({
            userId: parentReplyOwner.user_id,
            type: 'comment_reply',
            title: 'มีคนตอบกลับความคิดเห็นของคุณ',
            message: `${userName} ตอบกลับความคิดเห็นของคุณใน "${feedback.subject}"`,
            link: `/feedback/${feedbackId}`,
            relatedFeedbackId: feedbackId,
            relatedReplyId: id,
            relatedUserId: userId,
            relatedUserName: userName
          });
          console.log(`🔔 Notification sent to ${parentReplyOwner.user_id} for comment reply`);
        }
      } catch (notifErr) {
        console.error('Error sending comment reply notification:', notifErr);
      }
    } else if (feedback.user_id && feedback.user_id !== userId) {
      // Top-level reply to feedback
      try {
        await createNotification({
          userId: feedback.user_id,
          type: 'reply',
          title: 'มีคนตอบกลับข้อเสนอแนะของคุณ',
          message: `${userName} ตอบกลับข้อเสนอแนะ "${feedback.subject}"`,
          link: `/feedback/${feedbackId}`,
          relatedFeedbackId: feedbackId,
          relatedReplyId: id,
          relatedUserId: userId,
          relatedUserName: userName
        });
        console.log(`🔔 Notification sent to ${feedback.user_id} for feedback reply`);
      } catch (notifErr) {
        console.error('Error sending feedback reply notification:', notifErr);
      }
    }
    
    res.json({
      success: true,
      message: 'ตอบกลับสำเร็จ',
      data: { id }
    });
  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด'
    });
  }
});

// ==========================================
// PUT /api/feedback/:feedbackId/replies/:replyId
// แก้ไข reply
// ==========================================
router.put('/:feedbackId/replies/:replyId', async (req, res) => {
  try {
    const { feedbackId, replyId } = req.params;
    const { message, editedBy, adminId, adminUsername } = req.body;
    
    console.log(`📝 [PUT Reply] feedbackId: ${feedbackId}, replyId: ${replyId}`);
    console.log(`📝 [PUT Reply] message: ${message}, editedBy: ${editedBy}`);
    
    if (!message || message.trim() === '') {
      console.log('❌ [PUT Reply] Empty message');
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อความ'
      });
    }
    
    // Get old value first for edit history
    const oldResult = await pool.query(
      'SELECT message FROM feedback_replies WHERE id = $1',
      [replyId]
    );
    const oldReply = oldResult.rows[0];
    
    if (!oldReply) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูล'
      });
    }
    
    const oldMessage = oldReply.message;
    
    // Build UPDATE query with edit tracking and proper placeholders
    let updateQuery = `UPDATE feedback_replies SET message = $1`;
    let updateParams = [message.trim()];
    let paramIndex = 2;
    
    if (editedBy) {
      updateQuery += `, edited_at = CURRENT_TIMESTAMP, edited_by = $${paramIndex++}`;
      updateParams.push(editedBy);
    }
    
    updateQuery += ` WHERE id = $${paramIndex}`;
    updateParams.push(replyId);
    
    const updateResult = await pool.query(updateQuery, updateParams);
    
    if (updateResult.rowCount === false) {
      console.log(`❌ [PUT Reply] No changes - replyId not found: ${replyId}`);
      return res.status(404).json({ 
        success: false,
        error: 'Not Found',
        message: 'ไม่พบข้อมูลที่ต้องการอัปเดต' 
      });
    }
    
    // Save edit history
    if (editedBy && oldMessage !== message.trim()) {
      try {
        await saveReplyEditHistory({
          replyId,
          editedBy,
          fieldName: 'message',
          oldValue: oldMessage,
          newValue: message.trim()
        });
      } catch (histErr) {
        console.error('Error saving edit history:', histErr);
      }
    }
    
    // Log admin action
    if (adminId && adminUsername) {
      try {
        await logAdminAction({
          adminId,
          adminUsername,
          action: 'edit',
          resourceType: 'reply',
          resourceId: replyId,
          details: { feedbackId }
        });
      } catch (auditErr) {
        console.error('Error logging audit:', auditErr);
      }
    }
    
    console.log(`✅ [PUT Reply] Updated successfully - ${updateResult.rowCount} row(s)`);
    res.json({
      success: true,
      message: 'แก้ไขความคิดเห็นสำเร็จ'
    });
  } catch (error) {
    console.error('Update reply error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// DELETE /api/feedback/:feedbackId/replies/:replyId
// ลบ reply
// ==========================================
router.delete('/:feedbackId/replies/:replyId', async (req, res) => {
  try {
    const { feedbackId, replyId } = req.params;
    const { deletedBy, adminId, adminUsername } = req.body;
    
    // Soft delete nested replies ก่อน (ถ้ามี)
    await pool.query(`
      UPDATE feedback_replies 
      SET deleted_at = CURRENT_TIMESTAMP,
          deleted_by = $1
      WHERE parent_reply_id = $2 AND deleted_at IS NULL
    `, [deletedBy || 'unknown', replyId]);
    
    // Soft delete reply หลัก
    const result = await pool.query(`
      UPDATE feedback_replies 
      SET deleted_at = CURRENT_TIMESTAMP,
          deleted_by = $1
      WHERE id = $2 AND deleted_at IS NULL
    `, [deletedBy || 'unknown', replyId]);
    
    if (result.rowCount === false) {
      return res.status(404).json({ 
        success: false,
        error: 'Not Found',
        message: 'ไม่พบข้อมูลที่ต้องการลบ' 
      });
    }
    
    // Log admin action
    if (adminId && adminUsername) {
      try {
        await logAdminAction({
          adminId,
          adminUsername,
          action: 'delete',
          resourceType: 'reply',
          resourceId: replyId,
          details: { feedbackId, soft_delete: true }
        });
      } catch (auditErr) {
        console.error('Error logging audit:', auditErr);
      }
    }
    
    res.json({
      success: true,
      message: 'ลบความคิดเห็นสำเร็จ'
    });
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// GET /api/feedback/:id/history
// ดึงประวัติการแก้ไข feedback
// ==========================================
const { getFeedbackEditHistory, getReplyEditHistory, getAuditLogs } = require('../utils/audit_logger');

router.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const history = await getFeedbackEditHistory(id);
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Get feedback history error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึงประวัติ'
    });
  }
});

// ==========================================
// GET /api/feedback/:feedbackId/replies/:replyId/history
// ดึงประวัติการแก้ไข reply
// ==========================================
router.get('/:feedbackId/replies/:replyId/history', async (req, res) => {
  try {
    const { replyId } = req.params;
    const history = await getReplyEditHistory(replyId);
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Get reply history error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการดึงประวัติ'
    });
  }
});

// ==========================================
// POST /api/feedback/:id/restore
// กู้คืน feedback ที่ถูกซ่อน (restore from soft delete)
// ==========================================
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const { restoredBy, adminId, adminUsername } = req.body;
    
    await pool.query(
      'UPDATE feedback SET deleted_at = NULL, deleted_by = NULL WHERE id = $1',
      [id]
    );
    
    // Log admin action
    if (adminId && adminUsername) {
      await logAdminAction({
        adminId,
        adminUsername,
        action: 'restore',
        resourceType: 'feedback',
        resourceId: id,
        details: JSON.stringify({ restoredBy })
      });
    }
    
    res.json({
      success: true,
      message: 'กู้คืนข้อเสนอแนะสำเร็จ'
    });
  } catch (error) {
    console.error('Restore feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการกู้คืนข้อมูล'
    });
  }
});

// ==========================================
// POST /api/feedback/:feedbackId/replies/:replyId/restore
// กู้คืน reply ที่ถูกซ่อน (restore from soft delete)
// ==========================================
router.post('/:feedbackId/replies/:replyId/restore', async (req, res) => {
  try {
    const { feedbackId, replyId } = req.params;
    const { restoredBy, adminId, adminUsername } = req.body;
    
    await pool.query(
      'UPDATE feedback_replies SET deleted_at = NULL, deleted_by = NULL WHERE id = $1',
      [replyId]
    );
    
    // Log admin action
    if (adminId && adminUsername) {
      await logAdminAction({
        adminId,
        adminUsername,
        action: 'restore',
        resourceType: 'reply',
        resourceId: replyId,
        details: JSON.stringify({ restoredBy, feedbackId })
      });
    }
    
    res.json({
      success: true,
      message: 'กู้คืนความคิดเห็นสำเร็จ'
    });
  } catch (error) {
    console.error('Restore reply error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'เกิดข้อผิดพลาดในการกู้คืนข้อมูล'
    });
  }
});

module.exports = router;
