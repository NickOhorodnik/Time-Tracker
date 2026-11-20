const ALLOWED_GAS_METHODS = new Set([
  'gasHealthCheck', 'gasSetupSpreadsheet', 'gasLoadAllData', 'gasSaveTimeEntry',
  'gasDeleteTimeEntry', 'gasSyncAll', 'gasSaveConfig', 'gasListEmployees',
  'gasSaveEmployee', 'gasArchiveEmployee', 'gasListRatings', 'gasSaveRating',
  'gasGetImageLibrary', 'gasSaveImageRegistry', 'gasSaveImageAssignments',
  'gasSetupAddImageUrlColumn', 'gasExecutePointsCommand',
]);
const GAS_READ_METHODS = new Set([
  'gasHealthCheck', 'gasLoadAllData', 'gasListEmployees', 'gasListRatings',
  'gasGetImageLibrary',
]);
const CANONICAL_PUBLIC_SHEET_NAMES = new Set([
  'Записи',
  'Категорії',
  'Типи дій',
  'Проєкти',
  'Бонуси',
  'Отримані бонуси',
  'Фрази',
  'Мотиваційні фрази',
  'Налаштування',
  'Працівники',
  'Оцінки',
  'Бібліотека зображень',
  'Призначення зображень',
  'Ролі балів',
  'Профілі балів',
  'Причини балів',
  'Операції балів',
  'Періоди балів',
  'Доступність бонусів',
]);
const GAS_URL_PATH = /^\/macros\/(?:u\/\d+\/)?s\/[A-Za-z0-9_-]+\/exec\/?$/;
const APP_ORIGIN = 'https://time-tracker.allonsy.agency';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractSpreadsheetId(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,120})/);
  const candidate = match ? match[1] : raw;
  return /^[a-zA-Z0-9_-]{10,120}$/.test(candidate) ? candidate : '';
}

function isCanonicalOrMonthSheetName(name) {
  const trimmed = String(name || '').trim();
  return CANONICAL_PUBLIC_SHEET_NAMES.has(trimmed) || /^\d{4}-\d{2}$/.test(trimmed);
}

