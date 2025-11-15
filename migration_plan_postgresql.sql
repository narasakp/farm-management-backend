-- ========================================
-- PostgreSQL Schema for Farm Management
-- Migration from SQLite to PostgreSQL
-- ========================================

-- ==================== WEBBOARD TABLES ====================

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  tags TEXT[], -- PostgreSQL array type
  view_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  upvote_count INTEGER DEFAULT 0,
  downvote_count INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  has_accepted_answer BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS thread_replies (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  parent_reply_id TEXT REFERENCES thread_replies(id) ON DELETE CASCADE,
  upvote_count INTEGER DEFAULT 0,
  downvote_count INTEGER DEFAULT 0,
  is_accepted BOOLEAN DEFAULT false,
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS thread_votes (
  id SERIAL PRIMARY KEY,
  thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES thread_replies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote_type VARCHAR(10) NOT NULL CHECK(vote_type IN ('upvote', 'downvote')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, user_id),
  UNIQUE(reply_id, user_id)
);

CREATE TABLE IF NOT EXISTS thread_bookmarks (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS thread_follows (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_bans (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  ban_until TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS thread_attachments (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES thread_replies(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== FEEDBACK TABLES ====================

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role VARCHAR(50),
  type VARCHAR(50) NOT NULL,
  category VARCHAR(50),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'medium',
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  admin_response TEXT,
  admin_responder_id TEXT,
  admin_responder_name TEXT,
  responded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback_replies (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role VARCHAR(50),
  content TEXT NOT NULL,
  votes INTEGER DEFAULT 0,
  is_official BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback_votes (
  id SERIAL PRIMARY KEY,
  feedback_id TEXT REFERENCES feedback(id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES feedback_replies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote_type VARCHAR(10) NOT NULL CHECK(vote_type IN ('upvote', 'downvote')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(feedback_id, user_id),
  UNIQUE(reply_id, user_id)
);

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id TEXT PRIMARY KEY,
  feedback_id TEXT REFERENCES feedback(id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES feedback_replies(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100),
  uploaded_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== USER PROFILE TABLES ====================

CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY,
  threads_created INTEGER DEFAULT 0,
  replies_posted INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  solutions_accepted INTEGER DEFAULT 0,
  feedback_submitted INTEGER DEFAULT 0,
  reputation_score INTEGER DEFAULT 0,
  badges TEXT[], -- PostgreSQL array
  last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_activities (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  activity_type VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id TEXT,
  title TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== EDIT HISTORY TABLES ====================

CREATE TABLE IF NOT EXISTS feedback_edit_history (
  id SERIAL PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  editor_id TEXT NOT NULL,
  editor_name TEXT,
  old_content TEXT,
  new_content TEXT,
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  old_priority VARCHAR(20),
  new_priority VARCHAR(20),
  edit_reason TEXT,
  edited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reply_edit_history (
  id SERIAL PRIMARY KEY,
  reply_id TEXT NOT NULL REFERENCES feedback_replies(id) ON DELETE CASCADE,
  editor_id TEXT NOT NULL,
  editor_name TEXT,
  old_content TEXT,
  new_content TEXT,
  edit_reason TEXT,
  edited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== INDEXES ====================

-- Webboard indexes
CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id);
CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category);
CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_created ON threads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_replies_thread ON thread_replies(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_replies_author ON thread_replies(author_id);

-- Feedback indexes
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_replies_feedback ON feedback_replies(feedback_id);

-- User activity indexes
CREATE INDEX IF NOT EXISTS idx_user_activities_user ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created ON user_activities(created_at DESC);

-- ========================================
-- End of Migration Schema
-- ========================================
