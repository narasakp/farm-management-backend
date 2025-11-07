-- ============================================
-- Feedback Enhancements Migration
-- Date: 2025-10-30
-- Features: Edit Indicator, Soft Delete, Edit History, Audit Log
-- ============================================

-- ===================================
-- 1. EDIT INDICATOR (แสดงว่าถูกแก้ไข)
-- ===================================

-- Add edit tracking to feedback
ALTER TABLE feedback ADD COLUMN edited_at TEXT;
ALTER TABLE feedback ADD COLUMN edited_by TEXT;

-- Add edit tracking to replies
ALTER TABLE feedback_replies ADD COLUMN edited_at TEXT;
ALTER TABLE feedback_replies ADD COLUMN edited_by TEXT;

-- ===================================
-- 2. SOFT DELETE (ลบแบบซ่อน)
-- ===================================

-- Add soft delete to feedback
ALTER TABLE feedback ADD COLUMN deleted_at TEXT;
ALTER TABLE feedback ADD COLUMN deleted_by TEXT;

-- Add soft delete to replies
ALTER TABLE feedback_replies ADD COLUMN deleted_at TEXT;
ALTER TABLE feedback_replies ADD COLUMN deleted_by TEXT;

-- ===================================
-- 3. EDIT HISTORY (ประวัติการแก้ไข)
-- ===================================

-- Create feedback edit history table
CREATE TABLE IF NOT EXISTS feedback_edit_history (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  field_name TEXT NOT NULL,  -- 'subject', 'message', 'status', etc.
  old_value TEXT,
  new_value TEXT,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
);

-- Create reply edit history table
CREATE TABLE IF NOT EXISTS reply_edit_history (
  id TEXT PRIMARY KEY,
  reply_id TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  field_name TEXT NOT NULL,  -- 'message'
  old_value TEXT,
  new_value TEXT,
  FOREIGN KEY (reply_id) REFERENCES feedback_replies(id) ON DELETE CASCADE
);

-- ===================================
-- 4. AUDIT LOG (บันทึก Admin Actions)
-- ===================================

-- Create admin audit log table
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'create', 'edit', 'delete', 'approve', 'reject', etc.
  resource_type TEXT NOT NULL,  -- 'feedback', 'reply', 'user', etc.
  resource_id TEXT NOT NULL,
  details TEXT,  -- JSON string with additional details
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_audit_admin_id ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON admin_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_history ON feedback_edit_history(feedback_id);
CREATE INDEX IF NOT EXISTS idx_reply_history ON reply_edit_history(reply_id);

-- ===================================
-- Verify schema
-- ===================================
PRAGMA table_info(feedback);
PRAGMA table_info(feedback_replies);
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%history%';
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%audit%';
