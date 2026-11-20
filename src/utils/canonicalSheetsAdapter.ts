/**
 * Canonical Google Sheets Adapter for Allonsy Time Tracker
 *
 * Implements exact header mappings for each user's copy of the canonical
 * Google Spreadsheet across all 22 verified tabs.
 *
 * Key guarantees:
 * - Exact header matching with no positional fallback.
 * - Idempotent upserts keyed by primary canonical IDs (e.g. segment_id, employee_id, rating_id).
 * - Exact seconds preservation: durationMinutes <-> integer секунд without loss.
 * - Deterministic UTC ISO timestamp composition/decomposition (Europe/Kyiv standard offset).
 * - Soft-delete awareness (deleted_at_utc).
 * - Preserves unmapped columns on updates.
 * - URL image storage isolation: never overwrites drive_file_id or file_reference.
 */

import {
  ActionType,
  AppSettings,
  Bonus,
  BonusClaim,
  BonusClaimStatus,
  BonusEligibilityRule,
  BonusEligibilityTargetType,
  Category,
  CharacterStage,
  Employee,
  EmployeePointsProfile,
  EmployeeRating,
  FOLDER_BY_GROUP,
  GROUP_BY_FOLDER,
  ImageAsset,
  ImageAssignment,
  ImageDiagnosticIssue,
  ImageDiagnostics,
  LogicalImageFolder,
  MotivationalPhrase,
  Phrase,
  PointsEligibleTimeMode,
  PointsOperationType,
  PointsPeriod,
  PointsPeriodStatus,
  PointsReason,
  PointsReasonOperationType,
  PointsRoleConfig,
  PointsRoleId,
  PointsTransaction,
  Project,
  TimeEntry,
} from '../types';
import { isValidRemoteImageUrl, normalizeDriveImageUrl } from './imageUrlValidator';
import { isStaleLocalAssetPath } from './assetResolver';
import { normalizeNullableBoolean, normalizeNullableNumber } from './pointsEngine';

function normalizeKeyLabel(key: string): string {
  return key
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseCanonicalBoolean(raw: unknown, defaultValue = true): boolean {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const normalized = String(raw)
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return defaultValue;
  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'так' ||
    normalized === 'істина' ||
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized === '+'
  ) {
    return true;
  }
  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'ні' ||
    normalized === 'хиба' ||
    normalized === 'no' ||
    normalized === 'n' ||
    normalized === '-'
  ) {
    return false;
  }
  return defaultValue;
}

function pickCanonicalField(row: Record<string, any>, aliases: string[]): any {
  if (!row || typeof row !== 'object') return undefined;
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }
  const lowerMap: Record<string, any> = {};
  for (const existingKey of Object.keys(row)) {
    lowerMap[normalizeKeyLabel(existingKey)] = row[existingKey];
  }
  for (const key of aliases) {
    const k = normalizeKeyLabel(key);
    if (Object.prototype.hasOwnProperty.call(lowerMap, k) && lowerMap[k] !== undefined && lowerMap[k] !== null && lowerMap[k] !== '') {
      return lowerMap[k];
    }
  }
  return undefined;
}

function pickCanonicalBooleanField(row: Record<string, any>, aliases: string[], defaultValue = true): boolean {
  if (!row || typeof row !== 'object') return defaultValue;
  const lowerMap: Record<string, any> = {};
  for (const existingKey of Object.keys(row)) {
    lowerMap[normalizeKeyLabel(existingKey)] = row[existingKey];
  }
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return parseCanonicalBoolean(row[key], defaultValue);
    }
    const k = normalizeKeyLabel(key);
    if (Object.prototype.hasOwnProperty.call(lowerMap, k) && lowerMap[k] !== undefined && lowerMap[k] !== null && lowerMap[k] !== '') {
      return parseCanonicalBoolean(lowerMap[k], defaultValue);
    }
  }
  return defaultValue;
}

/**
 * Verified canonical column contracts for the 22 tabs in the canonical spreadsheet.
 */
export const CANONICAL_TAB_HEADERS = {
  'Записи': [
    'segment_id',
    'session_id',
    'command_id',
    'дата',
    'початок_utc',
    'кінець_utc',
    'секунд',
    'category_id',
    'категорія_назва',
    'action_id',
    'project_id',
    'опис',
    'створено_utc',
    'джерело',
    'month_key',
    'примітка',
    'employee_id',
    'updated_at_utc',
    'deleted_at_utc',
    'change_reason',
  ],
  'Таймер': [
    'owner_key',
    'стан',
    'session_id',
    'session_started_at_utc',
    'segment_started_at_utc',
    'category_id',
    'action_id',
    'project_id',
    'опис',
    'updated_at_utc',
    'revision',
    'last_command_id',
    'employee_id',
    'accumulated_seconds',
  ],
  'Команди': [
    'command_id',
    'дія',
    'session_id',
    'стан_після',
    'дата_utc',
    'результат',
    'employee_id',
    'revision',
  ],
  'Категорії': [
    'id',
    'назва',
    'іконка_lucide',
    'колір_hex',
    'активна',
    'порядок',
    'опис',
  ],
  'Типи дій': [
    'id',
    'назва',
    'активна',
    'порядок',
  ],
  'Проєкти': [
    'id',
    'назва',
    'активний',
    'порядок',
  ],
  'Бонуси': [
    'id',
    'назва',
    'тип',
    'ціна_балів',
    'опис',
    'активний',
    'порядок',
    'image_asset_id',
  ],
  'Отримані бонуси': [
    'claim_id',
    'bonus_id',
    'назва_на_момент_запиту',
    'вартість_балів',
    'дата_запиту_utc',
    'статус',
    'дата_отримання_utc',
    'коментар',
    'command_id',
    'updated_at_utc',
    'employee_id',
    'quantity',
    'unit_price_points',
    'approved_by_employee_id',
    'approved_at_utc',
    'points_transaction_id',
    'eligibility_id',
  ],
  'Фрази': [
    'id',
    'текст',
    'активна',
    'порядок',
    'last_cycle_id',
    'last_shown_at_utc',
    'примітка',
  ],
  'Зображення': [
    'variant_id',
    'назва',
    'drive_file_id',
    'mime_type',
    'активний',
    'порядок',
    'оновлено_utc',
  ],
  'Налаштування': [
    'ключ',
    'значення',
    'тип',
    'опис',
  ],
  'Працівники': [
    'employee_id',
    'name',
    'role',
    'status',
    'avatar_asset_id',
    'portrait_asset_id',
    'notes',
    'created_at_utc',
    'updated_at_utc',
    'archived_at_utc',
  ],
  'Оцінки': [
    'rating_id',
    'employee_id',
    'score',
    'comment',
    'rated_at_utc',
    'created_at_utc',
    'updated_at_utc',
    'deleted_at_utc',
    'source',
  ],
  'Бібліотека зображень': [
    'asset_id',
    'filename',
    'display_name',
    'folder_path',
    'mime_type',
    'storage_status',
    'drive_file_id',
    'file_reference',
    'size_bytes',
    'sha256',
    'updated_at_utc',
    'is_active',
    'notes',
  ],
  'Призначення зображень': [
    'assignment_id',
    'target_type',
    'target_id',
    'slot_key',
    'asset_id',
    'inheritance_mode',
    'updated_at_utc',
    'active',
  ],
  'Папки зображень': [
    'folder_key',
    'parent_key',
    'logical_path',
    'display_name',
    'drive_folder_id',
    'active',
  ],
  'Мотиваційні фрази': [
    'id',
    'template',
    'active',
    'sort_order',
    'updated_at_utc',
    'notes',
  ],
  'Журнал змін': [
    'audit_id',
    'entity_type',
    'entity_id',
    'action',
    'before_json',
    'after_json',
    'reason',
    'timestamp_utc',
    'command_id',
  ],
  'Зведення за працівниками': [
    'employee_id',
    'name',
    'tracked_hours',
    'avg_rating',
    'last_rating',
    'rating_count',
    'opportunity_cost_usd',
  ],
  'Зведення': [
    'ПОКАЗНИК',
    'ГОДИН',
    'Потенційна вартість',
    'USD',
  ],
  'Інструкція': [
    'РОЗДІЛ',
    'ПРИЗНАЧЕННЯ',
  ],
  'Ролі балів': [
    'role_id',
    'назва',
    'опис',
    'monthly_base_points',
    'time_earning_enabled',
    'minutes_per_point',
    'eligible_time_mode',
    'positive_grace_months',
    'negative_carryover',
    'active',
    'updated_at_utc',
  ],
  'Профілі балів': [
    'employee_id',
    'points_role',
    'monthly_base_override',
    'time_earning_override',
    'minutes_per_point_override',
    'points_enabled',
    'updated_at_utc',
  ],
  'Причини балів': [
    'reason_id',
    'operation_type',
    'назва',
    'default_points',
    'опис',
    'allowed_roles',
    'active',
    'sort_order',
    'updated_at_utc',
  ],
  'Операції балів': [
    'transaction_id',
    'employee_id',
    'operation_type',
    'points_delta',
    'reason_id',
    'reason_snapshot',
    'comment',
    'project_id',
    'segment_id',
    'related_employee_id',
    'occurred_at_utc',
    'created_at_utc',
    'actor_employee_id',
    'command_id',
    'reversal_of_transaction_id',
    'month_key',
    'expires_at_utc',
  ],
  'Періоди балів': [
    'period_id',
    'employee_id',
    'month_key',
    'base_allocation',
    'debt_carried_in',
    'earned_points',
    'deducted_points',
    'spent_points',
    'expired_points',
    'status',
    'closed_at_utc',
    'command_id',
  ],
  'Доступність бонусів': [
    'eligibility_id',
    'bonus_id',
    'target_type',
    'target_id',
    'price_override',
    'active',
    'requires_approval',
    'max_quantity',
    'updated_at_utc',
  ],
} as const;

