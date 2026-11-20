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
const GAS_URL_PATH = /^\/macros\/(?:u\/\d+\/)?s\/[A-Za-z0-9_-]+\/exec\/?$/;
const APP_ORIGIN = 'https://time-tracker.allonsy.agency';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/gas-proxy') {
      return json({ ok: false, success: false, code: 'NOT_FOUND', error: 'Маршрут не знайдено.' }, 404);
    }
    if (request.method !== 'POST') {
      return json({ ok: false, success: false, code: 'METHOD_NOT_ALLOWED', error: 'Дозволені лише POST-запити.' }, 405);
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== APP_ORIGIN) {
      return json({ ok: false, success: false, code: 'ORIGIN_BLOCKED', error: 'Запит із цього сайту не дозволений.' }, 403);
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
