const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'gcpl_cars'
    });
    const [rows] = await conn.query("SHOW TABLES");
    console.log(JSON.stringify(rows.map(r => Object.values(r)[0]), null, 2));
    await conn.end();
  } catch(e) {
    console.error(e);
  }
}
run();