export type CanonicalTabName = keyof typeof CANONICAL_TAB_HEADERS;

/**
 * Validates a sheet's headers against the expected canonical headers.
 * Detects duplicates, missing required headers, and unknown columns.
 */
export interface HeaderValidationResult {
  valid: boolean;
  missingRequired: string[];
  duplicateHeaders: string[];
  allHeaders: string[];
  headerIndexMap: Record<string, number>;
  errorMessage?: string;
}

export function validateHeaders(
  actualHeaders: string[],
  requiredHeaders: readonly string[],
  sheetName: string
): HeaderValidationResult {
  const trimmed = actualHeaders.map((h) => (h ? h.toString().trim() : ''));
  const headerIndexMap: Record<string, number> = {};
  const duplicateHeaders: string[] = [];

  for (let i = 0; i < trimmed.length; i++) {
    const h = trimmed[i];
    if (!h) continue;
    const lower = h.toLowerCase();
    if (headerIndexMap.hasOwnProperty(lower)) {
      duplicateHeaders.push(h);
    } else {
      headerIndexMap[lower] = i;
    }
  }

  const missingRequired: string[] = [];
  for (const req of requiredHeaders) {
    if (!headerIndexMap.hasOwnProperty(req.toLowerCase())) {
      missingRequired.push(req);
    }
  }

  if (duplicateHeaders.length > 0) {
    return {
      valid: false,
      missingRequired,
      duplicateHeaders,
      allHeaders: trimmed,
      headerIndexMap,
      errorMessage: `SCHEMA_COMPATIBILITY_BLOCKED: Аркуш «${sheetName}» містить дублікати заголовків: ${duplicateHeaders.join(', ')}.`,
    };
  }

  if (missingRequired.length > 0) {
    return {
      valid: false,
      missingRequired,
      duplicateHeaders,
      allHeaders: trimmed,
      headerIndexMap,
      errorMessage: `SCHEMA_COMPATIBILITY_BLOCKED: Аркуш «${sheetName}» не містить обов'язкових канонічних заголовків: ${missingRequired.join(', ')}.`,
    };
  }

  return {
    valid: true,
    missingRequired: [],
    duplicateHeaders: [],
    allHeaders: trimmed,
    headerIndexMap,
  };
}

/* ============================================================================
 * Time and Date Conversion Utilities (Europe/Kyiv UTC+2 / UTC+3 awareness)
 * ========================================================================== */

/**
 * Composes a local date (YYYY-MM-DD) and local time (HH:MM or HH:MM:SS) into a UTC ISO string.
 * Defaults to Europe/Kyiv offset (+02:00 in winter, +03:00 in DST).
 */
export function composeUtcIso(dateStr?: string, timeStr?: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    return new Date().toISOString();
  }
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr.trim())
    ? timeStr.trim().length === 5 ? `${timeStr.trim()}:00` : timeStr.trim()
    : '12:00:00';

  // Determine standard Ukrainian offset for the date
  // Standard time: last Sunday of Oct to last Sunday of March is UTC+2, else UTC+3
  const [yearStr, monthStr] = cleanDate.split('-');
  const month = parseInt(monthStr, 10);
  const isWinter = month >= 11 || month <= 2; // Nov, Dec, Jan, Feb are definitely UTC+2
  const offset = isWinter ? '+02:00' : '+03:00';

  try {
    const parsed = new Date(`${cleanDate}T${cleanTime}${offset}`);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch (e) {}

  return new Date().toISOString();
}

/**
 * Decomposes a UTC ISO string into local Kyiv date (YYYY-MM-DD) and time (HH:MM).
 */
export function decomposeUtcIso(isoStr?: string): { date: string; time: string } {
  if (!isoStr) {
    const now = new Date();
    return {
      date: now.toISOString().split('T')[0],
      time: '12:00',
    };
  }

  try {
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) {
      // Use Europe/Kyiv formatting
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);

      const y = parts.find((p) => p.type === 'year')?.value || '2026';
      const m = parts.find((p) => p.type === 'month')?.value || '11';
      const day = parts.find((p) => p.type === 'day')?.value || '01';
      const h = parts.find((p) => p.type === 'hour')?.value || '12';
      const min = parts.find((p) => p.type === 'minute')?.value || '00';

      return {
        date: `${y}-${m}-${day}`,
        time: `${h}:${min}`,
      };
    }
  } catch (e) {}

  // Fallback to basic string parsing if Intl fails
  const datePart = isoStr.split('T')[0] || '2026-11-01';
  const timePart = (isoStr.split('T')[1] || '').substring(0, 5) || '12:00';
  return { date: datePart, time: timePart };
}

/**
 * Converts duration minutes to integer seconds without loss.
 * Prefers exact elapsedSeconds if present.
 */
export function durationToSeconds(durationMinutes: number, elapsedSeconds?: number): number {
  if (typeof elapsedSeconds === 'number' && elapsedSeconds > 0) {
    return Math.round(elapsedSeconds);
  }
  return Math.round(Math.max(0, durationMinutes) * 60);
}

/**
 * Converts integer seconds back to duration minutes (rounded).
 */
export function secondsToMinutes(seconds: number): number {
  return Math.round(Math.max(0, seconds) / 60);
}

/* ============================================================================
 * Bi-directional Mappers for Core Tracker Entities
 * ========================================================================== */

export interface CanonicalTimeEntryRow {
  segment_id: string;
  session_id: string;
  command_id: string;
  дата: string;
  початок_utc: string;
  кінець_utc: string;
  секунд: number;
  category_id: string;
  категорія_назва: string;
  action_id: string;
  project_id: string;
  опис: string;
  створено_utc: string;
  джерело: string;
  month_key: string;
  примітка: string;
  employee_id: string;
  updated_at_utc: string;
  deleted_at_utc: string;
  change_reason: string;
}

export function toCanonicalTimeEntryRow(
  entry: TimeEntry,
  categoryName: string = ''
): CanonicalTimeEntryRow {
  const segmentId = entry.id;
  const sessionId = (entry as any).sessionId || segmentId;
  const commandId = (entry as any).commandId || `cmd-${segmentId}`;
  const dateStr = entry.date || new Date().toISOString().split('T')[0];
  const startUtc = (entry as any).startedAtUtc || composeUtcIso(dateStr, entry.startTime);
  const endUtc = (entry as any).endedAtUtc || composeUtcIso(dateStr, entry.endTime);
  const seconds = durationToSeconds(entry.durationMinutes, (entry as any).elapsedSeconds);
  const monthKey = (entry as any).monthKey || dateStr.substring(0, 7) || '2026-11';
  const createdAtUtc = (entry as any).createdAtUtc || new Date().toISOString();
  const source = entry.isManual ? 'manual' : 'timer';
  const employeeId = entry.employeeId ? entry.employeeId.trim() : '';

  return {
    segment_id: segmentId,
    session_id: sessionId,
    command_id: commandId,
    дата: dateStr,
    початок_utc: startUtc,
    кінець_utc: endUtc,
    секунд: seconds,
    category_id: entry.categoryId || '',
    категорія_назва: categoryName || '',
    action_id: entry.actionTypeId || '',
    project_id: entry.projectId || '',
    опис: entry.description || '',
    створено_utc: createdAtUtc,
    джерело: source,
    month_key: monthKey,
    примітка: (entry as any).notes || '',
    employee_id: employeeId,
    updated_at_utc: new Date().toISOString(),
    deleted_at_utc: (entry as any).deletedAtUtc || '',
    change_reason: (entry as any).changeReason || '',
  };
}

