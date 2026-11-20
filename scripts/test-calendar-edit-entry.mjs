import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

console.log('--- STARTING CALENDAR ENTRY EDIT & SHEETS ROUND-TRIP TEST SUITE ---');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-calendar-edit-'));
const adapterBundlePath = path.join(tmpDir, 'canonicalSheetsAdapter.mjs');

await esbuild.build({
  entryPoints: ['src/utils/canonicalSheetsAdapter.ts'],
  outfile: adapterBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

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

function createMockSpreadsheet() {
  const sheets = [
    createMockSheet('Записи', [
      [
        'segment_id',
        'session_id',
        'command_id',
        'дата',
        'початок_utc',
        'кінець_utc',
        'секунд',
        'category_id',
        'категорія_назва',
        'action_id',
        'project_id',
        'опис',
        'створено_utc',
        'джерело',
        'month_key',
        'примітка',
        'employee_id',
        'related_employee_id',
        'updated_at_utc',
        'deleted_at_utc',
        'change_reason',
      ],
      [
        'seg-edit-001',
        'sess-001',
        'cmd-001',
        '2026-11-18',
        '2026-11-18T10:00:00.000Z',
        '2026-11-18T11:30:00.000Z',
        5400,
        'cat-dev',
        'Розробка',
        'act-build',
        'proj-core',
        'Початкова задача',
        '2026-11-18T10:00:00.000Z',
        'manual',
        '2026-11-18',
        'Стара примітка',
        'emp-1',
        '',
        '2026-11-18T11:30:00.000Z',
        '',
        '',
      ],
    ]),
    createMockSheet('Категорії', [
      ['id', 'назва', 'колір_hex', 'іконка_lucide', 'активна'],
      ['cat-dev', 'Розробка', '#00bcd4', 'code', true],
      ['cat-qa', 'Тестування', '#ff9800', 'bug', true],
    ]),
    createMockSheet('Типи дій', [
      ['id', 'назва', 'активний'],
      ['act-build', 'Реалізація', true],
      ['act-fix', 'Виправлення', true],
    ]),
    createMockSheet('Проєкти', [
      ['id', 'назва', 'активний'],
      ['proj-core', 'Core App', true],
      ['proj-crm', 'CRM Portal', true],
    ]),
    createMockSheet('Бонуси', [['id', 'назва', 'опис', 'тип', 'ціна_балів', 'активний', 'image_asset_id']]),
    createMockSheet('Отримані бонуси', [['claim_id', 'bonus_id', 'статус']]),
    createMockSheet('Фрази', [['id', 'текст', 'активна', 'порядок']]),
    createMockSheet('Мотиваційні фрази', [['id', 'template', 'active', 'sort_order']]),
    createMockSheet('Налаштування', [['ключ', 'значення']]),
    createMockSheet('Працівники', [
      ['employee_id', 'name', 'role', 'status', 'avatar_asset_id', 'portrait_asset_id', 'notes', 'created_at_utc', 'updated_at_utc'],
      ['emp-1', 'Андрій', 'Розробник', 'active', '', '', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'],
      ['emp-2', 'Олена', 'Дизайнер', 'active', '', '', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'],
    ]),
    createMockSheet('Оцінки', [['rating_id', 'employee_id', 'score', 'comment', 'rated_at_utc', 'created_at_utc', 'updated_at_utc', 'deleted_at_utc', 'source']]),
    createMockSheet('Бібліотека зображень', [['asset_id', 'filename', 'display_name', 'folder_path', 'file_reference', 'is_active', 'image_url']]),
    createMockSheet('Призначення зображень', [['assignment_id', 'target_type', 'target_id', 'slot_key', 'asset_id', 'active']]),
  ];

  return {
    getId: () => 'sheet-calendar-edit-001',
    getName: () => 'Calendar Edit Test Sheet',
    getSheets: () => sheets,
    getSheetByName: (targetName) => sheets.find((s) => s.getName() === targetName) || null,
  };
}

function createGasSandbox(ss) {
  const sandbox = {
    SpreadsheetApp: {
      openById: (id) => {
        if (ss.getId() === id) return ss;
        throw new Error(`Unexpected sheet id: ${id}`);
      },
      flush: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'BOUND_SPREADSHEET_ID' ? ss.getId() : null),
        setProperty: () => {},
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock: () => undefined,
        hasLock: () => true,
        releaseLock: () => {},
      }),
    },
    Utilities: {
      sleep: () => {},
      formatDate: (dateObj, tz, fmt) => {
        const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
        const timeZone = tz || 'Europe/Kyiv';
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(d);
        const y = parts.find((p) => p.type === 'year')?.value;
        const m = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        const h = parts.find((p) => p.type === 'hour')?.value;
        const min = parts.find((p) => p.type === 'minute')?.value;
        if (fmt === 'HH:mm') return `${h}:${min}`;
        if (fmt === 'yyyy-MM-dd') return `${y}-${m}-${day}`;
        return d.toISOString();
      },
      parseDate: (str) => new Date(str.replace(' ', 'T') + 'Z'),
    },
    Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
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
  return sandbox;
}

const adapter = await import(`${pathToFileURL(adapterBundlePath).href}?t=${Date.now()}`);

await runTest('T01: prepareUpdatedTimeEntry recomputes timestamps, elapsedSeconds, monthKey, categoryName when editing a Sheet-loaded entry', () => {
  const loadedEntry = {
    id: 'seg-edit-001',
    date: '2026-11-18',
    startTime: '10:00',
    endTime: '11:30',
    durationMinutes: 90,
    elapsedSeconds: 5400,
    startedAtUtc: '2026-11-18T10:00:00.000Z',
    endedAtUtc: '2026-11-18T11:30:00.000Z',
    monthKey: '2026-11',
    categoryId: 'cat-dev',
    categoryName: 'Розробка',
    actionTypeId: 'act-build',
    projectId: 'proj-core',
    employeeId: 'emp-1',
    description: 'Початкова задача',
    notes: 'Стара примітка',
  };

  const editedFromCalendar = {
    ...loadedEntry,
    date: '2026-10-05',
    startTime: '13:15',
    endTime: '15:45',
    durationMinutes: 150,
    categoryId: 'cat-qa',
    actionTypeId: 'act-fix',
    projectId: 'proj-crm',
    employeeId: 'emp-2',
    relatedEmployeeId: 'emp-1',
    description: 'Оновлена перевірка CRM',
    notes: 'Нова примітка',
  };

  const prepared = adapter.prepareUpdatedTimeEntry(
    editedFromCalendar,
    loadedEntry,
    [
      { id: 'cat-dev', name: 'Розробка', color: '#00bcd4', icon: 'code' },
      { id: 'cat-qa', name: 'Тестування', color: '#ff9800', icon: 'bug' },
    ]
  );

  assert.strictEqual(prepared.date, '2026-10-05');
  assert.strictEqual(prepared.durationMinutes, 150);
  assert.strictEqual(prepared.elapsedSeconds, 9000);
  assert.deepStrictEqual(adapter.decomposeUtcIso(prepared.startedAtUtc), { date: '2026-10-05', time: '13:15' });
  assert.deepStrictEqual(adapter.decomposeUtcIso(prepared.endedAtUtc), { date: '2026-10-05', time: '15:45' });
  assert.strictEqual(prepared.monthKey, '2026-10');
  assert.strictEqual(prepared.categoryName, 'Тестування');
  assert.strictEqual(prepared.relatedEmployeeId, 'emp-1');
  assert.strictEqual(prepared.notes, 'Нова примітка');

  // Verify manual duration override (without changing start/end) updates elapsedSeconds
  const durationEdited = adapter.prepareUpdatedTimeEntry(
    { ...prepared, durationMinutes: 45 },
    prepared,
    []
  );
  assert.strictEqual(durationEdited.durationMinutes, 45);
  assert.strictEqual(durationEdited.elapsedSeconds, 2700);
});

await runTest('T02: Edited Calendar entry persists cleanly via gasSaveTimeEntry and reloads with updated fields in gasLoadAllData', () => {
  const ss = createMockSpreadsheet();
  const sandbox = createGasSandbox(ss);

  const initialLoad = sandbox.gasLoadAllData(ss.getId());
  assert.strictEqual(initialLoad.ok, true);
  assert.strictEqual(initialLoad.entries.length, 1);
  const existing = initialLoad.entries[0];
  assert.strictEqual(existing.id, 'seg-edit-001');
  assert.strictEqual(existing.durationMinutes, 90);

  const edited = adapter.prepareUpdatedTimeEntry(
    {
      ...existing,
      date: '2026-11-20',
      startTime: '14:00',
      endTime: '16:15',
      durationMinutes: 135,
      categoryId: 'cat-qa',
      actionTypeId: 'act-fix',
      projectId: 'proj-crm',
      employeeId: 'emp-2',
      relatedEmployeeId: 'emp-1',
      description: 'Відредагована задача з календаря',
      notes: 'Узгоджено з командою',
    },
    existing,
    initialLoad.categories
  );

  const saveRes = sandbox.gasSaveTimeEntry(ss.getId(), edited);
  assert.strictEqual(saveRes.ok, true);

  const reloaded = sandbox.gasLoadAllData(ss.getId());
  assert.strictEqual(reloaded.ok, true);
  assert.strictEqual(reloaded.entries.length, 1);

  const row = reloaded.entries[0];
  assert.strictEqual(row.id, 'seg-edit-001');
  assert.strictEqual(row.date, '2026-11-20');
  assert.strictEqual(row.startTime, '14:00');
  assert.strictEqual(row.endTime, '16:15');
  assert.strictEqual(row.durationMinutes, 135);
  assert.strictEqual(row.elapsedSeconds, 8100);
  assert.strictEqual(row.categoryId, 'cat-qa');
  assert.strictEqual(row.categoryName, 'Тестування');
  assert.strictEqual(row.actionTypeId, 'act-fix');
  assert.strictEqual(row.projectId, 'proj-crm');
  assert.strictEqual(row.employeeId, 'emp-2');
  assert.strictEqual(row.relatedEmployeeId, 'emp-1');
  assert.strictEqual(row.description, 'Відредагована задача з календаря');
  assert.strictEqual(row.notes, 'Узгоджено з командою');
});

await runTest('T03: CalendarView exposes clickable edit triggers across month chips, mobile agenda, week/day timeline, and all entry fields in modal', () => {
  const calendarSrc = fs.readFileSync('src/components/CalendarView.tsx', 'utf8');
  const appSrc = fs.readFileSync('src/App.tsx', 'utf8');

  assert.strictEqual(calendarSrc.includes('onUpdateEntry: (entry: TimeEntry) => void'), true);
  assert.strictEqual(calendarSrc.includes('openEditModal(entry)'), true);
  assert.strictEqual(calendarSrc.includes("editingEntry ? 'Редагувати запис часу' : 'Додати запис часу вручну'"), true);
  assert.strictEqual(calendarSrc.includes('calendar-entry-duration'), true);
  assert.strictEqual(calendarSrc.includes('calendar-entry-notes'), true);
  assert.strictEqual(calendarSrc.includes('manual-related-employee-select'), true);
  assert.strictEqual(appSrc.includes('onUpdateEntry={handleUpdateEntry}'), true);
  assert.strictEqual(appSrc.includes('prepareUpdatedTimeEntry('), true);
});

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n--- TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ---`);
if (failedCount > 0) process.exit(1);
