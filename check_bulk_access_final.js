const mysql = require('mysql2/promise');
require('dotenv').config({ path: './backend/.env' });

async function fixAndCheck() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    // 1. Assign raise_bulk_request to superadmin role if not already assigned
    console.log('Fetching superadmin role and permission IDs...');
    const [[saRole]] = await connection.execute('SELECT id FROM roles WHERE name = "superadmin"');
    const [[pBulk]] = await connection.execute('SELECT id FROM permissions WHERE name = "raise_bulk_request"');

    if (saRole && pBulk) {
      console.log(`Checking if permission ${pBulk.id} is assigned to role ${saRole.id}...`);
      const [existing] = await connection.execute('SELECT * FROM permission_role WHERE role_id = ? AND permission_id = ?', [saRole.id, pBulk.id]);
      if (existing.length === 0) {
        console.log('Assigning raise_bulk_request to superadmin...');
        await connection.execute('INSERT INTO permission_role (role_id, permission_id) VALUES (?, ?)', [saRole.id, pBulk.id]);
      } else {
        console.log('Permission already assigned to superadmin.');
      }
    }

    // 2. Fetch users who have this permission
    console.log('\n--- Users with "raise_bulk_request" permission ---');
    const [usersWithPerm] = await connection.execute(`
      SELECT u.username, u.email, r.name as role_name
      FROM users u
      JOIN role_user ru ON ru.user_id = u.id
      JOIN roles r ON r.id = ru.role_id
      JOIN permission_role pr ON pr.role_id = r.id
      JOIN permissions p ON p.id = pr.permission_id
      WHERE p.name = 'raise_bulk_request' AND u.status = 'Active'
    `);
    console.table(usersWithPerm);

    // 3. Fetch "BULK" workflows and their approvers
    console.log('\n--- "BULK" Workflow Strategies ---');
    const [bulkFlows] = await connection.execute(`
      SELECT id, name, request_type, is_active FROM gcars_workflows
      WHERE request_type = 'BULK' OR request_type = 'BOTH'
    `);
    console.table(bulkFlows);

    if (bulkFlows.length > 0) {
      const flowIds = bulkFlows.map(f => f.id);
      const [steps] = await connection.execute(`
        SELECT flow_id, step_name, role_key
        FROM gcars_workflow_config
        WHERE flow_id IN (${flowIds.join(',')}) AND is_active = 1
      `);
      
      const roleKeys = [...new Set(steps.map(s => s.role_key))];
      if (roleKeys.length > 0) {
        console.log(`\n--- Active Approvers for role keys: ${roleKeys.join(', ')} ---`);
        const [approvers] = await connection.execute(`
          SELECT u.username, u.user_type, u.email, u.emp_no
          FROM users u
          WHERE u.user_type IN (${roleKeys.map(k => '"' + k + '"').join(',')})
            AND u.status = 'Active'
        `);
        console.table(approvers);
      }
    }

  } catch (err) {
    console.error('Check failed:', err.message);
  } finally {
    await connection.end();
  }
}

fixAndCheck();
