import React, { useEffect, useMemo, useState } from 'react';
import { TimeEntry, Category, ActionType, Project, Employee } from '../types';
import { History as HistoryIcon, Search, Trash2, Edit3, Eye, Calendar, User } from 'lucide-react';
import { filterEntriesByEmployee, getDefaultEmployeeId } from '../utils/teamUtils';

interface HistoryViewProps {
  entries: TimeEntry[];
  categories: Category[];
  actionTypes: ActionType[];
  projects: Project[];
  employees: Employee[];
  selectedEmployeeFilter?: string;
  onSelectEmployeeFilter?: (employeeId: string) => void;
  isReadOnly?: boolean;
  onDeleteEntry: (id: string) => void;
  onUpdateEntry: (entry: TimeEntry) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  entries,
  categories,
  actionTypes,
  projects,
  employees,
  selectedEmployeeFilter = 'all',
  onSelectEmployeeFilter,
  isReadOnly = false,
  onDeleteEntry,
  onUpdateEntry,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState(selectedEmployeeFilter);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  useEffect(() => {
    setSelectedEmployee(selectedEmployeeFilter);
  }, [selectedEmployeeFilter]);

  const defaultEmpId = useMemo(() => getDefaultEmployeeId(employees), [employees]);

  const handleEmployeeChange = (val: string) => {
    setSelectedEmployee(val);
    onSelectEmployeeFilter?.(val);
  };

