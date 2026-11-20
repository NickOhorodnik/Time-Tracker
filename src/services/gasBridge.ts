import {
  ActionType,
  AppSettings,
  Bonus,
  BonusClaim,
  BonusEligibilityRule,
  Category,
  Employee,
  EmployeePointsProfile,
  EmployeeRating,
  ImageAsset,
  ImageAssignment,
  ImageDiagnostics,
  MotivationalPhrase,
  Phrase,
  PointsAuditSummary,
  PointsPeriod,
  PointsReason,
  PointsRoleConfig,
  PointsTransaction,
  Project,
  TimeEntry,
} from '../types';
import {
  normalizeShareGasUrl,
  parseReadOnlyShareLink,
  ReadOnlyShareConfig,
} from '../utils/shareLink';
import {
  buildPublicSheetLoadResponse,
  doesGvizTabMatchSchema,
  GvizQueryResponse,
  gvizTableToNormalizedObjects,
} from '../utils/publicSheetParser';

export interface GasBridgeResponse<T = any> {
  ok: boolean;
  success: boolean;
  code?: string;
  message?: string;
  error?: string;
  data?: T;
}

export interface GasImageLibraryResponse extends GasBridgeResponse {
  blockedReason?: string;
  registry?: ImageAsset[];
  assignments?: ImageAssignment[];
  imageDiagnostics?: ImageDiagnostics;
  spreadsheetId?: string;
  spreadsheetName?: string;
}

export interface GasHealthResponse extends GasBridgeResponse {
  status?: 'online';
  executionMode?: 'USER_SELECTED_SHEET' | 'BOUND_SCRIPT_PROPERTIES' | 'BOUND_CONTAINER' | 'PUBLIC_READ_ONLY';
  spreadsheetId?: string;
  spreadsheetName?: string;
  version?: string;
  buildId?: string;
  timestamp?: string;
  missingCanonicalSheets?: string[];
}

export interface GasLoadAllResponse extends GasBridgeResponse {
  needsSetup?: boolean;
  spreadsheetId?: string;
  spreadsheetName?: string;
  entries?: TimeEntry[];
  categories?: Category[];
  actionTypes?: ActionType[];
  projects?: Project[];
  bonuses?: Bonus[];
  bonusClaims?: BonusClaim[];
  phrases?: Phrase[];
  motivationalPhrases?: MotivationalPhrase[];
  employees?: Employee[];
  ratings?: EmployeeRating[];
  settings?: Partial<AppSettings>;
  imageRegistry?: ImageAsset[];
  imageAssignments?: ImageAssignment[];
  imageDiagnostics?: ImageDiagnostics;
  pointsRoles?: PointsRoleConfig[];
  pointsProfiles?: EmployeePointsProfile[];
  pointsReasons?: PointsReason[];
  pointsTransactions?: PointsTransaction[];
  pointsPeriods?: PointsPeriod[];
  bonusEligibility?: BonusEligibilityRule[];
  pointsAudit?: PointsAuditSummary;
}

export interface GasConfigPayload {
  settings?: Partial<AppSettings>;
  categories?: Category[];
  actionTypes?: ActionType[];
  projects?: Project[];
  bonuses?: Bonus[];
  phrases?: Phrase[];
  motivationalPhrases?: MotivationalPhrase[];
  employees?: Employee[];
  ratings?: EmployeeRating[];
}

declare global {
  interface Window {
    __ALLONSY_BUILD_TARGET__?: string;
  }
}

export const READ_ONLY_ERROR_MESSAGE =
  'Режим лише перегляду: внесення змін до цієї таблиці заборонено.';

const ALLOWED_GAS_METHODS = new Set([
  'gasHealthCheck', 'gasSetupSpreadsheet', 'gasLoadAllData', 'gasSaveTimeEntry',
  'gasDeleteTimeEntry', 'gasSyncAll', 'gasSaveConfig', 'gasListEmployees',
  'gasSaveEmployee', 'gasArchiveEmployee', 'gasListRatings', 'gasSaveRating',
  'gasGetImageLibrary', 'gasSaveImageRegistry', 'gasSaveImageAssignments',
  'gasSetupAddImageUrlColumn', 'gasExecutePointsCommand',
]);

