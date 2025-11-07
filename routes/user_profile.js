/**
 * User Profile & Reputation API Routes
 * สำหรับแสดงข้อมูลโปรไฟล์และคะแนนผู้ใช้
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

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
function updateUserStats(userId, activity, points = 0) {
  const db = new sqlite3.Database(DB_PATH);
  
  // Get or create stats
  db.get(
    'SELECT * FROM user_forum_stats WHERE user_id = ?',
    [userId],
    (err, stats) => {
      if (err) {
        console.error('Error getting user stats:', err);
        db.close();
        return;
      }

      if (!stats) {
        // Create new stats
        db.run(
          `INSERT INTO user_forum_stats (user_id, reputation_points, reputation_level) 
           VALUES (?, ?, ?)`,
          [userId, points, 'beginner'],
          (insertErr) => {
            if (insertErr) {
              console.error('Error creating user stats:', insertErr);
            }
            db.close();
          }
        );
      } else {
        // Update stats
        const newPoints = (stats.reputation_points || 0) + points;
        const newLevel = getReputationLevel(newPoints).level;
        
        let updateQuery = 'UPDATE user_forum_stats SET reputation_points = ?, reputation_level = ?, updated_at = datetime(\'now\')';
        const updateParams = [newPoints, newLevel];

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

        updateQuery += ' WHERE user_id = ?';
        updateParams.push(userId);

        db.run(updateQuery, updateParams, (updateErr) => {
          if (updateErr) {
            console.error('Error updating user stats:', updateErr);
          }
          db.close();
        });
      }

      // Log activity
      const logDb = new sqlite3.Database(DB_PATH);
      logDb.run(
        'INSERT INTO forum_activity_log (id, user_id, activity_type, points_earned) VALUES (?, ?, ?, ?)',
        [uuidv4(), userId, activity, points]
      );
      logDb.close();
    }
  );
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
    const db = new sqlite3.Database(DB_PATH);

    // Get user info
    db.get(
      'SELECT id, full_name, email, avatar_url, created_at FROM users WHERE id = ?',
      [userId],
      (err, user) => {
        if (err || !user) {
          db.close();
          return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Get forum stats
        db.get(
          'SELECT * FROM user_forum_stats WHERE user_id = ?',
          [userId],
          (statsErr, stats) => {
            if (statsErr || !stats) {
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

              db.close();
              return res.json({
                success: true,
                user: { ...user, ...defaultStats },
                levelInfo: getReputationLevel(0),
              });
            }

            // Get badges
            db.all(
              'SELECT * FROM user_badges WHERE user_id = ? ORDER BY earned_at DESC',
              [userId],
              (badgesErr, badges) => {
                db.close();

                const levelInfo = getReputationLevel(stats.reputation_points);

                res.json({
                  success: true,
                  user: { ...user, ...stats },
                  badges: badges || [],
                  levelInfo,
                });
              }
            );
          }
        );
      }
    );
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
    
    const db = new sqlite3.Database(DB_PATH);

    db.all(
      `SELECT * FROM forum_activity_log 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [userId, parseInt(limit)],
      (err, activities) => {
        db.close();

        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }

        res.json({
          success: true,
          activities: activities || [],
        });
      }
    );
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
    const db = new sqlite3.Database(DB_PATH);

    db.all(
      `SELECT 
         s.*,
         u.full_name,
         u.avatar_url
       FROM user_forum_stats s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.reputation_points DESC
       LIMIT ?`,
      [parseInt(limit)],
      (err, users) => {
        db.close();

        if (err) {
          return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
        }

        const leaderboard = users.map((user, index) => ({
          rank: index + 1,
          ...user,
          levelInfo: getReputationLevel(user.reputation_points),
        }));

        res.json({
          success: true,
          leaderboard,
        });
      }
    );
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

module.exports = router;