function normalizeCsvHeader(raw) {
  return String(raw || '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

function unescapeJsStringLiteral(raw) {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function extractHtmlViewMetadata(html) {
  const rawHtml = String(html || '');
  let title = '';
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = decodeHtmlEntities(titleMatch[1].trim())
      .replace(/\s*[-—]\s*Google\s+(?:Sheets|Таблиці)\s*$/i, '')
      .trim();
  }

  const tabs = [];
  const seenGid = new Set();
  const addTab = (nameRaw, gidRaw) => {
    const name = decodeHtmlEntities(unescapeJsStringLiteral(String(nameRaw || ''))).trim();
    const gid = String(gidRaw || '').trim();
    if (!name || !/^\d+$/.test(gid) || seenGid.has(gid)) return;
    seenGid.add(gid);
    tabs.push({ name, gid });
  };

  const pushPattern = /items\.push\(\s*\{[\s\S]*?name\s*:\s*(["'])((?:\\.|(?!\1).)*)\1[\s\S]*?gid\s*:\s*(["']?)(\d+)\3/g;
  let match;
  while ((match = pushPattern.exec(rawHtml)) !== null) {
    addTab(match[2], match[4]);
  }

  if (tabs.length === 0) {
    const reversePattern = /items\.push\(\s*\{[\s\S]*?gid\s*:\s*(["']?)(\d+)\1[\s\S]*?name\s*:\s*(["'])((?:\\.|(?!\3).)*)\3/g;
    while ((match = reversePattern.exec(rawHtml)) !== null) {
      addTab(match[4], match[2]);
    }
  }

  if (tabs.length === 0) {
    const liPattern = /id=["']sheet-button-(\d+)["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = liPattern.exec(rawHtml)) !== null) {
      addTab(match[2].replace(/<[^>]+>/g, ''), match[1]);
    }
  }

  return { title, tabs };
}

function parseCsvRows(csvText) {
  const input = String(csvText || '').replace(/^\uFEFF/, '');
  if (!input.trim()) return [];

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvToNormalizedObjects(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length <= 1) return [];

  const headers = rows[0].map((h) => normalizeCsvHeader(h));
  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (!values || values.every((v) => !String(v || '').trim())) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;
      const cell = values[c] !== undefined ? String(values[c]) : '';
      obj[header] = cell;
      const lower = header.toLowerCase();
      if (!(lower in obj)) {
        obj[lower] = cell;
      }
    }
    out.push(obj);
  }

  return out;
}

async function handlePublicSheetLoad(url) {
  const spreadsheetId = extractSpreadsheetId(url.searchParams.get('sheet') || '');
  if (!spreadsheetId) {
    return json({ ok: false, success: false, code: 'SPREADSHEET_URL_INVALID', error: 'Некоректне посилання на Google Таблицю.' }, 400);
  }

  try {
    const htmlViewUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/htmlview`;
    const htmlRes = await fetchWithTimeout(htmlViewUrl, { method: 'GET', redirect: 'follow' }, 15000);
    const finalUrl = String(htmlRes.url || '');

    if (htmlRes.status === 404) {
      return json({ ok: false, success: false, code: 'SPREADSHEET_NOT_FOUND', error: 'Google Таблицю за цим посиланням не знайдено.' }, 404);
    }

    if (htmlRes.status === 401 || htmlRes.status === 403 || finalUrl.includes('accounts.google.com')) {
      return json({
        ok: false,
        success: false,
        code: 'SHEET_NOT_PUBLIC',
        error: 'Таблиця закрита для перегляду за посиланням. Увімкніть у Google Таблиці доступ «Усі, хто має посилання — Переглядач» або поділіться посиланням із параметром &gas=.',
      }, 403);
    }

    const htmlText = await htmlRes.text();
    if (!htmlRes.ok || htmlText.includes('ServiceLogin') || htmlText.includes('accounts.google.com/v3/signin')) {
      return json({
        ok: false,
        success: false,
        code: 'SHEET_NOT_PUBLIC',
        error: 'Таблиця недоступна без авторизації. Надайте доступ «Усі, хто має посилання — Переглядач» у Google Таблиці або скористайтесь посиланням із &gas=.',
      }, 403);
    }

    const meta = extractHtmlViewMetadata(htmlText);
    const targetTabs = meta.tabs.filter((t) => isCanonicalOrMonthSheetName(t.name));

    const sheetsByName = {};
    const batchSize = 6;
    for (let i = 0; i < targetTabs.length; i += batchSize) {
      const batch = targetTabs.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (tab) => {
          const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(tab.gid)}`;
          const csvRes = await fetchWithTimeout(csvUrl, { method: 'GET', redirect: 'follow' }, 15000);
          const csvFinalUrl = String(csvRes.url || '');
          if (csvRes.status === 401 || csvRes.status === 403 || csvFinalUrl.includes('accounts.google.com')) {
            return { tabName: tab.name, forbidden: true, csvText: '' };
          }
          const csvText = await csvRes.text();
          if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(csvText)) {
            return { tabName: tab.name, forbidden: true, csvText: '' };
          }
          return { tabName: tab.name, forbidden: !csvRes.ok, csvText };
        })
      );

      for (const item of results) {
        if (item.forbidden) {
          return json({
            ok: false,
            success: false,
            code: 'SHEET_NOT_PUBLIC',
            error: 'Таблиця закрита для перегляду за посиланням. Увімкніть у Google Таблиці доступ «Усі, хто має посилання — Переглядач» або поділіться посиланням із параметром &gas=.',
          }, 403);
        }
        sheetsByName[item.tabName] = csvToNormalizedObjects(item.csvText);
      }
    }

    return json({
      ok: true,
      success: true,
      spreadsheetId,
      spreadsheetName: meta.title || 'Google Таблиця (перегляд)',
      sheetsByName,
    }, 200);
  } catch {
    return json({
      ok: false,
      success: false,
      code: 'PUBLIC_SHEET_LOAD_ERROR',
      error: 'Не вдалося завантажити Google Таблицю для перегляду. Перевірте посилання та доступ до неї.',
    }, 502);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== APP_ORIGIN) {
      return json({ ok: false, success: false, code: 'ORIGIN_BLOCKED', error: 'Запит із цього сайту не дозволений.' }, 403);
    }

    if (url.pathname === '/api/public-sheet-load') {
      if (request.method !== 'GET') {
        return json({ ok: false, success: false, code: 'METHOD_NOT_ALLOWED', error: 'Дозволені лише GET-запити.' }, 405);
      }
      return handlePublicSheetLoad(url);
    }

    if (url.pathname !== '/api/gas-proxy') {
      return json({ ok: false, success: false, code: 'NOT_FOUND', error: 'Маршрут не знайдено.' }, 404);
    }
    if (request.method !== 'POST') {
      return json({ ok: false, success: false, code: 'METHOD_NOT_ALLOWED', error: 'Дозволені лише POST-запити.' }, 405);
    }

    let payload;
    try {
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > 2 * 1024 * 1024) {
        return json({ ok: false, success: false, code: 'REQUEST_TOO_LARGE', error: 'Запит завеликий.' }, 413);
      }
      payload = await request.json();
    } catch {
      return json({ ok: false, success: false, code: 'INVALID_JSON', error: 'Не вдалося прочитати запит.' }, 400);
    }

    const method = payload?.method;
    if (typeof method !== 'string' || !ALLOWED_GAS_METHODS.has(method)) {
      return json({ ok: false, success: false, code: 'GAS_METHOD_BLOCKED', error: 'Цей метод Apps Script не дозволений.' }, 400);
    }
    if (payload?.readOnly === true && !GAS_READ_METHODS.has(method)) {
      return json({
        ok: false,
        success: false,
        code: 'READ_ONLY_MODE',
        error: 'Режим лише перегляду: внесення змін заборонено.',
      }, 403);
    }

    let target;
    try {
      target = new URL(String(payload.gasUrl || ''));
    } catch {
      return json({ ok: false, success: false, code: 'GAS_URL_INVALID', error: 'Вкажіть коректний URL вебпрограми Apps Script.' }, 400);
    }
    if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' ||
        target.username || target.password || !GAS_URL_PATH.test(target.pathname)) {
      return json({ ok: false, success: false, code: 'GAS_URL_INVALID', error: 'URL має вести на вебпрограму Apps Script і закінчуватися на /exec.' }, 400);
    }

    const args = Array.isArray(payload.args) ? payload.args : [];
    const spreadsheetInput = String(payload.spreadsheetInput || '');
    try {
      let upstream;
      if (GAS_READ_METHODS.has(method)) {
        target.searchParams.set('method', method);
        target.searchParams.set('spreadsheetInput', spreadsheetInput);
        target.searchParams.set('args', JSON.stringify(args));
        upstream = await fetch(target.toString(), { method: 'GET', redirect: 'follow' });
      } else {
        upstream = await fetch(target.toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ method, args, spreadsheetInput }),
          redirect: 'follow',
        });
      }
      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return json({ ok: false, success: false, code: 'GAS_NON_JSON_RESPONSE', error: 'Apps Script повернув сторінку замість JSON. Перевірте актуальність розгортання та доступ «Усі».' }, 502);
      }
      return json(data, upstream.ok ? 200 : 502);
    } catch {
      return json({ ok: false, success: false, code: 'GAS_PROXY_ERROR', error: 'Не вдалося зв’язатися з вебпрограмою Apps Script. Перевірте її URL і доступ.' }, 502);
    }
  },
};
