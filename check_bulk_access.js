const mysql = require('mysql2/promise');
require('dotenv').config({ path: './backend/.env' });

async function checkAccess() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    console.log('--- Roles with "raise_bulk_request" permission ---');
    const [rolesPerm] = await connection.execute(`
      SELECT r.name as role_name, p.name as permission_name
      FROM roles r
      JOIN role_permission rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.name = 'raise_bulk_request'
    `);
    console.table(rolesPerm);

    console.log('\n--- Users with "raise_bulk_request" permission (via roles) ---');
    const [usersWithPerm] = await connection.execute(`
      SELECT u.username, u.email, r.name as role_name
      FROM users u
      JOIN role_user ru ON ru.user_id = u.id
      JOIN roles r ON r.id = ru.role_id
      JOIN role_permission rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.name = 'raise_bulk_request'
    `);
    console.table(usersWithPerm);

    console.log('\n--- "BULK" Workflow Strategies ---');
    const [bulkFlows] = await connection.execute(`
      SELECT id, name, request_type, is_active FROM gcars_workflows
      WHERE request_type = 'BULK' OR request_type = 'BOTH'
    `);
    console.table(bulkFlows);

    if (bulkFlows.length > 0) {
      console.log('\n--- Workflow Steps for BULK-enabled flows ---');
      const flowIds = bulkFlows.map(f => f.id);
      const [steps] = await connection.execute(`
        SELECT flow_id, step_order, step_name, role_key, applies_to
        FROM gcars_workflow_config
        WHERE flow_id IN (${flowIds.join(',')})
        ORDER BY flow_id, step_order
      `);
      console.table(steps);

      const roleKeys = [...new Set(steps.map(s => s.role_key))];
      console.log('\n--- Users who can Approve (based on active role keys in BULK flows) ---');
      const [approvers] = await connection.execute(`
        SELECT u.username, u.user_type, u.email
        FROM users u
        WHERE u.user_type IN (${roleKeys.map(k => '"' + k + '"').join(',')})
          AND u.status = 'Active'
      `);
      console.table(approvers);
    }

  } catch (err) {
    console.error('Check failed:', err.message);
  } finally {
    await connection.end();
  }
}

checkAccess();