  const filteredEntries = useMemo(() => {
    const byEmployee = filterEntriesByEmployee(entries, selectedEmployee, defaultEmpId);
    return byEmployee.filter((e) => {
      const emp = employees.find((item) => item.id === (e.employeeId || defaultEmpId));
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        e.description.toLowerCase().includes(q) ||
        e.date.includes(searchQuery) ||
        (emp?.name.toLowerCase().includes(q) ?? false);
      const matchesCategory = selectedCategory === 'all' || e.categoryId === selectedCategory;
      const matchesProject = selectedProject === 'all' || e.projectId === selectedProject;
      return matchesSearch && matchesCategory && matchesProject;
    });
  }, [entries, selectedEmployee, defaultEmpId, employees, searchQuery, selectedCategory, selectedProject]);

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (editingEntry) {
      onUpdateEntry(editingEntry);
      setEditingEntry(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <HistoryIcon className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Історія сесій та аудит записів</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            {isReadOnly
              ? 'Переглядайте записи часу та фільтруйте їх за проєктами, категоріями й співробітниками.'
              : 'Керуйте записами часу, фільтруйте за проектами та категоріями, редагуйте або видаляйте помилкові інтервали.'}
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-bg-1 border border-border-default p-4 sm:p-5 rounded-3xl flex flex-col lg:flex-row items-stretch lg:items-center gap-3 sm:gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-1" />
          <input
            type="text"
            placeholder="Пошук за описом чи датою (РРРР-ММ-ДД)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-2 border border-border-default rounded-xl pl-10 pr-4 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:flex-wrap items-center gap-2.5 sm:gap-3 w-full lg:w-auto">
          <select
            aria-label="Фільтр за співробітником"
            value={selectedEmployee}
            onChange={(e) => handleEmployeeChange(e.target.value)}
            className="w-full lg:w-auto bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Усі співробітники</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
              </option>
            ))}
          </select>

          <select
            aria-label="Фільтр за категорією"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full lg:w-auto bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Усі категорії</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            aria-label="Фільтр за проєктом"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full lg:w-auto bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Усі проєкти</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Entries Container: Mobile Cards + Desktop Table */}
      <div className="bg-bg-1 border border-border-default rounded-3xl overflow-hidden shadow-xl">
        {/* Mobile Card View (< md) */}
        <div className="md:hidden divide-y divide-border-default">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-12 px-4 text-xs text-gray-1">
              Не знайдено жодного запису за обраними фільтрами.
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const cat = categories.find((c) => c.id === entry.categoryId);
              const act = actionTypes.find((a) => a.id === entry.actionTypeId);
              const proj = projects.find((p) => p.id === entry.projectId);
              const emp = employees.find((item) => item.id === (entry.employeeId || defaultEmpId));

              return (
                <div key={entry.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-fg tabular-nums">
                        <Calendar className="w-3.5 h-3.5 text-gray-2 shrink-0" />
                        <span>{entry.date}</span>
                        <span className="text-gray-1">·</span>
                        <span className="text-gray-2">{entry.startTime}–{entry.endTime}</span>
                      </div>
                      <div className="text-xs font-medium text-fg flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="truncate">{emp?.name || '—'}</span>
                        {entry.relatedEmployeeId && (
                          <span className="text-[10px] text-gray-2 truncate">
                            (→ {employees.find((x) => x.id === entry.relatedEmployeeId)?.name || entry.relatedEmployeeId})
                          </span>
                        )}
                        {proj && (
                          <>
                            <span className="text-gray-1">·</span>
                            <span className="text-gray-2 truncate">{proj.name}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <span className="font-mono text-xs font-bold text-accent shrink-0 tabular-nums">
                      {(entry.durationMinutes / 60).toFixed(1)} год
                    </span>
                  </div>

                  {entry.description && (
                    <p className="text-xs text-gray-2 break-words leading-relaxed">{entry.description}</p>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat?.color || 'var(--color-accent)' }} />
                      <span className="text-fg font-medium truncate">{cat?.name}</span>
                      <span className="text-gray-1 truncate">
                        · {act?.name} · {entry.isManual ? 'ручний' : 'таймер'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setEditingEntry(entry)}
                        className="p-2 rounded-lg bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors"
                        title={isReadOnly ? 'Переглянути деталі' : 'Редагувати запис'}
                        aria-label={isReadOnly ? 'Переглянути деталі' : 'Редагувати запис'}
                      >
                        {isReadOnly ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                      </button>
                      {!isReadOnly && (
                        <button
                          onClick={() => onDeleteEntry(entry.id)}
                          className="p-2 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger transition-colors"
                          title="Видалити запис"
                          aria-label="Видалити запис"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop & Tablet Table View (md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-default bg-bg-2 text-[11px] font-semibold text-gray-2 uppercase tracking-wider">
                <th className="p-4">Дата / Час</th>
                <th className="p-4">Співробітник</th>
                <th className="p-4">Проєкт</th>
                <th className="p-4">Категорія & Дія</th>
                <th className="p-4">Опис</th>
                <th className="p-4">Тривалість</th>
                <th className="p-4 text-right">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default text-xs">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-1">
                    Не знайдено жодного запису за обраними фільтрами.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const cat = categories.find((c) => c.id === entry.categoryId);
                  const act = actionTypes.find((a) => a.id === entry.actionTypeId);
                  const proj = projects.find((p) => p.id === entry.projectId);
                  const emp = employees.find((item) => item.id === (entry.employeeId || defaultEmpId));

                  return (
                    <tr key={entry.id} className="hover:bg-bg-2/60 transition-colors">
                      <td className="p-4 font-medium text-fg whitespace-nowrap tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-gray-2" />
                          <span>{entry.date}</span>
                        </div>
                        <div className="text-[10px] text-gray-1 mt-0.5">{entry.startTime} – {entry.endTime}</div>
                      </td>

                      <td className="p-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-fg font-medium">
                          <User className="w-3.5 h-3.5 text-accent shrink-0" />
                          <span>{emp?.name || '—'}</span>
                        </div>
                        {entry.relatedEmployeeId && (
                          <div className="text-[10px] text-gray-1 mt-0.5">
                            Пов’язано: {employees.find((x) => x.id === entry.relatedEmployeeId)?.name || entry.relatedEmployeeId}
                          </div>
                        )}
                      </td>

                      <td className="p-4">
                        <span className="font-semibold text-fg">{proj?.name || '—'}</span>
                        <div className="text-[10px] text-gray-1">{proj?.client}</div>
                      </td>

                      <td className="p-4">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat?.color || 'var(--color-accent)' }} />
                          <span className="font-medium text-fg">{cat?.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-2">
                          {act?.name} · {entry.isManual ? 'ручний' : 'таймер'}
                        </span>
                      </td>

                      <td className="p-4 max-w-xs truncate text-gray-2">
                        {entry.description}
                      </td>

                      <td className="p-4 font-mono font-bold text-accent tabular-nums whitespace-nowrap">
                        {(entry.durationMinutes / 60).toFixed(1)} год
                      </td>

                      <td className="p-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="p-1.5 rounded-lg bg-bg-2 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg transition-colors"
                          title={isReadOnly ? 'Переглянути деталі' : 'Редагувати запис'}
                        >
                          {isReadOnly ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                        </button>
                        {!isReadOnly && (
                          <button
                            onClick={() => onDeleteEntry(entry.id)}
                            className="p-1.5 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger transition-colors"
                            title="Видалити запис"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 w-full max-w-lg space-y-5 sm:space-y-6 shadow-2xl my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border-default pb-4">
              <h3 className="text-base font-bold text-fg">
                {isReadOnly ? 'Деталі запису часу (лише перегляд)' : 'Редагувати запис часу'}
              </h3>
              <button onClick={() => setEditingEntry(null)} className="text-gray-2 hover:text-fg p-1">✕</button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="text-xs text-gray-2 block mb-1">Дата</label>
                <input
                  type="date"
                  disabled={isReadOnly}
                  value={editingEntry.date}
                  onChange={(e) => setEditingEntry({ ...editingEntry, date: e.target.value })}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-2 block mb-1">Початок</label>
                  <input
                    type="time"
                    disabled={isReadOnly}
                    value={editingEntry.startTime}
                    onChange={(e) => setEditingEntry({ ...editingEntry, startTime: e.target.value })}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-2 block mb-1">Кінець</label>
                  <input
                    type="time"
                    disabled={isReadOnly}
                    value={editingEntry.endTime}
                    onChange={(e) => setEditingEntry({ ...editingEntry, endTime: e.target.value })}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-2 block mb-1">Співробітник</label>
                  <select
                    disabled={isReadOnly}
                    value={editingEntry.employeeId || defaultEmpId}
                    onChange={(e) => setEditingEntry({ ...editingEntry, employeeId: e.target.value })}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-2 block mb-1">Тривалість (хвилин)</label>
                  <input
                    type="number"
                    disabled={isReadOnly}
                    value={editingEntry.durationMinutes}
                    onChange={(e) => setEditingEntry({ ...editingEntry, durationMinutes: Number(e.target.value) })}
                    className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-75"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-2 block mb-1">Пов’язаний співробітник (опційно)</label>
                <select
                  disabled={isReadOnly}
                  value={editingEntry.relatedEmployeeId || ''}
                  onChange={(e) => setEditingEntry({ ...editingEntry, relatedEmployeeId: e.target.value || undefined })}
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
                <label className="text-xs text-gray-2 block mb-1">Опис</label>
                <textarea
                  rows={2}
                  disabled={isReadOnly}
                  value={editingEntry.description}
                  onChange={(e) => setEditingEntry({ ...editingEntry, description: e.target.value })}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent resize-none disabled:opacity-75"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-4 py-2 rounded-xl bg-bg-2 border border-border-default text-gray-2 hover:text-fg text-xs font-medium"
                >
                  {isReadOnly ? 'Закрити' : 'Скасувати'}
                </button>
                {!isReadOnly && (
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-semibold"
                  >
                    Зберегти зміни
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
