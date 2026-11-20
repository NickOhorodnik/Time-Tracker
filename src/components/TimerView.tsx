import React, { useEffect, useMemo, useState } from 'react';
import { Category, ActionType, Project, ActiveTimerState, AppSettings, Phrase, TimeEntry, Employee, SyncState } from '../types';
import { CharacterWidget } from './CharacterWidget';
import { Play, Pause, Square, Clock, Folder, Tag, Layers, FileText, User } from 'lucide-react';
import { getDefaultEmployeeId } from '../utils/teamUtils';

interface TimerViewProps {
  categories: Category[];
  actionTypes: ActionType[];
  projects: Project[];
  employees: Employee[];
  timerState: ActiveTimerState | null;
  settings: AppSettings;
  entries: TimeEntry[];
  phrases: Phrase[];
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
  onUpdateElapsedSeconds: (seconds: number) => void;
  onUpdateTimerField: (updates: Partial<ActiveTimerState>) => void;
}

export const TimerView: React.FC<TimerViewProps> = ({
  categories,
  actionTypes,
  projects,
  employees,
  timerState,
  settings,
  entries,
  phrases,
  syncState,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onStopTimer,
  onUpdateElapsedSeconds,
  onUpdateTimerField,
}) => {
  const defaultEmpId = useMemo(() => getDefaultEmployeeId(employees), [employees]);
  const activeEmployees = useMemo(
    () => employees.filter((emp) => emp.status === 'active'),
    [employees]
  );

  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [actionTypeId, setActionTypeId] = useState(actionTypes[0]?.id || '');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [employeeId, setEmployeeId] = useState(defaultEmpId);
  const [relatedEmployeeId, setRelatedEmployeeId] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (timerState?.isRunning) return;
    const stillActive = activeEmployees.some((e) => e.id === employeeId);
    if (!stillActive) {
      setEmployeeId(defaultEmpId);
    }
  }, [activeEmployees, defaultEmpId, employeeId, timerState?.isRunning]);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  useEffect(() => {
    if (actionTypes.length > 0 && !actionTypes.some((a) => a.id === actionTypeId)) {
      setActionTypeId(actionTypes[0].id);
    }
  }, [actionTypes, actionTypeId]);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  const currentCategoryId = timerState?.isRunning ? timerState.categoryId : (categoryId || categories[0]?.id || '');
  const currentActionTypeId = timerState?.isRunning ? timerState.actionTypeId : (actionTypeId || actionTypes[0]?.id || '');
  const currentProjectId = timerState?.isRunning ? timerState.projectId : (projectId || projects[0]?.id || '');
  const currentEmployeeId = timerState?.isRunning ? (timerState.employeeId || defaultEmpId) : (employeeId || defaultEmpId);
  const currentRelatedEmployeeId = timerState?.isRunning ? (timerState.relatedEmployeeId || '') : relatedEmployeeId;
  const currentDescription = timerState?.isRunning ? timerState.description : description;

  const handleFieldChange = (field: keyof ActiveTimerState, value: any) => {
    if (timerState?.isRunning) {
      onUpdateTimerField({ [field]: value });
    } else {
      if (field === 'categoryId') setCategoryId(value);
      if (field === 'actionTypeId') setActionTypeId(value);
      if (field === 'projectId') setProjectId(value);
      if (field === 'employeeId') setEmployeeId(value);
      if (field === 'relatedEmployeeId') setRelatedEmployeeId(value);
      if (field === 'description') setDescription(value);
    }
  };

  const selectableEmployees = useMemo(() => {
    if (activeEmployees.some((e) => e.id === currentEmployeeId)) return activeEmployees;
    const lockedEmp = employees.find((e) => e.id === currentEmployeeId);
    return lockedEmp ? [lockedEmp, ...activeEmployees] : activeEmployees;
  }, [activeEmployees, employees, currentEmployeeId]);

  // Calculations for CharacterWidget
  const minutesAll = entries.reduce((acc, e) => acc + e.durationMinutes, 0);
  const hoursAll = minutesAll / 60;
  
  const now = new Date();
  const minutesMonth = entries
    .filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((acc, e) => acc + e.durationMinutes, 0);
  const hoursMonth = minutesMonth / 60;

  const target = settings.targetHours > 0 ? settings.targetHours : 100;

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const isRunning = timerState?.isRunning && !timerState?.isPaused;
  const isPaused = timerState?.isRunning && timerState?.isPaused;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Професійний таймер обліку часу</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            Фіксуйте допомогу колегам, рев'ю, виправлення помилок та задачі Allonsy.
          </p>
        </div>
      </div>

      {/* Main Grid: Left Timer Control Card, Right CharacterWidget */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Area: Timer Card & Form */}
        <div className="xl:col-span-8 space-y-6 min-w-0">
          {/* Main Timer Display Card */}
          <div className="bg-bg-1 border border-border-default rounded-3xl p-5 sm:p-8 shadow-2xl flex flex-col items-center text-center space-y-5 sm:space-y-6">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-accent/15 border border-accent/25 flex items-center justify-center text-accent shadow-inner">
              <Clock className={`w-8 h-8 sm:w-10 sm:h-10 ${isRunning ? 'animate-pulse' : ''}`} />
            </div>

            <div>
              {timerState?.isRunning ? (
                <div className="space-y-3">
                  <div className="text-4xl sm:text-5xl md:text-6xl font-mono font-extrabold text-fg tracking-wider tabular-nums">
                    {formatTime(timerState?.elapsedSeconds || 0)}
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2 bg-bg-2 p-3 rounded-2xl border border-border-default">
                    <span className="text-[11px] text-gray-2 font-medium">Ручне коригування часу:</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onUpdateElapsedSeconds(Math.max(0, (timerState.elapsedSeconds || 0) - 300))}
                        className="px-2 py-1 rounded-lg bg-bg-1 border border-border-default text-xs font-semibold text-fg hover:border-accent transition-colors"
                        title="Зменшити на 5 хвилин"
                      >
                        -5хв
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateElapsedSeconds(Math.max(0, (timerState.elapsedSeconds || 0) - 60))}
                        className="px-2 py-1 rounded-lg bg-bg-1 border border-border-default text-xs font-semibold text-fg hover:border-accent transition-colors"
                        title="Зменшити на 1 хвилину"
                      >
                        -1хв
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={Math.round((timerState.elapsedSeconds || 0) / 60)}
                        onChange={(e) => {
                          const mins = Math.max(0, Number(e.target.value) || 0);
                          onUpdateElapsedSeconds(mins * 60);
                        }}
                        className="w-20 bg-bg-1 border border-border-default rounded-lg px-2.5 py-1 text-xs text-fg font-mono text-center focus:outline-none focus:border-accent tabular-nums"
                        title="Введіть загальну кількість хвилин вручну"
                      />
                      <span className="text-xs text-gray-2 font-medium">хв</span>
                      <button
                        type="button"
                        onClick={() => onUpdateElapsedSeconds((timerState.elapsedSeconds || 0) + 60)}
                        className="px-2 py-1 rounded-lg bg-bg-1 border border-border-default text-xs font-semibold text-fg hover:border-accent transition-colors"
                        title="Збільшити на 1 хвилину"
                      >
                        +1хв
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateElapsedSeconds((timerState.elapsedSeconds || 0) + 300)}
                        className="px-2 py-1 rounded-lg bg-bg-1 border border-border-default text-xs font-semibold text-fg hover:border-accent transition-colors"
                        title="Збільшити на 5 хвилин"
                      >
                        +5хв
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-4xl sm:text-5xl md:text-6xl font-mono font-extrabold text-fg tracking-wider tabular-nums">
                  {formatTime(timerState?.elapsedSeconds || 0)}
                </div>
              )}
              <div className="text-xs text-gray-2 mt-2 font-medium">
                {isRunning ? '🟢 Таймер активний та записує сегмент' : isPaused ? '⏸️ Таймер на паузі' : '⏹️ Таймер зупинено'}
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 w-full max-w-md pt-2">
              {timerState?.isRunning ? (
                <>
                  {isPaused ? (
                    <button
                      onClick={onResumeTimer}
                      className="flex-1 bg-accent hover:bg-accent/90 text-bg-1 py-3.5 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-all cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Відновити</span>
                    </button>
                  ) : (
                    <button
                      onClick={onPauseTimer}
                      className="flex-1 bg-accent hover:bg-accent/90 text-bg-1 py-3.5 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-all cursor-pointer"
                    >
                      <Pause className="w-4 h-4 fill-current" />
                      <span>Пауза</span>
                    </button>
                  )}
                  <button
                    onClick={onStopTimer}
                    className="flex-1 bg-danger hover:bg-danger/90 text-fg py-3.5 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-danger/20 transition-all cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>Зупинити та зберегти</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() =>
                    onStartTimer(
                      currentCategoryId,
                      currentActionTypeId,
                      currentProjectId,
                      description,
                      currentEmployeeId,
                      currentRelatedEmployeeId || undefined
                    )
                  }
                  className="w-full bg-accent hover:bg-accent/90 text-bg-1 py-3.5 sm:py-4 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-xl shadow-accent/20 transition-all cursor-pointer"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>Почати роботу</span>
                </button>
              )}
            </div>
          </div>

          {/* Task Configuration Form */}
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 space-y-5 sm:space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg tracking-wide uppercase">Параметри задачі</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
              {/* Employee */}
              <div className="space-y-1.5">
                <label htmlFor="timer-employee-select" className="text-xs font-medium text-gray-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-accent" />
                  <span>Співробітник</span>
                </label>
                <select
                  id="timer-employee-select"
                  value={currentEmployeeId}
                  onChange={(e) => handleFieldChange('employeeId', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  {selectableEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {/* Project */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-2 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-accent" />
                  <span>Проєкт</span>
                </label>
                <select
                  value={currentProjectId}
                  onChange={(e) => handleFieldChange('projectId', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.client})</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-2 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-accent" />
                  <span>Категорія</span>
                </label>
                <select
                  value={currentCategoryId}
                  onChange={(e) => handleFieldChange('categoryId', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Action Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-2 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-accent" />
                  <span>Тип дії</span>
                </label>
                <select
                  value={currentActionTypeId}
                  onChange={(e) => handleFieldChange('actionTypeId', e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  {actionTypes.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Related Employee (Optional context without altering colleague points) */}
            <div className="space-y-1.5">
              <label htmlFor="timer-related-employee-select" className="text-xs font-medium text-gray-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-gray-2" />
                <span>Пов’язаний співробітник (опційно — для фіксації допомоги чи розбору помилок)</span>
              </label>
              <select
                id="timer-related-employee-select"
                value={currentRelatedEmployeeId}
                onChange={(e) => handleFieldChange('relatedEmployeeId', e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="">Не вказано</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent" />
                <span>Детальний опис задачі</span>
              </label>
              <textarea
                rows={3}
                placeholder="Введіть деталі допомоги колезі, рев'ю чи виправлення помилок..."
                value={currentDescription}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2.5 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent resize-none"
              />
            </div>
          </div>
        </div>

        {/* Right Hero Area: CharacterWidget */}
        <div className="xl:col-span-4 flex justify-center xl:justify-end pt-8 xl:pt-0">
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
            desktopBubblePlacement="top"
            syncState={syncState}
          />
        </div>
      </div>
    </div>
  );
};
