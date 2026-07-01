/* ============================================================
   TFP MIS · IT Lending — Constants & Config
   (Data now lives in Google Sheets — see js/app.js SCRIPT_URL)
   ============================================================ */

// ---- Dropdown option lists ----
const DEPARTMENTS = [
  'MIS', 'HR', 'ACC', 'IMP', 'MTN', 'OEM', 'EXP', 'AFTER', 'R&D',
  'PDC', 'CRC', 'QDS', 'SOD', 'PLN', 'PRO', 'QC', 'STR', 'COS', 'MD',
];

const FACTORIES = ['CEN', 'TFI-E', 'EL', 'NEX', 'SL', 'AFT', 'YTT'];

const DEVICE_TYPES = [
  'Laptop', 'Monitor', 'PC', 'Printer', 'Tablet', 'Mouse', 'Keyboard',
];

// ---- Status constants (must match values written to the sheet) ----
const STATUS = {
  BORROWED: 'กำลังยืม',
  RETURNED: 'คืนแล้ว',
};

// ---- Static login accounts (frontend check only) ----
const ACCOUNTS = {
  admin: { username: 'admin', password: 'mis7day', role: 'admin' },
  tfp:   { username: 'tfp',   password: 'tfp2569', role: 'user'  },
};