const GAS_READ_ONLY_ALLOWED_METHODS = new Set([
  'gasHealthCheck',
  'gasLoadAllData',
  'gasListEmployees',
  'gasListRatings',
  'gasGetImageLibrary',
]);

export function normalizeGasWebAppUrl(value: unknown): string {
  return normalizeShareGasUrl(value);
}

export function getReadOnlyShareSession(): ReadOnlyShareConfig | null {
  if (typeof window === 'undefined' || !window.location) return null;
  return parseReadOnlyShareLink(window.location.search, window.location.hash);
}

export function isReadOnlyShareMode(): boolean {
  return Boolean(getReadOnlyShareSession()?.isReadOnly);
}

function readGasWebAppUrl(): string {
  const share = getReadOnlyShareSession();
  if (share) return share.gasUrl;
  try {
    const settings = JSON.parse(localStorage.getItem('allonsy_settings') || '{}');
    return normalizeGasWebAppUrl(settings.gasWebAppUrl);
  } catch {
    return '';
  }
}

function readSpreadsheetInput(): string {
  const share = getReadOnlyShareSession();
  if (share) return share.spreadsheetInput;
  try {
    const settings = JSON.parse(localStorage.getItem('allonsy_settings') || '{}');
    return String(settings.googleSpreadsheetInput || settings.googleSpreadsheetId || '').trim();
  } catch {
    return '';
  }
}

export function isGasHostedRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (isReadOnlyShareMode()) return true;
  return Boolean(readGasWebAppUrl());
}

function toGasSerializable<T>(value: T): T {
  if (value === undefined) return null as unknown as T;
  return JSON.parse(JSON.stringify(value));
}

const GAS_WRITE_METHODS = new Set([
  'gasSaveTimeEntry',
  'gasDeleteTimeEntry',
  'gasSyncAll',
  'gasSaveConfig',
  'gasSaveEmployee',
  'gasArchiveEmployee',
  'gasSaveRating',
  'gasSaveImageRegistry',
  'gasSaveImageAssignments',
  'gasSetupAddImageUrlColumn',
  'gasExecutePointsCommand',
]);

let writeQueueTail: Promise<unknown> = Promise.resolve();

function enqueueGasWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueueTail.then(task, task);
  writeQueueTail = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

let gvizJsonpCounter = 0;
const inFlightPublicJsonpLoads = new Map<string, Promise<GasLoadAllResponse>>();

const PUBLIC_JSONP_CANONICAL_TABS = [
  'Категорії',
  'Типи дій',
  'Проєкти',
  'Працівники',
  'Оцінки',
  'Бонуси',
  'Отримані бонуси',
  'Фрази',
  'Мотиваційні фрази',
  'Налаштування',
  'Бібліотека зображень',
  'Призначення зображень',
  'Ролі балів',
  'Профілі балів',
  'Причини балів',
  'Операції балів',
  'Періоди балів',
  'Доступність бонусів',
];

function getRecentMonthTabNames(count = 3): string[] {
  const now = new Date();
  const list: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    list.push(`${y}-${m}`);
  }
  return list;
}

