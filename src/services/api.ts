import {
  TimeEntry,
  Category,
  ActionType,
  Project,
  Bonus,
  BonusClaim,
  BonusEligibilityRule,
  Phrase,
  MotivationalPhrase,
  AppSettings,
  ActiveTimerState,
  ImageAsset,
  ImageAssignment,
  Employee,
  EmployeePointsProfile,
  EmployeeRating,
  PointsAuditSummary,
  PointsPeriod,
  PointsReason,
  PointsRoleConfig,
  PointsTransaction,
} from '../types';
import {
  initialCategories,
  initialActionTypes,
  initialProjects,
  initialTimeEntries,
  initialBonuses,
  initialPhrases,
  initialMotivationalPhrases,
  initialSettings,
  initialEmployees,
  initialRatings,
} from '../mockData';
import {
  getDefaultEmployeeId,
  migrateTimeEntriesEmployeeId,
} from '../utils/teamUtils';
import {
  gasBridge,
  GasConfigPayload,
  GasLoadAllResponse,
  isGasHostedRuntime,
} from './gasBridge';
import {
  buildImageDiagnostics,
  hydrateStagesFromImageLibrary,
  normalizeLoadedBonusClaims,
  normalizeLoadedBonusEligibility,
  normalizeLoadedImageAssignments,
  normalizeLoadedImageRegistry,
  normalizeLoadedMotivationalPhrases,
  normalizeLoadedPhrases,
  normalizeLoadedPointsPeriods,
  normalizeLoadedPointsProfiles,
  normalizeLoadedPointsReasons,
  normalizeLoadedPointsRoles,
  normalizeLoadedPointsTransactions,
  normalizeLoadedRatings,
} from '../utils/canonicalSheetsAdapter';
import { createDefaultPointsRoles } from '../utils/pointsEngine';
import { normalizeDriveImageUrl } from '../utils/imageUrlValidator';
import { isStaleLocalAssetPath } from '../utils/assetResolver';

export { isGasHostedRuntime };

const STORAGE_KEYS = {
  ENTRIES: 'allonsy_entries',
  CATEGORIES: 'allonsy_categories',
  ACTIONS: 'allonsy_actions',
  PROJECTS: 'allonsy_projects',
  BONUSES: 'allonsy_bonuses',
  PHRASES: 'allonsy_phrases',
  MOTIVATIONAL: 'allonsy_motivational',
  EMPLOYEES: 'allonsy_employees',
  RATINGS: 'allonsy_ratings',
  SETTINGS: 'allonsy_settings',
  TIMER: 'allonsy_timer',
  PENDING_SYNC: 'allonsy_pending_sync',
  LAST_SYNC: 'allonsy_last_sync_timestamp',
  IMAGE_LIBRARY: 'allonsy_image_library',
  IMAGE_ASSIGNMENTS: 'allonsy_image_assignments',
  UNSYNCED_ENTRY_IDS: 'allonsy_unsynced_entry_ids',
  POINTS_ROLES: 'allonsy_points_roles',
  POINTS_PROFILES: 'allonsy_points_profiles',
  POINTS_REASONS: 'allonsy_points_reasons',
  POINTS_TRANSACTIONS: 'allonsy_points_transactions',
  POINTS_PERIODS: 'allonsy_points_periods',
  BONUS_ELIGIBILITY: 'allonsy_bonus_eligibility',
  BONUS_CLAIMS: 'allonsy_bonus_claims',
  POINTS_AUDIT: 'allonsy_points_audit',
};

const inFlightRemoteLoads = new Map<string, Promise<GasLoadAllResponse>>();

function isLocalDraftImageAsset(asset?: ImageAsset | null): boolean {
  if (!asset) return false;
  return (
    asset.source === 'local_upload' ||
    asset.storageType === 'browser_local' ||
    asset.persistenceStatus === 'draft' ||
    asset.persistenceStatus === 'blocked' ||
    asset.persistenceStatus === 'local_only'
  );
}

function getStored<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    console.error(`Error reading ${key} from storage`, e);
    return fallback;
  }
}

function setStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error saving ${key} to storage`, e);
  }
}

export function sanitizeDataForSheets(data: any): any {
  if (!data) return data;
  if (typeof data === 'string') {
    if (data.startsWith('data:image')) {
      return '[локальне зображення]';
    }
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeDataForSheets);
  }
  if (typeof data === 'object') {
    const cleanObj: any = {};
    for (const key of Object.keys(data)) {
      cleanObj[key] = sanitizeDataForSheets(data[key]);
    }
    return cleanObj;
  }
  return data;
}

export const AI_STUDIO_PREVIEW_SYNC_REASON =
  'Щоб підключити свою таблицю, збережіть у Налаштуваннях посилання на вебпрограму Apps Script і посилання на Google Таблицю. Інтерфейс залишається в AI Studio.';

export const BYO_GAS_DEPLOY_STEPS = [
  '1. Зробіть власну копію шаблону Google Таблиці та відкрийте її.',
  '2. У цій таблиці відкрийте «Розширення → Apps Script» і додайте серверний код трекера у файл Code.gs.',
  '3. Створіть вебпрограму: виконання від імені власника скрипту, доступ — «Усі». Скопіюйте URL, що закінчується на /exec.',
  '4. Збережіть URL вебпрограми та посилання на свою Google Таблицю в налаштуваннях додатка.',
  '5. Натисніть «Перевірити підключення». Кожен браузер використовує вибране посилання на власну таблицю.',
];

function migrateSettings(raw: AppSettings): AppSettings {
  const migrated: AppSettings = { ...initialSettings, ...raw };
  if (Number(migrated.hourlyRate) === 30 && Number(migrated.targetHours) === 100) {
    migrated.hourlyRate = initialSettings.hourlyRate;
    migrated.targetHours = initialSettings.targetHours;
  }
  if (Array.isArray(migrated.stages)) {
    migrated.stages = migrated.stages.map((s) => ({
      ...s,
      primaryImage: isStaleLocalAssetPath(s.primaryImage) ? '' : s.primaryImage || '',
      alternateImage: isStaleLocalAssetPath(s.alternateImage) ? '' : s.alternateImage || '',
    }));
  }
  return migrated;
}

function getStoredWithoutDemo<T extends { id?: string; isDemo?: boolean }>(key: string, fallback: T[], demoIds: string[]): T[] {
  const stored = getStored<unknown>(key, fallback);
  const rows: T[] = Array.isArray(stored) ? stored as T[] : fallback;
  const cleaned = rows.filter((row) => row && row.isDemo !== true && !demoIds.includes(String(row.id || '')));
  if (!Array.isArray(stored) || cleaned.length !== rows.length) setStored(key, cleaned);
  return cleaned;
}

function cleanKnownEmptyDemoTimerOnce(): ActiveTimerState | null {
  const cleanupKey = 'allonsy_demo_timer_cleanup_v2';
  const timer = getStored<ActiveTimerState | null>(STORAGE_KEYS.TIMER, null);
  if (getStored<boolean>(cleanupKey, false)) return timer;

  const knownDemoCategories = ['', 'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5'];
  const knownDemoActions = ['', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5'];
  const knownDemoProjects = ['', 'proj-1', 'proj-2', 'proj-3', 'proj-4', 'proj-5'];
  const isKnownEmptyTestSession = Boolean(
    timer && timer.isPaused && timer.elapsedSeconds === 4 &&
    (!timer.employeeId || timer.employeeId === 'emp-nastya') &&
    knownDemoCategories.includes(timer.categoryId || '') &&
    knownDemoActions.includes(timer.actionTypeId || '') &&
    knownDemoProjects.includes(timer.projectId || '') &&
    (!timer.description || timer.description.trim() === 'Робоча сесія')
  );
  if (isKnownEmptyTestSession) setStored(STORAGE_KEYS.TIMER, null);
  setStored(cleanupKey, true);
  return isKnownEmptyTestSession ? null : timer;
}

export const api = {
  async getAppData() {
    const rawSettings = getStored<AppSettings>(STORAGE_KEYS.SETTINGS, initialSettings);
    const settings = migrateSettings(rawSettings);
    if (settings.hourlyRate !== rawSettings.hourlyRate || settings.targetHours !== rawSettings.targetHours) {
      setStored(STORAGE_KEYS.SETTINGS, settings);
    }

    const employees = getStoredWithoutDemo<Employee>(STORAGE_KEYS.EMPLOYEES, initialEmployees, ['emp-nastya']);
    const ratings = getStoredWithoutDemo<EmployeeRating>(STORAGE_KEYS.RATINGS, initialRatings, ['rating-demo-nastya-1']);
    const categories = getStoredWithoutDemo<Category>(STORAGE_KEYS.CATEGORIES, initialCategories, ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5']);
    const actionTypes = getStoredWithoutDemo<ActionType>(STORAGE_KEYS.ACTIONS, initialActionTypes, ['act-1', 'act-2', 'act-3', 'act-4', 'act-5']);
    const projects = getStoredWithoutDemo<Project>(STORAGE_KEYS.PROJECTS, initialProjects, ['proj-1', 'proj-2', 'proj-3', 'proj-4', 'proj-5']);
    const bonuses = getStoredWithoutDemo<Bonus>(STORAGE_KEYS.BONUSES, initialBonuses, ['bonus-1', 'bonus-2', 'bonus-3', 'bonus-4']);
    const phrases = normalizeLoadedPhrases(
      getStoredWithoutDemo<Phrase>(STORAGE_KEYS.PHRASES, initialPhrases, ['ph-1', 'ph-2', 'ph-3', 'ph-4', 'ph-5'])
    );
    const motivationalPhrases = normalizeLoadedMotivationalPhrases(
      getStoredWithoutDemo<MotivationalPhrase>(STORAGE_KEYS.MOTIVATIONAL, initialMotivationalPhrases, ['mot-1', 'mot-2', 'mot-3', 'mot-4', 'mot-5'])
    );
    const defaultEmployeeId = getDefaultEmployeeId(employees);
    const rawEntries = getStoredWithoutDemo<TimeEntry>(STORAGE_KEYS.ENTRIES, initialTimeEntries, ['entry-1', 'entry-2']);
    const migrated = migrateTimeEntriesEmployeeId(rawEntries, defaultEmployeeId);
    if (migrated.changed) setStored(STORAGE_KEYS.ENTRIES, migrated.entries);

    const imageRegistry = normalizeLoadedImageRegistry(getStored<ImageAsset[]>(STORAGE_KEYS.IMAGE_LIBRARY, []));
    const imageAssignments = normalizeLoadedImageAssignments(getStored<ImageAssignment[]>(STORAGE_KEYS.IMAGE_ASSIGNMENTS, []));
    const hydratedSettings: AppSettings = {
      ...settings,
      stages: hydrateStagesFromImageLibrary(
        initialSettings.stages,
        settings.stages,
        imageRegistry,
        imageAssignments
      ),
    };

    const storedRoles = getStored<PointsRoleConfig[]>(STORAGE_KEYS.POINTS_ROLES, []);
    const pointsRoles =
      Array.isArray(storedRoles) && storedRoles.length > 0
        ? normalizeLoadedPointsRoles(storedRoles)
        : createDefaultPointsRoles();
    const pointsProfiles = normalizeLoadedPointsProfiles(getStored<EmployeePointsProfile[]>(STORAGE_KEYS.POINTS_PROFILES, []));
    const pointsReasons = normalizeLoadedPointsReasons(getStored<PointsReason[]>(STORAGE_KEYS.POINTS_REASONS, []));
    const pointsTransactions = normalizeLoadedPointsTransactions(getStored<PointsTransaction[]>(STORAGE_KEYS.POINTS_TRANSACTIONS, []));
    const pointsPeriods = normalizeLoadedPointsPeriods(getStored<PointsPeriod[]>(STORAGE_KEYS.POINTS_PERIODS, []));
    const bonusEligibility = normalizeLoadedBonusEligibility(getStored<BonusEligibilityRule[]>(STORAGE_KEYS.BONUS_ELIGIBILITY, []));
    const bonusClaims = normalizeLoadedBonusClaims(getStored<BonusClaim[]>(STORAGE_KEYS.BONUS_CLAIMS, []));
    const pointsAudit = getStored<PointsAuditSummary | null>(STORAGE_KEYS.POINTS_AUDIT, null);

    return {
      entries: migrated.entries, categories, actionTypes, projects, bonuses, phrases, motivationalPhrases,
      employees, ratings, settings: hydratedSettings,
      timerState: cleanKnownEmptyDemoTimerOnce(),
      pendingSync: getStored<boolean>(STORAGE_KEYS.PENDING_SYNC, false),
      lastSyncedAt: getStored<string | null>(STORAGE_KEYS.LAST_SYNC, null),
      imageRegistry,
      imageAssignments,
      pointsRoles,
      pointsProfiles,
      pointsReasons,
      pointsTransactions,
      pointsPeriods,
      bonusEligibility,
      bonusClaims,
      pointsAudit,
    };
  },

  isGasHosted(): boolean {
    return isGasHostedRuntime();
  },

  isRemoteSyncSupported(): boolean {
    return isGasHostedRuntime();
  },

  getIntegrationInfo(): { reason: string; steps: string[] } {
    return {
      reason: AI_STUDIO_PREVIEW_SYNC_REASON,
      steps: BYO_GAS_DEPLOY_STEPS,
    };
  },

  async testConnection(): Promise<{ success: boolean; message: string; spreadsheetName?: string; spreadsheetId?: string }> {
    if (!isGasHostedRuntime()) {
      return {
        success: false,
        message: AI_STUDIO_PREVIEW_SYNC_REASON,
      };
    }

    const res = await gasBridge.healthCheck();
    if (res.ok && res.success) {
      return {
        success: true,
        spreadsheetId: res.spreadsheetId,
        spreadsheetName: res.spreadsheetName,
        message: `Підключено до Google Таблиці «${res.spreadsheetName || res.spreadsheetId}».`,
      };
    }

    return {
      success: false,
      message: res.error || 'Не вдалося перевірити доступ до прив’язаної таблиці через Google Apps Script.',
    };
  },

  async setupSpreadsheet(): Promise<{ success: boolean; message: string; spreadsheetName?: string; spreadsheetId?: string }> {
    if (!isGasHostedRuntime()) {
      return { success: false, message: AI_STUDIO_PREVIEW_SYNC_REASON };
    }

    const res = await gasBridge.setupSpreadsheet();
    if (res.ok && res.success) {
      return {
        success: true,
        spreadsheetName: res.spreadsheetName,
        spreadsheetId: res.spreadsheetId,
        message: res.message || 'Аркуші Google Таблиці успішно перевірено.',
      };
    }

    return {
      success: false,
      message: res.error || 'Не вдалося перевірити аркуші таблиці.',
    };
  },

  async loadRemoteData(
    options?: { dedupe?: boolean }
  ): Promise<GasLoadAllResponse> {
    if (!isGasHostedRuntime()) {
      return {
        ok: false,
        success: false,
        code: 'NOT_GAS_HOSTED',
        error: AI_STUDIO_PREVIEW_SYNC_REASON,
      };
    }

    const dedupeKey = 'bound-spreadsheet';
    if (options?.dedupe) {
      const existing = inFlightRemoteLoads.get(dedupeKey);
      if (existing) {
        return existing;
      }
    }

    const requestPromise = (async (): Promise<GasLoadAllResponse> => {
      const res = await gasBridge.loadAllData();
      if (!res.ok || !res.success || res.needsSetup) {
        return res;
      }

      const imageRegistry = normalizeLoadedImageRegistry(res.imageRegistry);
      const imageAssignments = normalizeLoadedImageAssignments(res.imageAssignments);
      const normalizedPhrases = normalizeLoadedPhrases(res.phrases);
      const normalizedMotivational = normalizeLoadedMotivationalPhrases(res.motivationalPhrases);

      const normalizedEmployees = Array.isArray(res.employees)
        ? res.employees.map((emp) => ({
            ...emp,
            avatarUrl: emp.avatarUrl ? normalizeDriveImageUrl(emp.avatarUrl) || emp.avatarUrl : '',
            portraitUrl: emp.portraitUrl ? normalizeDriveImageUrl(emp.portraitUrl) || emp.portraitUrl : '',
          }))
        : res.employees;

      const normalizedBonuses = Array.isArray(res.bonuses)
        ? res.bonuses.map((b) => ({
            ...b,
            imageUrl: b.imageUrl ? normalizeDriveImageUrl(b.imageUrl) || b.imageUrl : '',
          }))
        : res.bonuses;

      const hydratedStages = hydrateStagesFromImageLibrary(
        initialSettings.stages,
        res.settings?.stages,
        imageRegistry,
        imageAssignments
      );

      const imageDiagnostics = buildImageDiagnostics(
        imageRegistry,
        imageAssignments,
        res.imageDiagnostics
      );

      const pointsRolesRaw = normalizeLoadedPointsRoles(res.pointsRoles);
      const pointsRoles = pointsRolesRaw.length > 0 ? pointsRolesRaw : createDefaultPointsRoles();
      const pointsProfiles = normalizeLoadedPointsProfiles(res.pointsProfiles);
      const pointsReasons = normalizeLoadedPointsReasons(res.pointsReasons);
      const pointsTransactions = normalizeLoadedPointsTransactions(res.pointsTransactions);
      const pointsPeriods = normalizeLoadedPointsPeriods(res.pointsPeriods);
      const bonusEligibility = normalizeLoadedBonusEligibility(res.bonusEligibility);
      const bonusClaims = normalizeLoadedBonusClaims(res.bonusClaims);

      const normalizedRatings = normalizeLoadedRatings(res.ratings);

      return {
        ...res,
        phrases: normalizedPhrases,
        motivationalPhrases: normalizedMotivational,
        employees: normalizedEmployees,
        ratings: normalizedRatings,
        bonuses: normalizedBonuses,
        bonusClaims,
        imageRegistry,
        imageAssignments,
        imageDiagnostics,
        pointsRoles,
        pointsProfiles,
        pointsReasons,
        pointsTransactions,
        pointsPeriods,
        bonusEligibility,
        pointsAudit: res.pointsAudit || { schemaReady: true, missingSheets: [], blockedSheets: [] },
        settings: {
          ...(res.settings || {}),
          stages: hydratedStages,
        },
      };
    })();

    if (options?.dedupe) {
      inFlightRemoteLoads.set(dedupeKey, requestPromise);
      requestPromise.finally(() => {
        if (inFlightRemoteLoads.get(dedupeKey) === requestPromise) {
          inFlightRemoteLoads.delete(dedupeKey);
        }
      });
    }

    return requestPromise;
  },

  async saveTimeEntryRemote(
    entry: TimeEntry
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!isGasHostedRuntime()) {
      return {
        success: false,
        error: `${AI_STUDIO_PREVIEW_SYNC_REASON} Запис збережено локально в браузері.`,
      };
    }

    const sanitizedEntry = sanitizeDataForSheets(entry) as TimeEntry;
    const res = await gasBridge.saveTimeEntry(sanitizedEntry);
    if (res.ok && res.success) {
      const nowIso = new Date().toISOString();
      const remainingUnsynced = api.getUnsyncedEntryIds().filter((id) => id !== entry.id);
      setStored(STORAGE_KEYS.UNSYNCED_ENTRY_IDS, remainingUnsynced);
      setStored(STORAGE_KEYS.LAST_SYNC, nowIso);
      setStored(STORAGE_KEYS.PENDING_SYNC, remainingUnsynced.length > 0);
      return { success: true, message: res.message };
    }

    const nextUnsynced = Array.from(new Set([...api.getUnsyncedEntryIds(), entry.id]));
    setStored(STORAGE_KEYS.UNSYNCED_ENTRY_IDS, nextUnsynced);
    setStored(STORAGE_KEYS.PENDING_SYNC, true);
    return {
      success: false,
      error: res.error || 'Помилка збереження запису в Google Таблицю.',
    };
  },

  async deleteTimeEntryRemote(
    entryId: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const remainingUnsynced = api.getUnsyncedEntryIds().filter((id) => id !== entryId);
    setStored(STORAGE_KEYS.UNSYNCED_ENTRY_IDS, remainingUnsynced);

    if (!isGasHostedRuntime()) {
      return {
        success: false,
        error: `${AI_STUDIO_PREVIEW_SYNC_REASON} Видалення застосовано локально.`,
      };
    }

    const res = await gasBridge.deleteTimeEntry(entryId);
    if (res.ok && res.success) {
      const nowIso = new Date().toISOString();
      setStored(STORAGE_KEYS.LAST_SYNC, nowIso);
      return { success: true, message: res.message };
    }

    setStored(STORAGE_KEYS.PENDING_SYNC, true);
    return {
      success: false,
      error: res.error || 'Помилка видалення запису з Google Таблиці.',
    };
  },

  async saveConfigRemote(
    configPayload: GasConfigPayload
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!isGasHostedRuntime()) {
      return { success: false, error: AI_STUDIO_PREVIEW_SYNC_REASON };
    }

    const sanitizedPayload = sanitizeDataForSheets(configPayload) as GasConfigPayload;
    if (sanitizedPayload.settings) {
      delete sanitizedPayload.settings.gasWebAppUrl;
      delete sanitizedPayload.settings.googleSheetsWebhookUrl;
      delete sanitizedPayload.settings.googleSpreadsheetInput;
      delete sanitizedPayload.settings.googleSpreadsheetId;
    }

    const res = await gasBridge.saveConfig(sanitizedPayload);
    if (res.ok && res.success) {
      const nowIso = new Date().toISOString();
      setStored(STORAGE_KEYS.LAST_SYNC, nowIso);
      return { success: true, message: res.message };
    }

    setStored(STORAGE_KEYS.PENDING_SYNC, true);
    return { success: false, error: res.error || 'Помилка оновлення налаштувань у таблиці.' };
  },

  async syncAllWithGas(
    payload: Record<string, any>
  ): Promise<{ success: boolean; message: string; error?: string; spreadsheetName?: string; spreadsheetId?: string }> {
    if (!isGasHostedRuntime()) {
      setStored(STORAGE_KEYS.PENDING_SYNC, true);
      return {
        success: false,
        message: AI_STUDIO_PREVIEW_SYNC_REASON,
        error: 'Локальний режим AI Studio Preview',
      };
    }

    const sanitizedPayload = sanitizeDataForSheets(payload);
    if (sanitizedPayload?.settings) {
      delete sanitizedPayload.settings.googleSheetsWebhookUrl;
      delete sanitizedPayload.settings.googleSpreadsheetInput;
      delete sanitizedPayload.settings.googleSpreadsheetId;
    }

    const res = await gasBridge.syncAll(sanitizedPayload);
    if (res.ok && res.success) {
      const nowIso = new Date().toISOString();
      setStored(STORAGE_KEYS.UNSYNCED_ENTRY_IDS, []);
      setStored(STORAGE_KEYS.LAST_SYNC, nowIso);
      setStored(STORAGE_KEYS.PENDING_SYNC, false);
      return {
        success: true,
        spreadsheetName: (res as any).spreadsheetName,
        spreadsheetId: (res as any).spreadsheetId,
        message: res.message || 'Дані успішно синхронізовано з вашою Google Таблицею.',
      };
    }

    setStored(STORAGE_KEYS.PENDING_SYNC, true);
    return {
      success: false,
      message: res.error || 'Не вдалося синхронізувати дані з Google Таблицею.',
      error: res.error,
    };
  },

  async saveEmployeeRemote(
    employee: Employee & { createOnly?: boolean }
  ): Promise<{ success: boolean; employee?: Employee; error?: string }> {
    if (!isGasHostedRuntime()) {
      return { success: false, error: AI_STUDIO_PREVIEW_SYNC_REASON };
    }

    const sanitized = sanitizeDataForSheets(employee) as Employee & { createOnly?: boolean };
    const res = await gasBridge.saveEmployee(sanitized);
    if (res.ok && res.success) {
      setStored(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      return { success: true, employee: res.employee };
    }

    setStored(STORAGE_KEYS.PENDING_SYNC, true);
    return { success: false, error: res.error || 'Помилка збереження співробітника в таблиці.' };
  },

  async archiveEmployeeRemote(
    employeeId: string
  ): Promise<{ success: boolean; employee?: Employee; error?: string }> {
    if (!isGasHostedRuntime()) {
      return { success: false, error: AI_STUDIO_PREVIEW_SYNC_REASON };
    }

    const res = await gasBridge.archiveEmployee(employeeId);
    if (res.ok && res.success) {
      setStored(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      return { success: true, employee: res.employee };
    }

    setStored(STORAGE_KEYS.PENDING_SYNC, true);
    return { success: false, error: res.error || 'Помилка архівування співробітника в таблиці.' };
  },

  async saveRatingRemote(
    rating: EmployeeRating
  ): Promise<{ success: boolean; rating?: EmployeeRating; error?: string }> {
    if (!isGasHostedRuntime()) {
      return { success: false, error: AI_STUDIO_PREVIEW_SYNC_REASON };
    }

    const sanitized = sanitizeDataForSheets(rating) as EmployeeRating;
    const res = await gasBridge.saveRating(sanitized);
    if (res.ok && res.success) {
      setStored(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      const normalized = res.rating ? normalizeLoadedRatings([res.rating])[0] : undefined;
      return { success: true, rating: normalized || res.rating };
    }

    return { success: false, error: res.error || 'Помилка збереження оцінки в таблиці.' };
  },

  async saveEntries(entries: TimeEntry[]) {
    setStored(STORAGE_KEYS.ENTRIES, entries);
    return true;
  },

  async saveCategories(categories: Category[]) {
    setStored(STORAGE_KEYS.CATEGORIES, categories);
    return true;
  },

  async saveActionTypes(actionTypes: ActionType[]) {
    setStored(STORAGE_KEYS.ACTIONS, actionTypes);
    return true;
  },

  async saveProjects(projects: Project[]) {
    setStored(STORAGE_KEYS.PROJECTS, projects);
    return true;
  },

  async saveBonuses(bonuses: Bonus[]) {
    setStored(STORAGE_KEYS.BONUSES, bonuses);
    return true;
  },

  async savePhrases(phrases: Phrase[]) {
    setStored(STORAGE_KEYS.PHRASES, phrases);
    return true;
  },

  async saveMotivationalPhrases(motivationalPhrases: MotivationalPhrase[]) {
    setStored(STORAGE_KEYS.MOTIVATIONAL, motivationalPhrases);
    return true;
  },

  async saveEmployees(employees: Employee[]) {
    setStored(STORAGE_KEYS.EMPLOYEES, employees);
    return true;
  },

  async saveRatings(ratings: EmployeeRating[]) {
    setStored(STORAGE_KEYS.RATINGS, ratings);
    return true;
  },

  async saveSettings(settings: AppSettings) {
    setStored(STORAGE_KEYS.SETTINGS, settings);
    return true;
  },

  async saveTimerState(timerState: ActiveTimerState | null) {
    setStored(STORAGE_KEYS.TIMER, timerState);
    return true;
  },

  async savePointsRoles(roles: PointsRoleConfig[]) {
    setStored(STORAGE_KEYS.POINTS_ROLES, roles);
    return true;
  },

  async savePointsProfiles(profiles: EmployeePointsProfile[]) {
    setStored(STORAGE_KEYS.POINTS_PROFILES, profiles);
    return true;
  },

  async savePointsReasons(reasons: PointsReason[]) {
    setStored(STORAGE_KEYS.POINTS_REASONS, reasons);
    return true;
  },

  async savePointsTransactions(transactions: PointsTransaction[]) {
    setStored(STORAGE_KEYS.POINTS_TRANSACTIONS, transactions);
    return true;
  },

  async savePointsPeriods(periods: PointsPeriod[]) {
    setStored(STORAGE_KEYS.POINTS_PERIODS, periods);
    return true;
  },

  async saveBonusEligibility(rules: BonusEligibilityRule[]) {
    setStored(STORAGE_KEYS.BONUS_ELIGIBILITY, rules);
    return true;
  },

  async saveBonusClaims(claims: BonusClaim[]) {
    setStored(STORAGE_KEYS.BONUS_CLAIMS, claims);
    return true;
  },

  async savePointsAudit(audit: PointsAuditSummary | null) {
    setStored(STORAGE_KEYS.POINTS_AUDIT, audit);
    return true;
  },

  async executePointsCommandRemote(
    command: Record<string, unknown>
  ): Promise<{ success: boolean; code?: string; message?: string; error?: string; data?: any }> {
    if (!isGasHostedRuntime()) {
      return {
        success: false,
        code: 'NOT_GAS_HOSTED',
        error: `${AI_STUDIO_PREVIEW_SYNC_REASON} Зміну застосовано в локальному режимі.`,
      };
    }

    const sanitized = sanitizeDataForSheets(command) as Record<string, unknown>;
    const res = await gasBridge.executePointsCommand(sanitized);
    if (res.ok && res.success) {
      setStored(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      return { success: true, message: res.message, data: res };
    }

    return {
      success: false,
      code: res.code,
      error: res.error || 'Помилка виконання операції балів на сервері Apps Script.',
    };
  },

  setPendingSync(isPending: boolean) {
    setStored(STORAGE_KEYS.PENDING_SYNC, isPending);
  },

  setLastSynced(timestamp: string | null) {
    setStored(STORAGE_KEYS.LAST_SYNC, timestamp);
  },

  getUnsyncedEntryIds(): string[] {
    const stored = getStored<unknown>(STORAGE_KEYS.UNSYNCED_ENTRY_IDS, []);
    return Array.isArray(stored) ? stored.map((v) => String(v || '').trim()).filter(Boolean) : [];
  },

  removeUnsyncedEntryId(entryId: string) {
    const next = api.getUnsyncedEntryIds().filter((id) => id !== entryId);
    setStored(STORAGE_KEYS.UNSYNCED_ENTRY_IDS, next);
  },

  mergeRemoteAndDraftEntries(
    remoteEntries: TimeEntry[],
    localEntries: TimeEntry[]
  ): { entries: TimeEntry[]; preservedDraftIds: string[] } {
    const unsyncedIds = new Set(api.getUnsyncedEntryIds());
    if (unsyncedIds.size === 0) {
      return { entries: remoteEntries, preservedDraftIds: [] };
    }
    const remoteIds = new Set(remoteEntries.map((e) => e.id));
    const draftEntries = localEntries.filter(
      (e) => e && e.id && unsyncedIds.has(e.id) && !remoteIds.has(e.id)
    );
    return {
      entries: [...draftEntries, ...remoteEntries],
      preservedDraftIds: draftEntries.map((d) => d.id),
    };
  },

  mergeRemoteAndDraftImageRegistry(
    remoteRegistry: ImageAsset[],
    localRegistry: ImageAsset[]
  ): ImageAsset[] {
    const remoteIds = new Set(remoteRegistry.map((a) => a.id));
    const preservedDrafts = localRegistry.filter(
      (asset) => asset && asset.id && !remoteIds.has(asset.id) && isLocalDraftImageAsset(asset)
    );
    return [...remoteRegistry, ...preservedDrafts];
  },

  getImageLibrary(): ImageAsset[] {
    return getStored<ImageAsset[]>(STORAGE_KEYS.IMAGE_LIBRARY, []);
  },

  saveImageLibrary(assets: ImageAsset[]) {
    setStored(STORAGE_KEYS.IMAGE_LIBRARY, assets);
    return true;
  },

  getImageRegistry(): ImageAsset[] {
    return getStored<ImageAsset[]>(STORAGE_KEYS.IMAGE_LIBRARY, []);
  },

  saveImageRegistry(assets: ImageAsset[]) {
    setStored(STORAGE_KEYS.IMAGE_LIBRARY, assets);
    return true;
  },

  getImageAssignments(): ImageAssignment[] {
    return getStored<ImageAssignment[]>(STORAGE_KEYS.IMAGE_ASSIGNMENTS, []);
  },

  saveImageAssignments(assignments: ImageAssignment[]) {
    setStored(STORAGE_KEYS.IMAGE_ASSIGNMENTS, assignments);
    return true;
  },

  async saveImageMetadataRemote(
    asset: ImageAsset
  ): Promise<{ success: boolean; message: string; blocked?: boolean; draft?: boolean; error?: string }> {
    if (!isGasHostedRuntime()) {
      return {
        success: false,
        draft: true,
        message: 'Чернетка — не збережено в Google Таблиці (локальний режим AI Studio Preview).',
      };
    }

    const saveRes = await gasBridge.saveImageRegistry([asset]);
    if (!saveRes.ok || !saveRes.success) {
      const isBlocked = saveRes.code === 'SCHEMA_COMPATIBILITY_BLOCKED';
      return {
        success: false,
        blocked: isBlocked,
        draft: true,
        error: saveRes.error || 'Помилка збереження в Google Таблиці.',
        message: isBlocked
          ? 'Синхронізація: ЗАБЛОКОВАНО (аркуш «Бібліотека зображень» відсутній або очікує сумісності схеми).'
          : saveRes.error || 'Помилка збереження метаданих зображення в таблиці.',
      };
    }

    const readRes = await gasBridge.getImageLibrary();
    if (!readRes.ok || !readRes.success) {
      return {
        success: false,
        blocked: readRes.code === 'SCHEMA_COMPATIBILITY_BLOCKED',
        draft: true,
        error: 'Не вдалося підтвердити збереження через зворотне читання (readback) з Google Таблиць.',
        message: 'Збереження не підтверджено: помилка зворотного читання.',
      };
    }

    const verified = readRes.registry?.some((r) => r.id === asset.id || r.url === asset.url);
    if (!verified) {
      return {
        success: false,
        draft: true,
        error: 'Зворотне читання не підтвердило наявність збереженого запису в таблиці.',
        message: 'Запис збережено локально як чернетку (зворотна перевірка не підтвердила рядок).',
      };
    }

    setStored(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    return {
      success: true,
      message: 'Збережено в Google Таблицях',
    };
  },

  async saveImageAssignmentsRemote(
    assignments: ImageAssignment[]
  ): Promise<{ success: boolean; message: string; blocked?: boolean; draft?: boolean; error?: string }> {
    if (!isGasHostedRuntime()) {
      return {
        success: false,
        draft: true,
        message: 'Чернетка — не збережено в Google Таблиці.',
      };
    }

    const saveRes = await gasBridge.saveImageAssignments(assignments);
    if (!saveRes.ok || !saveRes.success) {
      const isBlocked = saveRes.code === 'SCHEMA_COMPATIBILITY_BLOCKED';
      return {
        success: false,
        blocked: isBlocked,
        draft: true,
        error: saveRes.error,
        message: isBlocked
          ? 'Синхронізація: ЗАБЛОКОВАНО (аркуш «Призначення зображень» відсутній або очікує сумісності схеми).'
          : saveRes.error || 'Помилка збереження призначень зображень.',
      };
    }

    const readRes = await gasBridge.getImageLibrary();
    if (!readRes.ok || !readRes.success) {
      return {
        success: false,
        blocked: readRes.code === 'SCHEMA_COMPATIBILITY_BLOCKED',
        draft: true,
        error: 'Зворотне читання не вдалося.',
        message: 'Збереження не підтверджено зворотним читанням.',
      };
    }

    setStored(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    return {
      success: true,
      message: 'Збережено в Google Таблицях',
    };
  },

  async uploadAsset(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        resolve(result || '');
      };
      reader.readAsDataURL(file);
    });
  },
};
