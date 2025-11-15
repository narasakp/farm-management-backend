/**
 * User Profile & Reputation API Routes
 * สำหรับแสดงข้อมูลโปรไฟล์และคะแนนผู้ใช้
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Reputation levels and thresholds
const REPUTATION_LEVELS = {
  beginner: { min: 0, max: 99, name: 'มือใหม่', icon: '🌱' },
  member: { min: 100, max: 499, name: 'สมาชิก', icon: '👤' },
  regular: { min: 500, max: 999, name: 'สมาชิกประจำ', icon: '⭐' },
  expert: { min: 1000, max: 4999, name: 'ผู้เชี่ยวชาญ', icon: '🏆' },
  master: { min: 5000, max: 9999, name: 'ปรมาจารย์', icon: '👑' },
  legend: { min: 10000, max: Infinity, name: 'ตำนาน', icon: '💎' },
};

// Points system
const POINTS = {
  create_thread: 5,
  reply: 3,
  upvote_received: 2,
  downvote_received: -1,
  answer_accepted: 15,
  best_answer: 10,
};

// Helper: Calculate reputation level
function getReputationLevel(points) {
  for (const [level, data] of Object.entries(REPUTATION_LEVELS)) {
    if (points >= data.min && points <= data.max) {
      return { level, ...data };
    }
  }
  return { level: 'beginner', ...REPUTATION_LEVELS.beginner };
}

// Helper: Update user stats
async function updateUserStats(userId, activity, points = false) {
  try {
    // Get or create stats
    const result = await pool.query(
      'SELECT * FROM user_forum_stats WHERE user_id = $1',
      [userId]
    );
    const stats = result.rows[0];

    if (!stats) {
      // Create new stats
      await pool.query(
        `INSERT INTO user_forum_stats (user_id, reputation_points, reputation_level) 
         VALUES ($1, $2, $3)`,
        [userId, points, 'beginner']
      );
    } else {
      // Update stats
      const newPoints = (stats.reputation_points || 0) + points;
      const newLevel = getReputationLevel(newPoints).level;
      
      let updateQuery = 'UPDATE user_forum_stats SET reputation_points = $1, reputation_level = $2, updated_at = CURRENT_TIMESTAMP';
      const updateParams = [newPoints, newLevel];
      let paramIndex = 3;

      // Update specific counters
      if (activity === 'thread_created') {
        updateQuery += ', threads_created = threads_created + 1';
      } else if (activity === 'reply_posted') {
        updateQuery += ', replies_posted = replies_posted + 1';
      } else if (activity === 'answer_accepted') {
        updateQuery += ', answers_accepted = answers_accepted + 1';
      } else if (activity === 'best_answer') {
        updateQuery += ', best_answers = best_answers + 1';
      } else if (activity === 'upvote_received') {
        updateQuery += ', upvotes_received = upvotes_received + 1, votes_received = votes_received + 1';
      } else if (activity === 'downvote_received') {
        updateQuery += ', downvotes_received = downvotes_received + 1, votes_received = votes_received + 1';
      }

      updateQuery += ` WHERE user_id = $${paramIndex}`;
      updateParams.push(userId);

      await pool.query(updateQuery, updateParams);
    }

    // Log activity
    await pool.query(
      'INSERT INTO forum_activity_log (id, user_id, activity_type, points_earned, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [uuidv4(), userId, activity, points]
    );
  } catch (err) {
    console.error('Error updating user stats:', err);
  }
}

// Export helper for use in other routes
module.exports.updateUserStats = updateUserStats;

// ==========================================
// GET /api/profile/:userId
// ดึงข้อมูลโปรไฟล์ผู้ใช้
// ==========================================
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user info
    const userResult = await pool.query(
      'SELECT id, display_name, email, avatar_url, created_at FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get forum stats
    const statsResult = await pool.query(
      'SELECT * FROM user_forum_stats WHERE user_id = $1',
      [userId]
    );
    const stats = statsResult.rows[0];

    if (!stats) {
      // Return user with default stats
      const defaultStats = {
        reputation_points: 0,
        reputation_level: 'beginner',
        threads_created: 0,
        replies_posted: 0,
        answers_accepted: 0,
        best_answers: 0,
        votes_received: 0,
        upvotes_received: 0,
        downvotes_received: 0,
      };

      return res.json({
        success: true,
        user: { ...user, ...defaultStats },
        levelInfo: getReputationLevel(0),
      });
    }

    // Get badges
    const badgesResult = await pool.query(
      'SELECT * FROM user_badges WHERE user_id = $1 ORDER BY earned_at DESC',
      [userId]
    );

    const levelInfo = getReputationLevel(stats.reputation_points);

    res.json({
      success: true,
      user: { ...user, ...stats },
      badges: badgesResult.rows || [],
      levelInfo,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/profile/:userId/activity
// ดึงประวัติกิจกรรมของผู้ใช้
// ==========================================
router.get('/:userId/activity', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    const result = await pool.query(
      `SELECT * FROM forum_activity_log 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, parseInt(limit)]
    );

    res.json({
      success: true,
      activities: result.rows || [],
    });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ==========================================
// GET /api/profile/leaderboard
// ดึงอันดับผู้ใช้ท็อป
// ==========================================
router.get('/leaderboard/top', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT 
         s.*,
         u.display_name,
         u.avatar_url
       FROM user_forum_stats s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.reputation_points DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    const leaderboard = result.rows.map((user, index) => ({
      rank: index + 1,
      ...user,
      levelInfo: getReputationLevel(user.reputation_points),
    }));

    res.json({
      success: true,
      leaderboard,
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

module.exports = router;
