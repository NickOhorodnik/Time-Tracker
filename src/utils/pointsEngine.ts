import {
  Bonus,
  BonusClaim,
  BonusClaimStatus,
  BonusEligibilityRule,
  DerivedEmployeePointsSummary,
  EffectiveEmployeePointsConfig,
  EmployeePointsProfile,
  PointsLotSummary,
  PointsOperationType,
  PointsPeriod,
  PointsReason,
  PointsReasonOperationType,
  PointsRoleConfig,
  PointsRoleId,
  PointsTransaction,
  ResolvedBonusOffer,
  TimeEntry,
} from '../types';

export const OTHER_REASON_ID = 'reason-other';

export const POINTS_ROLE_LABELS: Record<PointsRoleId, string> = {
  manager: 'Керівник',
  performer: 'Виконавець',
};

export const POINTS_OPERATION_LABELS: Record<PointsOperationType, string> = {
  monthly_allocation: 'Місячна база',
  time_earning: 'За час',
  manual_award: 'Нарахування',
  manual_deduction: 'Списання',
  neutral_self_report: 'Самозвіт (0 б.)',
  reward_spend: 'Отримання бонусу',
  reward_refund: 'Повернення за бонус',
  expiry: 'Згорання балів',
  reversal: 'Сторнування',
  period_correction: 'Корекція періоду',
};

export const CLAIM_STATUS_LABELS: Record<BonusClaimStatus, string> = {
  requested: 'Очікує підтвердження',
  approved: 'Погоджено',
  fulfilled: 'Виконано',
  cancelled: 'Скасовано',
};

export function createDefaultPointsRoles(nowIso = new Date().toISOString()): PointsRoleConfig[] {
  return [
    {
      roleId: 'manager',
      name: 'Керівник',
      description: 'Отримує бали за релевантний відпрацьований час допомоги, перевірки та виправлень.',
      monthlyBasePoints: 0,
      timeEarningEnabled: true,
      minutesPerPoint: 30,
      eligibleTimeMode: 'all',
      positiveGraceMonths: 1,
      negativeCarryover: true,
      manualAwardsEnabled: true,
      manualDeductionsEnabled: true,
      active: true,
      updatedAtUtc: nowIso,
    },
    {
      roleId: 'performer',
      name: 'Виконавець',
      description: 'Отримує щомісячну базову кількість балів, ручні нарахування та списання.',
      monthlyBasePoints: 60,
      timeEarningEnabled: false,
      minutesPerPoint: 30,
      eligibleTimeMode: 'selected_categories',
      positiveGraceMonths: 1,
      negativeCarryover: true,
      manualAwardsEnabled: true,
      manualDeductionsEnabled: true,
      active: true,
      updatedAtUtc: nowIso,
    },
  ];
}

/* ============================================================================
 * Europe/Kyiv Calendar & Expiration Utilities
 * ========================================================================== */

export function getKyivDateParts(input: Date | string = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateStr: string;
  monthKey: string;
} {
  const date = input instanceof Date ? input : new Date(input);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(safeDate);

  const getVal = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const year = getVal('year');
  const month = getVal('month');
  const day = getVal('day');
  const hour = getVal('hour') === 24 ? 0 : getVal('hour');
  const minute = getVal('minute');
  const second = getVal('second');
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const monthKey = `${year}-${pad(month)}`;
  return { year, month, day, hour, minute, second, dateStr, monthKey };
}

export function formatKyivDateTime(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return String(isoStr);
  const parts = getKyivDateParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.dateStr} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Converts a wall-clock Europe/Kyiv timestamp into an exact UTC ISO string,
 * handling +02:00 / +03:00 DST transitions cleanly across year boundaries & leap years.
 */
export function kyivLocalToUtcIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string {
  const approxUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Check offset by formatting approxUtcMs in Europe/Kyiv (within +/-3h of UTC)
  let candidateMs = approxUtcMs - 2 * 3600 * 1000;
  for (let i = 0; i < 3; i++) {
    const k = getKyivDateParts(new Date(candidateMs));
    const shownUtcMs = Date.UTC(k.year, k.month - 1, k.day, k.hour, k.minute, k.second);
    const diffMs = approxUtcMs - shownUtcMs;
    if (diffMs === 0) break;
    candidateMs += diffMs;
  }
  return new Date(candidateMs).toISOString();
}

export function addMonthsToMonthKey(monthKey: string, deltaMonths: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec((monthKey || '').trim());
  const nowParts = getKyivDateParts(new Date());
  const baseYear = match ? Number(match[1]) : nowParts.year;
  const baseMonth = match ? Number(match[2]) : nowParts.month;
  const zeroIndexed = baseYear * 12 + (baseMonth - 1) + deltaMonths;
  const nextYear = Math.floor(zeroIndexed / 12);
  const nextMonth = ((zeroIndexed % 12) + 12) % 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * Positive points earned in monthKey M with graceMonths G (default 1) are valid
 * through the end of month M + G and expire on the 1st of month M + G + 1 at 00:00:00 Europe/Kyiv.
 */
export function computePositiveExpiryUtc(monthKey: string, positiveGraceMonths = 1): string {
  const grace = Number.isFinite(Number(positiveGraceMonths))
    ? Math.max(0, Math.floor(Number(positiveGraceMonths)))
    : 1;
  const expiryMonthKey = addMonthsToMonthKey(monthKey, grace + 1);
  const [yStr, mStr] = expiryMonthKey.split('-');
  return kyivLocalToUtcIso(Number(yStr), Number(mStr), 1, 0, 0, 0);
}

export function getMonthKeyFromEntry(entry: TimeEntry): string {
  const explicit = (entry as TimeEntry & { monthKey?: string }).monthKey;
  if (explicit && /^\d{4}-\d{2}$/.test(explicit.trim())) {
    return explicit.trim();
  }
  if (entry.date && /^\d{4}-\d{2}/.test(entry.date.trim())) {
    return entry.date.trim().slice(0, 7);
  }
  return getKyivDateParts(new Date()).monthKey;
}

/* ============================================================================
 * Role & Profile Resolution
 * ========================================================================== */

export function normalizeNullableNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function normalizeNullableBoolean(raw: unknown): boolean | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (['true', '1', 'так', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'ні', 'no', 'n'].includes(s)) return false;
  return null;
}

