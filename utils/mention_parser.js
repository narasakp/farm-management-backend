/**
 * Mention Parser Utility
 * Parse @username mentions from content
 */

/**
 * Extract all @mentions from text
 * @param {string} content - HTML or text content
 * @returns {Array<string>} - Array of mentioned usernames (without @)
 */
function extractMentions(content) {
  if (!content) return [];

  // Pattern: @username (alphanumeric + underscore, 3-20 chars)
  const mentionPattern = /@([a-zA-Z0-9_]{3,20})/g;
  const mentions = [];
  let match;

  while ((match = mentionPattern.exec(content)) !== null) {
    const username = match[1];
    if (!mentions.includes(username)) {
      mentions.push(username);
    }
  }

  return mentions;
}

/**
 * Convert @mentions to HTML links
 * @param {string} content - Original content with @mentions
 * @returns {string} - Content with @mentions converted to links
 */
function renderMentions(content) {
  if (!content) return content;

  const mentionPattern = /@([a-zA-Z0-9_]{3,20})/g;
  
  return content.replace(mentionPattern, (match, username) => {
    return `<a href="/user/${username}" class="mention" data-username="${username}">@${username}</a>`;
  });
}

/**
 * Validate username format
 * @param {string} username
 * @returns {boolean}
 */
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

module.exports = {
  extractMentions,
  renderMentions,
  isValidUsername,
};
