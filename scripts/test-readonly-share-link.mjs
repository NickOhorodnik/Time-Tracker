import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

console.log('--- STARTING READ-ONLY SHARE LINK TEST SUITE ---');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-readonly-share-'));
const shareBundlePath = path.join(tmpDir, 'shareLink.mjs');
const parserBundlePath = path.join(tmpDir, 'publicSheetParser.mjs');
const bridgeBundlePath = path.join(tmpDir, 'gasBridge.mjs');
const apiBundlePath = path.join(tmpDir, 'api.mjs');

await Promise.all([
  esbuild.build({
    entryPoints: ['src/utils/shareLink.ts'],
    outfile: shareBundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
  }),
  esbuild.build({
    entryPoints: ['src/utils/publicSheetParser.ts'],
    outfile: parserBundlePath,
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
    entryPoints: ['src/services/api.ts'],
    outfile: apiBundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
  }),
]);

const shareMod = await import(pathToFileURL(shareBundlePath).href);
const parserMod = await import(pathToFileURL(parserBundlePath).href);

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

await runTest('shareLink.ts parses ?sheet=, ?spreadsheet=, bare ?https://..., #hash, and &gas= URLs', () => {
  const sampleSheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const sampleSheetUrl = `https://docs.google.com/spreadsheets/d/${sampleSheetId}/edit#gid=0`;
  const sampleGasUrl = 'https://script.google.com/macros/s/AKfycbzTestDeployment12345/exec';

  assert.strictEqual(shareMod.parseReadOnlyShareLink('', ''), null);
  assert.strictEqual(shareMod.parseReadOnlyShareLink('?tab=timer', ''), null);

  const publicCfg = shareMod.parseReadOnlyShareLink(`?sheet=${encodeURIComponent(sampleSheetUrl)}`, '');
  assert.ok(publicCfg);
  assert.strictEqual(publicCfg.isReadOnly, true);
  assert.strictEqual(publicCfg.sourceMode, 'public_sheet');
  assert.strictEqual(publicCfg.spreadsheetId, sampleSheetId);
  assert.strictEqual(publicCfg.gasUrl, '');
  assert.strictEqual(publicCfg.error, null);

  const gasCfg = shareMod.parseReadOnlyShareLink(
    `?spreadsheet=${sampleSheetId}&gas=${encodeURIComponent(sampleGasUrl)}`,
    ''
  );
  assert.ok(gasCfg);
  assert.strictEqual(gasCfg.isReadOnly, true);
  assert.strictEqual(gasCfg.sourceMode, 'gas');
  assert.strictEqual(gasCfg.spreadsheetId, sampleSheetId);
  assert.strictEqual(gasCfg.gasUrl, sampleGasUrl);
  assert.strictEqual(gasCfg.error, null);

  const bareCfg = shareMod.parseReadOnlyShareLink(`?${sampleSheetUrl}`, '');
  assert.ok(bareCfg);
  assert.strictEqual(bareCfg.isReadOnly, true);
  assert.strictEqual(bareCfg.spreadsheetId, sampleSheetId);
  assert.strictEqual(bareCfg.error, null);

  const hashCfg = shareMod.parseReadOnlyShareLink('', `#/view?sheet=${encodeURIComponent(sampleSheetUrl)}`);
  assert.ok(hashCfg);
  assert.strictEqual(hashCfg.isReadOnly, true);
  assert.strictEqual(hashCfg.spreadsheetId, sampleSheetId);
  assert.strictEqual(hashCfg.error, null);

  const invalidSheet = shareMod.parseReadOnlyShareLink('?sheet=https://evil.example.com/nope', '');
  assert.ok(invalidSheet);
  assert.strictEqual(invalidSheet.isReadOnly, true);
  assert.ok(invalidSheet.error);

  const invalidGas = shareMod.parseReadOnlyShareLink(
    `?sheet=${sampleSheetId}&gas=${encodeURIComponent('https://evil.example.com/exec')}`,
    ''
  );
  assert.ok(invalidGas);
  assert.strictEqual(invalidGas.isReadOnly, true);
  assert.ok(invalidGas.error);

  const builtPublic = shareMod.buildReadOnlyShareUrl('https://app.example.com/?tab=settings', sampleSheetId);
  const parsedBuiltPublic = shareMod.parseReadOnlyShareLink(new URL(builtPublic).search, '');
  assert.strictEqual(parsedBuiltPublic.spreadsheetId, sampleSheetId);
  assert.strictEqual(parsedBuiltPublic.sourceMode, 'public_sheet');

  const builtGas = shareMod.buildReadOnlyShareUrl('https://app.example.com/', sampleSheetId, sampleGasUrl);
  const parsedBuiltGas = shareMod.parseReadOnlyShareLink(new URL(builtGas).search, '');
  assert.strictEqual(parsedBuiltGas.spreadsheetId, sampleSheetId);
  assert.strictEqual(parsedBuiltGas.gasUrl, sampleGasUrl);
  assert.strictEqual(parsedBuiltGas.sourceMode, 'gas');
});

