const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

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

    const db = new sqlite3.Database(DB_PATH);
    
    db.all(
      `SELECT * FROM notifications 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId],
      (err, rows) => {
        db.close();
        
        if (err) {
          console.error('❌ Error fetching notifications:', err);
          return res.status(500).json({ error: 'Failed to fetch notifications' });
        }
        
        console.log(`✅ Found ${rows?.length || 0} notifications for user ${userId}`);
        if (rows && rows.length > 0) {
          console.log(`📋 Notifications:`, rows.map(r => ({
            id: r.id,
            type: r.type,
            title: r.title,
            is_read: r.is_read,
            created_at: r.created_at
          })));
        }
        
        res.json(rows || []);
      }
    );
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

    const db = new sqlite3.Database(DB_PATH);
    
    db.get(
      `SELECT COUNT(*) as count FROM notifications 
       WHERE user_id = ? AND is_read = 0`,
      [userId],
      (err, row) => {
        db.close();
        
        if (err) {
          console.error('❌ Error fetching unread count:', err);
          return res.status(500).json({ error: 'Failed to fetch unread count' });
        }
        
        console.log(`✅ Unread count for user ${userId}: ${row.count || 0}`);
        res.json({ unreadCount: row.count || 0 });
      }
    );
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
    const db = new sqlite3.Database(DB_PATH);

    console.log(`💾 Inserting notification with id: ${id}`);

    db.run(
      `INSERT INTO notifications (
        id, user_id, type, title, message, link,
        related_feedback_id, related_reply_id,
        related_user_id, related_user_name,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, user_id, type, title, message, link,
        related_feedback_id, related_reply_id,
        related_user_id, related_user_name,
        created_at
      ],
      (err) => {
        db.close();
        
        if (err) {
          console.error('❌ Error creating notification:', err);
          console.error('❌ Error stack:', err.stack);
          return res.status(500).json({ error: 'Failed to create notification' });
        }
        
        console.log(`✅ Notification created successfully! ID: ${id}`);
        res.status(201).json({ 
          id,
          message: 'Notification created successfully' 
        });
      }
    );
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
    const db = new sqlite3.Database(DB_PATH);

    db.run(
      `UPDATE notifications 
       SET is_read = 1, read_at = ? 
       WHERE id = ?`,
      [read_at, id],
      function(err) {
        db.close();
        
        if (err) {
          console.error('❌ Error updating notification:', err);
          return res.status(500).json({ error: 'Failed to update notification' });
        }
        
        console.log(`✅ Notification ${id} marked as read (${this.changes} rows affected)`);
        res.json({ message: 'Notification marked as read' });
      }
    );
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
    const db = new sqlite3.Database(DB_PATH);

    db.run(
      `UPDATE notifications 
       SET is_read = 1, read_at = ? 
       WHERE user_id = ? AND is_read = 0`,
      [read_at, userId],
      function(err) {
        db.close();
        
        if (err) {
          console.error('❌ Error updating notifications:', err);
          return res.status(500).json({ error: 'Failed to update notifications' });
        }
        
        console.log(`✅ All notifications marked as read for user ${userId} (${this.changes} rows affected)`);
        res.json({ 
          message: 'All notifications marked as read',
          updated: this.changes
        });
      }
    );
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
    const db = new sqlite3.Database(DB_PATH);

    db.run(
      `DELETE FROM notifications WHERE id = ?`,
      [id],
      (err) => {
        db.close();
        
        if (err) {
          console.error('Error deleting notification:', err);
          return res.status(500).json({ error: 'Failed to delete notification' });
        }
        
        res.json({ message: 'Notification deleted successfully' });
      }
    );
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
  const db = new sqlite3.Database(DB_PATH);

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO notifications (
        id, user_id, type, title, message, link,
        related_feedback_id, related_reply_id,
        related_user_id, related_user_name,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, userId, type, title, message, link,
        relatedFeedbackId, relatedReplyId,
        relatedUserId, relatedUserName,
        created_at
      ],
      (err) => {
        db.close();
        if (err) reject(err);
        else resolve(id);
      }
    );
  });
}

// Export router and helper function
module.exports = {
  router,
  createNotification
};