export function resolveEffectiveEmployeePointsConfig(
  employeeId: string,
  roles: PointsRoleConfig[],
  profiles: EmployeePointsProfile[]
): EffectiveEmployeePointsConfig {
  const defaults = createDefaultPointsRoles();
  const profile = profiles.find((p) => p.employeeId === employeeId) || null;
  const roleId: PointsRoleId = profile?.pointsRole === 'manager' ? 'manager' : 'performer';

  const roleConfig =
    roles.find((r) => r.roleId === roleId) ||
    defaults.find((r) => r.roleId === roleId) ||
    defaults[1];

  const monthlyBasePoints =
    profile && profile.monthlyBaseOverride !== null && profile.monthlyBaseOverride !== undefined
      ? Number(profile.monthlyBaseOverride)
      : Number(roleConfig.monthlyBasePoints) || 0;

  const timeEarningEnabled =
    profile && profile.timeEarningOverride !== null && profile.timeEarningOverride !== undefined
      ? Boolean(profile.timeEarningOverride)
      : Boolean(roleConfig.timeEarningEnabled);

  const minutesPerPoint =
    profile &&
    profile.minutesPerPointOverride !== null &&
    profile.minutesPerPointOverride !== undefined &&
    Number(profile.minutesPerPointOverride) > 0
      ? Number(profile.minutesPerPointOverride)
      : Number(roleConfig.minutesPerPoint) > 0
      ? Number(roleConfig.minutesPerPoint)
      : 30;

  const pointsEnabled =
    profile && profile.pointsEnabled !== undefined ? Boolean(profile.pointsEnabled) : true;

  return {
    employeeId,
    pointsRole: roleId,
    roleName: roleConfig.name || POINTS_ROLE_LABELS[roleId],
    monthlyBasePoints: Math.max(0, monthlyBasePoints),
    timeEarningEnabled,
    minutesPerPoint,
    eligibleTimeMode: roleConfig.eligibleTimeMode || 'all',
    positiveGraceMonths:
      roleConfig.positiveGraceMonths !== undefined && roleConfig.positiveGraceMonths !== null
        ? Math.max(0, Math.floor(Number(roleConfig.positiveGraceMonths)))
        : 1,
    negativeCarryover: roleConfig.negativeCarryover !== false,
    manualAwardsEnabled: roleConfig.manualAwardsEnabled !== false,
    manualDeductionsEnabled: roleConfig.manualDeductionsEnabled !== false,
    pointsEnabled: pointsEnabled && roleConfig.active !== false,
  };
}

/* ============================================================================
 * Canonical Points Ledger & Lot Wallet Engine
 * ========================================================================== */

interface InternalLot {
  transactionId: string;
  monthKey: string;
  remainingPoints: number;
  expiresAtUtc: string;
  expiresAtMs: number;
}

interface ConsumedLotSlice {
  transactionId: string;
  monthKey: string;
  amount: number;
  expiresAtUtc: string;
  expiresAtMs: number;
}

function txSortKey(tx: PointsTransaction): string {
  return `${tx.occurredAtUtc || ''}|${tx.createdAtUtc || ''}|${tx.id || ''}`;
}