await runTest('publicSheetParser.ts parses htmlview metadata, CSV rows, canonical tabs, tombstones, and points sheets', () => {
  const sampleHtml = `
    <html>
      <head><title>Команда Проєкту — Google Таблиці</title></head>
      <body>
        <script>
          var items = [];
          items.push({name: "Записи", pageUrl: "...", gid: "0"});
          items.push({name: "2026-11", pageUrl: "...", gid: "101"});
          items.push({name: "Категорії", pageUrl: "...", gid: "202"});
          items.push({name: "Типи дій", pageUrl: "...", gid: "203"});
          items.push({name: "Проєкти", pageUrl: "...", gid: "204"});
          items.push({name: "Працівники", pageUrl: "...", gid: "205"});
          items.push({name: "Оцінки", pageUrl: "...", gid: "206"});
          items.push({name: "Бонуси", pageUrl: "...", gid: "207"});
          items.push({name: "Отримані бонуси", pageUrl: "...", gid: "208"});
          items.push({name: "Фрази", pageUrl: "...", gid: "209"});
          items.push({name: "Мотиваційні фрази", pageUrl: "...", gid: "210"});
          items.push({name: "Налаштування", pageUrl: "...", gid: "211"});
          items.push({name: "Бібліотека зображень", pageUrl: "...", gid: "212"});
          items.push({name: "Призначення зображень", pageUrl: "...", gid: "213"});
          items.push({name: "Ролі балів", pageUrl: "...", gid: "301"});
          items.push({name: "Профілі балів", pageUrl: "...", gid: "302"});
          items.push({name: "Причини балів", pageUrl: "...", gid: "303"});
          items.push({name: "Операції балів", pageUrl: "...", gid: "304"});
          items.push({name: "Періоди балів", pageUrl: "...", gid: "305"});
          items.push({name: "Доступність бонусів", pageUrl: "...", gid: "306"});
          items.push({name: "Чернетка Нотаток", pageUrl: "...", gid: "999"});
        </script>
      </body>
    </html>
  `;

  const meta = parserMod.extractHtmlViewMetadata(sampleHtml);
  assert.strictEqual(meta.title, 'Команда Проєкту');
  assert.strictEqual(meta.tabs.length, 21);
  assert.strictEqual(
    meta.tabs.filter((t) => parserMod.isCanonicalOrMonthSheetName(t.name)).length,
    20
  );

  // Missing canonical Записи blocks load safely
  const blocked = parserMod.buildPublicSheetLoadResponse({
    spreadsheetId: 'sheet-missing-entries',
    spreadsheetName: 'Test',
    sheetsByName: {},
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'SCHEMA_COMPATIBILITY_BLOCKED');

  const csvRows = parserMod.csvToNormalizedObjects(
    [
      'segment_id,дата,початок_utc,кінець_utc,секунд,category_id,action_id,project_id,опис,employee_id,deleted_at_utc',
      'seg-1,2026-11-19,2026-11-19T08:00:00.000Z,2026-11-19T09:00:00.000Z,3600,cat-1,act-1,proj-1,"Робота, ""важлива""",emp-1,',
      'seg-deleted,2026-11-19,2026-11-19T10:00:00.000Z,2026-11-19T10:30:00.000Z,1800,cat-1,act-1,proj-1,Видалений,emp-1,2026-11-19T11:00:00.000Z',
    ].join('\n')
  );

  const monthRows = parserMod.csvToNormalizedObjects(
    [
      'segment_id,дата,початок_utc,кінець_utc,секунд,category_id,action_id,project_id,опис,employee_id,deleted_at_utc',
      'seg-2,2026-11-20,2026-11-20T09:00:00.000Z,2026-11-20T09:30:00.000Z,1800,cat-1,act-1,proj-1,Сесія з місяця,emp-1,',
    ].join('\n')
  );

  const payload = parserMod.buildPublicSheetLoadResponse({
    spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    spreadsheetName: meta.title,
    sheetsByName: {
      'Записи': csvRows,
      '2026-11': monthRows,
      'Категорії': parserMod.csvToNormalizedObjects('id,назва,колір_hex,активна\ncat-1,Розробка,#3B82F6,TRUE'),
      'Типи дій': parserMod.csvToNormalizedObjects('id,назва,активна\nact-1,Кодінг,TRUE'),
      'Проєкти': parserMod.csvToNormalizedObjects('id,назва,активний\nproj-1,Allonsy,TRUE'),
      'Працівники': parserMod.csvToNormalizedObjects('employee_id,name,role,status\nemp-1,Олена,Розробниця,active'),
      'Оцінки': parserMod.csvToNormalizedObjects('rating_id,employee_id,score,rated_at_utc,comment\nrat-1,emp-1,5,2026-11-19T12:00:00.000Z,Супер'),
      'Бонуси': parserMod.csvToNormalizedObjects('id,назва,ціна_балів,опис,активний,image_asset_id\nbon-1,Кава,50,Американо,TRUE,asset-bon-1'),
      'Отримані бонуси': [],
      'Фрази': parserMod.csvToNormalizedObjects('id,текст,активна,порядок\nph-1,Вперед!,TRUE,1'),
      'Мотиваційні фрази': parserMod.csvToNormalizedObjects('id,текст,активна,порядок\nmot-1,Вже {hours} год!,TRUE,1'),
      'Налаштування': parserMod.csvToNormalizedObjects('ключ,значення\nhourlyRate,45\ntargetHours,160\npointsEligibleCategoryIds,"[""cat-1""]"'),
      'Бібліотека зображень': parserMod.csvToNormalizedObjects('asset_id,назва,group,image_url,активна\nasset-bon-1,Кава,bonuses,https://res.cloudinary.com/demo/image/upload/sample.jpg,TRUE'),
      'Призначення зображень': [],
      'Ролі балів': [],
      'Профілі балів': [],
      'Причини балів': [],
      'Операції балів': [],
      'Періоди балів': [],
      'Доступність бонусів': [],
    },
  });

  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.entries.length, 2);
  assert.strictEqual(payload.entries[0].description, 'Робота, "важлива"');
  assert.strictEqual(payload.bonuses[0].imageUrl, 'https://res.cloudinary.com/demo/image/upload/sample.jpg');
  assert.strictEqual(payload.settings.hourlyRate, 45);
  assert.deepStrictEqual(payload.settings.pointsEligibleCategoryIds, ['cat-1']);
  assert.strictEqual(payload.pointsAudit.schemaReady, true);
});

