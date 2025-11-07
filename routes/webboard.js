/**
 * Webboard (Q&A Forum) API Routes
 * กระทู้ ถาม-ตอบ
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { updateUserStats } = require('./user_profile');
const { extractMentions, renderMentions } = require('../utils/mention_parser');
const ActivityTracker = require('../utils/activity_tracker');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

// Helper: Create notification
function createNotification(userId, type, title, message, relatedId = null) {
  const db = new sqlite3.Database(DB_PATH);
  
  const id = uuidv4();
  const query = `
    INSERT INTO notifications (id, user_id, type, title, message, related_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `;
  
  db.run(query, [id, userId, type, title, message, relatedId], (err) => {
    if (err) {
      console.error('❌ Error creating notification:', err);
    } else {
      console.log(`✅ Notification created for user ${userId}: ${title}`);
    }
    db.close();
  });
}

// Middleware: Check if user is banned
async function checkBanStatus(req, res, next) {
  const userId = req.body.authorId || req.body.userId;
  
  if (!userId) {
    return next();
  }

  const db = new sqlite3.Database(DB_PATH);
  
  const query = `
    SELECT * FROM user_bans 
    WHERE user_id = ? AND is_active = 1
    AND (ban_until IS NULL OR datetime(ban_until) > datetime('now'))
  `;

  db.get(query, [userId], (err, ban) => {
    db.close();

    if (err) {
      console.error('Error checking ban status:', err);
      return next();
    }

    if (ban) {
      const banMessage = ban.ban_until 
        ? `คุณถูกแบนจนถึง ${ban.ban_until}`
        : 'คุณถูกแบนอย่างถาวร';
      
      return res.status(403).json({
        success: false,
        message: `${banMessage}\nเหตุผล: ${ban.reason}`,
        isBanned: true,
      });
    }

    next();
  });
}

// Helper: Process mentions for threads
function processMentionsForThread(threadId, content, mentionedById, mentionedByUsername) {
  const mentions = extractMentions(content);
  if (mentions.length === 0) return;

  const db = new sqlite3.Database(DB_PATH);

  // Get user IDs for mentioned usernames
  const placeholders = mentions.map(() => '?').join(',');
  db.all(
    `SELECT id, username FROM users WHERE username IN (${placeholders})`,
    mentions,
    (err, users) => {
      if (err || !users || users.length === 0) {
        db.close();
        return;
      }

      // Insert mentions
      const insertQuery = `
        INSERT INTO thread_mentions 
        (thread_id, mentioned_user_id, mentioned_username, mentioned_by_id, mentioned_by_username)
        VALUES (?, ?, ?, ?, ?)
      `;

      users.forEach(user => {
        db.run(insertQuery, [threadId, user.id, user.username, mentionedById, mentionedByUsername], (err) => {
          if (err) {
            console.error('Error saving mention:', err);
          } else {
            // Create notification
            createNotification(
              user.id,
              'mention',
              '💬 คุณถูก Mention',
              `${mentionedByUsername} ได้กล่าวถึงคุณในกระทู้`,
              threadId
            );
          }
        });
      });

      db.close();
    }
  );
}

// Helper: Process mentions for replies
function processMentionsForReply(replyId, threadId, content, mentionedById, mentionedByUsername) {
  const mentions = extractMentions(content);
  if (mentions.length === 0) return;

  const db = new sqlite3.Database(DB_PATH);

  // Get user IDs for mentioned usernames
  const placeholders = mentions.map(() => '?').join(',');
  db.all(
    `SELECT id, username FROM users WHERE username IN (${placeholders})`,
    mentions,
    (err, users) => {
      if (err || !users || users.length === 0) {
        db.close();
        return;
      }

      // Insert mentions
      const insertQuery = `
        INSERT INTO reply_mentions 
        (reply_id, thread_id, mentioned_user_id, mentioned_username, mentioned_by_id, mentioned_by_username)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      users.forEach(user => {
        db.run(insertQuery, [replyId, threadId, user.id, user.username, mentionedById, mentionedByUsername], (err) => {
          if (err) {
            console.error('Error saving mention:', err);
          } else {
            // Create notification
            createNotification(
              user.id,
              'mention',
              '💬 คุณถูก Mention',
              `${mentionedByUsername} ได้กล่าวถึงคุณในคำตอบ`,
              threadId
            );
          }
        });
      });

      db.close();
    }
  );
}

// ==========================================
// GET /api/forum/threads
// ดึงรายการกระทู้ทั้งหมด
// ==========================================
router.get('/threads', async (req, res) => {
  try {
    const db = new sqlite3.Database(DB_PATH);
    
    const { category, status, search, sort } = req.query;
    
    let query = `
      SELECT 
        t.*,
        COUNT(DISTINCT r.id) as reply_count
      FROM forum_threads t
      LEFT JOIN forum_replies r ON t.id = r.thread_id AND r.is_deleted = 0
      WHERE t.is_deleted = 0
    `;
    const params = [];
    
    if (category) {
      query += ' AND t.category = ?';
      params.push(category);
    }
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (t.title LIKE ? OR t.content LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' GROUP BY t.id';
    
    // Sorting
    if (sort === 'oldest') {
      query += ' ORDER BY t.created_at ASC';
    } else if (sort === 'popular') {
      query += ' ORDER BY t.upvote_count DESC, t.view_count DESC';
    } else if (sort === 'unanswered') {
      query += ' ORDER BY reply_count ASC, t.created_at DESC';
    } else {
      query += ' ORDER BY t.is_pinned DESC, t.created_at DESC';
    }
    
    db.all(query, params, (err, rows) => {
      db.close();
      
      if (err) {
        console.error('Get threads error:', err);
        return res.status(500).json({ 
          success: false,
          message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' 
        });
      }
      
      res.json({
        success: true,
        threads: rows
      });
    });
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// GET /api/forum/threads/:id
// ดึงกระทู้พร้อม replies
// ==========================================
router.get('/threads/:id', async (req, res) => {
  try {
    const db = new sqlite3.Database(DB_PATH);
    const { id } = req.params;
    
    // Get thread
    db.get('SELECT * FROM forum_threads WHERE id = ? AND is_deleted = 0', [id], (err, thread) => {
      if (err) {
        db.close();
        return res.status(500).json({ 
          success: false,
          message: 'เกิดข้อผิดพลาด' 
        });
      }
      
      if (!thread) {
        db.close();
        return res.status(404).json({ 
          success: false,
          message: 'ไม่พบกระทู้' 
        });
      }
      
      // Update view count
      db.run(
        'UPDATE forum_threads SET view_count = view_count + 1 WHERE id = ?',
        [id]
      );
      
      // Get replies (exclude deleted)
      db.all(
        'SELECT * FROM forum_replies WHERE thread_id = ? AND is_deleted = 0 ORDER BY level ASC, created_at ASC',
        [id],
        (err, replies) => {
          db.close();
          
          if (err) {
            return res.status(500).json({ 
              success: false,
              message: 'เกิดข้อผิดพลาด' 
            });
          }
          
          res.json({
            success: true,
            thread: thread,
            replies: replies || []
          });
        }
      );
    });
  } catch (error) {
    console.error('Get thread detail error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// POST /api/forum/threads
// สร้างกระทู้ใหม่
// ==========================================
router.post('/threads', checkBanStatus, async (req, res) => {
  try {
    const {
      id, title, content, category, tags,
      authorId, authorName, authorAvatar,
      email, phone, attachments
    } = req.body;
    
    console.log('📝 Creating new thread:', { id, title, category, authorId });
    
    const db = new sqlite3.Database(DB_PATH);
    
    const threadId = id || `thread_${Date.now()}`;
    const tagsJson = JSON.stringify(tags || []);
    const attachmentsJson = JSON.stringify(attachments || []);
    
    const query = `
      INSERT INTO forum_threads (
        id, title, content, category, tags,
        author_id, author_name, author_avatar,
        email, phone, attachments,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))
    `;
    
    db.run(
      query,
      [
        threadId, title, content, category, tagsJson,
        authorId, authorName, authorAvatar,
        email, phone, attachmentsJson
      ],
      function(err) {
        db.close();
        
        if (err) {
          console.error('Create thread error:', err);
          return res.status(500).json({ 
            success: false,
            message: 'เกิดข้อผิดพลาดในการสร้างกระทู้' 
          });
        }
        
        // Update user reputation (+5 points)
        if (authorId) {
          updateUserStats(authorId, 'thread_created', 5);
        }
        
        // Process mentions
        processMentionsForThread(threadId, content, authorId, authorName);
        
        // Track activity
        ActivityTracker.trackThreadCreated(authorId, authorName, threadId, title);
        
        res.status(201).json({
          success: true,
          threadId: threadId,
          message: 'สร้างกระทู้สำเร็จ'
        });
      }
    );
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// POST /api/forum/threads/:threadId/replies
// สร้าง reply
// ==========================================
router.post('/threads/:threadId/replies', checkBanStatus, async (req, res) => {
  try {
    const { threadId } = req.params;
    const {
      id, content, authorId, authorName, authorAvatar,
      parentReplyId, attachments
    } = req.body;
    
    console.log('💬 Creating reply:', { threadId, authorId, parentReplyId });
    
    const db = new sqlite3.Database(DB_PATH);
    
    const replyId = id || `reply_${Date.now()}`;
    const level = parentReplyId ? 1 : 0;
    const attachmentsJson = JSON.stringify(attachments || []);
    
    const query = `
      INSERT INTO forum_replies (
        id, thread_id, content, author_id, author_name, author_avatar,
        parent_reply_id, level, attachments, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `;
    
    db.run(
      query,
      [
        replyId, threadId, content, authorId, authorName, authorAvatar,
        parentReplyId, level, attachmentsJson
      ],
      function(err) {
        if (err) {
          db.close();
          console.error('Create reply error:', err);
          return res.status(500).json({ 
            success: false,
            message: 'เกิดข้อผิดพลาด' 
          });
        }
        
        // Get thread author for notification
        db.get(
          'SELECT author_id, author_name, title FROM forum_threads WHERE id = ?',
          [threadId],
          (getErr, thread) => {
            if (!getErr && thread) {
              // Notify thread author (if not self)
              if (thread.author_id !== authorId) {
                const notifTitle = parentReplyId 
                  ? '💬 มีคนตอบกลับคำตอบของคุณ'
                  : '💬 มีคนตอบกระทู้ของคุณ';
                const notifMessage = `${authorName} ตอบกลับในกระทู้ "${thread.title}"`;
                createNotification(thread.author_id, 'thread_reply', notifTitle, notifMessage, threadId);
              }
              
              // Notify all followers (except self and thread author)
              db.all(
                'SELECT user_id FROM forum_follows WHERE thread_id = ? AND notify_on_reply = 1 AND user_id != ?',
                [threadId, authorId],
                (followErr, followers) => {
                  if (!followErr && followers) {
                    followers.forEach(follower => {
                      if (follower.user_id !== thread.author_id) {
                        const notifTitle = '🔔 มีคำตอบใหม่ในกระทู้ที่คุณติดตาม';
                        const notifMessage = `${authorName} ตอบกลับในกระทู้ "${thread.title}"`;
                        createNotification(follower.user_id, 'thread_follow', notifTitle, notifMessage, threadId);
                      }
                    });
                  }
                }
              );
            }
            
            // If replying to another reply, notify that reply author
            if (parentReplyId) {
              db.get(
                'SELECT author_id, author_name FROM forum_replies WHERE id = ?',
                [parentReplyId],
                (replyErr, parentReply) => {
                  if (!replyErr && parentReply && parentReply.author_id !== authorId) {
                    const notifTitle = '💬 มีคนตอบกลับคำตอบของคุณ';
                    const notifMessage = `${authorName} ตอบกลับคำตอบของคุณในกระทู้ "${thread.title}"`;
                    createNotification(parentReply.author_id, 'reply_reply', notifTitle, notifMessage, threadId);
                  }
                }
              );
            }
          }
        );
        
        // Update thread reply_count and last_reply_at
        db.run(
          `UPDATE forum_threads 
           SET reply_count = reply_count + 1,
               last_reply_at = datetime('now'),
               last_reply_by = ?
           WHERE id = ?`,
          [authorName, threadId],
          (updateErr) => {
            db.close();
            
            if (updateErr) {
              console.error('Update thread stats error:', updateErr);
            }
            
            // Update user reputation (+3 points)
            if (authorId) {
              updateUserStats(authorId, 'reply_posted', 3);
            }
            
            // Process mentions
            processMentionsForReply(replyId, threadId, content, authorId, authorName);
            
            // Track activity (need to get thread title)
            if (thread && thread.title) {
              ActivityTracker.trackReplyCreated(authorId, authorName, replyId, threadId, thread.title);
            }
            
            res.status(201).json({
              success: true,
              replyId: replyId,
              message: 'ตอบกลับสำเร็จ'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// POST /api/forum/threads/:threadId/vote
// โหวตกระทู้
// ==========================================
router.post('/threads/:threadId/vote', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { userId, voteType } = req.body; // voteType: 'up' or 'down'
    
    const db = new sqlite3.Database(DB_PATH);
    
    // Check existing vote
    db.get(
      'SELECT * FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?',
      [threadId, userId],
      (err, existingVote) => {
        if (err) {
          db.close();
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        if (existingVote) {
          // Update existing vote
          db.run(
            'UPDATE forum_thread_votes SET vote_type = ? WHERE thread_id = ? AND user_id = ?',
            [voteType, threadId, userId],
            (updateErr) => {
              if (updateErr) {
                db.close();
                return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
              }
              
              updateThreadVoteCount(db, threadId, res);
            }
          );
        } else {
          // Insert new vote
          db.run(
            'INSERT INTO forum_thread_votes (id, thread_id, user_id, vote_type) VALUES (?, ?, ?, ?)',
            [`vote_${Date.now()}`, threadId, userId, voteType],
            (insertErr) => {
              if (insertErr) {
                db.close();
                return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
              }
              
              updateThreadVoteCount(db, threadId, res);
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('Vote thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

function updateThreadVoteCount(db, threadId, res) {
  // Count votes
  db.get(
    `SELECT 
      SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) as up_votes,
      SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as down_votes
     FROM forum_thread_votes
     WHERE thread_id = ?`,
    [threadId],
    (countErr, counts) => {
      if (countErr) {
        db.close();
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
      }
      
      // Update thread
      db.run(
        'UPDATE forum_threads SET upvote_count = ?, downvote_count = ? WHERE id = ?',
        [counts.up_votes || 0, counts.down_votes || 0, threadId],
        (updateErr) => {
          db.close();
          
          if (updateErr) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
          }
          
          res.json({
            success: true,
            upvoteCount: counts.up_votes || 0,
            downvoteCount: counts.down_votes || 0
          });
        }
      );
    }
  );
}

// ==========================================
// POST /api/forum/threads/:threadId/accept-answer/:replyId
// เลือกคำตอบที่ดีที่สุด
// ==========================================
router.post('/threads/:threadId/accept-answer/:replyId', async (req, res) => {
  try {
    const { threadId, replyId } = req.params;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // Update thread
    db.run(
      'UPDATE forum_threads SET has_accepted_answer = 1, accepted_answer_id = ?, status = ? WHERE id = ?',
      [replyId, 'answered', threadId],
      (threadErr) => {
        if (threadErr) {
          db.close();
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        // Get reply author and thread info for notification
        db.get(
          `SELECT r.author_id, r.author_name, t.title, t.author_name as thread_author
           FROM forum_replies r
           JOIN forum_threads t ON r.thread_id = t.id
           WHERE r.id = ?`,
          [replyId],
          (getErr, info) => {
            if (!getErr && info) {
              // Create notification for reply author
              const notifTitle = '🏆 คำตอบของคุณถูกเลือกเป็นคำตอบที่ดีที่สุด!';
              const notifMessage = `${info.thread_author} เลือกคำตอบของคุณในกระทู้ "${info.title}"`;
              createNotification(info.author_id, 'answer_accepted', notifTitle, notifMessage, threadId);
              
              // Update user reputation (+15 points for best answer)
              updateUserStats(info.author_id, 'best_answer', 15);
            }
          }
        );
        
        // Update reply
        db.run(
          'UPDATE forum_replies SET is_answer = 1 WHERE id = ?',
          [replyId],
          (replyErr) => {
            db.close();
            
            if (replyErr) {
              return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
            }
            
            res.json({
              success: true,
              message: 'เลือกคำตอบที่ดีที่สุดแล้ว'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Accept answer error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// PUT /api/forum/threads/:id
// แก้ไขกระทู้
// ==========================================
router.put('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, tags } = req.body;
    
    console.log('✏️ Editing thread:', id);
    
    const db = new sqlite3.Database(DB_PATH);
    
    const tagsJson = JSON.stringify(tags || []);
    
    db.run(
      `UPDATE forum_threads 
       SET title = ?, content = ?, category = ?, tags = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [title, content, category, tagsJson, id],
      function(err) {
        db.close();
        
        if (err) {
          console.error('Edit thread error:', err);
          return res.status(500).json({ 
            success: false,
            message: 'เกิดข้อผิดพลาดในการแก้ไขกระทู้' 
          });
        }
        
        res.json({
          success: true,
          message: 'แก้ไขกระทู้สำเร็จ'
        });
      }
    );
  } catch (error) {
    console.error('Edit thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// DELETE /api/forum/threads/:id
// ลบกระทู้
// ==========================================
router.delete('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Deleting thread:', id);
    
    const db = new sqlite3.Database(DB_PATH);
    
    // Delete thread (cascade will delete replies)
    db.run(
      'DELETE FROM forum_threads WHERE id = ?',
      [id],
      function(err) {
        db.close();
        
        if (err) {
          console.error('Delete thread error:', err);
          return res.status(500).json({ 
            success: false,
            message: 'เกิดข้อผิดพลาดในการลบกระทู้' 
          });
        }
        
        res.json({
          success: true,
          message: 'ลบกระทู้สำเร็จ'
        });
      }
    );
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// ==========================================
// PUT /api/forum/threads/:id/pin
// ปักหมุดกระทู้ (Admin)
// ==========================================
router.put('/threads/:id/pin', async (req, res) => {
  try {
    const { id } = req.params;
    const { isPinned } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    db.run(
      'UPDATE forum_threads SET is_pinned = ? WHERE id = ?',
      [isPinned ? 1 : 0, id],
      function(err) {
        db.close();
        
        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        res.json({
          success: true,
          message: isPinned ? 'ปักหมุดกระทู้แล้ว' : 'ยกเลิกปักหมุดแล้ว'
        });
      }
    );
  } catch (error) {
    console.error('Pin thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// PUT /api/forum/threads/:id/lock
// ล็อกกระทู้ (Admin)
// ==========================================
router.put('/threads/:id/lock', async (req, res) => {
  try {
    const { id } = req.params;
    const { isLocked } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    db.run(
      'UPDATE forum_threads SET is_locked = ? WHERE id = ?',
      [isLocked ? 1 : 0, id],
      function(err) {
        db.close();
        
        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        res.json({
          success: true,
          message: isLocked ? 'ล็อกกระทู้แล้ว' : 'ปลดล็อกกระทู้แล้ว'
        });
      }
    );
  } catch (error) {
    console.error('Lock thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// POST /api/forum/threads/:id/bookmark
// Bookmark/Unbookmark thread
// ==========================================
router.post('/threads/:id/bookmark', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, isBookmarked } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    if (isBookmarked) {
      // Add bookmark
      const bookmarkId = `bookmark_${Date.now()}`;
      db.run(
        'INSERT INTO forum_bookmarks (id, thread_id, user_id) VALUES (?, ?, ?)',
        [bookmarkId, id, userId],
        (err) => {
          db.close();
          if (err) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
          }
          res.json({ success: true, message: 'บันทึกกระทู้แล้ว' });
        }
      );
    } else {
      // Remove bookmark
      db.run(
        'DELETE FROM forum_bookmarks WHERE thread_id = ? AND user_id = ?',
        [id, userId],
        (err) => {
          db.close();
          if (err) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
          }
          res.json({ success: true, message: 'ยกเลิกการบันทึกแล้ว' });
        }
      );
    }
  } catch (error) {
    console.error('Bookmark error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/bookmarks
// Get user's bookmarked threads
// ==========================================
router.get('/bookmarks', async (req, res) => {
  try {
    const { userId } = req.query;
    
    const db = new sqlite3.Database(DB_PATH);
    
    db.all(
      `SELECT t.*, COUNT(DISTINCT r.id) as reply_count
       FROM forum_bookmarks b
       JOIN forum_threads t ON b.thread_id = t.id
       LEFT JOIN forum_replies r ON t.id = r.thread_id
       WHERE b.user_id = ?
       GROUP BY t.id
       ORDER BY b.created_at DESC`,
      [userId],
      (err, rows) => {
        db.close();
        
        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        res.json({ success: true, threads: rows });
      }
    );
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// POST /api/forum/threads/:id/follow
// Follow/Unfollow thread
// ==========================================
router.post('/threads/:id/follow', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, isFollowing } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    if (isFollowing) {
      // Add follow
      const followId = `follow_${Date.now()}`;
      db.run(
        'INSERT INTO forum_follows (id, thread_id, user_id, notify_on_reply) VALUES (?, ?, ?, 1)',
        [followId, id, userId],
        (err) => {
          db.close();
          if (err) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
          }
          res.json({ success: true, message: 'ติดตามกระทู้แล้ว' });
        }
      );
    } else {
      // Remove follow
      db.run(
        'DELETE FROM forum_follows WHERE thread_id = ? AND user_id = ?',
        [id, userId],
        (err) => {
          db.close();
          if (err) {
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
          }
          res.json({ success: true, message: 'ยกเลิกการติดตามแล้ว' });
        }
      );
    }
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/threads/:id/status
// Get user's bookmark/follow status for thread
// ==========================================
router.get('/threads/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // Check bookmark
    db.get(
      'SELECT id FROM forum_bookmarks WHERE thread_id = ? AND user_id = ?',
      [id, userId],
      (bookmarkErr, bookmark) => {
        // Check follow
        db.get(
          'SELECT id FROM forum_follows WHERE thread_id = ? AND user_id = ?',
          [id, userId],
          (followErr, follow) => {
            db.close();
            
            res.json({
              success: true,
              isBookmarked: !!bookmark,
              isFollowing: !!follow
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Get thread status error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// POST /api/forum/report
// รายงานเนื้อหาที่ไม่เหมาะสม
// ==========================================
router.post('/report', async (req, res) => {
  try {
    const {
      reporterId,
      reporterName,
      contentType, // 'thread' or 'reply'
      contentId,
      reason,
      description
    } = req.body;

    if (!reporterId || !contentType || !contentId || !reason) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
    }

    const db = new sqlite3.Database(DB_PATH);
    const reportId = uuidv4();

    db.run(
      `INSERT INTO forum_reports (
        id, reporter_id, reporter_name, content_type, content_id, 
        reason, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [reportId, reporterId, reporterName, contentType, contentId, reason, description],
      function(err) {
        db.close();

        if (err) {
          console.error('Report creation error:', err);
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }

        res.status(201).json({
          success: true,
          reportId,
          message: 'รายงานเนื้อหาสำเร็จ'
        });
      }
    );
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/reports
// ดูรายการรายงาน (Admin only)
// ==========================================
router.get('/reports', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const db = new sqlite3.Database(DB_PATH);

    db.all(
      'SELECT * FROM forum_reports WHERE status = ? ORDER BY created_at DESC',
      [status],
      (err, reports) => {
        db.close();

        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }

        res.json({
          success: true,
          reports: reports || []
        });
      }
    );
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// POST /api/forum/react
// เพิ่ม/ลบ emoji reaction
// ==========================================
router.post('/react', async (req, res) => {
  try {
    const { contentType, contentId, userId, userName, emoji } = req.body;

    if (!contentType || !contentId || !userId || !emoji) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
    }

    const db = new sqlite3.Database(DB_PATH);

    // Check if reaction exists
    db.get(
      'SELECT id FROM forum_reactions WHERE content_type = ? AND content_id = ? AND user_id = ? AND emoji = ?',
      [contentType, contentId, userId, emoji],
      (err, existing) => {
        if (err) {
          db.close();
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }

        if (existing) {
          // Remove reaction
          db.run(
            'DELETE FROM forum_reactions WHERE id = ?',
            [existing.id],
            (deleteErr) => {
              db.close();

              if (deleteErr) {
                return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
              }

              res.json({ success: true, action: 'removed' });
            }
          );
        } else {
          // Add reaction
          const reactionId = uuidv4();
          db.run(
            `INSERT INTO forum_reactions (id, content_type, content_id, user_id, user_name, emoji)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [reactionId, contentType, contentId, userId, userName, emoji],
            (insertErr) => {
              db.close();

              if (insertErr) {
                return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
              }

              res.json({ success: true, action: 'added' });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('React error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/reactions/:contentType/:contentId
// ดึงรายการ reactions ของเนื้อหา
// ==========================================
router.get('/reactions/:contentType/:contentId', async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const db = new sqlite3.Database(DB_PATH);

    db.all(
      'SELECT emoji, user_id, user_name, created_at FROM forum_reactions WHERE content_type = ? AND content_id = ? ORDER BY created_at DESC',
      [contentType, contentId],
      (err, reactions) => {
        db.close();

        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }

        // Group by emoji
        const grouped = {};
        reactions.forEach(reaction => {
          if (!grouped[reaction.emoji]) {
            grouped[reaction.emoji] = {
              emoji: reaction.emoji,
              count: 0,
              users: []
            };
          }
          grouped[reaction.emoji].count++;
          grouped[reaction.emoji].users.push({
            userId: reaction.user_id,
            userName: reaction.user_name
          });
        });

        res.json({
          success: true,
          reactions: Object.values(grouped)
        });
      }
    );
  } catch (error) {
    console.error('Get reactions error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/stats
// ดึงสถิติกระทู้ทั้งหมด
// ==========================================
router.get('/stats', async (req, res) => {
  try {
    const db = new sqlite3.Database(DB_PATH);

    // Get total threads
    db.get('SELECT COUNT(*) as count FROM forum_threads', (err1, threadsCount) => {
      // Get total replies
      db.get('SELECT COUNT(*) as count FROM forum_replies', (err2, repliesCount) => {
        // Get total users with threads
        db.get('SELECT COUNT(DISTINCT author_id) as count FROM forum_threads', (err3, usersCount) => {
          // Get total views
          db.get('SELECT SUM(view_count) as total FROM forum_threads', (err4, viewsTotal) => {
            // Get resolved threads
            db.get('SELECT COUNT(*) as count FROM forum_threads WHERE has_accepted_answer = 1', (err5, resolvedCount) => {
              // Get recent activity (last 7 days)
              db.get(`SELECT COUNT(*) as count FROM forum_threads WHERE created_at >= datetime('now', '-7 days')`, (err6, recentThreads) => {
                db.get(`SELECT COUNT(*) as count FROM forum_replies WHERE created_at >= datetime('now', '-7 days')`, (err7, recentReplies) => {
                  // Get top categories
                  db.all(`SELECT category, COUNT(*) as count FROM forum_threads GROUP BY category ORDER BY count DESC LIMIT 5`, (err8, topCategories) => {
                    db.close();

                    res.json({
                      success: true,
                      stats: {
                        totalThreads: threadsCount?.count || 0,
                        totalReplies: repliesCount?.count || 0,
                        totalUsers: usersCount?.count || 0,
                        totalViews: viewsTotal?.total || 0,
                        resolvedThreads: resolvedCount?.count || 0,
                        recentThreads: recentThreads?.count || 0,
                        recentReplies: recentReplies?.count || 0,
                        topCategories: topCategories || []
                      }
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// PUT /api/forum/threads/:id
// แก้ไขกระทู้
// ==========================================
router.put('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, tags, authorId } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // ตรวจสอบว่ากระทู้เป็นของผู้ใช้หรือไม่
    db.get(
      'SELECT * FROM forum_threads WHERE id = ? AND author_id = ?',
      [id, authorId],
      (err, thread) => {
        if (err || !thread) {
          db.close();
          return res.status(404).json({ success: false, message: 'ไม่พบกระทู้หรือคุณไม่มีสิทธิ์แก้ไข' });
        }
        
        // อัปเดตกระทู้
        db.run(
          `UPDATE forum_threads 
           SET title = ?, content = ?, category = ?, tags = ?, 
               is_edited = 1, updated_at = datetime('now')
           WHERE id = ?`,
          [title, content, category, JSON.stringify(tags || []), id],
          function(err) {
            db.close();
            
            if (err) {
              console.error('Update thread error:', err);
              return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
            }
            
            res.json({ 
              success: true, 
              message: 'แก้ไขกระทู้สำเร็จ',
              threadId: id
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Update thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// DELETE /api/forum/threads/:id
// ลบกระทู้ (Soft delete)
// ==========================================
router.delete('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { authorId } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // ตรวจสอบว่ากระทู้เป็นของผู้ใช้หรือไม่
    db.get(
      'SELECT * FROM forum_threads WHERE id = ? AND author_id = ?',
      [id, authorId],
      (err, thread) => {
        if (err || !thread) {
          db.close();
          return res.status(404).json({ success: false, message: 'ไม่พบกระทู้หรือคุณไม่มีสิทธิ์ลบ' });
        }
        
        // Soft delete
        db.run(
          `UPDATE forum_threads 
           SET is_deleted = 1, updated_at = datetime('now')
           WHERE id = ?`,
          [id],
          function(err) {
            db.close();
            
            if (err) {
              console.error('Delete thread error:', err);
              return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
            }
            
            res.json({ 
              success: true, 
              message: 'ลบกระทู้สำเร็จ'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// PUT /api/forum/replies/:id
// แก้ไขคำตอบ
// ==========================================
router.put('/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, authorId } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // ตรวจสอบว่าคำตอบเป็นของผู้ใช้หรือไม่
    db.get(
      'SELECT * FROM forum_replies WHERE id = ? AND author_id = ?',
      [id, authorId],
      (err, reply) => {
        if (err || !reply) {
          db.close();
          return res.status(404).json({ success: false, message: 'ไม่พบคำตอบหรือคุณไม่มีสิทธิ์แก้ไข' });
        }
        
        // อัปเดตคำตอบ
        db.run(
          `UPDATE forum_replies 
           SET content = ?, is_edited = 1, updated_at = datetime('now')
           WHERE id = ?`,
          [content, id],
          function(err) {
            db.close();
            
            if (err) {
              console.error('Update reply error:', err);
              return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
            }
            
            res.json({ 
              success: true, 
              message: 'แก้ไขคำตอบสำเร็จ',
              replyId: id
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Update reply error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// DELETE /api/forum/replies/:id
// ลบคำตอบ (Soft delete)
// ==========================================
router.delete('/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { authorId } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    // ตรวจสอบว่าคำตอบเป็นของผู้ใช้หรือไม่
    db.get(
      'SELECT * FROM forum_replies WHERE id = ? AND author_id = ?',
      [id, authorId],
      (err, reply) => {
        if (err || !reply) {
          db.close();
          return res.status(404).json({ success: false, message: 'ไม่พบคำตอบหรือคุณไม่มีสิทธิ์ลบ' });
        }
        
        // Soft delete
        db.run(
          `UPDATE forum_replies 
           SET is_deleted = 1, updated_at = datetime('now')
           WHERE id = ?`,
          [id],
          function(err) {
            db.close();
            
            if (err) {
              console.error('Delete reply error:', err);
              return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
            }
            
            res.json({ 
              success: true, 
              message: 'ลบคำตอบสำเร็จ'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// POST /api/forum/threads/:id/follow
// ติดตามกระทู้
// ==========================================
router.post('/threads/:id/follow', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    const followId = uuidv4();
    
    db.run(
      `INSERT OR REPLACE INTO forum_follows (id, thread_id, user_id, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [followId, id, userId],
      function(err) {
        db.close();
        
        if (err) {
          console.error('Follow thread error:', err);
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        res.json({ 
          success: true, 
          message: 'ติดตามกระทู้สำเร็จ',
          isFollowing: true
        });
      }
    );
  } catch (error) {
    console.error('Follow thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// DELETE /api/forum/threads/:id/follow
// เลิกติดตามกระทู้
// ==========================================
router.delete('/threads/:id/follow', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    const db = new sqlite3.Database(DB_PATH);
    
    db.run(
      'DELETE FROM forum_follows WHERE thread_id = ? AND user_id = ?',
      [id, userId],
      function(err) {
        db.close();
        
        if (err) {
          console.error('Unfollow thread error:', err);
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        res.json({ 
          success: true, 
          message: 'เลิกติดตามกระทู้สำเร็จ',
          isFollowing: false
        });
      }
    );
  } catch (error) {
    console.error('Unfollow thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/threads/:id/is-following
// ตรวจสอบว่าติดตามกระทู้หรือไม่
// ==========================================
router.get('/threads/:id/is-following', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    const db = new sqlite3.Database(DB_PATH);
    
    db.get(
      'SELECT * FROM forum_follows WHERE thread_id = ? AND user_id = ?',
      [id, userId],
      (err, row) => {
        db.close();
        
        if (err) {
          console.error('Check follow error:', err);
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }
        
        res.json({ 
          success: true, 
          isFollowing: !!row
        });
      }
    );
  } catch (error) {
    console.error('Check follow error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/forum/my-followed-threads
// ดึงรายการกระทู้ที่ติดตาม
// ==========================================
router.get('/my-followed-threads', async (req, res) => {
  try {
    const { userId } = req.query;
    
    const db = new sqlite3.Database(DB_PATH);
    
    const query = `
      SELECT 
        t.*,
        COUNT(DISTINCT r.id) as reply_count
      FROM forum_threads t
      INNER JOIN forum_follows f ON t.id = f.thread_id
      LEFT JOIN forum_replies r ON t.id = r.thread_id
      WHERE f.user_id = ? AND t.is_deleted = 0
      GROUP BY t.id
      ORDER BY t.updated_at DESC
    `;
    
    db.all(query, [userId], (err, rows) => {
      db.close();
      
      if (err) {
        console.error('Get followed threads error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
      }
      
      const threads = rows.map(row => ({
        ...row,
        tags: row.tags ? JSON.parse(row.tags) : []
      }));
      
      res.json({ success: true, threads });
    });
  } catch (error) {
    console.error('Get followed threads error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// POST /api/forum/report
// รายงานกระทู้หรือคำตอบ
// ==========================================
router.post('/report', (req, res) => {
  const { contentType, contentId, reporterId, reporterName, reason, description } = req.body;

  if (!contentType || !contentId || !reporterId || !reason) {
    return res.status(400).json({
      success: false,
      message: 'กรุณากรอกข้อมูลให้ครบ',
    });
  }

  console.log(`🚨 POST /api/forum/report - ${contentType}: ${contentId}`);

  const db = new sqlite3.Database(DB_PATH);
  const reportId = uuidv4();

  const query = `
    INSERT INTO forum_reports (
      id, content_type, content_id, reporter_id, reporter_name, reason, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [reportId, contentType, contentId, reporterId, reporterName, reason, description],
    function(err) {
      if (err) {
        db.close();
        console.error('Report error:', err);
        return res.status(500).json({
          success: false,
          message: 'เกิดข้อผิดพลาด',
        });
      }

      // สร้าง notification ไปยัง moderators และ admins
      console.log(`✅ Report created: ${reportId}`);

      // Get all moderators and admins
      db.all(
        `SELECT id FROM users WHERE role IN ('ADMIN', 'MODERATOR', 'SUPER_ADMIN')`,
        [],
        (err, moderators) => {
          if (!err && moderators) {
            moderators.forEach(mod => {
              createNotification(
                mod.id,
                'report',
                '🚨 รายงานใหม่',
                `มีรายงาน${contentType === 'thread' ? 'กระทู้' : 'คำตอบ'}ใหม่จาก ${reporterName}`,
                reportId
              );
            });
          }
          db.close();
        }
      );

      res.json({
        success: true,
        message: 'รายงานสำเร็จ',
        reportId,
      });
    }
  );
});

// ==========================================
// GET /api/forum/mentions/:userId
// ดึงรายการ mentions ของ user
// ==========================================
router.get('/mentions/:userId', (req, res) => {
  const { userId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  console.log(`📬 GET /api/forum/mentions/${userId}`);

  const db = new sqlite3.Database(DB_PATH);

  // Get thread mentions
  const threadQuery = `
    SELECT 
      tm.*,
      t.title as thread_title,
      t.category as thread_category
    FROM thread_mentions tm
    LEFT JOIN forum_threads t ON tm.thread_id = t.id
    WHERE tm.mentioned_user_id = ?
    ORDER BY tm.created_at DESC
  `;

  // Get reply mentions
  const replyQuery = `
    SELECT 
      rm.*,
      t.title as thread_title,
      t.category as thread_category
    FROM reply_mentions rm
    LEFT JOIN forum_threads t ON rm.thread_id = t.id
    WHERE rm.mentioned_user_id = ?
    ORDER BY rm.created_at DESC
  `;

  db.all(threadQuery, [userId], (err1, threadMentions) => {
    if (err1) {
      db.close();
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    db.all(replyQuery, [userId], (err2, replyMentions) => {
      db.close();

      if (err2) {
        return res.status(500).json({
          success: false,
          message: 'เกิดข้อผิดพลาด',
        });
      }

      // Combine and sort by created_at
      const allMentions = [
        ...threadMentions.map(m => ({ ...m, type: 'thread' })),
        ...replyMentions.map(m => ({ ...m, type: 'reply' }))
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
       .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

      res.json({
        success: true,
        mentions: allMentions,
        total: threadMentions.length + replyMentions.length,
      });
    });
  });
});

// ==========================================
// GET /api/forum/users/search
// ค้นหา users สำหรับ autocomplete
// ==========================================
router.get('/users/search', (req, res) => {
  const { q, limit = 10 } = req.query;

  if (!q || q.length < 2) {
    return res.json({
      success: true,
      users: [],
    });
  }

  console.log(`🔍 GET /api/forum/users/search?q=${q}`);

  const db = new sqlite3.Database(DB_PATH);

  const query = `
    SELECT id, username, full_name, avatar_url
    FROM users
    WHERE username LIKE ? OR full_name LIKE ?
    ORDER BY username ASC
    LIMIT ?
  `;

  const searchTerm = `%${q}%`;

  db.all(query, [searchTerm, searchTerm, parseInt(limit)], (err, users) => {
    db.close();

    if (err) {
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      users: users || [],
    });
  });
});

// ==========================================
// GET /api/forum/activities/:userId
// ดึงรายการ activities ของ user
// ==========================================
router.get('/activities/:userId', async (req, res) => {
  const { userId } = req.params;
  const { type, limit = 50, offset = 0 } = req.query;

  console.log(`📊 GET /api/forum/activities/${userId}`);

  try {
    const activities = await ActivityTracker.getActivities(userId, {
      activityType: type || null,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      success: true,
      activities,
      count: activities.length,
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// GET /api/forum/activities/feed/public
// ดึง public activity feed (ทุกคน)
// ==========================================
router.get('/activities/feed/public', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;

  console.log('📊 GET /api/forum/activities/feed/public');

  try {
    const activities = await ActivityTracker.getPublicFeed({
      activityType: type || null,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      success: true,
      activities,
      count: activities.length,
    });
  } catch (error) {
    console.error('Error fetching public feed:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// GET /api/forum/activities/stats/:userId
// ดึงสถิติ activities ของ user
// ==========================================
router.get('/activities/stats/:userId', async (req, res) => {
  const { userId } = req.params;

  console.log(`📊 GET /api/forum/activities/stats/${userId}`);

  const db = new sqlite3.Database(DB_PATH);

  const query = `
    SELECT 
      activity_type,
      COUNT(*) as count
    FROM user_activities
    WHERE user_id = ?
    GROUP BY activity_type
  `;

  db.all(query, [userId], (err, stats) => {
    db.close();

    if (err) {
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    // Convert to object
    const statsObj = {};
    stats.forEach(stat => {
      statsObj[stat.activity_type] = stat.count;
    });

    res.json({
      success: true,
      stats: statsObj,
    });
  });
});

// ==========================================
// POST /api/forum/search/advanced
// Advanced search with FTS and filters
// ==========================================
router.post('/search/advanced', async (req, res) => {
  const {
    query = '',
    categories = [],
    statuses = [],
    tags = [],
    authors = [],
    dateFrom = null,
    dateTo = null,
    sortBy = 'relevance', // relevance, date_desc, date_asc, replies, votes
    hasAcceptedAnswer = null,
    limit = 20,
    offset = 0,
  } = req.body;

  console.log('🔍 POST /api/forum/search/advanced');
  console.log('Search query:', query);
  console.log('Filters:', { categories, statuses, tags, authors, dateFrom, dateTo, sortBy });

  const db = new sqlite3.Database(DB_PATH);

  try {
    // Build FTS query
    let ftsQuery = '';
    let whereConditions = [];
    let params = [];

    // Full-text search query
    if (query && query.trim()) {
      ftsQuery = `
        SELECT 
          t.id,
          t.rank
        FROM (
          SELECT id, rank
          FROM forum_threads_fts
          WHERE forum_threads_fts MATCH ?
          ORDER BY rank
        ) t
      `;
      params.push(query.trim());
    }

    // Build main query
    let mainQuery = `
      SELECT DISTINCT
        ft.*,
        COUNT(DISTINCT fr.id) as reply_count,
        SUM(CASE WHEN fr.is_accepted = 1 THEN 1 ELSE 0 END) as has_accepted
    `;

    if (ftsQuery) {
      mainQuery += `
        FROM forum_threads ft
        INNER JOIN (${ftsQuery}) fts ON ft.id = fts.id
      `;
    } else {
      mainQuery += `FROM forum_threads ft`;
    }

    mainQuery += `
      LEFT JOIN forum_replies fr ON ft.id = fr.thread_id
      WHERE 1=1
    `;

    // Category filter
    if (categories.length > 0) {
      whereConditions.push(`ft.category IN (${categories.map(() => '?').join(',')})`);
      params.push(...categories);
    }

    // Status filter
    if (statuses.length > 0) {
      whereConditions.push(`ft.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }

    // Tags filter (JSON array contains)
    if (tags.length > 0) {
      const tagConditions = tags.map(() => `ft.tags LIKE ?`).join(' OR ');
      whereConditions.push(`(${tagConditions})`);
      tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    // Author filter
    if (authors.length > 0) {
      whereConditions.push(`ft.author_id IN (${authors.map(() => '?').join(',')})`);
      params.push(...authors);
    }

    // Date range filter
    if (dateFrom) {
      whereConditions.push(`datetime(ft.created_at) >= datetime(?)`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push(`datetime(ft.created_at) <= datetime(?)`);
      params.push(dateTo);
    }

    // Has accepted answer filter
    if (hasAcceptedAnswer !== null) {
      if (hasAcceptedAnswer) {
        whereConditions.push(`EXISTS (SELECT 1 FROM forum_replies WHERE thread_id = ft.id AND is_accepted = 1)`);
      } else {
        whereConditions.push(`NOT EXISTS (SELECT 1 FROM forum_replies WHERE thread_id = ft.id AND is_accepted = 1)`);
      }
    }

    // Add WHERE conditions
    if (whereConditions.length > 0) {
      mainQuery += ` AND ${whereConditions.join(' AND ')}`;
    }

    // GROUP BY
    mainQuery += ` GROUP BY ft.id`;

    // Sort order
    let orderBy = '';
    switch (sortBy) {
      case 'relevance':
        orderBy = ftsQuery ? 'fts.rank' : 'ft.created_at DESC';
        break;
      case 'date_desc':
        orderBy = 'ft.created_at DESC';
        break;
      case 'date_asc':
        orderBy = 'ft.created_at ASC';
        break;
      case 'replies':
        orderBy = 'reply_count DESC, ft.created_at DESC';
        break;
      case 'votes':
        orderBy = 'ft.vote_count DESC, ft.created_at DESC';
        break;
      default:
        orderBy = 'ft.created_at DESC';
    }

    mainQuery += ` ORDER BY ${orderBy}`;

    // Pagination
    mainQuery += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // Execute query
    db.all(mainQuery, params, (err, threads) => {
      if (err) {
        console.error('Advanced search error:', err);
        db.close();
        return res.status(500).json({
          success: false,
          message: 'เกิดข้อผิดพลาดในการค้นหา',
        });
      }

      // Get total count (without pagination)
      let countQuery = `
        SELECT COUNT(DISTINCT ft.id) as total
      `;

      if (ftsQuery) {
        countQuery += `
          FROM forum_threads ft
          INNER JOIN (${ftsQuery.replace('t.rank', '1')}) fts ON ft.id = fts.id
        `;
      } else {
        countQuery += `FROM forum_threads ft`;
      }

      countQuery += ` WHERE 1=1`;

      if (whereConditions.length > 0) {
        countQuery += ` AND ${whereConditions.join(' AND ')}`;
      }

      // Remove limit and offset params for count
      const countParams = params.slice(0, -2);

      db.get(countQuery, countParams, (countErr, countResult) => {
        db.close();

        if (countErr) {
          console.error('Count query error:', countErr);
          return res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาด',
          });
        }

        res.json({
          success: true,
          threads,
          total: countResult.total || 0,
          limit,
          offset,
        });
      });
    });
  } catch (error) {
    db.close();
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// GET /api/forum/search/suggestions
// Get search suggestions (autocomplete)
// ==========================================
router.get('/search/suggestions', (req, res) => {
  const { q, limit = 5 } = req.query;

  if (!q || q.length < 2) {
    return res.json({
      success: true,
      suggestions: [],
    });
  }

  console.log(`💡 GET /api/forum/search/suggestions?q=${q}`);

  const db = new sqlite3.Database(DB_PATH);

  // Search in threads using FTS
  const query = `
    SELECT DISTINCT
      ft.title,
      ft.id,
      ft.category
    FROM forum_threads ft
    INNER JOIN forum_threads_fts fts ON ft.id = fts.id
    WHERE fts.title MATCH ?
    ORDER BY ft.created_at DESC
    LIMIT ?
  `;

  db.all(query, [`${q}*`, parseInt(limit)], (err, suggestions) => {
    db.close();

    if (err) {
      console.error('Suggestions error:', err);
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      suggestions: suggestions || [],
    });
  });
});

module.exports = router;
