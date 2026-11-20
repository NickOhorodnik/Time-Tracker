import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

console.log('--- RUNNING PHRASES & CLOUDINARY IMAGES PIPELINE TESTS ---\n');

const gasCode = fs.readFileSync(path.resolve('gas/Code.gs'), 'utf8');

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
      setNumberFormat: () => {},
      setFontWeight: () => {},
      setBackground: () => {},
      clearContent: () => {},
    }),
    appendRow: (rowVals) => data.push([...rowVals]),
    _rows: data,
  };
}

function createBaseSheets(overrides = {}) {
  const defaultSheets = {
    'Записи': [
      [
        'segment_id', 'session_id', 'command_id', 'дата', 'початок_utc', 'кінець_utc', 'секунд',
        'category_id', 'категорія_назва', 'action_id', 'project_id', 'опис', 'створено_utc',
        'джерело', 'month_key', 'примітка', 'employee_id', 'updated_at_utc', 'deleted_at_utc', 'change_reason',
      ],
    ],
    'Категорії': [['id', 'назва', 'колір_hex', 'іконка_lucide', 'активна']],
    'Типи дій': [['id', 'назва', 'активна']],
    'Проєкти': [['id', 'назва', 'активний']],
    'Бонуси': [['id', 'назва', 'опис', 'тип', 'ціна_балів', 'активний', 'image_asset_id']],
    'Отримані бонуси': [['claim_id', 'bonus_id', 'статус']],
    'Фрази': [['id', 'текст', 'активна', 'порядок']],
    'Мотиваційні фрази': [['id', 'template', 'active', 'sort_order']],
    'Налаштування': [['ключ', 'значення'], ['hourlyRate', '25'], ['targetHours', '8']],
    'Працівники': [['employee_id', 'name', 'role', 'status', 'avatar_asset_id', 'portrait_asset_id', 'notes', 'created_at_utc', 'updated_at_utc']],
    'Оцінки': [['rating_id', 'employee_id', 'score', 'comment', 'rated_at_utc', 'created_at_utc', 'updated_at_utc', 'deleted_at_utc', 'source']],
    'Бібліотека зображень': [
      ['asset_id', 'filename', 'display_name', 'folder_path', 'mime_type', 'storage_status', 'drive_file_id', 'file_reference', 'is_active', 'image_url', 'updated_at_utc'],
    ],
    'Призначення зображень': [
      ['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'inheritance_mode', 'updated_at_utc', 'active'],
    ],
  };

  const merged = { ...defaultSheets, ...overrides };
  const sheets = Object.entries(merged)
    .filter(([, rows]) => rows !== null)
    .map(([name, rows]) => createMockSheet(name, rows));

  return {
    getId: () => 'bound-pipeline-test-id',
    getName: () => 'Allonsy Bound Copy',
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((s) => s.getName() === name) || null,
  };
}

function createGasSandbox(spreadsheetObj) {
  const sandbox = {
    SpreadsheetApp: {
      openById: (id) => {
        if (spreadsheetObj && spreadsheetObj.getId() === id) return spreadsheetObj;
        throw new Error(`Spreadsheet unavailable for id=${id}`);
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock: () => undefined,
        hasLock: () => true,
        releaseLock: () => {},
      }),
      getUserLock: () => ({
        tryLock: () => true,
        waitLock: () => undefined,
        hasLock: () => true,
        releaseLock: () => {},
      }),
    },
    Utilities: {
      formatDate: (d) => new Date(d).toISOString(),
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
  vm.runInContext(gasCode, sandbox);
  return sandbox;
}

// Create lightweight localStorage + window + fetch mocks for client module execution
const store = new Map();
store.set('allonsy_settings', JSON.stringify({
  gasWebAppUrl: 'https://script.google.com/macros/s/test_webapp_exec/exec',
  googleSpreadsheetInput: 'bound-pipeline-test-id'
}));
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let activeSandbox = null;

globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.includes('/api/gas-proxy')) {
    const body = JSON.parse(options.body || '{}');
    const { method, args, spreadsheetInput } = body;
    const fn = activeSandbox ? activeSandbox[method] : null;
    if (typeof fn !== 'function') {
      return {
        ok: false,
        json: async () => ({ ok: false, success: false, code: 'GAS_METHOD_MISSING', error: `Method ${method} not found` }),
      };
    }
    try {
      const result = fn(spreadsheetInput, ...(args || []));
      return {
        ok: true,
        json: async () => result,
      };
    } catch (err) {
      return {
        ok: false,
        json: async () => ({ ok: false, success: false, code: 'GAS_EXECUTION_ERROR', error: err.toString() }),
      };
    }
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
};

globalThis.window = {
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Bundle client typescript code using esbuild for module test execution
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allonsy-pipeline-'));
const entryFile = path.join(tmpDir, 'test-entry.ts');
fs.writeFileSync(
  entryFile,
  `
  export * from '${path.resolve('src/services/api.ts')}';
  export * from '${path.resolve('src/utils/syncStatusMessages.ts')}';
  export * from '${path.resolve('src/utils/canonicalSheetsAdapter.ts')}';
`
);

const outFile = path.join(tmpDir, 'bundle.mjs');
await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: outFile,
  external: ['node:*'],
});

