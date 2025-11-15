// Pre-deployment Testing Script
// ทดสอบ endpoints หลักๆ ก่อน deploy

const axios = require('axios');

const BASE_URL = 'http://localhost:8080';
let authToken = '';

// Color codes for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

let passedTests = 0;
let failedTests = 0;
let totalTests = 0;

// Test 1: Health Check
async function testHealthCheck() {
  totalTests++;
  logInfo('Test 1: Health Check - GET /');
  try {
    const response = await axios.get(`${BASE_URL}/`);
    if (response.data.status === 'running' && response.data.database === 'PostgreSQL') {
      logSuccess('Health check passed - Server running with PostgreSQL');
      passedTests++;
      return true;
    } else {
      logError(`Health check failed - Unexpected response: ${JSON.stringify(response.data)}`);
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Health check failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 2: Login / Authentication
async function testLogin() {
  totalTests++;
  logInfo('Test 2: Authentication - POST /api/auth/login');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/login`, {
      username: 'farmer_test',
      password: 'test123'
    });
    
    if (response.data.success && response.data.access_token) {
      authToken = response.data.access_token;
      logSuccess(`Login successful - Token: ${authToken.substring(0, 30)}...`);
      passedTests++;
      return true;
    } else {
      logError('Login failed - No token received');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Login failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 3: User Profile
async function testUserProfile() {
  totalTests++;
  logInfo('Test 3: User Profile - GET /api/profile/:id');
  try {
    const response = await axios.get(`${BASE_URL}/api/profile/1`);
    
    if (response.data.success && response.data.user) {
      logSuccess(`User profile retrieved - User: ${response.data.user.display_name}`);
      passedTests++;
      return true;
    } else {
      logError('User profile failed - No user data');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`User profile failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 4: Search (with auth)
async function testSearch() {
  totalTests++;
  logInfo('Test 4: Search - GET /api/search?q=test');
  try {
    const response = await axios.get(`${BASE_URL}/api/search?q=test`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (response.data.success) {
      logSuccess(`Search successful - Results: ${response.data.results.total}`);
      passedTests++;
      return true;
    } else {
      logError('Search failed');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Search failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 5: Feedback
async function testFeedback() {
  totalTests++;
  logInfo('Test 5: Feedback - GET /api/feedback');
  try {
    const response = await axios.get(`${BASE_URL}/api/feedback`);
    
    if (response.data.success) {
      logSuccess(`Feedback list retrieved - ${response.data.data.length} items`);
      passedTests++;
      return true;
    } else {
      logError('Feedback failed');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Feedback failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 6: Webboard/Forum
async function testForum() {
  totalTests++;
  logInfo('Test 6: Forum - GET /api/forum/threads');
  try {
    const response = await axios.get(`${BASE_URL}/api/forum/threads?category=general&limit=5`);
    
    if (response.data.success) {
      logSuccess(`Forum threads retrieved - ${response.data.threads.length} threads`);
      passedTests++;
      return true;
    } else {
      logError('Forum failed');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Forum failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 7: Forum Stats
async function testForumStats() {
  totalTests++;
  logInfo('Test 7: Forum Stats - GET /api/forum/stats');
  try {
    const response = await axios.get(`${BASE_URL}/api/forum/stats`);
    
    if (response.data.success && response.data.stats) {
      logSuccess(`Forum stats retrieved - ${response.data.stats.totalThreads} threads, ${response.data.stats.totalReplies} replies`);
      passedTests++;
      return true;
    } else {
      logError('Forum stats failed');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Forum stats failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 8: Moderator Reports
async function testModeratorReports() {
  totalTests++;
  logInfo('Test 8: Moderator - GET /api/moderator/reports');
  try {
    const response = await axios.get(`${BASE_URL}/api/moderator/reports`);
    
    if (response.data.success) {
      logSuccess(`Moderator reports retrieved - ${response.data.reports.length} reports`);
      passedTests++;
      return true;
    } else {
      logError('Moderator reports failed');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Moderator reports failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 9: Privacy (with auth)
async function testPrivacy() {
  totalTests++;
  logInfo('Test 9: Privacy - GET /api/privacy/farmer/:id');
  try {
    const response = await axios.get(`${BASE_URL}/api/privacy/farmer/1360600091304`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (response.data.success && response.data.data) {
      logSuccess(`Privacy data retrieved - Farmer: ${response.data.data.first_name} ${response.data.data.last_name}`);
      passedTests++;
      return true;
    } else {
      logError('Privacy failed');
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Privacy failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Test 10: Database Connection
async function testDatabaseConnection() {
  totalTests++;
  logInfo('Test 10: Database Connection - Verify PostgreSQL');
  try {
    const response = await axios.get(`${BASE_URL}/`);
    
    if (response.data.database === 'PostgreSQL') {
      logSuccess('Database connection verified - PostgreSQL');
      passedTests++;
      return true;
    } else {
      logError(`Wrong database - Expected PostgreSQL, got ${response.data.database}`);
      failedTests++;
      return false;
    }
  } catch (error) {
    logError(`Database connection test failed - ${error.message}`);
    failedTests++;
    return false;
  }
}

// Main test runner
async function runAllTests() {
  log('\n========================================', 'bold');
  log('  🧪 PRE-DEPLOYMENT TESTING SCRIPT', 'cyan');
  log('========================================\n', 'bold');
  
  log(`Testing server at: ${BASE_URL}\n`, 'yellow');
  
  // Run tests sequentially
  await testHealthCheck();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testLogin();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testUserProfile();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testSearch();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testFeedback();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testForum();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testForumStats();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testModeratorReports();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testPrivacy();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await testDatabaseConnection();
  
  // Summary
  log('\n========================================', 'bold');
  log('  📊 TEST SUMMARY', 'cyan');
  log('========================================\n', 'bold');
  
  log(`Total Tests: ${totalTests}`, 'cyan');
  logSuccess(`Passed: ${passedTests}`);
  logError(`Failed: ${failedTests}`);
  
  const percentage = ((passedTests / totalTests) * 100).toFixed(1);
  log(`\nSuccess Rate: ${percentage}%\n`, percentage === '100.0' ? 'green' : 'yellow');
  
  if (failedTests === 0) {
    log('========================================', 'bold');
    logSuccess('✅ ALL TESTS PASSED! READY TO DEPLOY! 🚀');
    log('========================================\n', 'bold');
    process.exit(0);
  } else {
    log('========================================', 'bold');
    logError('❌ SOME TESTS FAILED! FIX BEFORE DEPLOY!');
    log('========================================\n', 'bold');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});
