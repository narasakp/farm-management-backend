/**
 * Moderator Routes
 * API สำหรับ Moderator และ Admin
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

// ==========================================
// GET /api/moderator/reports
// ดึงรายการรายงานทั้งหมด
// ==========================================
router.get('/reports', async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    console.log(`📋 GET /api/moderator/reports - status: ${status}`);

    const query = status === 'all' 
      ? `SELECT * FROM forum_reports ORDER BY created_at DESC`
      : `SELECT * FROM forum_reports WHERE status = $1 ORDER BY created_at DESC`;

    const params = status === 'all' ? [] : [status];

    const result = await pool.query(query, params);

    res.json({
      success: true,
      reports: result.rows || [],
    });
  } catch (err) {
    console.error('Get reports error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// POST /api/moderator/reports/:reportId/review
// ดำเนินการกับรายงาน
// ==========================================
router.post('/reports/:reportId/review', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, reviewerId } = req.body;

    console.log(`⚖️ POST /api/moderator/reports/${reportId}/review - action: ${action}`);

    const query = `
      UPDATE forum_reports 
      SET status = $1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `;

    await pool.query(query, [action, reviewerId, reportId]);

    res.json({
      success: true,
      message: 'ดำเนินการสำเร็จ',
    });
  } catch (err) {
    console.error('Review report error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// POST /api/moderator/ban-user
// แบนผู้ใช้
// ==========================================
router.post('/ban-user', async (req, res) => {
  try {
    const { userId, username, bannedBy, reason, banType, banUntil } = req.body;

    if (!userId || !bannedBy || !reason) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลให้ครบ',
      });
    }

    console.log(`🚫 POST /api/moderator/ban-user - userId: ${userId}`);

    const banId = uuidv4();

    const query = `
      INSERT INTO user_bans (
        id, user_id, username, banned_by, reason, ban_type, ban_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    await pool.query(
      query,
      [banId, userId, username, bannedBy, reason, banType || 'temporary', banUntil]
    );

    console.log(`✅ User ${userId} banned successfully`);

    res.json({
      success: true,
      message: 'แบนผู้ใช้สำเร็จ',
      banId,
    });
  } catch (err) {
    console.error('Ban user error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// POST /api/moderator/unban-user/:userId
// ปลดแบนผู้ใช้
// ==========================================
router.post('/unban-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { unbannedBy } = req.body;

    console.log(`✅ POST /api/moderator/unban-user/${userId}`);

    const query = `
      UPDATE user_bans 
      SET is_active = false, 
          unbanned_at = CURRENT_TIMESTAMP,
          unbanned_by = $1
      WHERE user_id = $2 AND is_active = true
    `;

    await pool.query(query, [unbannedBy, userId]);

    res.json({
      success: true,
      message: 'ปลดแบนผู้ใช้สำเร็จ',
    });
  } catch (err) {
    console.error('Unban user error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// GET /api/moderator/banned-users
// ดึงรายการผู้ใช้ที่ถูกแบน
// ==========================================
router.get('/banned-users', async (req, res) => {
  try {
    console.log('📋 GET /api/moderator/banned-users');

    const query = `
      SELECT * FROM user_bans 
      WHERE is_active = true 
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      bans: result.rows || [],
    });
  } catch (err) {
    console.error('Get banned users error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// GET /api/moderator/check-ban/:userId
// ตรวจสอบว่าผู้ใช้ถูกแบนหรือไม่
// ==========================================
router.get('/check-ban/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT * FROM user_bans 
      WHERE user_id = $1 AND is_active = true
      AND (ban_until IS NULL OR ban_until > CURRENT_TIMESTAMP)
    `;

    const result = await pool.query(query, [userId]);
    const ban = result.rows[0];

    res.json({
      success: true,
      isBanned: !!ban,
      ban: ban || null,
    });
  } catch (err) {
    console.error('Check ban error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

// ==========================================
// GET /api/moderator/stats
// สถิติการดูแล
// ==========================================
router.get('/stats', async (req, res) => {
  try {
    console.log('📊 GET /api/moderator/stats');

    const [pendingReports, deletedThreads, bannedUsers, actionsToday] = await Promise.all([
      pool.query("SELECT COUNT(*) as count FROM forum_reports WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) as count FROM threads WHERE deleted_at IS NOT NULL"),
      pool.query("SELECT COUNT(*) as count FROM user_bans WHERE is_active = true"),
      pool.query("SELECT COUNT(*) as count FROM forum_reports WHERE DATE(reviewed_at) = CURRENT_DATE")
    ]);

    const stats = {
      pendingReports: parseInt(pendingReports.rows[0].count) || 0,
      deletedThreads: parseInt(deletedThreads.rows[0].count) || 0,
      bannedUsers: parseInt(bannedUsers.rows[0].count) || 0,
      actionsToday: parseInt(actionsToday.rows[0].count) || 0
    };

    res.json({
      success: true,
      stats,
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาด',
    });
  }
});

module.exports = router;
