const db = require('./src/db');

async function upgradeWorkflow() {
  try {
    console.log('Upgrading workflow system...');

    // 1. Add flow_id to gcars_workflow_config
    const [cols] = await db.query("SHOW COLUMNS FROM gcars_workflow_config LIKE 'flow_id'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE gcars_workflow_config ADD COLUMN flow_id INT DEFAULT 1 AFTER id");
      await db.query("ALTER TABLE gcars_workflow_config ADD COLUMN flow_name VARCHAR(100) DEFAULT 'Standard' AFTER flow_id");
      console.log('✓ Added flow_id and flow_name columns to gcars_workflow_config');
    }

    // 2. Create gcars_workflows table for meta-info and conditions
    await db.query(`
      CREATE TABLE IF NOT EXISTS gcars_workflows (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        description     TEXT,
        request_type    VARCHAR(20) DEFAULT 'BOTH',
        min_amount      DECIMAL(14,2) DEFAULT 0,
        max_amount      DECIMAL(14,2) DEFAULT 999999999,
        is_default      TINYINT(1) DEFAULT 0,
        is_active       TINYINT(1) DEFAULT 1,
        created_at      DATETIME DEFAULT NOW(),
        updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW()
      )
    `);
    console.log('✓ gcars_workflows table created');

    // 3. Seed some default flows if empty
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) as cnt FROM gcars_workflows');
    if (cnt === 0) {
      await db.query(`
        INSERT INTO gcars_workflows (name, description, request_type, min_amount, max_amount, is_default)
        VALUES 
        ('Standard Flow', 'Default flow for all requests', 'BOTH', 0, 999999999, 1),
        ('High Value CAPEX', 'Flow for large capital expenditures', 'CAPEX', 1000000, 999999999, 0),
        ('Express Bulk Flow', 'Simplified flow for low value items', 'BOTH', 0, 50000, 0)
      `);
      console.log('✓ Seeded initial workflows');
    }

    // 4. Update existing items in config to point to Flow 1 (Standard)
    await db.query("UPDATE gcars_workflow_config SET flow_id = 1 WHERE flow_id IS NULL OR flow_id = 0");

    console.log('✓ Workflow system upgrade complete');
    process.exit(0);
  } catch (err) {
    console.error('Upgrade failed:', err);
    process.exit(1);
  }
}

upgradeWorkflow();
