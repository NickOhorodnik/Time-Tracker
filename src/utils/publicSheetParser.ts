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
  buildImageDiagnostics,
  fromCanonicalActionTypeRow,
  fromCanonicalBonusRow,
  fromCanonicalCategoryRow,
  fromCanonicalEmployeeRow,
  fromCanonicalProjectRow,
  fromCanonicalTimeEntryRow,
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
  parseCanonicalBoolean,
} from './canonicalSheetsAdapter';
import { initialSettings } from '../mockData';
import { isValidRemoteImageUrl, normalizeDriveImageUrl } from './imageUrlValidator';

export interface PublicSheetTabInfo {
  name: string;
  gid: string;
}

export interface PublicSheetHtmlMeta {
  title: string;
  tabs: PublicSheetTabInfo[];
}

export interface PublicSheetLoadPayload {
  ok: boolean;
  success: boolean;
  code?: string;
  error?: string;
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
  settings?: Partial<AppSettings>;
}

const POINTS_SHEET_NAMES = [
  'Ролі балів',
  'Профілі балів',
  'Причини балів',
  'Операції балів',
  'Періоди балів',
  'Доступність бонусів',
] as const;

export const CANONICAL_PUBLIC_SHEET_NAMES = new Set<string>([
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
  ...POINTS_SHEET_NAMES,
]);

export function isCanonicalOrMonthSheetName(name: string): boolean {
  const trimmed = String(name || '').trim();
  return CANONICAL_PUBLIC_SHEET_NAMES.has(trimmed) || /^\d{4}-\d{2}$/.test(trimmed);
}

