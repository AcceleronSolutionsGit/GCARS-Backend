require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'root', password: '', database: 'gcpl_cars'
  });

  const [ut] = await conn.execute("SHOW COLUMNS FROM users WHERE Field='user_type'");
  console.log('user_type definition:', ut[0]?.Type);

  // Delete the broken superadmin row and the test row
  await conn.execute("DELETE FROM users WHERE username IN ('superadmin','gcars_test_sa')");
  await conn.execute("DELETE FROM role_user WHERE user_id IN (SELECT id FROM users WHERE username='superadmin')");
  console.log('Deleted old rows');

  const password = 'SuperAdmin@2026';
  const hashed = await bcrypt.hash(password, 10);

  // Check what user_type values are valid
  const userTypeCol = ut[0]?.Type || 'varchar(255)';
  console.log('user_type type:', userTypeCol);

  // Use plain varchar insert, no enum restriction
  const [ins] = await conn.execute(
    `INSERT INTO users (username, email, emp_no, password, user_type, status, created_at, updated_at)
     VALUES ('superadmin', 'superadmin@gainwellindia.com', 'SA001', ?, 'superadmin', 'Active', NOW(), NOW())`,
    [hashed]
  );
  const uid = ins.insertId;
  console.log('Created superadmin id:', uid);

  // Assign role
  const [roles] = await conn.execute("SELECT id FROM roles WHERE name='superadmin' LIMIT 1");
  if (roles.length) {
    await conn.execute("INSERT IGNORE INTO role_user (user_id, role_id) VALUES (?,?)", [uid, roles[0].id]);
    console.log('Role assigned');
  }

  // Final verification
  const [check] = await conn.execute("SELECT id, username, email, user_type, status, LENGTH(password) as pw_len FROM users WHERE id=?", [uid]);
  console.log('Final row:', JSON.stringify(check[0]));
  const [pw] = await conn.execute("SELECT password FROM users WHERE id=?", [uid]);
  const ok = await bcrypt.compare(password, pw[0].password);
  console.log('Password match:', ok);

  await conn.end();
  if (ok) {
    console.log('\n✅ SUCCESS! Login credentials:');
    console.log('   Email: superadmin@gainwellindia.com');
    console.log('   Pass:  SuperAdmin@2026');
  } else {
    console.log('❌ Still failing');
  }
})().catch(e => console.error('ERROR:', e.message));
