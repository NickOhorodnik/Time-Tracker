export type PeriodType = 'today' | 'week' | 'month' | 'all';

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

export interface ActionType {
  id: string;
  name: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  status: 'active' | 'completed' | 'paused';
  color: string;
}

export type EmployeeStatus = 'active' | 'archived';

export interface Employee {
  id: string;
  name: string;
  role?: string;
  status: EmployeeStatus;
  avatarUrl?: string;
  portraitUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

export type PerformanceScore = 1 | 2 | 3 | 4 | 5;
export type RatingSentiment = 'negative' | 'neutral' | 'positive';

export interface EmployeeRating {
  id: string;
  employeeId: string;
  score: PerformanceScore;
  emoji: string;
  sentiment: RatingSentiment;
  label: string;
  comment?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

export interface TimeSegment {
  id: string;
  startTime: string; // ISO string
  endTime?: string; // ISO string
  durationSeconds: number;
}

export interface TimeEntry {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  durationMinutes: number;
  categoryId: string;
  actionTypeId: string;
  projectId: string;
  employeeId?: string;
  relatedEmployeeId?: string;
  description: string;
  isManual: boolean;
  elapsedSeconds?: number;
  segments?: TimeSegment[];
}

export interface ActiveTimerState {
  isRunning: boolean;
  isPaused: boolean;
  startTime: string | null;
  elapsedSeconds: number;
  categoryId: string;
  actionTypeId: string;
  projectId: string;
  employeeId?: string;
  relatedEmployeeId?: string;
  description: string;
  segments: { startTime: string; endTime?: string; durationSeconds: number }[];
}

export interface Bonus {
  id: string;
  name: string;
  description: string;
  rewardType: 'money' | 'gift' | 'day_off' | 'custom';
  requiredPoints: number;
  isActive: boolean;
  imageUrl: string;
  claimed: boolean;
  fulfilled: boolean;
  claimedAt?: string;
}

export interface Phrase {
  id: string;
  text: string;
  isActive: boolean;
  order: number;
}

export interface MotivationalPhrase {
  id: string;
  template: string; // e.g. "Я витратив уже {hours} годин, а міг би присвятити їх автоматизації Allonsy."
  isActive: boolean;
  order: number;
}

export interface CharacterStage {
  stage: number;
  name: string;
  thresholdPercent: number; // e.g. 0, 20, 40, 60, 80
  primaryImage: string;
  alternateImage: string;
}

export interface AppSettings {
  hourlyRate: number; // USD default 30
  targetHours: number; // Default 100h
  progressionMode: 'monthly' | 'all_time';
  bubbleDurationMs: number; // default 5000
  motivationRotationMinutes: number; // default 10
  minutesPerPoint: number; // e.g. 60 mins = 1 point
  imageProgressionEnabled: boolean;
  stages: CharacterStage[];
  pointsEligibleCategoryIds?: string[];
  gasWebAppUrl?: string; // Per-user GAS Web App endpoint; kept in browser settings, never synced to Sheet
  googleSheetsWebhookUrl?: string;
  googleSpreadsheetInput?: string;
  googleSpreadsheetId?: string;
}

/* ============================================================================
 * Role-Based Points & Rewards System Types
 * ========================================================================== */

export type PointsRoleId = 'manager' | 'performer';

export type PointsEligibleTimeMode = 'all' | 'selected_categories' | 'eligible_only';

export type PointsReasonOperationType = 'manual_award' | 'manual_deduction' | 'neutral_self_report';

export type PointsOperationType =
  | 'monthly_allocation'
  | 'time_earning'
  | 'manual_award'
  | 'manual_deduction'
  | 'neutral_self_report'
  | 'reward_spend'
  | 'reward_refund'
  | 'expiry'
  | 'reversal'
  | 'period_correction';

export type PointsPeriodStatus = 'open' | 'closed';

export type BonusEligibilityTargetType = 'all' | 'role' | 'employee';

export type BonusClaimStatus = 'requested' | 'approved' | 'fulfilled' | 'cancelled';

export interface PointsRoleConfig {
  roleId: PointsRoleId;
  name: string;
  description: string;
  monthlyBasePoints: number;
  timeEarningEnabled: boolean;
  minutesPerPoint: number;
  eligibleTimeMode: PointsEligibleTimeMode;
  positiveGraceMonths: number;
  negativeCarryover: boolean;
  manualAwardsEnabled?: boolean;
  manualDeductionsEnabled?: boolean;
  active: boolean;
  updatedAtUtc: string;
}

export interface EmployeePointsProfile {
  employeeId: string;
  pointsRole: PointsRoleId;
  monthlyBaseOverride: number | null;
  timeEarningOverride: boolean | null;
  minutesPerPointOverride: number | null;
  pointsEnabled: boolean;
  updatedAtUtc: string;
}

export interface EffectiveEmployeePointsConfig {
  employeeId: string;
  pointsRole: PointsRoleId;
  roleName: string;
  monthlyBasePoints: number;
  timeEarningEnabled: boolean;
  minutesPerPoint: number;
  eligibleTimeMode: PointsEligibleTimeMode;
  positiveGraceMonths: number;
  negativeCarryover: boolean;
  manualAwardsEnabled: boolean;
  manualDeductionsEnabled: boolean;
  pointsEnabled: boolean;
}

export interface PointsReason {
  id: string;
  operationType: PointsReasonOperationType;
  name: string;
  defaultPoints: number;
  description: string;
  allowedRoles: PointsRoleId[];
  active: boolean;
  sortOrder: number;
  updatedAtUtc: string;
}

export interface PointsTransaction {
  id: string;
  employeeId: string;
  operationType: PointsOperationType;
  pointsDelta: number;
  reasonId: string;
  reasonSnapshot: string;
  comment: string;
  projectId?: string;
  segmentId?: string;
  relatedEmployeeId?: string;
  occurredAtUtc: string;
  createdAtUtc: string;
  actorEmployeeId?: string;
  commandId: string;
  reversalOfTransactionId?: string;
  monthKey: string;
  expiresAtUtc?: string;
}

export interface PointsPeriod {
  id: string;
  employeeId: string;
  monthKey: string;
  baseAllocation: number;
  debtCarriedIn: number;
  earnedPoints: number;
  deductedPoints: number;
  spentPoints: number;
  expiredPoints: number;
  status: PointsPeriodStatus;
  closedAtUtc?: string;
  commandId?: string;
}

export interface BonusEligibilityRule {
  id: string;
  bonusId: string;
  targetType: BonusEligibilityTargetType;
  targetId: string; // '*', 'manager' | 'performer', or employeeId
  priceOverride: number | null;
  active: boolean;
  requiresApproval: boolean;
  maxQuantity: number | null;
  updatedAtUtc: string;
}

export interface BonusClaim {
  id: string;
  bonusId: string;
  bonusNameSnapshot: string;
  employeeId: string;
  quantity: number;
  unitPricePoints: number;
  totalPointsCost: number;
  requestedAtUtc: string;
  status: BonusClaimStatus;
  fulfilledAtUtc?: string;
  comment?: string;
  commandId: string;
  updatedAtUtc: string;
  approvedByEmployeeId?: string;
  approvedAtUtc?: string;
  pointsTransactionId?: string;
  eligibilityId?: string;
}

export interface ResolvedBonusOffer {
  bonus: Bonus;
  isAvailable: boolean;
  unitPricePoints: number;
  hasPriceOverride: boolean;
  requiresApproval: boolean;
  maxQuantity: number | null;
  usedQuantity: number;
  remainingQuantity: number | null;
  matchedRule: BonusEligibilityRule | null;
  matchedBy: BonusEligibilityTargetType | 'legacy_fallback' | 'none';
}

export interface PointsLotSummary {
  transactionId: string;
  monthKey: string;
  remainingPoints: number;
  expiresAtUtc: string;
}

export interface DerivedEmployeePointsSummary {
  employeeId: string;
  effectiveConfig: EffectiveEmployeePointsConfig;
  currentMonthKey: string;
  availablePoints: number;
  netBalance: number;
  debtCarriedForward: number;
  monthlyBasePoints: number;
  monthlyAllocatedPoints: number;
  earnedPointsTotal: number;
  earnedPointsCurrentMonth: number;
  deductedPointsTotal: number;
  deductedPointsCurrentMonth: number;
  spentPointsTotal: number;
  spentPointsCurrentMonth: number;
  expiredPointsTotal: number;
  expiredPointsCurrentMonth: number;
  expiringSoonPoints: number;
  nextExpiryAtUtc: string | null;
  neutralReportCount: number;
  activeLots: PointsLotSummary[];
}

export interface PointsAuditSummary {
  schemaReady: boolean;
  missingSheets: string[];
  blockedSheets: string[];
}

export type SyncStatus = 'local_preview' | 'disconnected' | 'unverified' | 'connected' | 'error';

export interface ImageDiagnosticIssue {
  assetId: string;
  name?: string;
  slotKey?: string;
  stage?: number;
  rawRef?: string;
  reason: 'missing_url' | 'invalid_url' | 'inactive_asset' | 'missing_asset';
  message: string;
}

export interface ImageDiagnostics {
  totalAssets: number;
  activeAssets: number;
  usableUrlCount: number;
  invalidUrlAssets: ImageDiagnosticIssue[];
  unresolvedAssignments: ImageDiagnosticIssue[];
}

export interface SyncState {
  status: SyncStatus;
  runtimeMode: 'local_preview' | 'gas_hosted';
  isReadOnly?: boolean;
  readOnlySource?: 'gas' | 'public_sheet';
  lastSyncedAt: string | null;
  errorMessage: string | null;
  errorCode?: string | null;
  hasConfiguredUrl: boolean;
  hasConfiguredSpreadsheet?: boolean;
  spreadsheetName?: string | null;
  spreadsheetId?: string | null;
  imageDiagnostics?: ImageDiagnostics | null;
}

export type ImageLibraryGroup =
  | 'character_primary'
  | 'character_alternate'
  | 'team_avatars'
  | 'team_portraits'
  | 'bonuses';

export type LogicalImageFolder =
  | 'images/character/primary'
  | 'images/character/alternate'
  | 'images/team/avatars'
  | 'images/team/portraits'
  | 'images/bonuses';

export const FOLDER_BY_GROUP: Record<ImageLibraryGroup, LogicalImageFolder> = {
  character_primary: 'images/character/primary',
  character_alternate: 'images/character/alternate',
  team_avatars: 'images/team/avatars',
  team_portraits: 'images/team/portraits',
  bonuses: 'images/bonuses',
};

export const GROUP_BY_FOLDER: Record<LogicalImageFolder, ImageLibraryGroup> = {
  'images/character/primary': 'character_primary',
  'images/character/alternate': 'character_alternate',
  'images/team/avatars': 'team_avatars',
  'images/team/portraits': 'team_portraits',
  'images/bonuses': 'bonuses',
};

export type ImageAssetSource = 'builtin' | 'local_upload' | 'shared_reference' | 'external_url';
export type ImageAssetStorageType = 'bundled' | 'browser_local' | 'external_url';
export type ImagePersistenceStatus = 'draft' | 'saved_to_sheets' | 'blocked' | 'bundled' | 'local_only';

export interface ImageAsset {
  id: string; // Stable asset ID
  name: string; // Display name
  group: ImageLibraryGroup;
  folder?: LogicalImageFolder;
  url: string; // Direct HTTPS URL, bundled path /assets/..., or legacy data: URL
  imageUrl?: string; // Explicit HTTPS URL property for external_url assets
  source: ImageAssetSource;
  storageType?: ImageAssetStorageType;
  storageMode?: 'bundled' | 'browser_local';
  stageKey?: string;
  bonusId?: string;
  employeeId?: string;
  sharedFromAssetId?: string;
  isShared?: boolean;
  uploadedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  persistenceStatus?: ImagePersistenceStatus;
  statusMessage?: string;
}

export interface ImageAssignment {
  id: string; // e.g. "assign-character-primary-1"
  slotKey: string; // e.g. "images/character/primary/1", "images/character/alternate/1", "images/bonuses/bonus-1", "images/team/avatars/emp-nastya", "images/team/portraits/emp-nastya"
  assetId: string; // references ImageAsset.id
  assignedAt: string; // ISO timestamp
  slotLabel?: string;
}

