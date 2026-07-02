/* ============================================================
   TFP MIS · IT Lending — App Logic (Google Sheets backend)
   Talks to a Google Apps Script Web App via Fetch API.
   ============================================================ */

// ⬇⬇⬇  วาง URL ของ Apps Script Web App (ที่ลงท้ายด้วย /exec) ตรงนี้  ⬇⬇⬇
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzQBN-v-aKAofMWTjQGCb9MHWUyLLeE-N_3Ylan1Wk78XG75rrP0i8YeAolv1GiIb82tA/exec';
// ⬆⬆⬆  ------------------------------------------------------  ⬆⬆⬆

const SESSION_KEY = 'tfp_mis_session';

// หน้า User: "ประวัติการยืมล่าสุด" จะโชว์เฉพาะรายการที่เพิ่งบันทึก
// ภายในช่วงเวลานี้ (นับจากตอนกดบันทึกสำเร็จ) แล้วหมดอายุไปเอง
const RECENT_WINDOW_MS = 30 * 1000;
const LAST_SAVED_KEY = 'tfp_mis_last_saved';

// In-memory cache of the latest records fetched from the sheet.
// (Filtering/search on the admin page renders from this cache — no refetch.)
let records = [];

// ---------- Tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function formatThaiDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

function isConfigured() {
  return SCRIPT_URL && SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL';
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.style.borderColor = isError ? '#f43f5e' : 'var(--neon)';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function statusBadge(status) {
  if (status === STATUS.RETURNED) {
    return `<span class="badge badge-returned">🟢 ${status}</span>`;
  }
  return `<span class="badge badge-borrowed">🟠 ${status}</span>`;
}

/**
 * Validate a return (due) date.
 * Rules: must be today or in the future, and not earlier than the borrow date.
 * Returns an error message string, or '' when valid.
 */
function validateDueDate(borrowDate, dueDate) {
  if (!dueDate) return '⚠ กรุณาเลือกวันที่คืน';
  const today = todayISO();
  if (dueDate < today) return '⚠ วันที่คืนต้องเป็นวันปัจจุบันหรือวันในอนาคตเท่านั้น';
  if (borrowDate && dueDate < borrowDate) return '⚠ วันที่คืนต้องไม่เกิดก่อนวันที่เริ่มยืม';
  return '';
}

// ============================================================
//  API LAYER (Fetch → Google Apps Script)
// ============================================================

/** Normalise a sheet row (header-keyed) into the shape the UI uses. */
function normalizeRecord(o) {
  const toISO = (v) => {
    if (!v) return null;
    const s = String(v);
    // Accept 'YYYY-MM-DD' or full ISO datetime, keep just the date part.
    if (s.length >= 10 && s[4] === '-' && s[7] === '-') return s.slice(0, 10);
    return s;
  };
  return {
    id: o.ID,
    borrower: o.Name || '',
    department: o.Department || '',
    factory: o.Factory || '',
    deviceType: o.Category || '',
    model: o.Brand || '',
    assetId: o.AssetId || '',
    borrowDate: toISO(o.BorrowDate),
    dueDate: toISO(o.ReturnDate),        // ReturnDate column = กำหนดวันคืน
    returnDate: toISO(o.ActualReturnDate), // ActualReturnDate = วันที่คืนจริง
    status: o.Status || STATUS.BORROWED,
    timestamp: o.Timestamp || '',
  };
}

async function apiGet() {
  const res = await fetch(SCRIPT_URL, { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.ok === false) throw new Error(json.error || 'API error');
  return json.data || [];
}

async function apiPost(payload) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    // text/plain is a "simple" content-type → avoids a CORS preflight that
    // Google Apps Script cannot answer. The body is still JSON we parse server-side.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.ok === false) throw new Error(json.error || 'API error');
  return json.data;
}

/** Fetch everything from the sheet, cache it, then re-render the active page. */
async function loadData() {
  const session = getSession();
  if (!session) return;

  if (!isConfigured()) {
    renderConfigWarning();
    return;
  }

  showLoading();
  try {
    const raw = await apiGet();
    records = raw.map(normalizeRecord);
    refreshView();
  } catch (err) {
    renderError(err);
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, true);
  }
}

