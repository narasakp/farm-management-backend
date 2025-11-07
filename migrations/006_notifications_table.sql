-- Migration: 006_notifications_table.sql
-- Description: Create notifications table for user notifications system
-- Date: 2025-10-30

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'reply', 'mention', 'status_change', 'upvote', 'comment_reply'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- Link to feedback/comment
  related_feedback_id TEXT,
  related_reply_id TEXT,
  related_user_id TEXT, -- User who triggered the notification
  related_user_name TEXT,
  is_read INTEGER DEFAULT 0, -- 0 = unread, 1 = read
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (related_feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
  FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Create trigger to auto-delete old read notifications (optional, keep last 30 days)
-- Uncomment if you want to auto-cleanup old notifications
-- CREATE TRIGGER IF NOT EXISTS delete_old_notifications
-- AFTER INSERT ON notifications
-- BEGIN
--   DELETE FROM notifications 
--   WHERE is_read = 1 
--   AND created_at < datetime('now', '-30 days');
-- END;

-- Insert sample notification for testing
-- INSERT INTO notifications (id, user_id, type, title, message, is_read)
-- VALUES ('test_notif_1', 'admin', 'reply', 'ทดสอบการแจ้งเตือน', 'มีคนตอบกลับข้อเสนอแนะของคุณ', 0);

-- Migration completed successfully
SELECT 'Migration 006_notifications_table.sql completed successfully' AS status;