export function computeEmployeePointsState(
  employeeId: string,
  effectiveConfig: EffectiveEmployeePointsConfig,
  allTransactions: PointsTransaction[],
  asOfIso: string = new Date().toISOString()
): DerivedEmployeePointsSummary {
  const asOfMs = Date.parse(asOfIso) || Date.now();
  const currentMonthKey = getKyivDateParts(new Date(asOfMs)).monthKey;

  const empTxs = allTransactions
    .filter((tx) => tx.employeeId === employeeId)
    .filter((tx) => {
      const occurredMs = Date.parse(tx.occurredAtUtc || tx.createdAtUtc || '');
      return Number.isNaN(occurredMs) || occurredMs <= asOfMs;
    })
    .sort((a, b) => txSortKey(a).localeCompare(txSortKey(b)));

  const lots: InternalLot[] = [];
  const spentSlicesByTxId = new Map<string, ConsumedLotSlice[]>();
  const txById = new Map<string, PointsTransaction>();
  let debtBalance = 0;

  let monthlyAllocatedPoints = 0;
  let earnedPointsTotal = 0;
  let earnedPointsCurrentMonth = 0;
  let deductedPointsTotal = 0;
  let deductedPointsCurrentMonth = 0;
  let spentPointsTotal = 0;
  let spentPointsCurrentMonth = 0;
  let expiredPointsTotal = 0;
  let expiredPointsCurrentMonth = 0;
  let neutralReportCount = 0;

  const expireDueLots = (cutoffMs: number) => {
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (lot.remainingPoints > 0 && lot.expiresAtMs <= cutoffMs) {
        const expMonthKey = getKyivDateParts(new Date(lot.expiresAtMs)).monthKey;
        expiredPointsTotal += lot.remainingPoints;
        if (expMonthKey === currentMonthKey) {
          expiredPointsCurrentMonth += lot.remainingPoints;
        }
        lot.remainingPoints = 0;
      }
    }
  };

  const addPositiveCredit = (
    txId: string,
    amount: number,
    monthKey: string,
    expiresAtUtc: string
  ) => {
    if (amount <= 0) return;
    let remaining = amount;
    if (debtBalance > 0 && effectiveConfig.negativeCarryover) {
      const offset = Math.min(remaining, debtBalance);
      debtBalance -= offset;
      remaining -= offset;
    }
    if (remaining > 0) {
      const resolvedExpiry =
        expiresAtUtc || computePositiveExpiryUtc(monthKey || currentMonthKey, effectiveConfig.positiveGraceMonths);
      const expiresAtMs = Date.parse(resolvedExpiry) || Number.MAX_SAFE_INTEGER;
      if (expiresAtMs <= asOfMs) {
        // Credit already expired by asOfMs? Still record lot cleanly and let expireDueLots expire at event/cutoff
      }
      lots.push({
        transactionId: txId,
        monthKey: monthKey || currentMonthKey,
        remainingPoints: remaining,
        expiresAtUtc: resolvedExpiry,
        expiresAtMs,
      });
    }
  };

  const consumeLotsFifo = (amountNeeded: number, allowDebt: boolean): ConsumedLotSlice[] => {
    const consumed: ConsumedLotSlice[] = [];
    let remaining = amountNeeded;
    // Closest-to-expiring first (FIFO by expiry timestamp)
    const activeOrdered = lots
      .filter((l) => l.remainingPoints > 0)
      .sort((a, b) => a.expiresAtMs - b.expiresAtMs || a.monthKey.localeCompare(b.monthKey));

    for (const lot of activeOrdered) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.remainingPoints);
      if (take > 0) {
        lot.remainingPoints -= take;
        remaining -= take;
        consumed.push({
          transactionId: lot.transactionId,
          monthKey: lot.monthKey,
          amount: take,
          expiresAtUtc: lot.expiresAtUtc,
          expiresAtMs: lot.expiresAtMs,
        });
      }
    }

    if (remaining > 0 && allowDebt) {
      debtBalance += remaining;
    }

    return consumed;
  };

  for (const tx of empTxs) {
    txById.set(tx.id, tx);
    const txTimeMs = Date.parse(tx.occurredAtUtc || tx.createdAtUtc || '') || asOfMs;
    expireDueLots(txTimeMs);

    const txMonthKey = tx.monthKey || getKyivDateParts(new Date(txTimeMs)).monthKey;
    const isCurrentMonth = txMonthKey === currentMonthKey;
    const delta = Number(tx.pointsDelta) || 0;

    if (tx.operationType === 'neutral_self_report') {
      neutralReportCount++;
      continue;
    }

    if (tx.operationType === 'monthly_allocation') {
      if (delta > 0) {
        if (isCurrentMonth) monthlyAllocatedPoints += delta;
        addPositiveCredit(tx.id, delta, txMonthKey, tx.expiresAtUtc || '');
      }
      continue;
    }

    if (tx.operationType === 'time_earning' || tx.operationType === 'manual_award') {
      if (delta > 0) {
        earnedPointsTotal += delta;
        if (isCurrentMonth) earnedPointsCurrentMonth += delta;
        addPositiveCredit(tx.id, delta, txMonthKey, tx.expiresAtUtc || '');
      }
      continue;
    }

    if (tx.operationType === 'manual_deduction') {
      const deductAmt = Math.abs(delta);
      if (deductAmt > 0) {
        deductedPointsTotal += deductAmt;
        if (isCurrentMonth) deductedPointsCurrentMonth += deductAmt;
        consumeLotsFifo(deductAmt, true);
      }
      continue;
    }

    if (tx.operationType === 'reward_spend') {
      const spendAmt = Math.abs(delta);
      if (spendAmt > 0) {
        spentPointsTotal += spendAmt;
        if (isCurrentMonth) spentPointsCurrentMonth += spendAmt;
        const slices = consumeLotsFifo(spendAmt, true);
        spentSlicesByTxId.set(tx.id, slices);
      }
      continue;
    }

    if (tx.operationType === 'reward_refund') {
      const refundAmt = Math.max(0, delta);
      if (refundAmt > 0) {
        const origSpendId = tx.reversalOfTransactionId || '';
        const origSlices = origSpendId ? spentSlicesByTxId.get(origSpendId) : undefined;
        if (origSlices && origSlices.length > 0) {
          let leftToRefund = refundAmt;
          let actualRestored = 0;
          for (const slice of origSlices) {
            if (leftToRefund <= 0) break;
            const part = Math.min(leftToRefund, slice.amount);
            leftToRefund -= part;
            // CRITICAL: Do NOT resurrect expired points upon reward cancellation!
            if (slice.expiresAtMs > txTimeMs) {
              actualRestored += part;
              addPositiveCredit(`${tx.id}-${slice.transactionId}`, part, slice.monthKey, slice.expiresAtUtc);
            }
          }
          spentPointsTotal = Math.max(0, spentPointsTotal - actualRestored);
          if (isCurrentMonth) spentPointsCurrentMonth = Math.max(0, spentPointsCurrentMonth - actualRestored);
        } else {
          // Fallback if spend slices missing: only restore if explicit expiresAtUtc hasn't expired
          const fallbackExpMs = tx.expiresAtUtc ? Date.parse(tx.expiresAtUtc) : Number.MAX_SAFE_INTEGER;
          if (fallbackExpMs > txTimeMs) {
            addPositiveCredit(tx.id, refundAmt, txMonthKey, tx.expiresAtUtc || '');
            spentPointsTotal = Math.max(0, spentPointsTotal - refundAmt);
            if (isCurrentMonth) spentPointsCurrentMonth = Math.max(0, spentPointsCurrentMonth - refundAmt);
          }
        }
      }
      continue;
    }

    if (tx.operationType === 'expiry') {
      const expAmt = Math.abs(delta);
      if (expAmt > 0) {
        // Explicit expiry in ledger consumes matching lots (if not already virtually expired)
        const targetLot = lots.find((l) => l.monthKey === txMonthKey && l.remainingPoints > 0);
        if (targetLot) {
          const take = Math.min(expAmt, targetLot.remainingPoints);
          targetLot.remainingPoints -= take;
          expiredPointsTotal += take;
          if (isCurrentMonth) expiredPointsCurrentMonth += take;
        }
      }
      continue;
    }

    if (tx.operationType === 'reversal' || tx.operationType === 'period_correction') {
      const targetTx = tx.reversalOfTransactionId ? txById.get(tx.reversalOfTransactionId) : undefined;
      if (delta > 0) {
        // Reversing a deduction or reward spend or applying positive correction
        if (targetTx?.operationType === 'manual_deduction') {
          deductedPointsTotal = Math.max(0, deductedPointsTotal - delta);
          if (targetTx.monthKey === currentMonthKey) {
            deductedPointsCurrentMonth = Math.max(0, deductedPointsCurrentMonth - delta);
          }
        }
        const reversalExpiry =
          tx.expiresAtUtc || computePositiveExpiryUtc(txMonthKey, effectiveConfig.positiveGraceMonths);
        const revExpMs = Date.parse(reversalExpiry) || Number.MAX_SAFE_INTEGER;
        if (revExpMs > txTimeMs) {
          addPositiveCredit(tx.id, delta, txMonthKey, reversalExpiry);
        }
      } else if (delta < 0) {
        const deductAmt = Math.abs(delta);
        if (targetTx?.operationType === 'manual_award' || targetTx?.operationType === 'time_earning') {
          earnedPointsTotal = Math.max(0, earnedPointsTotal - deductAmt);
          if (targetTx.monthKey === currentMonthKey) {
            earnedPointsCurrentMonth = Math.max(0, earnedPointsCurrentMonth - deductAmt);
          }
          // Try removing from the specific target lot first if it still has unexpired balance
          const origLot = lots.find((l) => l.transactionId === targetTx.id && l.remainingPoints > 0);
          if (origLot) {
            const fromOrig = Math.min(deductAmt, origLot.remainingPoints);
            origLot.remainingPoints -= fromOrig;
            const remainder = deductAmt - fromOrig;
            if (remainder > 0) consumeLotsFifo(remainder, true);
          } else {
            consumeLotsFifo(deductAmt, true);
          }
        } else {
          consumeLotsFifo(deductAmt, true);
        }
      }
    }
  }

  // Expire all lots past asOfMs
  expireDueLots(asOfMs);

  const activeLots: PointsLotSummary[] = lots
    .filter((l) => l.remainingPoints > 0)
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs)
    .map((l) => ({
      transactionId: l.transactionId,
      monthKey: l.monthKey,
      remainingPoints: l.remainingPoints,
      expiresAtUtc: l.expiresAtUtc,
    }));

  const positiveTotal = activeLots.reduce((sum, l) => sum + l.remainingPoints, 0);
  const netBalance = positiveTotal - debtBalance;
  const availablePoints = Math.max(0, netBalance);

  const earliestExpiryUtc = activeLots.length > 0 ? activeLots[0].expiresAtUtc : null;
  const expiringSoonPoints = earliestExpiryUtc
    ? activeLots
        .filter((l) => l.expiresAtUtc === earliestExpiryUtc)
        .reduce((sum, l) => sum + l.remainingPoints, 0)
    : 0;

  return {
    employeeId,
    effectiveConfig,
    currentMonthKey,
    availablePoints,
    netBalance,
    debtCarriedForward: debtBalance,
    monthlyBasePoints: effectiveConfig.monthlyBasePoints,
    monthlyAllocatedPoints,
    earnedPointsTotal,
    earnedPointsCurrentMonth,
    deductedPointsTotal,
    deductedPointsCurrentMonth,
    spentPointsTotal,
    spentPointsCurrentMonth,
    expiredPointsTotal,
    expiredPointsCurrentMonth,
    expiringSoonPoints,
    nextExpiryAtUtc: earliestExpiryUtc,
    neutralReportCount,
    activeLots,
  };
}

