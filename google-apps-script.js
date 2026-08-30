// ═══════════════════════════════════════════════════════════════
// Nessoo Inventory — Google Sheets → Dashboard Live Sync
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://xwwvlydkdjdxchgsksjv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3d3ZseWRrZGpkeGNoZ3Nrc2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMzY1NTIsImV4cCI6MjEwMzYxMjU1Mn0.3yHAj6AOIdfrcn8BB8oVZ11bmBwWiEXQ9eHQlz3d84U';

/**
 * STEP 1: Run this first to import everything.
 */
function syncAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let totalUnits = 0;
  let tabCount = 0;

  for (const sheet of sheets) {
    const tabName = sheet.getName().trim();
    Logger.log('=== Processing tab: "' + tabName + '" ===');

    const clientId = getOrCreateClient(tabName);
    const count = syncSheet(sheet, clientId);
    totalUnits += count;
    tabCount++;
    Logger.log('  → ' + count + ' units synced for ' + tabName);
  }

  Logger.log('DONE! ' + totalUnits + ' units across ' + tabCount + ' tabs.');
  SpreadsheetApp.getUi().alert('Sync complete!\n\n' + totalUnits + ' units synced across ' + tabCount + ' tabs.');
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
    const tabName = sheet.getName().trim();
    const clientId = getOrCreateClient(tabName);
    syncSheet(sheet, clientId);
  } catch (err) {
    Logger.log('Sync error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNC — Your layout: labels in col A, each unit is a column
// Multiple blocks per sheet separated by empty/colored rows
// ═══════════════════════════════════════════════════════════════

function syncSheet(sheet, clientId) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('  Sheet has less than 2 rows'); return 0; }

  // Log what column A looks like so we can debug
  Logger.log('  Column A contents:');
  for (let r = 0; r < Math.min(data.length, 30); r++) {
    Logger.log('    Row ' + (r+1) + ': "' + String(data[r][0] || '').trim() + '"  |  Col B: "' + String(data[r][1] || '').trim().substring(0, 30) + '"');
  }

  // Find all unit blocks
  // A block starts when we see "Address" (or similar) in column A
  const units = [];
  let currentFields = {}; // maps field name -> row index
  let blockCount = 0;

  for (let r = 0; r < data.length; r++) {
    const rawLabel = String(data[r][0] || '').trim();
    const label = rawLabel.toLowerCase();

    // Detect start of a new block
    if (label === 'address') {
      // If we had a previous block, extract its units
      if (blockCount > 0) {
        const found = extractUnits(data, currentFields);
        Logger.log('  Block ' + blockCount + ': found ' + found.length + ' units');
        units.push(...found);
      }
      blockCount++;
      currentFields = { address: r };
      continue;
    }

    // Map known fields
    if (currentFields.address !== undefined) {
      if (label === 'unit' || label === 'apt' || label === 'apartment') currentFields.unit = r;
      else if (label === 'price' || label === 'rent') currentFields.price = r;
      else if (label.includes('bed') || label.includes('bath')) currentFields.beds_baths = r;
      else if (label.includes('neighbor')) currentFields.neighborhood = r;
      else if (label.includes('security') || label === 'deposit') currentFields.security_deposit = r;
      else if (label.includes('feature') || label.includes('ameniti')) currentFields.features = r;
      else if (label.includes('income')) currentFields.income_requirement = r;
      else if (label.includes('credit')) currentFields.credit_score = r;
      else if (label.includes('avail') || label.includes('avil')) currentFields.availability_date = r;
      else if (label.includes('days') || label === 'dom') currentFields.days_on_market = r;
    }
  }

  // Don't forget the last block
  if (blockCount > 0) {
    const found = extractUnits(data, currentFields);
    Logger.log('  Block ' + blockCount + ': found ' + found.length + ' units');
    units.push(...found);
  }

  if (blockCount === 0) {
    Logger.log('  WARNING: No "Address" label found in column A!');
    return 0;
  }

  Logger.log('  Total units found before filtering: ' + units.length);

  // Delete existing listings for this client
  supabaseRequest('DELETE', '/rental_listings?client_id=eq.' + clientId);

  // Build and insert
  const listings = [];
  for (const unit of units) {
    const listing = buildListing(unit, clientId);
    if (listing) {
      listings.push(listing);
    } else {
      Logger.log('  Skipped unit: addr="' + (unit.address||'') + '" price="' + (unit.price||'') + '"');
    }
  }

  Logger.log('  Listings after filtering (need address + price): ' + listings.length);

  if (listings.length === 0) return 0;

  for (let i = 0; i < listings.length; i += 50) {
    const batch = listings.slice(i, i + 50);
    const result = supabaseRequest('POST', '/rental_listings', batch);
    if (!result) Logger.log('  ERROR inserting batch starting at ' + i);
  }

  return listings.length;
}

