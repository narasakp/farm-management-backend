/**
 * Activity Tracker Utility
 * Track user activities ในระบบ
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'farm_auth.db');

/**
 * Activity Types:
 * - thread: กระทู้
 * - reply: คำตอบ
 * - vote: โหวต
 * - mention: กล่าวถึง
 * - bookmark: บันทึก
 * - follow: ติดตาม
 * - report: รายงาน
 * 
 * Actions:
 * - created, updated, deleted
 * - upvoted, downvoted
 * - bookmarked, unbookmarked
 * - followed, unfollowed
 * - mentioned
 * - reported
 */

class ActivityTracker {
  /**
   * Track activity
   * @param {Object} activity
   * @param {string} activity.userId - User ID
   * @param {string} activity.username - Username
   * @param {string} activity.activityType - Type of activity
   * @param {string} activity.action - Action performed
   * @param {string} activity.targetType - Type of target (thread, reply, user)
   * @param {string} activity.targetId - ID of target
   * @param {string} activity.targetTitle - Title/description of target
   * @param {Object} activity.metadata - Additional metadata
   */
  static track(activity) {
    const db = new sqlite3.Database(DB_PATH);

    const {
      userId,
      username,
      activityType,
      action,
      targetType = null,
      targetId = null,
      targetTitle = null,
      metadata = null,
    } = activity;

    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const query = `
      INSERT INTO user_activities (
        user_id, username, activity_type, action,
        target_type, target_id, target_title, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      query,
      [userId, username, activityType, action, targetType, targetId, targetTitle, metadataJson],
      (err) => {
        if (err) {
          console.error('❌ Error tracking activity:', err);
        } else {
          console.log(`✅ Activity tracked: ${username} ${action} ${activityType}`);
        }
        db.close();
      }
    );
  }

  /**
   * Track thread creation
   */
  static trackThreadCreated(userId, username, threadId, threadTitle) {
    this.track({
      userId,
      username,
      activityType: 'thread',
      action: 'created',
      targetType: 'thread',
      targetId: threadId,
      targetTitle: threadTitle,
    });
  }

  /**
   * Track reply creation
   */
  static trackReplyCreated(userId, username, replyId, threadId, threadTitle) {
    this.track({
      userId,
      username,
      activityType: 'reply',
      action: 'created',
      targetType: 'thread',
      targetId: threadId,
      targetTitle: threadTitle,
      metadata: { replyId },
    });
  }

  /**
   * Track vote
   */
  static trackVote(userId, username, targetType, targetId, voteType) {
    this.track({
      userId,
      username,
      activityType: 'vote',
      action: voteType === 'up' ? 'upvoted' : 'downvoted',
      targetType,
      targetId,
      metadata: { voteType },
    });
  }

  /**
   * Track mention
   */
  static trackMention(userId, username, mentionedUserId, mentionedUsername, threadId, threadTitle) {
    this.track({
      userId,
      username,
      activityType: 'mention',
      action: 'mentioned',
      targetType: 'user',
      targetId: mentionedUserId,
      targetTitle: `@${mentionedUsername}`,
      metadata: { threadId, threadTitle },
    });
  }

  /**
   * Track bookmark
   */
  static trackBookmark(userId, username, threadId, threadTitle, isBookmarked) {
    this.track({
      userId,
      username,
      activityType: 'bookmark',
      action: isBookmarked ? 'bookmarked' : 'unbookmarked',
      targetType: 'thread',
      targetId: threadId,
      targetTitle: threadTitle,
    });
  }

  /**
   * Track follow
   */
  static trackFollow(userId, username, threadId, threadTitle, isFollowing) {
    this.track({
      userId,
      username,
      activityType: 'follow',
      action: isFollowing ? 'followed' : 'unfollowed',
      targetType: 'thread',
      targetId: threadId,
      targetTitle: threadTitle,
    });
  }

  /**
   * Track report
   */
  static trackReport(userId, username, contentType, contentId, reason) {
    this.track({
      userId,
      username,
      activityType: 'report',
      action: 'reported',
      targetType: contentType,
      targetId: contentId,
      metadata: { reason },
    });
  }

  /**
   * Get user activities
   * @param {string} userId - User ID
   * @param {Object} options - Filter options
   * @returns {Promise<Array>}
   */
  static getActivities(userId, options = {}) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH);

      const {
        activityType = null,
        limit = 50,
        offset = 0,
      } = options;

      let query = `
        SELECT * FROM user_activities
        WHERE user_id = ?
      `;
      const params = [userId];

      if (activityType) {
        query += ` AND activity_type = ?`;
        params.push(activityType);
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      db.all(query, params, (err, rows) => {
        db.close();

        if (err) {
          reject(err);
        } else {
          // Parse metadata JSON
          const activities = rows.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
          }));
          resolve(activities);
        }
      });
    });
  }

  /**
   * Get public feed (all users' activities)
   * @param {Object} options - Filter options
   * @returns {Promise<Array>}
   */
  static getPublicFeed(options = {}) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH);

      const {
        activityType = null,
        limit = 50,
        offset = 0,
      } = options;

      let query = `SELECT * FROM user_activities WHERE 1=1`;
      const params = [];

      if (activityType) {
        query += ` AND activity_type = ?`;
        params.push(activityType);
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      db.all(query, params, (err, rows) => {
        db.close();

        if (err) {
          reject(err);
        } else {
          const activities = rows.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
          }));
          resolve(activities);
        }
      });
    });
  }
}

module.exports = ActivityTracker;
