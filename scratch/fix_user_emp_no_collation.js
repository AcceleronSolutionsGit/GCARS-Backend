const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'gcpl_cars'
    });
    
    console.log('Fixing emp_no collation in users table...');
    await conn.query(`ALTER TABLE users MODIFY emp_no VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    
    console.log('Fixing other columns in users table if needed...');
    // If there are other columns causing issues, we can fix them here.
    
    console.log('Success!');
    await conn.end();
  } catch(e) {
    console.error(e);
  }
}
run();
