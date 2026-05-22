require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// =======================================================
//  G-CARS 2 — Test Users Seed
//  Creates one user per approval role for flow testing
// =======================================================

const USERS = [
  // Requester (regular employee who raises requests)
  {
    username: 'emp_kumar',
    email:    'kumar@gainwellindia.com',
    emp_no:   'E001',
    password: 'Kumar@1234',
    user_type:'user',
    role:     'user',
    label:    'Employee / Requester',
  },
  // Supervisor (Level 1 approver)
  {
    username: 'supervisor_singh',
    email:    'supervisor@gainwellindia.com',
    emp_no:   'E002',
    password: 'Supervisor@1234',
    user_type:'supervisor',
    role:     'supervisor',
    label:    'Supervisor (L1 Approver)',
  },
  // IT Admin / PS Reviewer (optional level)
  {
    username: 'it_sharma',
    email:    'itadmin@gainwellindia.com',
    emp_no:   'E003',
    password:  'ItAdmin@1234',
    user_type: 'it_admin',
    role:      'it_admin',
    label:     'IT Admin / PS Reviewer',
  },
  // Budget Owner (L2 approver — validates against budget)
  {
    username: 'budgetowner_Joshi',
    email:    'budgetowner@gainwellindia.com',
    emp_no:   'E004',
    password: 'Budget@1234',
    user_type:'budget_owner',
    role:     'budget_owner',
    label:    'Budget Owner (L2 Approver)',
  },
  // Accountant
  {
    username: 'accountant_verma',
    email:    'accountant@gainwellindia.com',
    emp_no:   'E005',
    password: 'Acct@1234',
    user_type:'accountant',
    role:     'accountant',
    label:    'Accountant (L3 Approver)',
  },
  // CFO
  {
    username: 'cfo_gupta',
    email:    'cfo@gainwellindia.com',
    emp_no:   'E006',
    password: 'CFO@12345',
    user_type:'cfo',
    role:     'cfo',
    label:    'CFO (L4 Approver)',
  },
  // CMD
  {
    username: 'cmd_mehta',
    email:    'cmd@gainwellindia.com',
    emp_no:   'E007',
    password: 'CMD@12345',
    user_type:'cmd',
    role:     'cmd',
    label:    'CMD / MD (L5 Approver)',
  },
  // Finance (Final — generates SAP asset no.)
  {
    username: 'finance_rao',
    email:    'finance@gainwellindia.com',
    emp_no:   'E008',
    password: 'Finance@1234',
    user_type:'finance',
    role:     'finance',
    label:    'Finance / SAP (L6 – Final)',
  },
  // Admin (manages users, reports)
  {
    username: 'admin_gcars',
    email:    'admin@gainwellindia.com',
    emp_no:   'E009',
    password: 'Admin@1234',
    user_type:'admin',
    role:     'admin',
    label:    'Admin (Reports & Config)',
  },
];

async function seedUsers() {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'root', password: '', database: 'gcpl_cars',
  });

  console.log('✅ Connected to gcpl_cars');
  console.log('═══════════════════════════════════════════');
  console.log('   G-CARS 2 — Test Users Setup');
  console.log('═══════════════════════════════════════════\n');

  // Ensure all role types exist
  const allRoles = ['user', 'supervisor', 'it_admin', 'budget_owner', 'accountant', 'cfo', 'cmd', 'finance', 'admin', 'superadmin'];
  const roleDisplays = {
    user: 'Employee / User', supervisor: 'Supervisor', it_admin: 'IT Admin',
    budget_owner: 'Budget Owner', accountant: 'Accountant', cfo: 'CFO',
    cmd: 'CMD / MD', finance: 'Finance', admin: 'Admin', superadmin: 'Super Administrator',
  };

  for (const roleName of allRoles) {
    await conn.execute(
      `INSERT IGNORE INTO roles (name, display_name, description, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [roleName, roleDisplays[roleName], `G-CARS ${roleDisplays[roleName]} role`]
    );
  }
  console.log('✅ Roles ensured\n');

  const results = [];

  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.password, 10);

    // Delete existing test user
    const [existing] = await conn.execute('SELECT id FROM users WHERE username = ?', [u.username]);
    if (existing.length) {
      await conn.execute('DELETE FROM role_user WHERE user_id = ?', [existing[0].id]);
      await conn.execute('DELETE FROM users WHERE id = ?', [existing[0].id]);
    }

    // Create user
    const [ins] = await conn.execute(
      `INSERT INTO users (username, email, emp_no, password, user_type, status, \`new\`, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Active', 'Yes', NOW(), NOW())`,
      [u.username, u.email, u.emp_no, hashed, u.user_type]
    );
    const uid = ins.insertId;

    // Assign role
    const [roleRow] = await conn.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', [u.role]);
    if (roleRow.length) {
      await conn.execute('INSERT INTO role_user (user_id, role_id) VALUES (?, ?)', [uid, roleRow[0].id]);
    }

    results.push({ label: u.label, username: u.username, password: u.password, email: u.email, type: u.user_type });
    console.log(`  ✓ ${u.label.padEnd(30)} → ${u.username}`);
  }

  await conn.end();

  console.log('\n═══════════════════════════════════════════');
  console.log('   LOGIN CREDENTIALS FOR TESTING');
  console.log('═══════════════════════════════════════════\n');
  console.log('  URL: http://localhost:5173\n');

  const padR = (s, n) => String(s).padEnd(n);

  console.log(`  ${padR('Role', 32)} ${padR('Username', 24)} ${'Password'}`);
  console.log(`  ${'-'.repeat(80)}`);
  results.forEach(r => {
    console.log(`  ${padR(r.label, 32)} ${padR(r.username, 24)} ${r.password}`);
  });
  console.log(`  ${padR('Super Admin', 32)} ${padR('superadmin', 24)} SuperAdmin@2026`);
  console.log('\n═══════════════════════════════════════════\n');
}

seedUsers().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
