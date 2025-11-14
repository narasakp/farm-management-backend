const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Shared PostgreSQL pool (DATABASE_URL must be set in environment)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// ================================
// GET NOTIFICATIONS
// ================================

// Get all notifications for current user
router.get('/', async (req, res) => {
  try {
    const userId = req.query.user_id || req.headers['x-user-id'];
    
    console.log(`📬 GET /api/notifications - userId: ${userId}`);
    
    if (!userId) {
      console.log(`❌ No userId provided`);
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    const rows = result.rows || [];

    console.log(`✅ Found ${rows.length} notifications for user ${userId}`);
    if (rows.length > 0) {
      console.log(`📋 Notifications:`, rows.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        is_read: r.is_read,
        created_at: r.created_at
      })));
    }
    
    res.json(rows);
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get unread count
router.get('/unread-count', async (req, res) => {
  try {
    const userId = req.query.user_id || req.headers['x-user-id'];
    
    console.log(`🔔 GET /api/notifications/unread-count - userId: ${userId}`);
    
    if (!userId) {
      console.log(`❌ No userId provided`);
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await pool.query(
      `SELECT COUNT(*) as count FROM notifications 
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    const count = Number(result.rows?.[0]?.count || 0);
    console.log(`✅ Unread count for user ${userId}: ${count}`);
    res.json({ unreadCount: count });
  } catch (error) {
    console.error('❌ Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// ================================
// CREATE NOTIFICATION
// ================================

router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      type,
      title,
      message,
      link,
      related_feedback_id,
      related_reply_id,
      related_user_id,
      related_user_name
    } = req.body;

    console.log(`📨 POST /api/notifications - Creating notification:`);
    console.log(`  - user_id: ${user_id}`);
    console.log(`  - type: ${type}`);
    console.log(`  - title: ${title}`);
    console.log(`  - message: ${message}`);

    // Validation
    if (!user_id || !type || !title || !message) {
      console.log(`❌ Validation failed: Missing required fields`);
      return res.status(400).json({ 
        error: 'user_id, type, title, and message are required' 
      });
    }

    const validTypes = ['reply', 'mention', 'status_change', 'upvote', 'comment_reply'];
    if (!validTypes.includes(type)) {
      console.log(`❌ Invalid type: ${type}`);
      return res.status(400).json({ 
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}` 
      });
    }

    const id = uuidv4();
    const created_at = new Date().toISOString();

    console.log(`💾 Inserting notification with id: ${id}`);

    await pool.query(
      `INSERT INTO notifications (
        id, user_id, type, title, message, link,
        related_feedback_id, related_reply_id,
        related_user_id, related_user_name,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id, user_id, type, title, message, link,
        related_feedback_id, related_reply_id,
        related_user_id, related_user_name,
        created_at
      ]
    );

    console.log(`✅ Notification created successfully! ID: ${id}`);
    res.status(201).json({ 
      id,
      message: 'Notification created successfully' 
    });
  } catch (error) {
    console.error('❌ Error creating notification:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// ================================
// UPDATE NOTIFICATION
// ================================

// Mark notification as read
router.patch('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📖 PATCH /api/notifications/${id}/read - Mark as read`);
    
    const read_at = new Date().toISOString();

    const result = await pool.query(
      `UPDATE notifications 
       SET is_read = true, read_at = $1 
       WHERE id = $2`,
      [read_at, id]
    );

    console.log(`✅ Notification ${id} marked as read (${result.rowCount} rows affected)`);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('❌ Error updating notification:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Mark all notifications as read for user
router.patch('/mark-all-read', async (req, res) => {
  try {
    const userId = req.body.user_id || req.headers['x-user-id'];
    
    console.log(`📚 PATCH /api/notifications/mark-all-read`);
    console.log(`  - Request body:`, req.body);
    console.log(`  - userId from body: ${req.body.user_id}`);
    console.log(`  - userId from header: ${req.headers['x-user-id']}`);
    console.log(`  - Final userId: ${userId}`);
    
    if (!userId) {
      console.log(`❌ No userId provided`);
      return res.status(400).json({ error: 'user_id is required' });
    }

    const read_at = new Date().toISOString();

    const result = await pool.query(
      `UPDATE notifications 
       SET is_read = true, read_at = $1 
       WHERE user_id = $2 AND is_read = false`,
      [read_at, userId]
    );

    console.log(`✅ All notifications marked as read for user ${userId} (${result.rowCount} rows affected)`);
    res.json({ 
      message: 'All notifications marked as read',
      updated: result.rowCount
    });
  } catch (error) {
    console.error('❌ Error updating notifications:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ================================
// DELETE NOTIFICATION
// ================================

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1`,
      [id]
    );

    console.log(`🗑️ Notification ${id} deleted (${result.rowCount} rows)`);
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// ================================
// HELPER FUNCTION - Create Notification
// ================================

/**
 * Helper function to create a notification
 * Can be used by other routes
 */
async function createNotification({
  userId,
  type,
  title,
  message,
  link,
  relatedFeedbackId,
  relatedReplyId,
  relatedUserId,
  relatedUserName
}) {
  const id = uuidv4();
  const created_at = new Date().toISOString();

  await pool.query(
    `INSERT INTO notifications (
      id, user_id, type, title, message, link,
      related_feedback_id, related_reply_id,
      related_user_id, related_user_name,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, userId, type, title, message, link,
      relatedFeedbackId, relatedReplyId,
      relatedUserId, relatedUserName,
      created_at
    ]
  );

  return id;
}

// Export router and helper function
module.exports = {
  router,
  createNotification
};
