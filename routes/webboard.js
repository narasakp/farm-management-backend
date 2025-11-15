/**
 * Webboard (Q&A Forum) API Routes - PostgreSQL Version
 * กระทู้ ถาม-ตอบ
 * 
 * INSTRUCTIONS: 
 * 1. Backup your current webboard.js: 
 *    cp routes/webboard.js routes/webboard.sqlite.backup.js
 * 
 * 2. Combine all parts:
 *    cat webboard_postgresql_PART*.js > webboard_full.js
 * 
 * 3. Replace old file:
 *    mv webboard_full.js routes/webboard.js
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { updateUserStats } = require('./user_profile');
const { extractMentions, renderMentions } = require('../utils/mention_parser');
const ActivityTracker = require('../utils/activity_tracker');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Helper: Create notification
async function createNotification(userId, type, title, message, relatedId = null) {
  try {
    const id = uuidv4();
    const query = `
      INSERT INTO notifications (id, user_id, type, title, message, related_id, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, false, CURRENT_TIMESTAMP)
    `;
    
    await pool.query(query, [id, userId, type, title, message, relatedId]);
    console.log(`✅ Notification created for user ${userId}: ${title}`);
  } catch (err) {
    console.error('❌ Error creating notification:', err);
  }
}

// Middleware: Check if user is banned
async function checkBanStatus(req, res, next) {
  const userId = req.body.authorId || req.body.userId;
  
  if (!userId) {
    return next();
  }

  try {
    const query = `
      SELECT * FROM user_bans 
      WHERE user_id = $1 AND is_active = true
      AND (ban_until IS NULL OR ban_until > CURRENT_TIMESTAMP)
    `;

    const result = await pool.query(query, [userId]);
    const ban = result.rows[0];

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
  } catch (err) {
    console.error('Error checking ban status:', err);
    return next();
  }
}

// Helper: Process mentions for threads
async function processMentionsForThread(threadId, content, mentionedById, mentionedByUsername) {
  const mentions = extractMentions(content);
  if (mentions.length === 0) return;

  try {
    // Get user IDs for mentioned usernames
    const placeholders = mentions.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT id, username FROM users WHERE username IN (${placeholders})`,
      mentions
    );
    const users = result.rows;

    if (!users || users.length === 0) return;

    // Insert mentions
    const insertQuery = `
      INSERT INTO thread_mentions 
      (thread_id, mentioned_user_id, mentioned_username, mentioned_by_id, mentioned_by_username)
      VALUES ($1, $2, $3, $4, $5)
    `;

    for (const user of users) {
      try {
        await pool.query(insertQuery, [threadId, user.id, user.username, mentionedById, mentionedByUsername]);
        
        // Create notification
        await createNotification(
          user.id,
          'mention',
          '💬 คุณถูก Mention',
          `${mentionedByUsername} ได้กล่าวถึงคุณในกระทู้`,
          threadId
        );
      } catch (err) {
        console.error('Error saving mention:', err);
      }
    }
  } catch (err) {
    console.error('Error processing mentions:', err);
  }
}

// Helper: Process mentions for replies
async function processMentionsForReply(replyId, threadId, content, mentionedById, mentionedByUsername) {
  const mentions = extractMentions(content);
  if (mentions.length === 0) return;

  try {
    // Get user IDs for mentioned usernames
    const placeholders = mentions.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT id, username FROM users WHERE username IN (${placeholders})`,
      mentions
    );
    const users = result.rows;

    if (!users || users.length === 0) return;

    // Insert mentions
    const insertQuery = `
      INSERT INTO reply_mentions 
      (reply_id, thread_id, mentioned_user_id, mentioned_username, mentioned_by_id, mentioned_by_username)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    for (const user of users) {
      try {
        await pool.query(insertQuery, [replyId, threadId, user.id, user.username, mentionedById, mentionedByUsername]);
        
        // Create notification
        await createNotification(
          user.id,
          'mention',
          '💬 คุณถูก Mention',
          `${mentionedByUsername} ได้กล่าวถึงคุณในคำตอบ`,
          threadId
        );
      } catch (err) {
        console.error('Error saving mention:', err);
      }
    }
  } catch (err) {
    console.error('Error processing mentions:', err);
  }
}

// ==========================================
// ROUTES - GET ENDPOINTS
// ==========================================

// GET /api/forum/threads - ดึงรายการกระทู้ทั้งหมด
router.get('/threads', async (req, res) => {
  try {
    const { category, status, search, sort } = req.query;
    
    let query = `
      SELECT 
        t.*,
        COUNT(DISTINCT r.id) as reply_count
      FROM forum_threads t
      LEFT JOIN forum_replies r ON t.id = r.thread_id AND r.is_deleted = false
      WHERE t.is_deleted = false
    `;
    const params = [];
    let paramIndex = 1;
    
    if (category) {
      query += ` AND t.category = $${paramIndex++}`;
      params.push(category);
    }
    if (status) {
      query += ` AND t.status = $${paramIndex++}`;
      params.push(status);
    }
    if (search) {
      query += ` AND (t.title ILIKE $${paramIndex++} OR t.content ILIKE $${paramIndex++})`;
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
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      threads: result.rows
    });
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' 
    });
  }
});

// GET /api/forum/threads/:id - ดึงกระทู้พร้อม replies
router.get('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get thread
    const threadResult = await pool.query(
      'SELECT * FROM forum_threads WHERE id = $1 AND is_deleted = false',
      [id]
    );
    const thread = threadResult.rows[0];
    
    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'ไม่พบกระทู้' 
      });
    }
    
    // Update view count
    await pool.query(
      'UPDATE forum_threads SET view_count = view_count + 1 WHERE id = $1',
      [id]
    );
    
    // Get replies (exclude deleted)
    const repliesResult = await pool.query(
      'SELECT * FROM forum_replies WHERE thread_id = $1 AND is_deleted = false ORDER BY level ASC, created_at ASC',
      [id]
    );
    
    res.json({
      success: true,
      thread: thread,
      replies: repliesResult.rows || []
    });
  } catch (error) {
    console.error('Get thread detail error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// GET /api/forum/bookmarks - Get user's bookmarked threads
router.get('/bookmarks', async (req, res) => {
  try {
    const { userId } = req.query;
    
    const result = await pool.query(
      `SELECT t.*, COUNT(DISTINCT r.id) as reply_count
       FROM forum_bookmarks b
       JOIN forum_threads t ON b.thread_id = t.id
       LEFT JOIN forum_replies r ON t.id = r.thread_id
       WHERE b.user_id = $1
       GROUP BY t.id, b.created_at
       ORDER BY b.created_at DESC`,
      [userId]
    );
    
    res.json({ success: true, threads: result.rows });
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/threads/:id/status - Get user's bookmark/follow status
router.get('/threads/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    // Check bookmark
    const bookmarkResult = await pool.query(
      'SELECT id FROM forum_bookmarks WHERE thread_id = $1 AND user_id = $2',
      [id, userId]
    );
    
    // Check follow
    const followResult = await pool.query(
      'SELECT id FROM forum_follows WHERE thread_id = $1 AND user_id = $2',
      [id, userId]
    );
    
    res.json({
      success: true,
      isBookmarked: bookmarkResult.rows.length > 0,
      isFollowing: followResult.rows.length > 0
    });
  } catch (error) {
    console.error('Get thread status error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/reports - ดูรายการรายงาน (Admin only)
router.get('/reports', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    
    const result = await pool.query(
      'SELECT * FROM forum_reports WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );

    res.json({
      success: true,
      reports: result.rows || []
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/reactions/:contentType/:contentId - ดึงรายการ reactions
router.get('/reactions/:contentType/:contentId', async (req, res) => {
  try {
    const { contentType, contentId } = req.params;

    const result = await pool.query(
      'SELECT emoji, user_id, user_name, created_at FROM forum_reactions WHERE content_type = $1 AND content_id = $2 ORDER BY created_at DESC',
      [contentType, contentId]
    );

    // Group by emoji
    const grouped = {};
    result.rows.forEach(reaction => {
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
  } catch (error) {
    console.error('Get reactions error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/stats - ดึงสถิติกระทู้ทั้งหมด
router.get('/stats', async (req, res) => {
  try {
    // Get all stats in parallel
    const [threadsCount, repliesCount, usersCount, viewsTotal, resolvedCount, recentThreads, recentReplies, topCategories] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM forum_threads'),
      pool.query('SELECT COUNT(*) as count FROM forum_replies'),
      pool.query('SELECT COUNT(DISTINCT author_id) as count FROM forum_threads'),
      pool.query('SELECT SUM(view_count) as total FROM forum_threads'),
      pool.query('SELECT COUNT(*) as count FROM forum_threads WHERE has_accepted_answer = true'),
      pool.query(`SELECT COUNT(*) as count FROM forum_threads WHERE created_at >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COUNT(*) as count FROM forum_replies WHERE created_at >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT category, COUNT(*) as count FROM forum_threads GROUP BY category ORDER BY count DESC LIMIT 5`)
    ]);

    res.json({
      success: true,
      stats: {
        totalThreads: threadsCount.rows[0]?.count || 0,
        totalReplies: repliesCount.rows[0]?.count || 0,
        totalUsers: usersCount.rows[0]?.count || 0,
        totalViews: viewsTotal.rows[0]?.total || 0,
        resolvedThreads: resolvedCount.rows[0]?.count || 0,
        recentThreads: recentThreads.rows[0]?.count || 0,
        recentReplies: recentReplies.rows[0]?.count || 0,
        topCategories: topCategories.rows || []
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/threads/:id/is-following - ตรวจสอบว่าติดตามกระทู้หรือไม่
router.get('/threads/:id/is-following', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    const result = await pool.query(
      'SELECT * FROM forum_follows WHERE thread_id = $1 AND user_id = $2',
      [id, userId]
    );
    
    res.json({ 
      success: true, 
      isFollowing: result.rows.length > 0
    });
  } catch (error) {
    console.error('Check follow error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/my-followed-threads - ดึงรายการกระทู้ที่ติดตาม
router.get('/my-followed-threads', async (req, res) => {
  try {
    const { userId } = req.query;
    
    const query = `
      SELECT 
        t.*,
        COUNT(DISTINCT r.id) as reply_count
      FROM forum_threads t
      INNER JOIN forum_follows f ON t.id = f.thread_id
      LEFT JOIN forum_replies r ON t.id = r.thread_id
      WHERE f.user_id = $1 AND t.is_deleted = false
      GROUP BY t.id
      ORDER BY t.updated_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    
    const threads = result.rows.map(row => ({
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : []
    }));
    
    res.json({ success: true, threads });
  } catch (error) {
    console.error('Get followed threads error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/forum/mentions/:userId - ดึงรายการ mentions ของ user
router.get('/mentions/:userId', async (req, res) => {
  const { userId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  console.log(`📬 GET /api/forum/mentions/${userId}`);

  try {
    // Get thread mentions
    const threadQuery = `
      SELECT 
        tm.*,
        t.title as thread_title,
        t.category as thread_category,
        'thread' as type
      FROM thread_mentions tm
      LEFT JOIN forum_threads t ON tm.thread_id = t.id
      WHERE tm.mentioned_user_id = $1
      ORDER BY tm.created_at DESC
    `;

    // Get reply mentions
    const replyQuery = `
      SELECT 
        rm.*,
        t.title as thread_title,
        t.category as thread_category,
        'reply' as type
      FROM reply_mentions rm
      LEFT JOIN forum_threads t ON rm.thread_id = t.id
      WHERE rm.mentioned_user_id = $1
      ORDER BY rm.created_at DESC
    `;

    const [threadResult, replyResult] = await Promise.all([
      pool.query(threadQuery, [userId]),
      pool.query(replyQuery, [userId])
    ]);

    // Combine and sort by created_at
    const allMentions = [
      ...threadResult.rows,
      ...replyResult.rows
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
     .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      success: true,
      mentions: allMentions,
      total: threadResult.rows.length + replyResult.rows.length,
    });
  } catch (error) {
    console.error('Get mentions error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// GET /api/forum/users/search - ค้นหา users สำหรับ autocomplete
router.get('/users/search', async (req, res) => {
  const { q, limit = 10 } = req.query;

  if (!q || q.length < 2) {
    return res.json({
      success: true,
      users: [],
    });
  }

  console.log(`🔍 GET /api/forum/users/search?q=${q}`);

  try {
    const query = `
      SELECT id, username, full_name, avatar_url
      FROM users
      WHERE username ILIKE $1 OR full_name ILIKE $2
      ORDER BY username ASC
      LIMIT $3
    `;

    const searchTerm = `%${q}%`;
    const result = await pool.query(query, [searchTerm, searchTerm, parseInt(limit)]);

    res.json({
      success: true,
      users: result.rows || [],
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// GET /api/forum/activities/:userId - ดึงรายการ activities ของ user
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

// GET /api/forum/activities/feed/public - ดึง public activity feed
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

// GET /api/forum/activities/stats/:userId - ดึงสถิติ activities
router.get('/activities/stats/:userId', async (req, res) => {
  const { userId } = req.params;

  console.log(`📊 GET /api/forum/activities/stats/${userId}`);

  try {
    const query = `
      SELECT 
        activity_type,
        COUNT(*) as count
      FROM user_activities
      WHERE user_id = $1
      GROUP BY activity_type
    `;

    const result = await pool.query(query, [userId]);

    // Convert to object
    const statsObj = {};
    result.rows.forEach(stat => {
      statsObj[stat.activity_type] = stat.count;
    });

    res.json({
      success: true,
      stats: statsObj,
    });
  } catch (error) {
    console.error('Get activity stats error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// GET /api/forum/search/suggestions - Get search suggestions
router.get('/search/suggestions', async (req, res) => {
  const { q, limit = 5 } = req.query;

  if (!q || q.length < 2) {
    return res.json({
      success: true,
      suggestions: [],
    });
  }

  console.log(`💡 GET /api/forum/search/suggestions?q=${q}`);

  try {
    const query = `
      SELECT DISTINCT
        title,
        id,
        category
      FROM forum_threads
      WHERE title ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [`%${q}%`, parseInt(limit)]);

    res.json({
      success: true,
      suggestions: result.rows || [],
    });
  } catch (error) {
    console.error('Suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});


// ==========================================
// POST ENDPOINTS - Thread & Reply Operations
// ==========================================

// POST /api/forum/threads - สร้างกระทู้ใหม่
router.post('/threads', checkBanStatus, async (req, res) => {
  try {
    const {
      id, title, content, category, tags,
      authorId, authorName, authorAvatar,
      email, phone, attachments
    } = req.body;
    
    console.log('📝 Creating new thread:', { id, title, category, authorId });
    
    const threadId = id || `thread_${Date.now()}`;
    const tagsJson = JSON.stringify(tags || []);
    const attachmentsJson = JSON.stringify(attachments || []);
    
    const query = `
      INSERT INTO forum_threads (
        id, title, content, category, tags,
        author_id, author_name, author_avatar,
        email, phone, attachments,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', CURRENT_TIMESTAMP)
    `;
    
    await pool.query(query, [
      threadId, title, content, category, tagsJson,
      authorId, authorName, authorAvatar,
      email, phone, attachmentsJson
    ]);
    
    // Update user reputation (+5 points)
    if (authorId) {
      await updateUserStats(authorId, 'thread_created', 5);
    }
    
    // Process mentions
    await processMentionsForThread(threadId, content, authorId, authorName);
    
    // Track activity
    ActivityTracker.trackThreadCreated(authorId, authorName, threadId, title);
    
    res.status(201).json({
      success: true,
      threadId: threadId,
      message: 'สร้างกระทู้สำเร็จ'
    });
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาดในการสร้างกระทู้' 
    });
  }
});

// POST /api/forum/threads/:threadId/replies - สร้าง reply
router.post('/threads/:threadId/replies', checkBanStatus, async (req, res) => {
  try {
    const { threadId } = req.params;
    const {
      id, content, authorId, authorName, authorAvatar,
      parentReplyId, attachments
    } = req.body;
    
    console.log('💬 Creating reply:', { threadId, authorId, parentReplyId });
    
    const replyId = id || `reply_${Date.now()}`;
    const level = parentReplyId ? 1 : 0;
    const attachmentsJson = JSON.stringify(attachments || []);
    
    const query = `
      INSERT INTO forum_replies (
        id, thread_id, content, author_id, author_name, author_avatar,
        parent_reply_id, level, attachments, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
    `;
    
    await pool.query(query, [
      replyId, threadId, content, authorId, authorName, authorAvatar,
      parentReplyId, level, attachmentsJson
    ]);
    
    // Get thread author for notification
    const threadResult = await pool.query(
      'SELECT author_id, author_name, title FROM forum_threads WHERE id = $1',
      [threadId]
    );
    const thread = threadResult.rows[0];
    
    if (thread) {
      // Notify thread author (if not self)
      if (thread.author_id !== authorId) {
        const notifTitle = parentReplyId 
          ? '💬 มีคนตอบกลับคำตอบของคุณ'
          : '💬 มีคนตอบกระทู้ของคุณ';
        const notifMessage = `${authorName} ตอบกลับในกระทู้ "${thread.title}"`;
        await createNotification(thread.author_id, 'thread_reply', notifTitle, notifMessage, threadId);
      }
      
      // Notify all followers (except self and thread author)
      const followersResult = await pool.query(
        'SELECT user_id FROM forum_follows WHERE thread_id = $1 AND notify_on_reply = true AND user_id != $2',
        [threadId, authorId]
      );
      
      for (const follower of followersResult.rows) {
        if (follower.user_id !== thread.author_id) {
          const notifTitle = '🔔 มีคำตอบใหม่ในกระทู้ที่คุณติดตาม';
          const notifMessage = `${authorName} ตอบกลับในกระทู้ "${thread.title}"`;
          await createNotification(follower.user_id, 'thread_follow', notifTitle, notifMessage, threadId);
        }
      }
      
      // If replying to another reply, notify that reply author
      if (parentReplyId) {
        const parentResult = await pool.query(
          'SELECT author_id, author_name FROM forum_replies WHERE id = $1',
          [parentReplyId]
        );
        const parentReply = parentResult.rows[0];
        
        if (parentReply && parentReply.author_id !== authorId) {
          const notifTitle = '💬 มีคนตอบกลับคำตอบของคุณ';
          const notifMessage = `${authorName} ตอบกลับคำตอบของคุณในกระทู้ "${thread.title}"`;
          await createNotification(parentReply.author_id, 'reply_reply', notifTitle, notifMessage, threadId);
        }
      }
    }
    
    // Update thread reply_count and last_reply_at
    await pool.query(
      `UPDATE forum_threads 
       SET reply_count = reply_count + 1,
           last_reply_at = CURRENT_TIMESTAMP,
           last_reply_by = $1
       WHERE id = $2`,
      [authorName, threadId]
    );
    
    // Update user reputation (+3 points)
    if (authorId) {
      await updateUserStats(authorId, 'reply_posted', 3);
    }
    
    // Process mentions
    await processMentionsForReply(replyId, threadId, content, authorId, authorName);
    
    // Track activity
    if (thread && thread.title) {
      ActivityTracker.trackReplyCreated(authorId, authorName, replyId, threadId, thread.title);
    }
    
    res.status(201).json({
      success: true,
      replyId: replyId,
      message: 'ตอบกลับสำเร็จ'
    });
  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({ 
      success: false,
      message: 'เกิดข้อผิดพลาด' 
    });
  }
});

// POST /api/forum/threads/:threadId/vote - โหวตกระทู้
router.post('/threads/:threadId/vote', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { userId, voteType } = req.body; // voteType: 'up' or 'down'
    
    // Check existing vote
    const existingResult = await pool.query(
      'SELECT * FROM forum_thread_votes WHERE thread_id = $1 AND user_id = $2',
      [threadId, userId]
    );
    const existingVote = existingResult.rows[0];
    
    if (existingVote) {
      // Update existing vote
      await pool.query(
        'UPDATE forum_thread_votes SET vote_type = $1 WHERE thread_id = $2 AND user_id = $3',
        [voteType, threadId, userId]
      );
    } else {
      // Insert new vote
      await pool.query(
        'INSERT INTO forum_thread_votes (id, thread_id, user_id, vote_type) VALUES ($1, $2, $3, $4)',
        [`vote_${Date.now()}`, threadId, userId, voteType]
      );
    }
    
    // Count votes
    const countsResult = await pool.query(
      `SELECT 
        COUNT(CASE WHEN vote_type = 'up' THEN 1 END) as up_votes,
        COUNT(CASE WHEN vote_type = 'down' THEN 1 END) as down_votes
       FROM forum_thread_votes
       WHERE thread_id = $1`,
      [threadId]
    );
    const counts = countsResult.rows[0];
    
    // Update thread
    await pool.query(
      'UPDATE forum_threads SET upvote_count = $1, downvote_count = $2 WHERE id = $3',
      [counts.up_votes || 0, counts.down_votes || 0, threadId]
    );
    
    res.json({
      success: true,
      upvoteCount: counts.up_votes || 0,
      downvoteCount: counts.down_votes || 0
    });
  } catch (error) {
    console.error('Vote thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/forum/threads/:threadId/accept-answer/:replyId - เลือกคำตอบที่ดีที่สุด
router.post('/threads/:threadId/accept-answer/:replyId', async (req, res) => {
  try {
    const { threadId, replyId } = req.params;
    
    // Update thread
    await pool.query(
      'UPDATE forum_threads SET has_accepted_answer = true, accepted_answer_id = $1, status = $2 WHERE id = $3',
      [replyId, 'answered', threadId]
    );
    
    // Get reply author and thread info for notification
    const infoResult = await pool.query(
      `SELECT r.author_id, r.author_name, t.title, t.author_name as thread_author
       FROM forum_replies r
       JOIN forum_threads t ON r.thread_id = t.id
       WHERE r.id = $1`,
      [replyId]
    );
    const info = infoResult.rows[0];
    
    if (info) {
      // Create notification for reply author
      const notifTitle = '🏆 คำตอบของคุณถูกเลือกเป็นคำตอบที่ดีที่สุด!';
      const notifMessage = `${info.thread_author} เลือกคำตอบของคุณในกระทู้ "${info.title}"`;
      await createNotification(info.author_id, 'answer_accepted', notifTitle, notifMessage, threadId);
      
      // Update user reputation (+15 points for best answer)
      await updateUserStats(info.author_id, 'best_answer', 15);
    }
    
    // Update reply
    await pool.query(
      'UPDATE forum_replies SET is_answer = true WHERE id = $1',
      [replyId]
    );
    
    res.json({
      success: true,
      message: 'เลือกคำตอบที่ดีที่สุดแล้ว'
    });
  } catch (error) {
    console.error('Accept answer error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});


// ==========================================
// PUT & DELETE ENDPOINTS - Update & Delete Operations
// ==========================================

// PUT /api/forum/threads/:id - แก้ไขกระทู้
router.put('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, tags, authorId } = req.body;
    
    console.log('✏️ Editing thread:', id);
    
    // ตรวจสอบว่ากระทู้เป็นของผู้ใช้หรือไม่
    const checkResult = await pool.query(
      'SELECT * FROM forum_threads WHERE id = $1 AND author_id = $2',
      [id, authorId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบกระทู้หรือคุณไม่มีสิทธิ์แก้ไข' 
      });
    }
    
    // อัปเดตกระทู้
    await pool.query(
      `UPDATE forum_threads 
       SET title = $1, content = $2, category = $3, tags = $4, 
           is_edited = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [title, content, category, JSON.stringify(tags || []), id]
    );
    
    res.json({ 
      success: true, 
      message: 'แก้ไขกระทู้สำเร็จ',
      threadId: id
    });
  } catch (error) {
    console.error('Update thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// DELETE /api/forum/threads/:id - ลบกระทู้ (Soft delete)
router.delete('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { authorId } = req.body;
    
    console.log('🗑️ Deleting thread:', id);
    
    // ตรวจสอบว่ากระทู้เป็นของผู้ใช้หรือไม่
    const checkResult = await pool.query(
      'SELECT * FROM forum_threads WHERE id = $1 AND author_id = $2',
      [id, authorId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบกระทู้หรือคุณไม่มีสิทธิ์ลบ' 
      });
    }
    
    // Soft delete
    await pool.query(
      `UPDATE forum_threads 
       SET is_deleted = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );
    
    res.json({ 
      success: true, 
      message: 'ลบกระทู้สำเร็จ'
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// PUT /api/forum/threads/:id/pin - ปักหมุดกระทู้ (Admin)
router.put('/threads/:id/pin', async (req, res) => {
  try {
    const { id } = req.params;
    const { isPinned } = req.body;
    
    await pool.query(
      'UPDATE forum_threads SET is_pinned = $1 WHERE id = $2',
      [isPinned ? true : false, id]
    );
    
    res.json({
      success: true,
      message: isPinned ? 'ปักหมุดกระทู้แล้ว' : 'ยกเลิกปักหมุดแล้ว'
    });
  } catch (error) {
    console.error('Pin thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// PUT /api/forum/threads/:id/lock - ล็อกกระทู้ (Admin)
router.put('/threads/:id/lock', async (req, res) => {
  try {
    const { id } = req.params;
    const { isLocked } = req.body;
    
    await pool.query(
      'UPDATE forum_threads SET is_locked = $1 WHERE id = $2',
      [isLocked ? true : false, id]
    );
    
    res.json({
      success: true,
      message: isLocked ? 'ล็อกกระทู้แล้ว' : 'ปลดล็อกกระทู้แล้ว'
    });
  } catch (error) {
    console.error('Lock thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// PUT /api/forum/replies/:id - แก้ไขคำตอบ
router.put('/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, authorId } = req.body;
    
    // ตรวจสอบว่าคำตอบเป็นของผู้ใช้หรือไม่
    const checkResult = await pool.query(
      'SELECT * FROM forum_replies WHERE id = $1 AND author_id = $2',
      [id, authorId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบคำตอบหรือคุณไม่มีสิทธิ์แก้ไข' 
      });
    }
    
    // อัปเดตคำตอบ
    await pool.query(
      `UPDATE forum_replies 
       SET content = $1, is_edited = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [content, id]
    );
    
    res.json({ 
      success: true, 
      message: 'แก้ไขคำตอบสำเร็จ',
      replyId: id
    });
  } catch (error) {
    console.error('Update reply error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// DELETE /api/forum/replies/:id - ลบคำตอบ (Soft delete)
router.delete('/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { authorId } = req.body;
    
    // ตรวจสอบว่าคำตอบเป็นของผู้ใช้หรือไม่
    const checkResult = await pool.query(
      'SELECT * FROM forum_replies WHERE id = $1 AND author_id = $2',
      [id, authorId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบคำตอบหรือคุณไม่มีสิทธิ์ลบ' 
      });
    }
    
    // Soft delete
    await pool.query(
      `UPDATE forum_replies 
       SET is_deleted = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );
    
    res.json({ 
      success: true, 
      message: 'ลบคำตอบสำเร็จ'
    });
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});


// ==========================================
// POST ENDPOINTS - Bookmark, Follow, Report, React, Search
// ==========================================

// POST /api/forum/threads/:id/bookmark - Bookmark/Unbookmark thread
router.post('/threads/:id/bookmark', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, isBookmarked } = req.body;
    
    if (isBookmarked) {
      // Add bookmark
      const bookmarkId = `bookmark_${Date.now()}`;
      await pool.query(
        'INSERT INTO forum_bookmarks (id, thread_id, user_id, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [bookmarkId, id, userId]
      );
      res.json({ success: true, message: 'บันทึกกระทู้แล้ว' });
    } else {
      // Remove bookmark
      await pool.query(
        'DELETE FROM forum_bookmarks WHERE thread_id = $1 AND user_id = $2',
        [id, userId]
      );
      res.json({ success: true, message: 'ยกเลิกการบันทึกแล้ว' });
    }
  } catch (error) {
    console.error('Bookmark error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/forum/threads/:id/follow - Follow/Unfollow thread
router.post('/threads/:id/follow', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, isFollowing } = req.body;
    
    if (isFollowing) {
      // Add follow
      const followId = `follow_${Date.now()}`;
      await pool.query(
        'INSERT INTO forum_follows (id, thread_id, user_id, notify_on_reply, created_at) VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING',
        [followId, id, userId]
      );
      res.json({ success: true, message: 'ติดตามกระทู้แล้ว' });
    } else {
      // Remove follow
      await pool.query(
        'DELETE FROM forum_follows WHERE thread_id = $1 AND user_id = $2',
        [id, userId]
      );
      res.json({ success: true, message: 'ยกเลิกการติดตามแล้ว' });
    }
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// DELETE /api/forum/threads/:id/follow - เลิกติดตามกระทู้
router.delete('/threads/:id/follow', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    await pool.query(
      'DELETE FROM forum_follows WHERE thread_id = $1 AND user_id = $2',
      [id, userId]
    );
    
    res.json({ 
      success: true, 
      message: 'เลิกติดตามกระทู้สำเร็จ',
      isFollowing: false
    });
  } catch (error) {
    console.error('Unfollow thread error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/forum/report - รายงานเนื้อหาที่ไม่เหมาะสม
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

    const reportId = uuidv4();

    await pool.query(
      `INSERT INTO forum_reports (
        id, reporter_id, reporter_name, content_type, content_id, 
        reason, description, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', CURRENT_TIMESTAMP)`,
      [reportId, reporterId, reporterName, contentType, contentId, reason, description]
    );

    // Get all moderators and admins
    const moderatorsResult = await pool.query(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'MODERATOR', 'SUPER_ADMIN')`
    );
    
    // Notify moderators
    for (const mod of moderatorsResult.rows) {
      await createNotification(
        mod.id,
        'report',
        '🚨 รายงานใหม่',
        `มีรายงาน${contentType === 'thread' ? 'กระทู้' : 'คำตอบ'}ใหม่จาก ${reporterName}`,
        reportId
      );
    }

    res.status(201).json({
      success: true,
      reportId,
      message: 'รายงานเนื้อหาสำเร็จ'
    });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/forum/react - เพิ่ม/ลบ emoji reaction
router.post('/react', async (req, res) => {
  try {
    const { contentType, contentId, userId, userName, emoji } = req.body;

    if (!contentType || !contentId || !userId || !emoji) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
    }

    // Check if reaction exists
    const existingResult = await pool.query(
      'SELECT id FROM forum_reactions WHERE content_type = $1 AND content_id = $2 AND user_id = $3 AND emoji = $4',
      [contentType, contentId, userId, emoji]
    );
    const existing = existingResult.rows[0];

    if (existing) {
      // Remove reaction
      await pool.query(
        'DELETE FROM forum_reactions WHERE id = $1',
        [existing.id]
      );

      res.json({ success: true, action: 'removed' });
    } else {
      // Add reaction
      const reactionId = uuidv4();
      await pool.query(
        `INSERT INTO forum_reactions (id, content_type, content_id, user_id, user_name, emoji, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [reactionId, contentType, contentId, userId, userName, emoji]
      );

      res.json({ success: true, action: 'added' });
    }
  } catch (error) {
    console.error('React error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/forum/search/advanced - Advanced search with FTS and filters
router.post('/search/advanced', async (req, res) => {
  const {
    query = '',
    categories = [],
    statuses = [],
    tags = [],
    authors = [],
    dateFrom = null,
    dateTo = null,
    sortBy = 'relevance',
    hasAcceptedAnswer = null,
    limit = 20,
    offset = 0,
  } = req.body;

  console.log('🔍 POST /api/forum/search/advanced');

  try {
    // Build main query
    let mainQuery = `
      SELECT DISTINCT
        ft.*,
        COUNT(DISTINCT fr.id) as reply_count
      FROM forum_threads ft
      LEFT JOIN forum_replies fr ON ft.id = fr.thread_id
      WHERE ft.is_deleted = false
    `;
    const params = [];
    let paramIndex = 1;
    let whereConditions = [];

    // Search query
    if (query && query.trim()) {
      whereConditions.push(`(ft.title ILIKE $${paramIndex} OR ft.content ILIKE $${paramIndex + 1})`);
      params.push(`%${query}%`, `%${query}%`);
      paramIndex += 2;
    }

    // Category filter
    if (categories.length > 0) {
      const categoryPlaceholders = categories.map(() => `$${paramIndex++}`).join(',');
      whereConditions.push(`ft.category IN (${categoryPlaceholders})`);
      params.push(...categories);
    }

    // Status filter
    if (statuses.length > 0) {
      const statusPlaceholders = statuses.map(() => `$${paramIndex++}`).join(',');
      whereConditions.push(`ft.status IN (${statusPlaceholders})`);
      params.push(...statuses);
    }

    // Tags filter
    if (tags.length > 0) {
      const tagConditions = tags.map(() => `ft.tags::text ILIKE $${paramIndex++}`).join(' OR ');
      whereConditions.push(`(${tagConditions})`);
      tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    // Author filter
    if (authors.length > 0) {
      const authorPlaceholders = authors.map(() => `$${paramIndex++}`).join(',');
      whereConditions.push(`ft.author_id IN (${authorPlaceholders})`);
      params.push(...authors);
    }

    // Date range filter
    if (dateFrom) {
      whereConditions.push(`ft.created_at >= $${paramIndex++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push(`ft.created_at <= $${paramIndex++}`);
      params.push(dateTo);
    }

    // Has accepted answer filter
    if (hasAcceptedAnswer !== null) {
      whereConditions.push(`ft.has_accepted_answer = $${paramIndex++}`);
      params.push(hasAcceptedAnswer);
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
        orderBy = 'ft.upvote_count DESC, ft.created_at DESC';
        break;
      default:
        orderBy = 'ft.created_at DESC';
    }

    mainQuery += ` ORDER BY ${orderBy}`;

    // Pagination
    mainQuery += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    // Execute query
    const result = await pool.query(mainQuery, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(DISTINCT ft.id) as total
      FROM forum_threads ft
      WHERE ft.is_deleted = false
    `;

    if (whereConditions.length > 0) {
      countQuery += ` AND ${whereConditions.join(' AND ')}`;
    }

    const countResult = await pool.query(countQuery, params.slice(0, -2));

    res.json({
      success: true,
      threads: result.rows,
      total: countResult.rows[0].total || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการค้นหา',
    });
  }
});

module.exports = router;
