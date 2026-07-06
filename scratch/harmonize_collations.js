const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'gcpl_cars'
    });
    
    console.log('Harmonizing collations to utf8mb4_general_ci...');
    
    const tables = [
      'users',
      'capex_master_employee',
      'capex_request',
      'capex_request_track',
      'capex_allocation',
      'gcars_workflow_config',
      'gcars_workflows'
    ];
    
    for (const table of tables) {
      console.log(`Converting ${table}...`);
      await conn.query(`ALTER TABLE ${table} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    }
    
    console.log('Success!');
    await conn.end();
  } catch(e) {
    console.error(e);
  }
}
run();
