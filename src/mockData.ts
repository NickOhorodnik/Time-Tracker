import {
  Category, ActionType, Project, TimeEntry, Bonus, Phrase,
  MotivationalPhrase, AppSettings, Employee, EmployeeRating,
} from './types';

// No sample business records: real data must come from the configured source.
export const initialCategories: Category[] = [];
export const initialActionTypes: ActionType[] = [];
export const initialProjects: Project[] = [];
export const initialBonuses: Bonus[] = [];
export const initialPhrases: Phrase[] = [];
export const initialMotivationalPhrases: MotivationalPhrase[] = [];
export const initialTimeEntries: TimeEntry[] = [];
export const initialEmployees: Employee[] = [];
export const initialRatings: EmployeeRating[] = [];


// Neutral behavior defaults; these values are configuration, not tracked records.
export const initialSettings: AppSettings = {
  hourlyRate: 0,
  targetHours: 0,
  progressionMode: 'all_time',
  bubbleDurationMs: 5000,
  motivationRotationMinutes: 10,
  minutesPerPoint: 60,
  imageProgressionEnabled: true,
  stages: [
    { stage: 1, name: 'Етап 1', thresholdPercent: 0, primaryImage: '', alternateImage: '' },
    { stage: 2, name: 'Етап 2', thresholdPercent: 20, primaryImage: '', alternateImage: '' },
    { stage: 3, name: 'Етап 3', thresholdPercent: 40, primaryImage: '', alternateImage: '' },
    { stage: 4, name: 'Етап 4', thresholdPercent: 60, primaryImage: '', alternateImage: '' },
    { stage: 5, name: 'Етап 5', thresholdPercent: 80, primaryImage: '', alternateImage: '' },
  ],
};