/* ============================================================================
 * Eligible Time Points Synchronization Plan (Accumulated Seconds, No Rounding Loss)
 * ========================================================================== */

export function isTimeEntryEligibleForPoints(
  entry: TimeEntry,
  effectiveConfig: EffectiveEmployeePointsConfig,
  eligibleCategoryIds: string[] = []
): boolean {
  if (!effectiveConfig.pointsEnabled || !effectiveConfig.timeEarningEnabled) {
    return false;
  }
  if (
    effectiveConfig.eligibleTimeMode === 'selected_categories' ||
    effectiveConfig.eligibleTimeMode === 'eligible_only'
  ) {
    if (!eligibleCategoryIds || eligibleCategoryIds.length === 0) {
      return false;
    }
    return eligibleCategoryIds.includes(entry.categoryId);
  }
  return true;
}

export function getEntrySeconds(entry: TimeEntry): number {
  if (typeof entry.elapsedSeconds === 'number' && entry.elapsedSeconds >= 0) {
    return Math.round(entry.elapsedSeconds);
  }
  return Math.round(Math.max(0, Number(entry.durationMinutes) || 0) * 60);
}

/**
 * Computes idempotent time-earning sync transactions for open months using total
 * accumulated eligible seconds per employee & monthKey. Handles edits, deletions,
 * category changes, and employee reassignments cleanly without double-counting or
 * rewriting closed months.
 */
