import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { TimerView } from './components/TimerView';
import { CalendarView } from './components/CalendarView';
import { HistoryView } from './components/HistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { TeamView } from './components/TeamView';
import { BonusesView } from './components/BonusesView';
import { PointsTeamView } from './components/PointsTeamView';
import { PointsReasonsView } from './components/PointsReasonsView';
import { PointsSettingsView } from './components/PointsSettingsView';
import { SettingsView } from './components/SettingsView';
import { api, isGasHostedRuntime } from './services/api';
import { initialEmployees, initialRatings, initialSettings } from './mockData';
import { resolveAssetUrl } from './utils/assetResolver';
import { getDefaultEmployeeId, migrateTimeEntriesEmployeeId } from './utils/teamUtils';
import {
  buildImageDiagnostics,
  hydrateStagesFromImageLibrary,
  normalizeLoadedImageAssignments,
  normalizeLoadedImageRegistry,
  normalizeLoadedMotivationalPhrases,
  normalizeLoadedPhrases,
  prepareUpdatedTimeEntry,
} from './utils/canonicalSheetsAdapter';
import {
  buildManualAdjustmentTransaction,
  buildPeriodRecordFromLedger,
  buildReversalTransaction,
  computeEmployeePointsState,
  computeTimeEarningSyncTransactions,
  createBonusClaimTransactionAndRecord,
  createDefaultPointsRoles,
  createMonthlyAllocationIfNeeded,
  getKyivDateParts,
  resolveBonusOfferForEmployee,
  resolveEffectiveEmployeePointsConfig,
  transitionBonusClaimStatus,
} from './utils/pointsEngine';
import {
  TimeEntry,
  Category,
  ActionType,
  Project,
  Bonus,
  BonusClaim,
  BonusClaimStatus,
  BonusEligibilityRule,
  Phrase,
  MotivationalPhrase,
  AppSettings,
  ActiveTimerState,
  SyncState,
  Employee,
  EmployeePointsProfile,
  EmployeeRating,
  EmployeeStatus,
  PointsAuditSummary,
  PointsPeriod,
  PointsReason,
  PointsReasonOperationType,
  PointsRoleConfig,
  PointsTransaction,
} from './types';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [motivationalPhrases, setMotivationalPhrases] = useState<MotivationalPhrase[]>([]);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [ratings, setRatings] = useState<EmployeeRating[]>(initialRatings);
  const [pointsRoles, setPointsRoles] = useState<PointsRoleConfig[]>(() => createDefaultPointsRoles());
  const [pointsProfiles, setPointsProfiles] = useState<EmployeePointsProfile[]>([]);
  const [pointsReasons, setPointsReasons] = useState<PointsReason[]>([]);
  const [pointsTransactions, setPointsTransactions] = useState<PointsTransaction[]>([]);
  const [pointsPeriods, setPointsPeriods] = useState<PointsPeriod[]>([]);
  const [bonusEligibility, setBonusEligibility] = useState<BonusEligibilityRule[]>([]);
  const [bonusClaims, setBonusClaims] = useState<BonusClaim[]>([]);
  const [pointsAudit, setPointsAudit] = useState<PointsAuditSummary | null>(null);
  const [employeeFilterId, setEmployeeFilterId] = useState<string>('all');
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [timerState, setTimerState] = useState<ActiveTimerState | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);

  const gasHosted = isGasHostedRuntime();

  // Single source of truth for all connection status surfaces (Sidebar, Header, Settings)
  const [syncState, setSyncState] = useState<SyncState>({
    status: gasHosted ? 'unverified' : 'local_preview',
    runtimeMode: gasHosted ? 'gas_hosted' : 'local_preview',
    lastSyncedAt: null,
    errorMessage: null,
    errorCode: null,
    hasConfiguredUrl: gasHosted,
    hasConfiguredSpreadsheet: gasHosted,
    spreadsheetName: null,
    spreadsheetId: null,
    imageDiagnostics: null,
  });

  const loadGenerationRef = useRef<number>(0);
  const editVersionsRef = useRef({
    entries: 0,
    categories: 0,
    actionTypes: 0,
    projects: 0,
    bonuses: 0,
    phrases: 0,
    motivationalPhrases: 0,
    employees: 0,
    ratings: 0,
    settings: 0,
    pointsRoles: 0,
    pointsProfiles: 0,
    pointsReasons: 0,
    pointsTransactions: 0,
    pointsPeriods: 0,
    bonusEligibility: 0,
    bonusClaims: 0,
  });

  const latestStateRef = useRef({
    entries,
    categories,
    actionTypes,
    projects,
    bonuses,
    phrases,
    motivationalPhrases,
    employees,
    ratings,
    settings,
    pointsRoles,
    pointsProfiles,
    pointsReasons,
    pointsTransactions,
    pointsPeriods,
    bonusEligibility,
    bonusClaims,
  });
  latestStateRef.current = {
    entries,
    categories,
    actionTypes,
    projects,
    bonuses,
    phrases,
    motivationalPhrases,
    employees,
    ratings,
    settings,
    pointsRoles,
    pointsProfiles,
    pointsReasons,
    pointsTransactions,
    pointsPeriods,
    bonusEligibility,
    bonusClaims,
  };

  const loadAndApplyRemoteSheet = useCallback(
    async ({
      isStartup,
      isCancelled,
    }: {
      isStartup: boolean;
      isCancelled?: () => boolean;
    }): Promise<{ success: boolean; message: string }> => {
      const requestGen = ++loadGenerationRef.current;
      const editSnapshot = { ...editVersionsRef.current };

      setIsSyncing(true);
      try {
        const res = await api.loadRemoteData(isStartup ? { dedupe: true } : undefined);

        if (isCancelled?.() || requestGen !== loadGenerationRef.current) {
          return {
            success: false,
            message: 'Завантаження скасовано або замінено новішим запитом.',
          };
        }

        const cur = latestStateRef.current;

        if (!res.ok || !res.success) {
          setSyncState((prev) => ({
            ...prev,
            status: 'error',
            runtimeMode: 'gas_hosted',
            errorMessage: res.error || 'Не вдалося прочитати дані з Google Таблиці.',
            errorCode: res.code || 'LOAD_ERROR',
            hasConfiguredUrl: true,
            hasConfiguredSpreadsheet: true,
            spreadsheetId: res.spreadsheetId || prev.spreadsheetId || null,
          }));
          return {
            success: false,
            message: res.error || 'Не вдалося прочитати дані з Google Таблиці.',
          };
        }

        if (res.needsSetup) {
          setSyncState((prev) => ({
            ...prev,
            status: 'connected',
            runtimeMode: 'gas_hosted',
            errorMessage: null,
            errorCode: null,
            hasConfiguredUrl: true,
            hasConfiguredSpreadsheet: true,
            spreadsheetName: res.spreadsheetName || null,
            spreadsheetId: res.spreadsheetId || null,
          }));
          return {
            success: true,
            message: `Таблиця «${res.spreadsheetName || 'Власна Google Таблиця'}» ще порожня. Натисніть «Синхронізувати», щоб записати поточні дані, або «Підготувати аркуші».`,
          };
        }

        const canApplySlice = (slice: keyof typeof editSnapshot) =>
          editVersionsRef.current[slice] === editSnapshot[slice];

        let skippedLocalEdits = false;
        let activeEmployees = cur.employees;

        if (Array.isArray(res.employees)) {
          if (canApplySlice('employees')) {
            const mergedEmployees = res.employees.map((re) => {
              const localEmp = cur.employees.find((le) => le.id === re.id);
              const preserveAvatar =
                re.avatarUrl === '[локальне зображення]' && localEmp?.avatarUrl?.startsWith('data:');
              const preservePortrait =
                re.portraitUrl === '[локальне зображення]' && localEmp?.portraitUrl?.startsWith('data:');
              return {
                ...re,
                avatarUrl: preserveAvatar ? localEmp!.avatarUrl : re.avatarUrl || '',
                portraitUrl: preservePortrait ? localEmp!.portraitUrl : re.portraitUrl || '',
                isDemo: false,
              };
            });
            activeEmployees = mergedEmployees;
            latestStateRef.current.employees = mergedEmployees;
            setEmployees(mergedEmployees);
            api.saveEmployees(mergedEmployees);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.ratings)) {
          if (canApplySlice('ratings')) {
            const cleanedRatings = res.ratings.map((r) => ({ ...r, isDemo: false }));
            latestStateRef.current.ratings = cleanedRatings;
            setRatings(cleanedRatings);
            api.saveRatings(cleanedRatings);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.entries)) {
          if (canApplySlice('entries')) {
            const fallbackEmpId = getDefaultEmployeeId(activeEmployees);
            const migrated = migrateTimeEntriesEmployeeId(res.entries, fallbackEmpId);
            const mergedEntriesRes = api.mergeRemoteAndDraftEntries(migrated.entries, cur.entries);
            latestStateRef.current.entries = mergedEntriesRes.entries;
            setEntries(mergedEntriesRes.entries);
            api.saveEntries(mergedEntriesRes.entries);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.categories)) {
          if (canApplySlice('categories')) {
            latestStateRef.current.categories = res.categories;
            setCategories(res.categories);
            api.saveCategories(res.categories);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.actionTypes)) {
          if (canApplySlice('actionTypes')) {
            latestStateRef.current.actionTypes = res.actionTypes;
            setActionTypes(res.actionTypes);
            api.saveActionTypes(res.actionTypes);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.projects)) {
          if (canApplySlice('projects')) {
            latestStateRef.current.projects = res.projects;
            setProjects(res.projects);
            api.saveProjects(res.projects);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.bonuses)) {
          if (canApplySlice('bonuses')) {
            const mergedBonuses = res.bonuses.map((rb) => {
              const localBonus = cur.bonuses.find((lb) => lb.id === rb.id);
              const preserveLocalImg =
                rb.imageUrl === '[локальне зображення]' && localBonus?.imageUrl?.startsWith('data:');
              return {
                ...rb,
                imageUrl: preserveLocalImg ? localBonus!.imageUrl : rb.imageUrl || '',
              };
            });
            latestStateRef.current.bonuses = mergedBonuses;
            setBonuses(mergedBonuses);
            api.saveBonuses(mergedBonuses);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.phrases)) {
          if (canApplySlice('phrases')) {
            const normalizedPhrases = normalizeLoadedPhrases(res.phrases);
            latestStateRef.current.phrases = normalizedPhrases;
            setPhrases(normalizedPhrases);
            api.savePhrases(normalizedPhrases);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.motivationalPhrases)) {
          if (canApplySlice('motivationalPhrases')) {
            const normalizedMot = normalizeLoadedMotivationalPhrases(res.motivationalPhrases);
            latestStateRef.current.motivationalPhrases = normalizedMot;
            setMotivationalPhrases(normalizedMot);
            api.saveMotivationalPhrases(normalizedMot);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.pointsRoles)) {
          if (canApplySlice('pointsRoles')) {
            const nextRoles = res.pointsRoles.length > 0 ? res.pointsRoles : createDefaultPointsRoles();
            latestStateRef.current.pointsRoles = nextRoles;
            setPointsRoles(nextRoles);
            api.savePointsRoles(nextRoles);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.pointsProfiles)) {
          if (canApplySlice('pointsProfiles')) {
            latestStateRef.current.pointsProfiles = res.pointsProfiles;
            setPointsProfiles(res.pointsProfiles);
            api.savePointsProfiles(res.pointsProfiles);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.pointsReasons)) {
          if (canApplySlice('pointsReasons')) {
            latestStateRef.current.pointsReasons = res.pointsReasons;
            setPointsReasons(res.pointsReasons);
            api.savePointsReasons(res.pointsReasons);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.pointsTransactions)) {
          if (canApplySlice('pointsTransactions')) {
            latestStateRef.current.pointsTransactions = res.pointsTransactions;
            setPointsTransactions(res.pointsTransactions);
            api.savePointsTransactions(res.pointsTransactions);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.pointsPeriods)) {
          if (canApplySlice('pointsPeriods')) {
            latestStateRef.current.pointsPeriods = res.pointsPeriods;
            setPointsPeriods(res.pointsPeriods);
            api.savePointsPeriods(res.pointsPeriods);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.bonusEligibility)) {
          if (canApplySlice('bonusEligibility')) {
            latestStateRef.current.bonusEligibility = res.bonusEligibility;
            setBonusEligibility(res.bonusEligibility);
            api.saveBonusEligibility(res.bonusEligibility);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (Array.isArray(res.bonusClaims)) {
          if (canApplySlice('bonusClaims')) {
            latestStateRef.current.bonusClaims = res.bonusClaims;
            setBonusClaims(res.bonusClaims);
            api.saveBonusClaims(res.bonusClaims);
          } else {
            skippedLocalEdits = true;
          }
        }

        if (res.pointsAudit) {
          setPointsAudit(res.pointsAudit);
          api.savePointsAudit(res.pointsAudit);
        }

        const loadedRegistry = Array.isArray(res.imageRegistry)
          ? normalizeLoadedImageRegistry(res.imageRegistry)
          : api.getImageRegistry();
        const loadedAssignments = Array.isArray(res.imageAssignments)
          ? normalizeLoadedImageAssignments(res.imageAssignments)
          : api.getImageAssignments();

        if (Array.isArray(res.imageRegistry)) {
          const mergedRegistry = api.mergeRemoteAndDraftImageRegistry(
            loadedRegistry,
            api.getImageRegistry()
          );
          api.saveImageRegistry(mergedRegistry);
        }
        if (Array.isArray(res.imageAssignments)) {
          api.saveImageAssignments(loadedAssignments);
        }

        if (res.settings || Array.isArray(res.imageRegistry) || Array.isArray(res.imageAssignments)) {
          if (canApplySlice('settings')) {
            const hydratedRemoteStages = hydrateStagesFromImageLibrary(
              initialSettings.stages,
              res.settings?.stages,
              loadedRegistry,
              loadedAssignments
            );
            const mergedStages = hydratedRemoteStages.map((rs) => {
              const localStage = cur.settings.stages.find((ls) => ls.stage === rs.stage);
              const keepLocalPrimary =
                rs.primaryImage === '[локальне зображення]' && localStage?.primaryImage?.startsWith('data:');
              const keepLocalAlternate =
                rs.alternateImage === '[локальне зображення]' && localStage?.alternateImage?.startsWith('data:');
              const primary = keepLocalPrimary ? localStage!.primaryImage : rs.primaryImage || '';
              const alternate = keepLocalAlternate
                ? localStage!.alternateImage
                : rs.alternateImage || primary;
              return { ...rs, primaryImage: primary, alternateImage: alternate };
            });

            const mergedSettings: AppSettings = {
              ...cur.settings,
              ...(res.settings || {}),
              stages: mergedStages,
              gasWebAppUrl: cur.settings.gasWebAppUrl,
              googleSpreadsheetId: res.spreadsheetId || cur.settings.googleSpreadsheetId,
            };
            latestStateRef.current.settings = mergedSettings;
            setSettings(mergedSettings);
            api.saveSettings(mergedSettings);
          } else {
            skippedLocalEdits = true;
          }
        }

        const hasRemainingDraftEntries = api.getUnsyncedEntryIds().length > 0;
        const nowIso = new Date().toISOString();
        const computedDiagnostics = buildImageDiagnostics(
          loadedRegistry,
          loadedAssignments,
          res.imageDiagnostics
        );
        api.setLastSynced(nowIso);
        if (!skippedLocalEdits && !hasRemainingDraftEntries) {
          api.setPendingSync(false);
        }

        setSyncState({
          status: 'connected',
          runtimeMode: 'gas_hosted',
          lastSyncedAt: nowIso,
          errorMessage: null,
          errorCode: null,
          hasConfiguredUrl: true,
          hasConfiguredSpreadsheet: true,
          spreadsheetName: res.spreadsheetName || null,
          spreadsheetId: res.spreadsheetId || null,
          imageDiagnostics: computedDiagnostics,
        });

        return {
          success: true,
          message: `Дані успішно завантажено з таблиці «${res.spreadsheetName || res.spreadsheetId || 'Google Sheets'}» (записів: ${res.entries?.length || 0}).`,
        };
      } finally {
        if (!isCancelled?.() && requestGen === loadGenerationRef.current) {
          setIsSyncing(false);
        }
      }
    },
    []
  );

  // Load local data & drafts first, then bootstrap from Google Sheets when GAS-hosted
  useEffect(() => {
    let isMounted = true;

    (async () => {
      const localData = await api.getAppData();
      if (!isMounted) return;

      latestStateRef.current = {
        entries: localData.entries,
        categories: localData.categories,
        actionTypes: localData.actionTypes,
        projects: localData.projects,
        bonuses: localData.bonuses,
        phrases: localData.phrases,
        motivationalPhrases: localData.motivationalPhrases,
        employees: localData.employees,
        ratings: localData.ratings,
        settings: localData.settings,
        pointsRoles: localData.pointsRoles,
        pointsProfiles: localData.pointsProfiles,
        pointsReasons: localData.pointsReasons,
        pointsTransactions: localData.pointsTransactions,
        pointsPeriods: localData.pointsPeriods,
        bonusEligibility: localData.bonusEligibility,
        bonusClaims: localData.bonusClaims,
      };

      setEntries(localData.entries);
      setCategories(localData.categories);
      setActionTypes(localData.actionTypes);
      setProjects(localData.projects);
      setBonuses(localData.bonuses);
      setPhrases(localData.phrases);
      setMotivationalPhrases(localData.motivationalPhrases);
      setEmployees(localData.employees);
      setRatings(localData.ratings);
      setSettings(localData.settings);
      setTimerState(localData.timerState);
      setPointsRoles(localData.pointsRoles);
      setPointsProfiles(localData.pointsProfiles);
      setPointsReasons(localData.pointsReasons);
      setPointsTransactions(localData.pointsTransactions);
      setPointsPeriods(localData.pointsPeriods);
      setBonusEligibility(localData.bonusEligibility);
      setBonusClaims(localData.bonusClaims);
      setPointsAudit(localData.pointsAudit);

      const isHostedNow = isGasHostedRuntime();

      if (!isHostedNow) {
        setSyncState({
          status: 'local_preview',
          runtimeMode: 'local_preview',
          lastSyncedAt: localData.lastSyncedAt || null,
          errorMessage: null,
          errorCode: 'NOT_GAS_HOSTED',
          hasConfiguredUrl: false,
          hasConfiguredSpreadsheet: false,
          spreadsheetName: null,
          spreadsheetId: null,
          imageDiagnostics: buildImageDiagnostics(localData.imageRegistry, localData.imageAssignments),
        });
        return;
      }

      setSyncState({
        status: 'unverified',
        runtimeMode: 'gas_hosted',
        lastSyncedAt: localData.lastSyncedAt || null,
        errorMessage: null,
        errorCode: null,
        hasConfiguredUrl: true,
        hasConfiguredSpreadsheet: true,
        spreadsheetName: null,
        spreadsheetId: null,
        imageDiagnostics: buildImageDiagnostics(localData.imageRegistry, localData.imageAssignments),
      });

      await loadAndApplyRemoteSheet({
        isStartup: true,
        isCancelled: () => !isMounted,
      });
    })();

    return () => {
      isMounted = false;
    };
  }, [loadAndApplyRemoteSheet]);

  // Timer tick effect (saved locally only; never writes every second to Sheets)
  useEffect(() => {
    let interval: any = null;
    if (timerState?.isRunning && !timerState.isPaused) {
      interval = setInterval(() => {
        setTimerState((prev) => {
          if (!prev || !prev.isRunning || prev.isPaused) return prev;
          const updated = { ...prev, elapsedSeconds: prev.elapsedSeconds + 1 };
          api.saveTimerState(updated);
          return updated;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerState?.isRunning, timerState?.isPaused]);

  // Render-safe settings copy: normalizes Drive links and resolves embedded/local assets without mutating storage
  const displaySettings = useMemo<AppSettings>(() => {
    const sourceStages =
      settings.stages && settings.stages.length > 0 ? settings.stages : initialSettings.stages;
    return {
      ...settings,
      stages: sourceStages.map((s) => ({
        ...s,
        primaryImage: resolveAssetUrl(s.primaryImage),
        alternateImage: resolveAssetUrl(s.alternateImage),
      })),
    };
  }, [settings]);

  // Connection test (AI Studio Preview: local format check only; GAS HtmlService: google.script.run.gasHealthCheck)
  const handleTestConnection = async () => {
    const isHostedNow = isGasHostedRuntime();

    if (!isHostedNow) {
      setSyncState((prev) => ({
        ...prev,
        status: 'local_preview',
        runtimeMode: 'local_preview',
        errorMessage: api.getIntegrationInfo().reason,
        hasConfiguredUrl: false,
        hasConfiguredSpreadsheet: false,
        spreadsheetName: null,
      }));
      return {
        success: false,
        message: api.getIntegrationInfo().reason,
      };
    }

    const result = await api.testConnection();

    if (result.success) {
      setSyncState((prev) => ({
        ...prev,
        status: 'connected',
        runtimeMode: 'gas_hosted',
        errorMessage: null,
        errorCode: null,
        hasConfiguredUrl: true,
        hasConfiguredSpreadsheet: true,
        spreadsheetName: result.spreadsheetName || null,
        spreadsheetId: result.spreadsheetId || prev.spreadsheetId || null,
      }));
    } else {
      setSyncState((prev) => ({
        ...prev,
        status: 'error',
        runtimeMode: 'gas_hosted',
        errorMessage: result.message,
        errorCode: 'GAS_EXECUTION_ERROR',
        hasConfiguredUrl: false,
        hasConfiguredSpreadsheet: false,
        spreadsheetName: null,
      }));
    }

    return result;
  };

  // Explicit setup of missing tabs/headers inside GAS HtmlService
  const handleSetupSpreadsheet = async () => {
    const res = await api.setupSpreadsheet();
    if (isGasHostedRuntime() && res.success) {
      setSyncState((prev) => ({
        ...prev,
        status: 'connected',
        runtimeMode: 'gas_hosted',
        errorMessage: null,
        hasConfiguredUrl: true,
        hasConfiguredSpreadsheet: true,
        spreadsheetName: res.spreadsheetName || prev.spreadsheetName || null,
        spreadsheetId: res.spreadsheetId || prev.spreadsheetId || null,
      }));
    }
    return res;
  };

  // Load structured data from user's Google Sheet inside GAS HtmlService
  const handleLoadFromSheet = async () => {
    const isHostedNow = isGasHostedRuntime();
    if (!isHostedNow) {
      return { success: false, message: api.getIntegrationInfo().reason };
    }

    return loadAndApplyRemoteSheet({
      isStartup: false,
    });
  };

  // Timer actions
  const handleStartTimer = (
    categoryId: string,
    actionTypeId: string,
    projectId: string,
    description: string,
    employeeId?: string,
    relatedEmployeeId?: string
  ) => {
    const resolvedEmployeeId = employeeId || getDefaultEmployeeId(employees);
    const newState: ActiveTimerState = {
      isRunning: true,
      isPaused: false,
      startTime: new Date().toISOString(),
      elapsedSeconds: 0,
      categoryId,
      actionTypeId,
      projectId,
      employeeId: resolvedEmployeeId,
      relatedEmployeeId: relatedEmployeeId || undefined,
      description: description || 'Робоча сесія',
      segments: [{ startTime: new Date().toISOString(), durationSeconds: 0 }],
    };
    setTimerState(newState);
    api.saveTimerState(newState);
  };

  const handlePauseTimer = () => {
    if (!timerState) return;
    const newState = { ...timerState, isPaused: true };
    setTimerState(newState);
    api.saveTimerState(newState);
  };

  const handleResumeTimer = () => {
    if (!timerState) return;
    const newState = { ...timerState, isPaused: false };
    setTimerState(newState);
    api.saveTimerState(newState);
  };

  const handleUpdateElapsedSeconds = (seconds: number) => {
    if (!timerState) return;
    const newState = { ...timerState, elapsedSeconds: seconds };
    setTimerState(newState);
    api.saveTimerState(newState);
  };

  const handleUpdateTimerField = (updates: Partial<ActiveTimerState>) => {
    if (!timerState) return;
    const newState = { ...timerState, ...updates };
    setTimerState(newState);
    api.saveTimerState(newState);
  };

  const handleStopTimer = async () => {
    if (!timerState) return;
    const rawElapsed = Math.max(0, Math.round(timerState.elapsedSeconds || 0));
    const totalMinutes = Math.max(1, Math.round(rawElapsed / 60));
    const now = new Date();
    const startTimeStr = timerState.startTime
      ? new Date(timerState.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '10:00';
    const endTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newEntry: TimeEntry = {
      id: `entry-${Date.now()}`,
      date: now.toISOString().split('T')[0],
      startTime: startTimeStr,
      endTime: endTimeStr,
      durationMinutes: totalMinutes,
      elapsedSeconds: rawElapsed,
      categoryId: timerState.categoryId,
      actionTypeId: timerState.actionTypeId,
      projectId: timerState.projectId,
      employeeId: timerState.employeeId || getDefaultEmployeeId(employees),
      relatedEmployeeId: timerState.relatedEmployeeId || undefined,
      description: timerState.description,
      isManual: false,
    };

    editVersionsRef.current.entries += 1;
    const updatedEntries = [newEntry, ...entries];
    setEntries(updatedEntries);
    api.saveEntries(updatedEntries);

    setTimerState(null);
    api.saveTimerState(null);

    if (isGasHostedRuntime()) {
      const res = await api.saveTimeEntryRemote(newEntry);
      if (res.success) {
        setSyncState((prev) => ({
          ...prev,
          status: 'connected',
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
        }));
      } else {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: res.error || 'Помилка збереження в таблицю.',
        }));
      }
    }
  };

  // Manual Entry actions (local-first; pushes via google.script.run when GAS-hosted)
  const handleAddManualEntry = async (entry: Omit<TimeEntry, 'id'>) => {
    const newEntry: TimeEntry = {
      ...entry,
      employeeId: entry.employeeId || getDefaultEmployeeId(employees),
      id: `entry-${Date.now()}`,
    };
    editVersionsRef.current.entries += 1;
    const updated = [newEntry, ...entries];
    setEntries(updated);
    api.saveEntries(updated);

    if (isGasHostedRuntime()) {
      const res = await api.saveTimeEntryRemote(newEntry);
      if (res.success) {
        setSyncState((prev) => ({
          ...prev,
          status: 'connected',
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
        }));
      } else {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: res.error || 'Помилка збереження в таблицю.',
        }));
      }
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (confirm('Ви дійсно бажаєте видалити цей запис часу?')) {
      editVersionsRef.current.entries += 1;
      const updated = entries.filter((e) => e.id !== id);
      setEntries(updated);
      api.saveEntries(updated);

      if (isGasHostedRuntime()) {
        const res = await api.deleteTimeEntryRemote(id);
        if (res.success) {
          setSyncState((prev) => ({
            ...prev,
            status: 'connected',
            lastSyncedAt: new Date().toISOString(),
            errorMessage: null,
          }));
        } else {
          setSyncState((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: res.error || 'Помилка видалення з таблиці.',
          }));
        }
      }
    }
  };

  const handleUpdateEntry = async (updatedEntry: TimeEntry) => {
    editVersionsRef.current.entries += 1;
    const prevEntry = latestStateRef.current.entries.find((e) => e.id === updatedEntry.id) || null;
    const preparedEntry = prepareUpdatedTimeEntry(
      updatedEntry,
      prevEntry,
      latestStateRef.current.categories
    );
    const updated = latestStateRef.current.entries.map((e) =>
      e.id === preparedEntry.id ? preparedEntry : e
    );
    latestStateRef.current.entries = updated;
    setEntries(updated);
    api.saveEntries(updated);

    if (isGasHostedRuntime()) {
      const res = await api.saveTimeEntryRemote(preparedEntry);
      if (res.success) {
        setSyncState((prev) => ({
          ...prev,
          status: 'connected',
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
        }));
      } else {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: res.error || 'Помилка оновлення в таблиці.',
        }));
      }
    }
  };

  // Points & Rewards Handlers (Fail-closed in GAS mode; local simulation only in Preview mode)
  const handleAddPointsTransaction = async (params: {
    employeeId: string;
    operationType: PointsReasonOperationType;
    amount: number;
    reasonId: string;
    reasonSnapshot: string;
    customExplanation?: string;
    comment: string;
    projectId?: string;
    segmentId?: string;
    relatedEmployeeId?: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-ptx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'manual_adjustment',
        ...params,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка виконання операції балів на сервері.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message || 'Операцію збережено в Google Таблиці.' };
    }

    const eff = resolveEffectiveEmployeePointsConfig(
      params.employeeId,
      latestStateRef.current.pointsRoles,
      latestStateRef.current.pointsProfiles
    );
    const built = buildManualAdjustmentTransaction({
      employeeId: params.employeeId,
      operationType: params.operationType,
      amount: params.amount,
      reasonId: params.reasonId,
      reasonNameSnapshot: params.reasonSnapshot,
      customExplanation: params.customExplanation,
      comment: params.comment,
      projectId: params.projectId,
      segmentId: params.segmentId,
      relatedEmployeeId: params.relatedEmployeeId,
      actorEmployeeId: 'local-preview',
      commandId,
      positiveGraceMonths: eff.positiveGraceMonths,
    });
    if (!built.ok) {
      return { success: false, error: built.error };
    }
    const isClosed = latestStateRef.current.pointsPeriods.some(
      (p) => p.employeeId === params.employeeId && p.monthKey === built.transaction.monthKey && p.status === 'closed'
    );
    if (isClosed) {
      return {
        success: false,
        error: `Період ${built.transaction.monthKey} закрито. Операції в закритому періоді заборонено.`,
      };
    }

    editVersionsRef.current.pointsTransactions += 1;
    const nextTxs = [built.transaction, ...latestStateRef.current.pointsTransactions];
    latestStateRef.current.pointsTransactions = nextTxs;
    setPointsTransactions(nextTxs);
    await api.savePointsTransactions(nextTxs);
    return { success: true, message: 'Операцію збережено в локальному журналі.' };
  };

  const handleReversePointsTransaction = async (params: {
    transactionId: string;
    comment: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'reverse_transaction',
        transactionId: params.transactionId,
        comment: params.comment,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка сторнування на сервері.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message || 'Операцію сторновано в Google Таблиці.' };
    }

    const target = latestStateRef.current.pointsTransactions.find((t) => t.id === params.transactionId);
    if (!target) return { success: false, error: 'Операцію не знайдено.' };
    const isClosed = latestStateRef.current.pointsPeriods.some(
      (p) => p.employeeId === target.employeeId && p.monthKey === target.monthKey && p.status === 'closed'
    );
    if (isClosed) {
      return { success: false, error: `Період ${target.monthKey} закрито. Сторнування заборонено.` };
    }

    const revRes = buildReversalTransaction({
      targetTransaction: target,
      comment: params.comment,
      actorEmployeeId: 'local-preview',
      commandId,
    });
    if (!revRes.ok) return { success: false, error: revRes.error };

    editVersionsRef.current.pointsTransactions += 1;
    const nextTxs = [revRes.transaction, ...latestStateRef.current.pointsTransactions];
    latestStateRef.current.pointsTransactions = nextTxs;
    setPointsTransactions(nextTxs);
    await api.savePointsTransactions(nextTxs);
    return { success: true, message: 'Операцію сторновано локально.' };
  };

  const handleEnsureMonthlyAllocations = async (
    monthKey: string
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const targetMk = monthKey || getKyivDateParts(new Date()).monthKey;
    const commandId = `cmd-alloc-${targetMk}-${Date.now()}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'ensure_monthly_allocations',
        monthKey: targetMk,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка нарахування місячної бази.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    const curTxs = [...latestStateRef.current.pointsTransactions];
    const added: PointsTransaction[] = [];
    for (const emp of latestStateRef.current.employees) {
      if (emp.status !== 'active') continue;
      const eff = resolveEffectiveEmployeePointsConfig(
        emp.id,
        latestStateRef.current.pointsRoles,
        latestStateRef.current.pointsProfiles
      );
      const tx = createMonthlyAllocationIfNeeded({
        employeeId: emp.id,
        monthKey: targetMk,
        effectiveConfig: eff,
        existingTransactions: [...added, ...curTxs],
        periods: latestStateRef.current.pointsPeriods,
        actorEmployeeId: 'local-preview',
      });
      if (tx) added.push(tx);
    }

    if (added.length > 0) {
      editVersionsRef.current.pointsTransactions += 1;
      const nextTxs = [...added, ...curTxs];
      latestStateRef.current.pointsTransactions = nextTxs;
      setPointsTransactions(nextTxs);
      await api.savePointsTransactions(nextTxs);
    }
    return {
      success: true,
      message:
        added.length > 0
          ? `Нараховано місячну базу для ${added.length} співробітників за ${targetMk}.`
          : `Місячна база за ${targetMk} вже нарахована або не передбачена роллю.`,
    };
  };

  const handleSyncTimeEarning = async (): Promise<{
    success: boolean;
    error?: string;
    message?: string;
  }> => {
    const commandId = `cmd-time-sync-${Date.now()}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'sync_time_earning',
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка синхронізації балів за час.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    const curTxs = [...latestStateRef.current.pointsTransactions];
    const generated: PointsTransaction[] = [];
    const eligibleCatIds = latestStateRef.current.settings.pointsEligibleCategoryIds || [];

    for (const emp of latestStateRef.current.employees) {
      const eff = resolveEffectiveEmployeePointsConfig(
        emp.id,
        latestStateRef.current.pointsRoles,
        latestStateRef.current.pointsProfiles
      );
      const empTxs = computeTimeEarningSyncTransactions({
        employeeId: emp.id,
        effectiveConfig: eff,
        entries: latestStateRef.current.entries,
        existingTransactions: [...generated, ...curTxs],
        periods: latestStateRef.current.pointsPeriods,
        eligibleCategoryIds: eligibleCatIds,
      });
      generated.push(...empTxs);
    }

    if (generated.length > 0) {
      editVersionsRef.current.pointsTransactions += 1;
      const nextTxs = [...generated, ...curTxs];
      latestStateRef.current.pointsTransactions = nextTxs;
      setPointsTransactions(nextTxs);
      await api.savePointsTransactions(nextTxs);
    }
    return {
      success: true,
      message:
        generated.length > 0
          ? `Синхронізовано операцій за відпрацьований час: ${generated.length}.`
          : 'Усі бали за час вже актуальні.',
    };
  };

  const handleClosePointsPeriod = async (
    employeeId: string,
    monthKey: string
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const eff = resolveEffectiveEmployeePointsConfig(
      employeeId,
      latestStateRef.current.pointsRoles,
      latestStateRef.current.pointsProfiles
    );
    const periodRecord = buildPeriodRecordFromLedger({
      employeeId,
      monthKey,
      effectiveConfig: eff,
      transactions: latestStateRef.current.pointsTransactions,
      existingPeriods: latestStateRef.current.pointsPeriods,
      closePeriod: true,
    });
    const commandId = `cmd-close-${employeeId}-${monthKey}-${Date.now()}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'close_period',
        employeeId,
        monthKey,
        baseAllocation: periodRecord.baseAllocation,
        debtCarriedIn: periodRecord.debtCarriedIn,
        earnedPoints: periodRecord.earnedPoints,
        deductedPoints: periodRecord.deductedPoints,
        spentPoints: periodRecord.spentPoints,
        expiredPoints: periodRecord.expiredPoints,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка закриття періоду на сервері.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message || `Період ${monthKey} закрито.` };
    }

    editVersionsRef.current.pointsPeriods += 1;
    const filtered = latestStateRef.current.pointsPeriods.filter((p) => p.id !== periodRecord.id);
    const nextPeriods = [periodRecord, ...filtered];
    latestStateRef.current.pointsPeriods = nextPeriods;
    setPointsPeriods(nextPeriods);
    await api.savePointsPeriods(nextPeriods);
    return { success: true, message: `Період ${monthKey} закрито локально.` };
  };

  const handleSavePointsReasons = async (
    nextReasons: PointsReason[]
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-reasons-${Date.now()}`;
    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'save_reasons',
        reasons: nextReasons,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка збереження довідника причин.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    editVersionsRef.current.pointsReasons += 1;
    latestStateRef.current.pointsReasons = nextReasons;
    setPointsReasons(nextReasons);
    await api.savePointsReasons(nextReasons);
    return { success: true, message: 'Довідник причин збережено локально.' };
  };

  const handleSavePointsRolesAndCategories = async (
    nextRoles: PointsRoleConfig[],
    nextEligibleCategoryIds: string[]
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-roles-${Date.now()}`;
    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'save_roles',
        roles: nextRoles,
        eligibleCategoryIds: nextEligibleCategoryIds,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка збереження ролей балів.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    editVersionsRef.current.pointsRoles += 1;
    latestStateRef.current.pointsRoles = nextRoles;
    setPointsRoles(nextRoles);
    await api.savePointsRoles(nextRoles);

    editVersionsRef.current.settings += 1;
    const nextSettings: AppSettings = {
      ...latestStateRef.current.settings,
      pointsEligibleCategoryIds: nextEligibleCategoryIds,
    };
    latestStateRef.current.settings = nextSettings;
    setSettings(nextSettings);
    await api.saveSettings(nextSettings);

    return { success: true, message: 'Ролі та категорії балів збережено локально.' };
  };

  const handleSavePointsProfiles = async (
    nextProfiles: EmployeePointsProfile[]
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-profiles-${Date.now()}`;
    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'save_profiles',
        profiles: nextProfiles,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка збереження профілів балів.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    editVersionsRef.current.pointsProfiles += 1;
    latestStateRef.current.pointsProfiles = nextProfiles;
    setPointsProfiles(nextProfiles);
    await api.savePointsProfiles(nextProfiles);
    return { success: true, message: 'Профілі балів збережено локально.' };
  };

  const handleSaveBonusEligibility = async (
    nextRules: BonusEligibilityRule[]
  ): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-elig-${Date.now()}`;
    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'save_eligibility',
        rules: nextRules,
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка збереження доступності бонусів.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    editVersionsRef.current.bonusEligibility += 1;
    latestStateRef.current.bonusEligibility = nextRules;
    setBonusEligibility(nextRules);
    await api.saveBonusEligibility(nextRules);
    return { success: true, message: 'Правила доступності бонусів збережено локально.' };
  };

  const handleClaimBonusForEmployee = async (params: {
    employeeId: string;
    bonusId: string;
    quantity: number;
    comment?: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-claim-${params.employeeId}-${params.bonusId}-${Date.now()}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'claim_bonus',
        employeeId: params.employeeId,
        bonusId: params.bonusId,
        quantity: params.quantity,
        comment: params.comment || '',
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка оформлення бонусу на сервері.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    const bonus = latestStateRef.current.bonuses.find((b) => b.id === params.bonusId);
    if (!bonus) return { success: false, error: 'Бонус не знайдено.' };
    const eff = resolveEffectiveEmployeePointsConfig(
      params.employeeId,
      latestStateRef.current.pointsRoles,
      latestStateRef.current.pointsProfiles
    );
    const state = computeEmployeePointsState(
      params.employeeId,
      eff,
      latestStateRef.current.pointsTransactions
    );
    const offer = resolveBonusOfferForEmployee(
      bonus,
      latestStateRef.current.bonusEligibility,
      latestStateRef.current.bonusClaims,
      params.employeeId,
      eff.pointsRole
    );

    const claimRes = createBonusClaimTransactionAndRecord({
      employeeId: params.employeeId,
      offer,
      quantity: params.quantity,
      comment: params.comment,
      availablePoints: state.availablePoints,
      commandId,
      existingClaims: latestStateRef.current.bonusClaims,
    });
    if (!claimRes.ok) {
      return { success: false, error: claimRes.error };
    }

    editVersionsRef.current.bonusClaims += 1;
    editVersionsRef.current.pointsTransactions += 1;
    const nextClaims = [claimRes.claim, ...latestStateRef.current.bonusClaims];
    const nextTxs = [claimRes.spendTransaction, ...latestStateRef.current.pointsTransactions];
    latestStateRef.current.bonusClaims = nextClaims;
    latestStateRef.current.pointsTransactions = nextTxs;
    setBonusClaims(nextClaims);
    setPointsTransactions(nextTxs);
    await Promise.all([api.saveBonusClaims(nextClaims), api.savePointsTransactions(nextTxs)]);
    return { success: true, message: 'Запит на бонус збережено локально.' };
  };

  const handleTransitionBonusClaim = async (params: {
    claimId: string;
    nextStatus: BonusClaimStatus;
    comment?: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> => {
    const commandId = `cmd-claim-st-${params.claimId}-${Date.now()}`;

    if (isGasHostedRuntime()) {
      const res = await api.executePointsCommandRemote({
        type: 'transition_claim',
        claimId: params.claimId,
        nextStatus: params.nextStatus,
        comment: params.comment || '',
        commandId,
      });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка оновлення статусу бонусу.' };
      }
      await loadAndApplyRemoteSheet({ isStartup: false });
      return { success: true, message: res.message };
    }

    const target = latestStateRef.current.bonusClaims.find((c) => c.id === params.claimId);
    if (!target) return { success: false, error: 'Запит бонусу не знайдено.' };

    const trans = transitionBonusClaimStatus({
      claim: target,
      nextStatus: params.nextStatus,
      actorEmployeeId: 'local-preview',
      comment: params.comment,
      existingTransactions: latestStateRef.current.pointsTransactions,
      commandId,
    });
    if (!trans.ok) {
      return { success: false, error: trans.error };
    }

    editVersionsRef.current.bonusClaims += 1;
    const nextClaims = latestStateRef.current.bonusClaims.map((c) =>
      c.id === params.claimId ? trans.updatedClaim : c
    );
    latestStateRef.current.bonusClaims = nextClaims;
    setBonusClaims(nextClaims);
    await api.saveBonusClaims(nextClaims);

    if (trans.refundTransaction) {
      editVersionsRef.current.pointsTransactions += 1;
      const nextTxs = [trans.refundTransaction, ...latestStateRef.current.pointsTransactions];
      latestStateRef.current.pointsTransactions = nextTxs;
      setPointsTransactions(nextTxs);
      await api.savePointsTransactions(nextTxs);
    }

    return { success: true, message: 'Статус запиту оновлено локально.' };
  };

  const handleUpdateBonusImage = (id: string, imageUrl: string) => {
    editVersionsRef.current.bonuses += 1;
    const updated = bonuses.map((b) => (b.id === id ? { ...b, imageUrl } : b));
    setBonuses(updated);
    api.saveBonuses(updated);
  };

  // Settings & Category / Phrase / Motivational updates
  const handleSaveSettings = async (newSettings: AppSettings) => {
    editVersionsRef.current.settings += 1;
    latestStateRef.current.settings = newSettings;
    setSettings(newSettings);
    api.saveSettings(newSettings);

    const isHostedNow = isGasHostedRuntime();
    const gasUrlChanged = (settings.gasWebAppUrl || '') !== (newSettings.gasWebAppUrl || '');
    if (gasUrlChanged) {
      setSyncState((prev) => ({
        ...prev,
        status: isHostedNow ? 'unverified' : 'local_preview',
        runtimeMode: isHostedNow ? 'gas_hosted' : 'local_preview',
        hasConfiguredUrl: isHostedNow,
        hasConfiguredSpreadsheet: isHostedNow,
        spreadsheetName: null,
        spreadsheetId: null,
        errorMessage: null,
        errorCode: null,
      }));
      return;
    }
    if (!isHostedNow) {
      setSyncState((prev) => ({ ...prev, status: 'local_preview', runtimeMode: 'local_preview', hasConfiguredUrl: false, hasConfiguredSpreadsheet: false, errorMessage: null }));
      return;
    }
    if (syncState.status === 'connected') await api.saveConfigRemote({ settings: newSettings });
  };

  const handleSaveCategories = async (cats: Category[]) => {
    editVersionsRef.current.categories += 1;
    setCategories(cats);
    api.saveCategories(cats);

    if (isGasHostedRuntime() && syncState.status === 'connected') {
      await api.saveConfigRemote({ categories: cats });
    }
  };

  const handleSavePhrases = async (ph: Phrase[]) => {
    editVersionsRef.current.phrases += 1;
    setPhrases(ph);
    api.savePhrases(ph);

    if (isGasHostedRuntime() && syncState.status === 'connected') {
      await api.saveConfigRemote({ phrases: ph });
    }
  };

  const handleSaveMotivational = async (mot: MotivationalPhrase[]) => {
    editVersionsRef.current.motivationalPhrases += 1;
    setMotivationalPhrases(mot);
    api.saveMotivationalPhrases(mot);

    if (isGasHostedRuntime() && syncState.status === 'connected') {
      await api.saveConfigRemote({ motivationalPhrases: mot });
    }
  };

  // Team Employee & Rating Handlers
  const handleSaveEmployee = async (
    employee: Employee,
    isNew: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    editVersionsRef.current.employees += 1;
    if (isGasHostedRuntime()) {
      const res = await api.saveEmployeeRemote({ ...employee, createOnly: isNew });
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка збереження співробітника в Google Таблиці.' };
      }
      setSyncState((prev) => ({
        ...prev,
        status: 'connected',
        lastSyncedAt: new Date().toISOString(),
        errorMessage: null,
      }));
    }

    const updatedEmployees = isNew
      ? [...employees, employee]
      : employees.map((item) => (item.id === employee.id ? employee : item));
    setEmployees(updatedEmployees);
    api.saveEmployees(updatedEmployees);
    return { success: true };
  };

  const handleArchiveEmployee = async (
    employeeId: string,
    nextStatus: EmployeeStatus
  ): Promise<{ success: boolean; error?: string }> => {
    editVersionsRef.current.employees += 1;
    const target = employees.find((e) => e.id === employeeId);
    if (!target) {
      return { success: false, error: 'Співробітника не знайдено.' };
    }
    const updatedEmp: Employee = {
      ...target,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };

    if (isGasHostedRuntime()) {
      const res =
        nextStatus === 'archived'
          ? await api.archiveEmployeeRemote(employeeId)
          : await api.saveEmployeeRemote(updatedEmp);
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка оновлення статусу в Google Таблиці.' };
      }
      setSyncState((prev) => ({
        ...prev,
        status: 'connected',
        lastSyncedAt: new Date().toISOString(),
        errorMessage: null,
      }));
    }

    const updatedList = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(updatedList);
    api.saveEmployees(updatedList);
    return { success: true };
  };

  const handleSaveRating = async (
    rating: EmployeeRating
  ): Promise<{ success: boolean; error?: string }> => {
    editVersionsRef.current.ratings += 1;
    let savedRating: EmployeeRating = { ...rating, isDemo: false };

    if (isGasHostedRuntime()) {
      const res = await api.saveRatingRemote(rating);
      if (!res.success) {
        return { success: false, error: res.error || 'Помилка збереження оцінки в Google Таблиці.' };
      }
      if (res.rating) {
        savedRating = { ...savedRating, ...res.rating, isDemo: false };
      }
      setSyncState((prev) => ({
        ...prev,
        status: 'connected',
        lastSyncedAt: new Date().toISOString(),
        errorMessage: null,
      }));
    }

    const baseRatings = latestStateRef.current.ratings;
    const updatedRatings = [
      savedRating,
      ...baseRatings.filter((item) => item.id !== savedRating.id),
    ];
    latestStateRef.current.ratings = updatedRatings;
    setRatings(updatedRatings);
    api.saveRatings(updatedRatings);
    return { success: true };
  };

  const handleUpdateEmployeeImage = (
    employeeId: string,
    slot: 'avatar' | 'portrait',
    imageUrl: string
  ) => {
    editVersionsRef.current.employees += 1;
    const nowIso = new Date().toISOString();
    const updated = employees.map((emp) => {
      if (emp.id !== employeeId) return emp;
      return slot === 'avatar'
        ? { ...emp, avatarUrl: imageUrl, updatedAt: nowIso }
        : { ...emp, portraitUrl: imageUrl, updatedAt: nowIso };
    });
    setEmployees(updated);
    api.saveEmployees(updated);
  };

  const handleOpenEmployeeInHistory = (empId: string) => {
    setEmployeeFilterId(empId);
    setCurrentTab('history');
  };

  const handleOpenEmployeeInCalendar = (empId: string) => {
    setEmployeeFilterId(empId);
    setCurrentTab('calendar');
  };

  // Full manual synchronization (active inside GAS HtmlService with bound spreadsheet)
  const handleSyncGas = async () => {
    const isHostedNow = isGasHostedRuntime();

    if (!isHostedNow) {
      setSyncState((prev) => ({
        ...prev,
        status: 'local_preview',
        errorMessage: api.getIntegrationInfo().reason,
      }));
      return { success: false, message: api.getIntegrationInfo().reason };
    }

    setIsSyncing(true);
    try {
      const res = await api.syncAllWithGas({
        entries,
        categories,
        actionTypes,
        projects,
        bonuses,
        phrases,
        motivationalPhrases,
        employees,
        ratings,
        settings,
      });

      if (res.success) {
        const nowIso = new Date().toISOString();
        setSyncState((prev) => ({
          ...prev,
          status: 'connected',
          runtimeMode: 'gas_hosted',
          lastSyncedAt: nowIso,
          errorMessage: null,
          hasConfiguredUrl: true,
          hasConfiguredSpreadsheet: true,
          spreadsheetName: res.spreadsheetName || prev.spreadsheetName || null,
          spreadsheetId: res.spreadsheetId || prev.spreadsheetId || null,
        }));
      } else {
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: res.error || res.message,
        }));
      }
      return res;
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex h-[100dvh] bg-bg-2 text-fg font-sans overflow-hidden">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        syncState={syncState}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          onSync={handleSyncGas}
          isSyncing={isSyncing}
          syncState={syncState}
          onOpenMobileMenu={() => setIsMobileNavOpen(true)}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
           {currentTab === 'dashboard' && (
            <DashboardView
              entries={entries}
              categories={categories}
              actionTypes={actionTypes}
              projects={projects}
              employees={employees}
              settings={displaySettings}
              phrases={phrases}
              motivationalPhrases={motivationalPhrases}
              timerState={timerState}
              syncState={syncState}
              onStartTimer={handleStartTimer}
              onPauseTimer={handlePauseTimer}
              onResumeTimer={handleResumeTimer}
              onStopTimer={handleStopTimer}
              onUpdateTimerField={handleUpdateTimerField}
              onNavigateTab={setCurrentTab}
            />
          )}

          {currentTab === 'timer' && (
            <TimerView
              categories={categories}
              actionTypes={actionTypes}
              projects={projects}
              employees={employees}
              timerState={timerState}
              settings={displaySettings}
              entries={entries}
              phrases={phrases}
              syncState={syncState}
              onStartTimer={handleStartTimer}
              onPauseTimer={handlePauseTimer}
              onResumeTimer={handleResumeTimer}
              onStopTimer={handleStopTimer}
              onUpdateElapsedSeconds={handleUpdateElapsedSeconds}
              onUpdateTimerField={handleUpdateTimerField}
            />
          )}

          {currentTab === 'calendar' && (
            <CalendarView
              entries={entries}
              categories={categories}
              actionTypes={actionTypes}
              projects={projects}
              employees={employees}
              selectedEmployeeFilter={employeeFilterId}
              onSelectEmployeeFilter={setEmployeeFilterId}
              onAddManualEntry={handleAddManualEntry}
              onUpdateEntry={handleUpdateEntry}
              onDeleteEntry={handleDeleteEntry}
            />
          )}

          {currentTab === 'history' && (
            <HistoryView
              entries={entries}
              categories={categories}
              actionTypes={actionTypes}
              projects={projects}
              employees={employees}
              selectedEmployeeFilter={employeeFilterId}
              onSelectEmployeeFilter={setEmployeeFilterId}
              onDeleteEntry={handleDeleteEntry}
              onUpdateEntry={handleUpdateEntry}
            />
          )}

          {currentTab === 'analytics' && (
            <AnalyticsView
              entries={entries}
              categories={categories}
              actionTypes={actionTypes}
              projects={projects}
              employees={employees}
              settings={displaySettings}
              selectedEmployeeFilter={employeeFilterId}
              onSelectEmployeeFilter={setEmployeeFilterId}
            />
          )}

          {currentTab === 'team' && (
            <TeamView
              employees={employees}
              ratings={ratings}
              entries={entries}
              categories={categories}
              projects={projects}
              syncState={syncState}
              onSaveEmployee={handleSaveEmployee}
              onArchiveEmployee={handleArchiveEmployee}
              onSaveRating={handleSaveRating}
              onOpenEmployeeInHistory={handleOpenEmployeeInHistory}
              onOpenEmployeeInCalendar={handleOpenEmployeeInCalendar}
            />
          )}

          {currentTab === 'bonuses' && (
            <BonusesView
              bonuses={bonuses}
              employees={employees}
              pointsRoles={pointsRoles}
              pointsProfiles={pointsProfiles}
              pointsTransactions={pointsTransactions}
              bonusEligibility={bonusEligibility}
              bonusClaims={bonusClaims}
              syncState={syncState}
              onClaimBonusForEmployee={handleClaimBonusForEmployee}
              onTransitionBonusClaim={handleTransitionBonusClaim}
              onUpdateBonusImage={handleUpdateBonusImage}
            />
          )}

          {currentTab === 'points-team' && (
            <PointsTeamView
              employees={employees}
              projects={projects}
              entries={entries}
              pointsRoles={pointsRoles}
              pointsProfiles={pointsProfiles}
              pointsReasons={pointsReasons}
              pointsTransactions={pointsTransactions}
              pointsPeriods={pointsPeriods}
              pointsAudit={pointsAudit}
              syncState={syncState}
              onAddPointsTransaction={handleAddPointsTransaction}
              onReverseTransaction={handleReversePointsTransaction}
              onEnsureMonthlyAllocations={handleEnsureMonthlyAllocations}
              onSyncTimeEarning={handleSyncTimeEarning}
              onClosePeriod={handleClosePointsPeriod}
            />
          )}

          {currentTab === 'points-reasons' && (
            <PointsReasonsView
              reasons={pointsReasons}
              onSaveReasons={handleSavePointsReasons}
            />
          )}

          {currentTab === 'points-settings' && (
            <PointsSettingsView
              roles={pointsRoles}
              profiles={pointsProfiles}
              employees={employees}
              categories={categories}
              eligibleCategoryIds={settings.pointsEligibleCategoryIds || []}
              bonuses={bonuses}
              eligibilityRules={bonusEligibility}
              onSaveRolesAndCategories={handleSavePointsRolesAndCategories}
              onSaveProfiles={handleSavePointsProfiles}
              onSaveEligibility={handleSaveBonusEligibility}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              settings={settings}
              categories={categories}
              actionTypes={actionTypes}
              projects={projects}
              bonuses={bonuses}
              employees={employees}
              phrases={phrases}
              motivationalPhrases={motivationalPhrases}
              syncState={syncState}
              isSyncing={isSyncing}
              onSaveSettings={handleSaveSettings}
              onSaveCategories={handleSaveCategories}
              onSavePhrases={handleSavePhrases}
              onSaveMotivational={handleSaveMotivational}
              onUpdateBonusImage={handleUpdateBonusImage}
              onUpdateEmployeeImage={handleUpdateEmployeeImage}
              onSyncGas={handleSyncGas}
              onTestConnection={handleTestConnection}
              onSetupSpreadsheet={handleSetupSpreadsheet}
              onLoadFromSheet={handleLoadFromSheet}
            />
          )}
        </main>
      </div>
    </div>
  );
}
