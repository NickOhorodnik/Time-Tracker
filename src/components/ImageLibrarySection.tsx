import React, { useEffect, useMemo, useState } from 'react';
import {
  AppSettings,
  Bonus,
  Employee,
  FOLDER_BY_GROUP,
  GROUP_BY_FOLDER,
  ImageAsset,
  ImageAssignment,
  LogicalImageFolder,
  SyncState,
} from '../types';
import { api } from '../services/api';
import { resolveAssetUrl } from '../utils/assetResolver';
import { validateImageUrl, UrlValidationResult } from '../utils/imageUrlValidator';
import { parseStageSlotKey } from '../utils/canonicalSheetsAdapter';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

interface ImageLibrarySectionProps {
  settings: AppSettings;
  bonuses: Bonus[];
  employees: Employee[];
  syncState?: SyncState;
  onSaveSettings: (newSettings: AppSettings) => void;
  onUpdateBonusImage: (bonusId: string, imageUrl: string) => void;
  onUpdateEmployeeImage: (employeeId: string, slot: 'avatar' | 'portrait', imageUrl: string) => void;
}

type GroupFilter = 'all' | LogicalImageFolder;
type SourceFilter = 'all' | 'external_url' | 'builtin' | 'local_upload' | 'shared_reference';

const FOLDER_LABELS: Record<LogicalImageFolder, string> = {
  'images/character/primary': 'images/character/primary (Персонаж • Основні)',
  'images/character/alternate': 'images/character/alternate (Персонаж • Альтернативні)',
  'images/team/avatars': 'images/team/avatars (Команда • Аватари)',
  'images/team/portraits': 'images/team/portraits (Команда • Портрети)',
  'images/bonuses': 'images/bonuses (Бонуси)',
};

interface DestinationSlot {
  slotKey: string;
  label: string;
  category: string;
}

