import express from 'express';
import { createServer as createViteServer } from 'vite';
import { extractSpreadsheetIdFromUrlOrId } from './src/utils/shareLink';
import {
  buildPublicSheetLoadResponse,
  csvToNormalizedObjects,
  extractHtmlViewMetadata,
  isCanonicalOrMonthSheetName,
} from './src/utils/publicSheetParser';

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

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/gas-proxy', async (req, res) => {
    const { gasUrl, method, args, spreadsheetInput, readOnly } = req.body || {};
    if (typeof method !== 'string' || !ALLOWED_GAS_METHODS.has(method)) {
      return res.status(400).json({ ok: false, success: false, code: 'GAS_METHOD_BLOCKED', error: 'Цей метод Apps Script не дозволений.' });
    }
    if (readOnly === true && !GAS_READ_METHODS.has(method)) {
      return res.status(403).json({
        ok: false,
        success: false,
        code: 'READ_ONLY_MODE',
        error: 'Режим лише перегляду: внесення змін заборонено.',
      });
    }
    let target;
    try {
      target = new URL(String(gasUrl || ''));
    } catch {
      return res.status(400).json({ ok: false, success: false, code: 'GAS_URL_INVALID', error: 'Вкажіть коректний URL вебпрограми Apps Script.' });
    }
    if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' || target.username || target.password || !/^\/macros\/(?:u\/\d+\/)?s\/[A-Za-z0-9_-]+\/exec\/?$/.test(target.pathname)) {
      return res.status(400).json({ ok: false, success: false, code: 'GAS_URL_INVALID', error: 'URL має вести на вебпрограму Apps Script і закінчуватися на /exec.' });
    }
    const rpcArgs = Array.isArray(args) ? args : [];
    const payload = { method, args: rpcArgs, spreadsheetInput: String(spreadsheetInput || '') };
    try {
      let upstream;
      if (GAS_READ_METHODS.has(method)) {
        target.searchParams.set('method', method);
        target.searchParams.set('spreadsheetInput', payload.spreadsheetInput);
        target.searchParams.set('args', JSON.stringify(rpcArgs));
        upstream = await fetch(target, { method: 'GET', redirect: 'follow' });
      } else {
        upstream = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'follow',
        });
      }
      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return res.status(502).json({ ok: false, success: false, code: 'GAS_NON_JSON_RESPONSE', error: 'Apps Script повернув сторінку замість JSON. Перевірте актуальність розгортання та доступ «Усі».' });
      }
      return res.status(upstream.ok ? 200 : 502).json(data);
    } catch (error) {
      console.error('Apps Script proxy request failed:', error);
      return res.status(502).json({ ok: false, success: false, code: 'GAS_PROXY_ERROR', error: 'Не вдалося зв’язатися з вебпрограмою Apps Script. Перевірте її URL і доступ.' });
    }
  });

  app.get('/api/public-sheet-load', async (req, res) => {
    const rawSheet = String(req.query.sheet || '');
    const spreadsheetId = extractSpreadsheetIdFromUrlOrId(rawSheet);
    if (!spreadsheetId) {
      return res.status(400).json({
        ok: false,
        success: false,
        code: 'SPREADSHEET_URL_INVALID',
        error: 'Некоректне посилання на Google Таблицю.',
      });
    }

    try {
      const htmlViewUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/htmlview`;
      const htmlRes = await fetchWithTimeout(htmlViewUrl, { method: 'GET', redirect: 'follow' }, 15000);
      const finalUrl = String(htmlRes.url || '');

      if (htmlRes.status === 404) {
        return res.status(404).json({
          ok: false,
          success: false,
          code: 'SPREADSHEET_NOT_FOUND',
          error: 'Google Таблицю за цим посиланням не знайдено.',
        });
      }

      if (
        htmlRes.status === 401 ||
        htmlRes.status === 403 ||
        finalUrl.includes('accounts.google.com')
      ) {
        return res.status(403).json({
          ok: false,
          success: false,
          code: 'SHEET_NOT_PUBLIC',
          error:
            'Таблиця закрита для перегляду за посиланням. Увімкніть у Google Таблиці доступ «Усі, хто має посилання — Переглядач» або поділіться посиланням із параметром &gas=.',
        });
      }

      const htmlText = await htmlRes.text();
      if (
        !htmlRes.ok ||
        htmlText.includes('ServiceLogin') ||
        htmlText.includes('accounts.google.com/v3/signin')
      ) {
        return res.status(403).json({
          ok: false,
          success: false,
          code: 'SHEET_NOT_PUBLIC',
          error:
            'Таблиця недоступна без авторизації. Надайте доступ «Усі, хто має посилання — Переглядач» у Google Таблиці або скористайтесь посиланням із &gas=.',
        });
      }

      const meta = extractHtmlViewMetadata(htmlText);
      const targetTabs = meta.tabs.filter((t) => isCanonicalOrMonthSheetName(t.name));

      const sheetsByName: Record<string, Record<string, string>[]> = {};
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
            return res.status(403).json({
              ok: false,
              success: false,
              code: 'SHEET_NOT_PUBLIC',
              error:
                'Таблиця закрита для перегляду за посиланням. Увімкніть у Google Таблиці доступ «Усі, хто має посилання — Переглядач» або поділіться посиланням із параметром &gas=.',
            });
          }
          sheetsByName[item.tabName] = csvToNormalizedObjects(item.csvText);
        }
      }

      const payload = buildPublicSheetLoadResponse({
        spreadsheetId,
        spreadsheetName: meta.title || 'Google Таблиця (перегляд)',
        sheetsByName,
      });

      return res.status(payload.ok ? 200 : 400).json(payload);
    } catch (error) {
      console.error('Public sheet load failed:', error);
      return res.status(502).json({
        ok: false,
        success: false,
        code: 'PUBLIC_SHEET_LOAD_ERROR',
        error: 'Не вдалося завантажити Google Таблицю для перегляду. Перевірте посилання та доступ до неї.',
      });
    }
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
  });
}

startServer();
