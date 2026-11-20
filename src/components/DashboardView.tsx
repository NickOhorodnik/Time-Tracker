import React, { useEffect, useMemo, useState } from 'react';
import { TimeEntry, Category, ActionType, Project, AppSettings, Phrase, ActiveTimerState, Employee, SyncState } from '../types';
import { CharacterWidget } from './CharacterWidget';
import { MotivationalBanner } from './MotivationalBanner';
import { Play, Pause, Square, Clock } from 'lucide-react';
import { getDefaultEmployeeId } from '../utils/teamUtils';

interface DashboardViewProps {
  entries: TimeEntry[];
  categories: Category[];
  actionTypes: ActionType[];
  projects: Project[];
  employees: Employee[];
  settings: AppSettings;
  phrases: Phrase[];
  motivationalPhrases: any[];
  timerState: ActiveTimerState | null;
  syncState?: SyncState;
  onStartTimer: (
    categoryId: string,
    actionTypeId: string,
    projectId: string,
    description: string,
    employeeId: string,
    relatedEmployeeId?: string
  ) => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onStopTimer: () => void;
  onUpdateTimerField: (updates: Partial<ActiveTimerState>) => void;
  onNavigateTab: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  entries,
  categories,
  actionTypes,
  projects,
  employees,
  settings,
  phrases,
  motivationalPhrases,
  timerState,
  syncState,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onStopTimer,
  onUpdateTimerField,
  onNavigateTab,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month');

  const defaultEmpId = useMemo(() => getDefaultEmployeeId(employees), [employees]);
  const activeEmployees = useMemo(
    () => employees.filter((emp) => emp.status === 'active'),
    [employees]
  );

  // Quick timer form state
  const [timerCat, setTimerCat] = useState(categories[0]?.id || '');
  const [timerAction, setTimerAction] = useState(actionTypes[0]?.id || '');
  const [timerProj, setTimerProj] = useState(projects[0]?.id || '');
  const [timerEmp, setTimerEmp] = useState(defaultEmpId);
  const [timerDesc, setTimerDesc] = useState('');