export function computeTimeEarningSyncTransactions(params: {
  employeeId: string;
  effectiveConfig: EffectiveEmployeePointsConfig;
  entries: TimeEntry[];
  existingTransactions: PointsTransaction[];
  periods: PointsPeriod[];
  eligibleCategoryIds?: string[];
  nowIso?: string;
}): PointsTransaction[] {
  const {
    employeeId,
    effectiveConfig,
    entries,
    existingTransactions,
    periods,
    eligibleCategoryIds = [],
    nowIso = new Date().toISOString(),
  } = params;

  const closedMonths = new Set(
    periods
      .filter((p) => p.employeeId === employeeId && p.status === 'closed')
      .map((p) => p.monthKey)
  );

  // Sum raw eligible seconds by monthKey
  const eligibleSecondsByMonth = new Map<string, number>();
  const latestSegmentByMonth = new Map<string, { segmentId: string; projectId?: string; relatedEmployeeId?: string }>();

  for (const entry of entries) {
    if ((entry.employeeId || '') !== employeeId) continue;
    const mk = getMonthKeyFromEntry(entry);
    if (closedMonths.has(mk)) continue;
    if (!isTimeEntryEligibleForPoints(entry, effectiveConfig, eligibleCategoryIds)) continue;

    const secs = getEntrySeconds(entry);
    if (secs <= 0) continue;
    eligibleSecondsByMonth.set(mk, (eligibleSecondsByMonth.get(mk) || 0) + secs);
    latestSegmentByMonth.set(mk, {
      segmentId: entry.id,
      projectId: entry.projectId,
      relatedEmployeeId: entry.relatedEmployeeId,
    });
  }

  // Sum net already-awarded time_earning points (including time-sync reversals) by monthKey
  const timeAwardedByMonth = new Map<string, number>();
  const timeTxIdsByMonth = new Map<string, string[]>();

  for (const tx of existingTransactions) {
    if (tx.employeeId !== employeeId) continue;
    const mk = tx.monthKey;
    if (tx.operationType === 'time_earning') {
      timeAwardedByMonth.set(mk, (timeAwardedByMonth.get(mk) || 0) + (Number(tx.pointsDelta) || 0));
      const arr = timeTxIdsByMonth.get(mk) || [];
      arr.push(tx.id);
      timeTxIdsByMonth.set(mk, arr);
    } else if (tx.operationType === 'reversal' && (tx.commandId || '').startsWith('time_sync:')) {
      timeAwardedByMonth.set(mk, (timeAwardedByMonth.get(mk) || 0) + (Number(tx.pointsDelta) || 0));
    }
  }

  const allMonths = new Set<string>([
    ...eligibleSecondsByMonth.keys(),
    ...timeAwardedByMonth.keys(),
  ]);

  const secPerPoint = Math.max(1, effectiveConfig.minutesPerPoint) * 60;
  const generated: PointsTransaction[] = [];

  for (const mk of Array.from(allMonths).sort()) {
    if (closedMonths.has(mk)) continue;
    const totalSecs = eligibleSecondsByMonth.get(mk) || 0;
    const targetPoints = effectiveConfig.pointsEnabled
      ? Math.floor(totalSecs / secPerPoint)
      : 0;
    const alreadyAwarded = timeAwardedByMonth.get(mk) || 0;
    const delta = targetPoints - alreadyAwarded;
    if (delta === 0) continue;

    const cmdId = `time_sync:${employeeId}:${mk}:from_${alreadyAwarded}_to_${targetPoints}`;
    if (existingTransactions.some((t) => t.commandId === cmdId)) continue;

    const segInfo = latestSegmentByMonth.get(mk);
    const prevTxIds = timeTxIdsByMonth.get(mk) || [];

    if (delta > 0) {
      generated.push({
        id: `ptx-time-${employeeId}-${mk}-${targetPoints}`,
        employeeId,
        operationType: 'time_earning',
        pointsDelta: delta,
        reasonId: 'system-time-earning',
        reasonSnapshot: `Нарахування за час (${Math.round(totalSecs / 60)} хв / ${effectiveConfig.minutesPerPoint} хв/бал)`,
        comment: `Автоматична синхронізація за ${mk} (${totalSecs} сек)`,
        projectId: segInfo?.projectId || '',
        segmentId: segInfo?.segmentId || '',
        relatedEmployeeId: segInfo?.relatedEmployeeId || '',
        occurredAtUtc: nowIso,
        createdAtUtc: nowIso,
        actorEmployeeId: employeeId,
        commandId: cmdId,
        reversalOfTransactionId: '',
        monthKey: mk,
        expiresAtUtc: computePositiveExpiryUtc(mk, effectiveConfig.positiveGraceMonths),
      });
    } else {
      generated.push({
        id: `ptx-time-rev-${employeeId}-${mk}-${targetPoints}`,
        employeeId,
        operationType: 'reversal',
        pointsDelta: delta,
        reasonId: 'system-time-adjustment',
        reasonSnapshot: `Корекція балів за час (${mk})`,
        comment: `Перерахунок після зміни/видалення/перепризначення записів за ${mk}`,
        projectId: segInfo?.projectId || '',
        segmentId: segInfo?.segmentId || '',
        relatedEmployeeId: segInfo?.relatedEmployeeId || '',
        occurredAtUtc: nowIso,
        createdAtUtc: nowIso,
        actorEmployeeId: employeeId,
        commandId: cmdId,
        reversalOfTransactionId: prevTxIds[prevTxIds.length - 1] || '',
        monthKey: mk,
        expiresAtUtc: '',
      });
    }
  }

  return generated;
}

/* ============================================================================
 * Monthly Base Allocation (Idempotent) & Period Closing
 * ========================================================================== */

export function createMonthlyAllocationIfNeeded(params: {
  employeeId: string;
  monthKey: string;
  effectiveConfig: EffectiveEmployeePointsConfig;
  existingTransactions: PointsTransaction[];
  periods: PointsPeriod[];
  actorEmployeeId?: string;
  nowIso?: string;
}): PointsTransaction | null {
  const {
    employeeId,
    monthKey,
    effectiveConfig,
    existingTransactions,
    periods,
    actorEmployeeId = '',
    nowIso = new Date().toISOString(),
  } = params;

  if (!effectiveConfig.pointsEnabled || effectiveConfig.monthlyBasePoints <= 0) {
    return null;
  }

  const period = periods.find((p) => p.employeeId === employeeId && p.monthKey === monthKey);
  if (period?.status === 'closed') {
    return null;
  }

  const cmdId = `monthly_alloc:${employeeId}:${monthKey}`;
  const alreadyAllocated = existingTransactions.some(
    (tx) =>
      tx.employeeId === employeeId &&
      tx.monthKey === monthKey &&
      (tx.operationType === 'monthly_allocation' || tx.commandId === cmdId)
  );
  if (alreadyAllocated) {
    return null;
  }

  return {
    id: `ptx-alloc-${employeeId}-${monthKey}`,
    employeeId,
    operationType: 'monthly_allocation',
    pointsDelta: effectiveConfig.monthlyBasePoints,
    reasonId: 'system-monthly-base',
    reasonSnapshot: `Щомісячна база (${effectiveConfig.roleName})`,
    comment: `Місячне нарахування за ${monthKey}`,
    occurredAtUtc: nowIso,
    createdAtUtc: nowIso,
    actorEmployeeId,
    commandId: cmdId,
    monthKey,
    expiresAtUtc: computePositiveExpiryUtc(monthKey, effectiveConfig.positiveGraceMonths),
  };
}

