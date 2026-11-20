import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CalendarClock,
  CheckCircle2,
  Coins,
  FileWarning,
  Filter,
  Lock,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Employee,
  EmployeePointsProfile,
  PointsAuditSummary,
  PointsPeriod,
  PointsReason,
  PointsReasonOperationType,
  PointsRoleConfig,
  PointsTransaction,
  Project,
  SyncState,
  TimeEntry,
} from '../types';
import {
  buildManualAdjustmentTransaction,
  computeEmployeePointsState,
  detectDuplicateIncident,
  formatKyivDateTime,
  getKyivDateParts,
  OTHER_REASON_ID,
  POINTS_OPERATION_LABELS,
  POINTS_ROLE_LABELS,
  resolveEffectiveEmployeePointsConfig,
} from '../utils/pointsEngine';

interface PointsTeamViewProps {
  employees: Employee[];
  projects: Project[];
  entries: TimeEntry[];
  pointsRoles: PointsRoleConfig[];
  pointsProfiles: EmployeePointsProfile[];
  pointsReasons: PointsReason[];
  pointsTransactions: PointsTransaction[];
  pointsPeriods: PointsPeriod[];
  pointsAudit: PointsAuditSummary | null;
  syncState: SyncState;
  onAddPointsTransaction: (params: {
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
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onReverseTransaction: (params: {
    transactionId: string;
    comment: string;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onEnsureMonthlyAllocations: (monthKey: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  onSyncTimeEarning: () => Promise<{ success: boolean; error?: string; message?: string }>;
  onClosePeriod: (employeeId: string, monthKey: string) => Promise<{ success: boolean; error?: string; message?: string }>;
}

export const PointsTeamView: React.FC<PointsTeamViewProps> = ({
  employees,
  projects,
  entries,
  pointsRoles,
  pointsProfiles,
  pointsReasons,
  pointsTransactions,
  pointsPeriods,
  pointsAudit,
  syncState,
  onAddPointsTransaction,
  onReverseTransaction,
  onEnsureMonthlyAllocations,
  onSyncTimeEarning,
  onClosePeriod,
}) => {
  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
  const selectableEmployees = activeEmployees.length > 0 ? activeEmployees : employees;

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(selectableEmployees[0]?.id || '');
  const [operationType, setOperationType] = useState<PointsReasonOperationType>('manual_award');
  const [reasonId, setReasonId] = useState<string>(OTHER_REASON_ID);
  const [customExplanation, setCustomExplanation] = useState('');
  const [amount, setAmount] = useState<number>(1);
  const [comment, setComment] = useState('');
  const [projectId, setProjectId] = useState('');
  const [relatedEmployeeId, setRelatedEmployeeId] = useState('');
  const [segmentId, setSegmentId] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<PointsTransaction | null>(null);
  const [reverseComment, setReverseComment] = useState('');

  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterOpType, setFilterOpType] = useState<string>('all');
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentKyivMonth = useMemo(() => getKyivDateParts(new Date()).monthKey, []);

  useEffect(() => {
    if (!selectedEmployeeId || !employees.some((e) => e.id === selectedEmployeeId)) {
      setSelectedEmployeeId(selectableEmployees[0]?.id || '');
    }
  }, [employees, selectableEmployees, selectedEmployeeId]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const effectiveConfig = useMemo(() => {
    if (!selectedEmployeeId) return null;
    return resolveEffectiveEmployeePointsConfig(selectedEmployeeId, pointsRoles, pointsProfiles);
  }, [selectedEmployeeId, pointsRoles, pointsProfiles]);

  const summary = useMemo(() => {
    if (!selectedEmployeeId || !effectiveConfig) return null;
    return computeEmployeePointsState(selectedEmployeeId, effectiveConfig, pointsTransactions);
  }, [selectedEmployeeId, effectiveConfig, pointsTransactions]);

  const filteredReasons = useMemo(() => {
    if (!effectiveConfig) return [];
    return pointsReasons
      .filter(
        (r) =>
          r.active &&
          r.operationType === operationType &&
          (r.allowedRoles.length === 0 || r.allowedRoles.includes(effectiveConfig.pointsRole))
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [pointsReasons, operationType, effectiveConfig]);

  useEffect(() => {
    if (filteredReasons.length > 0) {
      const first = filteredReasons[0];
      setReasonId(first.id);
      setAmount(operationType === 'neutral_self_report' ? 0 : Math.max(1, first.defaultPoints || 1));
    } else {
      setReasonId(OTHER_REASON_ID);
      setAmount(operationType === 'neutral_self_report' ? 0 : 1);
    }
  }, [operationType, selectedEmployeeId, filteredReasons.length]);

  const handleSelectReason = (nextId: string) => {
    setReasonId(nextId);
    if (nextId === OTHER_REASON_ID) {
      setAmount(operationType === 'neutral_self_report' ? 0 : 1);
      return;
    }
    const found = filteredReasons.find((r) => r.id === nextId);
    if (found) {
      setAmount(operationType === 'neutral_self_report' ? 0 : Math.max(1, found.defaultPoints || 1));
    }
  };

  const employeeMonths = useMemo(() => {
    const set = new Set<string>([currentKyivMonth]);
    pointsTransactions
      .filter((t) => t.employeeId === selectedEmployeeId && t.monthKey)
      .forEach((t) => set.add(t.monthKey));
    return Array.from(set).sort().reverse();
  }, [pointsTransactions, selectedEmployeeId, currentKyivMonth]);

  const reversedTxIds = useMemo(() => {
    const s = new Set<string>();
    pointsTransactions.forEach((t) => {
      if (t.operationType === 'reversal' && t.reversalOfTransactionId) {
        s.add(t.reversalOfTransactionId);
      }
    });
    return s;
  }, [pointsTransactions]);

  const filteredLedger = useMemo(() => {
    return pointsTransactions
      .filter((t) => t.employeeId === selectedEmployeeId)
      .filter((t) => filterMonth === 'all' || t.monthKey === filterMonth)
      .filter((t) => filterOpType === 'all' || t.operationType === filterOpType)
      .sort((a, b) => (b.occurredAtUtc || b.createdAtUtc || '').localeCompare(a.occurredAtUtc || a.createdAtUtc || ''));
  }, [pointsTransactions, selectedEmployeeId, filterMonth, filterOpType]);

  const duplicateWarning = useMemo(() => {
    if (!selectedEmployeeId || !comment.trim()) return null;
    return detectDuplicateIncident(
      {
        employeeId: selectedEmployeeId,
        operationType,
        reasonId,
        comment,
        segmentId: segmentId || undefined,
        monthKey: currentKyivMonth,
      },
      pointsTransactions
    );
  }, [selectedEmployeeId, operationType, reasonId, comment, segmentId, currentKyivMonth, pointsTransactions]);

  const selectedReasonObj = useMemo(
    () => filteredReasons.find((r) => r.id === reasonId) || null,
    [filteredReasons, reasonId]
  );

  const previewDelta = useMemo(() => {
    if (operationType === 'neutral_self_report') return 0;
    const clean = Math.max(0, Math.round(Number(amount) || 0));
    return operationType === 'manual_award' ? clean : -clean;
  }, [operationType, amount]);

  const isCurrentPeriodClosed = useMemo(
    () =>
      pointsPeriods.some(
        (p) => p.employeeId === selectedEmployeeId && p.monthKey === currentKyivMonth && p.status === 'closed'
      ),
    [pointsPeriods, selectedEmployeeId, currentKyivMonth]
  );

  const recentSegmentsForEmployee = useMemo(
    () => entries.filter((e) => e.employeeId === selectedEmployeeId).slice(0, 30),
    [entries, selectedEmployeeId]
  );

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusFeedback(null);
    const validation = buildManualAdjustmentTransaction({
      employeeId: selectedEmployeeId,
      operationType,
      amount: operationType === 'neutral_self_report' ? 0 : amount,
      reasonId,
      reasonNameSnapshot: selectedReasonObj?.name || 'Інше',
      customExplanation,
      comment,
      projectId,
      segmentId,
      relatedEmployeeId,
      commandId: 'validate-only',
    });
    if (validation.ok === false) {
      setStatusFeedback({ type: 'error', text: validation.error });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    try {
      const res = await onAddPointsTransaction({
        employeeId: selectedEmployeeId,
        operationType,
        amount: operationType === 'neutral_self_report' ? 0 : Math.max(1, Math.round(Number(amount) || 1)),
        reasonId,
        reasonSnapshot: selectedReasonObj?.name || 'Інше',
        customExplanation: reasonId === OTHER_REASON_ID ? customExplanation.trim() : undefined,
        comment: comment.trim(),
        projectId: projectId || undefined,
        segmentId: segmentId || undefined,
        relatedEmployeeId: relatedEmployeeId || undefined,
      });
      setConfirmOpen(false);
      if (res.success) {
        setStatusFeedback({ type: 'success', text: res.message || 'Операцію збережено в журналі балів.' });
        setComment('');
        setCustomExplanation('');
        setSegmentId('');
        setRelatedEmployeeId('');
      } else {
        setStatusFeedback({ type: 'error', text: res.error || 'Не вдалося зберегти операцію.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTarget) return;
    if (!reverseComment.trim()) {
      setStatusFeedback({ type: 'error', text: 'Вкажіть обов’язковий коментар для сторнування.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await onReverseTransaction({
        transactionId: reverseTarget.id,
        comment: reverseComment.trim(),
      });
      if (res.success) {
        setStatusFeedback({ type: 'success', text: res.message || 'Операцію сторновано.' });
        setReverseTarget(null);
        setReverseComment('');
      } else {
        setStatusFeedback({ type: 'error', text: res.error || 'Помилка сторнування.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActionRun = async (fn: () => Promise<{ success: boolean; error?: string; message?: string }>) => {
    setIsSubmitting(true);
    setStatusFeedback(null);
    try {
      const res = await fn();
      if (res.success) {
        setStatusFeedback({ type: 'success', text: res.message || 'Операцію виконано.' });
      } else {
        setStatusFeedback({ type: 'error', text: res.error || 'Операцію заблоковано сервером.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (employees.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="bg-bg-1 border border-border-default rounded-3xl p-8 text-center space-y-2">
          <Coins className="w-8 h-8 text-accent mx-auto opacity-80" />
          <h2 className="text-base font-bold text-fg">Немає співробітників у команді</h2>
          <p className="text-xs text-gray-2">
            Додайте співробітників у розділі «Оцінка команди» або завантажте таблицю в «Налаштуваннях».
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border-default pb-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <Coins className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Бали команди та журнал операцій</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            Незалежні гаманці балів, нарахування за час керівникам, ручні коригування, самозвіти та аудит.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Обраний співробітник"
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            className="bg-bg-1 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
                {emp.status === 'archived' ? ' (архів)' : ''}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleActionRun(() => onEnsureMonthlyAllocations(currentKyivMonth))}
            className="px-3.5 py-2 rounded-xl bg-bg-1 hover:bg-border-default border border-border-default text-xs font-medium text-fg flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <CalendarClock className="w-3.5 h-3.5 text-accent" />
            <span>Нарахувати базу ({currentKyivMonth})</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleActionRun(onSyncTimeEarning)}
            className="px-3.5 py-2 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/30 text-xs font-semibold text-accent flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
            <span>Синхронізувати бали за час</span>
          </button>
        </div>
      </div>

      {/* Schema / Authorization / Runtime Notice */}
      {syncState.runtimeMode === 'gas_hosted' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3 text-xs">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-gray-2">
            <div className="font-semibold text-amber-300">
              Серверний захист запису у Google Apps Script (fail-closed)
            </div>
            <p className="leading-relaxed">
              Привілейовані мутації балів перевіряються на сервері Apps Script за підтвердженим Google-обліковцем
              власника/редактора таблиці. Призначена роль «Керівник» у таблиці визначає лише правила нарахування балів і
              не надає прав адміністратора. За анонімного веб-розгортання («Усі» / проксі) сервер заблокує запис із
              помилкою авторизації, не приймаючи підроблений ID виконавця з клієнта.
            </p>
          </div>
        </div>
      )}

      {pointsAudit && !pointsAudit.schemaReady && pointsAudit.missingSheets.length > 0 && (
        <div className="bg-danger/10 border border-danger/30 rounded-2xl p-4 flex items-start gap-3 text-xs text-danger">
          <FileWarning className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            У підключеній Google Таблиці відсутні аркуші системи балів: {pointsAudit.missingSheets.join(', ')}. Читання
            працює у сумісному режимі, але запис операцій балів до таблиці заблоковано.
          </div>
        </div>
      )}

      {statusFeedback && (
        <div
          className={`rounded-2xl p-3.5 text-xs flex items-start gap-2.5 border ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          {statusFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{statusFeedback.text}</span>
        </div>
      )}

      {/* Selected Employee Header & Summary Cards */}
      {selectedEmployee && effectiveConfig && summary && (
        <>
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-fg">{selectedEmployee.name}</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent/15 text-accent border border-accent/25">
                  {POINTS_ROLE_LABELS[effectiveConfig.pointsRole]}
                </span>
                {selectedEmployee.role && (
                  <span className="text-xs text-gray-2">• {selectedEmployee.role}</span>
                )}
                {!effectiveConfig.pointsEnabled && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-danger/15 text-danger border border-danger/30">
                    Бали вимкнено
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>Місячна база: {effectiveConfig.monthlyBasePoints} б.</span>
                <span>
                  Бали за час:{' '}
                  {effectiveConfig.timeEarningEnabled
                    ? `Так (${effectiveConfig.minutesPerPoint} хв/бал)`
                    : 'Ні'}
                </span>
                <span>Термін дії: +{effectiveConfig.positiveGraceMonths} міс. (Europe/Kyiv)</span>
              </div>
            </div>

            {!isCurrentPeriodClosed ? (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleActionRun(() => onClosePeriod(selectedEmployee.id, currentKyivMonth))}
                className="px-3.5 py-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-xs text-gray-2 hover:text-fg flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Закрити період {currentKyivMonth}</span>
              </button>
            ) : (
              <span className="px-3 py-1.5 rounded-xl bg-bg-2 border border-border-default text-xs text-amber-300 flex items-center gap-1.5 shrink-0">
                <Lock className="w-3.5 h-3.5" />
                <span>Період {currentKyivMonth} закрито</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-bg-1 border border-border-default rounded-2xl p-4">
              <div className="text-[11px] text-gray-2">Доступно зараз</div>
              <div className="text-2xl font-extrabold text-accent tabular-nums mt-1">{summary.availablePoints}</div>
              {summary.debtCarriedForward > 0 && (
                <div className="text-[10px] text-danger mt-0.5 tabular-nums">
                  Борг: -{summary.debtCarriedForward} б.
                </div>
              )}
            </div>

            <div className="bg-bg-1 border border-border-default rounded-2xl p-4">
              <div className="text-[11px] text-gray-2">Місячна база</div>
              <div className="text-xl font-bold text-fg tabular-nums mt-1">
                {summary.monthlyAllocatedPoints}
                <span className="text-xs font-normal text-gray-2"> / {summary.monthlyBasePoints}</span>
              </div>
              <div className="text-[10px] text-gray-1 mt-0.5">{summary.currentMonthKey}</div>
            </div>

            <div className="bg-bg-1 border border-border-default rounded-2xl p-4">
              <div className="text-[11px] text-gray-2">Нараховано (міс.)</div>
              <div className="text-xl font-bold text-emerald-400 tabular-nums mt-1">
                +{summary.earnedPointsCurrentMonth}
              </div>
              <div className="text-[10px] text-gray-1 mt-0.5 tabular-nums">Всього: +{summary.earnedPointsTotal}</div>
            </div>

            <div className="bg-bg-1 border border-border-default rounded-2xl p-4">
              <div className="text-[11px] text-gray-2">Списано (міс.)</div>
              <div className="text-xl font-bold text-danger tabular-nums mt-1">
                -{summary.deductedPointsCurrentMonth}
              </div>
              <div className="text-[10px] text-gray-1 mt-0.5 tabular-nums">Всього: -{summary.deductedPointsTotal}</div>
            </div>

            <div className="bg-bg-1 border border-border-default rounded-2xl p-4">
              <div className="text-[11px] text-gray-2">Витрачено на бонуси</div>
              <div className="text-xl font-bold text-fg tabular-nums mt-1">{summary.spentPointsTotal}</div>
              <div className="text-[10px] text-gray-1 mt-0.5 tabular-nums">
                Самозвіти: {summary.neutralReportCount}
              </div>
            </div>

            <div className="bg-bg-1 border border-border-default rounded-2xl p-4">
              <div className="text-[11px] text-gray-2">Згорає найближче</div>
              <div className="text-xl font-bold text-amber-400 tabular-nums mt-1">{summary.expiringSoonPoints}</div>
              <div className="text-[10px] text-gray-1 mt-0.5 truncate" title={summary.nextExpiryAtUtc || ''}>
                {summary.nextExpiryAtUtc ? formatKyivDateTime(summary.nextExpiryAtUtc) : 'Немає активних'}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Main Content: Adjustment Form + Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Operation Form */}
        <form
          onSubmit={handleOpenConfirm}
          className="xl:col-span-5 bg-bg-1 border border-border-default rounded-3xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider">Нова операція</h3>
            {summary && (
              <span className="text-xs text-gray-2 tabular-nums">
                Після операції:{' '}
                <strong className="text-fg">{summary.netBalance + previewDelta} б.</strong>
              </span>
            )}
          </div>

          {/* Operation Type Switch */}
          <div className="grid grid-cols-3 gap-1.5 bg-bg-2 p-1 rounded-xl border border-border-default">
            <button
              type="button"
              onClick={() => setOperationType('manual_award')}
              className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                operationType === 'manual_award'
                  ? 'bg-emerald-600 text-fg shadow'
                  : 'text-gray-2 hover:text-fg'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Нарахувати</span>
            </button>
            <button
              type="button"
              onClick={() => setOperationType('manual_deduction')}
              className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                operationType === 'manual_deduction'
                  ? 'bg-danger text-fg shadow'
                  : 'text-gray-2 hover:text-fg'
              }`}
            >
              <MinusCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Списати</span>
            </button>
            <button
              type="button"
              onClick={() => setOperationType('neutral_self_report')}
              className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                operationType === 'neutral_self_report'
                  ? 'bg-accent text-bg-1 shadow'
                  : 'text-gray-2 hover:text-fg'
              }`}
            >
              <Award className="w-3.5 h-3.5 shrink-0" />
              <span>Самозвіт 0</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs text-gray-2 block">Причина</label>
              <select
                value={reasonId}
                onChange={(e) => handleSelectReason(e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
              >
                {filteredReasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.operationType !== 'neutral_self_report' ? ` (${r.defaultPoints} б.)` : ''}
                  </option>
                ))}
                <option value={OTHER_REASON_ID}>Інше (власне пояснення)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Кількість балів</label>
              <input
                type="number"
                min={operationType === 'neutral_self_report' ? 0 : 1}
                disabled={operationType === 'neutral_self_report'}
                value={operationType === 'neutral_self_report' ? 0 : amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono tabular-nums focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>
          </div>

          {reasonId === OTHER_REASON_ID && (
            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Пояснення для причини «Інше» *</label>
              <input
                type="text"
                required
                value={customExplanation}
                onChange={(e) => setCustomExplanation(e.target.value)}
                placeholder="Вкажіть конкретну причину операції..."
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Коментар (обов’язково) *</label>
            <textarea
              rows={2}
              required
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Деталі інциденту, допомоги або коригування..."
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Проєкт (опційно)</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="">Без проєкту</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Пов’язаний співробітник (опційно)</label>
              <select
                value={relatedEmployeeId}
                onChange={(e) => setRelatedEmployeeId(e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="">Не вказано</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {recentSegmentsForEmployee.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Пов’язаний запис часу (опційно)</label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="">Без прив’язки до сегмента</option>
                {recentSegmentsForEmployee.map((seg) => (
                  <option key={seg.id} value={seg.id}>
                    {seg.date} · {seg.startTime} ({seg.durationMinutes} хв) — {seg.description}
                  </option>
                ))}
              </select>
            </div>
          )}

          {duplicateWarning && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-[11px] text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                Можливий дублікат інциденту: схожа операція «{duplicateWarning.reasonSnapshot}» вже записана{' '}
                {formatKyivDateTime(duplicateWarning.occurredAtUtc)}.
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || isCurrentPeriodClosed || !effectiveConfig?.pointsEnabled}
            className="w-full py-3 rounded-2xl bg-accent hover:bg-accent/90 text-bg-1 font-bold text-xs shadow-lg shadow-accent/20 transition-all cursor-pointer disabled:opacity-50"
          >
            {isCurrentPeriodClosed
              ? `Період ${currentKyivMonth} закрито`
              : 'Переглянути та підтвердити операцію'}
          </button>
        </form>

        {/* Ledger History */}
        <div className="xl:col-span-7 bg-bg-1 border border-border-default rounded-3xl overflow-hidden shadow-xl">
          <div className="p-4 sm:p-5 border-b border-border-default flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm font-bold text-fg flex items-center gap-2">
              <Filter className="w-4 h-4 text-accent" />
              <span>Журнал операцій балів ({filteredLedger.length})</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Фільтр місяця"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="bg-bg-2 border border-border-default rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="all">Усі місяці</option>
                {employeeMonths.map((mk) => (
                  <option key={mk} value={mk}>
                    {mk}
                  </option>
                ))}
              </select>

              <select
                aria-label="Фільтр типу операції"
                value={filterOpType}
                onChange={(e) => setFilterOpType(e.target.value)}
                className="bg-bg-2 border border-border-default rounded-xl px-3 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="all">Усі типи</option>
                {Object.entries(POINTS_OPERATION_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="divide-y divide-border-default max-h-[620px] overflow-y-auto">
            {filteredLedger.length === 0 ? (
              <div className="p-10 text-center text-xs text-gray-1">
                Для обраного співробітника та фільтрів операцій балів ще немає.
              </div>
            ) : (
              filteredLedger.map((tx) => {
                const isPositive = tx.pointsDelta > 0;
                const isNeutral = tx.pointsDelta === 0;
                const isReversed = reversedTxIds.has(tx.id);
                const relEmp = tx.relatedEmployeeId
                  ? employees.find((e) => e.id === tx.relatedEmployeeId)
                  : null;
                const proj = tx.projectId ? projects.find((p) => p.id === tx.projectId) : null;
                const periodClosed = pointsPeriods.some(
                  (p) => p.employeeId === tx.employeeId && p.monthKey === tx.monthKey && p.status === 'closed'
                );

                return (
                  <div key={tx.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-bg-2 border border-border-default text-gray-2">
                          {POINTS_OPERATION_LABELS[tx.operationType] || tx.operationType}
                        </span>
                        <span className="text-xs font-bold text-fg">{tx.reasonSnapshot}</span>
                        {isReversed && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                            Сторновано
                          </span>
                        )}
                      </div>

                      {tx.comment && <p className="text-xs text-gray-2 break-words">{tx.comment}</p>}

                      <div className="text-[10px] text-gray-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                        <span>{formatKyivDateTime(tx.occurredAtUtc || tx.createdAtUtc)}</span>
                        <span>Період: {tx.monthKey}</span>
                        {proj && <span>Проєкт: {proj.name}</span>}
                        {relEmp && <span>Колега: {relEmp.name}</span>}
                        {tx.expiresAtUtc && isPositive && <span>Діє до: {formatKyivDateTime(tx.expiresAtUtc)}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      <span
                        className={`text-sm font-extrabold font-mono tabular-nums flex items-center gap-1 ${
                          isNeutral ? 'text-gray-2' : isPositive ? 'text-emerald-400' : 'text-danger'
                        }`}
                      >
                        {isPositive ? (
                          <TrendingUp className="w-3.5 h-3.5" />
                        ) : !isNeutral ? (
                          <TrendingDown className="w-3.5 h-3.5" />
                        ) : null}
                        {isPositive ? `+${tx.pointsDelta}` : tx.pointsDelta}
                      </span>

                      {tx.operationType !== 'reversal' && !isReversed && !periodClosed && (
                        <button
                          type="button"
                          onClick={() => {
                            setReverseTarget(tx);
                            setReverseComment('');
                          }}
                          title="Сторнувати операцію"
                          className="p-1.5 rounded-lg bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-1 border border-border-default rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-fg">Підтвердження операції балів</h3>
            <div className="bg-bg-2 border border-border-default rounded-2xl p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-2">Співробітник:</span>
                <span className="font-semibold text-fg">{selectedEmployee?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-2">Тип:</span>
                <span className="font-semibold text-fg">{POINTS_OPERATION_LABELS[operationType]}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-2">Причина:</span>
                <span className="font-semibold text-fg">
                  {reasonId === OTHER_REASON_ID ? `Інше: ${customExplanation}` : selectedReasonObj?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-2">Зміна балансу:</span>
                <span className={`font-bold ${previewDelta >= 0 ? 'text-emerald-400' : 'text-danger'}`}>
                  {previewDelta > 0 ? `+${previewDelta}` : previewDelta} б.
                </span>
              </div>
              {summary && (
                <div className="flex justify-between border-t border-border-default pt-2">
                  <span className="text-gray-2">Новий чистий баланс:</span>
                  <span className="font-bold text-accent">{summary.netBalance + previewDelta} б.</span>
                </div>
              )}
            </div>

            {duplicateWarning && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                Увага: вже є запис із цією ж причиною та коментарем. Ви впевнені, що це окремий випадок?
              </div>
            )}

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-bg-2 border border-border-default text-xs text-gray-2 hover:text-fg cursor-pointer"
              >
                Скасувати
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmSubmit}
                className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                Підтвердити запис
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reversal Modal */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmReverse}
            className="bg-bg-1 border border-border-default rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-fg">Сторнувати операцію</h3>
            <p className="text-xs text-gray-2">
              Створиться компенсуючий запис на суму{' '}
              <strong className="text-fg">{-reverseTarget.pointsDelta} б.</strong> для «{reverseTarget.reasonSnapshot}».
              Вихідний рядок журналу залишається незмінним.
            </p>
            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Причина сторнування *</label>
              <textarea
                rows={2}
                required
                value={reverseComment}
                onChange={(e) => setReverseComment(e.target.value)}
                placeholder="Наприклад: помилкове дублювання або уточнення умов..."
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="px-4 py-2 rounded-xl bg-bg-2 border border-border-default text-xs text-gray-2 hover:text-fg cursor-pointer"
              >
                Скасувати
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-danger hover:bg-danger/90 text-fg text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                Сторнувати
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
