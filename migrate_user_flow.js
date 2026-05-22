const db = require('./src/db');

async function addUserDefaultFlow() {
  try {
    console.log('Adding default_flow_id to users table...');
    const [cols] = await db.query("SHOW COLUMNS FROM users LIKE 'default_flow_id'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE users ADD COLUMN default_flow_id INT DEFAULT NULL AFTER user_type");
      console.log('✓ Added default_flow_id column to users');
    } else {
      console.log('✓ Column already exists');
    }
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

addUserDefaultFlow();
