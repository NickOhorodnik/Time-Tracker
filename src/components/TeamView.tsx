import React, { useMemo, useState } from 'react';
import {
  Category,
  Employee,
  EmployeeRating,
  EmployeeStatus,
  ImageAsset,
  PerformanceScore,
  PeriodType,
  Project,
  SyncState,
  TimeEntry,
} from '../types';
import { api } from '../services/api';
import { resolveAssetUrl } from '../utils/assetResolver';
import {
  computeEmployeeMetrics,
  DEFAULT_EMPLOYEE_ID,
  generateEmployeeId,
  getDefaultEmployeeId,
  getEmployeeInitials,
  getEmployeeRatingsSorted,
  getRatingMeta,
  RATING_SCALE,
  validateEmployeeInput,
  validateRatingInput,
} from '../utils/teamUtils';
import {
  Archive,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  History as HistoryIcon,
  Info,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Upload,
  User,
  UserPlus,
  Users,
  AlertCircle,
  X,
} from 'lucide-react';

interface TeamViewProps {
  employees: Employee[];
  ratings: EmployeeRating[];
  entries: TimeEntry[];
  categories: Category[];
  projects: Project[];
  syncState: SyncState;
  onSaveEmployee: (employee: Employee, isNew: boolean) => Promise<{ success: boolean; error?: string }>;
  onArchiveEmployee: (employeeId: string, nextStatus: EmployeeStatus) => Promise<{ success: boolean; error?: string }>;
  onSaveRating: (rating: EmployeeRating) => Promise<{ success: boolean; error?: string }>;
  onOpenEmployeeInHistory: (employeeId: string) => void;
  onOpenEmployeeInCalendar: (employeeId: string) => void;
}

const SENTIMENT_STYLES: Record<
  'negative' | 'neutral' | 'positive',
  { container: string; text: string }
> = {
  negative: {
    container: 'bg-danger/10 border-danger/30 text-danger',
    text: 'text-danger',
  },
  neutral: {
    container: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    text: 'text-amber-200',
  },
  positive: {
    container: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    text: 'text-emerald-300',
  },
};

