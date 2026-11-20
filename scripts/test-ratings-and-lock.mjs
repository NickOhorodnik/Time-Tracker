import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

console.log('--- STARTING ATT-RATINGS-AND-LOCK-01 OFFLINE TEST SUITE ---');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-ratings-lock-'));
const apiBundlePath = path.join(tmpDir, 'api.mjs');
const bridgeBundlePath = path.join(tmpDir, 'gasBridge.mjs');
const adapterBundlePath = path.join(tmpDir, 'canonicalSheetsAdapter.mjs');

await Promise.all([
  esbuild.build({
    entryPoints: ['src/services/api.ts'],
    outfile: apiBundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
  }),
  esbuild.build({
    entryPoints: ['src/services/gasBridge.ts'],
    outfile: bridgeBundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
  }),
  esbuild.build({
    entryPoints: ['src/utils/canonicalSheetsAdapter.ts'],
    outfile: adapterBundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
  }),
]);

let passedCount = 0;
let failedCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.stack || err.message}`);
    failedCount++;
  }
}

function createMockSheet(name, rows) {
  const data = rows.map((r) => [...r]);
  return {
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
      setValue: (val) => {
        const targetRow = row - 1;
        while (data.length <= targetRow) data.push([]);
        data[targetRow][col - 1] = val;
      },
      setNumberFormat: () => {},
      setFontWeight: () => {},
      setBackground: () => {},
      clearContent: () => {},
    }),
    appendRow: (rowVals) => data.push([...rowVals]),
    _rows: data,
  };
}

function createMockSpreadsheet({
  id = 'sheet-rating-001',
  name = 'Allonsy Ratings Sheet',
  ratingsHeader = ['rating_id', 'employee_id', 'score', 'comment', 'rated_at_utc', 'created_at_utc', 'updated_at_utc', 'deleted_at_utc', 'source'],
  ratingsRows = [],
} = {}) {
  const sheets = [
    createMockSheet('Записи', [
      ['segment_id', 'session_id', 'command_id', 'дата', 'початок_utc', 'кінець_utc', 'секунд', 'category_id', 'категорія_назва', 'action_id', 'project_id', 'опис', 'створено_utc', 'джерело', 'month_key', 'примітка', 'employee_id', 'updated_at_utc', 'deleted_at_utc', 'change_reason'],
    ]),
    createMockSheet('Категорії', [['id', 'назва', 'колір_hex', 'іконка_lucide', 'активна']]),
    createMockSheet('Типи дій', [['id', 'назва', 'активний']]),
    createMockSheet('Проєкти', [['id', 'назва', 'активний']]),
    createMockSheet('Бонуси', [['id', 'назва', 'опис', 'тип', 'ціна_балів', 'активний', 'image_asset_id']]),
    createMockSheet('Отримані бонуси', [['claim_id', 'bonus_id', 'статус']]),
    createMockSheet('Фрази', [['id', 'текст', 'активна', 'порядок']]),
    createMockSheet('Мотиваційні фрази', [['id', 'template', 'active', 'sort_order']]),
    createMockSheet('Налаштування', [['ключ', 'значення']]),
    createMockSheet('Працівники', [
      ['employee_id', 'name', 'role', 'status', 'avatar_asset_id', 'portrait_asset_id', 'notes', 'created_at_utc', 'updated_at_utc'],
      ['emp-1', 'Андрій', 'Розробник', 'active', '', '', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'],
    ]),
    createMockSheet('Оцінки', [ratingsHeader, ...ratingsRows]),
    createMockSheet('Бібліотека зображень', [['asset_id', 'filename', 'display_name', 'folder_path', 'file_reference', 'is_active', 'image_url']]),
    createMockSheet('Призначення зображень', [['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'active']]),
  ];

  return {
    getId: () => id,
    getName: () => name,
    getSheets: () => sheets,
    getSheetByName: (targetName) => sheets.find((s) => s.getName() === targetName) || null,
  };
}

function createGasSandbox(spreadsheetObj, lockServiceOverride) {
  const events = { flushed: 0, slept: [], released: 0 };
  const defaultLock = () => ({
    tryLock: () => true,
    waitLock: () => undefined,
    hasLock: () => true,
    releaseLock: () => {
      events.released += 1;
    },
  });

  const sandbox = {
    SpreadsheetApp: {
      openById: (id) => {
        if (spreadsheetObj && spreadsheetObj.getId() === id) return spreadsheetObj;
        throw new Error(`Spreadsheet not found: ${id}`);
      },
      flush: () => {
        events.flushed += 1;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'BOUND_SPREADSHEET_ID' && spreadsheetObj ? spreadsheetObj.getId() : null),
        setProperty: () => {},
      }),
    },
    LockService: lockServiceOverride || {
      getScriptLock: defaultLock,
      getUserLock: () => {
        throw new Error('Anonymous web app cannot use getUserLock');
      },
    },
    Utilities: {
      sleep: (ms) => {
        events.slept.push(ms);
      },
      formatDate: (dateObj, _tz, fmt) => {
        const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
        if (isNaN(d.getTime())) throw new Error('Invalid date');
        const pad = (n) => String(n).padStart(2, '0');
        if (fmt === 'HH:mm') return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        if (fmt === 'yyyy-MM-dd') return d.toISOString().split('T')[0];
        return d.toISOString();
      },
      parseDate: (str) => new Date(str.replace(' ', 'T') + 'Z'),
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Kyiv',
    },
    Logger: { log: () => {} },
    ContentService: {
      createTextOutput: (text) => ({ setMimeType: () => text }),
      MimeType: { JSON: 'JSON' },
    },
    HtmlService: {
      createHtmlOutput: () => ({ setTitle: () => ({ setXFrameOptionsMode: () => ({}) }) }),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('gas/Code.gs', 'utf8'), sandbox);
  return { sandbox, events };
}

await runTest('T01: Real GAS LockService (getScriptLock + void waitLock + tryLock) saves rating without LOCK_CONTENTION even when getUserLock throws', () => {
  const ss = createMockSpreadsheet();
  const { sandbox, events } = createGasSandbox(ss);

  const res = sandbox.gasSaveRating(ss.getId(), {
    id: 'rating-001',
    employeeId: 'emp-1',
    score: 5,
    comment: 'Чудова робота!',
    date: '2026-11-20',
    time: '14:35',
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.rating.score, 5);
  assert.strictEqual(events.flushed, 1);
  assert.strictEqual(events.released, 1);

  const sheetRows = ss.getSheetByName('Оцінки')._rows;
  assert.strictEqual(sheetRows.length, 2);
  assert.strictEqual(sheetRows[1][0], 'rating-001');
  assert.strictEqual(sheetRows[1][1], 'emp-1');
  assert.strictEqual(sheetRows[1][2], 5);
});

await runTest('T02: Legacy lock implementing only GAS void waitLock() (returns undefined) does NOT falsely trigger LOCK_CONTENTION', () => {
  const ss = createMockSpreadsheet();
  let released = 0;
  const { sandbox } = createGasSandbox(ss, {
    getScriptLock: () => ({
      waitLock: () => undefined, // Real GAS waitLock returns void (undefined)
      releaseLock: () => {
        released += 1;
      },
    }),
  });

  const res = sandbox.gasSaveRating(ss.getId(), {
    id: 'rating-void-wait',
    employeeId: 'emp-1',
    score: 4,
    date: '2026-11-20',
    time: '9:05',
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(released, 1);
});

await runTest('T03: Transient lock contention retries once and succeeds; persistent contention fails cleanly with LOCK_CONTENTION', () => {
  const ss = createMockSpreadsheet();
  let attempts = 0;
  const { sandbox: retrySandbox, events } = createGasSandbox(ss, {
    getScriptLock: () => ({
      tryLock: () => {
        attempts += 1;
        return attempts >= 2;
      },
      hasLock: () => attempts >= 2,
      releaseLock: () => {
        events.released += 1;
      },
    }),
  });

  const okRes = retrySandbox.gasSaveRating(ss.getId(), {
    id: 'rating-retry-ok',
    employeeId: 'emp-1',
    score: 5,
    date: '2026-11-20',
    time: '10:00',
  });
  assert.strictEqual(okRes.ok, true);
  assert.strictEqual(attempts, 2);
  assert.strictEqual(events.slept.length, 1);

  const { sandbox: busySandbox } = createGasSandbox(ss, {
    getScriptLock: () => ({
      tryLock: () => false,
      hasLock: () => false,
      releaseLock: () => {},
    }),
  });
  const busyRes = busySandbox.gasSaveRating(ss.getId(), {
    id: 'rating-busy',
    employeeId: 'emp-1',
    score: 3,
    date: '2026-11-20',
    time: '11:00',
  });
  assert.strictEqual(busyRes.ok, false);
  assert.strictEqual(busyRes.code, 'LOCK_CONTENTION');
});

await runTest('T04: Rating round-trip through Оцінки works for both canonical rated_at_utc and legacy rating_date/rating_time schemas, Date cells, and deleted rows', () => {
  const ss = createMockSpreadsheet({
    ratingsHeader: ['rating_id', 'employee_id', 'score', 'emoji', 'sentiment', 'label', 'comment', 'rating_date', 'rating_time', 'created_at_utc', 'updated_at_utc', 'record_status'],
    ratingsRows: [
      ['rating-old', 'emp-1', '4', '🙂', 'positive', 'Позитивно', 'Перший фідбек', '2026-11-18', '09:15', '2026-11-18T09:15:00Z', '2026-11-18T09:15:00Z', 'active'],
      ['rating-del', 'emp-1', '1', '😞', 'negative', 'Негативно', 'Видалена', '2026-11-17', '09:00', '2026-11-17T09:00:00Z', '2026-11-17T09:00:00Z', 'deleted'],
    ],
  });
  const { sandbox } = createGasSandbox(ss);

  const saveRes = sandbox.gasSaveRating(ss.getId(), {
    id: 'rating-new',
    employeeId: 'emp-1',
    score: 5,
    comment: 'Топовий реліз',
    date: '2026-11-20',
    time: '16:20',
  });
  assert.strictEqual(saveRes.ok, true);

  const loadRes = sandbox.gasLoadAllData(ss.getId());
  assert.strictEqual(loadRes.ok, true);
  assert.strictEqual(loadRes.ratings.length, 2);
  assert.strictEqual(loadRes.ratings[0].id, 'rating-new');
  assert.strictEqual(loadRes.ratings[0].score, 5);
  assert.strictEqual(loadRes.ratings[0].date, '2026-11-20');
  assert.strictEqual(loadRes.ratings[0].time, '16:20');
  assert.strictEqual(loadRes.ratings[0].comment, 'Топовий реліз');
  assert.strictEqual(loadRes.ratings[1].id, 'rating-old');

  // Also test Date object & invalid date string safety on rated_at_utc schema
  const ssCanonical = createMockSpreadsheet({
    ratingsRows: [
      ['rating-date-obj', 'emp-1', 5, 'Date object cell', new Date('2026-11-19T12:30:00Z'), '2026-11-19T12:30:00Z', '2026-11-19T12:30:00Z', '', 'allonsy_ui'],
      ['rating-bad-date', 'emp-1', 3, 'Invalid date string', 'not-a-date', '2026-11-18T08:00:00Z', '2026-11-18T08:00:00Z', '', 'allonsy_ui'],
      ['rating-soft-del', 'emp-1', 2, 'Soft deleted', '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z', '2026-11-17T09:00:00Z', 'allonsy_ui'],
    ],
  });
  const { sandbox: canSandbox } = createGasSandbox(ssCanonical);
  const canLoad = canSandbox.gasLoadAllData(ssCanonical.getId());
  assert.strictEqual(canLoad.ok, true);
  assert.strictEqual(canLoad.ratings.length, 2);
  assert.strictEqual(canLoad.ratings[0].id, 'rating-date-obj');
  assert.strictEqual(canLoad.ratings[0].date, '2026-11-19');
  assert.strictEqual(canLoad.ratings[1].id, 'rating-bad-date');
  assert.strictEqual(canLoad.ratings[1].date, '2026-11-18');
});

await runTest('T05: Client gasBridge write queue serializes concurrent saveRating calls & api normalizes sheet ratings', async () => {
  const storageMap = new Map();
  storageMap.set(
    'allonsy_settings',
    JSON.stringify({
      gasWebAppUrl: 'https://script.google.com/macros/s/test_exec/exec',
      googleSpreadsheetInput: 'sheet-rating-001',
    })
  );
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  };

  const ss = createMockSpreadsheet();
  const { sandbox } = createGasSandbox(ss);

  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  const callOrder = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const isWrite = body.method !== 'gasLoadAllData';
    if (isWrite) {
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      callOrder.push(`start:${body.args?.[0]?.id || body.method}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    try {
      const gasRes = sandbox.gasHandleRpc_({
        method: body.method,
        spreadsheetInput: body.spreadsheetInput,
        args: body.args,
      });
      if (isWrite) {
        callOrder.push(`end:${body.args?.[0]?.id || body.method}`);
      }
      return {
        ok: true,
        json: async () => JSON.parse(JSON.stringify(gasRes)),
      };
    } finally {
      if (isWrite) activeWrites -= 1;
    }
  };

  const { api } = await import(`${pathToFileURL(apiBundlePath).href}?t=${Date.now()}`);
  const adapter = await import(`${pathToFileURL(adapterBundlePath).href}?t=${Date.now()}`);

  const r1 = {
    id: 'rating-seq-1',
    employeeId: 'emp-1',
    score: 5,
    emoji: '🤩',
    sentiment: 'positive',
    label: 'Позитивно',
    comment: 'Перша',
    date: '2026-11-20',
    time: '10:00',
    createdAt: '2026-11-20T08:00:00Z',
    updatedAt: '2026-11-20T08:00:00Z',
  };
  const r2 = {
    id: 'rating-seq-2',
    employeeId: 'emp-1',
    score: 4,
    emoji: '🙂',
    sentiment: 'positive',
    label: 'Позитивно',
    comment: 'Друга',
    date: '2026-11-20',
    time: '11:00',
    createdAt: '2026-11-20T09:00:00Z',
    updatedAt: '2026-11-20T09:00:00Z',
  };

  const [save1, save2] = await Promise.all([
    api.saveRatingRemote(r1),
    api.saveRatingRemote(r2),
  ]);

  assert.strictEqual(save1.success, true);
  assert.strictEqual(save2.success, true);
  assert.strictEqual(maxConcurrentWrites, 1);
  assert.deepStrictEqual(callOrder, [
    'start:rating-seq-1',
    'end:rating-seq-1',
    'start:rating-seq-2',
    'end:rating-seq-2',
  ]);

  const loaded = await api.loadRemoteData();
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.ratings.length, 2);
  assert.strictEqual(loaded.ratings[0].id, 'rating-seq-2');
  assert.strictEqual(loaded.ratings[1].id, 'rating-seq-1');
  assert.strictEqual(loaded.ratings[0].isDemo, false);

  const normalized = adapter.normalizeLoadedRatings(loaded.ratings);
  assert.strictEqual(normalized.length, 2);
});

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n--- TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ---`);
if (failedCount > 0) process.exit(1);
