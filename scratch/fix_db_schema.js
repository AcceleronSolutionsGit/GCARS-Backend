const db = require('../src/db');

async function fixDbSchema() {
  const connection = await db.getConnection();
  try {
    console.log('Starting DB schema fixes...');

    // BUG-01: Alter capex_request.status ENUM to include missing statuses
    console.log('Altering capex_request.status column...');
    await connection.query("ALTER TABLE capex_request MODIFY COLUMN status ENUM('PO CREATED','SANCTION NUMBER GENERATED','IN STOCK','IN PROGRESS','REJECT','COMPLETE','FAIL','ASSET CREATED', 'Initiated', 'Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Initiated';");
    console.log('Status column altered successfully.');

    // BUG-04: Insert missing workflow steps for flow_id = 2 (High-Value CAPEX)
    console.log('Inserting workflow steps for flow_id=2...');
    
    // Check if flow_id=2 steps already exist to avoid duplicates
    const [existingSteps] = await connection.query("SELECT id FROM gcars_workflow_config WHERE flow_id = 2");
    
    if (existingSteps.length === 0) {
      const steps = [
        [2, 'supervisor', 'Supervisor', 1, 0, 9999999999.00, 'CAPEX', 'All', 1],
        [2, 'budget_owner', 'Budget Owner', 2, 0, 9999999999.00, 'CAPEX', 'All', 1],
        [2, 'finance', 'Finance Head', 3, 0, 9999999999.00, 'CAPEX', 'All', 1],
        [2, 'cmd', 'Managing Director', 4, 0, 9999999999.00, 'CAPEX', 'All', 1]
      ];

      for (const step of steps) {
        await connection.query(
          "INSERT INTO gcars_workflow_config (flow_id, role_key, label, step_order, amount_min, amount_max, applies_to, department, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          step
        );
      }
      console.log('Workflow steps inserted successfully.');
    } else {
      console.log('Workflow steps for flow_id=2 already exist.');
    }

    console.log('DB schema fixes completed.');
  } catch (err) {
    console.error('Error executing DB schema fixes:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

fixDbSchema();