function fetchGvizTabJsonp(spreadsheetId: string, tabName: string): Promise<GvizQueryResponse> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('DOM unavailable'));
      return;
    }
    const cbName = `__allonsyGvizCb_${Date.now()}_${++gvizJsonpCounter}`;
    const g = globalThis as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try {
        delete g[cbName];
      } catch {
        g[cbName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timeout loading sheet tab'));
    }, 12000);

    g[cbName] = (payload: GvizQueryResponse) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      reject(new Error('Script load failed'));
    };

    script.async = true;
    script.src =
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq` +
      `?tqx=${encodeURIComponent(`out:json;responseHandler=${cbName}`)}` +
      `&sheet=${encodeURIComponent(tabName)}&headers=1`;
    (document.head || document.documentElement || document.body).appendChild(script);
  });
}

async function loadPublicSheetViaGvizJsonp(spreadsheetId: string): Promise<GasLoadAllResponse> {
  const existing = inFlightPublicJsonpLoads.get(spreadsheetId);
  if (existing) return existing;

  const task = (async (): Promise<GasLoadAllResponse> => {
    try {
      const entriesRes = await fetchGvizTabJsonp(spreadsheetId, 'Записи');
      if (!entriesRes || entriesRes.status === 'error') {
        return {
          ok: false,
          success: false,
          code: 'SHEET_NOT_PUBLIC',
          error:
            'Таблиця недоступна для перегляду. Увімкніть у Google Таблиці доступ «Усі, хто має посилання — Переглядач» або поділіться посиланням із параметром &gas=.',
        };
      }
      const parsedEntries = gvizTableToNormalizedObjects(entriesRes);
      if (!doesGvizTabMatchSchema('Записи', parsedEntries.headers)) {
        return {
          ok: false,
          success: false,
          code: 'SCHEMA_COMPATIBILITY_BLOCKED',
          error: 'Канонічний аркуш «Записи» не знайдено в таблиці. Завантаження заблоковано.',
        };
      }

      const sheetsByName: Record<string, Record<string, string>[]> = {
        'Записи': parsedEntries.rows,
      };

      const remainingTabs = [...PUBLIC_JSONP_CANONICAL_TABS, ...getRecentMonthTabNames(3)];
      const batchSize = 5;
      for (let i = 0; i < remainingTabs.length; i += batchSize) {
        const batch = remainingTabs.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (tabName) => {
            try {
              const res = await fetchGvizTabJsonp(spreadsheetId, tabName);
              if (!res || res.status === 'error') return { tabName, matched: false, rows: [] as Record<string, string>[] };
              const parsed = gvizTableToNormalizedObjects(res);
              const matched = doesGvizTabMatchSchema(tabName, parsed.headers);
              return { tabName, matched, rows: parsed.rows };
            } catch {
              return { tabName, matched: false, rows: [] as Record<string, string>[] };
            }
          })
        );
        for (const item of results) {
          if (item.matched) {
            sheetsByName[item.tabName] = item.rows;
          }
        }
      }

      return buildPublicSheetLoadResponse({
        spreadsheetId,
        spreadsheetName: 'Google Таблиця (перегляд)',
        sheetsByName,
      });
    } catch {
      return {
        ok: false,
        success: false,
        code: 'SHEET_NOT_PUBLIC',
        error:
          'Таблиця закрита для публічного перегляду або проксі недоступний. Увімкніть у Google Таблиці доступ «Усі, хто має посилання — Переглядач» або скористайтесь посиланням із параметром &gas=.',
      };
    } finally {
      inFlightPublicJsonpLoads.delete(spreadsheetId);
    }
  })();

  inFlightPublicJsonpLoads.set(spreadsheetId, task);
  return task;
}

async function executePublicSheetRequest<T extends GasBridgeResponse>(
  share: ReadOnlyShareConfig,
  methodName: string
): Promise<T> {
  if (share.error || !share.spreadsheetId) {
    return {
      ok: false,
      success: false,
      code: 'SHARE_LINK_INVALID',
      error: share.error || 'Некоректне посилання на Google Таблицю.',
    } as T;
  }

  const formatResult = (payload: GasLoadAllResponse): T => {
    if (methodName === 'gasHealthCheck' && payload.ok) {
      return {
        ok: true,
        success: true,
        status: 'online',
        executionMode: 'PUBLIC_READ_ONLY',
        spreadsheetId: payload.spreadsheetId,
        spreadsheetName: payload.spreadsheetName,
      } as unknown as T;
    }
    return payload as unknown as T;
  };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(
      `/api/public-sheet-load?sheet=${encodeURIComponent(share.spreadsheetInput || share.spreadsheetId)}`,
      { method: 'GET', signal: controller.signal }
    );
    const rawResult = await response.json().catch(() => null);

    // If the edge worker or static host does not expose /api/public-sheet-load (HTTP 404),
    // fall back to direct public Google Sheets gviz JSONP in the browser.
    if (
      response.status === 404 &&
      (!rawResult || rawResult.code === 'NOT_FOUND') &&
      typeof document !== 'undefined'
    ) {
      const jsonpResult = await loadPublicSheetViaGvizJsonp(share.spreadsheetId);
      return formatResult(jsonpResult);
    }

    if (!rawResult || typeof rawResult !== 'object') {
      return {
        ok: false,
        success: false,
        code: 'PUBLIC_SHEET_EMPTY_RESPONSE',
        error: 'Сервер повернув порожню відповідь при завантаженні таблиці.',
      } as T;
    }

    // Worker returns raw { ok, spreadsheetId, spreadsheetName, sheetsByName }; transform client-side.
    if (rawResult.ok && rawResult.sheetsByName && !rawResult.entries) {
      const built = buildPublicSheetLoadResponse({
        spreadsheetId: String(rawResult.spreadsheetId || share.spreadsheetId),
        spreadsheetName: String(rawResult.spreadsheetName || 'Google Таблиця (перегляд)'),
        sheetsByName: rawResult.sheetsByName,
      });
      return formatResult(built);
    }

    return formatResult(rawResult as GasLoadAllResponse);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    if (!timedOut && typeof document !== 'undefined') {
      const jsonpResult = await loadPublicSheetViaGvizJsonp(share.spreadsheetId);
      if (jsonpResult.ok) {
        return formatResult(jsonpResult);
      }
    }
    return {
      ok: false,
      success: false,
      code: timedOut ? 'GAS_TIMEOUT' : 'PUBLIC_SHEET_LOAD_ERROR',
      error: timedOut
        ? 'Перевищено час очікування завантаження Google Таблиці.'
        : 'Не вдалося завантажити Google Таблицю для перегляду.',
    } as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function executeGasRequest<T extends GasBridgeResponse>(methodName: string, ...args: unknown[]): Promise<T> {
  const share = getReadOnlyShareSession();
  if (share) {
    if (!GAS_READ_ONLY_ALLOWED_METHODS.has(methodName)) {
      return {
        ok: false,
        success: false,
        code: 'READ_ONLY_MODE',
        error: READ_ONLY_ERROR_MESSAGE,
      } as T;
    }
    if (share.error) {
      return {
        ok: false,
        success: false,
        code: 'SHARE_LINK_INVALID',
        error: share.error,
      } as T;
    }
    if (!share.gasUrl) {
      return executePublicSheetRequest<T>(share, methodName);
    }
  }

  const gasUrl = readGasWebAppUrl();
  if (!gasUrl) return {
    ok: false, success: false, code: 'GAS_URL_MISSING',
    error: 'Додайте URL вашої вебпрограми Apps Script у Налаштуваннях → Google Таблиця.',
  } as T;
  if (!ALLOWED_GAS_METHODS.has(methodName)) return {
    ok: false, success: false, code: 'GAS_METHOD_BLOCKED', error: 'Цей метод Apps Script не дозволений.',
  } as T;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('/api/gas-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gasUrl,
        method: methodName,
        spreadsheetInput: readSpreadsheetInput(),
        readOnly: Boolean(share),
        args: args.map((arg) => toGasSerializable(arg)),
      }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok && (!result || typeof result !== 'object')) {
      return { ok: false, success: false, code: 'GAS_PROXY_ERROR', error: 'Проміжний сервер не зміг зв’язатися з Apps Script.' } as T;
    }
    if (!result || typeof result !== 'object') {
      return { ok: false, success: false, code: 'GAS_EMPTY_RESPONSE', error: 'Apps Script повернув порожню або некоректну відповідь.' } as T;
    }
    return result as T;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return {
      ok: false, success: false, code: timedOut ? 'GAS_TIMEOUT' : 'GAS_PROXY_ERROR',
      error: timedOut
        ? 'Перевищено час очікування відповіді від Apps Script.'
        : 'Не вдалося зв’язатися з Apps Script через сервер застосунку. Перевірте URL розгортання.',
    } as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function invokeGasServer<T extends GasBridgeResponse>(methodName: string, ...args: unknown[]): Promise<T> {
  if (isReadOnlyShareMode() && !GAS_READ_ONLY_ALLOWED_METHODS.has(methodName)) {
    return {
      ok: false,
      success: false,
      code: 'READ_ONLY_MODE',
      error: READ_ONLY_ERROR_MESSAGE,
    } as T;
  }
  if (GAS_WRITE_METHODS.has(methodName)) {
    return enqueueGasWrite(() => executeGasRequest<T>(methodName, ...args));
  }
  return executeGasRequest<T>(methodName, ...args);
}

export const gasBridge = {
  healthCheck(): Promise<GasHealthResponse> {
    return invokeGasServer<GasHealthResponse>('gasHealthCheck');
  },

  setupSpreadsheet(): Promise<GasHealthResponse> {
    return invokeGasServer<GasHealthResponse>('gasSetupSpreadsheet');
  },

  loadAllData(): Promise<GasLoadAllResponse> {
    return invokeGasServer<GasLoadAllResponse>('gasLoadAllData');
  },

  saveTimeEntry(entry: TimeEntry): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasSaveTimeEntry', entry);
  },

  deleteTimeEntry(entryId: string): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasDeleteTimeEntry', entryId);
  },

  syncAll(payload: Record<string, unknown>): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasSyncAll', payload);
  },

  saveConfig(configPayload: GasConfigPayload): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasSaveConfig', configPayload);
  },

  listEmployees(): Promise<GasBridgeResponse & { employees?: Employee[] }> {
    return invokeGasServer<GasBridgeResponse & { employees?: Employee[] }>('gasListEmployees');
  },

  saveEmployee(
    employee: Employee & { createOnly?: boolean }
  ): Promise<GasBridgeResponse & { employee?: Employee }> {
    return invokeGasServer<GasBridgeResponse & { employee?: Employee }>('gasSaveEmployee', employee);
  },

  archiveEmployee(
    employeeId: string
  ): Promise<GasBridgeResponse & { employee?: Employee }> {
    return invokeGasServer<GasBridgeResponse & { employee?: Employee }>('gasArchiveEmployee', employeeId);
  },

  listRatings(
    employeeId?: string
  ): Promise<GasBridgeResponse & { ratings?: EmployeeRating[] }> {
    return invokeGasServer<GasBridgeResponse & { ratings?: EmployeeRating[] }>(
      'gasListRatings',
      employeeId || ''
    );
  },

  saveRating(
    rating: EmployeeRating
  ): Promise<GasBridgeResponse & { rating?: EmployeeRating }> {
    return invokeGasServer<GasBridgeResponse & { rating?: EmployeeRating }>('gasSaveRating', rating);
  },

  getImageLibrary(): Promise<GasImageLibraryResponse> {
    return invokeGasServer<GasImageLibraryResponse>('gasGetImageLibrary');
  },

  saveImageRegistry(
    registry: ImageAsset[]
  ): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasSaveImageRegistry', registry);
  },

  saveImageAssignments(
    assignments: ImageAssignment[]
  ): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasSaveImageAssignments', assignments);
  },

  executePointsCommand(
    command: Record<string, unknown>
  ): Promise<GasBridgeResponse> {
    return invokeGasServer<GasBridgeResponse>('gasExecutePointsCommand', command);
  },
};
