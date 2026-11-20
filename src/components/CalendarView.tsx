import React, { useEffect, useMemo, useState } from 'react';
import { TimeEntry, Category, ActionType, Project, Employee } from '../types';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Edit3, Eye, Plus, Trash2, User } from 'lucide-react';
import { filterEntriesByEmployee, getDefaultEmployeeId } from '../utils/teamUtils';

interface CalendarViewProps {
  entries: TimeEntry[];
  categories: Category[];
  actionTypes: ActionType[];
  projects: Project[];
  employees: Employee[];
  selectedEmployeeFilter?: string;
  onSelectEmployeeFilter?: (employeeId: string) => void;
  isReadOnly?: boolean;
  onAddManualEntry: (entry: Omit<TimeEntry, 'id'>) => void;
  onUpdateEntry: (entry: TimeEntry) => void;
  onDeleteEntry: (id: string) => void;
}

function parseTimeToMinutes(timeValue: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  entries,
  categories,
  actionTypes,
  projects,
  employees,
  selectedEmployeeFilter = 'all',
  onSelectEmployeeFilter,
  isReadOnly = false,
  onAddManualEntry,
  onUpdateEntry,
  onDeleteEntry,
}) => {
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState(selectedEmployeeFilter);

  useEffect(() => {
    setSelectedEmployee(selectedEmployeeFilter);
  }, [selectedEmployeeFilter]);

  const defaultEmpId = useMemo(() => getDefaultEmployeeId(employees), [employees]);
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees]
  );

  // Add / Edit entry modal form state
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:30');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [actionTypeId, setActionTypeId] = useState(actionTypes[0]?.id || '');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [employeeId, setEmployeeId] = useState(defaultEmpId);
  const [relatedEmployeeId, setRelatedEmployeeId] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingEntry && !activeEmployees.some((e) => e.id === employeeId)) {
      setEmployeeId(defaultEmpId);
    }
  }, [activeEmployees, defaultEmpId, employeeId, editingEntry]);

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
        setEditingEntry(null);
        setFormError(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingEntry(null);
    setFormError(null);
  };

  const openCreateModal = (prefillDate?: string) => {
    if (isReadOnly) return;
    setEditingEntry(null);
    setManualDate(prefillDate || new Date().toISOString().split('T')[0]);
    setStartTime('10:00');
    setEndTime('11:30');
    setDurationMinutes(90);
    setCategoryId(categories[0]?.id || '');
    setActionTypeId(actionTypes[0]?.id || '');
    setProjectId(projects[0]?.id || '');
    const preferredEmployeeId =
      selectedEmployee !== 'all' && activeEmployees.some((e) => e.id === selectedEmployee)
        ? selectedEmployee
        : defaultEmpId;
    setEmployeeId(preferredEmployeeId);
    setRelatedEmployeeId('');
    setDescription('');
    setNotes('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setManualDate(entry.date || new Date().toISOString().split('T')[0]);
    setStartTime(entry.startTime || '10:00');
    setEndTime(entry.endTime || '11:00');
    setDurationMinutes(Math.max(1, Math.round(Number(entry.durationMinutes) || 1)));
    setCategoryId(entry.categoryId || categories[0]?.id || '');
    setActionTypeId(entry.actionTypeId || actionTypes[0]?.id || '');
    setProjectId(entry.projectId || projects[0]?.id || '');
    setEmployeeId(entry.employeeId || defaultEmpId);
    setRelatedEmployeeId(entry.relatedEmployeeId || '');
    setDescription(entry.description || '');
    setNotes(((entry as TimeEntry & { notes?: string }).notes || '').toString());
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleTimeRangeChange = (nextStart: string, nextEnd: string) => {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    const startTotal = parseTimeToMinutes(nextStart);
    const endTotal = parseTimeToMinutes(nextEnd);
    if (startTotal !== null && endTotal !== null && endTotal > startTotal) {
      setDurationMinutes(endTotal - startTotal);
    }
  };

  const handleEmployeeFilterChange = (val: string) => {
    setSelectedEmployee(val);
    onSelectEmployeeFilter?.(val);
  };

  const filteredEntries = useMemo(
    () => filterEntriesByEmployee(entries, selectedEmployee, defaultEmpId),
    [entries, selectedEmployee, defaultEmpId]
  );

  const selectableEmployees = useMemo(() => {
    if (!editingEntry) return activeEmployees;
    const entryEmpId = editingEntry.employeeId || defaultEmpId;
    if (activeEmployees.some((e) => e.id === entryEmpId)) return activeEmployees;
    const archivedMatch = employees.find((e) => e.id === entryEmpId);
    return archivedMatch ? [archivedMatch, ...activeEmployees] : activeEmployees;
  }, [activeEmployees, defaultEmpId, editingEntry, employees]);

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!manualDate.trim()) {
      setFormError('Оберіть дату запису.');
      return;
    }

    const startTotal = parseTimeToMinutes(startTime);
    const endTotal = parseTimeToMinutes(endTime);
    if (startTotal !== null && endTotal !== null && endTotal < startTotal) {
      setFormError('Час завершення не може бути раніше часу початку.');
      return;
    }

    const finalDuration = Math.max(1, Math.round(Number(durationMinutes) || 1));

    if (editingEntry) {
      const updatedEntry: TimeEntry & { notes?: string } = {
        ...editingEntry,
        date: manualDate.trim(),
        startTime,
        endTime,
        durationMinutes: finalDuration,
        categoryId,
        actionTypeId,
        projectId,
        employeeId: employeeId || defaultEmpId,
        relatedEmployeeId: relatedEmployeeId || undefined,
        description: description.trim() || 'Запис часу',
        notes: notes.trim() || '',
      };
      onUpdateEntry(updatedEntry);
      closeModal();
      return;
    }

    onAddManualEntry({
      date: manualDate.trim(),
      startTime,
      endTime,
      durationMinutes: Math.max(1, finalDuration),
      categoryId,
      actionTypeId,
      projectId,
      employeeId: employeeId || defaultEmpId,
      relatedEmployeeId: relatedEmployeeId || undefined,
      description: description.trim() || 'Ручний запис часу',
      isManual: true,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    } as Omit<TimeEntry, 'id'>);

    closeModal();
  };

  const daysInCurrentMonth = useMemo(
    () => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate(),
    [currentDate]
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <CalendarIcon className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Календар та хронологія роботи</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            {isReadOnly
              ? 'Переглядайте хронологічний розподіл сесій за місяць, тиждень чи день. Натисніть на будь-який запис, щоб переглянути деталі.'
              : 'Переглядайте хронологічний розподіл сесій за місяць, тиждень чи день. Натисніть на будь-який запис, щоб відредагувати його.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
          {/* Employee Filter */}
          <select
            aria-label="Фільтр календаря за співробітником"
            value={selectedEmployee}
            onChange={(e) => handleEmployeeFilterChange(e.target.value)}
            className="w-full sm:w-auto bg-bg-1 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Усі співробітники</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
              </option>
            ))}
          </select>

          {/* View Mode Toggle */}
          <div className="grid grid-cols-3 sm:flex bg-bg-1 border border-border-default p-1 rounded-xl">
            {(['month', 'week', 'day'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  viewMode === mode ? 'bg-accent text-bg-1 font-semibold' : 'text-gray-2 hover:text-fg'
                }`}
              >
                {mode === 'month' ? 'Місяць' : mode === 'week' ? 'Тиждень' : 'День'}
              </button>
            ))}
          </div>

          {!isReadOnly && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Додати запис вручну</span>
            </button>
          )}
        </div>
      </div>

      {/* Calendar Grid / Content */}
      <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 space-y-5 sm:space-y-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider">
            {currentDate.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const d = new Date(currentDate);
                d.setMonth(d.getMonth() - 1);
                setCurrentDate(d);
              }}
              aria-label="Попередній місяць"
              className="p-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-1.5 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-xs text-gray-2 hover:text-fg font-medium transition-colors whitespace-nowrap"
            >
              Сьогодні
            </button>
            <button
              onClick={() => {
                const d = new Date(currentDate);
                d.setMonth(d.getMonth() + 1);
                setCurrentDate(d);
              }}
              aria-label="Наступний місяць"
              className="p-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Month View Grid */}
        {viewMode === 'month' && (
          <div className="space-y-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-2 lg:gap-3">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((d) => (
                <div key={d} className="text-center text-[11px] sm:text-xs font-semibold text-gray-2 py-1 sm:py-2">
                  {d}
                </div>
              ))}

              {Array.from({ length: 35 }).map((_, i) => {
                const dayNum = i + 1;
                const isValidDay = dayNum <= daysInCurrentMonth;
                const dateStr = isValidDay
                  ? `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
                  : '';
                const dayEntries = isValidDay ? filteredEntries.filter((e) => e.date === dateStr) : [];
                const totalMins = dayEntries.reduce((acc, e) => acc + e.durationMinutes, 0);

                return (
                  <div
                    key={i}
                    className={`min-h-[56px] sm:min-h-[92px] lg:min-h-[110px] bg-bg-2 border rounded-xl sm:rounded-2xl p-1.5 sm:p-2.5 lg:p-3 flex flex-col justify-between transition-all ${
                      dayEntries.length > 0 ? 'border-accent/40' : 'border-border-default'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] sm:text-xs font-bold text-gray-2 tabular-nums">
                        {isValidDay ? dayNum : ''}
                      </span>
                      {totalMins > 0 && (
                        <>
                          <span className="hidden sm:inline-block text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded font-semibold tabular-nums whitespace-nowrap">
                            {(totalMins / 60).toFixed(1)} год
                          </span>
                          <span className="sm:hidden text-[9px] text-accent font-bold tabular-nums">
                            {(totalMins / 60).toFixed(1)}г
                          </span>
                        </>
                      )}
                    </div>

                    {/* Desktop/Tablet clickable entry chips */}
                    <div className="hidden sm:block space-y-1 overflow-y-auto max-h-[60px]">
                      {dayEntries.map((entry) => {
                        const cat = categories.find((c) => c.id === entry.categoryId);
                        const emp = employees.find((item) => item.id === (entry.employeeId || defaultEmpId));
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => openEditModal(entry)}
                            className="w-full text-left text-[10px] p-1 rounded bg-bg-1 border border-border-default hover:border-accent/70 hover:bg-bg-2 text-fg truncate flex items-center gap-1 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                            title={`Редагувати: ${emp ? `${emp.name} — ` : ''}${entry.startTime} ${entry.description}`}
                            aria-label={`Редагувати запис ${entry.startTime} ${entry.description}`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: cat?.color || 'var(--color-accent)' }}
                            />
                            <span className="truncate">{entry.startTime} — {entry.description}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Mobile compact dot indicators */}
                    {dayEntries.length > 0 && (
                      <div className="sm:hidden flex flex-wrap gap-0.5 pt-1">
                        {dayEntries.slice(0, 4).map((entry) => {
                          const cat = categories.find((c) => c.id === entry.categoryId);
                          return (
                            <span
                              key={entry.id}
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: cat?.color || 'var(--color-accent)' }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mobile Agenda List for Readable & Clickable Session Details */}
            <div className="sm:hidden space-y-2 pt-2 border-t border-border-default">
              <div className="text-xs font-semibold text-gray-2">
                {isReadOnly ? 'Сесії цього місяця (натисніть для перегляду):' : 'Сесії цього місяця (натисніть для редагування):'}
              </div>
              {filteredEntries.filter((e) => {
                const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                return e.date.startsWith(monthPrefix);
              }).length === 0 ? (
                <div className="text-xs text-gray-1 py-3">У цьому місяці ще немає записів.</div>
              ) : (
                filteredEntries
                  .filter((e) => {
                    const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                    return e.date.startsWith(monthPrefix);
                  })
                  .map((entry) => {
                    const cat = categories.find((c) => c.id === entry.categoryId);
                    const emp = employees.find((item) => item.id === (entry.employeeId || defaultEmpId));
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => openEditModal(entry)}
                        className="w-full text-left bg-bg-2 border border-border-default hover:border-accent/70 rounded-xl p-3 flex items-center justify-between gap-3 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-xs font-semibold text-fg truncate">{entry.description}</div>
                          <div className="text-[11px] text-gray-2 flex flex-wrap items-center gap-1.5 tabular-nums">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: cat?.color || 'var(--color-accent)' }}
                            />
                            <span>{entry.date} · {entry.startTime}</span>
                            {emp && <span>· {emp.name}</span>}
                          </div>
                        </div>
                        <span className="text-xs font-mono font-bold text-accent shrink-0 tabular-nums">
                          {(entry.durationMinutes / 60).toFixed(1)} год
                        </span>
                      </button>
                    );
                  })
              )}
            </div>
          </div>
        )}

        {/* Week / Day View Timeline */}
        {viewMode !== 'month' && (
          <div className="space-y-3">
            <div className="text-xs text-gray-2 font-medium">Хронологічна стрічка сесій за обраний період:</div>
            {filteredEntries.length === 0 ? (
              <div className="text-center py-12 text-gray-1 text-xs">Немає записаних сесій часу за обраним фільтром.</div>
            ) : (
              <div className="space-y-2">
                {filteredEntries.map((entry) => {
                  const cat = categories.find((c) => c.id === entry.categoryId);
                  const proj = projects.find((p) => p.id === entry.projectId);
                  const emp = employees.find((item) => item.id === (entry.employeeId || defaultEmpId));
                  return (
                    <div
                      key={entry.id}
                      onClick={() => openEditModal(entry)}
                      className="bg-bg-2 border border-border-default hover:border-accent/60 p-3.5 sm:p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                        <div
                          className="w-2.5 sm:w-3 h-10 sm:h-12 rounded-full shrink-0"
                          style={{ backgroundColor: cat?.color || 'var(--color-accent)' }}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-fg tabular-nums">{entry.date} · {entry.startTime} – {entry.endTime}</span>
                            <span className="text-xs text-gray-2 tabular-nums">
                              {(entry.durationMinutes / 60).toFixed(1)} год
                            </span>
                            {emp && (
                              <span className="text-xs text-gray-2 flex items-center gap-1">
                                <User className="w-3 h-3 text-accent shrink-0" />
                                <span>{emp.name}</span>
                              </span>
                            )}
                            {proj && (
                              <span className="text-[11px] text-accent font-medium">{proj.name}</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-2 mt-1 break-words">{entry.description}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(entry);
                          }}
                          className="text-xs text-gray-2 hover:text-fg px-3 py-1.5 rounded-lg bg-bg-1 border border-border-default hover:border-accent/60 flex items-center gap-1.5 transition-colors cursor-pointer"
                          aria-label={isReadOnly ? 'Деталі запису' : 'Редагувати запис'}
                        >
                          {isReadOnly ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                          <span>{isReadOnly ? 'Деталі' : 'Редагувати'}</span>
                        </button>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteEntry(entry.id);
                            }}
                            className="text-xs text-danger hover:text-danger/80 px-3 py-1.5 rounded-lg bg-danger/10 transition-colors cursor-pointer"
                          >
                            Видалити
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Entry Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-entry-modal-title"
            className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 w-full max-w-lg space-y-5 sm:space-y-6 shadow-2xl animate-in fade-in zoom-in duration-200 my-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-border-default pb-4">
              <h3 id="calendar-entry-modal-title" className="text-base font-bold text-fg">
                {isReadOnly
                  ? 'Деталі запису часу (лише перегляд)'
                  : editingEntry
                  ? 'Редагувати запис часу'
                  : 'Додати запис часу вручну'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Закрити вікно"
                className="text-gray-2 hover:text-fg text-sm font-semibold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="calendar-entry-date" className="text-xs text-gray-2 block mb-1">
                    Дата
                  </label>
                  <input
                    id="calendar-entry-date"
                    type="date"
                    disabled={isReadOnly}
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>

                <div>
                  <label htmlFor="manual-employee-select" className="text-xs text-gray-2 block mb-1">
                    Співробітник
                  </label>
                  <select
                    id="manual-employee-select"
                    disabled={isReadOnly}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  >
                    {selectableEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="calendar-entry-start" className="text-xs text-gray-2 block mb-1">
                    Час початку
                  </label>
                  <input
                    id="calendar-entry-start"
                    type="time"
                    disabled={isReadOnly}
                    value={startTime}
                    onChange={(e) => handleTimeRangeChange(e.target.value, endTime)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>
                <div>
                  <label htmlFor="calendar-entry-end" className="text-xs text-gray-2 block mb-1">
                    Час завершення
                  </label>
                  <input
                    id="calendar-entry-end"
                    type="time"
                    disabled={isReadOnly}
                    value={endTime}
                    onChange={(e) => handleTimeRangeChange(startTime, e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>
                <div>
                  <label htmlFor="calendar-entry-duration" className="text-xs text-gray-2 block mb-1">
                    Тривалість (хв)
                  </label>
                  <input
                    id="calendar-entry-duration"
                    type="number"
                    min={1}
                    disabled={isReadOnly}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="calendar-entry-project" className="text-xs text-gray-2 block mb-1">
                    Проєкт
                  </label>
                  <select
                    id="calendar-entry-project"
                    disabled={isReadOnly}
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="calendar-entry-category" className="text-xs text-gray-2 block mb-1">
                    Категорія
                  </label>
                  <select
                    id="calendar-entry-category"
                    disabled={isReadOnly}
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="calendar-entry-action" className="text-xs text-gray-2 block mb-1">
                    Дія
                  </label>
                  <select
                    id="calendar-entry-action"
                    disabled={isReadOnly}
                    value={actionTypeId}
                    onChange={(e) => setActionTypeId(e.target.value)}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-2.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  >
                    {actionTypes.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="manual-related-employee-select" className="text-xs text-gray-2 block mb-1">
                  Пов’язаний співробітник (опційно)
                </label>
                <select
                  id="manual-related-employee-select"
                  disabled={isReadOnly}
                  value={relatedEmployeeId}
                  onChange={(e) => setRelatedEmployeeId(e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                >
                  <option value="">Не вказано</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="calendar-entry-description" className="text-xs text-gray-2 block mb-1">
                  Опис задачі
                </label>
                <textarea
                  id="calendar-entry-description"
                  rows={2}
                  disabled={isReadOnly}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Опис виконаної роботи..."
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent resize-none disabled:opacity-75"
                />
              </div>

              <div>
                <label htmlFor="calendar-entry-notes" className="text-xs text-gray-2 block mb-1">
                  Примітка (опційно)
                </label>
                <input
                  id="calendar-entry-notes"
                  type="text"
                  disabled={isReadOnly}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Додатковий коментар..."
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent disabled:opacity-75"
                />
              </div>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger"
                >
                  {formError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 pt-2">
                {editingEntry && !isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = editingEntry.id;
                      closeModal();
                      onDeleteEntry(targetId);
                    }}
                    className="px-4 py-2 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Видалити запис</span>
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 rounded-xl bg-bg-2 border border-border-default text-gray-2 hover:text-fg text-xs font-medium hover:bg-border-default cursor-pointer"
                  >
                    {isReadOnly ? 'Закрити' : 'Скасувати'}
                  </button>
                  {!isReadOnly && (
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-semibold shadow-lg shadow-accent/20 cursor-pointer"
                    >
                      {editingEntry ? 'Зберегти зміни' : 'Зберегти запис'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
