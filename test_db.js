const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'mysql'
    });
    console.log('Connected to MySQL server');
    const [rows] = await conn.execute('SHOW DATABASES');
    console.log('Databases:', rows.map(r => r.Database));
    await conn.end();
  } catch (err) {
    console.error('Connection failed:', err);
  }
}
test();
