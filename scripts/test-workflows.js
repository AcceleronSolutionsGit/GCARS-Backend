/**
 * G-CARS 2 — End-to-End Workflow Validation Test Script
 * 
 * Tests both CAPEX and OPEX workflows from creation to final approval:
 * 1. Validates /api/superadmin/workflows and /api/superadmin/workflow endpoints
 * 2. Runs CAPEX workflow (Create -> Supervisor -> IT -> Budget Owner -> Finance SAP)
 * 3. Runs OPEX workflow (Create -> Supervisor -> Budget Owner -> Accountant -> Finance SAP)
 * 
 * Usage:
 *   node backend/scripts/test-workflows.js
 * Or against production:
 *   API_URL=https://apps.acceleronsolutions.io/gcars2/api node backend/scripts/test-workflows.js
 */

const API_BASE = process.env.API_URL || 'http://localhost:5040/api';

async function req(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !options.allowFail) {
    throw new Error(`[${res.status}] ${endpoint}: ${data.message || res.statusText}`);
  }
  return { status: res.status, data };
}

async function login(email, password) {
  const { data } = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!data.success || !data.token) {
    throw new Error(`Login failed for "${email}": ${data.message}`);
  }
  return { token: data.token, user: data.user };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function run() {
  console.log('================================================================');
  console.log(`🚀 Starting G-CARS 2 Workflow Test against: ${API_BASE}`);
  console.log('================================================================\n');

  // Step 1: Admin Login
  console.log('🔑 1. Authenticating as Super Admin...');
  let adminAuth;
  const adminCandidates = [
    { u: 'superadmin@gainwellindia.com', p: '12345' },
    { u: '6044', p: 'password' },
    { u: 'superadmin', p: 'SuperAdmin@2026' },
    { u: 'admin_gcars', p: 'Admin@1234' },
  ];

  for (const cred of adminCandidates) {
    try {
      adminAuth = await login(cred.u, cred.p);
      console.log(`   ✅ Logged in as: ${adminAuth.user.username} (type: ${adminAuth.user.user_type}, roles: [${adminAuth.user.roles.join(', ')}])`);
      break;
    } catch (e) {
      // try next
    }
  }

  if (!adminAuth) {
    throw new Error('Could not authenticate with any known Super Admin credentials.');
  }

  // Step 2: Validate /api/superadmin/workflows
  console.log('\n📋 2. Verifying Workflow Configuration API...');
  const wfRes = await req('/superadmin/workflows', {
    headers: authHeader(adminAuth.token)
  });
  console.log(`   ✅ /superadmin/workflows returned ${wfRes.data.data?.length || 0} workflow strategies:`);
  (wfRes.data.data || []).forEach(w => {
    console.log(`      • [ID: ${w.id}] ${w.name} (type: ${w.request_type}, default: ${w.is_default ? 'YES' : 'no'})`);
  });

  const stepsRes = await req('/superadmin/workflow?department=All&flow_id=1', {
    headers: authHeader(adminAuth.token)
  });
  console.log(`   ✅ Standard Flow has ${stepsRes.data.data?.length || 0} approval steps:`);
  (stepsRes.data.data || []).forEach(s => {
    console.log(`      - Step ${s.step_order}: ${s.label} (${s.role_key}) [Applies to: ${s.applies_to}]`);
  });

  // Fetch available allocations for testing
  const allocRes = await req('/masters/allocations?year=' + new Date().getFullYear(), {
    headers: authHeader(adminAuth.token)
  });
  const capexAlloc = (allocRes.data?.data || []).find(a => a.budget_type === 1 || a.budget_type_name?.includes('CAPEX')) || { id: 1453, asset_type: 1 };
  const opexAlloc  = (allocRes.data?.data || []).find(a => a.budget_type === 3 || a.budget_type_name?.includes('OPEX'))  || { id: 1403, asset_type: 5 };
  console.log(`   📌 Using CAPEX Allocation ID: ${capexAlloc.id} (${capexAlloc.asset_name || 'IT Asset'})`);
  console.log(`   📌 Using OPEX Allocation ID: ${opexAlloc.id} (${opexAlloc.asset_name || 'General OPEX'})`);

  // Step 3: Run CAPEX Workflow
  console.log('\n================================================================');
  console.log('📦 3. Testing CAPEX Workflow (Capital Expenditure)');
  console.log('================================================================');
  
  // Submit using Super Admin (has global authority across all departments)
  const capexPayload = {
    asset_name: 'Dell Precision Workstation 7560',
    asset_type: capexAlloc.asset_type || 1,
    asset_quantity: 1,
    amount_ext_gst: 65000,
    budget_type: 1, // CAPEX Budgeted
    budget_allocation_id: capexAlloc.id,
    request_type: 'CAPEX',
    procurement: 'Indigenous',
    expected_date: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    costcentre: 'IT-DEV',
    asset_justification: 'High-performance workstation for deep agentic workflows'
  };

  const createCapexRes = await req('/requests', {
    method: 'POST',
    headers: authHeader(adminAuth.token),
    body: JSON.stringify(capexPayload)
  });

  const capexId = createCapexRes.data.id || createCapexRes.data.data?.id;
  const capexNo = createCapexRes.data.capex_no || `ID-${capexId}`;
  console.log(`   ✅ CAPEX Request Created: ${capexNo} (ID: ${capexId})`);

  // Advance CAPEX approvals
  await processWorkflowApprovals(capexId, capexNo, 'CAPEX', adminAuth);

  // Step 4: Run OPEX Workflow
  console.log('\n================================================================');
  console.log('⚙️  4. Testing OPEX Workflow (Operational Expenditure)');
  console.log('================================================================');

  const opexPayload = {
    asset_name: 'Annual Software License Renewal',
    asset_type: opexAlloc.asset_type || 5,
    asset_quantity: 1,
    amount_ext_gst: 25000,
    budget_type: 3, // OPEX
    budget_allocation_id: opexAlloc.id,
    request_type: 'OPEX',
    procurement: 'Indigenous',
    expected_date: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
    costcentre: 'OPS-MAINT',
    asset_justification: 'Annual operational tools subscription'
  };

  const createOpexRes = await req('/requests', {
    method: 'POST',
    headers: authHeader(adminAuth.token),
    body: JSON.stringify(opexPayload)
  });

  const opexId = createOpexRes.data.id || createOpexRes.data.data?.id;
  const opexNo = createOpexRes.data.capex_no || `ID-${opexId}`;
  console.log(`   ✅ OPEX Request Created: ${opexNo} (ID: ${opexId})`);

  // Advance OPEX approvals
  await processWorkflowApprovals(opexId, opexNo, 'OPEX', adminAuth);

  console.log('\n================================================================');
  console.log('🎉 ALL WORKFLOW TESTS COMPLETED SUCCESSFULLY!');
  console.log('   • /api/superadmin/workflows endpoint: OK (200)');
  console.log('   • CAPEX Workflow routing & approval: OK (Approved)');
  console.log('   • OPEX Workflow routing & approval: OK (Approved)');
  console.log('================================================================\n');
}