// ============================================================
//  SESSION / ROUTING
// ============================================================
function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function route() {
  const session = getSession();
  const loginView = $('#view-login');
  const appView = $('#view-app');
  const pageUser = $('#page-user');
  const pageAdmin = $('#page-admin');

  if (!session) {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    return;
  }

  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  $('#current-user').textContent = session.username;

  if (session.role === 'admin') {
    $('#role-label').textContent = 'ADMIN · CONTROL CENTER';
    pageUser.classList.add('hidden');
    pageAdmin.classList.remove('hidden');
  } else {
    $('#role-label').textContent = 'USER · แบบฟอร์มยืมอุปกรณ์';
    pageAdmin.classList.add('hidden');
    pageUser.classList.remove('hidden');
  }

  // Pull fresh data from the sheet for whichever page is now visible.
  loadData();
}

/** Render whichever page matches the current session (from cached `records`). */
function refreshView() {
  const session = getSession();
  if (!session) return;
  if (session.role === 'admin') renderAdmin();
  else renderUserHistory();
}

// ============================================================
//  LOGIN
// ============================================================
function handleLogin(e) {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const errorEl = $('#login-error');

  const acc = Object.values(ACCOUNTS).find(
    (a) => a.username === username && a.password === password
  );

  if (!acc) {
    errorEl.textContent = '✖ ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  setSession({ username: acc.username, role: acc.role, loginAt: Date.now() });
  $('#login-form').reset();
  route();
  showToast(`ยินดีต้อนรับ, ${acc.username} 👋`);
}

function handleLogout() {
  clearSession();
  records = [];
  route();
  showToast('ออกจากระบบเรียบร้อย');
}

// ============================================================
//  USER — Borrow form + history
// ============================================================
async function handleBorrowSubmit(e) {
  e.preventDefault();
  const session = getSession();
  if (!session) return;

  if (!isConfigured()) {
    showToast('ยังไม่ได้ตั้งค่า SCRIPT_URL — โปรดใส่ URL ของ Apps Script ก่อน', true);
    return;
  }

  const form = e.target;
  const fd = new FormData(form);
  const borrowDate = fd.get('borrowDate');
  const dueDate = fd.get('dueDate');

  const err = validateDueDate(borrowDate, dueDate);
  if (err) {
    showToast(err, true);
    return;
  }

  const record = {
    Name: fd.get('borrower').trim(),
    Department: fd.get('department'),
    Factory: fd.get('factory'),
    Category: fd.get('deviceType'),
    Brand: fd.get('model').trim(),
    AssetId: (fd.get('assetId') || '').trim(),
    BorrowDate: borrowDate,
    ReturnDate: dueDate,
  };

  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true, 'กำลังบันทึก...');
  try {
    const created = await apiPost({ action: 'create', record });
    if (created && created.ID != null) rememberLastSaved(created.ID);
    form.reset();
    showToast('บันทึกคำขอยืมเรียบร้อย ✅');
    await loadData();
  } catch (ex) {
    showToast('บันทึกไม่สำเร็จ: ' + ex.message, true);
  } finally {
    setBusy(btn, false);
  }
}

/** เก็บ ID + เวลาที่บันทึกล่าสุดไว้ใน localStorage (รอด refresh, หมดอายุตาม RECENT_WINDOW_MS) */
function rememberLastSaved(id) {
  localStorage.setItem(LAST_SAVED_KEY, JSON.stringify({ id: String(id), savedAt: Date.now() }));
}

/** คืน { id, remaining } ของรายการที่เพิ่งบันทึกถ้ายังอยู่ในช่วง 30 วิ, ไม่งั้นคืน null */
function getRecentSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_SAVED_KEY));
    if (!v || v.id == null) return null;
    const remaining = RECENT_WINDOW_MS - (Date.now() - v.savedAt);
    if (remaining <= 0) return null;
    return { id: String(v.id), remaining };
  } catch {
    return null;
  }
}