function extractUnits(data, fields) {
  const units = [];
  const addressRow = fields.address;
  const numCols = data[addressRow].length;

  for (let c = 1; c < numCols; c++) {
    const address = String(data[addressRow][c] || '').trim();
    if (!address) continue;

    const unit = { address: address };

    for (const [field, row] of Object.entries(fields)) {
      if (field === 'address') {
        continue;
      }
      if (row < data.length && c < data[row].length) {
        const val = data[row][c];
        if (val !== '' && val !== null && val !== undefined) {
          unit[field] = val;
        }
      }
    }

    units.push(unit);
  }

  return units;
}

function buildListing(unit, clientId) {
  if (!unit.address) return null;

  // Parse price — allow units without price (set to 0)
  let price = parsePrice(unit.price);
  if (!price) price = 0;

  // Parse beds & baths
  let bedrooms = 0, bathrooms = 1;
  const bb = String(unit.beds_baths || '').toLowerCase();
  if (bb.includes('studio')) {
    bedrooms = 0;
  } else if (bb) {
    const bedMatch = bb.match(/(\d+)\s*bed/);
    if (bedMatch) bedrooms = parseInt(bedMatch[1]);
    const bathMatch = bb.match(/(\d+\.?\d*)\s*bath/);
    if (bathMatch) bathrooms = parseFloat(bathMatch[1]);
    // Handle "2/1" format
    if (!bedMatch && !bathMatch) {
      const slashMatch = bb.match(/(\d+)\s*[\/,]\s*(\d+)/);
      if (slashMatch) { bedrooms = parseInt(slashMatch[1]); bathrooms = parseInt(slashMatch[2]); }
      else { const numMatch = bb.match(/(\d+)/); if (numMatch) bedrooms = parseInt(numMatch[1]); }
    }
  }

  // Parse features
  let features = [];
  if (unit.features) {
    features = String(unit.features).split(/[\n,\-•]/)
      .map(f => f.trim())
      .filter(f => f.length > 2);
  }

  // Parse date
  let availDate = null;
  if (unit.availability_date) {
    try {
      const d = new Date(unit.availability_date);
      if (!isNaN(d.getTime())) availDate = d.toISOString().split('T')[0];
    } catch (e) {}
  }

  // Parse days on market
  let dom = 0;
  if (unit.days_on_market) {
    const m = String(unit.days_on_market).match(/(\d+)/);
    if (m) dom = parseInt(m[1]);
  }

  return {
    client_id: clientId,
    address: unit.address,
    unit: unit.unit ? String(unit.unit).trim() : null,
    price: price,
    bedrooms: bedrooms,
    bathrooms: bathrooms,
    neighborhood: unit.neighborhood ? String(unit.neighborhood).trim() : null,
    security_deposit: parsePrice(unit.security_deposit),
    features: features,
    income_requirement: unit.income_requirement ? String(unit.income_requirement).trim() : null,
    credit_score_min: parseInt(unit.credit_score) || null,
    availability_date: availDate,
    days_on_market: dom,
    status: 'active',
    source: 'google_sheets',
  };
}

function parsePrice(val) {
  if (!val && val !== 0) return null;
  const str = String(val).replace(/[$,]/g, '').replace(/\/mo/gi, '').replace(/w\/.*$/i, '').trim();
  const num = parseInt(str);
  return isNaN(num) || num <= 0 ? null : num;
}

function getOrCreateClient(tabName) {
  const existing = supabaseRequest('GET', '/rental_clients?name=eq.' + encodeURIComponent(tabName) + '&select=id');
  if (existing && existing.length > 0) return existing[0].id;
  const created = supabaseRequest('POST', '/rental_clients', { name: tabName });
  if (created && created.length > 0) return created[0].id;
  throw new Error('Failed to create client: ' + tabName);
}

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
