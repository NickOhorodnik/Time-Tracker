import {
  Category,
  Employee,
  EmployeeRating,
  PerformanceScore,
  PeriodType,
  RatingSentiment,
  TimeEntry,
} from '../types';

export const DEFAULT_EMPLOYEE_ID = 'emp-nastya';

export interface RatingScaleOption {
  score: PerformanceScore;
  emoji: string;
  sentiment: RatingSentiment;
  label: string;
  description: string;
}

export const RATING_SCALE: RatingScaleOption[] = [
  {
    score: 1,
    emoji: '😞',
    sentiment: 'negative',
    label: 'Негативно',
    description: 'Критичні зауваження щодо виконання',
  },
  {
    score: 2,
    emoji: '😕',
    sentiment: 'negative',
    label: 'Негативно',
    description: 'Результат потребує доопрацювання',
  },
  {
    score: 3,
    emoji: '😐',
    sentiment: 'neutral',
    label: 'Нейтрально',
    description: 'Стабільна робота в межах очікувань',
  },
  {
    score: 4,
    emoji: '🙂',
    sentiment: 'positive',
    label: 'Позитивно',
    description: 'Якісне та своєчасне виконання',
  },
  {
    score: 5,
    emoji: '🤩',
    sentiment: 'positive',
    label: 'Позитивно',
    description: 'Відмінний результат і висока ініціативність',
  },
];

export function getRatingMeta(score: number): RatingScaleOption | null {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return null;
  }
  return RATING_SCALE.find((item) => item.score === score) || null;
}

export function validateRatingInput(input: {
  employeeId?: string;
  score: unknown;
  date?: string;
  time?: string;
}): { valid: boolean; error?: string; meta?: RatingScaleOption } {
  if (!input.employeeId || !input.employeeId.trim()) {
    return { valid: false, error: 'Оберіть співробітника для оцінки.' };
  }

  const numericScore = typeof input.score === 'number' ? input.score : Number(input.score);
  const meta = getRatingMeta(numericScore);
  if (!meta) {
    return { valid: false, error: 'Оцінка має бути цілим числом у діапазоні від 1 до 5.' };
  }

  if (input.date !== undefined) {
    const trimmedDate = input.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      return { valid: false, error: 'Вкажіть коректну дату оцінки у форматі РРРР-ММ-ДД.' };
    }
  }

  if (input.time !== undefined && input.time.trim() !== '') {
    if (!/^\d{2}:\d{2}$/.test(input.time.trim())) {
      return { valid: false, error: 'Вкажіть коректний час оцінки у форматі ГГ:ХХ.' };
    }
  }

  return { valid: true, meta };
}

export function validateEmployeeInput(
  input: { id?: string; name: string },
  existingEmployees: Employee[],
  editingId?: string
): { valid: boolean; error?: string } {
  const cleanName = input.name.trim();
  if (!cleanName) {
    return { valid: false, error: "Вкажіть ім'я співробітника." };
  }

  if (cleanName.length > 80) {
    return { valid: false, error: "Ім'я співробітника не повинно перевищувати 80 символів." };
  }

  const normalizedName = cleanName.toLowerCase();
  const duplicateName = existingEmployees.find(
    (emp) => emp.id !== editingId && emp.name.trim().toLowerCase() === normalizedName
  );
  if (duplicateName) {
    return { valid: false, error: `Співробітник з іменем «${cleanName}» уже існує.` };
  }

  if (input.id && !editingId) {
    const cleanId = input.id.trim();
    if (!cleanId) {
      return { valid: false, error: 'Некоректний ідентифікатор співробітника.' };
    }
    const duplicateId = existingEmployees.some((emp) => emp.id === cleanId);
    if (duplicateId) {
      return { valid: false, error: 'Співробітник із таким ID уже існує.' };
    }
  }

  return { valid: true };
}