export function fromCanonicalTimeEntryRow(row: Record<string, any>): TimeEntry | null {
  const segmentId = String(row['segment_id'] || row['ID'] || '').trim();
  if (!segmentId) return null;

  // Check if soft-deleted
  const deletedAt = String(row['deleted_at_utc'] || '').trim();
  if (deletedAt) return null; // Exclude deleted entries

  const rawSeconds = Number(row['секунд']);
  const seconds = !isNaN(rawSeconds) && rawSeconds >= 0 ? rawSeconds : 0;
  const durationMinutes = secondsToMinutes(seconds);

  const startUtc = String(row['початок_utc'] || '');
  const endUtc = String(row['кінець_utc'] || '');
  const decomposedStart = startUtc ? decomposeUtcIso(startUtc) : { date: '', time: '' };
  const decomposedEnd = endUtc ? decomposeUtcIso(endUtc) : { date: '', time: '' };

  const dateVal = String(row['дата'] || decomposedStart.date || '').split('T')[0];
  const startTime = decomposedStart.time || String(row['Час початку'] || '10:00');
  const endTime = decomposedEnd.time || String(row['Час завершення'] || '11:00');

  const sourceVal = String(row['джерело'] || row['Тип введення'] || '').toLowerCase();
  const isManual = sourceVal === 'manual' || sourceVal.includes('ручн');

  const entry: TimeEntry = {
    id: segmentId,
    date: dateVal,
    startTime: startTime,
    endTime: endTime,
    durationMinutes: durationMinutes,
    categoryId: String(row['category_id'] || row['Категорія ID'] || '').trim(),
    actionTypeId: String(row['action_id'] || row['Тип дії ID'] || '').trim(),
    projectId: String(row['project_id'] || row['Проєкт ID'] || '').trim(),
    employeeId: String(row['employee_id'] || row['Співробітник ID'] || '').trim() || undefined,
    relatedEmployeeId: String(row['related_employee_id'] || '').trim() || undefined,
    description: String(row['опис'] || row['Опис'] || '').trim(),
    isManual: isManual,
    elapsedSeconds: seconds,
  };

  // Attach canonical metadata onto entry for lossless round-trips
  (entry as any).sessionId = String(row['session_id'] || segmentId).trim();
  (entry as any).commandId = String(row['command_id'] || `cmd-${segmentId}`).trim();
  (entry as any).startedAtUtc = startUtc;
  (entry as any).endedAtUtc = endUtc;
  (entry as any).elapsedSeconds = seconds;
  (entry as any).categoryName = String(row['категорія_назва'] || '').trim();
  (entry as any).createdAtUtc = String(row['створено_utc'] || '').trim();
  (entry as any).monthKey = String(row['month_key'] || (dateVal ? dateVal.substring(0, 7) : '')).trim();
  (entry as any).notes = String(row['примітка'] || '').trim();

  return entry;
}

/**
 * Recomputes canonical timestamps, elapsedSeconds, monthKey, and categoryName
 * whenever an existing TimeEntry is edited in CalendarView or HistoryView so
 * Google Sheets writes exact updated fields rather than stale cached metadata.
 */
export function prepareUpdatedTimeEntry(
  updatedEntry: TimeEntry,
  previousEntry?: TimeEntry | null,
  categories: Category[] = []
): TimeEntry {
  const cleanDate = (updatedEntry.date || new Date().toISOString().split('T')[0]).trim();
  const cleanStart = (updatedEntry.startTime || '10:00').trim();
  const cleanEnd = (updatedEntry.endTime || '11:00').trim();
  const normalizedMinutes = Math.max(1, Math.round(Number(updatedEntry.durationMinutes) || 1));

  const timeOrDateChanged =
    !previousEntry ||
    previousEntry.date !== cleanDate ||
    previousEntry.startTime !== cleanStart ||
    previousEntry.endTime !== cleanEnd;

  const durationChanged =
    !previousEntry ||
    previousEntry.durationMinutes !== normalizedMinutes ||
    updatedEntry.elapsedSeconds !== previousEntry.elapsedSeconds;

  const prevElapsed = Number(updatedEntry.elapsedSeconds);
  const nextElapsedSeconds = durationChanged
    ? Math.max(60, normalizedMinutes * 60)
    : !isNaN(prevElapsed) && prevElapsed > 0
    ? Math.round(prevElapsed)
    : normalizedMinutes * 60;

  const categoryName =
    categories.find((c) => c.id === updatedEntry.categoryId)?.name ||
    (updatedEntry as any).categoryName ||
    '';

  const result: TimeEntry = {
    ...updatedEntry,
    date: cleanDate,
    startTime: cleanStart,
    endTime: cleanEnd,
    durationMinutes: normalizedMinutes,
    elapsedSeconds: nextElapsedSeconds,
  };

  const prevStartUtc = (updatedEntry as any).startedAtUtc;
  const prevEndUtc = (updatedEntry as any).endedAtUtc;
  (result as any).startedAtUtc =
    timeOrDateChanged || !prevStartUtc ? composeUtcIso(cleanDate, cleanStart) : prevStartUtc;
  (result as any).endedAtUtc =
    timeOrDateChanged || !prevEndUtc ? composeUtcIso(cleanDate, cleanEnd) : prevEndUtc;
  (result as any).categoryName = categoryName;
  (result as any).monthKey = cleanDate ? cleanDate.substring(0, 7) : '';
  (result as any).updatedAtUtc = new Date().toISOString();

  return result;
}

export interface CanonicalEmployeeRow {
  employee_id: string;
  name: string;
  role: string;
  status: string;
  avatar_asset_id: string;
  portrait_asset_id: string;
  notes: string;
  created_at_utc: string;
  updated_at_utc: string;
  archived_at_utc: string;
}

export function toCanonicalEmployeeRow(employee: Employee): CanonicalEmployeeRow {
  const isArchived = employee.status === 'archived';
  const nowIso = new Date().toISOString();
  return {
    employee_id: employee.id.trim(),
    name: employee.name.trim(),
    role: (employee.role || '').trim(),
    status: isArchived ? 'archived' : 'active',
    avatar_asset_id: (employee.avatarUrl || '').trim(),
    portrait_asset_id: (employee.portraitUrl || '').trim(),
    notes: (employee.notes || '').trim(),
    created_at_utc: employee.createdAt || nowIso,
    updated_at_utc: nowIso,
    archived_at_utc: isArchived ? (employee.updatedAt || nowIso) : '',
  };
}

export function fromCanonicalEmployeeRow(row: Record<string, any>): Employee | null {
  const empId = String(row['employee_id'] || row['ID'] || '').trim();
  const name = String(row['name'] || row["Ім'я"] || '').trim();
  if (!empId || !name) return null;

  const rawStatus = String(row['status'] || row['Статус'] || '').toLowerCase();
  const status = rawStatus === 'archived' ? 'archived' : 'active';

  return {
    id: empId,
    name: name,
    role: String(row['role'] || row['Посада'] || '').trim(),
    status: status,
    avatarUrl: String(row['avatar_asset_id'] || row['Аватар'] || '').trim(),
    portraitUrl: String(row['portrait_asset_id'] || row['Портрет'] || '').trim(),
    notes: String(row['notes'] || row['Нотатки'] || '').trim(),
    createdAt: String(row['created_at_utc'] || row['Створено UTC'] || '').trim() || new Date().toISOString(),
    updatedAt: String(row['updated_at_utc'] || row['Оновлено UTC'] || '').trim() || new Date().toISOString(),
    isDemo: false,
  };
}

export interface CanonicalRatingRow {
  rating_id: string;
  employee_id: string;
  score: number;
  comment: string;
  rated_at_utc: string;
  created_at_utc: string;
  updated_at_utc: string;
  deleted_at_utc: string;
  source: string;
}

export function toCanonicalRatingRow(rating: EmployeeRating): CanonicalRatingRow {
  const nowIso = new Date().toISOString();
  const ratedAtUtc = (rating as any).ratedAtUtc || composeUtcIso(rating.date, rating.time);
  return {
    rating_id: rating.id.trim(),
    employee_id: rating.employeeId.trim(),
    score: rating.score,
    comment: (rating.comment || '').trim(),
    rated_at_utc: ratedAtUtc,
    created_at_utc: rating.createdAt || nowIso,
    updated_at_utc: nowIso,
    deleted_at_utc: (rating as any).deletedAtUtc || '',
    source: (rating as any).source || 'allonsy_ui',
  };
}

export function fromCanonicalRatingRow(row: Record<string, any>): EmployeeRating | null {
  const ratingId = String(pickCanonicalField(row, ['id', 'rating_id', 'ID']) || '').trim();
  const employeeId = String(pickCanonicalField(row, ['employeeId', 'employee_id', 'Співробітник ID']) || '').trim();
  if (!ratingId || !employeeId) return null;

  const deletedAt = String(pickCanonicalField(row, ['deleted_at_utc', 'deletedAtUtc']) || '').trim();
  const recordStatus = String(pickCanonicalField(row, ['record_status']) || '').trim().toLowerCase();
  if (deletedAt || recordStatus === 'deleted' || recordStatus === 'archived') return null;

  const rawScore = Number(pickCanonicalField(row, ['score', 'Оцінка']));
  const scoreNum = Math.min(5, Math.max(1, Math.round(isNaN(rawScore) ? 3 : rawScore))) as 1 | 2 | 3 | 4 | 5;
  const ratedAtUtc = String(pickCanonicalField(row, ['ratedAtUtc', 'rated_at_utc']) || '').trim();
  const decomposed = ratedAtUtc ? decomposeUtcIso(ratedAtUtc) : { date: '', time: '' };

  const explicitDate = String(pickCanonicalField(row, ['date', 'rating_date', 'Дата оцінки', 'дата']) || '').trim().split('T')[0];
  const explicitTime = String(pickCanonicalField(row, ['time', 'rating_time', 'Час оцінки', 'час']) || '').trim();
  const createdAt = String(pickCanonicalField(row, ['createdAt', 'created_at_utc', 'Створено UTC']) || '').trim();
  const updatedAt = String(pickCanonicalField(row, ['updatedAt', 'updated_at_utc', 'Оновлено UTC']) || '').trim();
  const fallbackDecomposed = !decomposed.date && createdAt ? decomposeUtcIso(createdAt) : { date: '', time: '' };

  const metaByScore: Record<number, { emoji: string; sentiment: 'negative' | 'neutral' | 'positive'; label: string }> = {
    1: { emoji: '😞', sentiment: 'negative', label: 'Негативно' },
    2: { emoji: '😕', sentiment: 'negative', label: 'Негативно' },
    3: { emoji: '😐', sentiment: 'neutral', label: 'Нейтрально' },
    4: { emoji: '🙂', sentiment: 'positive', label: 'Позитивно' },
    5: { emoji: '🤩', sentiment: 'positive', label: 'Позитивно' },
  };

  const meta = metaByScore[scoreNum] || metaByScore[3];
  const date = explicitDate || decomposed.date || fallbackDecomposed.date || new Date().toISOString().split('T')[0];
  const time = explicitTime || decomposed.time || fallbackDecomposed.time || '12:00';

  const rating: EmployeeRating = {
    id: ratingId,
    employeeId: employeeId,
    score: scoreNum,
    emoji: String(pickCanonicalField(row, ['emoji', 'Емодзі']) || meta.emoji),
    sentiment: meta.sentiment,
    label: String(pickCanonicalField(row, ['label', 'Мітка']) || meta.label),
    comment: String(pickCanonicalField(row, ['comment', 'Коментар']) || '').trim() || undefined,
    date,
    time,
    createdAt: createdAt || ratedAtUtc || new Date().toISOString(),
    updatedAt: updatedAt || createdAt || ratedAtUtc || new Date().toISOString(),
    isDemo: false,
  };

  if (ratedAtUtc) {
    (rating as any).ratedAtUtc = ratedAtUtc;
  }
  return rating;
}

