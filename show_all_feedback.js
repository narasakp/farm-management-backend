const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'farm_auth.db');
const db = new sqlite3.Database(DB_PATH);

console.log(`📂 Database: ${DB_PATH}\n`);
console.log('📋 All Feedback Records:\n');

db.all('SELECT * FROM feedback ORDER BY created_at DESC', (err, rows) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }
  
  if (!rows || rows.length === 0) {
    console.log('⚠️  No feedback records found in database!');
    console.log('\n💡 You need to add sample data or submit feedback from the app.');
  } else {
    console.log(`✅ Found ${rows.length} feedback records:\n`);
    
    rows.forEach((row, index) => {
      console.log(`${index + 1}. [${row.status}] ${row.subject}`);
      console.log(`   User: ${row.user_name}`);
      console.log(`   Type: ${row.type}, Category: ${row.category}`);
      console.log(`   Created: ${row.created_at}`);
      if (row.admin_response) {
        console.log(`   Admin Response: ${row.admin_response}`);
      }
      if (row.attachments) {
        try {
          const attachments = JSON.parse(row.attachments);
          if (attachments.length > 0) {
            console.log(`   📎 Attachments (${attachments.length}):`);
            attachments.forEach((url, i) => {
              console.log(`      ${i + 1}. ${url}`);
            });
          }
        } catch (e) {
          console.log(`   📎 Attachments: ${row.attachments}`);
        }
      }
      console.log('');
    });
    
    // Count by status
    const pending = rows.filter(r => r.status === 'pending').length;
    const approved = rows.filter(r => r.status === 'approved').length;
    const rejected = rows.filter(r => r.status === 'rejected').length;
    const closed = rows.filter(r => r.status === 'closed').length;
    const inProgress = rows.filter(r => r.status === 'inProgress').length;
    const resolved = rows.filter(r => r.status === 'resolved').length;
    
    console.log('═'.repeat(60));
    console.log('📊 Status Summary:');
    console.log(`   Pending: ${pending}`);
    console.log(`   Approved: ${approved}`);
    console.log(`   Rejected: ${rejected}`);
    console.log(`   In Progress: ${inProgress}`);
    console.log(`   Resolved: ${resolved}`);
    console.log(`   Closed: ${closed}`);
    console.log('═'.repeat(60));
  }
  
  db.close();
});
