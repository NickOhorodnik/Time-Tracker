import express from 'express';
import { createServer as createViteServer } from 'vite';

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/gas-proxy', async (req, res) => {
    const { gasUrl, method, args, spreadsheetInput } = req.body || {};
    if (typeof method !== 'string' || !ALLOWED_GAS_METHODS.has(method)) {
      return res.status(400).json({ ok: false, success: false, code: 'GAS_METHOD_BLOCKED', error: 'Цей метод Apps Script не дозволений.' });
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
