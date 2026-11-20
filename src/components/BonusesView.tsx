import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Gift,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Upload,
  User,
  XCircle,
} from 'lucide-react';
import {
  Bonus,
  BonusClaim,
  BonusClaimStatus,
  BonusEligibilityRule,
  Employee,
  EmployeePointsProfile,
  PointsRoleConfig,
  PointsTransaction,
  SyncState,
} from '../types';
import { resolveAssetUrl } from '../utils/assetResolver';
import { getDefaultEmployeeId } from '../utils/teamUtils';
import {
  CLAIM_STATUS_LABELS,
  computeEmployeePointsState,
  formatKyivDateTime,
  POINTS_ROLE_LABELS,
  resolveAllBonusOffersForEmployee,
  resolveEffectiveEmployeePointsConfig,
} from '../utils/pointsEngine';

interface BonusesViewProps {
  bonuses: Bonus[];
  employees: Employee[];
  pointsRoles: PointsRoleConfig[];
  pointsProfiles: EmployeePointsProfile[];
  pointsTransactions: PointsTransaction[];
  bonusEligibility: BonusEligibilityRule[];
  bonusClaims: BonusClaim[];
  syncState: SyncState;
  onClaimBonusForEmployee: (params: {
    employeeId: string;
    bonusId: string;
    quantity: number;
    comment?: string;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onTransitionBonusClaim: (params: {
    claimId: string;
    nextStatus: BonusClaimStatus;
    comment?: string;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onUpdateBonusImage: (id: string, imageUrl: string) => void;
}

export const BonusesView: React.FC<BonusesViewProps> = ({
  bonuses,
  employees,
  pointsRoles,
  pointsProfiles,
  pointsTransactions,
  bonusEligibility,
  bonusClaims,
  syncState,
  onClaimBonusForEmployee,
  onTransitionBonusClaim,
  onUpdateBonusImage,
}) => {
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees]
  );
  const defaultEmpId = useMemo(() => getDefaultEmployeeId(employees), [employees]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(defaultEmpId);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [showUnavailable, setShowUnavailable] = useState<boolean>(false);
  const [claimsScope, setClaimsScope] = useState<'selected' | 'all'>('selected');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmCancelClaim, setConfirmCancelClaim] = useState<BonusClaim | null>(null);

  useEffect(() => {
    if (!employees.some((e) => e.id === selectedEmployeeId) && defaultEmpId) {
      setSelectedEmployeeId(defaultEmpId);
    }
  }, [employees, selectedEmployeeId, defaultEmpId]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) || activeEmployees[0] || employees[0] || null,
    [employees, activeEmployees, selectedEmployeeId]
  );

  const effectiveConfig = useMemo(() => {
    if (!selectedEmployee) return null;
    return resolveEffectiveEmployeePointsConfig(selectedEmployee.id, pointsRoles, pointsProfiles);
  }, [selectedEmployee, pointsProfiles, pointsRoles]);

  const pointsState = useMemo(() => {
    if (!selectedEmployee || !effectiveConfig) return null;
    return computeEmployeePointsState(selectedEmployee.id, effectiveConfig, pointsTransactions);
  }, [selectedEmployee, effectiveConfig, pointsTransactions]);

  const bonusOffers = useMemo(() => {
    if (!selectedEmployee || !effectiveConfig) return [];
    const allOffers = resolveAllBonusOffersForEmployee(
      bonuses,
      bonusEligibility,
      bonusClaims,
      selectedEmployee.id,
      effectiveConfig.pointsRole
    );
    return showUnavailable ? allOffers : allOffers.filter((offer) => offer.isAvailable);
  }, [bonuses, bonusEligibility, bonusClaims, selectedEmployee, effectiveConfig, showUnavailable]);

  const visibleClaims = useMemo(() => {
    const filtered =
      claimsScope === 'selected' && selectedEmployee
        ? bonusClaims.filter((c) => c.employeeId === selectedEmployee.id)
        : bonusClaims;
    return [...filtered].sort((a, b) =>
      (b.requestedAtUtc || b.updatedAtUtc || '').localeCompare(a.requestedAtUtc || a.updatedAtUtc || '')
    );
  }, [bonusClaims, claimsScope, selectedEmployee]);

  const handleImageUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (result) {
          onUpdateBonusImage(id, result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClaim = async (bonusId: string) => {
    if (!selectedEmployee) return;
    setFeedback(null);
    const qty = Math.max(1, Math.floor(quantities[bonusId] || 1));
    const comment = comments[bonusId] || '';
    setBusyKey(`claim:${bonusId}`);
    try {
      const res = await onClaimBonusForEmployee({
        employeeId: selectedEmployee.id,
        bonusId,
        quantity: qty,
        comment,
      });
      if (res.success) {
        setComments((prev) => ({ ...prev, [bonusId]: '' }));
        setQuantities((prev) => ({ ...prev, [bonusId]: 1 }));
        setFeedback({
          type: 'success',
          text: res.message || 'Запит на отримання бонусу оформлено.',
        });
      } else {
        setFeedback({
          type: 'error',
          text: res.error || 'Не вдалося отримати бонус.',
        });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleTransition = async (claimId: string, nextStatus: BonusClaimStatus) => {
    setFeedback(null);
    setBusyKey(`transition:${claimId}:${nextStatus}`);
    try {
      const res = await onTransitionBonusClaim({ claimId, nextStatus });
      if (res.success) {
        setConfirmCancelClaim(null);
        setFeedback({
          type: 'success',
          text: res.message || 'Статус винагороди оновлено.',
        });
      } else {
        setFeedback({
          type: 'error',
          text: res.error || 'Не вдалося оновити статус запиту.',
        });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const isGasMode = syncState.runtimeMode === 'gas_hosted';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header & Employee Wallet Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <Award className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Магазин бонусів та винагород</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            Персональний гаманець балів, цінові правила за ролями та прозора історія погодження винагород.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-bg-1 border border-border-default rounded-2xl px-3.5 py-2">
            <User className="w-4 h-4 text-accent shrink-0" />
            <label htmlFor="bonuses-employee-select" className="sr-only">
              Оберіть співробітника
            </label>
            <select
              id="bonuses-employee-select"
              value={selectedEmployee?.id || ''}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-fg focus:outline-none min-w-[160px]"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id} className="bg-bg-2 text-fg">
                  {emp.name}
                  {emp.status === 'archived' ? ' (архів)' : ''}
                </option>
              ))}
            </select>
            {effectiveConfig && (
              <span
                className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border shrink-0 ${
                  effectiveConfig.pointsRole === 'manager'
                    ? 'bg-accent/15 text-accent border-accent/30'
                    : 'bg-bg-2 text-gray-2 border-border-default'
                }`}
              >
                {POINTS_ROLE_LABELS[effectiveConfig.pointsRole]}
              </span>
            )}
          </div>

          {pointsState && (
            <div className="bg-bg-1 border border-border-default px-4 sm:px-5 py-2.5 rounded-2xl flex items-center justify-around sm:justify-start gap-4 shrink-0">
              <div>
                <div className="text-[10px] text-gray-2 font-medium">Доступно балів</div>
                <div className="text-lg font-extrabold text-accent tabular-nums">
                  {pointsState.availablePoints} <span className="text-xs font-normal text-gray-2">б.</span>
                </div>
              </div>
              <div className="w-px h-8 bg-border-default" />
              <div>
                <div className="text-[10px] text-gray-2 font-medium">
                  {pointsState.debtCarriedForward > 0 ? 'Борг (перенесено)' : 'Скоро згорить'}
                </div>
                {pointsState.debtCarriedForward > 0 ? (
                  <div className="text-sm font-bold text-danger tabular-nums">
                    -{pointsState.debtCarriedForward} б.
                  </div>
                ) : (
                  <div className="text-sm font-bold text-fg tabular-nums">
                    {pointsState.expiringSoonPoints} б.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GAS Security Notice for Privileged / Protected Mutations */}
      {isGasMode && (
        <div className="bg-bg-1 border border-amber-500/30 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-xs">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-gray-2">
            <div className="font-semibold text-fg">
              Захист серверних операцій балів і бонусів у Google Apps Script
            </div>
            <p className="leading-relaxed">
              Погодження, виконання, скасування та видача бонусів перевіряються на сервері через особу Google (
              <code className="text-accent">Session.getActiveUser().getEmail()</code>). Якщо вебпрограма
              опублікована анонімно, сервер відхилить захищену мутацію з кодом{' '}
              <code className="text-amber-300">AUTH_REQUIRED_PRIVILEGED_MUTATION</code> — без підміни ролями.
            </p>
          </div>
        </div>
      )}

      {feedback && (
        <div
          role="alert"
          className={`rounded-2xl px-4 py-3 text-xs flex items-center gap-2.5 border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-2">
          Показано пропозицій для{' '}
          <span className="font-semibold text-fg">{selectedEmployee?.name || '—'}</span>:{' '}
          <span className="font-bold text-accent tabular-nums">{bonusOffers.length}</span>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-gray-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showUnavailable}
            onChange={(e) => setShowUnavailable(e.target.checked)}
            className="rounded border-border-default bg-bg-2 text-accent focus:ring-accent"
          />
          <span>Показати приховані / недоступні для цієї ролі</span>
        </label>
      </div>

      {/* Bonuses Grid */}
      {bonusOffers.length === 0 ? (
        <div className="bg-bg-1 border border-border-default rounded-3xl p-8 text-center text-xs text-gray-1 space-y-2">
          <Gift className="w-8 h-8 mx-auto opacity-60" />
          <div>Для обраного співробітника немає доступних бонусів за поточними правилами доступності.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {bonusOffers.map((offer) => {
            const { bonus } = offer;
            const qty = Math.max(1, Math.floor(quantities[bonus.id] || 1));
            const totalCost = qty * offer.unitPricePoints;
            const availablePts = pointsState?.availablePoints ?? 0;
            const pointsEnabled = effectiveConfig?.pointsEnabled !== false;
            const limitOk = offer.remainingQuantity === null || qty <= offer.remainingQuantity;
            const canAfford = pointsEnabled && offer.isAvailable && limitOk && availablePts >= totalCost;
            const resolvedUrl = bonus.imageUrl ? resolveAssetUrl(bonus.imageUrl) : '';
            const showImage = Boolean(resolvedUrl && !brokenImages[`${bonus.id}:${resolvedUrl}`]);
            const isClaiming = busyKey === `claim:${bonus.id}`;

            return (
              <div
                key={bonus.id}
                className={`bg-bg-1 border rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between transition-all ${
                  offer.isAvailable
                    ? 'border-border-default hover:border-accent/40 group'
                    : 'border-border-default/60 opacity-75'
                }`}
              >
                <div>
                  {/* Bonus Image & Price Badge */}
                  <div className="relative h-44 bg-bg-2 overflow-hidden flex items-center justify-center">
                    {showImage ? (
                      <img
                        src={resolvedUrl}
                        alt={bonus.name}
                        referrerPolicy="no-referrer"
                        onError={() => {
                          setBrokenImages((prev) => ({
                            ...prev,
                            [`${bonus.id}:${resolvedUrl}`]: true,
                          }));
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1.5 text-gray-1 px-4 text-center">
                        <Gift className="w-8 h-8 opacity-60" />
                        <span className="text-[11px]">Зображення бонусу не призначено</span>
                      </div>
                    )}

                    <div className="absolute top-3 right-3 bg-bg-2/95 backdrop-blur-md border border-border-default px-3 py-1 rounded-full text-xs font-bold text-accent tabular-nums flex items-center gap-1.5">
                      {offer.hasPriceOverride && offer.unitPricePoints !== bonus.requiredPoints && (
                        <span className="line-through text-gray-1 font-normal text-[11px]">
                          {bonus.requiredPoints}
                        </span>
                      )}
                      <span>{offer.unitPricePoints} б.</span>
                    </div>

                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-md border ${
                          offer.requiresApproval
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {offer.requiresApproval ? 'Потрібно погодження' : 'Автопогодження'}
                      </span>
                    </div>

                    <label
                      className="absolute bottom-3 right-3 bg-bg-2/90 hover:bg-accent text-gray-2 hover:text-bg-1 p-2 rounded-xl backdrop-blur-md border border-border-default transition-colors cursor-pointer"
                      title="Змінити зображення бонусу"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(bonus.id, e)}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="p-4 sm:p-5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-fg">{bonus.name}</h3>
                      {!offer.isAvailable && (
                        <span className="text-[10px] bg-bg-2 border border-border-default text-gray-1 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Недоступно
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-2 leading-relaxed">{bonus.description}</p>

                    {offer.maxQuantity !== null && (
                      <div className="text-[11px] text-gray-2 flex items-center justify-between bg-bg-2 px-3 py-1.5 rounded-xl border border-border-default">
                        <span>Ліміт кількості</span>
                        <span className="font-semibold text-fg tabular-nums">
                          Залишилось {offer.remainingQuantity} з {offer.maxQuantity}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 sm:p-5 pt-0 space-y-3">
                  {offer.isAvailable && (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label
                          htmlFor={`bonus-qty-${bonus.id}`}
                          className="block text-[10px] text-gray-2 mb-1"
                        >
                          Кількість
                        </label>
                        <input
                          id={`bonus-qty-${bonus.id}`}
                          type="number"
                          min={1}
                          max={offer.remainingQuantity ?? 99}
                          value={qty}
                          onChange={(e) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [bonus.id]: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                          className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-1.5 text-xs text-fg tabular-nums focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="col-span-2">
                        <label
                          htmlFor={`bonus-comment-${bonus.id}`}
                          className="block text-[10px] text-gray-2 mb-1"
                        >
                          Коментар (опційно)
                        </label>
                        <input
                          id={`bonus-comment-${bonus.id}`}
                          type="text"
                          value={comments[bonus.id] || ''}
                          onChange={(e) =>
                            setComments((prev) => ({ ...prev, [bonus.id]: e.target.value }))
                          }
                          placeholder="Деталі запиту..."
                          className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-1.5 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!canAfford || isClaiming}
                    onClick={() => handleClaim(bonus.id)}
                    className={`w-full py-3 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                      canAfford && !isClaiming
                        ? 'bg-accent hover:bg-accent/90 text-bg-1 shadow-lg shadow-accent/20 cursor-pointer'
                        : 'bg-bg-2 text-gray-1 border border-border-default cursor-not-allowed'
                    }`}
                  >
                    <Gift className="w-4 h-4 shrink-0" />
                    <span>
                      {isClaiming
                        ? 'Оформлення...'
                        : !pointsEnabled
                        ? 'Профіль балів вимкнено'
                        : !offer.isAvailable
                        ? 'Бонус недоступний для цієї ролі'
                        : !limitOk
                        ? 'Перевищено ліміт кількості'
                        : availablePts < totalCost
                        ? `Недостатньо балів (потрібно ${totalCost})`
                        : `Отримати за ${totalCost} б.`}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Claims History & Lifecycle Workflow */}
      <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-default pb-3">
          <div>
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent shrink-0" />
              <span>Історія отриманих бонусів</span>
            </h3>
            <p className="text-[11px] text-gray-2 mt-0.5">
              Журнал запитів, погоджень, видач та скасувань (при скасуванні повертаються лише незгорілі бали).
            </p>
          </div>

          <div className="flex bg-bg-2 border border-border-default p-1 rounded-xl self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setClaimsScope('selected')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                claimsScope === 'selected' ? 'bg-accent text-bg-1 font-semibold' : 'text-gray-2 hover:text-fg'
              }`}
            >
              Обраний співробітник
            </button>
            <button
              type="button"
              onClick={() => setClaimsScope('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                claimsScope === 'all' ? 'bg-accent text-bg-1 font-semibold' : 'text-gray-2 hover:text-fg'
              }`}
            >
              Уся команда ({bonusClaims.length})
            </button>
          </div>
        </div>

        {visibleClaims.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-1">
            Поки що немає запитів на отримання бонусів у цьому перегляді.
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {visibleClaims.map((claim) => {
              const emp = employees.find((e) => e.id === claim.employeeId);
              const statusBadge =
                claim.status === 'requested'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  : claim.status === 'approved'
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : claim.status === 'fulfilled'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-danger/15 text-danger border-danger/30';

              const isBusy = busyKey?.startsWith(`transition:${claim.id}:`);

              return (
                <div
                  key={claim.id}
                  className="py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-fg">{claim.bonusNameSnapshot}</span>
                      <span className="text-[11px] font-mono text-accent font-semibold tabular-nums">
                        ×{claim.quantity} · {claim.totalPointsCost} б. ({claim.unitPricePoints} б./шт)
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${statusBadge}`}>
                        {CLAIM_STATUS_LABELS[claim.status]}
                      </span>
                    </div>

                    <div className="text-[11px] text-gray-2 flex flex-wrap items-center gap-2">
                      <span>Співробітник: {emp?.name || claim.employeeId}</span>
                      <span>· Запит: {formatKyivDateTime(claim.requestedAtUtc)}</span>
                      {claim.fulfilledAtUtc && (
                        <span>· Видано: {formatKyivDateTime(claim.fulfilledAtUtc)}</span>
                      )}
                    </div>

                    {claim.comment && (
                      <div className="text-[11px] text-gray-1 italic break-words">{claim.comment}</div>
                    )}
                  </div>

                  {claim.status !== 'cancelled' && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {claim.status === 'requested' && (
                        <button
                          type="button"
                          disabled={Boolean(isBusy)}
                          onClick={() => handleTransition(claim.id, 'approved')}
                          className="px-3 py-1.5 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Погодити</span>
                        </button>
                      )}

                      {(claim.status === 'requested' || claim.status === 'approved') && (
                        <button
                          type="button"
                          disabled={Boolean(isBusy)}
                          onClick={() => handleTransition(claim.id, 'fulfilled')}
                          className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Виконано</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={Boolean(isBusy)}
                        onClick={() => setConfirmCancelClaim(claim)}
                        className="px-3 py-1.5 rounded-xl bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Скасувати</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {confirmCancelClaim && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-1 border border-border-default rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-fg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <span>Підтвердити скасування бонусу</span>
            </h4>
            <p className="text-xs text-gray-2 leading-relaxed">
              Ви дійсно хочете скасувати запит «{confirmCancelClaim.bonusNameSnapshot}» (
              {confirmCancelClaim.totalPointsCost} б.)? Буде створено повернення балів у журналі; частки, термін
              дії яких уже сплив, не відновлюються.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmCancelClaim(null)}
                className="px-4 py-2 rounded-xl bg-bg-2 border border-border-default text-xs text-gray-2 hover:text-fg"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={Boolean(busyKey)}
                onClick={() => handleTransition(confirmCancelClaim.id, 'cancelled')}
                className="px-4 py-2 rounded-xl bg-danger hover:bg-danger/90 text-fg text-xs font-semibold"
              >
                Підтвердити скасування
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