export const TeamView: React.FC<TeamViewProps> = ({
  employees,
  ratings,
  entries,
  categories,
  projects,
  syncState,
  onSaveEmployee,
  onArchiveEmployee,
  onSaveRating,
  onOpenEmployeeInHistory,
  onOpenEmployeeInCalendar,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [analysisPeriod, setAnalysisPeriod] = useState<PeriodType>('all');

  // Add / Edit employee modal state
  const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empNotes, setEmpNotes] = useState('');
  const [empAvatarUrl, setEmpAvatarUrl] = useState('');
  const [empPortraitUrl, setEmpPortraitUrl] = useState('');
  const [empError, setEmpError] = useState<string | null>(null);
  const [isSavingEmp, setIsSavingEmp] = useState(false);

  // Rating form state
  const [ratingScore, setRatingScore] = useState<PerformanceScore>(5);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingDate, setRatingDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [ratingTime, setRatingTime] = useState(() =>
    new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
  const [ratingFeedback, setRatingFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSavingRating, setIsSavingRating] = useState(false);

  // Global status banner for archive/restore/sync feedback
  const [actionBanner, setActionBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Per-employee image load error tracking to guarantee zero broken image frames
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const isGasHosted = syncState.runtimeMode === 'gas_hosted';
  const defaultEmployeeId = useMemo(() => getDefaultEmployeeId(employees), [employees]);

  const localTeamAssets = useMemo<ImageAsset[]>(() => {
    const library = api.getImageLibrary();
    return library.filter((a) => a.group === 'team_avatars' || a.group === 'team_portraits');
  }, [isEmpModalOpen]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (statusFilter !== 'all' && emp.status !== statusFilter) return false;
      if (!q) return true;
      return (
        emp.name.toLowerCase().includes(q) ||
        (emp.role || '').toLowerCase().includes(q) ||
        (emp.notes || '').toLowerCase().includes(q)
      );
    });
  }, [employees, statusFilter, searchQuery]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const selectedMetrics = useMemo(() => {
    if (!selectedEmployee) return null;
    return computeEmployeeMetrics(
      selectedEmployee.id,
      entries,
      categories,
      ratings,
      analysisPeriod,
      defaultEmployeeId
    );
  }, [selectedEmployee, entries, categories, ratings, analysisPeriod, defaultEmployeeId]);

  const selectedRatingHistory = useMemo(() => {
    if (!selectedEmployee) return [];
    return getEmployeeRatingsSorted(ratings, selectedEmployee.id);
  }, [selectedEmployee, ratings]);

  const openCreateModal = () => {
    setEditingEmployee(null);
    setEmpName('');
    setEmpRole('');
    setEmpNotes('');
    setEmpAvatarUrl('');
    setEmpPortraitUrl('');
    setEmpError(null);
    setIsEmpModalOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setEmpName(emp.name);
    setEmpRole(emp.role || '');
    setEmpNotes(emp.notes || '');
    setEmpAvatarUrl(emp.avatarUrl || '');
    setEmpPortraitUrl(emp.portraitUrl || '');
    setEmpError(null);
    setIsEmpModalOpen(true);
  };

  const handleUploadEmployeeImage = async (
    slot: 'avatar' | 'portrait',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const dataUrl = await api.uploadAsset(file);
    if (slot === 'avatar') {
      setEmpAvatarUrl(dataUrl);
    } else {
      setEmpPortraitUrl(dataUrl);
    }

    // Store copy in local Image Library under team_avatars / team_portraits
    const existingLib = api.getImageLibrary();
    const newAsset: ImageAsset = {
      id: `asset-local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${empName.trim() || file.name} (${slot === 'avatar' ? 'Аватар' : 'Портрет'})`,
      group: slot === 'avatar' ? 'team_avatars' : 'team_portraits',
      url: dataUrl,
      source: 'local_upload',
      uploadedAt: new Date().toISOString(),
      storageMode: 'browser_local',
    };
    api.saveImageLibrary([newAsset, ...existingLib]);
  };

  const handleSubmitEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateEmployeeInput(
      { name: empName },
      employees,
      editingEmployee?.id
    );
    if (!validation.valid) {
      setEmpError(validation.error || 'Перевірте коректність даних.');
      return;
    }

    setIsSavingEmp(true);
    setEmpError(null);
    const nowIso = new Date().toISOString();

    const payload: Employee = editingEmployee
      ? {
          ...editingEmployee,
          name: empName.trim(),
          role: empRole.trim(),
          notes: empNotes.trim(),
          avatarUrl: empAvatarUrl.trim(),
          portraitUrl: empPortraitUrl.trim(),
          updatedAt: nowIso,
          isDemo: editingEmployee.isDemo && editingEmployee.name === empName.trim(),
        }
      : {
          id: generateEmployeeId(empName, employees),
          name: empName.trim(),
          role: empRole.trim(),
          status: 'active',
          avatarUrl: empAvatarUrl.trim(),
          portraitUrl: empPortraitUrl.trim(),
          notes: empNotes.trim(),
          createdAt: nowIso,
          updatedAt: nowIso,
          isDemo: false,
        };

    const res = await onSaveEmployee(payload, !editingEmployee);
    setIsSavingEmp(false);

    if (!res.success) {
      setEmpError(res.error || 'Не вдалося зберегти профіль співробітника.');
      return;
    }

    setIsEmpModalOpen(false);
    setActionBanner({
      type: 'success',
      text: editingEmployee
        ? `Профіль «${payload.name}» оновлено.`
        : `Додано нового співробітника «${payload.name}».`,
    });
    if (!editingEmployee) {
      setStatusFilter('active');
    }
  };

  const handleToggleArchive = async (emp: Employee) => {
    const nextStatus: EmployeeStatus = emp.status === 'archived' ? 'active' : 'archived';
    const res = await onArchiveEmployee(emp.id, nextStatus);
    if (res.success) {
      setActionBanner({
        type: 'success',
        text:
          nextStatus === 'archived'
            ? `Співробітника «${emp.name}» переведено в архів. Усі записи часу збережено.`
            : `Співробітника «${emp.name}» відновлено до активного списку.`,
      });
    } else {
      setActionBanner({
        type: 'error',
        text: res.error || 'Не вдалося змінити статус співробітника.',
      });
    }
  };

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || isSavingRating) return;

    const validation = validateRatingInput({
      employeeId: selectedEmployee.id,
      score: ratingScore,
      date: ratingDate,
      time: ratingTime,
    });

    if (!validation.valid || !validation.meta) {
      setRatingFeedback({
        type: 'error',
        text: validation.error || 'Некоректна оцінка.',
      });
      return;
    }

    setIsSavingRating(true);
    setRatingFeedback(null);
    const nowIso = new Date().toISOString();

    const newRating: EmployeeRating = {
      id: `rating-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      employeeId: selectedEmployee.id,
      score: validation.meta.score,
      emoji: validation.meta.emoji,
      sentiment: validation.meta.sentiment,
      label: validation.meta.label,
      comment: ratingComment.trim() || undefined,
      date: ratingDate.trim(),
      time: ratingTime.trim() || '12:00',
      createdAt: nowIso,
      updatedAt: nowIso,
      isDemo: false,
    };

    const res = await onSaveRating(newRating);
    setIsSavingRating(false);

    if (!res.success) {
      setRatingFeedback({
        type: 'error',
        text: res.error || 'Не вдалося зберегти оцінку.',
      });
      return;
    }

    setRatingComment('');
    setRatingFeedback({
      type: 'success',
      text: `Оцінку ${validation.meta.emoji} ${validation.meta.score}/5 (${validation.meta.label}) збережено.`,
    });
  };

  const renderCircularAvatar = (emp: Employee, sizeClass = 'w-14 h-14') => {
    const imgKey = `avatar:${emp.id}:${emp.avatarUrl || ''}`;
    const hasImage = Boolean(emp.avatarUrl && !brokenImages[imgKey] && emp.avatarUrl !== '[локальне зображення]');
    return (
      <div
        className={`${sizeClass} rounded-full overflow-hidden border border-border-default bg-bg-2 flex items-center justify-center shrink-0`}
      >
        {hasImage ? (
          <img
            src={resolveAssetUrl(emp.avatarUrl)}
            alt={`Аватар ${emp.name}`}
            referrerPolicy="no-referrer"
            onError={() => setBrokenImages((prev) => ({ ...prev, [imgKey]: true }))}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-gray-2 select-none" aria-hidden="true">
            {getEmployeeInitials(emp.name)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <Users className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Оцінка команди та аналіз часу</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            Профілі співробітників, історія оцінок за шкалою 1–5 зі зрозумілим емодзі-індикатором та персональна статистика робочого часу.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="w-full md:w-auto bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4 shrink-0" />
          <span>Додати співробітника</span>
        </button>
      </div>

      {/* Mode Notice */}
      {!isGasHosted ? (
        <div className="bg-bg-1 border border-border-default rounded-2xl p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-gray-2 leading-relaxed">
            <span className="font-semibold text-fg">Локальний режим (AI Studio Preview): </span>
            профілі команди та оцінки зберігаються лише локально у цьому браузері. Позначка «Локальний приклад» вказує на стартовий демонстраційний запис. Щоб зберігати дані в аркушах «Працівники» та «Оцінки» вашої Google Таблиці, відкрийте розгорнутий застосунок у Google Apps Script.
          </div>
        </div>
      ) : (
        <div className="bg-bg-1 border border-border-default rounded-2xl p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="text-xs text-gray-2 leading-relaxed">
            <span className="font-semibold text-fg">Збереження в Google Таблиці (GAS HtmlService): </span>
            структуровані дані команди та оцінки синхронізуються з аркушами «Працівники» та «Оцінки», а завантажені вами зображення залишаються локально в браузері.
          </div>
        </div>
      )}

      {/* Action Feedback Banner */}
      {actionBanner && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium ${
            actionBanner.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {actionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{actionBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-gray-2 hover:text-fg px-2 py-0.5"
          >
            Закрити
          </button>
        </div>
      )}

      {/* Employee Profile / Detail View */}
      {selectedEmployee && selectedMetrics ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedEmployeeId(null);
                setRatingFeedback(null);
              }}
              className="bg-bg-1 hover:bg-border-default border border-border-default text-fg px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-accent" />
              <span>Назад до списку команди</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenEmployeeInHistory(selectedEmployee.id)}
                className="bg-bg-1 hover:bg-border-default border border-border-default text-fg px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <HistoryIcon className="w-3.5 h-3.5 text-accent" />
                <span>Відкрити в Історії</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenEmployeeInCalendar(selectedEmployee.id)}
                className="bg-bg-1 hover:bg-border-default border border-border-default text-fg px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-accent" />
                <span>Відкрити в Календарі</span>
              </button>
            </div>
          </div>

          {/* Profile Hero Card */}
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6">
            <div className="flex items-start sm:items-center gap-4 sm:gap-5">
              {renderCircularAvatar(selectedEmployee, 'w-16 h-16 sm:w-20 sm:h-20')}
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-base sm:text-lg font-bold text-fg">{selectedEmployee.name}</h3>
                  <span className="text-xs text-gray-2">
                    {selectedEmployee.role || 'Співробітник команди'}
                    {' · '}
                    {selectedEmployee.status === 'archived' ? 'Архівний профіль' : 'Активний'}
                    {selectedEmployee.isDemo ? ' · Локальний приклад' : ''}
                  </span>
                </div>
                {selectedEmployee.notes && (
                  <p className="text-xs text-gray-2 max-w-2xl">{selectedEmployee.notes}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-2 pt-1 tabular-nums">
                  <span>Усього: <strong className="text-fg">{(selectedMetrics.minutesAll / 60).toFixed(1)} год</strong></span>
                  <span className="text-gray-1">·</span>
                  <span>Сесій: <strong className="text-fg">{selectedMetrics.sessionCountAll}</strong></span>
                  <span className="text-gray-1">·</span>
                  <span>
                    Оцінок: <strong className="text-fg">{selectedMetrics.ratingCount}</strong>
                    {selectedMetrics.averageScore !== null && ` (середня ${selectedMetrics.averageScore}/5)`}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {selectedEmployee.portraitUrl &&
                selectedEmployee.portraitUrl !== '[локальне зображення]' &&
                !brokenImages[`portrait:${selectedEmployee.id}:${selectedEmployee.portraitUrl}`] && (
                  <div className="w-16 h-20 rounded-xl overflow-hidden border border-border-default bg-bg-2 hidden sm:block">
                    <img
                      src={resolveAssetUrl(selectedEmployee.portraitUrl)}
                      alt={`Портрет ${selectedEmployee.name}`}
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenImages((prev) => ({
                          ...prev,
                          [`portrait:${selectedEmployee.id}:${selectedEmployee.portraitUrl}`]: true,
                        }))
                      }
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

              <button
                type="button"
                onClick={() => openEditModal(selectedEmployee)}
                className="bg-bg-2 hover:bg-border-default border border-border-default text-fg px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-accent" />
                <span>Редагувати</span>
              </button>

              <button
                type="button"
                onClick={() => handleToggleArchive(selectedEmployee)}
                className="bg-bg-2 hover:bg-border-default border border-border-default text-fg px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                {selectedEmployee.status === 'archived' ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Відновити</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-3.5 h-3.5 text-amber-400" />
                    <span>В архів</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left: Rating Form & History */}
            <div className="xl:col-span-5 space-y-6 min-w-0">
              {/* New Rating Form */}
              <form
                onSubmit={handleSubmitRating}
                className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-border-default pb-3">
                  <h4 className="text-sm font-bold text-fg">Нова оцінка ефективності</h4>
                  <span className="text-[11px] text-gray-2">Шкала 1–5</span>
                </div>

                {/* 1-5 Emoji Rating Selector */}
                <div className="space-y-2">
                  <span className="text-xs text-gray-2 block">Оберіть оцінку (1–2 Негативно · 3 Нейтрально · 4–5 Позитивно)</span>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2" role="radiogroup" aria-label="Шкала оцінки від 1 до 5">
                    {RATING_SCALE.map((option) => {
                      const isSelected = ratingScore === option.score;
                      return (
                        <button
                          key={option.score}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          aria-label={`Оцінка ${option.score} з 5 — ${option.label}: ${option.description}`}
                          onClick={() => {
                            setRatingScore(option.score);
                            setRatingFeedback(null);
                          }}
                          className={`flex flex-col items-center justify-center gap-1 py-2.5 sm:py-3 px-1.5 rounded-2xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-accent/15 border-accent text-fg shadow'
                              : 'bg-bg-2 border-border-default text-gray-2 hover:border-gray-1 hover:text-fg'
                          }`}
                        >
                          <span className="text-2xl leading-none" aria-hidden="true">{option.emoji}</span>
                          <span className="text-xs font-bold tabular-nums">{option.score}/5</span>
                          <span className="text-[10px] text-gray-2 leading-tight text-center">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="rating-date-input" className="text-xs text-gray-2 block mb-1">
                      Дата оцінки
                    </label>
                    <input
                      id="rating-date-input"
                      type="date"
                      value={ratingDate}
                      onChange={(e) => setRatingDate(e.target.value)}
                      className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="rating-time-input" className="text-xs text-gray-2 block mb-1">
                      Час оцінки
                    </label>
                    <input
                      id="rating-time-input"
                      type="time"
                      value={ratingTime}
                      onChange={(e) => setRatingTime(e.target.value)}
                      className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="rating-comment-input" className="text-xs text-gray-2 block mb-1">
                    Коментар (необов'язково)
                  </label>
                  <textarea
                    id="rating-comment-input"
                    rows={3}
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder="Короткий фідбек: сильні сторони, якість коду/дизайну, зона покращення..."
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent resize-none"
                  />
                </div>

                {ratingFeedback && (
                  <div
                    role="alert"
                    className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      ratingFeedback.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-danger/10 border-danger/30 text-danger'
                    }`}
                  >
                    {ratingFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{ratingFeedback.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSavingRating}
                  className="w-full bg-accent hover:bg-accent/90 text-bg-1 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingRating ? 'Збереження...' : 'Зберегти оцінку'}
                </button>
              </form>

              {/* Rating History */}
              <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-border-default pb-3">
                  <h4 className="text-sm font-bold text-fg">Історія оцінок</h4>
                  <span className="text-xs text-gray-2 tabular-nums">{selectedRatingHistory.length}</span>
                </div>

                {selectedRatingHistory.length === 0 ? (
                  <div className="text-center py-8 text-xs text-gray-1">
                    Для цього співробітника ще немає жодної оцінки.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                    {selectedRatingHistory.map((item) => {
                      const style = SENTIMENT_STYLES[item.sentiment] || SENTIMENT_STYLES.neutral;
                      return (
                        <div
                          key={item.id}
                          className="bg-bg-2 border border-border-default rounded-2xl p-4 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl leading-none" aria-hidden="true">
                                {item.emoji}
                              </span>
                              <div>
                                <div className="text-xs font-bold text-fg tabular-nums">
                                  Оцінка {item.score}/5 ·{' '}
                                  <span className={style.text}>{item.label}</span>
                                </div>
                                <div className="text-[11px] text-gray-2 tabular-nums">
                                  {item.date} о {item.time}
                                  {item.isDemo ? ' · Локальний приклад' : ''}
                                </div>
                              </div>
                            </div>
                          </div>

                          {item.comment && (
                            <p className="text-xs text-gray-2 leading-relaxed flex items-start gap-2 pt-1">
                              <MessageSquare className="w-3.5 h-3.5 text-gray-1 shrink-0 mt-0.5" />
                              <span>{item.comment}</span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Per-Employee Time Analysis */}
            <div className="xl:col-span-7 space-y-6 min-w-0">
              <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-default pb-4">
                  <div>
                    <h4 className="text-sm font-bold text-fg">Аналіз часу за категоріями та періодом</h4>
                    <p className="text-xs text-gray-2 mt-0.5">
                      Лише реальні записи часу співробітника «{selectedEmployee.name}».
                    </p>
                  </div>

                  {/* Period Selector */}
                  <div className="grid grid-cols-2 sm:flex bg-bg-2 border border-border-default p-1 rounded-xl shrink-0 w-full sm:w-auto">
                    {(
                      [
                        { id: 'today', label: 'День' },
                        { id: 'week', label: 'Тиждень' },
                        { id: 'month', label: 'Місяць' },
                        { id: 'all', label: 'Увесь час' },
                      ] as { id: PeriodType; label: string }[]
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setAnalysisPeriod(p.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-center ${
                          analysisPeriod === p.id
                            ? 'bg-accent text-bg-1 font-semibold'
                            : 'text-gray-2 hover:text-fg'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Period Totals Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-bg-2 border border-border-default rounded-2xl p-3.5">
                    <div className="text-[11px] text-gray-2">Сьогодні</div>
                    <div className="text-lg font-bold text-fg tabular-nums mt-0.5">
                      {(selectedMetrics.minutesToday / 60).toFixed(1)} год
                    </div>
                  </div>
                  <div className="bg-bg-2 border border-border-default rounded-2xl p-3.5">
                    <div className="text-[11px] text-gray-2">Тиждень</div>
                    <div className="text-lg font-bold text-fg tabular-nums mt-0.5">
                      {(selectedMetrics.minutesWeek / 60).toFixed(1)} год
                    </div>
                  </div>
                  <div className="bg-bg-2 border border-border-default rounded-2xl p-3.5">
                    <div className="text-[11px] text-gray-2">Місяць</div>
                    <div className="text-lg font-bold text-fg tabular-nums mt-0.5">
                      {(selectedMetrics.minutesMonth / 60).toFixed(1)} год
                    </div>
                  </div>
                  <div className="bg-bg-2 border border-border-default rounded-2xl p-3.5">
                    <div className="text-[11px] text-gray-2">Обраний період</div>
                    <div className="text-lg font-bold text-accent tabular-nums mt-0.5">
                      {(selectedMetrics.periodMinutes / 60).toFixed(1)} год
                    </div>
                  </div>
                </div>

                {/* Category Breakdown */}
                <div className="space-y-3">
                  <h5 className="text-xs font-semibold text-gray-2">Розподіл за категоріями задач</h5>
                  {selectedMetrics.periodSessions.length === 0 ? (
                    <div className="bg-bg-2 border border-dashed border-border-default rounded-2xl p-6 text-center text-xs text-gray-1">
                      За обраний період для цього співробітника ще немає зафіксованих сесій часу.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedMetrics.categoryBreakdown.map((item) => (
                        <div key={item.categoryId} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-fg flex items-center gap-2 font-medium">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: item.color }}
                              />
                              <span>{item.categoryName}</span>
                              <span className="text-gray-1 tabular-nums">({item.sessions})</span>
                            </span>
                            <span className="text-fg font-semibold tabular-nums">
                              {item.hours.toFixed(1)} год ({item.percent}%)
                            </span>
                          </div>
                          <div className="w-full bg-bg-2 h-2 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Sessions for Selected Employee */}
                <div className="space-y-3 pt-2 border-t border-border-default">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-semibold text-gray-2">Останні сесії часу</h5>
                    <span className="text-[11px] text-gray-2 tabular-nums">
                      Показано {Math.min(10, selectedMetrics.periodSessions.length)} з {selectedMetrics.periodSessions.length}
                    </span>
                  </div>

                  {selectedMetrics.periodSessions.length === 0 ? (
                    <div className="text-xs text-gray-1 py-2">Сесій ще немає.</div>
                  ) : (
                    <div className="divide-y divide-border-default border border-border-default rounded-2xl overflow-hidden bg-bg-2">
                      {selectedMetrics.periodSessions.slice(0, 10).map((entry) => {
                        const cat = categories.find((c) => c.id === entry.categoryId);
                        const proj = projects.find((p) => p.id === entry.projectId);
                        return (
                          <div
                            key={entry.id}
                            className="p-3.5 flex items-center justify-between gap-4 text-xs"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-fg font-medium truncate">
                                {entry.description || 'Робоча сесія'}
                              </div>
                              <div className="text-[11px] text-gray-2 tabular-nums">
                                {entry.date} · {entry.startTime}–{entry.endTime} · {proj?.name || 'Проєкт'} · {cat?.name || 'Категорія'}
                              </div>
                            </div>
                            <div className="font-mono font-bold text-accent shrink-0 tabular-nums">
                              {(entry.durationMinutes / 60).toFixed(1)} год
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Team Overview Cards List */
        <div className="space-y-5">
          {/* Search & Status Filters */}
          <div className="bg-bg-1 border border-border-default p-4 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-1 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Пошук співробітників"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук за іменем, посадою або нотаткою..."
                className="w-full bg-bg-2 border border-border-default rounded-xl pl-10 pr-4 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-3 sm:flex bg-bg-2 border border-border-default p-1 rounded-xl shrink-0">
              {(
                [
                  { id: 'active', label: 'Активні' },
                  { id: 'archived', label: 'Архівні' },
                  { id: 'all', label: 'Усі' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-center ${
                    statusFilter === tab.id
                      ? 'bg-accent text-bg-1 font-semibold'
                      : 'text-gray-2 hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cards Grid */}
          {filteredEmployees.length === 0 ? (
            <div className="bg-bg-1 border border-dashed border-border-default rounded-3xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-bg-2 border border-border-default flex items-center justify-center mx-auto text-gray-2">
                <Users className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold text-fg">
                {statusFilter === 'archived'
                  ? 'Архівних співробітників немає'
                  : 'Співробітників за цим фільтром не знайдено'}
              </div>
              <p className="text-xs text-gray-2">
                Змініть пошуковий запит, перемкніть фільтр статусу або додайте нового співробітника.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredEmployees.map((emp) => {
                const metrics = computeEmployeeMetrics(
                  emp.id,
                  entries,
                  categories,
                  ratings,
                  'all',
                  defaultEmployeeId
                );
                const latest = metrics.latestRating;
                const latestStyle = latest
                  ? SENTIMENT_STYLES[latest.sentiment] || SENTIMENT_STYLES.neutral
                  : null;

                return (
                  <div
                    key={emp.id}
                    className={`bg-bg-1 border rounded-3xl p-5 flex flex-col justify-between gap-4 transition-colors ${
                      emp.status === 'archived'
                        ? 'border-border-default opacity-75'
                        : 'border-border-default hover:border-gray-1'
                    }`}
                  >
                    <div className="space-y-4">
                      {/* Card Header: Avatar + Identity */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3.5 min-w-0">
                          {renderCircularAvatar(emp)}
                          <div className="min-w-0">
                            <h3 className="text-base font-bold text-fg truncate">{emp.name}</h3>
                            <p className="text-xs text-gray-2 truncate">
                              {emp.role || 'Співробітник'}
                              {emp.status === 'archived' ? ' · Архів' : ''}
                              {emp.isDemo ? ' · Локальний приклад' : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditModal(emp)}
                            title="Редагувати профіль"
                            aria-label={`Редагувати ${emp.name}`}
                            className="p-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleArchive(emp)}
                            title={emp.status === 'archived' ? 'Відновити з архіву' : 'Перевести в архів'}
                            aria-label={
                              emp.status === 'archived'
                                ? `Відновити ${emp.name}`
                                : `Архівувати ${emp.name}`
                            }
                            className="p-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg cursor-pointer"
                          >
                            {emp.status === 'archived' ? (
                              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Archive className="w-3.5 h-3.5 text-amber-400" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Latest Rating Block */}
                      {latest && latestStyle ? (
                        <div className={`rounded-2xl border p-3.5 space-y-1.5 ${latestStyle.container}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl leading-none" aria-hidden="true">
                                {latest.emoji}
                              </span>
                              <div>
                                <div className="text-xs font-bold tabular-nums">
                                  Остання оцінка: {latest.score}/5 · {latest.label}
                                </div>
                                <div className="text-[11px] opacity-80 tabular-nums">
                                  {latest.date} о {latest.time}
                                  {latest.isDemo ? ' · Локальний приклад' : ''}
                                </div>
                              </div>
                            </div>
                          </div>
                          {latest.comment && (
                            <p className="text-[11px] opacity-90 line-clamp-2 pt-0.5">
                              «{latest.comment}»
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-border-default bg-bg-2 p-3.5 text-xs text-gray-2">
                          Оцінок ще немає — відкрийте профіль, щоб поставити оцінку 1–5.
                        </div>
                      )}

                      {/* Concise Time Totals */}
                      <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                        <div className="bg-bg-2 border border-border-default rounded-xl p-2.5">
                          <div className="text-[10px] text-gray-2">Сьогодні</div>
                          <div className="text-xs font-bold text-fg tabular-nums mt-0.5">
                            {(metrics.minutesToday / 60).toFixed(1)} год
                          </div>
                        </div>
                        <div className="bg-bg-2 border border-border-default rounded-xl p-2.5">
                          <div className="text-[10px] text-gray-2">Місяць</div>
                          <div className="text-xs font-bold text-fg tabular-nums mt-0.5">
                            {(metrics.minutesMonth / 60).toFixed(1)} год
                          </div>
                        </div>
                        <div className="bg-bg-2 border border-border-default rounded-xl p-2.5">
                          <div className="text-[10px] text-gray-2">Усього</div>
                          <div className="text-xs font-bold text-accent tabular-nums mt-0.5">
                            {(metrics.minutesAll / 60).toFixed(1)} год
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEmployeeId(emp.id);
                        setRatingFeedback(null);
                      }}
                      className="w-full bg-bg-2 hover:bg-accent text-fg hover:text-bg-1 border border-border-default hover:border-accent py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Профіль, оцінка та аналіз ({metrics.sessionCountAll})</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {isEmpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 w-full max-w-lg space-y-5 shadow-2xl my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border-default pb-4">
              <h3 className="text-base font-bold text-fg">
                {editingEmployee ? `Редагувати: ${editingEmployee.name}` : 'Додати нового співробітника'}
              </h3>
              <button
                type="button"
                onClick={() => setIsEmpModalOpen(false)}
                aria-label="Закрити вікно"
                className="text-gray-2 hover:text-fg p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitEmployee} className="space-y-4">
              <div>
                <label htmlFor="emp-name-input" className="text-xs text-gray-2 font-medium block mb-1">
                  Ім'я співробітника *
                </label>
                <input
                  id="emp-name-input"
                  type="text"
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  placeholder="Наприклад: Олексій Коваленко"
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label htmlFor="emp-role-input" className="text-xs text-gray-2 font-medium block mb-1">
                  Посада або роль (необов'язково)
                </label>
                <input
                  id="emp-role-input"
                  type="text"
                  value={empRole}
                  onChange={(e) => setEmpRole(e.target.value)}
                  placeholder="Наприклад: UI/UX дизайнер"
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label htmlFor="emp-notes-input" className="text-xs text-gray-2 font-medium block mb-1">
                  Нотатки (необов'язково)
                </label>
                <textarea
                  id="emp-notes-input"
                  rows={2}
                  value={empNotes}
                  onChange={(e) => setEmpNotes(e.target.value)}
                  placeholder="Контекст відповідальності або коментар..."
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent resize-none"
                />
              </div>

              {/* Browser-local Avatar & Portrait Pickers */}
              <div className="bg-bg-2 border border-border-default rounded-2xl p-4 space-y-3">
                <div className="text-[11px] text-gray-2 leading-relaxed">
                  Фото аватара й портрета зберігаються локально в браузері (localStorage) і не записуються у вигляді base64 в Google Таблицю.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Avatar */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-2">Круглий аватар (URL або файл)</div>
                    <div className="flex items-center gap-2.5">
                      <div className="w-11 h-11 rounded-full overflow-hidden border border-border-default bg-bg-1 flex items-center justify-center shrink-0">
                        {empAvatarUrl &&
                        resolveAssetUrl(empAvatarUrl) &&
                        !brokenImages[`modal-avatar:${empAvatarUrl}`] ? (
                          <img
                            src={resolveAssetUrl(empAvatarUrl)}
                            alt="Прев'ю аватара"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={() => {
                              setBrokenImages((prev) => ({
                                ...prev,
                                [`modal-avatar:${empAvatarUrl}`]: true,
                              }));
                            }}
                          />
                        ) : (
                          <User className="w-4 h-4 text-gray-1" />
                        )}
                      </div>
                      <label className="bg-bg-1 hover:bg-border-default border border-border-default text-fg px-2.5 py-1.5 rounded-xl text-[11px] font-medium flex items-center gap-1.5 cursor-pointer">
                        <Upload className="w-3 h-3 text-accent" />
                        <span>Файл</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleUploadEmployeeImage('avatar', e)}
                        />
                      </label>
                      {empAvatarUrl && (
                        <button
                          type="button"
                          onClick={() => setEmpAvatarUrl('')}
                          className="text-[11px] text-gray-2 hover:text-danger"
                        >
                          Скинути
                        </button>
                      )}
                    </div>
                    <input
                      type="url"
                      placeholder="Або вставте HTTPS URL аватара..."
                      value={empAvatarUrl?.startsWith('data:') ? '' : empAvatarUrl}
                      onChange={(e) => setEmpAvatarUrl(e.target.value.trim())}
                      className="w-full bg-bg-1 border border-border-default rounded-xl px-3 py-1.5 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                    />
                  </div>

                  {/* Portrait */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-2">Портрет (URL або файл)</div>
                    <div className="flex items-center gap-2.5">
                      <div className="w-11 h-11 rounded-xl overflow-hidden border border-border-default bg-bg-1 flex items-center justify-center shrink-0">
                        {empPortraitUrl &&
                        resolveAssetUrl(empPortraitUrl) &&
                        !brokenImages[`modal-portrait:${empPortraitUrl}`] ? (
                          <img
                            src={resolveAssetUrl(empPortraitUrl)}
                            alt="Прев'ю портрета"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={() => {
                              setBrokenImages((prev) => ({
                                ...prev,
                                [`modal-portrait:${empPortraitUrl}`]: true,
                              }));
                            }}
                          />
                        ) : (
                          <User className="w-4 h-4 text-gray-1" />
                        )}
                      </div>
                      <label className="bg-bg-1 hover:bg-border-default border border-border-default text-fg px-2.5 py-1.5 rounded-xl text-[11px] font-medium flex items-center gap-1.5 cursor-pointer">
                        <Upload className="w-3 h-3 text-accent" />
                        <span>Файл</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleUploadEmployeeImage('portrait', e)}
                        />
                      </label>
                      {empPortraitUrl && (
                        <button
                          type="button"
                          onClick={() => setEmpPortraitUrl('')}
                          className="text-[11px] text-gray-2 hover:text-danger"
                        >
                          Скинути
                        </button>
                      )}
                    </div>
                    <input
                      type="url"
                      placeholder="Або вставте HTTPS URL портрета..."
                      value={empPortraitUrl?.startsWith('data:') ? '' : empPortraitUrl}
                      onChange={(e) => setEmpPortraitUrl(e.target.value.trim())}
                      className="w-full bg-bg-1 border border-border-default rounded-xl px-3 py-1.5 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                {localTeamAssets.length > 0 && (
                  <div className="pt-2 border-t border-border-default">
                    <label htmlFor="reuse-lib-avatar" className="text-[11px] text-gray-2 block mb-1">
                      Або обрати аватар із локальної бібліотеки зображень
                    </label>
                    <select
                      id="reuse-lib-avatar"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) setEmpAvatarUrl(e.target.value);
                      }}
                      className="w-full bg-bg-1 border border-border-default rounded-xl px-3 py-1.5 text-xs text-fg"
                    >
                      <option value="">Оберіть збережений актив...</option>
                      {localTeamAssets.map((a) => (
                        <option key={a.id} value={a.url}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {empError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border bg-danger/10 border-danger/30 text-danger text-xs flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{empError}</span>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEmpModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-bg-2 border border-border-default text-gray-2 hover:text-fg text-xs font-medium hover:bg-border-default cursor-pointer"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  disabled={isSavingEmp}
                  className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSavingEmp ? 'Збереження...' : editingEmployee ? 'Зберегти зміни' : 'Додати співробітника'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