export const ImageLibrarySection: React.FC<ImageLibrarySectionProps> = ({
  settings,
  bonuses,
  employees,
  syncState,
  onSaveSettings,
  onUpdateBonusImage,
  onUpdateEmployeeImage,
}) => {
  const [customAssets, setCustomAssets] = useState<ImageAsset[]>(() => api.getImageRegistry());
  const [assignments, setAssignments] = useState<ImageAssignment[]>(() => api.getImageAssignments());

  useEffect(() => {
    setCustomAssets(api.getImageRegistry());
    setAssignments(api.getImageAssignments());
  }, [settings, bonuses, employees, syncState?.lastSyncedAt, syncState?.status]);

  const [activeFolderFilter, setActiveFolderFilter] = useState<GroupFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'info' | 'warning' | 'error'; text: string } | null>(null);
  const [fallbackImages, setFallbackImages] = useState<Record<string, boolean>>({});

  // Add/Edit URL Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [formUrl, setFormUrl] = useState('');
  const [formName, setFormName] = useState('');
  const [formFolder, setFormFolder] = useState<LogicalImageFolder>('images/character/primary');
  const [formSelectedSlots, setFormSelectedSlots] = useState<string[]>([]);
  const [formValidation, setFormValidation] = useState<UrlValidationResult>({ valid: false, normalizedUrl: '', isDriveSharingUrl: false });
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [previewDimensions, setPreviewDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isSavingUrl, setIsSavingUrl] = useState(false);

  const isGasHosted = syncState?.runtimeMode === 'gas_hosted';

  const showFeedback = (type: 'success' | 'info' | 'warning' | 'error', text: string) => {
    setFeedbackMessage({ type, text });
  };

  // Compile full list of destination slots available for assignment
  const allDestinationSlots = useMemo<DestinationSlot[]>(() => {
    const list: DestinationSlot[] = [];

    // Character Primary Stages 1..5
    settings.stages.forEach((s) => {
      list.push({
        slotKey: `images/character/primary/${s.stage}`,
        label: `Основний етап ${s.stage} (${s.thresholdPercent}%)`,
        category: 'Персонаж • Основні етапи',
      });
    });

    // Character Alternate Stages 1..5
    settings.stages.forEach((s) => {
      list.push({
        slotKey: `images/character/alternate/${s.stage}`,
        label: `Альтернативний етап ${s.stage} (${s.thresholdPercent}%)`,
        category: 'Персонаж • Альтернативні етапи',
      });
    });

    // Bonuses
    bonuses.forEach((b) => {
      list.push({
        slotKey: `images/bonuses/${b.id}`,
        label: `Бонус: ${b.name}`,
        category: 'Бонуси',
      });
    });

    // Employees
    employees.forEach((emp) => {
      list.push({
        slotKey: `images/team/avatars/${emp.id}`,
        label: `Аватар: ${emp.name}`,
        category: 'Команда • Аватари',
      });
      list.push({
        slotKey: `images/team/portraits/${emp.id}`,
        label: `Портрет: ${emp.name}`,
        category: 'Команда • Портрети',
      });
    });

    return list;
  }, [settings.stages, bonuses, employees]);

  // Build unified library list combining stage assets, bonuses, employees, and URL registry
  const allAssets = useMemo<ImageAsset[]>(() => {
    const derived: ImageAsset[] = [];

    // 1. Character Primary Stages (preserving all 5 stages & stable keys)
    settings.stages.forEach((stage) => {
      const stageKey = `stage-${stage.stage}`;
      const url = resolveAssetUrl(stage.primaryImage);
      const isExternalUrl = url.startsWith('https://') || url.startsWith('http://');
      const isDataUrl = url.startsWith('data:');

      derived.push({
        id: `asset-char-primary-${stageKey}`,
        name: stage.name || `Етап ${stage.stage}`,
        group: 'character_primary',
        folder: 'images/character/primary',
        url: url,
        imageUrl: isExternalUrl ? url : undefined,
        source: isExternalUrl ? 'external_url' : isDataUrl ? 'local_upload' : 'builtin',
        storageType: isExternalUrl ? 'external_url' : isDataUrl ? 'browser_local' : 'bundled',
        stageKey,
        storageMode: isDataUrl ? 'browser_local' : 'bundled',
        persistenceStatus: isExternalUrl ? (isGasHosted ? 'saved_to_sheets' : 'draft') : isDataUrl ? 'local_only' : 'bundled',
      });
    });

    // 2. Character Alternate Stages (tracking shared vs replaced state)
    settings.stages.forEach((stage) => {
      const stageKey = `stage-${stage.stage}`;
      const primaryUrl = resolveAssetUrl(stage.primaryImage);
      const alternateUrl = resolveAssetUrl(stage.alternateImage);
      const isShared = Boolean(primaryUrl && alternateUrl === primaryUrl);
      const url = alternateUrl;
      const isExternalUrl = !isShared && (url.startsWith('https://') || url.startsWith('http://'));
      const isDataUrl = !isShared && url.startsWith('data:');

      derived.push({
        id: `asset-char-alternate-${stageKey}`,
        name: `${stage.name || `Етап ${stage.stage}`} (альтернативний)`,
        group: 'character_alternate',
        folder: 'images/character/alternate',
        url: url,
        imageUrl: isExternalUrl ? url : undefined,
        source: isShared ? 'shared_reference' : isExternalUrl ? 'external_url' : isDataUrl ? 'local_upload' : 'builtin',
        storageType: isShared ? 'bundled' : isExternalUrl ? 'external_url' : isDataUrl ? 'browser_local' : 'bundled',
        stageKey,
        sharedFromAssetId: isShared ? `asset-char-primary-${stageKey}` : undefined,
        isShared,
        storageMode: isDataUrl ? 'browser_local' : 'bundled',
        persistenceStatus: isShared ? 'bundled' : isExternalUrl ? (isGasHosted ? 'saved_to_sheets' : 'draft') : isDataUrl ? 'local_only' : 'bundled',
      });
    });

    // 3. Bonuses
    bonuses.forEach((bonus) => {
      const url = bonus.imageUrl ? resolveAssetUrl(bonus.imageUrl) : '';
      const isExternalUrl = url.startsWith('https://') || url.startsWith('http://');
      const isDataUrl = url.startsWith('data:');

      derived.push({
        id: `asset-bonus-${bonus.id}`,
        name: bonus.name,
        group: 'bonuses',
        folder: 'images/bonuses',
        url: url,
        imageUrl: isExternalUrl ? url : undefined,
        source: isExternalUrl ? 'external_url' : isDataUrl ? 'local_upload' : 'builtin',
        storageType: isExternalUrl ? 'external_url' : isDataUrl ? 'browser_local' : 'bundled',
        bonusId: bonus.id,
        storageMode: isDataUrl ? 'browser_local' : 'bundled',
        persistenceStatus: isExternalUrl ? (isGasHosted ? 'saved_to_sheets' : 'draft') : isDataUrl ? 'local_only' : 'bundled',
      });
    });

    // 4. Employees (Avatars & Portraits)
    employees.forEach((emp) => {
      if (emp.avatarUrl && emp.avatarUrl !== '[локальне зображення]') {
        const url = emp.avatarUrl;
        const isExternalUrl = url.startsWith('https://');
        const isDataUrl = url.startsWith('data:');
        derived.push({
          id: `asset-team-avatar-${emp.id}`,
          name: `${emp.name} (аватар)`,
          group: 'team_avatars',
          folder: 'images/team/avatars',
          url: url,
          imageUrl: isExternalUrl ? url : undefined,
          source: isExternalUrl ? 'external_url' : isDataUrl ? 'local_upload' : 'builtin',
          storageType: isExternalUrl ? 'external_url' : isDataUrl ? 'browser_local' : 'bundled',
          employeeId: emp.id,
          storageMode: isDataUrl ? 'browser_local' : 'bundled',
          persistenceStatus: isExternalUrl ? (isGasHosted ? 'saved_to_sheets' : 'draft') : isDataUrl ? 'local_only' : 'bundled',
        });
      }

      if (emp.portraitUrl && emp.portraitUrl !== '[локальне зображення]') {
        const url = emp.portraitUrl;
        const isExternalUrl = url.startsWith('https://');
        const isDataUrl = url.startsWith('data:');
        derived.push({
          id: `asset-team-portrait-${emp.id}`,
          name: `${emp.name} (портрет)`,
          group: 'team_portraits',
          folder: 'images/team/portraits',
          url: url,
          imageUrl: isExternalUrl ? url : undefined,
          source: isExternalUrl ? 'external_url' : isDataUrl ? 'local_upload' : 'builtin',
          storageType: isExternalUrl ? 'external_url' : isDataUrl ? 'browser_local' : 'bundled',
          employeeId: emp.id,
          storageMode: isDataUrl ? 'browser_local' : 'bundled',
          persistenceStatus: isExternalUrl ? (isGasHosted ? 'saved_to_sheets' : 'draft') : isDataUrl ? 'local_only' : 'bundled',
        });
      }
    });

    // 5. Standalone URL registry & custom assets (deduplicated by ID)
    const existingIds = new Set(derived.map((d) => d.id));
    customAssets.forEach((asset) => {
      if (!existingIds.has(asset.id)) {
        const isExternal = asset.storageType === 'external_url' || asset.url.startsWith('https://') || asset.url.startsWith('http://');
        const folder = asset.folder || FOLDER_BY_GROUP[asset.group] || 'images/character/primary';
        const preservedStatus =
          asset.persistenceStatus === 'saved_to_sheets'
            ? 'saved_to_sheets'
            : isExternal
            ? (asset.persistenceStatus || (isGasHosted ? 'saved_to_sheets' : 'draft'))
            : 'local_only';
        derived.push({
          ...asset,
          folder,
          imageUrl: isExternal ? (asset.imageUrl || asset.url) : undefined,
          storageType: isExternal ? 'external_url' : asset.storageType || 'browser_local',
          source: isExternal ? 'external_url' : asset.source || 'local_upload',
          persistenceStatus: preservedStatus,
        });
      }
    });

    return derived;
  }, [settings.stages, bonuses, employees, customAssets, isGasHosted]);

  // Folder counts
  const folderCounts = useMemo(() => {
    const counts: Record<GroupFilter, number> = {
      all: allAssets.length,
      'images/character/primary': 0,
      'images/character/alternate': 0,
      'images/team/avatars': 0,
      'images/team/portraits': 0,
      'images/bonuses': 0,
    };
    allAssets.forEach((a) => {
      const f = a.folder || FOLDER_BY_GROUP[a.group];
      if (f && counts[f] !== undefined) {
        counts[f] = (counts[f] || 0) + 1;
      }
    });
    return counts;
  }, [allAssets]);

  // Filtered assets
  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allAssets.filter((asset) => {
      const assetFolder = asset.folder || FOLDER_BY_GROUP[asset.group];
      if (activeFolderFilter !== 'all' && assetFolder !== activeFolderFilter) return false;
      if (sourceFilter !== 'all') {
        if (sourceFilter === 'external_url' && asset.source !== 'external_url') return false;
        if (sourceFilter === 'builtin' && asset.source !== 'builtin') return false;
        if (sourceFilter === 'local_upload' && asset.source !== 'local_upload') return false;
        if (sourceFilter === 'shared_reference' && asset.source !== 'shared_reference') return false;
      }
      if (!q) return true;
      const folderLabel = assetFolder ? FOLDER_LABELS[assetFolder].toLowerCase() : '';
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.id.toLowerCase().includes(q) ||
        asset.url.toLowerCase().includes(q) ||
        folderLabel.includes(q) ||
        (asset.stageKey && asset.stageKey.toLowerCase().includes(q))
      );
    });
  }, [allAssets, activeFolderFilter, sourceFilter, searchQuery]);

  // Helper to get currently assigned slots for a given asset ID or URL
  const getAssignedSlotsForAsset = (asset: ImageAsset): string[] => {
    const slots: string[] = [];

    // Check direct match in settings.stages
    settings.stages.forEach((s) => {
      if (s.primaryImage === asset.url) {
        slots.push(`Основний етап ${s.stage}`);
      }
      if (s.alternateImage === asset.url) {
        slots.push(
          s.alternateImage === s.primaryImage
            ? `Альтернативний етап ${s.stage} (спільний)`
            : `Альтернативний етап ${s.stage}`
        );
      }
    });

    // Check bonuses
    bonuses.forEach((b) => {
      if (b.imageUrl === asset.url) {
        slots.push(`Бонус: ${b.name}`);
      }
    });

    // Check employees
    employees.forEach((emp) => {
      if (emp.avatarUrl === asset.url) {
        slots.push(`Аватар: ${emp.name}`);
      }
      if (emp.portraitUrl === asset.url) {
        slots.push(`Портрет: ${emp.name}`);
      }
    });

    // Check assignments table (supporting both logical paths and canonical stage_01..stage_05 + primary/alternate slots)
    assignments.forEach((assign) => {
      if (assign.assetId === asset.id) {
        const extAssign = assign as ImageAssignment & { targetType?: string; targetId?: string };
        const parsedStage = parseStageSlotKey(assign.slotKey, extAssign.targetType, extAssign.targetId);
        const normalizedSlotKey = parsedStage
          ? `images/character/${parsedStage.kind}/${parsedStage.stage}`
          : assign.slotKey;
        const slotMatch = allDestinationSlots.find(
          (d) => d.slotKey === assign.slotKey || d.slotKey === normalizedSlotKey
        );
        if (slotMatch && !slots.includes(slotMatch.label)) {
          slots.push(slotMatch.label);
        }
      }
    });

    return Array.from(new Set(slots));
  };

  // Open modal to add a new URL asset
  const handleOpenAddModal = (presetSlotKey?: string) => {
    setEditingAssetId(null);
    setFormUrl('');
    setFormName('');
    setFormFolder('images/character/primary');
    setFormSelectedSlots(presetSlotKey ? [presetSlotKey] : []);
    setFormValidation({ valid: false, normalizedUrl: '', isDriveSharingUrl: false });
    setPreviewState('idle');
    setPreviewDimensions(null);
    setIsModalOpen(true);
  };

  // Open modal to edit an existing URL asset
  const handleOpenEditModal = (asset: ImageAsset) => {
    setEditingAssetId(asset.id);
    setFormUrl(asset.url);
    setFormName(asset.name);
    setFormFolder(asset.folder || FOLDER_BY_GROUP[asset.group] || 'images/character/primary');
    setFormSelectedSlots([]);
    const validation = validateImageUrl(asset.url);
    setFormValidation(validation);
    setPreviewState('loading');
    setPreviewDimensions(null);
    setIsModalOpen(true);
  };

  // Live URL input change handler
  const handleUrlInputChange = (value: string) => {
    setFormUrl(value);
    const validation = validateImageUrl(value);
    setFormValidation(validation);
    if (validation.valid) {
      setPreviewState('loading');
      setPreviewDimensions(null);
    } else {
      setPreviewState('idle');
      setPreviewDimensions(null);
    }
  };

  // Apply assignment of an asset to a single destination slot
  const applyAssignmentToSlot = (asset: ImageAsset, slotKey: string) => {
    const nowIso = new Date().toISOString();

    if (slotKey.startsWith('images/character/primary/')) {
      const stageNum = Number(slotKey.replace('images/character/primary/', ''));
      const updatedStages = settings.stages.map((s) => {
        if (s.stage !== stageNum) return s;
        const wasShared = s.alternateImage === s.primaryImage;
        return {
          ...s,
          primaryImage: asset.url,
          alternateImage: wasShared ? asset.url : s.alternateImage,
        };
      });
      onSaveSettings({ ...settings, stages: updatedStages });
    } else if (slotKey.startsWith('images/character/alternate/')) {
      const stageNum = Number(slotKey.replace('images/character/alternate/', ''));
      const updatedStages = settings.stages.map((s) =>
        s.stage === stageNum ? { ...s, alternateImage: asset.url } : s
      );
      onSaveSettings({ ...settings, stages: updatedStages });
    } else if (slotKey.startsWith('images/bonuses/')) {
      const bonusId = slotKey.replace('images/bonuses/', '');
      onUpdateBonusImage(bonusId, asset.url);
    } else if (slotKey.startsWith('images/team/avatars/')) {
      const empId = slotKey.replace('images/team/avatars/', '');
      onUpdateEmployeeImage(empId, 'avatar', asset.url);
    } else if (slotKey.startsWith('images/team/portraits/')) {
      const empId = slotKey.replace('images/team/portraits/', '');
      onUpdateEmployeeImage(empId, 'portrait', asset.url);
    }

    // Update assignment record by slotKey
    const cleanAssignmentId = `assign-${slotKey.replace(/\//g, '-')}`;
    const nextAssignments = [
      ...assignments.filter((a) => a.slotKey !== slotKey),
      {
        id: cleanAssignmentId,
        slotKey,
        assetId: asset.id,
        assignedAt: nowIso,
      },
    ];
    setAssignments(nextAssignments);
    api.saveImageAssignments(nextAssignments);
  };

  // Save new or edited URL asset
  const handleSaveUrlAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateImageUrl(formUrl);
    if (!validation.valid) {
      showFeedback('error', validation.error || 'Вкажіть коректне HTTPS-посилання.');
      return;
    }

    setIsSavingUrl(true);
    const nowIso = new Date().toISOString();
    const group = GROUP_BY_FOLDER[formFolder] || 'character_primary';
    const targetAssetId = editingAssetId || `asset-url-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cleanName = formName.trim() || `Зображення (${formFolder.split('/').pop()})`;

    const newOrUpdatedAsset: ImageAsset = {
      id: targetAssetId,
      name: cleanName,
      group,
      folder: formFolder,
      url: validation.normalizedUrl,
      imageUrl: validation.normalizedUrl,
      source: 'external_url',
      storageType: 'external_url',
      storageMode: 'bundled', // keep safe for legacy
      createdAt: nowIso,
      updatedAt: nowIso,
      persistenceStatus: !isGasHosted ? 'draft' : 'blocked',
    };

    // Update custom assets registry in state and local storage
    const updatedCustom = editingAssetId
      ? customAssets.map((item) => (item.id === editingAssetId ? newOrUpdatedAsset : item))
      : [newOrUpdatedAsset, ...customAssets];

    setCustomAssets(updatedCustom);
    api.saveImageRegistry(updatedCustom);

    // Apply any selected slot assignments
    formSelectedSlots.forEach((slotKey) => {
      applyAssignmentToSlot(newOrUpdatedAsset, slotKey);
    });

    setIsModalOpen(false);
    setIsSavingUrl(false);

    // Persistence runtime messaging
    if (!isGasHosted) {
      showFeedback(
        'info',
        `Актив «${cleanName}» успішно додано. У режимі AI Studio Preview посилання збережено локально: «Чернетка — не збережено в Google Таблиці».`
      );
    } else {
      // In GAS mode: attempt narrow save to user's bound Google Sheet
      const remoteRes = await api.saveImageMetadataRemote(newOrUpdatedAsset);
      if (remoteRes.success) {
        showFeedback('success', `Актив «${cleanName}»: ${remoteRes.message}`);
      } else if (remoteRes.blocked) {
        showFeedback(
          'warning',
          `Актив «${cleanName}» збережено локально як чернетку. Синхронізація з Google Таблицями: ЗАБЛОКОВАНО (аркуш «Бібліотека зображень» відсутній у цій таблиці або очікує сумісності схеми).`
        );
      } else {
        showFeedback('warning', `Актив збережено локально: ${remoteRes.message}`);
      }
    }
  };

  // Revert custom alternate slot to inherit primary stage
  const handleResetAlternateToShared = (stageKey: string) => {
    const stageNum = Number(stageKey.replace('stage-', ''));
    const updatedStages = settings.stages.map((s) =>
      s.stage === stageNum ? { ...s, alternateImage: s.primaryImage } : s
    );
    onSaveSettings({ ...settings, stages: updatedStages });

    // Also update assignment table to reflect inheritance
    const slotKey = `images/character/alternate/${stageNum}`;
    const primaryAssetId = `asset-char-primary-stage-${stageNum}`;
    const nextAssignments = [
      ...assignments.filter((a) => a.slotKey !== slotKey),
      {
        id: `assign-${slotKey.replace(/\//g, '-')}`,
        slotKey,
        assetId: primaryAssetId,
        assignedAt: new Date().toISOString(),
      },
    ];
    setAssignments(nextAssignments);
    api.saveImageAssignments(nextAssignments);

    showFeedback('info', `Альтернативний слот етапу ${stageNum} відновлено до спільного успадкування з основним.`);
  };

  // Delete custom URL asset from library
  const handleDeleteCustomAsset = (assetId: string, assetName: string) => {
    const updated = customAssets.filter((a) => a.id !== assetId);
    setCustomAssets(updated);
    api.saveImageRegistry(updated);
    showFeedback('info', `Актив «${assetName}» видалено з бібліотеки.`);
  };

  // Quick copy URL helper
  const handleCopyUrl = (url: string) => {
    navigator.clipboard?.writeText(url);
    showFeedback('success', 'Посилання скопійовано в буфер обміну.');
  };

  return (
    <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 shadow-xl">
      {/* Top Header & Info Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accent shrink-0" />
            <span>Централізована бібліотека зображень (HTTPS URL)</span>
          </h3>
          <p className="text-xs text-gray-2 mt-1">
            Керування графічними активами за прямими HTTPS-посиланнями для етапів персонажа, команди та бонусів.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
          <div
            title={
              settings.googleSpreadsheetId
                ? `ID таблиці: ${settings.googleSpreadsheetId}`
                : 'Google Таблицю ще не налаштовано'
            }
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-bg-2 border border-border-default text-gray-2 text-xs font-mono shrink-0"
          >
            <Lock className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate">
              {settings.googleSpreadsheetId
                ? `Таблиця: ${settings.googleSpreadsheetId.slice(0, 8)}...`
                : 'Таблиця не налаштована'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => handleOpenAddModal()}
            className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-accent/20 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Додати зображення за URL</span>
          </button>
        </div>
      </div>

      {/* Runtime Environment Explanation Banner */}
      {!isGasHosted ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200 leading-relaxed space-y-1">
            <span className="font-semibold text-fg block">
              Режим AI Studio Preview: Збереження чернеток (без зовнішніх мережевих викликів)
            </span>
            <span>
              У цьому режимі додані HTTPS-посилання зберігаються локально в браузері та позначаються бейджем{' '}
              <strong className="text-amber-300">«Чернетка — не збережено в Google Таблиці»</strong>. Додаток не виконує сторонніх мережевих запитів.
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-bg-2 border border-emerald-500/30 rounded-2xl p-4 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-200 leading-relaxed space-y-1">
            <span className="font-semibold text-fg block">
              Середовище Google Apps Script: Вузькі операції та сумісність схеми
            </span>
            <span>
              Збереження виконується через вузькі серверні функції з динамічним мапінгом заголовків аркушів «Бібліотека зображень» та «Призначення зображень» і обов'язковим зворотним читанням (readback). Якщо аркуші або заголовки відсутні, синхронізація безпечно блокується, зберігаючи чернетку.
            </span>
          </div>
        </div>
      )}

      {/* Diagnostics Banner for Sheets Errors / Invalid or Missing Cloudinary URLs */}
      {isGasHosted && syncState?.status === 'error' && (
        <div
          data-testid="image-library-sync-error"
          className="bg-danger/10 border border-danger/30 rounded-2xl p-4 flex items-start gap-3"
        >
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="text-xs text-danger leading-relaxed space-y-1">
            <span className="font-semibold text-fg block">
              {syncState.errorCode === 'SCHEMA_COMPATIBILITY_BLOCKED' || syncState.errorCode === 'SHEET_NOT_FOUND'
                ? 'Помилка аркушів або заголовків зображень'
                : 'Помилка доступу до Google Apps Script / таблиці'}
            </span>
            <span>{syncState.errorMessage || 'Не вдалося завантажити бібліотеку зображень із Google Таблиці.'}</span>
          </div>
        </div>
      )}

      {syncState?.imageDiagnostics &&
        (syncState.imageDiagnostics.unresolvedAssignments.length > 0 ||
          syncState.imageDiagnostics.invalidUrlAssets.length > 0) && (
          <div
            data-testid="image-library-url-diagnostics"
            className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200 leading-relaxed space-y-1.5">
              <span className="font-semibold text-fg block">
                Виявлено проблеми з посиланнями Cloudinary / HTTPS у «Бібліотеці зображень»
              </span>
              <ul className="list-disc pl-4 space-y-1">
                {syncState.imageDiagnostics.unresolvedAssignments.slice(0, 5).map((issue, idx) => (
                  <li key={`u-${issue.assetId}-${idx}`}>{issue.message}</li>
                ))}
                {syncState.imageDiagnostics.invalidUrlAssets.slice(0, 5).map((issue, idx) => (
                  <li key={`i-${issue.assetId}-${idx}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

      {/* Feedback Banner */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : feedbackMessage.type === 'error'
              ? 'bg-danger/10 border-danger/30 text-danger'
              : feedbackMessage.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : 'bg-accent/15 border-accent/30 text-accent'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedbackMessage.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-[11px] text-gray-2 hover:text-fg px-2 py-0.5 rounded cursor-pointer"
          >
            Закрити
          </button>
        </div>
      )}

      {/* Logical Folder Tabs */}
      <div className="flex flex-nowrap sm:flex-wrap overflow-x-auto gap-1.5 bg-bg-2 border border-border-default p-1.5 rounded-2xl">
        {(
          [
            { id: 'all', label: 'Усі групи' },
            { id: 'images/character/primary', label: 'images/character/primary' },
            { id: 'images/character/alternate', label: 'images/character/alternate' },
            { id: 'images/team/avatars', label: 'images/team/avatars' },
            { id: 'images/team/portraits', label: 'images/team/portraits' },
            { id: 'images/bonuses', label: 'images/bonuses' },
          ] as { id: GroupFilter; label: string }[]
        ).map((tab) => {
          const isActive = activeFolderFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFolderFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-accent text-bg-1 shadow'
                  : 'text-gray-2 hover:text-fg hover:bg-bg-1'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-bg-1/15 text-bg-1' : 'bg-bg-1 text-gray-2'
                }`}
              >
                {folderCounts[tab.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Source Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-1 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Пошук зображень"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Пошук за назвою, стабільним ID (asset-...), або URL..."
            className="w-full bg-bg-2 border border-border-default rounded-xl pl-10 pr-4 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
          />
        </div>

        <div className="sm:w-64">
          <select
            aria-label="Фільтр за типом джерела"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Усі джерела активів</option>
            <option value="external_url">HTTPS URL (зовнішні)</option>
            <option value="builtin">Вбудовані активи (bundled PNG)</option>
            <option value="local_upload">Лише в цьому браузері (локальні)</option>
            <option value="shared_reference">Спільні посилання (успадковано)</option>
          </select>
        </div>
      </div>

      {/* Asset Grid */}
      {filteredAssets.length === 0 ? (
        <div className="bg-bg-2 border border-dashed border-border-default rounded-2xl p-8 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-bg-1 border border-border-default flex items-center justify-center mx-auto text-gray-2">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div className="text-sm font-semibold text-fg">Зображень не знайдено</div>
          <p className="text-xs text-gray-2 max-w-md mx-auto">
            За вказаними фільтрами немає активів. Ви можете додати нове зображення за прямим HTTPS-посиланням.
          </p>
          <button
            type="button"
            onClick={() => handleOpenAddModal()}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-semibold shadow transition-colors cursor-pointer"
          >
            + Додати зображення за URL
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredAssets.map((asset) => {
            const assignedSlots = getAssignedSlotsForAsset(asset);
            const isFallbackShown = Boolean(fallbackImages[asset.id]);
            const resolvedUrl = resolveAssetUrl(asset.url);
            const isCustomUrl = asset.source === 'external_url';
            const isLegacyLocal = asset.source === 'local_upload' || asset.storageType === 'browser_local';
            const isShared = asset.isShared === true;

            const assetFolder = asset.folder || FOLDER_BY_GROUP[asset.group];

            return (
              <div
                key={asset.id}
                className="bg-bg-2 border border-border-default rounded-2xl overflow-hidden flex flex-col justify-between shadow-md"
              >
                <div>
                  {/* Preview Container */}
                  <div className="relative h-48 bg-bg-1 border-b border-border-default flex items-center justify-center p-3 overflow-hidden">
                    {resolvedUrl && !isFallbackShown ? (
                      <img
                        src={resolvedUrl}
                        alt={asset.name}
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (!fallbackImages[asset.id]) {
                            setFallbackImages((prev) => ({ ...prev, [asset.id]: true }));
                          }
                        }}
                        className={`max-h-full max-w-full object-contain transition-all ${
                          isShared ? 'opacity-80' : ''
                        }`}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1.5 text-center text-gray-2 px-3">
                        <ImageIcon className="w-7 h-7 text-gray-1" />
                        <span className="text-[11px] font-medium">
                          {isFallbackShown ? 'Помилка завантаження URL' : 'Зображення не призначено'}
                        </span>
                      </div>
                    )}

                    {/* Top Folder & Persistence Badges (non-overlapping flex wrap) */}
                    <div className="absolute top-2.5 inset-x-2.5 flex flex-wrap items-start justify-between gap-1.5 pointer-events-none">
                      <span className="px-2 py-0.5 rounded-md bg-bg-2/90 border border-border-default text-[10px] font-mono font-medium text-gray-2 max-w-full truncate">
                        {assetFolder}
                      </span>

                      <div className="flex items-center gap-1.5 pointer-events-auto">
                        {isShared ? (
                          <span className="px-2 py-0.5 rounded-md bg-accent/15 border border-accent/30 text-[10px] font-semibold text-accent flex items-center gap-1">
                            <Link2 className="w-3 h-3" />
                            <span>Спільне (успадковано)</span>
                          </span>
                        ) : isCustomUrl ? (
                          !isGasHosted ? (
                            <span
                              title="У режимі AI Studio Preview URL збережено локально у браузері без виклику мережі"
                              className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-[10px] font-semibold text-amber-300"
                            >
                              Чернетка — не збережено в Google Таблиці
                            </span>
                          ) : asset.persistenceStatus === 'saved_to_sheets' ? (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-semibold text-emerald-300 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              <span>Збережено в Google Таблицях</span>
                            </span>
                          ) : (
                            <span
                              title="Синхронізація заблокована через відсутність схеми таблиці в цій конфігурації"
                              className="px-2 py-0.5 rounded-md bg-danger/15 border border-danger/40 text-[10px] font-semibold text-danger"
                            >
                              Синхронізація: ЗАБЛОКОВАНО
                            </span>
                          )
                        ) : isLegacyLocal ? (
                          <span
                            title="Зображення збережено в localStorage браузера. Залишається активним до заміни на URL."
                            className="px-2 py-0.5 rounded-md bg-bg-2 border border-border-default text-[10px] font-semibold text-gray-2"
                          >
                            Лише в цьому браузері
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-[10px] font-semibold text-blue-300">
                            Вбудований актив (bundled)
                          </span>
                        )}
                      </div>
                    </div>

                    {isFallbackShown && (
                      <span className="absolute bottom-2 inset-x-2 bg-bg-2/90 border border-amber-500/30 rounded-lg px-2 py-1 text-[10px] text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span className="truncate">URL недоступний або заблоковано — показано резервне прев'ю</span>
                      </span>
                    )}
                  </div>

                  {/* Metadata Section */}
                  <div className="p-4 space-y-2.5">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold text-fg truncate" title={asset.name}>
                          {asset.name}
                        </div>
                        {isCustomUrl && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(asset)}
                            className="text-[11px] text-accent hover:text-accent/80 shrink-0 font-medium cursor-pointer"
                          >
                            Редагувати URL
                          </button>
                        )}
                      </div>

                      <div className="text-[10px] font-mono text-gray-1 mt-0.5 truncate" title={asset.id}>
                        ID: {asset.id}
                      </div>

                      {/* Display URL with copy button */}
                      <div className="flex items-center gap-1.5 mt-1 bg-bg-1 border border-border-default rounded-lg px-2 py-1">
                        <span className="text-[10px] font-mono text-gray-2 truncate flex-1" title={asset.url}>
                          {asset.url.startsWith('data:') ? 'data:image/... (локальне base64)' : asset.url}
                        </span>
                        {!asset.url.startsWith('data:') && (
                          <button
                            type="button"
                            onClick={() => handleCopyUrl(asset.url)}
                            title="Скопіювати посилання"
                            className="text-gray-2 hover:text-fg p-0.5 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Assigned Destination Slots */}
                    <div className="text-[11px] bg-bg-1 border border-border-default rounded-xl px-2.5 py-2 space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-1">
                        Призначено до слотів:
                      </div>
                      {assignedSlots.length > 0 ? (
                        <div className="text-gray-2 leading-snug">{assignedSlots.join(' • ')}</div>
                      ) : (
                        <div className="text-gray-1">Не призначено жодному слоту (у реєстрі)</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Slot Assignment Controls */}
                <div className="p-4 pt-0 space-y-2">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <select
                      aria-label={`Обрати слот для ${asset.name}`}
                      value={selectedTargets[asset.id] || allDestinationSlots[0]?.slotKey || ''}
                      onChange={(e) =>
                        setSelectedTargets((prev) => ({ ...prev, [asset.id]: e.target.value }))
                      }
                      className="flex-1 min-w-0 bg-bg-1 border border-border-default rounded-xl px-2.5 py-2 sm:py-1.5 text-[11px] text-fg focus:outline-none focus:border-accent"
                    >
                      {allDestinationSlots.map((dest) => (
                        <option key={dest.slotKey} value={dest.slotKey}>
                          {dest.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        const targetKey = selectedTargets[asset.id] || allDestinationSlots[0]?.slotKey;
                        if (targetKey) {
                          applyAssignmentToSlot(asset, targetKey);
                          const slotLabel = allDestinationSlots.find((d) => d.slotKey === targetKey)?.label || targetKey;
                          showFeedback('success', `Актив «${asset.name}» успішно призначено на ${slotLabel}.`);
                        }
                      }}
                      className="bg-accent hover:bg-accent/90 text-bg-1 px-3 py-2 sm:py-1.5 rounded-xl text-[11px] font-semibold shrink-0 transition-colors cursor-pointer text-center"
                    >
                      Призначити
                    </button>
                  </div>

                  {/* Contextual actions: restore bundled, reset alternate inheritance, replace legacy */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {asset.group === 'character_alternate' && !isShared && asset.stageKey && (
                      <button
                        type="button"
                        onClick={() => handleResetAlternateToShared(asset.stageKey!)}
                        title="Зробити слот спільним з основним етапом"
                        className="bg-bg-1 hover:bg-border-default border border-border-default text-gray-2 hover:text-fg px-2.5 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3 text-accent" />
                        <span>Зробити спільним</span>
                      </button>
                    )}

                    {isLegacyLocal && (
                      <button
                        type="button"
                        onClick={() => {
                          const slotKey = asset.stageKey
                            ? `images/character/primary/${asset.stageKey.replace('stage-', '')}`
                            : asset.bonusId
                            ? `images/bonuses/${asset.bonusId}`
                            : asset.employeeId
                            ? `images/team/avatars/${asset.employeeId}`
                            : undefined;
                          handleOpenAddModal(slotKey);
                        }}
                        className="bg-bg-1 hover:bg-border-default border border-accent/30 text-accent px-2.5 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Link2 className="w-3 h-3" />
                        <span>Замінити на URL</span>
                      </button>
                    )}

                    {isCustomUrl && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomAsset(asset.id, asset.name)}
                        title="Видалити з бібліотеки"
                        className="bg-bg-1 hover:bg-danger/20 border border-border-default hover:border-danger/40 text-danger px-2 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer ml-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit URL Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-1 border border-border-default rounded-3xl max-w-xl w-full p-4 sm:p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-border-default pb-3">
              <h4 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
                <Link2 className="w-4 h-4 text-accent" />
                <span>{editingAssetId ? 'Редагувати URL-зображення' : 'Додати зображення за прямим HTTPS URL'}</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-gray-2 hover:text-fg p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUrlAsset} className="space-y-4">
              {/* URL Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-2 flex items-center justify-between">
                  <span>HTTPS-посилання на зображення *</span>
                  {formValidation.valid && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>Валідне HTTPS</span>
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/images/character-stage.jpg"
                  value={formUrl}
                  onChange={(e) => handleUrlInputChange(e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg placeholder:text-gray-1 font-mono focus:outline-none focus:border-accent"
                  required
                />
                {formValidation.error && (
                  <p className="text-[11px] text-danger flex items-center gap-1.5 mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{formValidation.error}</span>
                  </p>
                )}

                {/* Google Drive Sharing URL Warning */}
                {formValidation.isDriveSharingUrl && formValidation.warning && (
                  <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5 text-fg">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Попередження щодо Google Drive:</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{formValidation.warning}</p>
                  </div>
                )}
              </div>

              {/* Display Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-2">Назва активу (Display Name) *</label>
                <input
                  type="text"
                  placeholder="Наприклад: Персонаж — святковий образ"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2 text-xs text-fg placeholder:text-gray-1 focus:outline-none focus:border-accent"
                  required
                />
              </div>

              {/* Logical Folder */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-2">Логічна папка в бібліотеці</label>
                <select
                  value={formFolder}
                  onChange={(e) => setFormFolder(e.target.value as LogicalImageFolder)}
                  className="w-full bg-bg-2 border border-border-default rounded-xl px-3.5 py-2 text-xs text-fg focus:outline-none focus:border-accent"
                >
                  <option value="images/character/primary">images/character/primary (Персонаж • Основні)</option>
                  <option value="images/character/alternate">images/character/alternate (Персонаж • Альтернативні)</option>
                  <option value="images/team/avatars">images/team/avatars (Команда • Аватари)</option>
                  <option value="images/team/portraits">images/team/portraits (Команда • Портрети)</option>
                  <option value="images/bonuses">images/bonuses (Бонуси)</option>
                </select>
              </div>

              {/* Live Preview Container */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-2 flex items-center justify-between">
                  <span>Попередній перегляд у браузері</span>
                  {previewDimensions && (
                    <span className="text-[10px] text-gray-2 font-mono">
                      {previewDimensions.width} × {previewDimensions.height} px
                    </span>
                  )}
                </label>
                <div className="relative aspect-video rounded-2xl bg-bg-2 border border-border-default overflow-hidden flex items-center justify-center p-3">
                  {formValidation.valid && formUrl ? (
                    <>
                      <img
                        src={formValidation.normalizedUrl || formUrl}
                        alt="Попередній перегляд"
                        referrerPolicy="no-referrer"
                        onLoad={(e) => {
                          setPreviewState('success');
                          const img = e.currentTarget;
                          setPreviewDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                        }}
                        onError={() => {
                          setPreviewState('error');
                          setPreviewDimensions(null);
                        }}
                        className={`max-h-full max-w-full object-contain ${
                          previewState === 'loading' ? 'opacity-0' : 'opacity-100'
                        }`}
                      />
                      {previewState === 'loading' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-bg-2/80 text-gray-2 text-xs gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-accent" />
                          <span>Завантаження зображення...</span>
                        </div>
                      )}
                      {previewState === 'error' && (
                        <div className="p-4 text-center space-y-1 text-danger">
                          <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-danger" />
                          <div className="text-xs font-semibold">Не вдалося завантажити зображення за цим URL</div>
                          <div className="text-[11px] text-gray-2 max-w-sm">
                            Можливо, ресурс блокує сторонній доступ через CORS, термін дії вичерпано, або посилання не є прямим файлом.
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-1 text-xs flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-gray-1" />
                      <span>Введіть валідне HTTPS-посилання, щоб переглянути прев'ю</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Multi-select Initial Slot Destinations */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-2">Призначити в слот(и) одразу після збереження:</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-bg-2 border border-border-default rounded-xl">
                  {allDestinationSlots.map((dest) => {
                    const isChecked = formSelectedSlots.includes(dest.slotKey);
                    return (
                      <label
                        key={dest.slotKey}
                        className={`flex items-center gap-2 p-2 rounded-lg text-[11px] cursor-pointer transition-colors ${
                          isChecked ? 'bg-accent/15 border border-accent/30 text-fg' : 'hover:bg-bg-1 text-gray-2'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormSelectedSlots([...formSelectedSlots, dest.slotKey]);
                            } else {
                              setFormSelectedSlots(formSelectedSlots.filter((k) => k !== dest.slotKey));
                            }
                          }}
                          className="rounded accent-accent bg-bg-1 border-border-default"
                        />
                        <span className="truncate">{dest.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3 pt-3 border-t border-border-default">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-bg-2 hover:bg-border-default border border-border-default text-xs font-semibold text-gray-2 hover:text-fg transition-colors cursor-pointer text-center"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  disabled={!formValidation.valid || isSavingUrl}
                  className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/90 text-bg-1 text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-accent/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSavingUrl ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingAssetId ? 'Зберегти зміни' : 'Зберегти в бібліотеку'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