export function generateEmployeeId(name: string, existingEmployees: Employee[]): string {
  const transliterated = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
  const prefix = transliterated ? `emp-${transliterated}` : 'emp-member';
  let candidate = `${prefix}-${Date.now().toString(36).slice(-4)}`;
  while (existingEmployees.some((e) => e.id === candidate)) {
    candidate = `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return candidate;
}

export function getDefaultEmployeeId(employees: Employee[]): string {
  const nastya = employees.find((e) => e.id === DEFAULT_EMPLOYEE_ID);
  if (nastya) return nastya.id;
  const byName = employees.find((e) => e.name.trim().toLowerCase() === 'настя');
  if (byName) return byName.id;
  const firstActive = employees.find((e) => e.status === 'active');
  if (firstActive) return firstActive.id;
  return employees[0]?.id || DEFAULT_EMPLOYEE_ID;
}

export function migrateTimeEntriesEmployeeId(
  entries: TimeEntry[],
  defaultEmployeeId: string
): { entries: TimeEntry[]; changed: boolean } {
  let changed = false;
  const fallbackId = defaultEmployeeId || DEFAULT_EMPLOYEE_ID;

  const nextEntries = entries.map((entry) => {
    if (entry.employeeId && entry.employeeId.trim() !== '') {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      employeeId: fallbackId,
    };
  });

  return { entries: nextEntries, changed };
}

export function filterEntriesByEmployee(
  entries: TimeEntry[],
  employeeFilterId: string,
  fallbackEmployeeId: string = DEFAULT_EMPLOYEE_ID
): TimeEntry[] {
  if (!employeeFilterId || employeeFilterId === 'all') {
    return entries;
  }
  return entries.filter((entry) => (entry.employeeId || fallbackEmployeeId) === employeeFilterId);
}

export function getEmployeeRatingsSorted(
  ratings: EmployeeRating[],
  employeeId: string
): EmployeeRating[] {
  return ratings
    .filter((r) => r.employeeId === employeeId)
    .sort((a, b) => {
      const keyA = `${a.date || ''}T${a.time || '00:00'}|${a.createdAt || ''}`;
      const keyB = `${b.date || ''}T${b.time || '00:00'}|${b.createdAt || ''}`;
      return keyB.localeCompare(keyA);
    });
}

function isSameDay(dateStr: string, todayStr: string): boolean {
  return dateStr === todayStr;
}

function isInCurrentWeek(dateStr: string, now: Date): boolean {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  startOfWeek.setDate(startOfWeek.getDate() - diffToMonday);
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

function isInCurrentMonth(dateStr: string, now: Date): boolean {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export interface EmployeeCategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  color: string;
  minutes: number;
  hours: number;
  percent: number;
  sessions: number;
}

export interface EmployeeMetrics {
  minutesToday: number;
  minutesWeek: number;
  minutesMonth: number;
  minutesAll: number;
  periodMinutes: number;
  periodSessions: TimeEntry[];
  sessionCountAll: number;
  categoryBreakdown: EmployeeCategoryBreakdownItem[];
  latestRating: EmployeeRating | null;
  ratingCount: number;
  averageScore: number | null;
}

export function computeEmployeeMetrics(
  employeeId: string,
  entries: TimeEntry[],
  categories: Category[],
  ratings: EmployeeRating[],
  period: PeriodType = 'all',
  fallbackEmployeeId: string = DEFAULT_EMPLOYEE_ID
): EmployeeMetrics {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const empEntries = entries.filter(
    (entry) => (entry.employeeId || fallbackEmployeeId) === employeeId
  );

  const minutesToday = empEntries
    .filter((e) => isSameDay(e.date, todayStr))
    .reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0);

  const minutesWeek = empEntries
    .filter((e) => isInCurrentWeek(e.date, now))
    .reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0);

  const minutesMonth = empEntries
    .filter((e) => isInCurrentMonth(e.date, now))
    .reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0);

  const minutesAll = empEntries.reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0);

  const periodSessions = empEntries.filter((e) => {
    if (period === 'today') return isSameDay(e.date, todayStr);
    if (period === 'week') return isInCurrentWeek(e.date, now);
    if (period === 'month') return isInCurrentMonth(e.date, now);
    return true;
  });

  const periodMinutes = periodSessions.reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0);

  const categoryBreakdown: EmployeeCategoryBreakdownItem[] = categories
    .map((cat) => {
      const catSessions = periodSessions.filter((e) => e.categoryId === cat.id);
      const mins = catSessions.reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0);
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        color: cat.color || '#f97316',
        minutes: mins,
        hours: mins / 60,
        percent: periodMinutes > 0 ? Math.round((mins / periodMinutes) * 100) : 0,
        sessions: catSessions.length,
      };
    })
    .filter((item) => item.minutes > 0 || periodSessions.length === 0)
    .sort((a, b) => b.minutes - a.minutes);

  const sortedRatings = getEmployeeRatingsSorted(ratings, employeeId);
  const latestRating = sortedRatings[0] || null;
  const averageScore =
    sortedRatings.length > 0
      ? Number(
          (
            sortedRatings.reduce((sum, r) => sum + r.score, 0) / sortedRatings.length
          ).toFixed(1)
        )
      : null;

  return {
    minutesToday,
    minutesWeek,
    minutesMonth,
    minutesAll,
    periodMinutes,
    periodSessions: [...periodSessions].sort((a, b) => {
      const keyA = `${a.date}T${a.startTime || '00:00'}`;
      const keyB = `${b.date}T${b.startTime || '00:00'}`;
      return keyB.localeCompare(keyA);
    }),
    sessionCountAll: empEntries.length,
    categoryBreakdown,
    latestRating,
    ratingCount: sortedRatings.length,
    averageScore,
  };
}

export function getEmployeeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
