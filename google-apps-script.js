/* ============================================================
   TFP MIS · IT Lending — Google Apps Script Backend
   ------------------------------------------------------------
   Web App endpoint for the SPA (index.html).
   Columns (in this exact order):
     ID | Timestamp | Name | Department | Factory | Category |
     Brand | BorrowDate | ReturnDate | ActualReturnDate | Status

   HOW TO DEPLOY
   1. Open https://sheets.google.com and create a new spreadsheet.
   2. Extensions ▸ Apps Script — delete the sample code and paste ALL of this file.
   3. (Optional) Set SHEET_NAME below to match your tab name (default "Sheet1").
   4. Save, then Deploy ▸ New deployment ▸ type "Web app".
        - Execute as:  Me
        - Who has access:  Anyone
   5. Copy the Web App URL (ends with /exec) and paste it into
      js/app.js  →  const SCRIPT_URL = '...';
   6. Run setup() once (Run ▸ setup) to create the header row, or it will be
      created automatically on the first request.
   ============================================================ */

const SHEET_NAME = 'Sheet1';
const HEADERS = [
  'ID', 'Timestamp', 'Name', 'Department', 'Factory', 'Category',
  'Brand', 'AssetId', 'BorrowDate', 'ReturnDate', 'ActualReturnDate', 'Status',
];

// Column indexes (1-based) for convenience
const COL = {
  ID: 1, TIMESTAMP: 2, NAME: 3, DEPARTMENT: 4, FACTORY: 5, CATEGORY: 6,
  BRAND: 7, ASSET_ID: 8, BORROW_DATE: 9, RETURN_DATE: 10, ACTUAL_RETURN_DATE: 11, STATUS: 12,
};

const STATUS_BORROWED = 'กำลังยืม';
const STATUS_RETURNED = 'คืนแล้ว';

// ------------------------------------------------------------
//  ENTRY POINTS
// ------------------------------------------------------------

/** GET → return all records as JSON. */
function doGet() {
  return handle(function () {
    return { ok: true, data: getAllRecords() };
  });
}

/** POST → create / return / update, dispatched by `action`. */
function doPost(e) {
  return handle(function () {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Empty request body');
    }
    const body = JSON.parse(e.postData.contents);

    switch (body.action) {
      case 'create':
        return { ok: true, data: createRecord(body.record || {}) };
      case 'return':
        return { ok: true, data: markReturned(body.id, body.actualReturnDate) };
      case 'update':
        return { ok: true, data: updateRecord(body.record || {}) };
      default:
        throw new Error('Unknown action: ' + body.action);
    }
  });
}

// ------------------------------------------------------------
//  ACTIONS
// ------------------------------------------------------------

function getAllRecords() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // only header (or empty)

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row[COL.ID - 1] === '' && row[COL.NAME - 1] === '') continue; // skip blanks
    const obj = {};
    for (let c = 0; c < HEADERS.length; c++) {
      obj[HEADERS[c]] = formatCell(row[c]);
    }
    out.push(obj);
  }
  return out;
}

function createRecord(rec) {
  const sheet = getSheet();
  const id = nextId(sheet);
  const timestamp = Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd HH:mm:ss');

  sheet.appendRow([
    id,
    timestamp,
    str(rec.Name),
    str(rec.Department),
    str(rec.Factory),
    str(rec.Category),
    str(rec.Brand),
    str(rec.AssetId),      // รหัสทรัพย์สิน
    str(rec.BorrowDate),
    str(rec.ReturnDate),   // กำหนดวันคืน
    '',                    // ActualReturnDate — empty until returned
    STATUS_BORROWED,       // initial status
  ]);
  return { ID: id };
}

function markReturned(id, actualReturnDate) {
  const sheet = getSheet();
  const row = findRowById(sheet, id);
  if (row < 0) throw new Error('ID not found: ' + id);

  const dateStr = actualReturnDate || Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd');
  sheet.getRange(row, COL.ACTUAL_RETURN_DATE).setValue(dateStr);
  sheet.getRange(row, COL.STATUS).setValue(STATUS_RETURNED);
  return { ID: id };
}

function updateRecord(rec) {
  const sheet = getSheet();
  const row = findRowById(sheet, rec.ID);
  if (row < 0) throw new Error('ID not found: ' + rec.ID);

  sheet.getRange(row, COL.NAME).setValue(str(rec.Name));
  sheet.getRange(row, COL.DEPARTMENT).setValue(str(rec.Department));
  sheet.getRange(row, COL.FACTORY).setValue(str(rec.Factory));
  sheet.getRange(row, COL.CATEGORY).setValue(str(rec.Category));
  sheet.getRange(row, COL.BRAND).setValue(str(rec.Brand));
  sheet.getRange(row, COL.ASSET_ID).setValue(str(rec.AssetId));
  sheet.getRange(row, COL.BORROW_DATE).setValue(str(rec.BorrowDate));
  sheet.getRange(row, COL.RETURN_DATE).setValue(str(rec.ReturnDate));

  const status = rec.Status || STATUS_BORROWED;
  sheet.getRange(row, COL.STATUS).setValue(status);

  // Keep ActualReturnDate consistent with status.
  if (status === STATUS_RETURNED) {
    const current = sheet.getRange(row, COL.ACTUAL_RETURN_DATE).getValue();
    if (!current) {
      const dateStr = rec.ActualReturnDate ||
        Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd');
      sheet.getRange(row, COL.ACTUAL_RETURN_DATE).setValue(dateStr);
    }
  } else {
    sheet.getRange(row, COL.ACTUAL_RETURN_DATE).setValue('');
  }
  return { ID: rec.ID };
}

// ------------------------------------------------------------
//  HELPERS
// ------------------------------------------------------------

/** Get the target sheet, creating it + the header row if needed. */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Next auto-increment integer ID (max existing + 1). */
function nextId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const ids = sheet.getRange(2, COL.ID, lastRow - 1, 1).getValues();
  let max = 0;
  for (let i = 0; i < ids.length; i++) {
    const n = Number(ids[i][0]);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/** Find the 1-based row number whose ID matches; -1 if not found. */
function findRowById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, COL.ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // +2: skip header + 0-index
  }
  return -1;
}

/** Convert a cell value into a JSON-friendly string (dates → yyyy-MM-dd). */
function formatCell(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  }
  return v;
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

function tz() {
  return Session.getScriptTimeZone() || 'Asia/Bangkok';
}

/** Wrap a unit of work, always returning a JSON ContentService response. */
function handle(fn) {
  try {
    return json(fn());
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
//  ONE-TIME SETUP (optional) — Run ▸ setup
// ------------------------------------------------------------
function setup() {
  getSheet(); // ensures the sheet + header row exist
}