export function buildPeriodRecordFromLedger(params: {
  employeeId: string;
  monthKey: string;
  effectiveConfig: EffectiveEmployeePointsConfig;
  transactions: PointsTransaction[];
  existingPeriods: PointsPeriod[];
  closePeriod?: boolean;
  nowIso?: string;
}): PointsPeriod {
  const {
    employeeId,
    monthKey,
    effectiveConfig,
    transactions,
    existingPeriods,
    closePeriod = false,
    nowIso = new Date().toISOString(),
  } = params;

  const existing = existingPeriods.find((p) => p.employeeId === employeeId && p.monthKey === monthKey);
  if (existing && existing.status === 'closed') {
    return existing;
  }

  // Snapshot before month start
  const [yStr, mStr] = monthKey.split('-');
  const monthStartUtc = kyivLocalToUtcIso(Number(yStr), Number(mStr), 1, 0, 0, 0);
  const beforeStartMs = Date.parse(monthStartUtc) - 1;
  const priorState = computeEmployeePointsState(
    employeeId,
    effectiveConfig,
    transactions,
    new Date(beforeStartMs).toISOString()
  );

  const monthTxs = transactions.filter((t) => t.employeeId === employeeId && t.monthKey === monthKey);
  const baseAllocation = monthTxs
    .filter((t) => t.operationType === 'monthly_allocation')
    .reduce((s, t) => s + Math.max(0, t.pointsDelta), 0);
  const earnedPoints = monthTxs
    .filter((t) => t.operationType === 'time_earning' || t.operationType === 'manual_award')
    .reduce((s, t) => s + Math.max(0, t.pointsDelta), 0);
  const deductedPoints = monthTxs
    .filter((t) => t.operationType === 'manual_deduction')
    .reduce((s, t) => s + Math.abs(t.pointsDelta), 0);
  const spentPoints = monthTxs
    .filter((t) => t.operationType === 'reward_spend')
    .reduce((s, t) => s + Math.abs(t.pointsDelta), 0);

  const endMonthKey = addMonthsToMonthKey(monthKey, 1);
  const [eyStr, emStr] = endMonthKey.split('-');
  const endState = computeEmployeePointsState(
    employeeId,
    effectiveConfig,
    transactions,
    new Date(Date.parse(kyivLocalToUtcIso(Number(eyStr), Number(emStr), 1, 0, 0, 0)) - 1).toISOString()
  );

  return {
    id: existing?.id || `period-${employeeId}-${monthKey}`,
    employeeId,
    monthKey,
    baseAllocation,
    debtCarriedIn: priorState.debtCarriedForward,
    earnedPoints,
    deductedPoints,
    spentPoints,
    expiredPoints: endState.expiredPointsCurrentMonth,
    status: closePeriod ? 'closed' : existing?.status || 'open',
    closedAtUtc: closePeriod ? nowIso : existing?.closedAtUtc || '',
    commandId: existing?.commandId || `period:${employeeId}:${monthKey}`,
  };
}

/* ============================================================================
 * Duplicate Incident Detection & Manual Adjustment / Reversal Builders
 * ========================================================================== */

export function detectDuplicateIncident(
  candidate: {
    employeeId: string;
    operationType: PointsReasonOperationType;
    reasonId: string;
    comment: string;
    segmentId?: string;
    monthKey?: string;
  },
  existingTransactions: PointsTransaction[]
): PointsTransaction | null {
  const reversedIds = new Set(
    existingTransactions
      .filter((t) => t.operationType === 'reversal' && t.reversalOfTransactionId)
      .map((t) => t.reversalOfTransactionId as string)
  );
  const normComment = candidate.comment.trim().toLowerCase();
  const targetMonth = candidate.monthKey || getKyivDateParts(new Date()).monthKey;

  return (
    existingTransactions.find((tx) => {
      if (reversedIds.has(tx.id)) return false;
      if (tx.employeeId !== candidate.employeeId) return false;
      if (tx.operationType !== candidate.operationType) return false;
      if (tx.reasonId !== candidate.reasonId) return false;
      if (candidate.segmentId && tx.segmentId && candidate.segmentId === tx.segmentId) {
        return true;
      }
      if (normComment && tx.comment.trim().toLowerCase() === normComment && tx.monthKey === targetMonth) {
        return true;
      }
      return false;
    }) || null
  );
}

