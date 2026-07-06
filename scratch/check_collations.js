const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'gcpl_cars'
    });
    const [res] = await conn.query("SELECT table_name, column_name, collation_name FROM information_schema.columns WHERE table_schema='gcpl_cars' AND column_name='emp_no' AND table_name IN ('users', 'capex_master_employee')");
    console.log(JSON.stringify(res, null, 2));
    await conn.end();
  } catch(e) {
    console.error(e);
  }
}
run();