  useEffect(() => {
    if (timerState?.isRunning) return;
    if (!activeEmployees.some((e) => e.id === timerEmp)) {
      setTimerEmp(defaultEmpId);
    }
  }, [activeEmployees, defaultEmpId, timerEmp, timerState?.isRunning]);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.id === timerCat)) {
      setTimerCat(categories[0].id);
    }
  }, [categories, timerCat]);

  useEffect(() => {
    if (actionTypes.length > 0 && !actionTypes.some((a) => a.id === timerAction)) {
      setTimerAction(actionTypes[0].id);
    }
  }, [actionTypes, timerAction]);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === timerProj)) {
      setTimerProj(projects[0].id);
    }
  }, [projects, timerProj]);

  const currentTimerCat = timerState?.isRunning ? timerState.categoryId : (timerCat || categories[0]?.id || '');
  const currentTimerAction = timerState?.isRunning ? timerState.actionTypeId : (timerAction || actionTypes[0]?.id || '');
  const currentTimerProj = timerState?.isRunning ? timerState.projectId : (timerProj || projects[0]?.id || '');
  const currentTimerEmp = timerState?.isRunning ? (timerState.employeeId || defaultEmpId) : (timerEmp || defaultEmpId);
  const currentTimerDesc = timerState?.isRunning ? timerState.description : timerDesc;

  const handleQuickFieldChange = (field: keyof ActiveTimerState, value: any) => {
    if (timerState?.isRunning) {
      onUpdateTimerField({ [field]: value });
    } else {
      if (field === 'categoryId') setTimerCat(value);
      if (field === 'actionTypeId') setTimerAction(value);
      if (field === 'projectId') setTimerProj(value);
      if (field === 'employeeId') setTimerEmp(value);
      if (field === 'description') setTimerDesc(value);
    }
  };

  const selectableEmployees = useMemo(() => {
    if (activeEmployees.some((e) => e.id === currentTimerEmp)) return activeEmployees;
    const lockedEmp = employees.find((e) => e.id === currentTimerEmp);
    return lockedEmp ? [lockedEmp, ...activeEmployees] : activeEmployees;
  }, [activeEmployees, employees, currentTimerEmp]);

  // Calculations
  const todayStr = new Date().toISOString().split('T')[0];

  // Helper for week check
  const isThisWeek = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);
    return d >= startOfWeek;
  };

  const isThisMonth = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  };

  const minutesToday = entries
    .filter((e) => e.date === todayStr)
    .reduce((acc, e) => acc + e.durationMinutes, 0);

  const minutesWeek = entries
    .filter((e) => isThisWeek(e.date))
    .reduce((acc, e) => acc + e.durationMinutes, 0);

  const minutesMonth = entries
    .filter((e) => isThisMonth(e.date))
    .reduce((acc, e) => acc + e.durationMinutes, 0);

  const minutesAll = entries.reduce((acc, e) => acc + e.durationMinutes, 0);

  const hoursToday = minutesToday / 60;
  const hoursWeek = minutesWeek / 60;
  const hoursMonth = minutesMonth / 60;
  const hoursAll = minutesAll / 60;

  // Selected period hours for circular progress & opportunity cost
  const selectedHours = 
    selectedPeriod === 'today' ? hoursToday :
    selectedPeriod === 'week' ? hoursWeek :
    selectedPeriod === 'month' ? hoursMonth : hoursAll;

  const opportunityCost = Math.round(selectedHours * settings.hourlyRate);
  const target = settings.targetHours > 0 ? settings.targetHours : 0;
  const progressPercent = target > 0 ? Math.min(100, Math.round((selectedHours / target) * 100)) : 0;

  // Category distribution
  const categoryStats = categories.map((cat) => {
    const totalMins = entries
      .filter((e) => e.categoryId === cat.id)
      .reduce((acc, e) => acc + e.durationMinutes, 0);
    return {
      ...cat,
      hours: totalMins / 60,
      percent: minutesAll > 0 ? Math.round((totalMins / minutesAll) * 100) : 0,
    };
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 max-w-[1600px] mx-auto">
      {/* Top Hero Section: Integrated Motivational Banner & Character */}
      <div className="relative mb-4 sm:mb-6 pt-4 sm:pt-8 md:pt-12 overflow-visible z-30">
        <div className="bg-bg-1 border border-border-default rounded-3xl p-1 shadow-2xl relative overflow-visible">
          <div className="flex flex-col md:flex-row items-center md:items-stretch min-h-[110px] relative overflow-visible">
            {/* Left: The Banner Content */}
            <div className="w-full flex-1 p-4 md:p-6 md:pr-64 lg:pr-80 relative z-10">
              <MotivationalBanner
                phrases={motivationalPhrases}
                totalHours={hoursAll}
                hourlyRate={settings.hourlyRate}
                rotationMinutes={settings.motivationRotationMinutes}
                variant="minimal"
                syncState={syncState}
              />
            </div>
            
            {/* Right/Overlay: The Character */}
            <div className="static md:absolute bottom-0 right-0 md:right-4 lg:right-8 z-[100] flex items-end pointer-events-auto overflow-visible">
              <div className="transform translate-y-1 md:translate-y-2 overflow-visible">
                <CharacterWidget
                  stages={settings.stages}
                  totalHours={hoursAll}
                  targetHours={target}
                  progressionMode={settings.progressionMode}
                  monthlyHours={hoursMonth}
                  phrases={phrases}
                  bubbleDurationMs={settings.bubbleDurationMs}
                  imageProgressionEnabled={settings.imageProgressionEnabled}
                  variant="minimal"
                  syncState={syncState}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Dashboard analytics, Right Quick Timer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Progress Ring & KPI Cards */}
        <div className="xl:col-span-8 space-y-6 min-w-0">
          
          {/* Top Row KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-bg-1 border border-border-default p-3.5 sm:p-4 rounded-2xl">
              <div className="text-xs text-gray-2 font-medium mb-1">Сьогодні</div>
              <div className="text-lg sm:text-xl font-bold text-fg tabular-nums">{hoursToday.toFixed(1)} <span className="text-xs font-normal text-gray-2">год</span></div>
              <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 tabular-nums">
                <span>+{(hoursToday * settings.hourlyRate).toFixed(0)} $</span>
              </div>
            </div>

            <div className="bg-bg-1 border border-border-default p-3.5 sm:p-4 rounded-2xl">
              <div className="text-xs text-gray-2 font-medium mb-1">Цей тиждень</div>
              <div className="text-lg sm:text-xl font-bold text-fg tabular-nums">{hoursWeek.toFixed(1)} <span className="text-xs font-normal text-gray-2">год</span></div>
              <div className="text-[10px] text-gray-1 mt-1">З початку тижня</div>
            </div>

            <div className="bg-bg-1 border border-border-default p-3.5 sm:p-4 rounded-2xl">
              <div className="text-xs text-gray-2 font-medium mb-1">Цей місяць</div>
              <div className="text-lg sm:text-xl font-bold text-fg tabular-nums">{hoursMonth.toFixed(1)} <span className="text-xs font-normal text-gray-2">год</span></div>
              <div className="text-[10px] text-accent mt-1">{target > 0 ? `Ціль: ${target} год` : 'Ціль не задана'}</div>
            </div>

            <div className="bg-bg-1 border border-border-default p-3.5 sm:p-4 rounded-2xl">
              <div className="text-xs text-gray-2 font-medium mb-1">Потенційна вартість</div>
              <div className="text-lg sm:text-xl font-bold text-accent tabular-nums">${(hoursAll * settings.hourlyRate).toLocaleString()}</div>
              <div className="text-[10px] text-gray-1 mt-1">{settings.hourlyRate > 0 ? `Ставка: ${settings.hourlyRate}/год` : 'Ставка не задана'}</div>
            </div>
          </div>

          {/* Segmented Progress Ring Card */}
          <div className="bg-bg-1 border border-border-default p-4 sm:p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="space-y-4 w-full min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2">
                <span className="text-xs font-semibold text-accent uppercase tracking-wider">Прогрес часу</span>
                <div className="flex flex-wrap bg-bg-2 p-0.5 rounded-lg border border-border-default">
                  {(['today', 'week', 'month', 'all'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setSelectedPeriod(p)}
                      className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${
                        selectedPeriod === p ? 'bg-accent text-bg-1 font-semibold' : 'text-gray-2 hover:text-fg'
                      }`}
                    >
                      {p === 'today' ? 'День' : p === 'week' ? 'Тиждень' : p === 'month' ? 'Місяць' : 'Ввесь'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-2xl sm:text-3xl font-extrabold text-fg tracking-tight tabular-nums">
                  ${opportunityCost.toLocaleString()}
                </div>
                <p className="text-xs text-gray-2 mt-1">
                  Зароблено / оціночна вартість за обраний період ({selectedHours.toFixed(1)} год){target > 0 ? ` із ${target} год цілі.` : ' — ціль не задана.'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 sm:gap-3">
                <button
                  onClick={() => onNavigateTab('timer')}
                  className="bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-all cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                  <span>Керувати таймером</span>
                </button>
                <button
                  onClick={() => onNavigateTab('history')}
                  className="bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg px-4 py-2.5 sm:py-2 rounded-xl text-xs font-medium transition-all cursor-pointer text-center whitespace-nowrap"
                >
                  Переглянути записи
                </button>
              </div>
            </div>

            {/* Circular Radial Segment Ring */}
            <div className="relative w-44 h-44 sm:w-48 sm:h-48 xl:w-52 xl:h-52 flex items-center justify-center shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke="var(--color-bg-2)"
                  strokeWidth="10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="10"
                  strokeDasharray="314"
                  strokeDashoffset={314 - (314 * progressPercent) / 100}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold text-fg tabular-nums">{progressPercent}%</span>
                <span className="text-[11px] text-gray-2 mt-0.5 tabular-nums">{target > 0 ? `${selectedHours.toFixed(1)} / ${target} год` : `${selectedHours.toFixed(1)} год`}</span>
              </div>
            </div>
          </div>

          {/* Category Distribution Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {categoryStats.map((cat) => (
              <div key={cat.id} className="bg-bg-1 border border-border-default p-4 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm font-semibold text-fg">{cat.name}</span>
                  </div>
                  <span className="text-xs font-bold text-fg">{cat.hours.toFixed(1)} год</span>
                </div>
                <div className="w-full bg-bg-2 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-gray-1">
                  <span>Частка в загальному часі</span>
                  <span className="font-medium text-gray-2">{cat.percent}%</span>
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Right Column: Quick Timer / Recent Activity */}
        <div className="xl:col-span-4 space-y-6 min-w-0">

          {/* Quick Timer Widget */}
          <div className="bg-bg-1 border border-border-default p-4 sm:p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-fg tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-accent shrink-0" />
                <span>Швидкий запуск таймера</span>
              </div>
              {timerState?.isRunning && (
                <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-medium animate-pulse shrink-0">
                  Активно
                </span>
              )}
            </div>

            {timerState?.isRunning && (
              <div className="space-y-3 bg-bg-2 p-3.5 rounded-xl border border-accent/30">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-accent font-medium">Сесія триває:</span>
                  <div className="text-base font-mono font-bold text-fg tabular-nums">
                    {Math.floor(timerState.elapsedSeconds / 3600).toString().padStart(2, '0')}:
                    {Math.floor((timerState.elapsedSeconds % 3600) / 60).toString().padStart(2, '0')}:
                    {(timerState.elapsedSeconds % 60).toString().padStart(2, '0')}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {timerState.isPaused ? (
                    <button
                      onClick={onResumeTimer}
                      className="flex-1 min-w-[90px] bg-emerald-600 hover:bg-emerald-500 text-fg py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 shrink-0" />
                      <span>Відновити</span>
                    </button>
                  ) : (
                    <button
                      onClick={onPauseTimer}
                      className="flex-1 min-w-[90px] bg-amber-600 hover:bg-amber-500 text-fg py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5 shrink-0" />
                      <span>Пауза</span>
                    </button>
                  )}
                  <button
                    onClick={onStopTimer}
                    className="flex-1 min-w-[90px] bg-danger hover:bg-danger/90 text-fg py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                    <span>Зупинити</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label htmlFor="quick-timer-employee" className="text-[11px] text-gray-2 block mb-1">
                  Співробітник
                </label>
                <select
                  id="quick-timer-employee"
                  value={currentTimerEmp}
                  onChange={(e) => handleQuickFieldChange('employeeId', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  {selectableEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}{emp.status === 'archived' ? ' (архів)' : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-gray-2 block mb-1">Проєкт</label>
                <select
                  value={currentTimerProj}
                  onChange={(e) => handleQuickFieldChange('projectId', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.client})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-2">
                <div>
                  <label className="text-[11px] text-gray-2 block mb-1">Категорія</label>
                  <select
                    value={currentTimerCat}
                    onChange={(e) => handleQuickFieldChange('categoryId', e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-gray-2 block mb-1">Тип дії</label>
                  <select
                    value={currentTimerAction}
                    onChange={(e) => handleQuickFieldChange('actionTypeId', e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                  >
                    {actionTypes.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-gray-2 block mb-1">Опис задачі</label>
                <input
                  type="text"
                  placeholder="Наприклад: допомога колезі з макетом..."
                  value={currentTimerDesc}
                  onChange={(e) => handleQuickFieldChange('description', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                />
              </div>

              {!timerState?.isRunning && (
                <button
                  onClick={() =>
                    onStartTimer(
                      currentTimerCat,
                      currentTimerAction,
                      currentTimerProj,
                      timerDesc,
                      currentTimerEmp
                    )
                  }
                  className="w-full bg-accent hover:bg-accent/90 text-bg-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-all cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Запустити таймер</span>
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