export function normalizeLoadedRatings(rows: unknown): EmployeeRating[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, EmployeeRating>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const mapped = fromCanonicalRatingRow(raw as Record<string, any>);
    if (mapped) {
      byId.set(mapped.id, mapped);
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ka = `${a.date || ''}T${a.time || '00:00'}|${a.createdAt || ''}`;
    const kb = `${b.date || ''}T${b.time || '00:00'}|${b.createdAt || ''}`;
    return kb.localeCompare(ka);
  });
}

export function toCanonicalCategoryRow(cat: Category): Record<string, any> {
  return {
    id: cat.id.trim(),
    назва: cat.name.trim(),
    іконка_lucide: (cat.icon || '').trim(),
    колір_hex: (cat.color || '#f97316').trim(),
    активна: true,
    порядок: 1,
    опис: '',
  };
}

export function fromCanonicalCategoryRow(row: Record<string, any>): Category | null {
  const id = String(row['id'] || row['ID'] || '').trim();
  const name = String(row['назва'] || row['Назва'] || '').trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    color: String(row['колір_hex'] || row['Колір'] || '#f97316').trim(),
    icon: String(row['іконка_lucide'] || row['Іконка'] || '').trim() || undefined,
  };
}

export function toCanonicalActionTypeRow(action: ActionType): Record<string, any> {
  return {
    id: action.id.trim(),
    назва: action.name.trim(),
    активна: true,
    порядок: 1,
  };
}

export function fromCanonicalActionTypeRow(row: Record<string, any>): ActionType | null {
  const id = String(row['id'] || row['ID'] || '').trim();
  const name = String(row['назва'] || row['Назва'] || '').trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    color: '#f97316',
  };
}

export function toCanonicalProjectRow(project: Project): Record<string, any> {
  return {
    id: project.id.trim(),
    назва: project.name.trim(),
    активний: project.status === 'active',
    порядок: 1,
  };
}

export function fromCanonicalProjectRow(row: Record<string, any>): Project | null {
  const id = String(row['id'] || row['ID'] || '').trim();
  const name = String(row['назва'] || row['Назва'] || '').trim();
  if (!id || !name) return null;
  const rawActive = row['активний'] !== undefined ? row['активний'] : row['Статус'];
  const isActive = rawActive === true || rawActive === 'true' || rawActive === 1 || String(rawActive).toLowerCase() === 'active';
  return {
    id,
    name,
    client: String(row['Клієнт'] || '').trim(),
    status: isActive ? 'active' : 'completed',
    color: '#f97316',
  };
}

export function toCanonicalBonusRow(bonus: Bonus): Record<string, any> {
  return {
    id: bonus.id.trim(),
    назва: bonus.name.trim(),
    тип: bonus.rewardType || 'custom',
    ціна_балів: Math.max(0, Math.round(bonus.requiredPoints || 0)),
    опис: (bonus.description || '').trim(),
    активний: bonus.isActive !== false,
    порядок: 1,
    image_asset_id: (bonus as any).imageAssetId || (bonus.imageUrl && !bonus.imageUrl.startsWith('http') ? bonus.imageUrl : ''),
  };
}

export function fromCanonicalBonusRow(row: Record<string, any>): Bonus | null {
  const id = String(row['id'] || row['ID'] || '').trim();
  const name = String(row['назва'] || row['Назва'] || '').trim();
  if (!id || !name) return null;
  const rawActive = row['активний'] !== undefined ? row['активний'] : row['Активний'];
  const isActive = rawActive === true || rawActive === 'true' || rawActive === 1 || rawActive === 'TRUE';
  const points = Math.max(0, Math.round(Number(row['ціна_балів'] || row['Потрібно балів']) || 0));

  const bonus: Bonus = {
    id,
    name,
    description: String(row['опис'] || row['Опис'] || '').trim(),
    rewardType: (String(row['тип'] || row['Тип'] || 'custom').trim() as any) || 'custom',
    requiredPoints: points,
    isActive,
    imageUrl: String(row['image_asset_id'] || row['Зображення'] || '').trim(),
    claimed: Boolean(row['Зажадано']),
    fulfilled: Boolean(row['Виконано']),
  };
  return bonus;
}

export function toCanonicalPhraseRow(phrase: Phrase): Record<string, any> {
  return {
    id: phrase.id.trim(),
    текст: phrase.text.trim(),
    активна: phrase.isActive !== false,
    порядок: phrase.order || 1,
    last_cycle_id: '',
    last_shown_at_utc: '',
    примітка: '',
  };
}

export function fromCanonicalPhraseRow(row: Record<string, any>, fallbackIndex?: number): Phrase | null {
  const rawId = String(pickCanonicalField(row, ['id', 'ID', 'phrase_id', 'код']) || '').trim();
  const text = String(pickCanonicalField(row, ['текст', 'Текст', 'фраза', 'Фраза', 'text', 'повідомлення']) || '').trim();
  const id = rawId || (text && fallbackIndex !== undefined ? `ph-${fallbackIndex + 1}` : '');
  if (!id || !text) return null;
  const isActive = pickCanonicalBooleanField(row, ['isActive', 'активна', 'Активна', 'активний', 'active', 'is_active'], true);
  const rawOrder = Number(pickCanonicalField(row, ['order', 'порядок', 'Порядок', 'sort_order']));
  return {
    id,
    text,
    isActive,
    order: !isNaN(rawOrder) && rawOrder > 0 ? rawOrder : (fallbackIndex !== undefined ? fallbackIndex + 1 : 1),
  };
}

export function toCanonicalMotivationalRow(mot: MotivationalPhrase): Record<string, any> {
  return {
    id: mot.id.trim(),
    template: mot.template.trim(),
    active: mot.isActive !== false,
    sort_order: mot.order || 1,
    updated_at_utc: new Date().toISOString(),
    notes: '',
  };
}

export function fromCanonicalMotivationalRow(row: Record<string, any>, fallbackIndex?: number): MotivationalPhrase | null {
  const rawId = String(pickCanonicalField(row, ['id', 'ID', 'template_id', 'код']) || '').trim();
  const template = String(
    pickCanonicalField(row, ['template', 'Шаблон', 'шаблон', 'текст', 'Текст', 'фраза', 'text', 'повідомлення']) || ''
  ).trim();
  const id = rawId || (template && fallbackIndex !== undefined ? `mot-${fallbackIndex + 1}` : '');
  if (!id || !template) return null;
  const isActive = pickCanonicalBooleanField(row, ['isActive', 'active', 'Активна', 'активна', 'активний', 'is_active'], true);
  const rawOrder = Number(pickCanonicalField(row, ['order', 'sort_order', 'Порядок', 'порядок']));
  return {
    id,
    template,
    isActive,
    order: !isNaN(rawOrder) && rawOrder > 0 ? rawOrder : (fallbackIndex !== undefined ? fallbackIndex + 1 : 1),
  };
}

export function normalizeLoadedPhrases(rows: unknown): Phrase[] {
  if (!Array.isArray(rows)) return [];
  const normalized: Phrase[] = [];
  rows.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const mapped = fromCanonicalPhraseRow(raw as Record<string, any>, idx);
    if (mapped) {
      normalized.push({
        ...mapped,
        order: mapped.order || idx + 1,
      });
    }
  });
  return normalized.sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function normalizeLoadedMotivationalPhrases(rows: unknown): MotivationalPhrase[] {
  if (!Array.isArray(rows)) return [];
  const normalized: MotivationalPhrase[] = [];
  rows.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const mapped = fromCanonicalMotivationalRow(raw as Record<string, any>, idx);
    if (mapped) {
      normalized.push({
        ...mapped,
        order: mapped.order || idx + 1,
      });
    }
  });
  return normalized.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function resolveAssetRemoteUrlClient(explicitUrl: string, fileRef: string, driveFileId: string): {
  url: string;
  isRemote: boolean;
  diagnosticReason?: 'missing_url' | 'invalid_url';
  rawRef?: string;
} {
  const candidates = [explicitUrl, fileRef];
  for (const rawCand of candidates) {
    const cand = (rawCand || '').trim();
    if (!cand || cand === '[локальне зображення]' || isStaleLocalAssetPath(cand)) continue;
    const normalized = normalizeDriveImageUrl(cand);
    if (isValidRemoteImageUrl(normalized)) {
      return { url: normalized, isRemote: true, rawRef: cand };
    }
    if (normalized.startsWith('data:image/') || normalized.startsWith('blob:')) {
      return { url: normalized, isRemote: false, rawRef: cand };
    }
  }

  if (driveFileId.trim()) {
    const driveUrl = normalizeDriveImageUrl('', driveFileId.trim());
    if (isValidRemoteImageUrl(driveUrl)) {
      return { url: driveUrl, isRemote: true, rawRef: driveFileId.trim() };
    }
  }

  const nonEmptyRaw = [explicitUrl, fileRef, driveFileId].map((s) => (s || '').trim()).find(Boolean) || '';
  if (!nonEmptyRaw || nonEmptyRaw === '[локальне зображення]') {
    return { url: nonEmptyRaw, isRemote: false, diagnosticReason: 'missing_url', rawRef: nonEmptyRaw };
  }
  return { url: nonEmptyRaw, isRemote: false, diagnosticReason: 'invalid_url', rawRef: nonEmptyRaw };
}

