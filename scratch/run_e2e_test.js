require('dotenv').config();
const db = require('../src/db'); // for directly checking DB values if needed

const API = 'http://localhost:5000/api';

async function login(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: username, password })
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Login failed for ${username}: ${data.message}`);
  return data.token;
}

async function runTest() {
  console.log('--- STARTING E2E TEST ---');

  try {
    // 1. Get DB connection to verify state
    console.log('Fetching initial state...');
    
    // Check if emp_kumar has an employee record with sbu_id, loc_id, b_func_id
    const [empRows] = await db.query("SELECT * FROM capex_master_employee WHERE emp_no = 'E001'");
    if (empRows.length === 0) {
       console.log('Creating test employee record for emp_kumar...');
       await db.query("INSERT INTO capex_master_employee (emp_no, name, email, sbu_id, b_func_id, location_id, status) VALUES ('E001', 'emp_kumar', 'kumar@gainwellindia.com', 1, 1, 1, 'Active')");
    } else {
       await db.query("UPDATE capex_master_employee SET sbu_id=1, b_func_id=1, location_id=1 WHERE emp_no='E001'");
    }

    // 2. Login as Admin to create Budget
    console.log('Logging in as Admin...');
    const adminToken = await login('superadmin', 'SuperAdmin@2026');

    // Create a new budget entity if not exists, and an allocation
    console.log('Creating budget allocation from frontend API...');
    const allocRes = await fetch(`${API}/superadmin/allocations`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}` 
      },
      body: JSON.stringify({
        sbu_id: 1,
        bfun_id: 1,
        loc_id: 1,
        asset_group: 1,
        asset_type: 1,
        budget_type: 1,
        budgeted_amount: 1000000, // 10 Lakhs
        year: new Date().getFullYear(),
        description: 'E2E Test Budget'
      })
    });
    const allocData = await allocRes.json();
    if (!allocData.success) throw new Error(`Budget creation failed: ${JSON.stringify(allocData)}`);
    const allocId = allocData.id;
    console.log(`✅ Budget created with ID: ${allocId} for 1,000,000 INR`);

    // 3. Login as User and create request
    console.log('Logging in as Requester (emp_kumar)...');
    const userToken = await login('emp_kumar', 'Kumar@1234');
    
    console.log('Submitting new CAPEX request...');
    const reqRes = await fetch(`${API}/requests`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}` 
      },
      body: JSON.stringify({
        asset_name: 'Test Mac Studio',
        asset_type: 1,
        expected_date: new Date(Date.now() + 86400000 * 30).toISOString(),
        procurement: 'Buy',
        amount_ext_gst: 250000, // 2.5 Lakhs
        budget_type: 1,
        budget_allocation_id: allocId
      })
    });
    
    const reqData = await reqRes.json();
    if (!reqData.success) throw new Error(`Request creation failed: ${JSON.stringify(reqData)}`);
    const reqId = reqData.id;
    const capexNo = reqData.capex_no;
    console.log(`✅ Request submitted successfully. Request ID: ${reqId}, CAPEX No: ${capexNo}`);

    // Verify committed amount increased
    const [allocCheck1] = await db.query("SELECT committed_amount, budget_amount_consumed FROM capex_allocation WHERE id = ?", [allocId]);
    console.log(`📊 Budget Status (Post-Submit): Committed = ${allocCheck1[0].committed_amount}, Consumed = ${allocCheck1[0].budget_amount_consumed}`);

    // 4. Dynamic Approval Chain Execution
    const roleUserMap = {
      'supervisor': { user: 'supervisor_singh', pass: 'Supervisor@1234' },
      'it_admin': { user: 'it_sharma', pass: 'ItAdmin@1234' },
      'budget_owner': { user: 'budgetowner_Joshi', pass: 'Budget@1234' },
      'accountant': { user: 'accountant_verma', pass: 'Acct@1234' },
      'cfo': { user: 'cfo_gupta', pass: 'CFO@12345' },
      'cmd': { user: 'cmd_mehta', pass: 'CMD@12345' },
      'finance': { user: 'finance_rao', pass: 'Finance@1234' },
      'leadership_review': { user: 'cmd_mehta', pass: 'CMD@12345' } // Fallback
    };

    while (true) {
       // Fetch request status
       const statusRes = await fetch(`${API}/requests/${reqId}`, {
           headers: { Authorization: `Bearer ${adminToken}` }
       });
       const statusData = await statusRes.json();
       if (!statusData.success) {
           throw new Error(`Failed to fetch request status: ${statusData.message}`);
       }
       const currentReq = statusData.data;

       if (currentReq.status === 'Approved' || currentReq.status === 'Rejected') {
           console.log(`✅ Request reached terminal state: ${currentReq.status}`);
           break;
       }

       const activeRole = currentReq.active_approver;
       console.log(`\nNext step is: ${activeRole}`);
       
       const approver = roleUserMap[activeRole];
       if (!approver) {
           console.error(`❌ Unknown role: ${activeRole}. Cannot proceed.`);
           break;
       }

       console.log(`Logging in as ${approver.user}...`);
       const appToken = await login(approver.user, approver.pass);

       console.log(`Approving request...`);
       try {
         const appRes = await fetch(`${API}/requests/${reqId}/approve`, {
           method: 'POST',
           headers: { 
             'Content-Type': 'application/json',
             Authorization: `Bearer ${appToken}` 
           },
           body: JSON.stringify({
             comment: `E2E Approved by ${activeRole}`,
             asset_no: activeRole === 'finance' ? 'E2E-SAP-999' : undefined
           })
         });
         const appData = await appRes.json();
         if (!appData.success) throw new Error(`Approval failed: ${JSON.stringify(appData)}`);
         console.log(`✅ Approved at level: ${activeRole}`);
       } catch (err) {
         console.error(`❌ Failed to approve at level ${activeRole}:`, err.message);
         break;
       }
    }

    // 5. Final Budget Verification
    const [allocCheck2] = await db.query("SELECT committed_amount, budget_amount_consumed FROM capex_allocation WHERE id = ?", [allocId]);
    console.log(`\n📊 Final Budget Status (Post-Approval): Committed = ${allocCheck2[0].committed_amount}, Consumed = ${allocCheck2[0].budget_amount_consumed}`);
    
    if (allocCheck2[0].budget_amount_consumed == 250000 && allocCheck2[0].committed_amount == 0) {
       console.log('🏆 SUCCESS: E2E Request Flow and Budget Tracking operated flawlessly!');
    } else {
       console.log('⚠️ WARNING: Budget numbers did not match expectations.');
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ E2E Test Error:');
    console.error(error);
    process.exit(1);
  }
}

runTest();
