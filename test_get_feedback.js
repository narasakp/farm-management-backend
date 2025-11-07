const http = require('http');

console.log('🧪 Testing GET /api/feedback\n');

http.get('http://localhost:3000/api/feedback', (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Content-Type: ${res.headers['content-type']}\n`);
    
    try {
      const response = JSON.parse(data);
      
      if (response.success) {
        console.log(`✅ Success: ${response.success}`);
        console.log(`📊 Total feedbacks: ${response.data?.length || 0}\n`);
        
        if (response.data && response.data.length > 0) {
          console.log('First 3 records:');
          response.data.slice(0, 3).forEach((item, index) => {
            console.log(`\n${index + 1}. ID: ${item.id}`);
            console.log(`   Subject: ${item.subject}`);
            console.log(`   Status: ${item.status}`);
            console.log(`   Type: ${item.type}`);
            console.log(`   User: ${item.user_name}`);
          });
          
          // Count by status
          const pending = response.data.filter(r => r.status === 'pending').length;
          const approved = response.data.filter(r => r.status === 'approved').length;
          const inProgress = response.data.filter(r => r.status === 'inProgress').length;
          
          console.log('\n' + '═'.repeat(60));
          console.log('📊 API Response Status Summary:');
          console.log(`   Pending: ${pending}`);
          console.log(`   Approved: ${approved}`);
          console.log(`   In Progress: ${inProgress}`);
          console.log('═'.repeat(60));
          console.log('\n💡 If these numbers are correct, the problem is in Flutter app parsing.');
        } else {
          console.log('⚠️  API returned empty data array!');
        }
      } else {
        console.log('❌ API returned success: false');
        console.log('Response:', response);
      }
    } catch (e) {
      console.log('❌ Failed to parse JSON response');
      console.log('Error:', e.message);
      console.log('\nRaw response:');
      console.log(data);
    }
  });
}).on('error', (e) => {
  console.log('❌ Request failed:', e.message);
  console.log('\n⚠️  Backend server may not be running!');
  console.log('💡 Start server: node backend/server.js');
});
