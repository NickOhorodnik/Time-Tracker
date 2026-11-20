import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Gift,
  Plus,
  Save,
  ShieldCheck,
  Sliders,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Bonus,
  BonusEligibilityRule,
  BonusEligibilityTargetType,
  Category,
  Employee,
  EmployeePointsProfile,
  PointsEligibleTimeMode,
  PointsRoleConfig,
  PointsRoleId,
} from '../types';
import {
  createDefaultPointsRoles,
  POINTS_ROLE_LABELS,
  resolveEffectiveEmployeePointsConfig,
} from '../utils/pointsEngine';

interface PointsSettingsViewProps {
  roles: PointsRoleConfig[];
  profiles: EmployeePointsProfile[];
  employees: Employee[];
  categories: Category[];
  eligibleCategoryIds: string[];
  bonuses: Bonus[];
  eligibilityRules: BonusEligibilityRule[];
  onSaveRolesAndCategories: (
    nextRoles: PointsRoleConfig[],
    nextEligibleCategoryIds: string[]
  ) => Promise<{ success: boolean; error?: string; message?: string }>;
  onSaveProfiles: (
    nextProfiles: EmployeePointsProfile[]
  ) => Promise<{ success: boolean; error?: string; message?: string }>;
  onSaveEligibility: (
    nextRules: BonusEligibilityRule[]
  ) => Promise<{ success: boolean; error?: string; message?: string }>;
}

