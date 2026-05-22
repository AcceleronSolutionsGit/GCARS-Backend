const mysql = require('mysql2/promise');
require('dotenv').config({ path: './backend/.env' });

async function discover() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('Tables:', tables.map(t => Object.values(t)[0]));

    const [perms] = await connection.execute('SHOW COLUMNS FROM permissions');
    console.log('Permissions columns:', perms.map(p => p.Field));

  } catch (err) {
    console.error('Discover failed:', err.message);
  } finally {
    await connection.end();
  }
}

discover();