export function fromCanonicalImageAssetRow(row: Record<string, any>): ImageAsset | null {
  const assetId = String(pickCanonicalField(row, ['id', 'asset_id', 'variant_id', 'код']) || '').trim();
  if (!assetId) return null;

  const rawFolder = String(
    pickCanonicalField(row, ['folder', 'folder_path', 'папка']) || 'images/character/primary'
  ).trim() as LogicalImageFolder;
  const folder = GROUP_BY_FOLDER[rawFolder] ? rawFolder : 'images/character/primary';
  const group = GROUP_BY_FOLDER[folder] || 'character_primary';

  const driveFileId = String(pickCanonicalField(row, ['drive_file_id', 'driveFileId', 'drive_id']) || '').trim();
  const fileRef = String(pickCanonicalField(row, ['file_reference', 'fileReference', 'file_ref', 'cloudinary_url', 'ref']) || '').trim();
  const explicitUrl = String(pickCanonicalField(row, ['image_url', 'imageUrl', 'url']) || '').trim();
  const resolved = resolveAssetRemoteUrlClient(explicitUrl, fileRef, driveFileId);
  const displayName = String(
    pickCanonicalField(row, ['name', 'display_name', 'назва', 'filename', 'file_name']) || assetId
  ).trim();
  const updatedAt = String(
    pickCanonicalField(row, ['updatedAt', 'updated_at_utc', 'updated_at', 'оновлено_utc', 'createdAt']) || ''
  ).trim();

  const isActive = pickCanonicalBooleanField(row, ['isActive', 'is_active', 'активний', 'активна', 'active'], true);
  const isRemote = resolved.isRemote;
  const usableUrl = resolved.url;

  const asset: ImageAsset & { isActive?: boolean; storageStatus?: string; statusMessage?: string } = {
    id: assetId,
    name: displayName,
    group,
    folder: FOLDER_BY_GROUP[group],
    url: usableUrl,
    imageUrl: isRemote ? usableUrl : undefined,
    source: isRemote ? 'external_url' : 'builtin',
    storageType: isRemote ? 'external_url' : 'bundled',
    storageStatus: String(pickCanonicalField(row, ['storageStatus', 'storage_status', 'status']) || '').trim() || undefined,
    createdAt: updatedAt || undefined,
    updatedAt: updatedAt || undefined,
    persistenceStatus: 'saved_to_sheets',
    statusMessage: !isRemote && isActive
      ? (resolved.diagnosticReason === 'missing_url' ? 'Відсутній URL Cloudinary / HTTPS' : 'Некоректний формат URL')
      : undefined,
    isActive,
  };
  return asset;
}

export function normalizeLoadedImageRegistry(rows: unknown): ImageAsset[] {
  if (!Array.isArray(rows)) return [];
  const result: ImageAsset[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const mapped = fromCanonicalImageAssetRow(raw as Record<string, any>);
    if (mapped) result.push(mapped);
  }
  return result;
}

export function toCanonicalImageAssignmentRow(assign: ImageAssignment): Record<string, any> {
  const targetType = assign.slotKey.includes('character')
    ? 'character'
    : assign.slotKey.includes('team')
    ? 'employee'
    : assign.slotKey.includes('bonus')
    ? 'bonus'
    : 'general';

  const parts = assign.slotKey.split('/');
  const targetId = parts[parts.length - 1] || 'character';

  return {
    assignment_id: assign.id || `assign-${Date.now()}`,
    target_type: targetType,
    target_id: targetId,
    slot_key: assign.slotKey.trim(),
    asset_id: assign.assetId.trim(),
    inheritance_mode: 'override',
    updated_at_utc: assign.assignedAt || new Date().toISOString(),
    active: true,
  };
}

export function fromCanonicalImageAssignmentRow(row: Record<string, any>): ImageAssignment | null {
  const slotKey = String(pickCanonicalField(row, ['slotKey', 'slot_key', 'slot']) || '').trim();
  const assetId = String(pickCanonicalField(row, ['assetId', 'asset_id', 'asset']) || '').trim();
  if (!slotKey || !assetId) return null;

  const isActive = pickCanonicalBooleanField(row, ['active', 'is_active', 'isActive', 'активний', 'активна'], true);
  if (!isActive) return null;

  const assignment: ImageAssignment & {
    inheritanceMode?: string;
    active?: boolean;
    targetType?: string;
    targetId?: string;
  } = {
    id: String(pickCanonicalField(row, ['id', 'assignment_id']) || `assign-${slotKey}`).trim(),
    targetType: String(pickCanonicalField(row, ['targetType', 'target_type', 'targettype']) || '').trim() || undefined,
    targetId: String(pickCanonicalField(row, ['targetId', 'target_id', 'targetid']) || '').trim() || undefined,
    slotKey,
    assetId,
    assignedAt: String(
      pickCanonicalField(row, ['assignedAt', 'updated_at_utc', 'updated_at', 'assigned_at']) || new Date().toISOString()
    ).trim(),
    inheritanceMode: String(pickCanonicalField(row, ['inheritanceMode', 'inheritance_mode', 'inherit_mode', 'mode']) || '').trim() || undefined,
    active: isActive,
  };
  return assignment;
}

export function normalizeLoadedImageAssignments(rows: unknown): ImageAssignment[] {
  if (!Array.isArray(rows)) return [];
  const result: ImageAssignment[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const mapped = fromCanonicalImageAssignmentRow(raw as Record<string, any>);
    if (mapped) result.push(mapped);
  }
  return result;
}

function isSharedInheritanceMode(modeLower: string): boolean {
  return (
    modeLower === 'inherit' ||
    modeLower === 'shared' ||
    modeLower === 'inherit_primary' ||
    modeLower === 'from_primary' ||
    modeLower === 'same_as_primary'
  );
}

export function parseStageSlotKey(
  slotKey: string,
  targetType?: string,
  targetId?: string
): { kind: 'primary' | 'alternate'; stage: number } | null {
  const normalized = slotKey.trim().toLowerCase();
  const targetTypeLower = (targetType || '').trim().toLowerCase();
  const targetIdLower = (targetId || '').trim().toLowerCase();

  if (!normalized) return null;
  if (normalized.includes('team') || normalized.includes('bonus') || normalized.includes('employee')) {
    return null;
  }
  if (targetTypeLower && !/^(character|stage|character_stage|етап)$/.test(targetTypeLower)) {
    return null;
  }

  let kind: 'primary' | 'alternate' | null = null;
  if (/(?:^|[/_.-])alternate(?:$|[/_.-])/.test(normalized) || /(?:^|[/_.-])alternate(?:$|[/_.-])/.test(targetIdLower)) {
    kind = 'alternate';
  } else if (/(?:^|[/_.-])primary(?:$|[/_.-])/.test(normalized) || /(?:^|[/_.-])primary(?:$|[/_.-])/.test(targetIdLower)) {
    kind = 'primary';
  } else if (/(?:^|[/_.-])stage[-_]?0?[1-5](?:$|[/_.-])/.test(normalized)) {
    kind = 'primary';
  }
  if (!kind) return null;

  let stageNum = 0;
  const slotStageMatch = /(?:stage[-_]?|(?:^|\/)(?:primary|alternate)\/(?:stage[-_]?)?)0?([1-5])(?:$|[/_.-])/.exec(normalized);
  if (slotStageMatch) {
    stageNum = Number(slotStageMatch[1]);
  } else if (targetIdLower) {
    const targetStageMatch = /^(?:stage[-_]?)?0?([1-5])$/.exec(targetIdLower);
    if (targetStageMatch) {
      stageNum = Number(targetStageMatch[1]);
    }
  }

  if (stageNum < 1 || stageNum > 5) return null;
  return { kind, stage: stageNum };
}

function sanitizeRemoteStageUrl(rawUrl?: string | null): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed || trimmed === '[локальне зображення]' || isStaleLocalAssetPath(trimmed)) {
    return '';
  }
  const normalized = normalizeDriveImageUrl(trimmed);
  return isValidRemoteImageUrl(normalized) || normalized.startsWith('data:image/') || normalized.startsWith('blob:')
    ? normalized
    : '';
}

/**
 * Merges sheet-backed image registry and slot assignments into character stage settings,
 * preserving valid remote/Drive URLs and alternate slot inheritance without substituting stale local PNGs.
 */