export function normalizeCsvHeader(raw: string): string {
  return String(raw || '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

function unescapeJsStringLiteral(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

export function extractHtmlViewMetadata(html: string): PublicSheetHtmlMeta {
  const rawHtml = String(html || '');
  let title = '';
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = decodeHtmlEntities(titleMatch[1].trim())
      .replace(/\s*[-—]\s*Google\s+(?:Sheets|Таблиці)\s*$/i, '')
      .trim();
  }

  const tabs: PublicSheetTabInfo[] = [];
  const seenGid = new Set<string>();
  const addTab = (nameRaw: string, gidRaw: string) => {
    const name = decodeHtmlEntities(unescapeJsStringLiteral(String(nameRaw || ''))).trim();
    const gid = String(gidRaw || '').trim();
    if (!name || !/^\d+$/.test(gid) || seenGid.has(gid)) return;
    seenGid.add(gid);
    tabs.push({ name, gid });
  };

  // Primary pattern: Google Sheets htmlview script pushes items.push({name: "...", ..., gid: "..."})
  const pushPattern = /items\.push\(\s*\{[\s\S]*?name\s*:\s*(["'])((?:\\.|(?!\1).)*)\1[\s\S]*?gid\s*:\s*(["']?)(\d+)\3/g;
  let match: RegExpExecArray | null;
  while ((match = pushPattern.exec(rawHtml)) !== null) {
    addTab(match[2], match[4]);
  }

  // Secondary pattern: reverse property order (gid before name)
  if (tabs.length === 0) {
    const reversePattern = /items\.push\(\s*\{[\s\S]*?gid\s*:\s*(["']?)(\d+)\1[\s\S]*?name\s*:\s*(["'])((?:\\.|(?!\3).)*)\3/g;
    while ((match = reversePattern.exec(rawHtml)) !== null) {
      addTab(match[4], match[2]);
    }
  }

  // Fallback pattern: sheet-button-<gid> anchors inside #sheet-menu
  if (tabs.length === 0) {
    const liPattern = /id=["']sheet-button-(\d+)["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = liPattern.exec(rawHtml)) !== null) {
      addTab(match[2].replace(/<[^>]+>/g, ''), match[1]);
    }
  }

  return { title, tabs };
}

export function parseCsvRows(csvText: string): string[][] {
  const input = String(csvText || '').replace(/^\uFEFF/, '');
  if (!input.trim()) return [];

  const rows: string[][] = [];
  let row: string[] = [];
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

export function csvToNormalizedObjects(csvText: string): Record<string, string>[] {
  const rows = parseCsvRows(csvText);
  if (rows.length <= 1) return [];

  const headers = rows[0].map((h) => normalizeCsvHeader(h));
  const out: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (!values || values.every((v) => !String(v || '').trim())) continue;
    const obj: Record<string, string> = {};
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

export interface GvizQueryResponse {
  status?: string;
  errors?: Array<{ reason?: string; message?: string; detailed_message?: string }>;
  table?: {
    cols?: Array<{ id?: string; label?: string; type?: string }>;
    rows?: Array<{ c?: Array<{ v?: unknown; f?: string | null } | null> }>;
  };
}

function gvizCellToString(cell: { v?: unknown; f?: string | null } | null | undefined): string {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f);
  if (cell.v === undefined || cell.v === null) return '';
  if (typeof cell.v === 'string') {
    const dateMatch = cell.v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (dateMatch) {
      const y = dateMatch[1].padStart(4, '0');
      const m = String(Number(dateMatch[2]) + 1).padStart(2, '0');
      const d = dateMatch[3].padStart(2, '0');
      if (dateMatch[4] !== undefined) {
        const hh = dateMatch[4].padStart(2, '0');
        const mm = dateMatch[5].padStart(2, '0');
        const ss = dateMatch[6].padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
      }
      return `${y}-${m}-${d}`;
    }
    return cell.v;
  }
  return String(cell.v);
}

export function gvizTableToNormalizedObjects(payload: GvizQueryResponse | null | undefined): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const cols = payload?.table?.cols || [];
  const rawRows = payload?.table?.rows || [];
  if (cols.length === 0 && rawRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const colLabels = cols.map((c) => normalizeCsvHeader(c?.label || ''));
  const hasColLabels = colLabels.some(Boolean);

  let headers = colLabels;
  let dataStartIndex = 0;

  if (!hasColLabels && rawRows.length > 0) {
    headers = (rawRows[0]?.c || []).map((cell) => normalizeCsvHeader(gvizCellToString(cell)));
    dataStartIndex = 1;
  }

  const out: Record<string, string>[] = [];
  for (let r = dataStartIndex; r < rawRows.length; r++) {
    const cells = rawRows[r]?.c || [];
    const values = headers.map((_h, idx) => gvizCellToString(cells[idx]));
    if (values.every((v) => !v.trim())) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;
      const cellVal = values[c] || '';
      obj[header] = cellVal;
      const lower = header.toLowerCase();
      if (!(lower in obj)) {
        obj[lower] = cellVal;
      }
    }
    out.push(obj);
  }

  return { headers, rows: out };
}

const GVIZ_TAB_SIGNATURES: Record<string, (lowerHeaders: Set<string>) => boolean> = {
  'Записи': (h) => h.has('segment_id') || (h.has('дата') && h.has('початок_utc')),
  'Категорії': (h) => h.has('колір_hex') || h.has('іконка_lucide') || (h.has('колір') && h.has('назва')),
  'Типи дій': (h) => h.has('назва') && h.has('активна') && !h.has('колір_hex') && !h.has('текст'),
  'Проєкти': (h) => h.has('назва') && h.has('активний') && !h.has('ціна_балів') && !h.has('variant_id'),
  'Бонуси': (h) => h.has('ціна_балів') || h.has('вартість_балів') || (h.has('тип') && h.has('image_asset_id')),
  'Отримані бонуси': (h) => h.has('claim_id') || h.has('дата_запиту_utc'),
  'Фрази': (h) => h.has('текст') || h.has('last_cycle_id'),
  'Мотиваційні фрази': (h) => h.has('template') || h.has('шаблон') || (h.has('active') && h.has('order') && !h.has('asset_id')),
  'Налаштування': (h) => h.has('ключ') && h.has('значення'),
  'Працівники': (h) => h.has('employee_id') && (h.has('name') || h.has("ім'я") || h.has('role')),
  'Оцінки': (h) => h.has('rating_id') || h.has('score') || h.has('rated_at_utc'),
  'Бібліотека зображень': (h) => h.has('asset_id') && (h.has('image_url') || h.has('file_reference') || h.has('display_name') || h.has('folder_path')),
  'Призначення зображень': (h) => h.has('assignment_id') || h.has('slot_key'),
  'Ролі балів': (h) => h.has('role_id') || h.has('monthly_base_points'),
  'Профілі балів': (h) => h.has('points_role') || h.has('monthly_base_override'),
  'Причини балів': (h) => h.has('reason_id') || h.has('default_points'),
  'Операції балів': (h) => h.has('transaction_id') || h.has('points_delta'),
  'Періоди балів': (h) => h.has('period_id') || h.has('base_allocation'),
  'Доступність бонусів': (h) => h.has('eligibility_id') || h.has('price_override'),
};

export function doesGvizTabMatchSchema(tabName: string, headers: string[]): boolean {
  const lowerHeaders = new Set(headers.map((h) => normalizeCsvHeader(h).toLowerCase()).filter(Boolean));
  if (lowerHeaders.size === 0) return false;
  if (/^\d{4}-\d{2}$/.test(tabName)) {
    return GVIZ_TAB_SIGNATURES['Записи'](lowerHeaders);
  }
  const checker = GVIZ_TAB_SIGNATURES[tabName];
  return checker ? checker(lowerHeaders) : false;
}

function resolveRefUrlClient(
  rawRef: string,
  slotKey: string,
  registry: ImageAsset[],
  assignments: ImageAssignment[]
): string {
  const activeRegistryById = new Map<string, ImageAsset>();
  for (const item of registry) {
    if ((item as any).isActive === false) continue;
    if (item.id) activeRegistryById.set(item.id, item);
  }

  const pickUsableUrl = (asset?: ImageAsset): string => {
    if (!asset) return '';
    const candidate = normalizeDriveImageUrl(asset.imageUrl || asset.url || '') || asset.imageUrl || asset.url || '';
    return isValidRemoteImageUrl(candidate) ? candidate : '';
  };

  if (rawRef) {
    const refAsset = activeRegistryById.get(rawRef);
    if (refAsset) {
      const url = pickUsableUrl(refAsset);
      if (url) return url;
    }
    const normalizedDirect = normalizeDriveImageUrl(rawRef) || rawRef;
    if (isValidRemoteImageUrl(normalizedDirect)) {
      return normalizedDirect;
    }
  }

  if (slotKey) {
    const assigned = assignments.find((a) => a.slotKey === slotKey);
    if (assigned) {
      const url = pickUsableUrl(activeRegistryById.get(assigned.assetId));
      if (url) return url;
    }
  }

  return '';
}

export function buildPublicSheetLoadResponse({
  spreadsheetId,
  spreadsheetName,
  sheetsByName,
}: {
  spreadsheetId: string;
  spreadsheetName: string;
  sheetsByName: Record<string, Record<string, string>[]>;
}): PublicSheetLoadPayload {
  const entriesRows = sheetsByName['Записи'];
  if (!entriesRows) {
    return {
      ok: false,
      success: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Канонічний аркуш «Записи» не знайдено в таблиці. Завантаження заблоковано.',
    };
  }

  const entriesById = new Map<string, TimeEntry>();
  const tombstonedIds = new Set<string>();

  const ingestEntryRows = (rows: Record<string, string>[]) => {
    for (const row of rows) {
      const segId = String(row['segment_id'] || row['ID'] || '').trim();
      if (!segId) continue;
      if (String(row['deleted_at_utc'] || '').trim()) {
        tombstonedIds.add(segId);
        entriesById.delete(segId);
        continue;
      }
      if (tombstonedIds.has(segId)) continue;
      const mapped = fromCanonicalTimeEntryRow(row);
      if (mapped && !entriesById.has(mapped.id)) {
        entriesById.set(mapped.id, mapped);
      }
    }
  };

  ingestEntryRows(entriesRows);
  for (const [sheetName, rows] of Object.entries(sheetsByName)) {
    if (/^\d{4}-\d{2}$/.test(sheetName)) {
      ingestEntryRows(rows);
    }
  }

  const imageRegistry = normalizeLoadedImageRegistry(sheetsByName['Бібліотека зображень'] || []);
  const imageAssignments = normalizeLoadedImageAssignments(sheetsByName['Призначення зображень'] || []);
  const imageDiagnostics = buildImageDiagnostics(imageRegistry, imageAssignments);

  const categories = (sheetsByName['Категорії'] || [])
    .map((r) => fromCanonicalCategoryRow(r))
    .filter((c): c is Category => Boolean(c));

  const actionTypes = (sheetsByName['Типи дій'] || [])
    .map((r) => fromCanonicalActionTypeRow(r))
    .filter((a): a is ActionType => Boolean(a));

  const projects = (sheetsByName['Проєкти'] || [])
    .map((r): Project | null => {
      const mapped = fromCanonicalProjectRow(r);
      if (!mapped) return null;
      const rawActive = r['активний'] !== undefined ? r['активний'] : r['Статус'];
      const isActive = parseCanonicalBoolean(rawActive, true);
      return {
        ...mapped,
        status: isActive ? 'active' : 'completed',
      };
    })
    .filter((p): p is Project => Boolean(p));

  const bonusClaims = normalizeLoadedBonusClaims(sheetsByName['Отримані бонуси'] || []);
  const claimedBonusState = new Map<string, { claimed: boolean; fulfilled: boolean }>();
  for (const claim of bonusClaims) {
    if (claim.status !== 'cancelled') {
      claimedBonusState.set(claim.bonusId, {
        claimed: true,
        fulfilled: claim.status === 'fulfilled',
      });
    }
  }

  const bonuses = (sheetsByName['Бонуси'] || [])
    .map((r) => {
      const mapped = fromCanonicalBonusRow(r);
      if (!mapped) return null;
      const rawActive = r['активний'] !== undefined ? r['активний'] : r['Активний'];
      const isActive = parseCanonicalBoolean(rawActive, true);
      const rawImgRef = String(r['image_asset_id'] || r['Зображення'] || '').trim();
      const resolvedUrl = resolveRefUrlClient(
        rawImgRef,
        `images/bonuses/${mapped.id}`,
        imageRegistry,
        imageAssignments
      );
      const claimInfo = claimedBonusState.get(mapped.id);
      return {
        ...mapped,
        isActive,
        imageUrl: resolvedUrl,
        claimed: claimInfo ? claimInfo.claimed : mapped.claimed,
        fulfilled: claimInfo ? claimInfo.fulfilled : mapped.fulfilled,
      };
    })
    .filter((b): b is Bonus => Boolean(b));

  const phrases = normalizeLoadedPhrases(sheetsByName['Фрази'] || []);
  const motivationalPhrases = normalizeLoadedMotivationalPhrases(sheetsByName['Мотиваційні фрази'] || []);

  const employees = (sheetsByName['Працівники'] || [])
    .map((r) => fromCanonicalEmployeeRow(r))
    .filter((e): e is Employee => Boolean(e))
    .map((emp) => ({
      ...emp,
      avatarUrl: resolveRefUrlClient(
        emp.avatarUrl || '',
        `images/team/avatars/${emp.id}`,
        imageRegistry,
        imageAssignments
      ),
      portraitUrl: resolveRefUrlClient(
        emp.portraitUrl || '',
        `images/team/portraits/${emp.id}`,
        imageRegistry,
        imageAssignments
      ),
    }));

  const ratings = normalizeLoadedRatings(sheetsByName['Оцінки'] || []);

  const settingsMap: Record<string, string> = {};
  for (const row of sheetsByName['Налаштування'] || []) {
    const k = String(row['ключ'] || '').trim();
    const v = String(row['значення'] || '').trim();
    if (k) settingsMap[k] = v;
  }

  let eligibleCategoryIds: string[] = [];
  if (settingsMap.pointsEligibleCategoryIds) {
    try {
      const parsed = JSON.parse(settingsMap.pointsEligibleCategoryIds);
      if (Array.isArray(parsed)) {
        eligibleCategoryIds = parsed.map((id) => String(id || '').trim()).filter(Boolean);
      }
    } catch {
      eligibleCategoryIds = settingsMap.pointsEligibleCategoryIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const hydratedStages = hydrateStagesFromImageLibrary(
    initialSettings.stages,
    undefined,
    imageRegistry,
    imageAssignments
  );

  const settings: Partial<AppSettings> = {
    hourlyRate:
      settingsMap.hourlyRate !== undefined && settingsMap.hourlyRate !== ''
        ? Number(settingsMap.hourlyRate)
        : 0,
    targetHours:
      settingsMap.targetHours !== undefined && settingsMap.targetHours !== ''
        ? Number(settingsMap.targetHours)
        : 0,
    progressionMode:
      settingsMap.progressionMode === 'monthly' || settingsMap.progressionMode === 'all_time'
        ? settingsMap.progressionMode
        : 'all_time',
    bubbleDurationMs: Number(settingsMap.bubbleDurationMs) || 5000,
    motivationRotationMinutes: Number(settingsMap.motivationRotationMinutes) || 10,
    minutesPerPoint: Number(settingsMap.minutesPerPoint) || 60,
    imageProgressionEnabled: settingsMap.imageProgressionEnabled !== 'false',
    pointsEligibleCategoryIds: eligibleCategoryIds,
    googleSpreadsheetId: spreadsheetId,
    stages: hydratedStages,
  };

  const missingPointsSheets = POINTS_SHEET_NAMES.filter((name) => !sheetsByName[name]);
  const pointsRoles = normalizeLoadedPointsRoles(sheetsByName['Ролі балів'] || []);
  const pointsProfiles = normalizeLoadedPointsProfiles(sheetsByName['Профілі балів'] || []);
  const pointsReasons = normalizeLoadedPointsReasons(sheetsByName['Причини балів'] || []);
  const pointsTransactions = normalizeLoadedPointsTransactions(sheetsByName['Операції балів'] || []);
  const pointsPeriods = normalizeLoadedPointsPeriods(sheetsByName['Періоди балів'] || []);
  const bonusEligibility = normalizeLoadedBonusEligibility(sheetsByName['Доступність бонусів'] || []);

  return {
    ok: true,
    success: true,
    needsSetup: false,
    spreadsheetId,
    spreadsheetName: spreadsheetName || 'Google Таблиця (перегляд)',
    entries: Array.from(entriesById.values()),
    categories,
    actionTypes,
    projects,
    bonuses,
    bonusClaims,
    phrases,
    motivationalPhrases,
    employees,
    ratings,
    imageRegistry,
    imageAssignments,
    imageDiagnostics,
    pointsRoles,
    pointsProfiles,
    pointsReasons,
    pointsTransactions,
    pointsPeriods,
    bonusEligibility,
    pointsAudit: {
      schemaReady: missingPointsSheets.length === 0,
      missingSheets: [...missingPointsSheets],
      blockedSheets: [],
    },
    settings,
  };
}