const bundle = await import(pathToFileURL(outFile).href);
const api = bundle.api;
const { getPhrasesStatusMessage, getCharacterImageStatusMessage } = bundle;

try {
  // Test 1: Realistic bound spreadsheet load (Фрази, Мотиваційні фрази, Бібліотека зображень, Призначення зображень)
  console.log('[1] Realistic bound spreadsheet load (Фрази, Мотиваційні фрази, Бібліотека зображень, Призначення зображень)...');
  const ss1 = createBaseSheets({
    'Фрази': [
      ['\uFEFFID', '  Текст  ', 'Активна', ' Порядок '],
      ['ph-1', 'Працюй зосереджено та спокійно.', true, '1'],
      ['ph-2', 'Зроби паузу та випий води.', false, '2'],
    ],
    'Мотиваційні фрази': [
      ['id', 'template', 'active', 'sort_order'],
      ['mot-1', 'Чудовий прогрес: {hours} год!', '1', '1'],
    ],
    'Бібліотека зображень': [
      ['asset_id', 'filename', 'display_name', 'folder_path', 'mime_type', 'storage_status', 'drive_file_id', 'file_reference', 'is_active', 'image_url', 'updated_at_utc'],
      ['asset-stage-1', 'nastya1.png', 'Настя Основна', 'images/character/primary', 'image/png', 'bundled_unverified', '', 'https://res.cloudinary.com/demo/image/upload/v1/nastya1.png', 'TRUE', '', '2026-11-16T00:00:00Z'],
      ['asset-stage-2', 'nastya2.png', 'Настя Альтернативна', 'images/character/alternate', 'image/png', 'external_url', '', 'https://res.cloudinary.com/demo/image/upload/v1/nastya2.png', 'TRUE', '', '2026-11-16T00:00:00Z'],
    ],
    'Призначення зображень': [
      ['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'inheritance_mode', 'updated_at_utc', 'active'],
      ['asg-1', 'stage', 'stage_01', 'primary', 'asset-stage-1', 'explicit', '2026-11-16T00:00:00Z', 'TRUE'],
      ['asg-2', 'stage', 'stage_02', 'alternate', 'asset-stage-2', 'explicit', '2026-11-16T00:00:00Z', 'TRUE'],
    ],
  });

  activeSandbox = createGasSandbox(ss1);
  const loaded1 = await api.loadRemoteData();
  assert.equal(loaded1.ok, true, 'Remote load must succeed');
  assert.equal(loaded1.phrases.length, 2, 'All raw phrases loaded');
  assert.equal(loaded1.phrases.filter((p) => p.isActive).length, 1, 'Only one active phrase');
  assert.equal(loaded1.motivationalPhrases.length, 1);
  assert.equal(loaded1.settings.stages[0].primaryImage, 'https://res.cloudinary.com/demo/image/upload/v1/nastya1.png');
  assert.equal(loaded1.settings.stages[1].alternateImage, 'https://res.cloudinary.com/demo/image/upload/v1/nastya2.png');
  console.log('✓ Realistic pipeline passed (NBSP headers, Ukrainian booleans, Cloudinary URLs, explicit precedence, inheritance).\n');

  // Test 2: Alternative canonical/localized header variants
  console.log('[2] Testing alternative canonical/localized header variants...');
  const ss2 = createBaseSheets({
    'Фрази': [
      ['phrase_id', 'фраза', 'active', 'sort_order'],
      ['ph-alt-1', 'Альтернативна фраза тест', 'yes', '10'],
    ],
    'Бібліотека зображень': [
      ['asset_id', 'filename', 'display_name', 'folder_path', 'mime_type', 'storage_status', 'drive_file_id', 'file_reference', 'is_active', 'image_url', 'updated_at_utc'],
      ['asset-alt-1', 'alt.png', 'Alt Asset', 'images/character/primary', 'image/png', 'bundled_unverified', '', 'https://res.cloudinary.com/demo/image/upload/v1/alt.png', true, '', '2026-11-16T00:00:00Z'],
    ],
    'Призначення зображень': [
      ['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'inheritance_mode', 'updated_at_utc', 'active'],
      ['asg-alt-1', 'stage', 'stage_03', 'primary', 'asset-alt-1', 'explicit', '2026-11-16T00:00:00Z', true],
    ],
  });

  activeSandbox = createGasSandbox(ss2);
  const loaded2 = await api.loadRemoteData();
  assert.equal(loaded2.ok, true);
  assert.equal(loaded2.phrases[0].text, 'Альтернативна фраза тест');
  assert.equal(loaded2.settings.stages[2].primaryImage, 'https://res.cloudinary.com/demo/image/upload/v1/alt.png');
  console.log('✓ Header alias variants mapped accurately.\n');

  // Test 3: Empty sheet vs all-inactive diagnostic states
  console.log('[3] Testing empty sheet vs all-inactive diagnostic states...');
  const ssEmpty = createBaseSheets({
    'Фрази': [['id', 'текст', 'активна', 'порядок']],
  });
  activeSandbox = createGasSandbox(ssEmpty);
  const loadedEmpty = await api.loadRemoteData();
  assert.equal(loadedEmpty.ok, true);
  assert.equal(loadedEmpty.phrases.length, 0);

  const emptyMsg = getPhrasesStatusMessage({ status: 'synced', runtimeMode: 'gas_bound' }, 0, 0, 'Фрази');
  assert.equal(emptyMsg.kind, 'empty_sheet');

  const ssAllInactive = createBaseSheets({
    'Фрази': [
      ['id', 'текст', 'активна', 'порядок'],
      ['ph-in-1', 'Неактивна 1', false, 1],
    ],
  });
  activeSandbox = createGasSandbox(ssAllInactive);
  const loadedInactive = await api.loadRemoteData();
  assert.equal(loadedInactive.ok, true);
  assert.equal(loadedInactive.phrases.filter((p) => p.isActive).length, 0);

  const inactiveMsg = getPhrasesStatusMessage(
    { status: 'synced', runtimeMode: 'gas_bound' },
    loadedInactive.phrases.length,
    loadedInactive.phrases.filter((p) => p.isActive).length,
    'Фрази'
  );
  assert.equal(inactiveMsg.kind, 'all_inactive');
  console.log('✓ Empty sheet and all-inactive states distinguished cleanly.\n');

  // Test 4: Invalid/missing Cloudinary URL diagnostics
  console.log('[4] Testing invalid/missing Cloudinary URL diagnostics...');
  const ssBadUrl = createBaseSheets({
    'Бібліотека зображень': [
      ['asset_id', 'filename', 'display_name', 'folder_path', 'mime_type', 'storage_status', 'drive_file_id', 'file_reference', 'is_active', 'image_url', 'updated_at_utc'],
      ['asset-bad-1', 'bad.png', 'Bad URL', 'images/character/primary', 'image/png', 'bundled_unverified', '', 'bad-image-file.png', true, '', '2026-11-16T00:00:00Z'],
    ],
    'Призначення зображень': [
      ['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'inheritance_mode', 'updated_at_utc', 'active'],
      ['asg-bad-1', 'stage', 'stage_02', 'primary', 'asset-bad-1', 'explicit', '2026-11-16T00:00:00Z', true],
    ],
  });
  activeSandbox = createGasSandbox(ssBadUrl);
  const loadedBadUrl = await api.loadRemoteData();
  assert.equal(loadedBadUrl.ok, true);
  assert.equal(loadedBadUrl.settings.stages[1].primaryImage, '', 'Invalid filename-only reference must not render as URL');
  assert.equal(loadedBadUrl.imageDiagnostics.invalidUrlAssets.length, 1);
  assert.equal(loadedBadUrl.imageDiagnostics.unresolvedAssignments.length, 1);
  assert.equal(loadedBadUrl.imageDiagnostics.unresolvedAssignments[0].stage, 2);
  assert.equal(loadedBadUrl.imageDiagnostics.unresolvedAssignments[0].reason, 'invalid_url');

  const diagMsg = getCharacterImageStatusMessage(
    { status: 'synced', runtimeMode: 'gas_bound', imageDiagnostics: loadedBadUrl.imageDiagnostics },
    2,
    false
  );
  assert.equal(diagMsg.kind, 'invalid_media_url');

  const okSyncState = { status: 'synced', runtimeMode: 'gas_bound', imageDiagnostics: { invalidUrlAssets: [], unresolvedAssignments: [] } };
  const brokenImgMsg = getCharacterImageStatusMessage(okSyncState, 1, true, 'https://res.cloudinary.com/demo/404.png');
  assert.equal(brokenImgMsg.kind, 'invalid_media_url');
  assert.ok(brokenImgMsg.description.includes('https://res.cloudinary.com/demo/404.png'));
  console.log('✓ Invalid Cloudinary URL and broken <img> error states surfaced cleanly.\n');

  // Test 5: Missing headers & GAS / Preview unavailability
  console.log('[5] Testing missing header error, GAS bound unavailable, and Preview disabled states...');
  const ssMissingHeaders = createBaseSheets({
    'Фрази': [['id', 'інша_колонка']],
  });
  activeSandbox = createGasSandbox(ssMissingHeaders);
  const badSchemaRes = await api.loadRemoteData();
  assert.equal(badSchemaRes.ok, false);
  assert.equal(badSchemaRes.code, 'SCHEMA_COMPATIBILITY_BLOCKED');
  assert.equal(
    getPhrasesStatusMessage(
      { status: 'error', runtimeMode: 'gas_bound', errorCode: badSchemaRes.code, errorMessage: badSchemaRes.error },
      0,
      0,
      'Фрази'
    ).kind,
    'schema_error'
  );

  // GAS spreadsheet missing URL / not configured
  store.set('allonsy_settings', JSON.stringify({ gasWebAppUrl: 'https://script.google.com/macros/s/test_webapp_exec/exec', googleSpreadsheetInput: '' }));
  const noUrlRes = await api.loadRemoteData();
  assert.equal(noUrlRes.ok, false);
  assert.equal(noUrlRes.code, 'SPREADSHEET_URL_REQUIRED');
  const noUrlMsg = getCharacterImageStatusMessage(
    { status: 'error', runtimeMode: 'gas_bound', errorCode: noUrlRes.code, errorMessage: noUrlRes.error },
    1,
    false
  );
  assert.equal(noUrlMsg.kind, 'gas_unavailable');

  // Restore valid setting for subsequent tests
  store.set('allonsy_settings', JSON.stringify({
    gasWebAppUrl: 'https://script.google.com/macros/s/test_webapp_exec/exec',
    googleSpreadsheetInput: 'bound-pipeline-test-id'
  }));

  // GAS spreadsheet unavailable (invalid ID)
  store.set('allonsy_settings', JSON.stringify({
    gasWebAppUrl: 'https://script.google.com/macros/s/test_webapp_exec/exec',
    googleSpreadsheetInput: 'https://docs.google.com/spreadsheets/d/nonexistent_sheet_12345/edit'
  }));
  activeSandbox = createGasSandbox(null);
  const noBoundRes = await api.loadRemoteData();
  assert.equal(noBoundRes.ok, false);
  assert.equal(noBoundRes.code, 'SPREADSHEET_UNAVAILABLE');
  assert.equal(
    getCharacterImageStatusMessage(
      { status: 'error', runtimeMode: 'gas_bound', errorCode: noBoundRes.code, errorMessage: noBoundRes.error },
      1,
      false
    ).kind,
    'gas_unavailable'
  );

  // AI Studio Preview remote sync disabled
  store.set('allonsy_settings', JSON.stringify({ gasWebAppUrl: '' }));
  const previewRes = await api.loadRemoteData();
  assert.equal(previewRes.ok, false);
  assert.equal(previewRes.code, 'NOT_GAS_HOSTED');
  assert.equal(
    getPhrasesStatusMessage({ status: 'local_preview', runtimeMode: 'local_preview' }, 0, 0, 'Фрази').kind,
    'preview_disabled'
  );
  assert.equal(
    getCharacterImageStatusMessage({ status: 'local_preview', runtimeMode: 'local_preview' }, 1, false).kind,
    'preview_disabled'
  );
  console.log('✓ Schema errors, GAS unavailability, and Preview disabled states never fall back silently.\n');

  console.log('ALL PHRASES & CLOUDINARY IMAGES PIPELINE TESTS PASSED!');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