export function buildManualAdjustmentTransaction(params: {
  employeeId: string;
  operationType: PointsReasonOperationType;
  amount: number;
  reasonId: string;
  reasonNameSnapshot: string;
  customExplanation?: string;
  comment: string;
  projectId?: string;
  segmentId?: string;
  relatedEmployeeId?: string;
  actorEmployeeId?: string;
  commandId: string;
  positiveGraceMonths?: number;
  occurredAtUtc?: string;
}): { ok: true; transaction: PointsTransaction } | { ok: false; error: string } {
  const {
    employeeId,
    operationType,
    amount,
    reasonId,
    reasonNameSnapshot,
    customExplanation,
    comment,
    projectId,
    segmentId,
    relatedEmployeeId,
    actorEmployeeId,
    commandId,
    positiveGraceMonths = 1,
    occurredAtUtc = new Date().toISOString(),
  } = params;

  if (!employeeId.trim()) return { ok: false, error: 'Оберіть співробітника.' };
  const cleanComment = comment.trim();
  if (!cleanComment) return { ok: false, error: 'Вкажіть обов’язковий коментар до операції.' };
  if (reasonId === OTHER_REASON_ID && !String(customExplanation || '').trim()) {
    return { ok: false, error: 'Для причини «Інше» потрібно вказати пояснення.' };
  }

  let pointsDelta = 0;
  if (operationType === 'neutral_self_report') {
    pointsDelta = 0;
  } else {
    const numAmt = Number(amount);
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      return { ok: false, error: 'Кількість балів має бути більшою за 0.' };
    }
    const cleanAmt = Math.round(numAmt);
    pointsDelta = operationType === 'manual_award' ? cleanAmt : -cleanAmt;
  }

  const monthKey = getKyivDateParts(new Date(occurredAtUtc)).monthKey;
  const fullSnapshot =
    reasonId === OTHER_REASON_ID && customExplanation?.trim()
      ? `Інше: ${customExplanation.trim()}`
      : reasonNameSnapshot.trim() || 'Інше';

  return {
    ok: true,
    transaction: {
      id: `ptx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      employeeId: employeeId.trim(),
      operationType,
      pointsDelta,
      reasonId: reasonId.trim(),
      reasonSnapshot: fullSnapshot,
      comment: cleanComment,
      projectId: projectId?.trim() || '',
      segmentId: segmentId?.trim() || '',
      relatedEmployeeId: relatedEmployeeId?.trim() || '',
      occurredAtUtc,
      createdAtUtc: new Date().toISOString(),
      actorEmployeeId: actorEmployeeId?.trim() || '',
      commandId: commandId.trim(),
      reversalOfTransactionId: '',
      monthKey,
      expiresAtUtc:
        pointsDelta > 0 ? computePositiveExpiryUtc(monthKey, positiveGraceMonths) : '',
    },
  };
}

export function buildReversalTransaction(params: {
  targetTransaction: PointsTransaction;
  comment: string;
  actorEmployeeId?: string;
  commandId: string;
  nowIso?: string;
}): { ok: true; transaction: PointsTransaction } | { ok: false; error: string } {
  const { targetTransaction, comment, actorEmployeeId = '', commandId, nowIso = new Date().toISOString() } = params;
  if (!comment.trim()) {
    return { ok: false, error: 'Вкажіть причину сторнування.' };
  }
  if (targetTransaction.operationType === 'reversal') {
    return { ok: false, error: 'Операцію сторнування не можна сторнувати повторно.' };
  }
  const reverseDelta = -Number(targetTransaction.pointsDelta || 0);
  const monthKey = targetTransaction.monthKey || getKyivDateParts(new Date(nowIso)).monthKey;
  return {
    ok: true,
    transaction: {
      id: `ptx-rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      employeeId: targetTransaction.employeeId,
      operationType: 'reversal',
      pointsDelta: reverseDelta,
      reasonId: targetTransaction.reasonId,
      reasonSnapshot: `Сторно: ${targetTransaction.reasonSnapshot}`,
      comment: comment.trim(),
      projectId: targetTransaction.projectId || '',
      segmentId: targetTransaction.segmentId || '',
      relatedEmployeeId: targetTransaction.relatedEmployeeId || '',
      occurredAtUtc: nowIso,
      createdAtUtc: nowIso,
      actorEmployeeId,
      commandId,
      reversalOfTransactionId: targetTransaction.id,
      monthKey,
      expiresAtUtc: reverseDelta > 0 ? targetTransaction.expiresAtUtc || '' : '',
    },
  };
}

/* ============================================================================
 * Bonus Eligibility, Pricing Overrides, & Claim Lifecycle
 * ========================================================================== */

export function resolveBonusOfferForEmployee(
  bonus: Bonus,
  rules: BonusEligibilityRule[],
  claims: BonusClaim[],
  employeeId: string,
  pointsRole: PointsRoleId
): ResolvedBonusOffer {
  const bonusRules = rules.filter((r) => r.bonusId === bonus.id);
  const empRule = bonusRules.find((r) => r.targetType === 'employee' && r.targetId === employeeId) || null;
  const roleRule = bonusRules.find((r) => r.targetType === 'role' && r.targetId === pointsRole) || null;
  const allRule = bonusRules.find((r) => r.targetType === 'all') || null;

  let matchedRule: BonusEligibilityRule | null = null;
  let matchedBy: ResolvedBonusOffer['matchedBy'] = 'none';

  if (empRule) {
    matchedRule = empRule;
    matchedBy = 'employee';
  } else if (roleRule) {
    matchedRule = roleRule;
    matchedBy = 'role';
  } else if (allRule) {
    matchedRule = allRule;
    matchedBy = 'all';
  } else if (bonusRules.length === 0) {
    // No explicit eligibility rules configured for this bonus yet -> preserve legacy shop visibility
    matchedBy = 'legacy_fallback';
  }

  const isAvailable =
    bonus.isActive !== false &&
    (matchedRule ? matchedRule.active !== false : matchedBy === 'legacy_fallback');

  const hasPriceOverride =
    matchedRule !== null &&
    matchedRule.priceOverride !== null &&
    matchedRule.priceOverride !== undefined;

  const unitPricePoints = hasPriceOverride
    ? Math.max(0, Math.round(Number(matchedRule!.priceOverride)))
    : Math.max(0, Math.round(Number(bonus.requiredPoints) || 0));

  const maxQuantity =
    matchedRule && matchedRule.maxQuantity !== null && matchedRule.maxQuantity !== undefined
      ? Math.max(0, Math.floor(Number(matchedRule.maxQuantity)))
      : null;

  const usedQuantity = claims
    .filter((c) => c.employeeId === employeeId && c.bonusId === bonus.id && c.status !== 'cancelled')
    .reduce((sum, c) => sum + Math.max(1, Number(c.quantity) || 1), 0);

  const remainingQuantity =
    maxQuantity !== null ? Math.max(0, maxQuantity - usedQuantity) : null;

  return {
    bonus,
    isAvailable,
    unitPricePoints,
    hasPriceOverride,
    requiresApproval: matchedRule ? Boolean(matchedRule.requiresApproval) : false,
    maxQuantity,
    usedQuantity,
    remainingQuantity,
    matchedRule,
    matchedBy,
  };
}

export function resolveAllBonusOffersForEmployee(
  bonuses: Bonus[],
  rules: BonusEligibilityRule[],
  claims: BonusClaim[],
  employeeId: string,
  pointsRole: PointsRoleId
): ResolvedBonusOffer[] {
  return bonuses.map((bonus) =>
    resolveBonusOfferForEmployee(bonus, rules, claims, employeeId, pointsRole)
  );
}

