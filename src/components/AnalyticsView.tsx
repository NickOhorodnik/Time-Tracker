import React, { useEffect, useMemo, useState } from 'react';
import { TimeEntry, Category, ActionType, Project, AppSettings, Employee } from '../types';
import { BarChart3, TrendingUp, PieChart } from 'lucide-react';
import { filterEntriesByEmployee, getDefaultEmployeeId } from '../utils/teamUtils';

interface AnalyticsViewProps {
  entries: TimeEntry[];
  categories: Category[];
  actionTypes: ActionType[];
  projects: Project[];
  employees: Employee[];
  settings: AppSettings;
  selectedEmployeeFilter?: string;
  onSelectEmployeeFilter?: (employeeId: string) => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  entries,
  categories,
  projects,
  employees,
  settings,
  selectedEmployeeFilter = 'all',
  onSelectEmployeeFilter,
}) => {
  const [selectedEmployee, setSelectedEmployee] = useState(selectedEmployeeFilter);

  useEffect(() => {
    setSelectedEmployee(selectedEmployeeFilter);
  }, [selectedEmployeeFilter]);

  const defaultEmpId = useMemo(() => getDefaultEmployeeId(employees), [employees]);

  const handleEmployeeChange = (val: string) => {
    setSelectedEmployee(val);
    onSelectEmployeeFilter?.(val);
  };

  const filteredEntries = useMemo(
    () => filterEntriesByEmployee(entries, selectedEmployee, defaultEmpId),
    [entries, selectedEmployee, defaultEmpId]
  );

  const totalMins = filteredEntries.reduce((acc, e) => acc + e.durationMinutes, 0);
  const totalHours = totalMins / 60;
  const totalCost = Math.round(totalHours * settings.hourlyRate);

  const manualMins = filteredEntries.filter((e) => e.isManual).reduce((acc, e) => acc + e.durationMinutes, 0);
  const timerMins = totalMins - manualMins;

  // Category breakdown
  const categoryBreakdown = categories.map((cat) => {
    const mins = filteredEntries.filter((e) => e.categoryId === cat.id).reduce((acc, e) => acc + e.durationMinutes, 0);
    return {
      ...cat,
      hours: mins / 60,
      percent: totalMins > 0 ? Math.round((mins / totalMins) * 100) : 0,
    };
  });

  // Project breakdown
  const projectBreakdown = projects.map((proj) => {
    const mins = filteredEntries.filter((e) => e.projectId === proj.id).reduce((acc, e) => acc + e.durationMinutes, 0);
    return {
      ...proj,
      hours: mins / 60,
      percent: totalMins > 0 ? Math.round((mins / totalMins) * 100) : 0,
    };
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Детальна аналітика та звіти Allonsy</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            Аналізуйте продуктивність, розподіл часу за проєктами, категоріями та співробітниками.
          </p>
        </div>

        <div className="w-full md:w-auto shrink-0">
          <select
            aria-label="Фільтр аналітики за співробітником"
            value={selectedEmployee}
            onChange={(e) => handleEmployeeChange(e.target.value)}
            className="w-full md:w-auto bg-bg-1 border border-border-default rounded-xl px-4 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Усі співробітники</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}{emp.status === 'archived' ? ' (архів)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Top Analytics KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <div className="bg-bg-1 border border-border-default p-4 sm:p-5 rounded-3xl space-y-2">
          <div className="text-xs text-gray-2 font-medium">Загальний час</div>
          <div className="text-2xl font-extrabold text-fg tabular-nums">{totalHours.toFixed(1)} <span className="text-xs font-normal text-gray-2">год</span></div>
          <div className="text-[11px] text-gray-1 tabular-nums">{filteredEntries.length} зареєстрованих сесій</div>
        </div>

        <div className="bg-bg-1 border border-border-default p-4 sm:p-5 rounded-3xl space-y-2">
          <div className="text-xs text-gray-2 font-medium">Потенційна вартість часу</div>
          <div className="text-2xl font-extrabold text-accent tabular-nums">${totalCost.toLocaleString()}</div>
          <div className="text-[11px] text-gray-1 tabular-nums">За ставкою ${settings.hourlyRate}/год</div>
        </div>

        <div className="bg-bg-1 border border-border-default p-4 sm:p-5 rounded-3xl space-y-2">
          <div className="text-xs text-gray-2 font-medium">Через таймер</div>
          <div className="text-2xl font-extrabold text-emerald-400 tabular-nums">{(timerMins / 60).toFixed(1)} <span className="text-xs font-normal text-gray-2">год</span></div>
          <div className="text-[11px] text-gray-1 tabular-nums">{totalMins > 0 ? Math.round((timerMins / totalMins) * 100) : 0}% від загального</div>
        </div>

        <div className="bg-bg-1 border border-border-default p-4 sm:p-5 rounded-3xl space-y-2">
          <div className="text-xs text-gray-2 font-medium">Внесено вручну</div>
          <div className="text-2xl font-extrabold text-amber-400 tabular-nums">{(manualMins / 60).toFixed(1)} <span className="text-xs font-normal text-gray-2">год</span></div>
          <div className="text-[11px] text-gray-1 tabular-nums">{totalMins > 0 ? Math.round((manualMins / totalMins) * 100) : 0}% від загального</div>
        </div>
      </div>

      {/* Breakdowns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="bg-bg-1 border border-border-default p-4 sm:p-6 rounded-3xl space-y-5">
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
            <PieChart className="w-4 h-4 text-accent shrink-0" />
            <span>Розподіл за категоріями</span>
          </h3>

          <div className="space-y-4">
            {categoryBreakdown.map((cat) => (
              <div key={cat.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span className="text-gray-2 flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="truncate">{cat.name}</span>
                  </span>
                  <span className="text-fg font-bold shrink-0 tabular-nums">{cat.hours.toFixed(1)} год ({cat.percent}%)</span>
                </div>
                <div className="w-full bg-bg-2 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Project Breakdown */}
        <div className="bg-bg-1 border border-border-default p-4 sm:p-6 rounded-3xl space-y-5">
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent shrink-0" />
            <span>Розподіл за проєктами</span>
          </h3>

          <div className="space-y-4">
            {projectBreakdown.map((proj) => (
              <div key={proj.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span className="text-gray-2 flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: proj.color }} />
                    <span className="truncate">
                      {proj.name} <span className="text-gray-1">({proj.client})</span>
                    </span>
                  </span>
                  <span className="text-fg font-bold shrink-0 tabular-nums">{proj.hours.toFixed(1)} год ({proj.percent}%)</span>
                </div>
                <div className="w-full bg-bg-2 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${proj.percent}%`, backgroundColor: proj.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