export function hydrateStagesFromImageLibrary(
  baseStages: CharacterStage[],
  remoteStages: CharacterStage[] | undefined,
  registry: ImageAsset[],
  assignments: ImageAssignment[]
): CharacterStage[] {
  const defaultThresholds = [0, 20, 40, 60, 80];
  const hasRemoteStages = Array.isArray(remoteStages) && remoteStages.length > 0;
  const stageList: CharacterStage[] = [1, 2, 3, 4, 5].map((stageNum, idx) => {
    const fromRemote = remoteStages?.find((s) => Number(s.stage) === stageNum);
    const fromBase = baseStages?.find((s) => Number(s.stage) === stageNum);
    const primaryImage = hasRemoteStages
      ? sanitizeRemoteStageUrl(fromRemote?.primaryImage)
      : sanitizeRemoteStageUrl(fromBase?.primaryImage);
    const alternateImage = hasRemoteStages
      ? sanitizeRemoteStageUrl(fromRemote?.alternateImage)
      : sanitizeRemoteStageUrl(fromBase?.alternateImage);
    return {
      stage: stageNum,
      name: fromRemote?.name || fromBase?.name || `Етап ${stageNum}`,
      thresholdPercent:
        fromRemote?.thresholdPercent !== undefined
          ? Number(fromRemote.thresholdPercent)
          : fromBase?.thresholdPercent !== undefined
          ? Number(fromBase.thresholdPercent)
          : defaultThresholds[idx],
      primaryImage,
      alternateImage,
    };
  });

  const assetUrlById = new Map<string, string>();
  for (const asset of registry) {
    const active = (asset as ImageAsset & { isActive?: boolean }).isActive;
    if (active === false) continue;
    const usable = sanitizeRemoteStageUrl(asset.imageUrl || asset.url);
    if (usable) {
      assetUrlById.set(asset.id, usable);
    }
  }

  const inheritedAlternateStages = new Set<number>();

  for (const assign of assignments) {
    const extAssign = assign as ImageAssignment & {
      inheritanceMode?: string;
      targetType?: string;
      targetId?: string;
      active?: boolean;
    };
    if (extAssign.active === false) continue;
    const parsedSlot = parseStageSlotKey(assign.slotKey, extAssign.targetType, extAssign.targetId);
    if (!parsedSlot) continue;
    const stageObj = stageList.find((s) => s.stage === parsedSlot.stage);
    if (!stageObj) continue;

    const inheritanceMode = (extAssign.inheritanceMode || '').trim().toLowerCase();
    const resolvedUrl =
      assetUrlById.get(assign.assetId) ||
      sanitizeRemoteStageUrl(assign.assetId);

    if (parsedSlot.kind === 'primary') {
      if (resolvedUrl) {
        stageObj.primaryImage = resolvedUrl;
      }
    } else if (parsedSlot.kind === 'alternate') {
      const inheritedAssetMatch = /^asset-char-primary-stage-0?([1-5])$/.exec(assign.assetId.trim());
      if (
        isSharedInheritanceMode(inheritanceMode) ||
        (inheritedAssetMatch && Number(inheritedAssetMatch[1]) === stageObj.stage)
      ) {
        inheritedAlternateStages.add(stageObj.stage);
      } else if (resolvedUrl) {
        stageObj.alternateImage = resolvedUrl;
      }
    }
  }

  for (const stageObj of stageList) {
    if (
      stageObj.primaryImage &&
      (!stageObj.alternateImage || inheritedAlternateStages.has(stageObj.stage))
    ) {
      stageObj.alternateImage = stageObj.primaryImage;
    }
  }

  return stageList;
}

export function buildImageDiagnostics(
  registry: ImageAsset[],
  assignments: ImageAssignment[],
  remoteDiagnostics?: ImageDiagnostics | null
): ImageDiagnostics {
  if (remoteDiagnostics && typeof remoteDiagnostics === 'object') {
    return {
      totalAssets: Number(remoteDiagnostics.totalAssets) || registry.length,
      activeAssets: Number(remoteDiagnostics.activeAssets) || 0,
      usableUrlCount: Number(remoteDiagnostics.usableUrlCount) || 0,
      invalidUrlAssets: Array.isArray(remoteDiagnostics.invalidUrlAssets) ? remoteDiagnostics.invalidUrlAssets : [],
      unresolvedAssignments: Array.isArray(remoteDiagnostics.unresolvedAssignments) ? remoteDiagnostics.unresolvedAssignments : [],
    };
  }

  const assetById = new Map<string, ImageAsset & { isActive?: boolean }>();
  const invalidUrlAssets: ImageDiagnosticIssue[] = [];
  let activeAssets = 0;
  let usableUrlCount = 0;

  for (const rawAsset of registry) {
    const asset = rawAsset as ImageAsset & { isActive?: boolean };
    assetById.set(asset.id, asset);
    if (asset.isActive === false) continue;
    activeAssets++;
    const usable = sanitizeRemoteStageUrl(asset.imageUrl || asset.url);
    if (usable) {
      usableUrlCount++;
    } else {
      const rawRef = (asset.url || '').trim();
      const reason: 'missing_url' | 'invalid_url' =
        !rawRef || rawRef === '[локальне зображення]' ? 'missing_url' : 'invalid_url';
      invalidUrlAssets.push({
        assetId: asset.id,
        name: asset.name,
        rawRef,
        reason,
        message:
          reason === 'missing_url'
            ? `Актив «${asset.name}» не має Cloudinary/HTTPS URL у file_reference або image_url.`
            : `Актив «${asset.name}» містить некоректне посилання: «${rawRef}».`,
      });
    }
  }

  const unresolvedAssignments: ImageDiagnosticIssue[] = [];
  for (const assign of assignments) {
    const extAssign = assign as ImageAssignment & {
      inheritanceMode?: string;
      targetType?: string;
      targetId?: string;
      active?: boolean;
    };
    if (extAssign.active === false) continue;
    const parsedSlot = parseStageSlotKey(assign.slotKey, extAssign.targetType, extAssign.targetId);
    if (!parsedSlot) continue;
    const inheritanceMode = (extAssign.inheritanceMode || '').trim().toLowerCase();
    const inheritedAssetMatch = /^asset-char-primary-stage-0?([1-5])$/.exec(assign.assetId.trim());
    if (
      parsedSlot.kind === 'alternate' &&
      (isSharedInheritanceMode(inheritanceMode) || (inheritedAssetMatch && Number(inheritedAssetMatch[1]) === parsedSlot.stage))
    ) {
      continue;
    }

    if (sanitizeRemoteStageUrl(assign.assetId)) continue;
    const targetAsset = assetById.get(assign.assetId);
    if (!targetAsset) {
      unresolvedAssignments.push({
        assetId: assign.assetId,
        slotKey: assign.slotKey,
        stage: parsedSlot.stage,
        reason: 'missing_asset',
        message: `Призначення для етапу ${parsedSlot.stage} посилається на відсутній asset_id «${assign.assetId}».`,
      });
    } else if (targetAsset.isActive === false) {
      unresolvedAssignments.push({
        assetId: assign.assetId,
        name: targetAsset.name,
        slotKey: assign.slotKey,
        stage: parsedSlot.stage,
        reason: 'inactive_asset',
        message: `Актив «${targetAsset.name}» (${assign.assetId}) для етапу ${parsedSlot.stage} вимкнено (is_active = FALSE).`,
      });
    } else if (!sanitizeRemoteStageUrl(targetAsset.imageUrl || targetAsset.url)) {
      const rawRef = (targetAsset.url || '').trim();
      const reason: 'missing_url' | 'invalid_url' =
        !rawRef || rawRef === '[локальне зображення]' ? 'missing_url' : 'invalid_url';
      unresolvedAssignments.push({
        assetId: assign.assetId,
        name: targetAsset.name,
        slotKey: assign.slotKey,
        stage: parsedSlot.stage,
        rawRef,
        reason,
        message:
          reason === 'missing_url'
            ? `Актив «${targetAsset.name}» (${assign.assetId}) для етапу ${parsedSlot.stage} не містить URL Cloudinary / HTTPS у file_reference або image_url.`
            : `Актив «${targetAsset.name}» (${assign.assetId}) для етапу ${parsedSlot.stage} має некоректний URL: «${rawRef}».`,
      });
    }
  }

  return {
    totalAssets: registry.length,
    activeAssets,
    usableUrlCount,
    invalidUrlAssets,
    unresolvedAssignments,
  };
}

/* ============================================================================
 * Role-Based Points & Rewards Sheet Mappers & Normalizers
 * ========================================================================== */

function normalizePointsRoleId(raw: unknown): PointsRoleId {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'manager' || s === 'керівник') return 'manager';
  return 'performer';
}

function normalizePointsReasonOperationType(raw: unknown): PointsReasonOperationType {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'manual_award' || s === 'award' || s === 'нарахування') return 'manual_award';
  if (s === 'manual_deduction' || s === 'deduct' || s === 'deduction' || s === 'списання') return 'manual_deduction';
  return 'neutral_self_report';
}

function normalizePointsOperationType(raw: unknown): PointsOperationType {
  const s = String(raw || '').trim().toLowerCase();
  const known: PointsOperationType[] = [
    'monthly_allocation',
    'time_earning',
    'manual_award',
    'manual_deduction',
    'neutral_self_report',
    'reward_spend',
    'reward_refund',
    'expiry',
    'reversal',
    'period_correction',
  ];
  if (known.includes(s as PointsOperationType)) return s as PointsOperationType;
  if (s === 'award') return 'manual_award';
  if (s === 'deduct' || s === 'deduction') return 'manual_deduction';
  if (s === 'neutral') return 'neutral_self_report';
  return 'manual_award';
}

