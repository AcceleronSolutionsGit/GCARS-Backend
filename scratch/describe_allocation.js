const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'gcpl_cars'
    });
    const [rows] = await conn.query("DESCRIBE capex_allocation");
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch(e) {
    console.error(e);
  }
}
run();
