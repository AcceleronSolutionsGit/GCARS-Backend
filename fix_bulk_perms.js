const mysql = require('mysql2/promise');
require('dotenv').config({ path: './backend/.env' });

async function insertMore() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    console.log('Inserting approve_bulk_request...');
    await connection.execute(`
      INSERT INTO permissions (name, display_name, description) 
      VALUES ('approve_bulk_request', 'Approve Bulk Requests', 'Permission to review and approve manual bulk authorization requests')
      ON DUPLICATE KEY UPDATE name=name
    `);
    
    console.log('Mapping permissions to roles...');
    const [[saRole]] = await connection.execute('SELECT id FROM roles WHERE name = "superadmin"');
    const [[admRole]] = await connection.execute('SELECT id FROM roles WHERE name = "admin"');
    const [[pRaise]] = await connection.execute('SELECT id FROM permissions WHERE name = "raise_bulk_request"');
    const [[pApprove]] = await connection.execute('SELECT id FROM permissions WHERE name = "approve_bulk_request"');

    if (saRole && pRaise) {
      await connection.execute('INSERT IGNORE INTO permission_role (role_id, permission_id) VALUES (?, ?)', [saRole.id, pRaise.id]);
      await connection.execute('INSERT IGNORE INTO permission_role (role_id, permission_id) VALUES (?, ?)', [saRole.id, pApprove.id]);
    }
    if (admRole && pApprove) {
      await connection.execute('INSERT IGNORE INTO permission_role (role_id, permission_id) VALUES (?, ?)', [admRole.id, pApprove.id]);
    }

    console.log('Permission setup complete.');

  } catch (err) {
    console.error('Setup failed:', err.message);
  } finally {
    await connection.end();
  }
}

insertMore();
