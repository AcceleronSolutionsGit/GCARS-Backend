require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'root', password: '', database: 'gcpl_cars'
  });

  // Check column definitions
  const [cols] = await conn.execute('SHOW COLUMNS FROM users');
  const pw = cols.find(c => c.Field === 'password');
  const ut = cols.find(c => c.Field === 'user_type');
  console.log('password col:', JSON.stringify(pw));
  console.log('user_type col:', JSON.stringify(ut));

  // Check the actual stored values (raw)
  const [r] = await conn.execute("SELECT id, username, LENGTH(password) as pw_len, password, user_type FROM users WHERE username='superadmin'");
  console.log('Row:', { id: r[0]?.id, pw_len: r[0]?.pw_len, pw_first10: r[0]?.password?.slice(0,10), user_type: JSON.stringify(r[0]?.user_type) });

  // Try a direct INSERT of a new user
  const hashed = await bcrypt.hash('Test@1234', 10);
  await conn.execute("DELETE FROM users WHERE username='gcars_test_sa'");
  const [ins] = await conn.execute(
    "INSERT INTO users (username, email, emp_no, password, user_type, status, created_at, updated_at) VALUES ('gcars_test_sa','test@test.com','T001',?,'superadmin','Active',NOW(),NOW())",
    [hashed]
  );
  console.log('Test insert id:', ins.insertId);
  const [t] = await conn.execute("SELECT LENGTH(password) as pw_len, user_type FROM users WHERE id=?", [ins.insertId]);
  console.log('Test row:', JSON.stringify(t[0]));
  const match = await bcrypt.compare('Test@1234', hashed);
  console.log('hash self-check:', match);

  // Check if the test row password actually saves
  const [tp] = await conn.execute("SELECT password FROM users WHERE id=?", [ins.insertId]);
  const actualMatch = await bcrypt.compare('Test@1234', tp[0].password);
  console.log('Test row DB match:', actualMatch);

  await conn.end();
})().catch(e => console.error('ERROR:', e.message));
