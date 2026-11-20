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

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(
      `/api/public-sheet-load?sheet=${encodeURIComponent(share.spreadsheetInput || share.spreadsheetId)}`,
      { method: 'GET', signal: controller.signal }
    );
    const result = await response.json();
    if (!result || typeof result !== 'object') {
      return {
        ok: false,
        success: false,
        code: 'PUBLIC_SHEET_EMPTY_RESPONSE',
        error: 'Сервер повернув порожню відповідь при завантаженні таблиці.',
      } as T;
    }
    if (methodName === 'gasHealthCheck' && result.ok) {
      return {
        ok: true,
        success: true,
        status: 'online',
        executionMode: 'PUBLIC_READ_ONLY',
        spreadsheetId: result.spreadsheetId,
        spreadsheetName: result.spreadsheetName,
      } as unknown as T;
    }
    return result as T;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
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