function renderUserHistory() {
  const body = $('#user-history-body');
  const cards = $('#user-history-cards');

  // แสดงเฉพาะรายการที่เพิ่งบันทึกภายใน 30 วิ (จับจาก ID จริง ไม่ใช่เดาจากเวลา)
  clearTimeout(renderUserHistory._t);
  const recent = getRecentSaved();
  const list = recent ? records.filter((r) => String(r.id) === recent.id) : [];

  if (list.length === 0) {
    const msg = recent
      ? '— ไม่พบรายการที่เพิ่งบันทึก —'
      : '— แสดงเฉพาะรายการที่เพิ่งบันทึก (ภายใน 30 วินาที) —';
    body.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-500">${msg}</td></tr>`;
    cards.innerHTML = `<div class="neon-card rounded-2xl bg-slate-800/50 py-8 text-center text-slate-500">${msg}</div>`;
    return;
  }

  // พอครบ 30 วิให้ re-render เพื่อล้างรายการออกเอง (แม้ผู้ใช้ไม่ได้ refresh)
  renderUserHistory._t = setTimeout(renderUserHistory, recent.remaining + 100);

  // Desktop / tablet table rows
  body.innerHTML = list
    .map(
      (r) => `
      <tr>
        <td class="px-4 py-3 font-medium">${r.borrower}</td>
        <td class="px-4 py-3">${r.deviceType}</td>
        <td class="px-4 py-3 text-slate-300">${r.model}</td>
        <td class="px-4 py-3">${r.department}</td>
        <td class="px-4 py-3">${r.factory}</td>
        <td class="px-4 py-3">${formatThaiDate(r.borrowDate)}</td>
        <td class="px-4 py-3">${formatThaiDate(r.dueDate)}</td>
        <td class="px-4 py-3">${statusBadge(r.status)}</td>
      </tr>`
    )
    .join('');

  // Mobile card layout
  cards.innerHTML = list
    .map(
      (r) => `
      <div class="neon-card rounded-2xl p-4 bg-slate-800/50">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div>
            <div class="font-semibold text-base">${r.deviceType}</div>
            <div class="text-slate-400 text-sm">${r.model}</div>
          </div>
          ${statusBadge(r.status)}
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <div><span class="text-slate-500">ผู้ยืม:</span> ${r.borrower}</div>
          <div><span class="text-slate-500">แผนก:</span> ${r.department}</div>
          <div><span class="text-slate-500">โรงงาน:</span> ${r.factory}</div>
          <div><span class="text-slate-500">วันที่ยืม:</span> ${formatThaiDate(r.borrowDate)}</div>
          <div><span class="text-slate-500">กำหนดวันคืน:</span> ${formatThaiDate(r.dueDate)}</div>
        </div>
      </div>`
    )
    .join('');
}

// ============================================================
//  ADMIN — Dashboard + table + actions
// ============================================================
function updateStats() {
  const total = records.length;
  const borrowed = records.filter((r) => r.status === STATUS.BORROWED).length;
  const returned = records.filter((r) => r.status === STATUS.RETURNED).length;
  $('#stat-total').textContent = total;
  $('#stat-borrowed').textContent = borrowed;
  $('#stat-returned').textContent = returned;
}

function getFilteredRecords() {
  const q = $('#admin-search').value.trim().toLowerCase();
  const status = $('#admin-filter-status').value;
  return records.filter((r) => {
    const matchStatus = status === 'all' || r.status === status;
    const matchQ =
      !q ||
      r.borrower.toLowerCase().includes(q) ||
      r.deviceType.toLowerCase().includes(q) ||
      r.model.toLowerCase().includes(q);
    return matchStatus && matchQ;
  });
}

