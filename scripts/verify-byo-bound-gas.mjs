import fs from 'node:fs';
import assert from 'node:assert';
import vm from 'node:vm';

console.log('--- STARTING ATT-BYO-BOUND-GAS-01 OFFLINE TEST SUITE ---');

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    failedCount++;
  }
}

// Helper to create an in-memory mock Google Sheet matching SpreadsheetApp Sheet API
function createMockSheet(name, rows) {
  const data = rows.map((r) => [...r]);
  const sheet = {
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => (data.length > 0 ? data[0].length : 0),
    getDataRange: () => ({
      getValues: () => data.map((r) => [...r]),
    }),
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () => {
        const out = [];
        for (let r = row - 1; r < row - 1 + numRows; r++) {
          const rowArr = data[r] || [];
          out.push(rowArr.slice(col - 1, col - 1 + numCols));
        }
        return out;
      },
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          const targetRow = row - 1 + i;
          while (data.length <= targetRow) data.push([]);
          for (let j = 0; j < vals[i].length; j++) {
            data[targetRow][col - 1 + j] = vals[i][j];
          }
        }
      },
      setNumberFormat: () => {},
      setFontWeight: () => {},
      setBackground: () => {},
      clearContent: () => {},
    }),
    appendRow: (rowVals) => {
      data.push([...rowVals]);
    },
    _rows: data,
  };
  return sheet;
}

