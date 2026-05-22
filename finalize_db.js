const db = require('./src/db');

async function setup() {
  try {
    console.log('Creating capex_request_items table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS capex_request_items (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        capex_request_id  BIGINT NOT NULL,
        asset_type        INT,
        asset_name        VARCHAR(255) NOT NULL,
        asset_description TEXT,
        asset_quantity    INT DEFAULT 1,
        amount_ext_gst    DECIMAL(14,2),
        procurement       VARCHAR(50),
        created_at        DATETIME DEFAULT NOW(),
        updated_at        DATETIME DEFAULT NOW() ON UPDATE NOW(),
        FOREIGN KEY (capex_request_id) REFERENCES capex_request(id) ON DELETE CASCADE
      )
    `);
    console.log('✓ capex_request_items table created/exists');

    const [cols] = await db.query("SHOW COLUMNS FROM capex_request LIKE 'is_multi_asset'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE capex_request ADD COLUMN is_multi_asset TINYINT(1) DEFAULT 0 AFTER request_type");
      console.log('✓ Added is_multi_asset column to capex_request');
    }

    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

setup();
