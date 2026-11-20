import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  ListChecks,
  Plus,
  Power,
  Save,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { PointsReason, PointsReasonOperationType, PointsRoleId } from '../types';
import { POINTS_OPERATION_LABELS, POINTS_ROLE_LABELS } from '../utils/pointsEngine';

interface PointsReasonsViewProps {
  reasons: PointsReason[];
  isReadOnly?: boolean;
  onSaveReasons: (nextReasons: PointsReason[]) => Promise<{ success: boolean; error?: string; message?: string }>;
}

const GROUPS: { type: PointsReasonOperationType; title: string; badgeClass: string }[] = [
  { type: 'manual_award', title: 'Нарахування', badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { type: 'manual_deduction', title: 'Списання', badgeClass: 'bg-danger/15 text-danger border-danger/30' },
  { type: 'neutral_self_report', title: 'Без зміни балів (Самозвіти 0 б.)', badgeClass: 'bg-accent/15 text-accent border-accent/30' },
];

export const PointsReasonsView: React.FC<PointsReasonsViewProps> = ({
  reasons,
  isReadOnly = false,
  onSaveReasons,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [operationType, setOperationType] = useState<PointsReasonOperationType>('manual_award');
  const [defaultPoints, setDefaultPoints] = useState<number>(5);
  const [description, setDescription] = useState('');
  const [allowedRoles, setAllowedRoles] = useState<PointsRoleId[]>(['manager', 'performer']);
  const [sortOrder, setSortOrder] = useState<number>(reasons.length + 1);
  const [active, setActive] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sortedReasons = useMemo(
    () => [...reasons].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [reasons]
  );

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setOperationType('manual_award');
    setDefaultPoints(5);
    setDescription('');
    setAllowedRoles(['manager', 'performer']);
    setSortOrder(reasons.length + 1);
    setActive(true);
  };

  const handleEdit = (reason: PointsReason) => {
    if (isReadOnly) return;
    setEditingId(reason.id);
    setName(reason.name);
    setOperationType(reason.operationType);
    setDefaultPoints(reason.operationType === 'neutral_self_report' ? 0 : reason.defaultPoints);
    setDescription(reason.description || '');
    setAllowedRoles(reason.allowedRoles.length > 0 ? reason.allowedRoles : ['manager', 'performer']);
    setSortOrder(reason.sortOrder || 1);
    setActive(reason.active !== false);
    setFeedback(null);
  };

  const toggleRole = (role: PointsRoleId) => {
    setAllowedRoles((prev) => {
      if (prev.includes(role)) {
        const next = prev.filter((r) => r !== role);
        return next.length > 0 ? next : prev;
      }
      return [...prev, role];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setFeedback(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setFeedback({ type: 'error', text: 'Вкажіть назву причини.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const record: PointsReason = {
      id: editingId || `reason-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      operationType,
      name: cleanName,
      defaultPoints: operationType === 'neutral_self_report' ? 0 : Math.max(0, Math.round(Number(defaultPoints) || 0)),
      description: description.trim(),
      allowedRoles: allowedRoles.length > 0 ? allowedRoles : ['manager', 'performer'],
      active,
      sortOrder: Math.max(1, Math.round(Number(sortOrder) || 1)),
      updatedAtUtc: nowIso,
    };

    const nextList = editingId
      ? reasons.map((r) => (r.id === editingId ? record : r))
      : [...reasons, record];

    setIsSaving(true);
    try {
      const res = await onSaveReasons(nextList);
      if (res.success) {
        setFeedback({ type: 'success', text: res.message || 'Довідник причин збережено.' });
        resetForm();
      } else {
        setFeedback({ type: 'error', text: res.error || 'Помилка збереження причин.' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (reason: PointsReason) => {
    if (isReadOnly) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const next = reasons.map((r) =>
        r.id === reason.id ? { ...r, active: !r.active, updatedAtUtc: new Date().toISOString() } : r
      );
      const res = await onSaveReasons(next);
      if (res.success) {
        setFeedback({ type: 'success', text: res.message || 'Статус причини оновлено.' });
      } else {
        setFeedback({ type: 'error', text: res.error || 'Помилка оновлення статусу.' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-border-default pb-4">
        <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
          <ListChecks className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
          <span>Довідник причин балів</span>
        </h2>
        <p className="text-xs text-gray-2 mt-1">
          Налаштовуйте причини для нарахувань, списань і самозвітів (0 б.) з ролями доступу та балами за замовчуванням.
        </p>
      </div>

      <div className="bg-bg-1 border border-border-default rounded-2xl p-4 flex items-start gap-3 text-xs text-gray-2">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div>
          Зміна назви, балів чи вимкнення причини в довіднику <strong className="text-fg">не змінює історичні записи</strong>{' '}
          у журналі операцій — кожна транзакція зберігає власний <code className="text-accent">reason_snapshot</code>.
          Варіант «Інше» із вільним поясненням завжди доступний на формі операцій.
        </div>
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

      {isReadOnly && (
        <div className="bg-bg-1 border border-accent/30 rounded-2xl p-4 flex items-start gap-3 text-xs text-gray-2">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div>
            <strong className="text-fg">Режим лише перегляду:</strong> додавання, редагування та вимкнення причин балів недоступні.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Form */}
        {!isReadOnly && (
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-4 bg-bg-1 border border-border-default rounded-3xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider">
              {editingId ? 'Редагувати причину' : 'Додати причину'}
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-gray-2 hover:text-fg underline cursor-pointer"
              >
                Скасувати
              </button>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Тип операції</label>
            <select
              value={operationType}
              onChange={(e) => setOperationType(e.target.value as PointsReasonOperationType)}
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
            >
              <option value="manual_award">{POINTS_OPERATION_LABELS.manual_award}</option>
              <option value="manual_deduction">{POINTS_OPERATION_LABELS.manual_deduction}</option>
              <option value="neutral_self_report">{POINTS_OPERATION_LABELS.neutral_self_report}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Назва причини *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Наприклад: Допомога з релізом / Прострочення дедлайну"
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Бали за замовчуванням</label>
              <input
                type="number"
                min={0}
                disabled={operationType === 'neutral_self_report'}
                value={operationType === 'neutral_self_report' ? 0 : defaultPoints}
                onChange={(e) => setDefaultPoints(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-2 block">Порядок</label>
              <input
                type="number"
                min={1}
                value={sortOrder}
                onChange={(e) => setSortOrder(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-gray-2 block">Дозволені ролі</span>
            <div className="flex gap-2">
              {(['manager', 'performer'] as PointsRoleId[]).map((role) => {
                const checked = allowedRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                      checked
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'bg-bg-2 border-border-default text-gray-2'
                    }`}
                  >
                    {POINTS_ROLE_LABELS[role]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-2 block">Опис (опційно)</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Коли застосовувати цю причину..."
              className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-border-default accent-accent"
            />
            <span>Активна (доступна у формі вибору)</span>
          </label>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3 rounded-2xl bg-accent hover:bg-accent/90 text-bg-1 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-accent/20 cursor-pointer disabled:opacity-50"
          >
            {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{editingId ? 'Зберегти причину' : 'Додати причину'}</span>
          </button>
        </form>
        )}

        {/* Grouped List */}
        <div className={`${isReadOnly ? 'xl:col-span-12' : 'xl:col-span-8'} space-y-5`}>
          {GROUPS.map((grp) => {
            const list = sortedReasons.filter((r) => r.operationType === grp.type);
            return (
              <div key={grp.type} className="bg-bg-1 border border-border-default rounded-3xl overflow-hidden">
                <div className="p-4 border-b border-border-default flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${grp.badgeClass}`}>
                      {grp.title}
                    </span>
                    <span className="text-xs text-gray-2">({list.length})</span>
                  </div>
                </div>

                {list.length === 0 ? (
                  <div className="p-6 text-center text-xs text-gray-1">
                    У цій групі ще немає налаштованих причин (завжди доступне «Інше»).
                  </div>
                ) : (
                  <div className="divide-y divide-border-default">
                    {list.map((reason) => (
                      <div
                        key={reason.id}
                        className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          !reason.active ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono text-gray-1">#{reason.sortOrder}</span>
                            <span className="text-sm font-bold text-fg">{reason.name}</span>
                            <span className="text-xs font-mono font-bold text-accent">
                              {reason.operationType === 'neutral_self_report' ? '0 б.' : `${reason.defaultPoints} б.`}
                            </span>
                            {!reason.active && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-bg-2 border border-border-default text-gray-1">
                                Вимкнено
                              </span>
                            )}
                          </div>
                          {reason.description && <p className="text-xs text-gray-2">{reason.description}</p>}
                          <div className="text-[11px] text-gray-1 flex flex-wrap gap-2">
                            <span>
                              Ролі:{' '}
                              {reason.allowedRoles.map((r) => POINTS_ROLE_LABELS[r] || r).join(', ')}
                            </span>
                          </div>
                        </div>

                        {!isReadOnly && (
                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => handleEdit(reason)}
                              className="p-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors cursor-pointer"
                              title="Редагувати"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleToggleActive(reason)}
                              className="p-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors cursor-pointer"
                              title={reason.active ? 'Вимкнути' : 'Увімкнути'}
                            >
                              <Power className={`w-3.5 h-3.5 ${reason.active ? 'text-emerald-400' : 'text-gray-1'}`} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