function createCanonicalMockSpreadsheet({
  id = 'bound-copy-id-001',
  name = 'Allonsy Time Tracker — Користувач',
  emptyData = false,
  withMonthPartition = true,
} = {}) {
  const sheets = [
    createMockSheet('Записи', [
      ['segment_id', 'session_id', 'command_id', 'дата', 'початок_utc', 'кінець_utc', 'секунд', 'category_id', 'категорія_назва', 'action_id', 'project_id', 'опис', 'створено_utc', 'джерело', 'month_key', 'примітка', 'employee_id', 'updated_at_utc', 'deleted_at_utc', 'change_reason'],
      ...(emptyData ? [] : [
        ['seg-1', 'sess-1', 'cmd-1', '2026-11-16', '2026-11-16T08:00:00Z', '2026-11-16T09:00:00Z', 3600, 'cat-1', 'Розробка', 'act-1', 'proj-1', 'Робота над кодом', '2026-11-16T09:00:00Z', 'timer', '2026-11', '', 'emp-1', '2026-11-16T09:00:00Z', '', ''],
      ]),
    ]),
    ...(withMonthPartition ? [
      createMockSheet('2026-11', [
        ['segment_id', 'session_id', 'command_id', 'дата', 'початок_utc', 'кінець_utc', 'секунд', 'category_id', 'категорія_назва', 'action_id', 'project_id', 'опис', 'створено_utc', 'джерело', 'month_key', 'примітка', 'employee_id', 'updated_at_utc', 'deleted_at_utc', 'change_reason'],
        ...(emptyData ? [] : [
          ['seg-month-2', 'sess-2', 'cmd-2', '2026-11-17', '2026-11-17T10:00:00Z', '2026-11-17T10:30:00Z', 1800, 'cat-1', 'Розробка', 'act-1', 'proj-1', 'Місячний запис', '2026-11-17T10:30:00Z', 'manual', '2026-11', '', 'emp-1', '2026-11-17T10:30:00Z', '', ''],
        ]),
      ]),
    ] : []),
    createMockSheet('Категорії', [
      ['id', 'назва', 'колір_hex', 'іконка_lucide', 'активна'],
      ...(emptyData ? [] : [['cat-1', 'Розробка', '#f97316', 'Code', true]]),
    ]),
    createMockSheet('Типи дій', [
      ['id', 'назва', 'активний'],
      ...(emptyData ? [] : [['act-1', 'Кодинг', true]]),
    ]),
    createMockSheet('Проєкти', [
      ['id', 'назва', 'активний'],
      ...(emptyData ? [] : [['proj-1', 'Allonsy Core', true]]),
    ]),
    createMockSheet('Бонуси', [
      ['id', 'назва', 'опис', 'тип', 'ціна_балів', 'активний', 'image_asset_id'],
      ...(emptyData ? [] : [['bon-1', 'Кава', 'Смачна кава', 'custom', 10, true, '']]),
    ]),
    createMockSheet('Отримані бонуси', [
      ['claim_id', 'bonus_id', 'статус'],
    ]),
    createMockSheet('Фрази', [
      ['id', 'текст', 'активна', 'порядок'],
      ...(emptyData ? [] : [
        ['ph-1', 'Працюємо продуктивно!', true, 1],
        ['ph-2', 'Вимкнена фраза', false, 2],
      ]),
    ]),
    createMockSheet('Мотиваційні фрази', [
      ['id', 'template', 'active', 'sort_order'],
      ...(emptyData ? [] : [
        ['mot-1', 'Вже {hours} год і {earned}!', true, 1],
      ]),
    ]),
    createMockSheet('Налаштування', [
      ['ключ', 'значення'],
      ...(emptyData ? [] : [
        ['hourlyRate', '25'],
        ['targetHours', '8'],
        ['progressionMode', 'all_time'],
      ]),
    ]),
    createMockSheet('Працівники', [
      ['employee_id', 'name', 'role', 'status', 'avatar_asset_id', 'portrait_asset_id', 'notes', 'created_at_utc', 'updated_at_utc'],
      ...(emptyData ? [] : [['emp-1', 'Коля', 'Developer', 'active', '', '', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z']]),
    ]),
    createMockSheet('Оцінки', [
      ['rating_id', 'employee_id', 'score', 'emoji', 'sentiment', 'label', 'comment', 'rating_date', 'rating_time', 'created_at_utc', 'updated_at_utc', 'record_status'],
    ]),
    createMockSheet('Бібліотека зображень', [
      ['asset_id', 'filename', 'display_name', 'folder_path', 'mime_type', 'storage_status', 'drive_file_id', 'file_reference', 'is_active', 'image_url', 'updated_at_utc'],
      ...(emptyData ? [] : [
        ['asset-stage-1', 'stage1.png', 'Stage 1 Main', 'images/character/primary', 'image/png', 'bundled_unverified', '', 'https://res.cloudinary.com/demo/image/upload/v1/stage1.png', true, '', '2026-11-16T00:00:00Z'],
        ['asset-stage-2-alt', 'stage2alt.png', 'Stage 2 Alt', 'images/character/alternate', 'image/png', 'external_url', '', 'https://res.cloudinary.com/demo/image/upload/v1/stage2alt.png', true, '', '2026-11-16T00:00:00Z'],
      ]),
    ]),
    createMockSheet('Призначення зображень', [
      ['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'inheritance_mode', 'updated_at_utc', 'active'],
      ...(emptyData ? [] : [
        ['asg-1', 'stage', 'stage_01', 'primary', 'asset-stage-1', 'explicit', '2026-11-16T00:00:00Z', true],
        ['asg-2', 'stage', 'stage_02', 'alternate', 'asset-stage-2-alt', 'explicit', '2026-11-16T00:00:00Z', true],
      ]),
    ]),
  ];

  return {
    getId: () => id,
    getName: () => name,
    getSheets: () => sheets,
    getSheetByName: (targetName) => sheets.find((s) => s.getName() === targetName) || null,
  };
}

function createGasSandbox(spreadsheetObj, { lockState = { acquire: true } } = {}) {
  const registry = new Map();
  if (spreadsheetObj) {
    registry.set(spreadsheetObj.getId(), spreadsheetObj);
  }

  const sandbox = {
    SpreadsheetApp: {
      openById: (id) => {
        if (!registry.has(id)) {
          throw new Error(`Spreadsheet not found for id=${id}`);
        }
        return registry.get(id);
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          lockState.waited = true;
          return lockState.acquire;
        },
        waitLock: () => {
          lockState.waited = true;
          if (!lockState.acquire) throw new Error('Lock timeout');
        },
        hasLock: () => Boolean(lockState.acquire),
        releaseLock: () => {
          lockState.released = true;
        },
      }),
      getUserLock: () => ({
        tryLock: () => {
          lockState.waited = true;
          return lockState.acquire;
        },
        waitLock: () => {
          lockState.waited = true;
          if (!lockState.acquire) throw new Error('Lock timeout');
        },
        hasLock: () => Boolean(lockState.acquire),
        releaseLock: () => {
          lockState.released = true;
        },
      }),
    },
    Utilities: {
      formatDate: (dateObj, _tz, fmt) => {
        const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
        if (isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        if (fmt === 'HH:mm') return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        if (fmt === 'yyyy-MM-dd') return d.toISOString().split('T')[0];
        return d.toISOString();
      },
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Kyiv',
    },
    Logger: { log: () => {} },
    ContentService: {
      createTextOutput: (text) => ({ setMimeType: () => ({}) }),
      MimeType: { JSON: 'JSON' },
    },
    HtmlService: {
      createHtmlOutput: () => ({ setTitle: () => ({ setXFrameOptionsMode: () => ({}) }) }),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('gas/Code.gs', 'utf8'), sandbox);
  return sandbox;
}

const gasCode = fs.readFileSync('gas/Code.gs', 'utf8');
const gasReadme = fs.readFileSync('gas/README.md', 'utf8');
const gasBridgeCode = fs.readFileSync('src/services/gasBridge.ts', 'utf8');
const apiCode = fs.readFileSync('src/services/api.ts', 'utf8');
const appCode = fs.readFileSync('src/App.tsx', 'utf8');
const settingsCode = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');

runTest('T01: openById used in getBoundSpreadsheet with spreadsheetInput', () => {
  assert(gasCode.includes('SpreadsheetApp.openById(spreadsheetId)'));
});

runTest('T02: No openByUrl in gas/Code.gs or client source', () => {
  assert(!gasCode.includes('openByUrl'));
  assert(!gasBridgeCode.includes('openByUrl'));
});

runTest('T03: No hardcoded canonical owner sheet ID', () => {
  assert(!gasCode.includes('1Z-TfXPygBzAdAxGR0HYU2c5fnaWHPl4ZiHB48LE1mR4'));
});

runTest('T04: getBoundSpreadsheet fails closed on missing/invalid input', () => {
  const sandbox = createGasSandbox(null);
  const res = sandbox.getBoundSpreadsheet('');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'SPREADSHEET_URL_REQUIRED');
});

runTest('T05: gasHealthCheck uses user-selected spreadsheet input', () => {
  const ss = createCanonicalMockSpreadsheet({ id: 'sheet-abc-12345', name: 'My Sheet' });
  const sandbox = createGasSandbox(ss);
  const res = sandbox.gasHealthCheck('https://docs.google.com/spreadsheets/d/sheet-abc-12345/edit');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.spreadsheetId, 'sheet-abc-12345');
  assert.strictEqual(res.spreadsheetName, 'My Sheet');
  assert.strictEqual(res.executionMode, 'USER_SELECTED_SHEET');
});

runTest('T06: gasLoadAllData returns canonical data', () => {
  const ss = createCanonicalMockSpreadsheet({ id: 'sheet-abc-12345', name: 'My Sheet' });
  const sandbox = createGasSandbox(ss);
  const res = sandbox.gasLoadAllData('sheet-abc-12345');
  assert.strictEqual(res.ok, true);
  assert.ok(res.entries.length >= 1);
  assert.strictEqual(res.phrases.length, 2);
});

runTest('T07: gasBridge passes spreadsheet input automatically', () => {
  assert(gasBridgeCode.includes('readSpreadsheetInput()'));
  assert(gasBridgeCode.includes('spreadsheetInput'));
});

runTest('T08: SettingsView and README document user spreadsheet URL setup', () => {
  assert(settingsCode.includes('googleSpreadsheetInput') || settingsCode.includes('gasWebAppUrl'));
  assert(gasReadme.includes('Кожен користувач'));
});

console.log(`\n--- TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ---`);
if (failedCount > 0) process.exit(1);
