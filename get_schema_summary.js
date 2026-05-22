const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './.env' });

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    const [tables] = await conn.execute('SHOW TABLES');
    const dbName = process.env.DB_NAME || 'gcpl_cars';
    const key = `Tables_in_${dbName}`;
    
    let output = '# Database Schema Summary\n\n';

    for (const row of tables) {
      const tableName = row[key];
      output += `## ${tableName}\n`;
      const [columns] = await conn.execute(`DESCRIBE ${tableName}`);
      output += '| Field | Type | Null | Key | Default | Extra |\n';
      output += '|-------|------|------|-----|---------|-------|\n';
      for (const col of columns) {
        output += `| ${col.Field} | ${col.Type} | ${col.Null} | ${col.Key} | ${col.Default} | ${col.Extra} |\n`;
      }
      output += '\n';
    }

    fs.writeFileSync(path.join(__dirname, '../schema_summary.md'), output, 'utf8');
    console.log('Schema summary written successfully!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await conn.end();
  }
}

main();
