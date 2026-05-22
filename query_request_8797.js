const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env' });

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    console.log('=== LATEST REQUESTS ===');
    const [reqs] = await conn.execute(`
      SELECT cr.id, cr.capex_no, cr.emp_no, me.sbu, cr.amount_ext_gst, cr.request_type, cr.status, cr.active_approver, cr.active_approver_emp_no, cr.created_at 
      FROM capex_request cr
      LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
      ORDER BY cr.id DESC LIMIT 10
    `);
    console.log(JSON.stringify(reqs, null, 2));

    console.log('=== WORKFLOW CONFIG STATS ===');
    const [configCounts] = await conn.execute('SELECT flow_id, department, COUNT(*) as count FROM gcars_workflow_config GROUP BY flow_id, department');
    console.log(configCounts);

    console.log('=== ALL WORKFLOWS ===');
    const [workflows] = await conn.execute('SELECT * FROM gcars_workflows');
    console.log(workflows);

  } catch (err) {
    console.error('Error running query:', err);
  } finally {
    await conn.end();
  }
})();
