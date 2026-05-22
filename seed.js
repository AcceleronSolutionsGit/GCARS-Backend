require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  console.log('✅ Connected to gcpl_cars via XAMPP MySQL');

  const hashed = await bcrypt.hash('SuperAdmin@2026', 10);

  // Ensure superadmin role exists
  await conn.execute(
    `INSERT IGNORE INTO roles (name, display_name, description, created_at, updated_at)
     VALUES ('superadmin', 'Super Administrator', 'Full system access', NOW(), NOW())`
  );

  // Create or update superadmin user
  const [ex] = await conn.execute("SELECT id FROM users WHERE username = 'superadmin' LIMIT 1");
  let uid;
  if (ex.length) {
    await conn.execute(
      "UPDATE users SET password=?, user_type='superadmin', status='Active', email='superadmin@gainwellindia.com', updated_at=NOW() WHERE username='superadmin'",
      [hashed]
    );
    uid = ex[0].id;
    console.log('✏️  SuperAdmin updated (id:', uid + ')');
  } else {
    const [r] = await conn.execute(
      "INSERT INTO users (username, email, emp_no, password, user_type, status, `new`, created_at, updated_at) VALUES ('superadmin', 'superadmin@gainwellindia.com', 'SA001', ?, 'superadmin', 'Active', 'yes', NOW(), NOW())",
      [hashed]
    );
    uid = r.insertId;
    console.log('➕ SuperAdmin created (id:', uid + ')');
  }

  // Assign superadmin role
  const [rr] = await conn.execute("SELECT id FROM roles WHERE name = 'superadmin' LIMIT 1");
  if (rr.length) {
    await conn.execute('INSERT IGNORE INTO role_user (user_id, role_id) VALUES (?, ?)', [uid, rr[0].id]);
    console.log('✅ Role assigned');
  }

  // Seed budget types if empty
  const [[bt]] = await conn.execute('SELECT COUNT(*) as cnt FROM capex_budget_type');
  if (bt.cnt === 0) {
    await conn.execute(`INSERT INTO capex_budget_type (budget_type, status, created_at, updated_at) VALUES ('CAPEX','Active',NOW(),NOW()),('OPEX','Active',NOW(),NOW())`);
    console.log('✅ Budget types seeded');
  }

  await conn.end();

  console.log('\n🎉 Seed complete!');
  console.log('─────────────────────────────────────────────');
  console.log('  App URL  : http://localhost:5173');
  console.log('  Email    : superadmin@gainwellindia.com');
  console.log('  Password : SuperAdmin@2026');
  console.log('─────────────────────────────────────────────');
})().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
