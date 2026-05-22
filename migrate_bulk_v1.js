const mysql = require('mysql2/promise');
require('dotenv').config({ path: './backend/.env' });

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gcpl_cars',
  });

  try {
    console.log('Checking for target_sbu and target_location in capex_request...');
    const [columns] = await connection.execute('SHOW COLUMNS FROM capex_request');
    const columnNames = columns.map(c => c.Field);

    if (!columnNames.includes('target_sbu')) {
      console.log('Adding target_sbu column...');
      await connection.execute('ALTER TABLE capex_request ADD COLUMN target_sbu VARCHAR(100) DEFAULT NULL AFTER quotation');
    }
    if (!columnNames.includes('target_location')) {
      console.log('Adding target_location column...');
      await connection.execute('ALTER TABLE capex_request ADD COLUMN target_location VARCHAR(100) DEFAULT NULL AFTER target_sbu');
    }

    console.log('Checking for BULK budget type...');
    const [btRows] = await connection.execute('SELECT * FROM capex_budget_type WHERE budget_type = "BULK"');
    if (btRows.length === 0) {
      console.log('Adding BULK budget type...');
      await connection.execute('INSERT INTO capex_budget_type (budget_type, status, created_at, updated_at) VALUES ("BULK", "Active", NOW(), NOW())');
    }

    console.log('Checking for raise_bulk_request permission...');
    const [pRows] = await connection.execute('SELECT * FROM permissions WHERE name = "raise_bulk_request"');
    if (pRows.length === 0) {
      console.log('Adding raise_bulk_request permission...');
      await connection.execute('INSERT INTO permissions (name, display_name, description, created_at, updated_at) VALUES ("raise_bulk_request", "Raise Bulk Request", "Permission to create bulk authorization requests manually", NOW(), NOW())');
    }

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await connection.end();
  }
}

migrate();