export const PointsSettingsView: React.FC<PointsSettingsViewProps> = ({
  roles,
  profiles,
  employees,
  categories,
  eligibleCategoryIds,
  bonuses,
  eligibilityRules,
  onSaveRolesAndCategories,
  onSaveProfiles,
  onSaveEligibility,
}) => {
  const [draftRoles, setDraftRoles] = useState<PointsRoleConfig[]>(() =>
    roles.length > 0 ? roles : createDefaultPointsRoles()
  );
  const [draftCategoryIds, setDraftCategoryIds] = useState<string[]>(eligibleCategoryIds);
  const [draftProfiles, setDraftProfiles] = useState<EmployeePointsProfile[]>(profiles);
  const [draftRules, setDraftRules] = useState<BonusEligibilityRule[]>(eligibilityRules);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // New eligibility rule builder state
  const [newRuleBonusId, setNewRuleBonusId] = useState(bonuses[0]?.id || '');
  const [newRuleTargetType, setNewRuleTargetType] = useState<BonusEligibilityTargetType>('role');
  const [newRuleTargetId, setNewRuleTargetId] = useState<string>('manager');
  const [newRulePriceOverride, setNewRulePriceOverride] = useState<string>('');
  const [newRuleMaxQty, setNewRuleMaxQty] = useState<string>('');
  const [newRuleRequiresApproval, setNewRuleRequiresApproval] = useState<boolean>(true);

  useEffect(() => {
    setDraftRoles(roles.length > 0 ? roles : createDefaultPointsRoles());
  }, [roles]);

  useEffect(() => {
    setDraftCategoryIds(eligibleCategoryIds);
  }, [eligibleCategoryIds]);

  useEffect(() => {
    setDraftProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    setDraftRules(eligibilityRules);
  }, [eligibilityRules]);

  useEffect(() => {
    if (!newRuleBonusId && bonuses.length > 0) {
      setNewRuleBonusId(bonuses[0].id);
    }
  }, [bonuses, newRuleBonusId]);

  const getRoleDraft = (roleId: PointsRoleId): PointsRoleConfig => {
    const existing = draftRoles.find((r) => r.roleId === roleId);
    if (existing) return existing;
    return createDefaultPointsRoles().find((r) => r.roleId === roleId)!;
  };

  const updateRoleField = <K extends keyof PointsRoleConfig>(
    roleId: PointsRoleId,
    field: K,
    value: PointsRoleConfig[K]
  ) => {
    setDraftRoles((prev) => {
      const base = prev.length > 0 ? [...prev] : createDefaultPointsRoles();
      const idx = base.findIndex((r) => r.roleId === roleId);
      const updated = { ...(idx >= 0 ? base[idx] : getRoleDraft(roleId)), [field]: value, updatedAtUtc: new Date().toISOString() };
      if (idx >= 0) base[idx] = updated;
      else base.push(updated);
      return base;
    });
  };

  const getProfileForEmployee = (employeeId: string): EmployeePointsProfile => {
    const existing = draftProfiles.find((p) => p.employeeId === employeeId);
    if (existing) return existing;
    return {
      employeeId,
      pointsRole: 'performer',
      monthlyBaseOverride: null,
      timeEarningOverride: null,
      minutesPerPointOverride: null,
      pointsEnabled: true,
      updatedAtUtc: '',
    };
  };

  const updateProfileField = (employeeId: string, patch: Partial<EmployeePointsProfile>) => {
    setDraftProfiles((prev) => {
      const base = [...prev];
      const idx = base.findIndex((p) => p.employeeId === employeeId);
      const current = idx >= 0 ? base[idx] : getProfileForEmployee(employeeId);
      const updated: EmployeePointsProfile = {
        ...current,
        ...patch,
        employeeId,
        updatedAtUtc: new Date().toISOString(),
      };
      if (idx >= 0) base[idx] = updated;
      else base.push(updated);
      return base;
    });
  };

  const handleSaveRolesSubmit = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await onSaveRolesAndCategories(draftRoles, draftCategoryIds);
      setFeedback({
        type: res.success ? 'success' : 'error',
        text: res.success ? res.message || 'Налаштування ролей збережено.' : res.error || 'Помилка збереження ролей.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProfilesSubmit = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await onSaveProfiles(draftProfiles);
      setFeedback({
        type: res.success ? 'success' : 'error',
        text: res.success
          ? res.message || 'Профілі балів співробітників збережено.'
          : res.error || 'Помилка збереження профілів.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRuleAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleBonusId) {
      setFeedback({ type: 'error', text: 'Оберіть бонус.' });
      return;
    }
    const targetId =
      newRuleTargetType === 'all'
        ? '*'
        : newRuleTargetType === 'role'
        ? newRuleTargetId === 'manager'
          ? 'manager'
          : 'performer'
        : newRuleTargetId || employees[0]?.id || '';

    if (newRuleTargetType === 'employee' && !targetId) {
      setFeedback({ type: 'error', text: 'Оберіть співробітника для правила.' });
      return;
    }

    const newRule: BonusEligibilityRule = {
      id: `elig-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      bonusId: newRuleBonusId,
      targetType: newRuleTargetType,
      targetId,
      priceOverride: newRulePriceOverride.trim() !== '' ? Math.max(0, Math.round(Number(newRulePriceOverride))) : null,
      active: true,
      requiresApproval: newRuleRequiresApproval,
      maxQuantity: newRuleMaxQty.trim() !== '' ? Math.max(1, Math.round(Number(newRuleMaxQty))) : null,
      updatedAtUtc: new Date().toISOString(),
    };

    const next = [...draftRules, newRule];
    setDraftRules(next);
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await onSaveEligibility(next);
      setFeedback({
        type: res.success ? 'success' : 'error',
        text: res.success ? res.message || 'Правило доступності додано.' : res.error || 'Помилка збереження правила.',
      });
      if (res.success) {
        setNewRulePriceOverride('');
        setNewRuleMaxQty('');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleRule = async (ruleId: string) => {
    const next = draftRules.map((r) =>
      r.id === ruleId ? { ...r, active: !r.active, updatedAtUtc: new Date().toISOString() } : r
    );
    setDraftRules(next);
    setIsSaving(true);
    try {
      const res = await onSaveEligibility(next);
      setFeedback({
        type: res.success ? 'success' : 'error',
        text: res.success ? 'Статус правила оновлено.' : res.error || 'Помилка оновлення правила.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveRule = async (ruleId: string) => {
    const next = draftRules.filter((r) => r.id !== ruleId);
    setDraftRules(next);
    setIsSaving(true);
    try {
      const res = await onSaveEligibility(next);
      setFeedback({
        type: res.success ? 'success' : 'error',
        text: res.success ? 'Правило видалено зі списку.' : res.error || 'Помилка видалення правила.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <div className="border-b border-border-default pb-4">
        <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
          <Sliders className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
          <span>Налаштування ролей, профілів балів та бонусів</span>
        </h2>
        <p className="text-xs text-gray-2 mt-1">
          Конфігуруйте правила для ролей «Керівник» і «Виконавець», індивідуальні перевизначення та матрицю доступності бонусів.
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded-2xl p-3.5 text-xs flex items-start gap-2.5 border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 1. Role Configurations */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent" />
            <span>Ролі балів («Ролі балів»)</span>
          </h3>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveRolesSubmit}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-bold flex items-center gap-1.5 shadow cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Зберегти ролі та категорії</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {(['manager', 'performer'] as PointsRoleId[]).map((roleId) => {
            const cfg = getRoleDraft(roleId);
            return (
              <div key={roleId} className="bg-bg-1 border border-border-default rounded-3xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-bold text-fg">{POINTS_ROLE_LABELS[roleId]}</div>
                    <div className="text-[11px] text-gray-2 font-mono">{roleId}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.active}
                      onChange={(e) => updateRoleField(roleId, 'active', e.target.checked)}
                      className="accent-accent"
                    />
                    <span>Роль активна</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-2 block">Місячна база балів</label>
                    <input
                      type="number"
                      min={0}
                      value={cfg.monthlyBasePoints}
                      onChange={(e) => updateRoleField(roleId, 'monthlyBasePoints', Math.max(0, Number(e.target.value) || 0))}
                      className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-gray-2 block">Хвилин за 1 бал (час)</label>
                    <input
                      type="number"
                      min={1}
                      value={cfg.minutesPerPoint}
                      onChange={(e) => updateRoleField(roleId, 'minutesPerPoint', Math.max(1, Number(e.target.value) || 30))}
                      className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-gray-2 block">Режим врахування часу</label>
                    <select
                      value={cfg.eligibleTimeMode}
                      onChange={(e) =>
                        updateRoleField(roleId, 'eligibleTimeMode', e.target.value as PointsEligibleTimeMode)
                      }
                      className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                    >
                      <option value="all">Увесь робочий час ролі</option>
                      <option value="selected_categories">Лише обрані категорії</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-gray-2 block">Термін згорання (міс.)</label>
                    <input
                      type="number"
                      min={0}
                      value={cfg.positiveGraceMonths}
                      onChange={(e) =>
                        updateRoleField(roleId, 'positiveGraceMonths', Math.max(0, Number(e.target.value) || 0))
                      }
                      className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.timeEarningEnabled}
                      onChange={(e) => updateRoleField(roleId, 'timeEarningEnabled', e.target.checked)}
                      className="accent-accent"
                    />
                    <span>Нараховувати бали за час</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.negativeCarryover}
                      onChange={(e) => updateRoleField(roleId, 'negativeCarryover', e.target.checked)}
                      className="accent-accent"
                    />
                    <span>Переносити від’ємний баланс (борг)</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Eligible Categories */}
        {categories.length > 0 && (
          <div className="bg-bg-1 border border-border-default rounded-2xl p-4 space-y-2.5">
            <div className="text-xs font-semibold text-fg">
              Категорії часу, що дають бали (коли режим «Лише обрані категорії»)
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const selected = draftCategoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() =>
                      setDraftCategoryIds((prev) =>
                        prev.includes(cat.id) ? prev.filter((id) => id !== cat.id) : [...prev, cat.id]
                      )
                    }
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-2 cursor-pointer transition-colors ${
                      selected
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'bg-bg-2 border-border-default text-gray-2'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 2. Employee Points Profiles */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <span>Профілі балів співробітників («Профілі балів»)</span>
            </h3>
            <p className="text-xs text-gray-2 mt-0.5">
              Порожнє поле наслідує налаштування ролі; явний «0» перевизначає базове значення на 0. Посада в команді не змінюється.
            </p>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveProfilesSubmit}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-bold flex items-center gap-1.5 shadow cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Зберегти профілі</span>
          </button>
        </div>

        <div className="bg-bg-1 border border-border-default rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-default bg-bg-2 text-[11px] text-gray-2 uppercase tracking-wider">
                  <th className="p-3.5">Співробітник</th>
                  <th className="p-3.5">Роль балів</th>
                  <th className="p-3.5">База / міс (override)</th>
                  <th className="p-3.5">За час (override)</th>
                  <th className="p-3.5">Хв / 1 бал</th>
                  <th className="p-3.5">Активно</th>
                  <th className="p-3.5">Ефективно зараз</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default text-xs">
                {employees.map((emp) => {
                  const prof = getProfileForEmployee(emp.id);
                  const eff = resolveEffectiveEmployeePointsConfig(emp.id, draftRoles, draftProfiles);
                  return (
                    <tr key={emp.id} className="hover:bg-bg-2/50">
                      <td className="p-3.5">
                        <div className="font-semibold text-fg">{emp.name}</div>
                        {emp.role && <div className="text-[10px] text-gray-1">{emp.role}</div>}
                      </td>
                      <td className="p-3.5">
                        <select
                          value={prof.pointsRole}
                          onChange={(e) =>
                            updateProfileField(emp.id, { pointsRole: e.target.value as PointsRoleId })
                          }
                          className="bg-bg-2 border border-border-default rounded-xl px-2.5 py-1.5 text-xs text-fg"
                        >
                          <option value="manager">Керівник</option>
                          <option value="performer">Виконавець</option>
                        </select>
                      </td>
                      <td className="p-3.5">
                        <input
                          type="number"
                          min={0}
                          placeholder="За роллю"
                          value={prof.monthlyBaseOverride ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            updateProfileField(emp.id, {
                              monthlyBaseOverride: v === '' ? null : Math.max(0, Number(v)),
                            });
                          }}
                          className="w-24 bg-bg-2 border border-border-default rounded-xl px-2.5 py-1.5 text-xs text-fg font-mono"
                        />
                      </td>
                      <td className="p-3.5">
                        <select
                          value={
                            prof.timeEarningOverride === null
                              ? 'inherit'
                              : prof.timeEarningOverride
                              ? 'true'
                              : 'false'
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            updateProfileField(emp.id, {
                              timeEarningOverride: val === 'inherit' ? null : val === 'true',
                            });
                          }}
                          className="bg-bg-2 border border-border-default rounded-xl px-2.5 py-1.5 text-xs text-fg"
                        >
                          <option value="inherit">За роллю</option>
                          <option value="true">Так</option>
                          <option value="false">Ні</option>
                        </select>
                      </td>
                      <td className="p-3.5">
                        <input
                          type="number"
                          min={1}
                          placeholder="За роллю"
                          value={prof.minutesPerPointOverride ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            updateProfileField(emp.id, {
                              minutesPerPointOverride: v === '' ? null : Math.max(1, Number(v) || 1),
                            });
                          }}
                          className="w-24 bg-bg-2 border border-border-default rounded-xl px-2.5 py-1.5 text-xs text-fg font-mono"
                        />
                      </td>
                      <td className="p-3.5">
                        <input
                          type="checkbox"
                          checked={prof.pointsEnabled}
                          onChange={(e) => updateProfileField(emp.id, { pointsEnabled: e.target.checked })}
                          className="accent-accent"
                        />
                      </td>
                      <td className="p-3.5 text-[11px] text-gray-2 tabular-nums">
                        {eff.pointsEnabled ? (
                          <span>
                            База: <strong className="text-fg">{eff.monthlyBasePoints}</strong> · Час:{' '}
                            <strong className="text-fg">
                              {eff.timeEarningEnabled ? `${eff.minutesPerPoint} хв/б` : 'ні'}
                            </strong>
                          </span>
                        ) : (
                          <span className="text-danger">Вимкнено</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3. Bonus Eligibility & Price Overrides */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
            <Gift className="w-4 h-4 text-accent" />
            <span>Доступність бонусів і персональні ціни («Доступність бонусів»)</span>
          </h3>
          <p className="text-xs text-gray-2 mt-0.5">
            Пріоритет правил: <strong>Співробітник &gt; Роль &gt; Усі</strong>. Якщо правил для бонусу ще немає, він
            доступний за базовою ціною.
          </p>
        </div>

        <form
          onSubmit={handleAddRuleAndSave}
          className="bg-bg-1 border border-border-default rounded-3xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
        >
          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Бонус</label>
            <select
              value={newRuleBonusId}
              onChange={(e) => setNewRuleBonusId(e.target.value)}
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg"
            >
              {bonuses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.requiredPoints} б.)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Кому</label>
            <select
              value={newRuleTargetType}
              onChange={(e) => {
                const tt = e.target.value as BonusEligibilityTargetType;
                setNewRuleTargetType(tt);
                if (tt === 'all') setNewRuleTargetId('*');
                else if (tt === 'role') setNewRuleTargetId('manager');
                else setNewRuleTargetId(employees[0]?.id || '');
              }}
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg"
            >
              <option value="all">Усі</option>
              <option value="role">За роллю</option>
              <option value="employee">Співробітник</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Ціль</label>
            {newRuleTargetType === 'all' ? (
              <input
                type="text"
                disabled
                value="* (Усі)"
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-gray-1"
              />
            ) : newRuleTargetType === 'role' ? (
              <select
                value={newRuleTargetId}
                onChange={(e) => setNewRuleTargetId(e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg"
              >
                <option value="manager">Керівник</option>
                <option value="performer">Виконавець</option>
              </select>
            ) : (
              <select
                value={newRuleTargetId}
                onChange={(e) => setNewRuleTargetId(e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Спец. ціна (б.)</label>
            <input
              type="number"
              min={0}
              placeholder="Базова"
              value={newRulePriceOverride}
              onChange={(e) => setNewRulePriceOverride(e.target.value)}
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Ліміт к-сті</label>
            <input
              type="number"
              min={1}
              placeholder="Без ліміту"
              value={newRuleMaxQty}
              onChange={(e) => setNewRuleMaxQty(e.target.value)}
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={newRuleRequiresApproval}
                onChange={(e) => setNewRuleRequiresApproval(e.target.checked)}
                className="accent-accent"
              />
              <span>Погодження</span>
            </label>
            <button
              type="submit"
              disabled={isSaving || bonuses.length === 0}
              className="flex-1 py-2 px-3 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Додати</span>
            </button>
          </div>
        </form>

        <div className="bg-bg-1 border border-border-default rounded-3xl overflow-hidden">
          {draftRules.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-1">
              Правила доступності ще не додано — усі активні бонуси доступні всім за базовою ціною.
            </div>
          ) : (
            <div className="divide-y divide-border-default">
              {draftRules.map((rule) => {
                const bonus = bonuses.find((b) => b.id === rule.bonusId);
                const targetLabel =
                  rule.targetType === 'all'
                    ? 'Усі співробітники'
                    : rule.targetType === 'role'
                    ? `Роль: ${POINTS_ROLE_LABELS[rule.targetId as PointsRoleId] || rule.targetId}`
                    : `Співробітник: ${employees.find((e) => e.id === rule.targetId)?.name || rule.targetId}`;

                return (
                  <div
                    key={rule.id}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      !rule.active ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-fg">{bonus?.name || rule.bonusId}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-bg-2 border border-border-default text-gray-2">
                          {targetLabel}
                        </span>
                        <span className="text-xs font-mono font-bold text-accent">
                          {rule.priceOverride !== null && rule.priceOverride !== undefined
                            ? `${rule.priceOverride} б.`
                            : 'Базова ціна'}
                        </span>
                        {rule.maxQuantity !== null && rule.maxQuantity !== undefined && (
                          <span className="text-[11px] text-gray-2">Ліміт: {rule.maxQuantity}</span>
                        )}
                        <span className="text-[11px] text-gray-1">
                          {rule.requiresApproval ? 'Потребує погодження' : 'Автопогодження'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        className="px-3 py-1.5 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-xs text-fg cursor-pointer"
                      >
                        {rule.active ? 'Вимкнути' : 'Увімкнути'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule.id)}
                        className="p-2 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger cursor-pointer"
                        title="Видалити правило"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
