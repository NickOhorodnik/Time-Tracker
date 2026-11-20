import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

console.log('--- STARTING ATT-POINTS-REWARDS-01 OFFLINE TEST SUITE ---');

// Bundle TS domain & adapter modules into temporary ESM bundles so tests run actual production TypeScript code
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-points-test-'));
const engineBundlePath = path.join(tmpDir, 'pointsEngine.mjs');
const adapterBundlePath = path.join(tmpDir, 'canonicalSheetsAdapter.mjs');

await esbuild.build({
  entryPoints: ['src/utils/pointsEngine.ts'],
  outfile: engineBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

await esbuild.build({
  entryPoints: ['src/utils/canonicalSheetsAdapter.ts'],
  outfile: adapterBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

const engine = await import(pathToFileURL(engineBundlePath).href);
const adapter = await import(pathToFileURL(adapterBundlePath).href);

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.stack || err.message}`);
    failedCount++;
  }
}

/* ============================================================================
 * Mock Sheet & GAS VM Helpers
 * ========================================================================== */

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

function createPointsMockSpreadsheet({
  id = 'sheet-points-001',
  name = 'Allonsy Team Sheet',
  ownerEmail = 'owner@example.com',
  editorEmails = [],
  includePointsSheets = true,
} = {}) {
  const sheets = [
    createMockSheet('Записи', [
      ['segment_id', 'session_id', 'command_id', 'дата', 'початок_utc', 'кінець_utc', 'секунд', 'category_id', 'категорія_назва', 'action_id', 'project_id', 'опис', 'створено_utc', 'джерело', 'month_key', 'примітка', 'employee_id', 'related_employee_id', 'updated_at_utc', 'deleted_at_utc', 'change_reason'],
      ['seg-m1-1', 'sess-1', 'cmd-1', '2026-11-10', '2026-11-10T08:00:00Z', '2026-11-10T08:01:30Z', 90, 'cat-help', 'Допомога', 'act-1', 'proj-1', 'Швидка правка', '2026-11-10T08:01:30Z', 'timer', '2026-11', '', 'emp-mgr-1', 'emp-perf-1', '2026-11-10T08:01:30Z', '', ''],
      ['seg-m1-2', 'sess-2', 'cmd-2', '2026-11-10', '2026-11-10T09:00:00Z', '2026-11-10T09:28:30Z', 1710, 'cat-help', 'Допомога', 'act-1', 'proj-1', 'Розбір проблеми колеги', '2026-11-10T09:28:30Z', 'timer', '2026-11', '', 'emp-mgr-1', 'emp-perf-1', '2026-11-10T09:28:30Z', '', ''],
    ]),
    createMockSheet('Категорії', [
      ['id', 'назва', 'колір_hex', 'іконка_lucide', 'активна'],
      ['cat-help', 'Допомога', '#f97316', 'Code', true],
      ['cat-admin', 'Адмін', '#94a3b8', 'FileText', true],
    ]),
    createMockSheet('Типи дій', [
      ['id', 'назва', 'активний'],
      ['act-1', 'Аналіз', true],
    ]),
    createMockSheet('Проєкти', [
      ['id', 'назва', 'активний'],
      ['proj-1', 'Проєкт Альфа', true],
    ]),
    createMockSheet('Бонуси', [
      ['id', 'назва', 'опис', 'тип', 'ціна_балів', 'активний', 'image_asset_id'],
      ['bon-coffee', 'Сертифікат на каву', 'Приємна перерва', 'custom', 40, true, ''],
      ['bon-dayoff', 'Вихідний день', 'Для менеджера зі знижкою', 'custom', 150, true, ''],
    ]),
    createMockSheet('Отримані бонуси', [
      ['claim_id', 'bonus_id', 'назва_на_момент_запиту', 'employee_id', 'quantity', 'unit_price_points', 'вартість_балів', 'дата_запиту_utc', 'статус', 'дата_отримання_utc', 'коментар', 'command_id', 'updated_at_utc', 'approved_by_employee_id', 'approved_at_utc', 'points_transaction_id', 'eligibility_id'],
    ]),
    createMockSheet('Фрази', [
      ['id', 'текст', 'активна', 'порядок'],
      ['ph-1', 'Гарної зміни!', true, 1],
    ]),
    createMockSheet('Мотиваційні фрази', [
      ['id', 'template', 'active', 'sort_order'],
      ['mot-1', 'Вже {hours} год!', true, 1],
    ]),
    createMockSheet('Налаштування', [
      ['ключ', 'значення'],
      ['hourlyRate', '25'],
      ['targetHours', '100'],
      ['pointsEligibleCategoryIds', '["cat-help"]'],
    ]),
    createMockSheet('Працівники', [
      ['employee_id', 'name', 'role', 'status', 'avatar_asset_id', 'portrait_asset_id', 'notes', 'created_at_utc', 'updated_at_utc', 'email'],
      ['emp-mgr-1', 'Олена', 'Тімлід дизайну', 'active', '', '', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'olena@example.com'],
      ['emp-perf-1', 'Тарас', 'Дизайнер', 'active', '', '', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'taras@example.com'],
    ]),
    createMockSheet('Оцінки', [
      ['rating_id', 'employee_id', 'score', 'comment', 'rated_at_utc', 'created_at_utc', 'updated_at_utc', 'deleted_at_utc'],
    ]),
    createMockSheet('Бібліотека зображень', [
      ['asset_id', 'filename', 'display_name', 'folder_path', 'mime_type', 'storage_status', 'drive_file_id', 'file_reference', 'is_active', 'image_url', 'updated_at_utc'],
    ]),
    createMockSheet('Призначення зображень', [
      ['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'inheritance_mode', 'updated_at_utc', 'active'],
    ]),
    createMockSheet('Журнал змін', [
      ['audit_id', 'entity_type', 'entity_id', 'action', 'before_json', 'after_json', 'reason', 'timestamp_utc', 'command_id'],
    ]),
  ];

  if (includePointsSheets) {
    sheets.push(
      createMockSheet('Ролі балів', [
        ['role_id', 'назва', 'опис', 'monthly_base_points', 'time_earning_enabled', 'minutes_per_point', 'eligible_time_mode', 'positive_grace_months', 'negative_carryover', 'active', 'updated_at_utc'],
        ['manager', 'Керівник', 'За час допомоги та перевірок', 0, true, 30, 'selected_categories', 1, true, true, '2026-11-01T00:00:00Z'],
        ['performer', 'Виконавець', 'Щомісячна база + коригування', 60, false, 30, 'selected_categories', 1, true, true, '2026-11-01T00:00:00Z'],
      ]),
      createMockSheet('Профілі балів', [
        ['employee_id', 'points_role', 'monthly_base_override', 'time_earning_override', 'minutes_per_point_override', 'points_enabled', 'updated_at_utc'],
        ['emp-mgr-1', 'manager', '', '', '', true, '2026-11-01T00:00:00Z'],
        ['emp-perf-1', 'performer', '', '', '', true, '2026-11-01T00:00:00Z'],
      ]),
      createMockSheet('Причини балів', [
        ['reason_id', 'operation_type', 'назва', 'default_points', 'опис', 'allowed_roles', 'active', 'sort_order', 'updated_at_utc'],
        ['reason-clean', 'manual_award', 'Чиста робота без правок', 5, 'Виконано з першого разу', 'performer,manager', true, 1, '2026-11-01T00:00:00Z'],
        ['reason-miss', 'manual_deduction', 'Пропущена помилка', 10, 'Пропущений баг', 'performer', true, 2, '2026-11-01T00:00:00Z'],
        ['reason-self', 'neutral_self_report', 'Самостійне виправлення', 0, 'Інформаційна фіксація', 'performer,manager', true, 3, '2026-11-01T00:00:00Z'],
        ['reason-other', 'manual_award', 'Інше', 1, 'Пояснення вручну', 'manager,performer', true, 99, '2026-11-01T00:00:00Z'],
      ]),
      createMockSheet('Операції балів', [
        ['transaction_id', 'employee_id', 'operation_type', 'points_delta', 'reason_id', 'reason_snapshot', 'comment', 'project_id', 'segment_id', 'related_employee_id', 'occurred_at_utc', 'created_at_utc', 'actor_employee_id', 'command_id', 'reversal_of_transaction_id', 'month_key', 'expires_at_utc'],
      ]),
      createMockSheet('Періоди балів', [
        ['period_id', 'employee_id', 'month_key', 'base_allocation', 'debt_carried_in', 'earned_points', 'deducted_points', 'spent_points', 'expired_points', 'status', 'closed_at_utc', 'command_id'],
      ]),
      createMockSheet('Доступність бонусів', [
        ['eligibility_id', 'bonus_id', 'target_type', 'target_id', 'price_override', 'active', 'requires_approval', 'max_quantity', 'updated_at_utc'],
        ['elig-dayoff-mgr', 'bon-dayoff', 'role', 'manager', 50, true, true, 1, '2026-11-01T00:00:00Z'],
      ])
    );
  }

  return {
    getId: () => id,
    getName: () => name,
    getOwner: () => (ownerEmail ? { getEmail: () => ownerEmail } : null),
    getEditors: () => editorEmails.map((em) => ({ getEmail: () => em })),
    getSheets: () => sheets,
    getSheetByName: (targetName) => sheets.find((s) => s.getName() === targetName) || null,
  };
}

function createPointsGasSandbox({
  spreadsheets = [],
  activeSpreadsheet = null,
  scriptProperties = {},
  activeUserEmail = '',
} = {}) {
  const registry = new Map();
  for (const s of spreadsheets) {
    registry.set(s.getId(), s);
  }
  const propStore = { ...scriptProperties };

  const sandbox = {
    SpreadsheetApp: {
      openById: (id) => {
        if (!registry.has(id)) {
          throw new Error(`Spreadsheet not found id=${id}`);
        }
        return registry.get(id);
      },
      getActiveSpreadsheet: () => activeSpreadsheet,
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(propStore, k) ? propStore[k] : null),
        setProperty: (k, v) => {
          propStore[k] = String(v);
        },
      }),
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
      formatDate: (dateObj, _tz, fmt) => {
        const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
        if (isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM') return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
        if (fmt === 'HH:mm') return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        if (fmt === 'yyyy-MM-dd') return d.toISOString().split('T')[0];
        return d.toISOString();
      },
      parseDate: (str) => new Date(str.replace(' ', 'T') + 'Z'),
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Kyiv',
      getActiveUser: () => ({ getEmail: () => activeUserEmail }),
    },
    Logger: { log: () => {} },
    ContentService: {
      createTextOutput: () => ({ setMimeType: () => ({}) }),
      MimeType: { JSON: 'JSON' },
    },
    HtmlService: {
      createHtmlOutput: () => ({ setTitle: () => ({ setXFrameOptionsMode: () => ({}) }) }),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    },
    _propStore: propStore,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('gas/Code.gs', 'utf8'), sandbox);
  return sandbox;
}

/* ============================================================================
 * 1. Domain Engine & Adapter Tests
 * ========================================================================== */

runTest('P01: Multiple managers & performers keep descriptive roles intact & numeric 0 override works', () => {
  const roles = engine.createDefaultPointsRoles();
  const profiles = [
    { employeeId: 'emp-mgr-1', pointsRole: 'manager', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true },
    { employeeId: 'emp-perf-1', pointsRole: 'performer', monthlyBaseOverride: 0, timeEarningOverride: true, minutesPerPointOverride: 15, pointsEnabled: true },
    { employeeId: 'emp-perf-2', pointsRole: 'performer', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true },
  ];
  const mgr1 = engine.resolveEffectiveEmployeePointsConfig('emp-mgr-1', roles, profiles);
  const perfOverrideZero = engine.resolveEffectiveEmployeePointsConfig('emp-perf-1', roles, profiles);
  const perfInherit = engine.resolveEffectiveEmployeePointsConfig('emp-perf-2', roles, profiles);

  assert.strictEqual(mgr1.monthlyBasePoints, 0);
  assert.strictEqual(mgr1.timeEarningEnabled, true);
  assert.strictEqual(mgr1.minutesPerPoint, 30);

  // Numeric 0 override must NOT fall back to role base 60!
  assert.strictEqual(perfOverrideZero.monthlyBasePoints, 0);
  assert.strictEqual(perfOverrideZero.timeEarningEnabled, true);
  assert.strictEqual(perfOverrideZero.minutesPerPoint, 15);

  assert.strictEqual(perfInherit.monthlyBasePoints, 60);
  assert.strictEqual(perfInherit.timeEarningEnabled, false);
});

runTest('P02: Accumulated seconds earn without rounding loss & edit/delete/closed period compensation', () => {
  const roles = engine.createDefaultPointsRoles();
  const profiles = [
    { employeeId: 'emp-m1', pointsRole: 'manager', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true },
    { employeeId: 'emp-p1', pointsRole: 'performer', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true },
  ];
  const mgrCfg = engine.resolveEffectiveEmployeePointsConfig('emp-m1', roles, profiles);

  // 20 segments of 90s = 1800s = 30 min = 1 point (even though each segment alone is < 30 min!)
  const smallSegments = Array.from({ length: 20 }, (_, i) => ({
    id: `seg-${i}`,
    date: '2026-11-15',
    startTime: '10:00',
    endTime: '10:02',
    durationMinutes: 2,
    elapsedSeconds: 90,
    categoryId: 'cat-help',
    actionTypeId: 'act-1',
    projectId: 'proj-1',
    employeeId: 'emp-m1',
    relatedEmployeeId: 'emp-p1',
    description: 'Short check',
    isManual: false,
  }));

  const firstSync = engine.computeTimeEarningSyncTransactions({
    employeeId: 'emp-m1',
    effectiveConfig: mgrCfg,
    entries: smallSegments,
    existingTransactions: [],
    periods: [],
    eligibleCategoryIds: ['cat-help'],
  });
  assert.strictEqual(firstSync.length, 1);
  assert.strictEqual(firstSync[0].pointsDelta, 1);

  // Re-syncing idempotently adds 0 new transactions
  const secondSync = engine.computeTimeEarningSyncTransactions({
    employeeId: 'emp-m1',
    effectiveConfig: mgrCfg,
    entries: smallSegments,
    existingTransactions: firstSync,
    periods: [],
    eligibleCategoryIds: ['cat-help'],
  });
  assert.strictEqual(secondSync.length, 0);

  // Check related employee earns 0 points from being linked in relatedEmployeeId
  const perfCfg = engine.resolveEffectiveEmployeePointsConfig('emp-p1', roles, profiles);
  const relatedSync = engine.computeTimeEarningSyncTransactions({
    employeeId: 'emp-p1',
    effectiveConfig: perfCfg,
    entries: smallSegments,
    existingTransactions: [],
    periods: [],
    eligibleCategoryIds: ['cat-help'],
  });
  assert.strictEqual(relatedSync.length, 0);

  // Deleting 10 segments creates a -1 reversal for the open month
  const reducedEntries = smallSegments.slice(0, 10);
  const afterDeleteSync = engine.computeTimeEarningSyncTransactions({
    employeeId: 'emp-m1',
    effectiveConfig: mgrCfg,
    entries: reducedEntries,
    existingTransactions: firstSync,
    periods: [],
    eligibleCategoryIds: ['cat-help'],
  });
  assert.strictEqual(afterDeleteSync.length, 1);
  assert.strictEqual(afterDeleteSync[0].operationType, 'reversal');
  assert.strictEqual(afterDeleteSync[0].pointsDelta, -1);

  // If the period is closed, sync skips that month cleanly
  const closedSync = engine.computeTimeEarningSyncTransactions({
    employeeId: 'emp-m1',
    effectiveConfig: mgrCfg,
    entries: reducedEntries,
    existingTransactions: firstSync,
    periods: [{ id: 'p-1', employeeId: 'emp-m1', monthKey: '2026-11', baseAllocation: 0, debtCarriedIn: 0, earnedPoints: 1, deductedPoints: 0, spentPoints: 0, expiredPoints: 0, status: 'closed' }],
    eligibleCategoryIds: ['cat-help'],
  });
  assert.strictEqual(closedSync.length, 0);
});

runTest('P03: Kyiv DST, leap year & Dec->Jan 1-month grace expiry + FIFO spend + non-resurrecting refund', () => {
  // Dec 2026 with grace=1 expires 2027-02-01 00:00 Europe/Kyiv (+02:00 => 2027-01-31T22:00:00Z)
  const decExp = engine.computePositiveExpiryUtc('2026-12', 1);
  assert.strictEqual(decExp, '2027-01-31T22:00:00.000Z');

  // Jan 2024 (leap year) with grace=1 -> 2024-03-01 00:00 Kyiv (+02:00 => 2024-02-29T22:00:00.000Z)
  const janLeapExp = engine.computePositiveExpiryUtc('2024-01', 1);
  assert.strictEqual(janLeapExp, '2024-02-29T22:00:00.000Z');

  // Feb 2026 -> 2026-04-01 Kyiv DST (+03:00 UTC because DST starts last Sunday of March) -> 2026-03-31T21:00:00.000Z
  const marDstExp = engine.computePositiveExpiryUtc('2026-02', 1);
  assert.strictEqual(marDstExp, '2026-03-31T21:00:00.000Z');

  const roles = engine.createDefaultPointsRoles();
  const perfCfg = engine.resolveEffectiveEmployeePointsConfig('emp-p', roles, [{ employeeId: 'emp-p', pointsRole: 'performer', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true }]);

  // Lots from Jan (+60, expires Feb 28 22:00Z) and Feb (+60, expires Mar 31 21:00Z)
  // Spend 40 in Jan (consumes from Jan lot first), let remaining 20 of Jan expire in March,
  // then refund the cancelled Jan claim in March -> the Jan slices ALREADY EXPIRED so must NOT resurrect!
  const txs = [
    {
      id: 'tx-jan-alloc',
      employeeId: 'emp-p',
      operationType: 'monthly_allocation',
      pointsDelta: 60,
      reasonId: 'sys',
      reasonSnapshot: 'База Січень',
      comment: 'Січень',
      occurredAtUtc: '2026-01-01T08:00:00Z',
      createdAtUtc: '2026-01-01T08:00:00Z',
      commandId: 'c1',
      monthKey: '2026-01',
      expiresAtUtc: engine.computePositiveExpiryUtc('2026-01', 1), // 2026-02-28T22:00:00.000Z
    },
    {
      id: 'tx-feb-alloc',
      employeeId: 'emp-p',
      operationType: 'monthly_allocation',
      pointsDelta: 60,
      reasonId: 'sys',
      reasonSnapshot: 'База Лютий',
      comment: 'Лютий',
      occurredAtUtc: '2026-02-01T08:00:00Z',
      createdAtUtc: '2026-02-01T08:00:00Z',
      commandId: 'c2',
      monthKey: '2026-02',
      expiresAtUtc: engine.computePositiveExpiryUtc('2026-02', 1), // 2026-03-31T21:00:00.000Z
    },
    {
      id: 'tx-spend-jan',
      employeeId: 'emp-p',
      operationType: 'reward_spend',
      pointsDelta: -40,
      reasonId: 'bonus:b1',
      reasonSnapshot: 'Бонус',
      comment: 'Spend',
      occurredAtUtc: '2026-02-05T10:00:00Z',
      createdAtUtc: '2026-02-05T10:00:00Z',
      commandId: 'c3',
      monthKey: '2026-02',
    },
    {
      id: 'tx-refund-mar',
      employeeId: 'emp-p',
      operationType: 'reward_refund',
      pointsDelta: 40,
      reasonId: 'bonus:b1',
      reasonSnapshot: 'Refund',
      comment: 'Cancelled in March',
      occurredAtUtc: '2026-03-05T10:00:00Z',
      createdAtUtc: '2026-03-05T10:00:00Z',
      commandId: 'c4',
      reversalOfTransactionId: 'tx-spend-jan',
      monthKey: '2026-03',
    },
  ];

  // As of 2026-03-10: Jan remaining 20 expired, Jan spent 40 NOT resurrected on March refund -> only Feb 60 remains!
  const stateMar = engine.computeEmployeePointsState('emp-p', perfCfg, txs, '2026-03-10T12:00:00Z');
  assert.strictEqual(stateMar.availablePoints, 60);
  assert.strictEqual(stateMar.expiredPointsTotal, 20);
});

runTest('P04: Debt carryover offsets future positive credits & reason snapshot remains immutable', () => {
  const roles = engine.createDefaultPointsRoles();
  const perfCfg = engine.resolveEffectiveEmployeePointsConfig('emp-p', roles, [{ employeeId: 'emp-p', pointsRole: 'performer', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true }]);

  const built = engine.buildManualAdjustmentTransaction({
    employeeId: 'emp-p',
    operationType: 'manual_deduction',
    amount: 25,
    reasonId: 'r-miss',
    reasonNameSnapshot: 'Помилка у макеті',
    comment: 'Не перевірено шрифт',
    commandId: 'c-ded',
    occurredAtUtc: '2026-11-10T10:00:00Z',
  });
  assert.strictEqual(built.ok, true);

  // Must fail when comment missing or Інше without custom explanation
  const badOther = engine.buildManualAdjustmentTransaction({
    employeeId: 'emp-p',
    operationType: 'manual_award',
    amount: 5,
    reasonId: engine.OTHER_REASON_ID,
    reasonNameSnapshot: 'Інше',
    customExplanation: '   ',
    comment: 'Коментар',
    commandId: 'c-bad',
  });
  assert.strictEqual(badOther.ok, false);

  const stateBeforeAlloc = engine.computeEmployeePointsState('emp-p', perfCfg, [built.transaction], '2026-11-20T00:00:00Z');
  assert.strictEqual(stateBeforeAlloc.availablePoints, 0);
  assert.strictEqual(stateBeforeAlloc.debtCarriedForward, 25);

  const nextAlloc = engine.createMonthlyAllocationIfNeeded({
    employeeId: 'emp-p',
    monthKey: '2026-12',
    effectiveConfig: perfCfg,
    existingTransactions: [built.transaction],
    periods: [],
    nowIso: '2026-12-01T08:00:00Z',
  });
  assert.ok(nextAlloc);
  const stateAfterDecAlloc = engine.computeEmployeePointsState('emp-p', perfCfg, [built.transaction, nextAlloc], '2026-12-02T00:00:00Z');
  // 60 - 25 debt = 35 available, debt = 0
  assert.strictEqual(stateAfterDecAlloc.availablePoints, 35);
  assert.strictEqual(stateAfterDecAlloc.debtCarriedForward, 0);
  assert.strictEqual(built.transaction.reasonSnapshot, 'Помилка у макеті');
});

runTest('P05: Bonus eligibility precedence (employee > role > all) + price 0 override + claim lifecycle', () => {
  const bonuses = [
    { id: 'b-off', name: 'Day Off', description: '', requiredPoints: 150, rewardType: 'custom', claimed: false, fulfilled: false, isActive: true },
  ];
  const rules = [
    { id: 'r-all', bonusId: 'b-off', targetType: 'all', targetId: '*', priceOverride: 120, active: true, requiresApproval: true, maxQuantity: 2 },
    { id: 'r-role', bonusId: 'b-off', targetType: 'role', targetId: 'manager', priceOverride: 60, active: true, requiresApproval: true, maxQuantity: 2 },
    { id: 'r-emp', bonusId: 'b-off', targetType: 'employee', targetId: 'emp-vip', priceOverride: 0, active: true, requiresApproval: false, maxQuantity: 1 },
  ];

  const vipOffer = engine.resolveBonusOfferForEmployee(bonuses[0], rules, [], 'emp-vip', 'manager');
  assert.strictEqual(vipOffer.unitPricePoints, 0);
  assert.strictEqual(vipOffer.hasPriceOverride, true);
  assert.strictEqual(vipOffer.requiresApproval, false);
  assert.strictEqual(vipOffer.matchedBy, 'employee');

  const claimRes = engine.createBonusClaimTransactionAndRecord({
    employeeId: 'emp-vip',
    offer: vipOffer,
    quantity: 1,
    availablePoints: 0,
    commandId: 'claim-vip-1',
    existingClaims: [],
  });
  assert.strictEqual(claimRes.ok, true);
  assert.strictEqual(claimRes.claim.status, 'approved'); // auto-approved because requiresApproval=false

  // Duplicate command_id rejected
  const dupRes = engine.createBonusClaimTransactionAndRecord({
    employeeId: 'emp-vip',
    offer: vipOffer,
    quantity: 1,
    availablePoints: 0,
    commandId: 'claim-vip-1',
    existingClaims: [claimRes.claim],
  });
  assert.strictEqual(dupRes.ok, false);

  // Max quantity exhausted
  const mgrOffer = engine.resolveBonusOfferForEmployee(bonuses[0], rules, [claimRes.claim], 'emp-vip', 'manager');
  assert.strictEqual(mgrOffer.remainingQuantity, 0);
});

runTest('P06: canonicalSheetsAdapter round-trip preserves numeric 0 overrides & claim columns', () => {
  const normalizedProfiles = adapter.normalizeLoadedPointsProfiles([
    { employeeId: 'e1', pointsRole: 'manager', monthlyBaseOverride: 0, timeEarningOverride: false, minutesPerPointOverride: 15, pointsEnabled: true },
    { employeeId: 'e2', pointsRole: 'performer', monthlyBaseOverride: null, timeEarningOverride: null, minutesPerPointOverride: null, pointsEnabled: true },
  ]);
  assert.strictEqual(normalizedProfiles[0].monthlyBaseOverride, 0);
  assert.strictEqual(normalizedProfiles[0].timeEarningOverride, false);
  assert.strictEqual(normalizedProfiles[1].monthlyBaseOverride, null);
});

/* ============================================================================
 * 2. GAS Server Security, Isolation & E2E Command Tests
 * ========================================================================== */

runTest('G01: Anonymous Web App caller fails closed with AUTH_REQUIRED_PRIVILEGED_MUTATION', () => {
  const ss = createPointsMockSpreadsheet({ id: 'sheet-a', ownerEmail: 'owner@example.com' });
  const sandbox = createPointsGasSandbox({
    spreadsheets: [ss],
    scriptProperties: { BOUND_SPREADSHEET_ID: 'sheet-a', BOUND_SPREADSHEET_NAME: 'Team A' },
    activeUserEmail: '', // anonymous proxy / anyone deployment
  });

  const res = sandbox.gasExecutePointsCommand('sheet-a', {
    type: 'manual_adjustment',
    employeeId: 'emp-perf-1',
    operationType: 'manual_award',
    amount: 10,
    reasonId: 'reason-clean',
    reasonSnapshot: 'Чиста робота',
    comment: 'Спроба анонімної мутації',
    commandId: 'cmd-anon-1',
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'AUTH_REQUIRED_PRIVILEGED_MUTATION');
});

runTest('G02: Employee with points_role=manager ONLY (not owner/editor) fails closed with FORBIDDEN_PRIVILEGED_MUTATION', () => {
  const ss = createPointsMockSpreadsheet({ id: 'sheet-a', ownerEmail: 'owner@example.com', editorEmails: [] });
  const sandbox = createPointsGasSandbox({
    spreadsheets: [ss],
    scriptProperties: { BOUND_SPREADSHEET_ID: 'sheet-a', BOUND_SPREADSHEET_NAME: 'Team A' },
    // olena@example.com has points_role='manager' in Профілі балів, NOT editor/owner of the Spreadsheet!
    activeUserEmail: 'olena@example.com',
  });

  const res = sandbox.gasExecutePointsCommand('sheet-a', {
    type: 'save_roles',
    roles: [{ roleId: 'manager', name: 'Керівник', monthlyBasePoints: 999 }],
    commandId: 'cmd-priv-esc',
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'FORBIDDEN_PRIVILEGED_MUTATION');
});

runTest('G03: Verified Spreadsheet owner executes time_earning sync, manual adjustment, claim & reversal + audit log', () => {
  const ss = createPointsMockSpreadsheet({ id: 'sheet-a', ownerEmail: 'owner@example.com' });
  const sandbox = createPointsGasSandbox({
    spreadsheets: [ss],
    scriptProperties: { BOUND_SPREADSHEET_ID: 'sheet-a', BOUND_SPREADSHEET_NAME: 'Team A' },
    activeUserEmail: 'owner@example.com',
  });

  // 1. Ensure monthly base allocation (Тарас performer gets +60, Олена manager base=0)
  const allocRes = sandbox.gasExecutePointsCommand('sheet-a', {
    type: 'ensure_monthly_allocations',
    monthKey: '2026-11',
    commandId: 'cmd-alloc-2026-11',
  });
  assert.strictEqual(allocRes.ok, true);
  assert.strictEqual(allocRes.transactions.length, 1);
  assert.strictEqual(allocRes.transactions[0].employeeId, 'emp-perf-1');
  assert.strictEqual(allocRes.transactions[0].pointsDelta, 60);

  // 2. Sync time earning (Олена has 90s + 1710s = 1800s in cat-help -> +1 pt!)
  const syncRes = sandbox.gasExecutePointsCommand('sheet-a', {
    type: 'sync_time_earning',
    commandId: 'cmd-sync-1',
  });
  assert.strictEqual(syncRes.ok, true);
  assert.strictEqual(syncRes.transactions.length, 1);
  assert.strictEqual(syncRes.transactions[0].employeeId, 'emp-mgr-1');
  assert.strictEqual(syncRes.transactions[0].pointsDelta, 1);

  // 3. Re-running sync_time_earning creates 0 duplicates
  const syncRes2 = sandbox.gasExecutePointsCommand('sheet-a', {
    type: 'sync_time_earning',
    commandId: 'cmd-sync-2',
  });
  assert.strictEqual(syncRes2.ok, true);
  assert.strictEqual(syncRes2.transactions.length, 0);

  // 4. Claim bonus for Тарас (coffee 40 pts <= 60 pts)
  const claimRes = sandbox.gasExecutePointsCommand('sheet-a', {
    type: 'claim_bonus',
    employeeId: 'emp-perf-1',
    bonusId: 'bon-coffee',
    quantity: 1,
    comment: 'Кава в офісі',
    commandId: 'cmd-claim-coffee-1',
  });
  assert.strictEqual(claimRes.ok, true);
  assert.strictEqual(claimRes.spendTransaction.pointsDelta, -40);

  // 5. Verify loadAllData returns populated normalized slices + audit entries
  const loaded = sandbox.gasLoadAllData('sheet-a');
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.pointsRoles.length, 2);
  assert.strictEqual(loaded.pointsProfiles.length, 2);
  assert.strictEqual(loaded.pointsReasons.length, 4);
  assert.strictEqual(loaded.pointsTransactions.length, 3);
  assert.strictEqual(loaded.bonusClaims.length, 1);
  assert.strictEqual(loaded.pointsAudit.schemaReady, true);
  assert.strictEqual(ss.getSheetByName('Журнал змін')._rows.length, 4); // header + 3 audited ops
});

runTest('G04: Bound project isolation prevents client arguments from switching to another Sheet', () => {
  const sheetA = createPointsMockSpreadsheet({ id: 'sheet-project-A', name: 'Copy Team A', ownerEmail: 'a@example.com' });
  const sheetB = createPointsMockSpreadsheet({ id: 'sheet-project-B', name: 'Copy Team B', ownerEmail: 'b@example.com' });

  const sandboxA = createPointsGasSandbox({
    spreadsheets: [sheetA, sheetB],
    activeSpreadsheet: sheetA,
    activeUserEmail: 'a@example.com',
  });

  // One-time private initializer pins Sheet A in ScriptProperties
  const initA = sandboxA.initializeBoundSpreadsheet_();
  assert.strictEqual(initA.ok, true);
  assert.strictEqual(sandboxA._propStore.BOUND_SPREADSHEET_ID, 'sheet-project-A');

  // Re-running private initializer when active sheet differs returns explicit mismatch without overwriting
  const sandboxMismatch = createPointsGasSandbox({
    spreadsheets: [sheetA, sheetB],
    activeSpreadsheet: sheetB,
    scriptProperties: { BOUND_SPREADSHEET_ID: 'sheet-project-A', BOUND_SPREADSHEET_NAME: 'Copy Team A' },
  });
  const initMismatch = sandboxMismatch.initializeBoundSpreadsheet_();
  assert.strictEqual(initMismatch.ok, false);
  assert.strictEqual(initMismatch.code, 'SPREADSHEET_BINDING_MISMATCH');
  assert.strictEqual(sandboxMismatch._propStore.BOUND_SPREADSHEET_ID, 'sheet-project-A');

  // Passing Sheet B ID from client RPC into Project A fails closed with SPREADSHEET_MISMATCH
  const loadAttacker = sandboxA.gasLoadAllData('sheet-project-B');
  assert.strictEqual(loadAttacker.ok, false);
  assert.strictEqual(loadAttacker.code, 'SPREADSHEET_MISMATCH');
});

runTest('G05: Older spreadsheet without new 6 points tabs loads safely and fails closed on points write', () => {
  const legacySheet = createPointsMockSpreadsheet({ id: 'legacy-sheet', includePointsSheets: false, ownerEmail: 'owner@example.com' });
  const sandbox = createPointsGasSandbox({
    spreadsheets: [legacySheet],
    scriptProperties: { BOUND_SPREADSHEET_ID: 'legacy-sheet' },
    activeUserEmail: 'owner@example.com',
  });

  const loaded = sandbox.gasLoadAllData('legacy-sheet');
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.pointsAudit.schemaReady, false);
  assert.strictEqual(loaded.pointsAudit.missingSheets.length, 6);

  const writeRes = sandbox.gasExecutePointsCommand('legacy-sheet', {
    type: 'save_reasons',
    reasons: [],
    commandId: 'cmd-legacy',
  });
  assert.strictEqual(writeRes.ok, false);
  assert.strictEqual(writeRes.code, 'SCHEMA_COMPATIBILITY_BLOCKED');
});

// Clean up temporary directory
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n--- TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ---`);
if (failedCount > 0) process.exit(1);
