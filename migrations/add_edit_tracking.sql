-- Migration: Add Edit Tracking to Feedback and Replies
-- Date: 2025-10-30
-- Purpose: Track when and who edited feedback/replies

-- Add edit tracking columns to feedback table
ALTER TABLE feedback ADD COLUMN edited_at TEXT;
ALTER TABLE feedback ADD COLUMN edited_by TEXT;

-- Add edit tracking columns to feedback_replies table
ALTER TABLE feedback_replies ADD COLUMN edited_at TEXT;
ALTER TABLE feedback_replies ADD COLUMN edited_by TEXT;

-- Verify columns were added
PRAGMA table_info(feedback);
PRAGMA table_info(feedback_replies);