export function createBonusClaimTransactionAndRecord(params: {
  employeeId: string;
  offer: ResolvedBonusOffer;
  quantity: number;
  comment?: string;
  availablePoints: number;
  commandId: string;
  existingClaims: BonusClaim[];
  nowIso?: string;
}):
  | { ok: true; claim: BonusClaim; spendTransaction: PointsTransaction }
  | { ok: false; error: string } {
  const {
    employeeId,
    offer,
    quantity,
    comment = '',
    availablePoints,
    commandId,
    existingClaims,
    nowIso = new Date().toISOString(),
  } = params;

  if (existingClaims.some((c) => c.commandId === commandId)) {
    return { ok: false, error: 'Запит на отримання цього бонусу вже опрацьовано (дубльований command_id).' };
  }
  if (!offer.isAvailable) {
    return { ok: false, error: 'Цей бонус недоступний для обраного співробітника.' };
  }
  const cleanQty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (offer.remainingQuantity !== null && cleanQty > offer.remainingQuantity) {
    return {
      ok: false,
      error: `Перевищено максимальний ліміт кількості (${offer.remainingQuantity} доступно).`,
    };
  }
  const totalCost = cleanQty * offer.unitPricePoints;
  if (availablePoints < totalCost) {
    return {
      ok: false,
      error: `Недостатньо балів: потрібно ${totalCost}, доступно ${availablePoints}.`,
    };
  }

  const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const txId = `ptx-spend-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const monthKey = getKyivDateParts(new Date(nowIso)).monthKey;

  const spendTransaction: PointsTransaction = {
    id: txId,
    employeeId,
    operationType: 'reward_spend',
    pointsDelta: -totalCost,
    reasonId: `bonus:${offer.bonus.id}`,
    reasonSnapshot: `Бонус: ${offer.bonus.name} (×${cleanQty})`,
    comment: comment.trim() || `Запит винагороди «${offer.bonus.name}» ×${cleanQty}`,
    occurredAtUtc: nowIso,
    createdAtUtc: nowIso,
    actorEmployeeId: employeeId,
    commandId,
    monthKey,
    expiresAtUtc: '',
  };

  const initialStatus: BonusClaimStatus = offer.requiresApproval ? 'requested' : 'approved';

  const claim: BonusClaim = {
    id: claimId,
    bonusId: offer.bonus.id,
    bonusNameSnapshot: offer.bonus.name,
    employeeId,
    quantity: cleanQty,
    unitPricePoints: offer.unitPricePoints,
    totalPointsCost: totalCost,
    requestedAtUtc: nowIso,
    status: initialStatus,
    fulfilledAtUtc: '',
    comment: comment.trim(),
    commandId,
    updatedAtUtc: nowIso,
    approvedByEmployeeId: initialStatus === 'approved' ? 'system-auto' : '',
    approvedAtUtc: initialStatus === 'approved' ? nowIso : '',
    pointsTransactionId: txId,
    eligibilityId: offer.matchedRule?.id || '',
  };

  return { ok: true, claim, spendTransaction };
}

export function transitionBonusClaimStatus(params: {
  claim: BonusClaim;
  nextStatus: BonusClaimStatus;
  actorEmployeeId?: string;
  comment?: string;
  existingTransactions: PointsTransaction[];
  commandId: string;
  nowIso?: string;
}):
  | { ok: true; updatedClaim: BonusClaim; refundTransaction?: PointsTransaction }
  | { ok: false; error: string } {
  const {
    claim,
    nextStatus,
    actorEmployeeId = '',
    comment = '',
    existingTransactions,
    commandId,
    nowIso = new Date().toISOString(),
  } = params;

  if (claim.status === 'cancelled') {
    return { ok: false, error: 'Запит уже скасовано.' };
  }
  if (claim.status === 'fulfilled' && nextStatus !== 'cancelled') {
    return { ok: false, error: 'Запит уже виконано.' };
  }
  if (nextStatus === 'requested') {
    return { ok: false, error: 'Неможливо повернути запит у статус очікування.' };
  }

  if (nextStatus === 'approved') {
    if (claim.status !== 'requested') {
      return { ok: false, error: 'Погодити можна лише запит у статусі «Очікує підтвердження».' };
    }
    return {
      ok: true,
      updatedClaim: {
        ...claim,
        status: 'approved',
        approvedByEmployeeId: actorEmployeeId || claim.approvedByEmployeeId || '',
        approvedAtUtc: nowIso,
        updatedAtUtc: nowIso,
        comment: comment.trim() ? `${claim.comment ? `${claim.comment} | ` : ''}${comment.trim()}` : claim.comment,
      },
    };
  }

  if (nextStatus === 'fulfilled') {
    return {
      ok: true,
      updatedClaim: {
        ...claim,
        status: 'fulfilled',
        approvedByEmployeeId: claim.approvedByEmployeeId || actorEmployeeId || '',
        approvedAtUtc: claim.approvedAtUtc || nowIso,
        fulfilledAtUtc: nowIso,
        updatedAtUtc: nowIso,
        comment: comment.trim() ? `${claim.comment ? `${claim.comment} | ` : ''}${comment.trim()}` : claim.comment,
      },
    };
  }

  // Cancellation with idempotent refund (cannot refund twice for the same claim)
  const refundCmd = `refund_claim:${claim.id}`;
  const alreadyRefunded = existingTransactions.some(
    (t) =>
      t.operationType === 'reward_refund' &&
      (t.commandId === refundCmd ||
        t.commandId === commandId ||
        (claim.pointsTransactionId && t.reversalOfTransactionId === claim.pointsTransactionId))
  );

  let refundTransaction: PointsTransaction | undefined;
  if (!alreadyRefunded && claim.totalPointsCost > 0) {
    const monthKey = getKyivDateParts(new Date(nowIso)).monthKey;
    refundTransaction = {
      id: `ptx-refund-${claim.id}-${Date.now()}`,
      employeeId: claim.employeeId,
      operationType: 'reward_refund',
      pointsDelta: claim.totalPointsCost,
      reasonId: `bonus:${claim.bonusId}`,
      reasonSnapshot: `Повернення за скасований бонус: ${claim.bonusNameSnapshot}`,
      comment: comment.trim() || `Скасування запиту бонусу ${claim.id}`,
      occurredAtUtc: nowIso,
      createdAtUtc: nowIso,
      actorEmployeeId,
      commandId: refundCmd,
      reversalOfTransactionId: claim.pointsTransactionId || '',
      monthKey,
      expiresAtUtc: '',
    };
  }

  return {
    ok: true,
    updatedClaim: {
      ...claim,
      status: 'cancelled',
      updatedAtUtc: nowIso,
      comment: comment.trim() ? `${claim.comment ? `${claim.comment} | ` : ''}${comment.trim()}` : claim.comment,
    },
    refundTransaction,
  };
}
