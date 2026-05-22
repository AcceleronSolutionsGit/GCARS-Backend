const db = require('./src/db');

async function fixHistory() {
  try {
    console.log('Retrospectively filling emp_no in capex_request_track...');
    
    // 1. Get all track records where emp_no is null
    const [tracks] = await db.query("SELECT id, comment FROM capex_request_track WHERE emp_no IS NULL");
    
    // 2. Get all users for mapping username/emp_no
    const [users] = await db.query("SELECT username, emp_no FROM users");
    const userMap = {};
    users.forEach(u => {
      userMap[u.username] = u.emp_no;
      userMap[u.emp_no] = u.emp_no;
    });

    let count = 0;
    for (const t of tracks) {
      if (!t.comment) continue;
      
      // Try to extract username from "Approved by [username] at level" or "Rejected by [username]:"
      let match = t.comment.match(/(?:Approved by|Rejected by) (.*?) (?:at level|:)/);
      if (!match) {
        // Try fallback matches
        match = t.comment.match(/(?:Approved by|Rejected by) (.*?) at/);
      }

      if (match && match[1]) {
        const username = match[1].trim();
        const empNo = userMap[username];
        if (empNo) {
          await db.query("UPDATE capex_request_track SET emp_no = ? WHERE id = ?", [empNo, t.id]);
          count++;
        }
      }
    }

    console.log(`✅ Fixed ${count} records out of ${tracks.length}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Fix history failed:', err);
    process.exit(1);
  }
}

fixHistory();