function normalizeAllowedRoles(raw: unknown): PointsRoleId[] {
  if (Array.isArray(raw)) {
    const out = raw
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item) => item === 'manager' || item === 'performer') as PointsRoleId[];
    return out.length > 0 ? Array.from(new Set(out)) : ['manager', 'performer'];
  }
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'all' || s === '*' || s === 'усі') return ['manager', 'performer'];
  const parsed: PointsRoleId[] = [];
  if (s.includes('manager') || s.includes('керівник')) parsed.push('manager');
  if (s.includes('performer') || s.includes('виконавець')) parsed.push('performer');
  return parsed.length > 0 ? parsed : ['manager', 'performer'];
}

export function fromCanonicalPointsRoleRow(row: Record<string, any>): PointsRoleConfig | null {
  const rawRole = pickCanonicalField(row, ['roleId', 'role_id', 'id']);
  if (!rawRole) return null;
  const roleId = normalizePointsRoleId(rawRole);
  const rawMode = String(pickCanonicalField(row, ['eligibleTimeMode', 'eligible_time_mode']) || 'all').trim().toLowerCase();
  const eligibleTimeMode: PointsEligibleTimeMode =
    rawMode === 'selected_categories' || rawMode === 'eligible_only' ? rawMode : 'all';

  return {
    roleId,
    name: String(pickCanonicalField(row, ['name', 'назва']) || (roleId === 'manager' ? 'Керівник' : 'Виконавець')).trim(),
    description: String(pickCanonicalField(row, ['description', 'опис']) || '').trim(),
    monthlyBasePoints: Math.max(0, Number(pickCanonicalField(row, ['monthlyBasePoints', 'monthly_base_points']) ?? (roleId === 'performer' ? 60 : 0)) || 0),
    timeEarningEnabled: pickCanonicalBooleanField(row, ['timeEarningEnabled', 'time_earning_enabled'], roleId === 'manager'),
    minutesPerPoint: Math.max(1, Number(pickCanonicalField(row, ['minutesPerPoint', 'minutes_per_point']) ?? 30) || 30),
    eligibleTimeMode,
    positiveGraceMonths: Math.max(0, Math.floor(Number(pickCanonicalField(row, ['positiveGraceMonths', 'positive_grace_months']) ?? 1) || 0)),
    negativeCarryover: pickCanonicalBooleanField(row, ['negativeCarryover', 'negative_carryover'], true),
    manualAwardsEnabled: pickCanonicalBooleanField(row, ['manualAwardsEnabled', 'manual_awards_enabled'], true),
    manualDeductionsEnabled: pickCanonicalBooleanField(row, ['manualDeductionsEnabled', 'manual_deductions_enabled'], true),
    active: pickCanonicalBooleanField(row, ['active', 'активна'], true),
    updatedAtUtc: String(pickCanonicalField(row, ['updatedAtUtc', 'updated_at_utc']) || '').trim(),
  };
}

export function toCanonicalPointsRoleRow(role: PointsRoleConfig): Record<string, any> {
  return {
    role_id: role.roleId,
    назва: role.name,
    опис: role.description,
    monthly_base_points: Math.max(0, Number(role.monthlyBasePoints) || 0),
    time_earning_enabled: Boolean(role.timeEarningEnabled),
    minutes_per_point: Math.max(1, Number(role.minutesPerPoint) || 30),
    eligible_time_mode: role.eligibleTimeMode || 'all',
    positive_grace_months: Math.max(0, Math.floor(Number(role.positiveGraceMonths ?? 1))),
    negative_carryover: role.negativeCarryover !== false,
    active: role.active !== false,
    updated_at_utc: role.updatedAtUtc || new Date().toISOString(),
  };
}

export function normalizeLoadedPointsRoles(rows: unknown): PointsRoleConfig[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (r && typeof r === 'object' ? fromCanonicalPointsRoleRow(r as Record<string, any>) : null))
    .filter((r): r is PointsRoleConfig => Boolean(r));
}

export function fromCanonicalEmployeePointsProfileRow(row: Record<string, any>): EmployeePointsProfile | null {
  const employeeId = String(pickCanonicalField(row, ['employeeId', 'employee_id']) || '').trim();
  if (!employeeId) return null;
  const rawRole = pickCanonicalField(row, ['pointsRole', 'points_role']);
  const monthlyRaw = pickCanonicalField(row, ['monthlyBaseOverride', 'monthly_base_override']);
  const timeEarnRaw = pickCanonicalField(row, ['timeEarningOverride', 'time_earning_override']);
  const mppRaw = pickCanonicalField(row, ['minutesPerPointOverride', 'minutes_per_point_override']);
  return {
    employeeId,
    pointsRole: normalizePointsRoleId(rawRole),
    monthlyBaseOverride: normalizeNullableNumber(monthlyRaw),
    timeEarningOverride: normalizeNullableBoolean(timeEarnRaw),
    minutesPerPointOverride: normalizeNullableNumber(mppRaw),
    pointsEnabled: pickCanonicalBooleanField(row, ['pointsEnabled', 'points_enabled'], true),
    updatedAtUtc: String(pickCanonicalField(row, ['updatedAtUtc', 'updated_at_utc']) || '').trim(),
  };
}

export function toCanonicalEmployeePointsProfileRow(profile: EmployeePointsProfile): Record<string, any> {
  return {
    employee_id: profile.employeeId,
    points_role: profile.pointsRole,
    monthly_base_override:
      profile.monthlyBaseOverride !== null && profile.monthlyBaseOverride !== undefined
        ? profile.monthlyBaseOverride
        : '',
    time_earning_override:
      profile.timeEarningOverride !== null && profile.timeEarningOverride !== undefined
        ? profile.timeEarningOverride
        : '',
    minutes_per_point_override:
      profile.minutesPerPointOverride !== null && profile.minutesPerPointOverride !== undefined
        ? profile.minutesPerPointOverride
        : '',
    points_enabled: profile.pointsEnabled !== false,
    updated_at_utc: profile.updatedAtUtc || new Date().toISOString(),
  };
}

export function normalizeLoadedPointsProfiles(rows: unknown): EmployeePointsProfile[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (r && typeof r === 'object' ? fromCanonicalEmployeePointsProfileRow(r as Record<string, any>) : null))
    .filter((r): r is EmployeePointsProfile => Boolean(r));
}

export function fromCanonicalPointsReasonRow(row: Record<string, any>, fallbackIndex?: number): PointsReason | null {
  const id = String(pickCanonicalField(row, ['id', 'reason_id', 'код']) || '').trim();
  const name = String(pickCanonicalField(row, ['name', 'назва', 'текст']) || '').trim();
  if (!id || !name) return null;
  const opType = normalizePointsReasonOperationType(pickCanonicalField(row, ['operationType', 'operation_type']));
  const rawOrder = Number(pickCanonicalField(row, ['sortOrder', 'sort_order', 'порядок']));
  return {
    id,
    operationType: opType,
    name,
    defaultPoints: opType === 'neutral_self_report' ? 0 : Math.max(0, Number(pickCanonicalField(row, ['defaultPoints', 'default_points']) ?? 1) || 0),
    description: String(pickCanonicalField(row, ['description', 'опис']) || '').trim(),
    allowedRoles: normalizeAllowedRoles(pickCanonicalField(row, ['allowedRoles', 'allowed_roles'])),
    active: pickCanonicalBooleanField(row, ['active', 'активна'], true),
    sortOrder: !Number.isNaN(rawOrder) && rawOrder > 0 ? rawOrder : (fallbackIndex !== undefined ? fallbackIndex + 1 : 1),
    updatedAtUtc: String(pickCanonicalField(row, ['updatedAtUtc', 'updated_at_utc']) || '').trim(),
  };
}

export function toCanonicalPointsReasonRow(reason: PointsReason): Record<string, any> {
  return {
    reason_id: reason.id.trim(),
    operation_type: reason.operationType,
    назва: reason.name.trim(),
    default_points: reason.operationType === 'neutral_self_report' ? 0 : Math.max(0, Math.round(Number(reason.defaultPoints) || 0)),
    опис: reason.description.trim(),
    allowed_roles: reason.allowedRoles.join(','),
    active: reason.active !== false,
    sort_order: reason.sortOrder || 1,
    updated_at_utc: reason.updatedAtUtc || new Date().toISOString(),
  };
}

