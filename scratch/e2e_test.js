const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000/api';

async function login(emp_no) {
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emp_no, password: 'password' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.token;
  } catch (err) {
    console.error(`Login failed for ${emp_no}:`, err.message);
    throw err;
  }
}

async function runE2E() {
  console.log('--- Starting E2E Request Flow ---');
  
  // 1. Login as requester
  const requester = '1208';
  console.log(`[1] Logging in as requester (${requester})...`);
  const token = await login(requester);

  // 2. Fetch Masters
  console.log(`[2] Fetching master data...`);
  const headers = { Authorization: `Bearer ${token}` };
  
  const groups = await fetch(`${BASE_URL}/masters/asset-groups`, { headers }).then(r => r.json()).then(r => r.data);
  const types = await fetch(`${BASE_URL}/masters/asset-types`, { headers }).then(r => r.json()).then(r => r.data);
  const budgets = await fetch(`${BASE_URL}/masters/budget-types`, { headers }).then(r => r.json()).then(r => r.data);

  const group = groups.find(g => g.name !== 'IT'); // pick non-IT
  const type = types.find(t => t.asset_group === group.id);
  const budget = budgets.find(b => b.budget_type !== 'BULK');

  console.log(`    Selected Group: ${group.name}, Type: ${type.asset_name}, Budget: ${budget.budget_type}`);

  // Fetch allocation
  const allocs = await fetch(`${BASE_URL}/masters/allocations?year=${new Date().getFullYear()}&budget_type=${budget.id}`, { headers }).then(r => r.json()).then(r => r.data);
  const allocation = allocs[0];

  // 3. Create Request
  console.log(`[3] Creating request...`);
  const formData = new FormData();
  formData.append('request_type', 'CAPEX');
  formData.append('asset_group', group.id);
  formData.append('asset_type', type.id);
  formData.append('budget_allocation_id', allocation ? allocation.id : '');
  formData.append('expected_date', '2026-12-31');
  formData.append('procurement', 'new');
  formData.append('asset_name', 'E2E Test Machine');
  formData.append('asset_description', 'Testing the full workflow');
  formData.append('asset_justification', 'Automated test run');
  formData.append('asset_quantity', 1);
  formData.append('amount_ext_gst', 150000); // 1.5 Lakh to trigger Standard Flow
  formData.append('budget_type', budget.id);
  formData.append('manufacturer', 'Test Corp');
  
  // Create a dummy file
  const dummyFile = path.join(__dirname, 'dummy.txt');
  fs.writeFileSync(dummyFile, 'dummy content');
  const fileBlob = new Blob([fs.readFileSync(dummyFile)]);
  formData.append('attachments', fileBlob, 'dummy.txt');

  const createResRaw = await fetch(`${BASE_URL}/requests`, {
    method: 'POST',
    headers: headers, // FormData will auto-set Content-Type with boundary
    body: formData
  });
  const createRes = await createResRaw.json();

  if (!createRes.success) throw new Error('Create failed: ' + createRes.message);

  const reqId = createRes.id;
  console.log(`    Request created successfully! ID: ${reqId}, Capex No: ${createRes.capex_no}`);

  // 4. Approval Loop
  let currentStatus = 'Pending';
  
  while (currentStatus !== 'Approved' && currentStatus !== 'Rejected') {
    // Fetch request details
    const reqDetail = await fetch(`${BASE_URL}/requests/${reqId}`, { headers }).then(r => r.json()).then(r => r.data);
    currentStatus = reqDetail.status;
    
    if (currentStatus === 'Approved') {
       console.log(`[+] Request is fully APPROVED!`);
       break;
    }
    
    const activeLevel = reqDetail.active_approver;
    const activeEmp = reqDetail.active_approver_emp_no;
    
    console.log(`[4] Request is waiting at level '${activeLevel}' with employee '${activeEmp}'`);
    
    if (!activeEmp) {
      console.log(`[!] No active employee assigned for level ${activeLevel}. Cannot proceed automatically without a specific employee ID.`);
      break;
    }
    
    // Login as approver
    console.log(`    Logging in as approver (${activeEmp})...`);
    const approverToken = await login(activeEmp);
    const approverHeaders = { 
      Authorization: `Bearer ${approverToken}`,
      'Content-Type': 'application/json'
    };
    
    // Approve
    console.log(`    Approving request...`);
    const approveRes = await fetch(`${BASE_URL}/requests/${reqId}/approve`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ comment: `E2E automated approval at level ${activeLevel}` })
    }).then(r => r.json());
    
    if (!approveRes.success) throw new Error('Approve failed: ' + approveRes.message);
    
    console.log(`    Approved!`);
  }
  
  console.log('--- E2E Flow Complete ---');
}

runE2E().catch(err => {
  console.error('E2E failed:', err);
});
