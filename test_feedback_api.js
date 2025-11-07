/**
 * Test Feedback API
 * ทดสอบ feedback endpoints
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

// Test data
const testFeedback = {
  id: 'test-' + Date.now(),
  userId: 'test-user',
  userName: 'Test User',
  email: 'test@example.com',
  phone: '0812345678',
  type: 'suggestion',
  category: 'feature',
  subject: 'Test Feedback',
  message: 'This is a test feedback message',
  rating: 5,
  attachments: null,
  priority: 'medium',
  status: 'pending'
};

console.log('🧪 Testing Feedback API...\n');

// Test 1: Create Feedback
console.log('1️⃣  POST /api/feedback - Create feedback');
const postData = JSON.stringify(testFeedback);

const postOptions = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/feedback',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const postReq = http.request(postOptions, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`   Status: ${res.statusCode}`);
    try {
      const response = JSON.parse(data);
      console.log('   Response:', response);
      
      if (response.success) {
        console.log('   ✅ Create feedback SUCCESS\n');
        
        // Test 2: Get All Feedbacks
        console.log('2️⃣  GET /api/feedback - Get all feedbacks');
        http.get(`${BASE_URL}/api/feedback`, (res2) => {
          let data2 = '';
          
          res2.on('data', (chunk) => {
            data2 += chunk;
          });
          
          res2.on('end', () => {
            console.log(`   Status: ${res2.statusCode}`);
            try {
              const response2 = JSON.parse(data2);
              console.log(`   Total feedbacks: ${response2.data?.length || 0}`);
              if (response2.data?.length > 0) {
                console.log('   ✅ Get feedbacks SUCCESS\n');
                
                // Test 3: Update Status to Approved
                console.log('3️⃣  PUT /api/feedback/:id - Update to approved');
                const updateData = JSON.stringify({
                  status: 'approved',
                  adminResponse: 'Test approval',
                  respondedByUserName: 'Admin Test'
                });
                
                const putOptions = {
                  hostname: 'localhost',
                  port: 3000,
                  path: `/api/feedback/${testFeedback.id}`,
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(updateData)
                  }
                };
                
                const putReq = http.request(putOptions, (res3) => {
                  let data3 = '';
                  
                  res3.on('data', (chunk) => {
                    data3 += chunk;
                  });
                  
                  res3.on('end', () => {
                    console.log(`   Status: ${res3.statusCode}`);
                    try {
                      const response3 = JSON.parse(data3);
                      console.log('   Response:', response3);
                      
                      if (response3.success) {
                        console.log('   ✅ Update status SUCCESS\n');
                        
                        // Test 4: Get feedback with approved status
                        console.log('4️⃣  GET /api/feedback?status=approved');
                        http.get(`${BASE_URL}/api/feedback?status=approved`, (res4) => {
                          let data4 = '';
                          
                          res4.on('data', (chunk) => {
                            data4 += chunk;
                          });
                          
                          res4.on('end', () => {
                            console.log(`   Status: ${res4.statusCode}`);
                            try {
                              const response4 = JSON.parse(data4);
                              const approvedCount = response4.data?.length || 0;
                              console.log(`   Approved feedbacks: ${approvedCount}`);
                              
                              if (approvedCount > 0) {
                                console.log('   ✅ Filter by status SUCCESS\n');
                              } else {
                                console.log('   ❌ No approved feedbacks found\n');
                              }
                              
                              console.log('═'.repeat(60));
                              console.log('✅ All API tests completed!');
                              console.log('\n💡 If all tests passed, the API is working correctly.');
                              console.log('   Problem might be in the Flutter app.');
                            } catch (e) {
                              console.log('   ❌ Parse error:', e.message);
                            }
                          });
                        }).on('error', (e) => {
                          console.log('   ❌ Request error:', e.message);
                        });
                      } else {
                        console.log('   ❌ Update status FAILED\n');
                      }
                    } catch (e) {
                      console.log('   ❌ Parse error:', e.message);
                    }
                  });
                });
                
                putReq.on('error', (e) => {
                  console.log('   ❌ Request error:', e.message);
                });
                
                putReq.write(updateData);
                putReq.end();
              } else {
                console.log('   ❌ No feedbacks found\n');
              }
            } catch (e) {
              console.log('   ❌ Parse error:', e.message);
            }
          });
        }).on('error', (e) => {
          console.log('   ❌ Request error:', e.message);
        });
      } else {
        console.log('   ❌ Create feedback FAILED\n');
      }
    } catch (e) {
      console.log('   ❌ Parse error:', e.message);
    }
  });
});

postReq.on('error', (e) => {
  console.log('   ❌ Request error:', e.message);
  console.log('\n⚠️  Backend server may not be running!');
  console.log('💡 Start server: node backend/server.js');
});

postReq.write(postData);
postReq.end();