await runTest('gasBridge + api isolate localStorage and fail closed on every mutation in read-only share mode', async () => {
  const storageMap = new Map([
    ['allonsy_settings', JSON.stringify({ gasWebAppUrl: 'https://script.google.com/macros/s/OWNER_PRIVATE/exec', hourlyRate: 99 })],
    ['allonsy_entries', JSON.stringify([{ id: 'owner-local-entry', description: 'Private draft' }])],
  ]);

  let writeAttemptedToStorage = false;
  globalThis.localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => {
      writeAttemptedToStorage = true;
      storageMap.set(k, String(v));
    },
    removeItem: (k) => {
      writeAttemptedToStorage = true;
      storageMap.delete(k);
    },
  };

  const sheetId = '1ReadOnlyTestSheetId1234567890abcd';
  globalThis.window = {
    location: {
      search: `?sheet=${encodeURIComponent(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`)}`,
      hash: '',
      href: `https://app.example.com/?sheet=${sheetId}`,
    },
    setTimeout,
    clearTimeout,
  };

  const fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        success: true,
        spreadsheetId: sheetId,
        spreadsheetName: 'Shared Sheet',
        entries: [],
      }),
    };
  };

  const { gasBridge, isReadOnlyShareMode, isGasHostedRuntime, READ_ONLY_ERROR_MESSAGE } = await import(
    `${pathToFileURL(bridgeBundlePath).href}?v=1`
  );
  const { api } = await import(`${pathToFileURL(apiBundlePath).href}?v=1`);

  assert.strictEqual(isReadOnlyShareMode(), true);
  assert.strictEqual(isGasHostedRuntime(), true);

  // api.getAppData() must NOT leak recipient's local entries or gasWebAppUrl
  const initialData = await api.getAppData();
  assert.strictEqual(initialData.entries.length, 0);
  assert.strictEqual(initialData.employees.length, 0);
  assert.strictEqual(initialData.settings.gasWebAppUrl, undefined);
  assert.strictEqual(initialData.settings.googleSpreadsheetId, sheetId);
  assert.strictEqual(writeAttemptedToStorage, false);

  // Load routes to /api/public-sheet-load when no &gas= param is provided
  const loadRes = await gasBridge.loadAllData();
  assert.strictEqual(loadRes.ok, true);
  assert.strictEqual(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.startsWith(`/api/public-sheet-load?sheet=`));

  // Every single write RPC must fail closed with READ_ONLY_MODE and NEVER call fetch
  const fetchCountBeforeWrites = fetchCalls.length;
  const writeChecks = [
    await gasBridge.setupSpreadsheet(),
    await gasBridge.saveTimeEntry({ id: 'e1', date: '2026-11-20', startTime: '10:00', endTime: '11:00', durationMinutes: 60, categoryId: 'c1', actionTypeId: 'a1', projectId: 'p1', description: 'x' }),
    await gasBridge.deleteTimeEntry('e1'),
    await gasBridge.syncAll({}),
    await gasBridge.saveConfig({}),
    await gasBridge.saveEmployee({ id: 'emp-1', name: 'Test', status: 'active' }),
    await gasBridge.archiveEmployee('emp-1'),
    await gasBridge.saveRating({ id: 'r-1', employeeId: 'emp-1', score: 5, emoji: '🔥', sentiment: 'positive', label: 'Топ', date: '2026-11-20', time: '10:00', createdAt: '', updatedAt: '' }),
    await gasBridge.saveImageRegistry([]),
    await gasBridge.saveImageAssignments([]),
    await gasBridge.executePointsCommand({ type: 'manual_adjustment' }),
  ];

  for (const res of writeChecks) {
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'READ_ONLY_MODE');
    assert.strictEqual(res.error, READ_ONLY_ERROR_MESSAGE);
  }
  assert.strictEqual(fetchCalls.length, fetchCountBeforeWrites, 'Write RPCs must not hit network in read-only mode');

  // API-level write helpers also fail closed and do not mutate localStorage
  const apiSyncRes = await api.syncAllWithGas({});
  assert.strictEqual(apiSyncRes.success, false);
  const apiSetupRes = await api.setupSpreadsheet();
  assert.strictEqual(apiSetupRes.success, false);
  const apiEmpRes = await api.saveEmployeeRemote({ id: 'emp-x', name: 'X', status: 'active' }, true);
  assert.strictEqual(apiEmpRes.success, false);
  const apiPointsRes = await api.executePointsCommandRemote({ type: 'manual_adjustment' });
  assert.strictEqual(apiPointsRes.success, false);

  await api.saveSettings({ ...initialData.settings, hourlyRate: 777 });
  assert.strictEqual(writeAttemptedToStorage, false, 'localStorage must remain untouched in read-only mode');

  // Now switch window.location.search to include &gas=... and verify read-only GAS proxy routing
  const gasExecUrl = 'https://script.google.com/macros/s/AKfycbSharedViewerGas123/exec';
  globalThis.window.location.search = `?sheet=${sheetId}&gas=${encodeURIComponent(gasExecUrl)}`;
  await gasBridge.loadAllData();
  const lastCall = fetchCalls[fetchCalls.length - 1];
  assert.strictEqual(lastCall.url, '/api/gas-proxy');
  const body = JSON.parse(lastCall.init.body);
  assert.strictEqual(body.readOnly, true);
  assert.strictEqual(body.method, 'gasLoadAllData');
  assert.strictEqual(body.spreadsheetInput, sheetId);
  assert.strictEqual(body.gasUrl, gasExecUrl);
});

