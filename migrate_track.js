const db = require('./src/db');

async function migrate() {
  try {
    console.log('Adding emp_no to capex_request_track...');
    await db.query("ALTER TABLE capex_request_track ADD COLUMN IF NOT EXISTS emp_no VARCHAR(255) AFTER capex_request_id");
    console.log('✅ Done');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
