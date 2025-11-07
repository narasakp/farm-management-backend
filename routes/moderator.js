/**
 * Moderator Routes
 * API สำหรับ Moderator และ Admin
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

// ==========================================
// GET /api/moderator/reports
// ดึงรายการรายงานทั้งหมด
// ==========================================
router.get('/reports', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  const status = req.query.status || 'pending';

  console.log(`📋 GET /api/moderator/reports - status: ${status}`);

  const query = status === 'all' 
    ? `SELECT * FROM forum_reports ORDER BY created_at DESC`
    : `SELECT * FROM forum_reports WHERE status = ? ORDER BY created_at DESC`;

  const params = status === 'all' ? [] : [status];

  db.all(query, params, (err, reports) => {
    db.close();

    if (err) {
      console.error('Get reports error:', err);
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      reports: reports || [],
    });
  });
});

// ==========================================
// POST /api/moderator/reports/:reportId/review
// ดำเนินการกับรายงาน
// ==========================================
router.post('/reports/:reportId/review', (req, res) => {
  const { reportId } = req.params;
  const { action, reviewerId } = req.body;

  console.log(`⚖️ POST /api/moderator/reports/${reportId}/review - action: ${action}`);

  const db = new sqlite3.Database(DB_PATH);

  const query = `
    UPDATE forum_reports 
    SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `;

  db.run(query, [action, reviewerId, reportId], function(err) {
    db.close();

    if (err) {
      console.error('Review report error:', err);
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      message: 'ดำเนินการสำเร็จ',
    });
  });
});

// ==========================================
// POST /api/moderator/ban-user
// แบนผู้ใช้
// ==========================================
router.post('/ban-user', (req, res) => {
  const { userId, username, bannedBy, reason, banType, banUntil } = req.body;

  if (!userId || !bannedBy || !reason) {
    return res.status(400).json({
      success: false,
      message: 'กรุณากรอกข้อมูลให้ครบ',
    });
  }

  console.log(`🚫 POST /api/moderator/ban-user - userId: ${userId}`);

  const db = new sqlite3.Database(DB_PATH);
  const banId = uuidv4();

  const query = `
    INSERT INTO user_bans (
      id, user_id, username, banned_by, reason, ban_type, ban_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    query,
    [banId, userId, username, bannedBy, reason, banType || 'temporary', banUntil],
    function(err) {
      if (err) {
        db.close();
        console.error('Ban user error:', err);
        return res.status(500).json({
          success: false,
          message: 'เกิดข้อผิดพลาด',
        });
      }

      // สร้าง notification ถ้าต้องการ
      console.log(`✅ User ${userId} banned successfully`);

      db.close();
      res.json({
        success: true,
        message: 'แบนผู้ใช้สำเร็จ',
        banId,
      });
    }
  );
});

// ==========================================
// POST /api/moderator/unban-user/:userId
// ปลดแบนผู้ใช้
// ==========================================
router.post('/unban-user/:userId', (req, res) => {
  const { userId } = req.params;
  const { unbannedBy } = req.body;

  console.log(`✅ POST /api/moderator/unban-user/${userId}`);

  const db = new sqlite3.Database(DB_PATH);

  const query = `
    UPDATE user_bans 
    SET is_active = 0, 
        unbanned_at = datetime('now'),
        unbanned_by = ?
    WHERE user_id = ? AND is_active = 1
  `;

  db.run(query, [unbannedBy, userId], function(err) {
    db.close();

    if (err) {
      console.error('Unban user error:', err);
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      message: 'ปลดแบนผู้ใช้สำเร็จ',
    });
  });
});

// ==========================================
// GET /api/moderator/banned-users
// ดึงรายการผู้ใช้ที่ถูกแบน
// ==========================================
router.get('/banned-users', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);

  console.log('📋 GET /api/moderator/banned-users');

  const query = `
    SELECT * FROM user_bans 
    WHERE is_active = 1 
    ORDER BY created_at DESC
  `;

  db.all(query, [], (err, bans) => {
    db.close();

    if (err) {
      console.error('Get banned users error:', err);
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      bans: bans || [],
    });
  });
});

// ==========================================
// GET /api/moderator/check-ban/:userId
// ตรวจสอบว่าผู้ใช้ถูกแบนหรือไม่
// ==========================================
router.get('/check-ban/:userId', (req, res) => {
  const { userId } = req.params;
  const db = new sqlite3.Database(DB_PATH);

  const query = `
    SELECT * FROM user_bans 
    WHERE user_id = ? AND is_active = 1
    AND (ban_until IS NULL OR datetime(ban_until) > datetime('now'))
  `;

  db.get(query, [userId], (err, ban) => {
    db.close();

    if (err) {
      console.error('Check ban error:', err);
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    }

    res.json({
      success: true,
      isBanned: !!ban,
      ban: ban || null,
    });
  });
});

// ==========================================
// GET /api/moderator/stats
// สถิติการดูแล
// ==========================================
router.get('/stats', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);

  console.log('📊 GET /api/moderator/stats');

  const queries = [
    // รายงานที่รอดำเนินการ
    new Promise((resolve, reject) => {
      db.get(
        "SELECT COUNT(*) as count FROM forum_reports WHERE status = 'pending'",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve({ pendingReports: row.count });
        }
      );
    }),
    // กระทู้ที่ถูกลบ
    new Promise((resolve, reject) => {
      db.get(
        "SELECT COUNT(*) as count FROM forum_threads WHERE is_deleted = 1",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve({ deletedThreads: row.count });
        }
      );
    }),
    // ผู้ใช้ที่ถูกแบน
    new Promise((resolve, reject) => {
      db.get(
        "SELECT COUNT(*) as count FROM user_bans WHERE is_active = 1",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve({ bannedUsers: row.count });
        }
      );
    }),
    // การดำเนินการวันนี้
    new Promise((resolve, reject) => {
      db.get(
        "SELECT COUNT(*) as count FROM forum_reports WHERE DATE(reviewed_at) = DATE('now')",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve({ actionsToday: row.count });
        }
      );
    }),
  ];

  Promise.all(queries)
    .then(results => {
      const stats = Object.assign({}, ...results);
      db.close();
      res.json({
        success: true,
        stats,
      });
    })
    .catch(err => {
      db.close();
      console.error('Get stats error:', err);
      res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาด',
      });
    });
});

module.exports = router;