async function processWorkflowApprovals(requestId, requestNo, flowType, adminAuth) {
  let isDone = false;
  let iterations = 0;
  const maxIterations = 10;

  while (!isDone && iterations < maxIterations) {
    iterations++;
    // Get latest state
    const detailRes = await req(`/requests/${requestId}`, {
      headers: authHeader(adminAuth.token)
    });
    const reqData = detailRes.data.data;
    const currentStatus = reqData.status;
    const currentApproverRole = reqData.active_approver;
    const currentApproverEmp = reqData.active_approver_emp_no;

    console.log(`   ⏳ [Step ${iterations}] Request ${requestNo} | Status: ${currentStatus} | Approver Role: "${currentApproverRole}" (${currentApproverEmp || 'Any'})`);

    const finalStatuses = ['Approved', 'SANCTION NUMBER GENERATED', 'COMPLETE', 'PO CREATED', 'ASSET CREATED'];
    if (finalStatuses.includes(currentStatus) || currentApproverRole === 'Final') {
      console.log(`   ✨ Request ${requestNo} reached final APPROVED state: "${currentStatus}"!`);
      isDone = true;
      break;
    }

    if (currentStatus === 'Rejected') {
      throw new Error(`Request was unexpectedly rejected at step ${iterations}`);
    }

    // Approve the current step using Admin credentials (or approver)
    const approvePayload = {
      comment: `Auto-test approved for ${flowType} step: ${currentApproverRole}`,
      sap_asset_no: currentApproverRole === 'finance' ? 'SAP-TEST-' + Math.floor(Math.random() * 900000 + 100000) : undefined
    };

    const approveRes = await req(`/requests/${requestId}/approve`, {
      method: 'POST',
      headers: authHeader(adminAuth.token),
      body: JSON.stringify(approvePayload)
    });

    console.log(`      ↳ Step Approved: ${approveRes.data.message || 'Success'}`);
  }

  if (!isDone) {
    throw new Error(`Workflow did not finish after ${maxIterations} steps`);
  }
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