export function normalizeLoadedPointsReasons(rows: unknown): PointsReason[] {
  if (!Array.isArray(rows)) return [];
  const mapped: PointsReason[] = [];
  rows.forEach((r, idx) => {
    if (!r || typeof r !== 'object') return;
    const item = fromCanonicalPointsReasonRow(r as Record<string, any>, idx);
    if (item) mapped.push(item);
  });
  return mapped.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function fromCanonicalPointsTransactionRow(row: Record<string, any>): PointsTransaction | null {
  const id = String(pickCanonicalField(row, ['id', 'transaction_id']) || '').trim();
  const employeeId = String(pickCanonicalField(row, ['employeeId', 'employee_id']) || '').trim();
  if (!id || !employeeId) return null;
  const occurredAtUtc = String(pickCanonicalField(row, ['occurredAtUtc', 'occurred_at_utc']) || '').trim();
  const createdAtUtc = String(pickCanonicalField(row, ['createdAtUtc', 'created_at_utc']) || occurredAtUtc || '').trim();
  const monthKey =
    String(pickCanonicalField(row, ['monthKey', 'month_key']) || '').trim() ||
    (occurredAtUtc ? occurredAtUtc.slice(0, 7) : '');

  return {
    id,
    employeeId,
    operationType: normalizePointsOperationType(pickCanonicalField(row, ['operationType', 'operation_type'])),
    pointsDelta: Number(pickCanonicalField(row, ['pointsDelta', 'points_delta']) ?? 0) || 0,
    reasonId: String(pickCanonicalField(row, ['reasonId', 'reason_id']) || '').trim(),
    reasonSnapshot: String(pickCanonicalField(row, ['reasonSnapshot', 'reason_snapshot']) || '').trim(),
    comment: String(pickCanonicalField(row, ['comment', 'коментар']) || '').trim(),
    projectId: String(pickCanonicalField(row, ['projectId', 'project_id']) || '').trim() || undefined,
    segmentId: String(pickCanonicalField(row, ['segmentId', 'segment_id']) || '').trim() || undefined,
    relatedEmployeeId: String(pickCanonicalField(row, ['relatedEmployeeId', 'related_employee_id']) || '').trim() || undefined,
    occurredAtUtc,
    createdAtUtc,
    actorEmployeeId: String(pickCanonicalField(row, ['actorEmployeeId', 'actor_employee_id']) || '').trim() || undefined,
    commandId: String(pickCanonicalField(row, ['commandId', 'command_id']) || `cmd-${id}`).trim(),
    reversalOfTransactionId:
      String(pickCanonicalField(row, ['reversalOfTransactionId', 'reversal_of_transaction_id']) || '').trim() || undefined,
    monthKey,
    expiresAtUtc: String(pickCanonicalField(row, ['expiresAtUtc', 'expires_at_utc']) || '').trim() || undefined,
  };
}

export function normalizeLoadedPointsTransactions(rows: unknown): PointsTransaction[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (r && typeof r === 'object' ? fromCanonicalPointsTransactionRow(r as Record<string, any>) : null))
    .filter((r): r is PointsTransaction => Boolean(r));
}

export function fromCanonicalPointsPeriodRow(row: Record<string, any>): PointsPeriod | null {
  const id = String(pickCanonicalField(row, ['id', 'period_id']) || '').trim();
  const employeeId = String(pickCanonicalField(row, ['employeeId', 'employee_id']) || '').trim();
  const monthKey = String(pickCanonicalField(row, ['monthKey', 'month_key']) || '').trim();
  if (!id || !employeeId || !monthKey) return null;
  const statusRaw = String(pickCanonicalField(row, ['status']) || 'open').trim().toLowerCase();
  const status: PointsPeriodStatus = statusRaw === 'closed' || statusRaw === 'закрито' ? 'closed' : 'open';

  return {
    id,
    employeeId,
    monthKey,
    baseAllocation: Number(pickCanonicalField(row, ['baseAllocation', 'base_allocation']) ?? 0) || 0,
    debtCarriedIn: Number(pickCanonicalField(row, ['debtCarriedIn', 'debt_carried_in']) ?? 0) || 0,
    earnedPoints: Number(pickCanonicalField(row, ['earnedPoints', 'earned_points']) ?? 0) || 0,
    deductedPoints: Number(pickCanonicalField(row, ['deductedPoints', 'deducted_points']) ?? 0) || 0,
    spentPoints: Number(pickCanonicalField(row, ['spentPoints', 'spent_points']) ?? 0) || 0,
    expiredPoints: Number(pickCanonicalField(row, ['expiredPoints', 'expired_points']) ?? 0) || 0,
    status,
    closedAtUtc: String(pickCanonicalField(row, ['closedAtUtc', 'closed_at_utc']) || '').trim() || undefined,
    commandId: String(pickCanonicalField(row, ['commandId', 'command_id']) || '').trim() || undefined,
  };
}

export function normalizeLoadedPointsPeriods(rows: unknown): PointsPeriod[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (r && typeof r === 'object' ? fromCanonicalPointsPeriodRow(r as Record<string, any>) : null))
    .filter((r): r is PointsPeriod => Boolean(r));
}

export function fromCanonicalBonusEligibilityRow(row: Record<string, any>): BonusEligibilityRule | null {
  const id = String(pickCanonicalField(row, ['id', 'eligibility_id']) || '').trim();
  const bonusId = String(pickCanonicalField(row, ['bonusId', 'bonus_id']) || '').trim();
  if (!id || !bonusId) return null;

  const targetTypeRaw = String(pickCanonicalField(row, ['targetType', 'target_type']) || 'all').trim().toLowerCase();
  const targetType: BonusEligibilityTargetType =
    targetTypeRaw === 'employee' || targetTypeRaw === 'role' ? targetTypeRaw : 'all';

  return {
    id,
    bonusId,
    targetType,
    targetId: String(pickCanonicalField(row, ['targetId', 'target_id']) || (targetType === 'all' ? '*' : '')).trim(),
    priceOverride: normalizeNullableNumber(pickCanonicalField(row, ['priceOverride', 'price_override'])),
    active: pickCanonicalBooleanField(row, ['active', 'активний', 'активна'], true),
    requiresApproval: pickCanonicalBooleanField(row, ['requiresApproval', 'requires_approval'], false),
    maxQuantity: normalizeNullableNumber(pickCanonicalField(row, ['maxQuantity', 'max_quantity'])),
    updatedAtUtc: String(pickCanonicalField(row, ['updatedAtUtc', 'updated_at_utc', 'updated']) || '').trim(),
  };
}

export function normalizeLoadedBonusEligibility(rows: unknown): BonusEligibilityRule[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (r && typeof r === 'object' ? fromCanonicalBonusEligibilityRow(r as Record<string, any>) : null))
    .filter((r): r is BonusEligibilityRule => Boolean(r));
}

export function fromCanonicalBonusClaimRow(row: Record<string, any>): BonusClaim | null {
  const id = String(pickCanonicalField(row, ['id', 'claim_id']) || '').trim();
  const bonusId = String(pickCanonicalField(row, ['bonusId', 'bonus_id']) || '').trim();
  if (!id || !bonusId) return null;

  const rawStatus = String(pickCanonicalField(row, ['status', 'статус']) || 'requested').trim().toLowerCase();
  let status: BonusClaimStatus = 'requested';
  if (rawStatus === 'approved' || rawStatus === 'погоджено') status = 'approved';
  else if (rawStatus === 'fulfilled' || rawStatus === 'виконано') status = 'fulfilled';
  else if (rawStatus === 'cancelled' || rawStatus === 'canceled' || rawStatus === 'скасовано') status = 'cancelled';

  const qty = Math.max(1, Math.round(Number(pickCanonicalField(row, ['quantity']) ?? 1) || 1));
  const totalCost = Math.max(0, Number(pickCanonicalField(row, ['totalPointsCost', 'вартість_балів']) ?? 0) || 0);
  const unitPriceRaw = pickCanonicalField(row, ['unitPricePoints', 'unit_price_points']);
  const unitPrice =
    unitPriceRaw !== undefined && unitPriceRaw !== null && unitPriceRaw !== ''
      ? Math.max(0, Number(unitPriceRaw) || 0)
      : Math.round(totalCost / qty);

  return {
    id,
    bonusId,
    bonusNameSnapshot: String(pickCanonicalField(row, ['bonusNameSnapshot', 'назва_на_момент_запиту']) || '').trim(),
    employeeId: String(pickCanonicalField(row, ['employeeId', 'employee_id']) || '').trim(),
    quantity: qty,
    unitPricePoints: unitPrice,
    totalPointsCost: totalCost,
    requestedAtUtc: String(pickCanonicalField(row, ['requestedAtUtc', 'дата_запиту_utc']) || '').trim(),
    status,
    fulfilledAtUtc: String(pickCanonicalField(row, ['fulfilledAtUtc', 'дата_отримання_utc']) || '').trim() || undefined,
    comment: String(pickCanonicalField(row, ['comment', 'коментар']) || '').trim() || undefined,
    commandId: String(pickCanonicalField(row, ['commandId', 'command_id']) || `claim-${id}`).trim(),
    updatedAtUtc: String(pickCanonicalField(row, ['updatedAtUtc', 'updated_at_utc']) || '').trim(),
    approvedByEmployeeId:
      String(pickCanonicalField(row, ['approvedByEmployeeId', 'approved_by_employee_id']) || '').trim() || undefined,
    approvedAtUtc: String(pickCanonicalField(row, ['approvedAtUtc', 'approved_at_utc']) || '').trim() || undefined,
    pointsTransactionId:
      String(pickCanonicalField(row, ['pointsTransactionId', 'points_transaction_id']) || '').trim() || undefined,
    eligibilityId: String(pickCanonicalField(row, ['eligibilityId', 'eligibility_id']) || '').trim() || undefined,
  };
}

export function normalizeLoadedBonusClaims(rows: unknown): BonusClaim[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => (r && typeof r === 'object' ? fromCanonicalBonusClaimRow(r as Record<string, any>) : null))
    .filter((r): r is BonusClaim => Boolean(r));
}