function renderAdmin() {
  updateStats();

  const body = $('#admin-table-body');
  const empty = $('#admin-empty');
  const rows = getFilteredRecords();

  if (rows.length === 0) {
    body.innerHTML = '';
    empty.textContent = records.length === 0 ? '— ยังไม่มีข้อมูลในระบบ —' : '— ไม่พบข้อมูลตามเงื่อนไข —';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  body.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td class="px-4 py-3 text-slate-500 hidden md:table-cell">${r.id}</td>
        <td class="px-4 py-3 font-medium whitespace-nowrap">${r.borrower}</td>
        <td class="px-4 py-3">${r.department}</td>
        <td class="px-4 py-3 hidden sm:table-cell">${r.factory}</td>
        <td class="px-4 py-3">${r.deviceType}</td>
        <td class="px-4 py-3 text-slate-300 whitespace-nowrap">${r.model}</td>
        <td class="px-4 py-3 whitespace-nowrap">${formatThaiDate(r.borrowDate)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${formatThaiDate(r.dueDate)}</td>
        <td class="px-4 py-3 hidden md:table-cell whitespace-nowrap">${formatThaiDate(r.returnDate)}</td>
        <td class="px-4 py-3">${statusBadge(r.status)}</td>
        <td class="px-4 py-3">
          <div class="flex justify-end gap-2">
            ${
              r.status === STATUS.BORROWED
                ? `<button class="btn-action btn-return" data-return="${r.id}">✓ กดรับคืน</button>`
                : ''
            }
            <button class="btn-action btn-edit" data-edit="${r.id}">✏️ แก้ไข</button>
          </div>
        </td>
      </tr>`
    )
    .join('');
}

async function handleReceiveReturn(id, btn) {
  const rec = records.find((r) => String(r.id) === String(id));
  if (!rec) return;

  setBusy(btn, true, '...');
  try {
    await apiPost({ action: 'return', id, actualReturnDate: todayISO() });
    showToast(`รับคืน "${rec.deviceType} · ${rec.model}" แล้ว ✅`);
    await loadData();
  } catch (ex) {
    showToast('รับคืนไม่สำเร็จ: ' + ex.message, true);
    setBusy(btn, false);
  }
}

// ============================================================
//  EDIT MODAL
// ============================================================
function openEditModal(id) {
  const rec = records.find((r) => String(r.id) === String(id));
  if (!rec) return;

  const form = $('#edit-form');
  form.id.value = rec.id;
  form.borrower.value = rec.borrower;
  form.department.value = rec.department;
  form.factory.value = rec.factory;
  form.deviceType.value = rec.deviceType;
  form.model.value = rec.model;
  form.assetId.value = rec.assetId || '';
  form.borrowDate.value = rec.borrowDate || '';
  form.dueDate.value = rec.dueDate || '';
  form.status.value = rec.status;

  $('#edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  $('#edit-modal').classList.add('hidden');
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.id.value;

  const borrowDate = form.borrowDate.value;
  const dueDate = form.dueDate.value;
  if (dueDate && borrowDate && dueDate < borrowDate) {
    showToast('⚠ กำหนดวันคืนต้องไม่เกิดก่อนวันที่เริ่มยืม', true);
    return;
  }

  const record = {
    ID: id,
    Name: form.borrower.value.trim(),
    Department: form.department.value,
    Factory: form.factory.value,
    Category: form.deviceType.value,
    Brand: form.model.value.trim(),
    AssetId: (form.assetId.value || '').trim(),
    BorrowDate: borrowDate,
    ReturnDate: dueDate,
    Status: form.status.value,
  };

  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true, 'กำลังบันทึก...');
  try {
    await apiPost({ action: 'update', record });
    closeEditModal();
    showToast('บันทึกการแก้ไขเรียบร้อย ✅');
    await loadData();
  } catch (ex) {
    showToast('แก้ไขไม่สำเร็จ: ' + ex.message, true);
  } finally {
    setBusy(btn, false);
  }
}

// ============================================================
//  UI STATE HELPERS (loading / error / busy)
// ============================================================
function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = busyText || 'กำลังทำงาน...';
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

function showLoading() {
  const session = getSession();
  const loading = '⏳ กำลังโหลดข้อมูลจาก Google Sheets...';
  if (session && session.role === 'admin') {
    $('#admin-table-body').innerHTML =
      `<tr><td colspan="11" class="px-4 py-10 text-center text-slate-400">${loading}</td></tr>`;
    $('#admin-empty').classList.add('hidden');
  } else {
    $('#user-history-body').innerHTML =
      `<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400">${loading}</td></tr>`;
    $('#user-history-cards').innerHTML =
      `<div class="neon-card rounded-2xl bg-slate-800/50 py-8 text-center text-slate-400">${loading}</div>`;
  }
}

function renderError(err) {
  const session = getSession();
  const msg = `⚠ เชื่อมต่อไม่สำเร็จ (${err.message}) — ตรวจสอบ SCRIPT_URL และการ Deploy`;
  if (session && session.role === 'admin') {
    $('#admin-table-body').innerHTML =
      `<tr><td colspan="11" class="px-4 py-10 text-center text-rose-400">${msg}</td></tr>`;
  } else {
    $('#user-history-body').innerHTML =
      `<tr><td colspan="8" class="px-4 py-10 text-center text-rose-400">${msg}</td></tr>`;
    $('#user-history-cards').innerHTML =
      `<div class="neon-card rounded-2xl bg-slate-800/50 py-8 text-center text-rose-400">${msg}</div>`;
  }
}

function renderConfigWarning() {
  const session = getSession();
  const msg = '🔧 ยังไม่ได้ตั้งค่า SCRIPT_URL — เปิด js/app.js แล้ววาง URL ของ Apps Script (ลงท้าย /exec)';
  if (session && session.role === 'admin') {
    updateStats();
    $('#admin-table-body').innerHTML =
      `<tr><td colspan="11" class="px-4 py-10 text-center text-amber-400">${msg}</td></tr>`;
    $('#admin-empty').classList.add('hidden');
  } else {
    $('#user-history-body').innerHTML =
      `<tr><td colspan="8" class="px-4 py-10 text-center text-amber-400">${msg}</td></tr>`;
    $('#user-history-cards').innerHTML =
      `<div class="neon-card rounded-2xl bg-slate-800/50 py-8 text-center text-amber-400">${msg}</div>`;
  }
}

// ============================================================
//  DROPDOWNS
// ============================================================
function fillSelect(select, items, placeholder) {
  select.innerHTML =
    `<option value="" disabled selected>${placeholder}</option>` +
    items.map((v) => `<option value="${v}">${v}</option>`).join('');
}

function initDropdowns() {
  fillSelect($('#borrow-form [name="department"]'), DEPARTMENTS, '— เลือกแผนก —');
  fillSelect($('#borrow-form [name="factory"]'), FACTORIES, '— เลือกโรงงาน —');
  fillSelect($('#borrow-form [name="deviceType"]'), DEVICE_TYPES, '— เลือกอุปกรณ์ —');
  fillSelect($('#edit-form [name="department"]'), DEPARTMENTS, '— เลือกแผนก —');
  fillSelect($('#edit-form [name="factory"]'), FACTORIES, '— เลือกโรงงาน —');
  fillSelect($('#edit-form [name="deviceType"]'), DEVICE_TYPES, '— เลือกอุปกรณ์ —');
}

// ============================================================
//  EVENT WIRING
// ============================================================
function init() {
  initDropdowns();

  const borrowInput = $('#borrow-form [name="borrowDate"]');
  const dueInput = $('#borrow-form [name="dueDate"]');

  function syncDueMin() {
    const today = todayISO();
    dueInput.min = borrowInput.value && borrowInput.value > today ? borrowInput.value : today;
  }

  borrowInput.value = todayISO();
  syncDueMin();

  // Login / logout
  $('#login-form').addEventListener('submit', handleLogin);
  $('#logout-btn').addEventListener('click', handleLogout);

  // User form
  $('#borrow-form').addEventListener('submit', handleBorrowSubmit);
  borrowInput.addEventListener('change', syncDueMin);
  $('#borrow-form').addEventListener('reset', () => {
    setTimeout(() => {
      borrowInput.value = todayISO();
      syncDueMin();
    }, 0);
  });

  // Admin filters (render from cache, no refetch)
  $('#admin-search').addEventListener('input', renderAdmin);
  $('#admin-filter-status').addEventListener('change', renderAdmin);

  // Admin table actions (event delegation)
  $('#admin-table-body').addEventListener('click', (e) => {
    const returnBtn = e.target.closest('[data-return]');
    const editBtn = e.target.closest('[data-edit]');
    if (returnBtn) handleReceiveReturn(returnBtn.dataset.return, returnBtn);
    if (editBtn) openEditModal(editBtn.dataset.edit);
  });

  // Edit modal
  $('#edit-form').addEventListener('submit', handleEditSubmit);
  $$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeEditModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEditModal();
  });

  // Initial route (also triggers first data load if logged in)
  route();
}

document.addEventListener('DOMContentLoaded', init);
