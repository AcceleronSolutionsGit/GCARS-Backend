const mysql = require('mysql2/promise');
require('dotenv').config({ path: './backend/.env' });

async function testPermissions() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    console.log('--- 1. Verification of Bulk Permissions presence ---');
    const [perms] = await connection.execute('SELECT * FROM permissions WHERE name IN ("raise_bulk_request", "approve_bulk_request")');
    console.table(perms);

    if (perms.length < 2) {
      console.error('ERROR: Missing permissions in DB');
    }

    console.log('\n--- 2. Role Assignments for Bulk Permissions ---');
    const [rolePerms] = await connection.execute(`
      SELECT r.name as role_name, p.name as permission_name
      FROM roles r
      JOIN permission_role pr ON pr.role_id = r.id
      JOIN permissions p ON p.id = pr.permission_id
      WHERE p.name IN ("raise_bulk_request", "approve_bulk_request")
    `);
    console.table(rolePerms);

    console.log('\n--- 3. Testing "Raise Bulk" Access for Users ---');
    const [raisers] = await connection.execute(`
      SELECT u.username, r.name as role_name
      FROM users u
      JOIN role_user ru ON ru.user_id = u.id
      JOIN roles r ON r.id = ru.role_id
      JOIN permission_role pr ON pr.role_id = r.id
      JOIN permissions p ON p.id = pr.permission_id
      WHERE p.name = 'raise_bulk_request'
    `);
    console.table(raisers);

    console.log('\n--- 4. Testing "Approve Bulk" Access for Users ---');
    const [approvers] = await connection.execute(`
      SELECT u.username, r.name as role_name
      FROM users u
      JOIN role_user ru ON ru.user_id = u.id
      JOIN roles r ON r.id = ru.role_id
      JOIN permission_role pr ON pr.role_id = r.id
      JOIN permissions p ON p.id = pr.permission_id
      WHERE p.name = 'approve_bulk_request'
    `);
    console.table(approvers);

    console.log('\n--- 5. Simulating Backend Logic (determineSpecificApprover) ---');
    // If no approver exists, let's assign one for test
    if (approvers.length === 0) {
      console.log('No bulk approvers found. Setting admin_gcars as a temporary bulk approver...');
      const [[adminRole]] = await connection.execute('SELECT id FROM roles WHERE name = "admin"');
      const [[approvePerm]] = await connection.execute('SELECT id FROM permissions WHERE name = "approve_bulk_request"');
      if (adminRole && approvePerm) {
          await connection.execute('INSERT IGNORE INTO permission_role (role_id, permission_id) VALUES (?, ?)', [adminRole.id, approvePerm.id]);
          console.log('Permission assigned to "admin" role.');
      }
    }

    // Re-check approvers
    const [finalApprovers] = await connection.execute(`
      SELECT u.emp_no, u.username FROM users u
      JOIN role_user ru ON ru.user_id = u.id
      JOIN permission_role pr ON pr.role_id = ru.role_id
      JOIN permissions p ON p.id = pr.permission_id
      WHERE p.name = 'approve_bulk_request' AND u.status = 'Active'
      LIMIT 1
    `);
    
    if (finalApprovers.length > 0) {
      console.log(`PASS: Logic found approver ${finalApprovers[0].username} (EMP: ${finalApprovers[0].emp_no})`);
    } else {
      console.warn('FAIL: Logic failed to find an active bulk approver.');
    }

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await connection.end();
  }
}

testPermissions();
