// ═══════════════════════════════════════════════════════════════
// Nessoo Renters — Google Sheets → Dashboard Live Sync
//
// HOW TO INSTALL:
// 1. Open your RENTERS Google Sheet
// 2. Click Extensions > Apps Script
// 3. Delete everything in the editor
// 4. Paste this entire file
// 5. Click Save
// 6. Select "syncAllRenters" and click Run
// 7. Authorize when prompted
// 8. Then select "installTrigger" and click Run (enables live sync)
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://xwwvlydkdjdxchgsksjv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3d3ZseWRrZGpkeGNoZ3Nrc2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMzY1NTIsImV4cCI6MjEwMzYxMjU1Mn0.3yHAj6AOIdfrcn8BB8oVZ11bmBwWiEXQ9eHQlz3d84U';

/**
 * STEP 1: Run this first to import all renters.
 */
function syncAllRenters() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let totalRenters = 0;

  for (const sheet of sheets) {
    const tabName = sheet.getName().trim();
    Logger.log('=== Processing tab: "' + tabName + '" ===');

    const count = syncRenterSheet(sheet);
    totalRenters += count;
    Logger.log('  → ' + count + ' renters synced');
  }

  Logger.log('DONE! ' + totalRenters + ' renters synced.');
  SpreadsheetApp.getUi().alert('Sync complete!\n\n' + totalRenters + ' renters synced.');
}

/**
 * STEP 2: Run this once to enable live sync.
 */
function installTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'onSheetEdit') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  SpreadsheetApp.getUi().alert('Live sync enabled!');
}

function onSheetEdit(e) {
  try {
    const sheet = e.source.getActiveSheet();
    syncRenterSheet(sheet);
  } catch (err) {
    Logger.log('Sync error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNC LOGIC — Vertical layout (headers in row 1, one renter per row)
// Columns: Name, Email, Size, Location, Budget, Extra
// ═══════════════════════════════════════════════════════════════

function syncRenterSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('  Sheet has less than 2 rows'); return 0; }

  // First row is headers
  const headers = data[0].map(h => String(h || '').trim().toLowerCase());
  Logger.log('  Headers: ' + headers.join(', '));

  const rows = data.slice(1);

  // Find column indexes
  const col = (name) => {
    let idx = headers.indexOf(name);
    if (idx !== -1) return idx;
    // Partial match
    idx = headers.findIndex(h => h.includes(name));
    return idx;
  };

  const nameCol = col('name');
  const emailCol = col('email');
  const sizeCol = col('size') !== -1 ? col('size') : col('bedroom') !== -1 ? col('bedroom') : col('bed');
  const locationCol = col('location') !== -1 ? col('location') : col('neighborhood');
  const budgetCol = col('budget') !== -1 ? col('budget') : col('price');
  const extraCol = col('extra') !== -1 ? col('extra') : col('note');
  const phoneCol = col('phone');
  const moveInCol = col('move') !== -1 ? col('move') : col('date');
  const statusCol = col('status');

  if (nameCol === -1) {
    Logger.log('  WARNING: No "Name" column found!');
    return 0;
  }

  // Delete all existing renters with source 'google_sheets' (full replace)
  supabaseRequest('DELETE', '/renters?source=eq.google_sheets');

  // Parse and insert renters
  const renters = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameCol] || '').trim();
    if (!name) continue; // Skip empty rows

    const email = emailCol !== -1 ? String(row[emailCol] || '').trim() : null;
    const phone = phoneCol !== -1 ? String(row[phoneCol] || '').trim() : null;

    // Parse size/bedrooms
    let bedrooms = null;
    if (sizeCol !== -1 && row[sizeCol]) {
      const sizeStr = String(row[sizeCol]).toLowerCase();
      if (sizeStr.includes('studio')) bedrooms = 0;
      else {
        const m = sizeStr.match(/(\d+)/);
        if (m) bedrooms = parseInt(m[1]);
      }
    }

    // Parse location/neighborhoods
    let neighborhoods = [];
    if (locationCol !== -1 && row[locationCol]) {
      const locStr = String(row[locationCol]);
      neighborhoods = locStr.split(/[,\n\/]/).map(n => n.trim()).filter(n => n.length > 0);
    }

    // Parse budget
    let budgetMin = null, budgetMax = null;
    if (budgetCol !== -1 && row[budgetCol]) {
      const budgetStr = String(row[budgetCol]).replace(/[$,]/g, '');
      // Try range: "1500-3000" or "1500 to 3000"
      const rangeMatch = budgetStr.match(/(\d+)\s*[-–to]+\s*(\d+)/i);
      if (rangeMatch) {
        budgetMin = parseInt(rangeMatch[1]);
        budgetMax = parseInt(rangeMatch[2]);
      } else {
        // Try single number as max
        const singleMatch = budgetStr.match(/(\d+)/);
        if (singleMatch) {
          budgetMax = parseInt(singleMatch[1]);
        }
      }
    }

    // Parse extra/notes
    const notes = extraCol !== -1 ? String(row[extraCol] || '').trim() : null;

    // Parse move-in date
    let moveInDate = null;
    if (moveInCol !== -1 && row[moveInCol]) {
      try {
        const d = new Date(row[moveInCol]);
        if (!isNaN(d.getTime())) moveInDate = d.toISOString().split('T')[0];
      } catch (e) {}
    }

    // Parse status
    let status = 'active';
    if (statusCol !== -1 && row[statusCol]) {
      const s = String(row[statusCol]).toLowerCase();
      if (s.includes('placed') || s.includes('leased')) status = 'placed';
      else if (s.includes('inactive') || s.includes('closed')) status = 'inactive';
    }

    renters.push({
      name: name,
      email: email || null,
      phone: phone || null,
      budget_min: budgetMin,
      budget_max: budgetMax,
      bedrooms_needed: bedrooms,
      preferred_neighborhoods: neighborhoods,
      move_in_date: moveInDate,
      status: status,
      notes: notes || null,
      source: 'google_sheets',
    });
  }

  if (renters.length === 0) return 0;

  // Insert in batches of 50
  for (let i = 0; i < renters.length; i += 50) {
    const batch = renters.slice(i, i + 50);
    const result = supabaseRequest('POST', '/renters', batch);
    if (!result) Logger.log('  ERROR inserting batch starting at ' + i);
  }

  return renters.length;
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE API
// ═══════════════════════════════════════════════════════════════

function supabaseRequest(method, path, body) {
  const options = {
    method: method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    muteHttpExceptions: true,
  };
  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.payload = JSON.stringify(body);
  }
  const url = SUPABASE_URL + '/rest/v1' + path;
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code >= 400) { Logger.log('Supabase error (' + code + '): ' + text); return null; }
  try { return JSON.parse(text); } catch (e) { return null; }
}