await runTest('server.ts enforces HTTP 403 READ_ONLY_MODE on /api/gas-proxy and exposes /api/public-sheet-load', () => {
  const serverSrc = fs.readFileSync('server.ts', 'utf8');
  assert.ok(serverSrc.includes("if (readOnly === true && !GAS_READ_METHODS.has(method))"));
  assert.ok(serverSrc.includes("code: 'READ_ONLY_MODE'"));
  assert.ok(serverSrc.includes("app.get('/api/public-sheet-load'"));
  assert.ok(serverSrc.includes("code: 'SHEET_NOT_PUBLIC'"));
  assert.ok(serverSrc.includes("code: 'SPREADSHEET_NOT_FOUND'"));
});

await runTest('SettingsView.tsx renders click-to-copy read-only share links in Google Sheets / GAS tab', () => {
  const settingsSrc = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');
  assert.ok(settingsSrc.includes('data-testid="readonly-share-links-card"'));
  assert.ok(settingsSrc.includes('copyTextToClipboard'));
  assert.ok(settingsSrc.includes("handleCopyShareLink('gas', gasShareUrl)"));
  assert.ok(settingsSrc.includes("handleCopyShareLink('public', publicShareUrl)"));
  assert.ok(settingsSrc.includes('Клік для копіювання'));
});

console.log(`\nRead-only Share Link Test Summary: ${passedCount} passed, ${failedCount} failed.`);
if (failedCount > 0) {
  process.exit(1);
}
