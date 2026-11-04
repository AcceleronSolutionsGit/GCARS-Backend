/**
 * G-CARS 2 — Security Regression & VAPT Verification Script
 * 
 * Verifies that all defensive patches from the VAPT report are functioning:
 * 1. SEC-01: BFLA authorization guard blocks unauthorized users from approving/rejecting requests (403)
 * 2. SEC-03: Direct unauthenticated access to /uploads is rejected (401)
 * 3. SEC-04: Helmet security headers (X-Content-Type-Options: nosniff, etc.) are present
 * 4. SEC-05: Non-admin users cannot access POST /api/masters/quarterly-budgets (403)
 * 5. SEC-06: Authenticated retrieval of attachments with query token succeeds
 */

const API_BASE = process.env.API_URL || 'http://localhost:5040/api';
const ROOT_BASE = API_BASE.replace(/\/api\/?$/, '');

async function req(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

async function run() {
  console.log('================================================================');
  console.log(`🛡️  Running G-CARS 2 Security Patch Verification against: ${API_BASE}`);
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`   ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`   ❌ FAIL: ${message}`);
    }
  }

  // ── TEST 1: Helmet & Security Headers ─────────────────────────
  console.log('🔍 Test 1: Checking HTTP Security Headers (Helmet)...');
  const healthRes = await req(`${API_BASE}/health`, { method: 'GET' });
  const nosniff = healthRes.headers.get('x-content-type-options');
  assert(nosniff === 'nosniff', `X-Content-Type-Options header is "${nosniff}" (expected: nosniff)`);
  assert(healthRes.headers.get('x-dns-prefetch-control') === 'off', 'X-DNS-Prefetch-Control header configured');

  // ── TEST 2: Unauthenticated Upload Access (SEC-03) ────────────
  console.log('\n🔒 Test 2: Checking Upload Access Control (SEC-03)...');
  const uploadNoAuth = await req(`${ROOT_BASE}/uploads/DOC-sample.pdf`, { method: 'GET' });
  assert(uploadNoAuth.status === 401, `Unauthenticated /uploads request returned ${uploadNoAuth.status} (expected: 401)`);
  assert(uploadNoAuth.data.message === 'No token provided', `Received message: "${uploadNoAuth.data.message}"`);

  // ── TEST 3: Authenticate Test Users ───────────────────────────
  console.log('\n🔑 Test 3: Authenticating Users...');
  const saLogin = await req(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: 'superadmin@gainwellindia.com', password: '12345' })
  });
  assert(saLogin.status === 200 && saLogin.data.token, 'Superadmin logged in successfully');
  const saToken = saLogin.data.token;

  const empLogin = await req(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: '7530', password: 'Dpscl1234' })
  });
  assert(empLogin.status === 200 && empLogin.data.token, 'Standard employee (7530 - Sanjib Chandra) logged in successfully');
  const empToken = empLogin.data.token;

  // ── TEST 4: Master Quarterly Budget Authorization (SEC-05) ────
  console.log('\n💰 Test 4: Testing Master Budget Tampering Protection (SEC-05)...');
  const budgetTamper = await req(`${API_BASE}/masters/quarterly-budgets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ year: 2026, quarter: 'Q1', category: 'IT', amount: 999999999, allow_overflow: 1 })
  });
  assert(budgetTamper.status === 403, `Non-admin attempt to upsert quarterly budget returned ${budgetTamper.status} (expected: 403 Forbidden)`);

  const budgetAdmin = await req(`${API_BASE}/masters/quarterly-budgets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ year: 2026, quarter: 'Q4', category: 'IT', amount: 15000000, allow_overflow: 1 })
  });
  assert(budgetAdmin.status === 200, `Admin quarterly budget upsert succeeded (${budgetAdmin.status} OK)`);

  // ── TEST 5: Turn-Order Authorization Guard (SEC-01) ───────────
  console.log('\n🛑 Test 5: Testing Broken Function Level Authorization in Approvals (SEC-01)...');
  // Create test request as Super Admin
  const createRes = await req(`${API_BASE}/requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({
      asset_name: 'Security Verification Asset',
      asset_description: 'VAPT Security test capex item',
      asset_type: 1,
      asset_quantity: 1,
      amount_ext_gst: 50000,
      budget_type: 1,
      budget_allocation_id: 1453,
      request_type: 'CAPEX',
      procurement: 'Indigenous',
      expected_date: '2026-12-31'
    })
  });
  assert(createRes.status === 201 && createRes.data.id, `Created test request ID ${createRes.data.id} (${createRes.data.capex_no})`);
  const testReqId = createRes.data.id;

  // Employee 7530 is a standard employee, NOT the supervisor or finance approver.
  // Attempting to approve without holding the role must be BLOCKED with 403 Forbidden.
  const unauthorizedApprove = await req(`${API_BASE}/requests/${testReqId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ comment: 'Unauthorized approval attempt by employee 7530' })
  });
  assert(unauthorizedApprove.status === 403, `Unauthorized approval attempt returned ${unauthorizedApprove.status} (expected: 403 Forbidden)`);
  assert(unauthorizedApprove.data.message.includes('Forbidden') || unauthorizedApprove.data.message.includes('authorized'), 
         `Rejection message: "${unauthorizedApprove.data.message}"`);

  // Unauthorized rejection attempt must also be BLOCKED with 403 Forbidden.
  const unauthorizedReject = await req(`${API_BASE}/requests/${testReqId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ comment: 'Unauthorized reject attempt by employee 7530' })
  });
  assert(unauthorizedReject.status === 403, `Unauthorized rejection attempt returned ${unauthorizedReject.status} (expected: 403 Forbidden)`);

  // Authorized Superadmin CAN approve and advance the request
  const adminApprove = await req(`${API_BASE}/requests/${testReqId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ comment: 'Authorized approval by Superadmin' })
  });
  assert(adminApprove.status === 200, `Authorized admin approval returned ${adminApprove.status} (expected: 200 OK)`);

  // ── TEST 6: Authenticated Upload Download with Token (SEC-03) ──
  console.log('\n📄 Test 6: Testing Authenticated Upload Retrieval with Token (SEC-03)...');
  const uploadWithToken = await req(`${ROOT_BASE}/uploads/DOC-sample.pdf?token=${saToken}`, { method: 'GET' });
  // Should return 404 (file doesn't exist) rather than 401 (unauthorized)!
  assert(uploadWithToken.status === 404, `Token authenticated successfully in upload endpoint (status: ${uploadWithToken.status} Attachment not found)`);

  console.log('\n================================================================');
  console.log(`🎉 SECURITY VERIFICATION SUMMARY: ${passed} / ${total} CHECKS PASSED (${Math.round(passed / total * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error during security test:', err);
  process.exit(1);
});
