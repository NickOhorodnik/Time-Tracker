import React, { useEffect, useState } from 'react';
import { AppSettings, Bonus, Category, ActionType, Project, Phrase, MotivationalPhrase, SyncState, Employee } from '../types';
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Link2,
  HelpCircle,
  Info,
  CloudOff,
  FileSpreadsheet,
  Download,
  Wrench,
  ExternalLink,
  Copy,
  Check,
  Share2,
  Lock,
} from 'lucide-react';
import { ImageLibrarySection } from './ImageLibrarySection';
import { api } from '../services/api';
import { getReadOnlyShareSession, normalizeGasWebAppUrl } from '../services/gasBridge';
import { buildReadOnlyShareUrl, extractSpreadsheetIdFromUrlOrId } from '../utils/shareLink';
import { getPhrasesStatusMessage } from '../utils/syncStatusMessages';

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for iframe / restricted clipboard contexts
    }
  }
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.className = 'sr-only';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      document.body.removeChild(textarea);
    }
  }
  return false;
}

interface SettingsViewProps {
  settings: AppSettings;
  categories: Category[];
  actionTypes: ActionType[];
  projects: Project[];
  bonuses: Bonus[];
  employees: Employee[];
  phrases: Phrase[];
  motivationalPhrases: MotivationalPhrase[];
  syncState: SyncState;
  isSyncing: boolean;
  isReadOnly?: boolean;
  onSaveSettings: (newSettings: AppSettings) => void;
  onSaveCategories: (cats: Category[]) => void;
  onSavePhrases: (ph: Phrase[]) => void;
  onSaveMotivational: (mot: MotivationalPhrase[]) => void;
  onUpdateBonusImage: (id: string, imageUrl: string) => void;
  onUpdateEmployeeImage: (employeeId: string, slot: 'avatar' | 'portrait', imageUrl: string) => void;
  onSyncGas: () => Promise<{ success: boolean; message: string }>;
  onTestConnection: () => Promise<{ success: boolean; message: string }>;
  onSetupSpreadsheet: () => Promise<{ success: boolean; message: string }>;
  onLoadFromSheet: () => Promise<{ success: boolean; message: string }>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  bonuses,
  employees,
  phrases,
  motivationalPhrases,
  syncState,
  isSyncing,
  isReadOnly = false,
  onSaveSettings,
  onSavePhrases,
  onSaveMotivational,
  onUpdateBonusImage,
  onUpdateEmployeeImage,
  onSyncGas,
  onTestConnection,
  onSetupSpreadsheet,
  onLoadFromSheet,
}) => {
  const effectiveReadOnly = isReadOnly || Boolean(syncState?.isReadOnly);
  const [formData, setFormData] = useState<AppSettings>(() => settings);
  const [gasUrlDraft, setGasUrlDraft] = useState(settings.gasWebAppUrl || '');
  const [sheetUrlDraft, setSheetUrlDraft] = useState(settings.googleSpreadsheetInput || settings.googleSpreadsheetId || '');

  useEffect(() => {
    setFormData(settings);
    setGasUrlDraft(settings.gasWebAppUrl || '');
    setSheetUrlDraft(settings.googleSpreadsheetInput || settings.googleSpreadsheetId || '');
  }, [settings]);

  const [activeSubTab, setActiveSubTab] = useState<'general' | 'library' | 'phrases' | 'motivation' | 'sheets'>('general');
  const [newPhraseText, setNewPhraseText] = useState('');
  const [newMotivTemplate, setNewMotivTemplate] = useState('');

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [generalSaveMessage, setGeneralSaveMessage] = useState<string | null>(null);
  const [copiedShareKey, setCopiedShareKey] = useState<string | null>(null);

  const isGasHosted = syncState.runtimeMode === 'gas_hosted';

  const handleCopyShareLink = async (key: string, url: string) => {
    if (!url) return;
    const copied = await copyTextToClipboard(url);
    if (copied) {
      setCopiedShareKey(key);
      setTimeout(() => {
        setCopiedShareKey((prev) => (prev === key ? null : prev));
      }, 2500);
    }
  };

  const handleLibrarySaveSettings = (updatedSettings: AppSettings) => {
    if (effectiveReadOnly) return;
    setFormData(updatedSettings);
    onSaveSettings(updatedSettings);
  };

  const handleGeneralSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (effectiveReadOnly) return;
    onSaveSettings(formData);
    setGeneralSaveMessage('Налаштування успішно збережено локально!');
  };

  const handleAddPhrase = () => {
    if (effectiveReadOnly || !newPhraseText.trim()) return;
    const updated = [
      ...phrases,
      { id: `ph-${Date.now()}`, text: newPhraseText.trim(), isActive: true, order: phrases.length + 1 },
    ];
    onSavePhrases(updated);
    setNewPhraseText('');
  };

  const handleAddMotivation = () => {
    if (effectiveReadOnly || !newMotivTemplate.trim()) return;
    const updated = [
      ...motivationalPhrases,
      {
        id: `mot-${Date.now()}`,
        template: newMotivTemplate.trim(),
        isActive: true,
        order: motivationalPhrases.length + 1,
      },
    ];
    onSaveMotivational(updated);
    setNewMotivTemplate('');
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await onTestConnection();
    setTestResult(result);
    setIsTesting(false);
  };

  const handleSetupClick = async () => {
    if (effectiveReadOnly) return;
    setIsTesting(true);
    setTestResult(null);
    const result = await onSetupSpreadsheet();
    setTestResult(result);
    setIsTesting(false);
  };

  const handleLoadClick = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await onLoadFromSheet();
    setTestResult(result);
    setIsTesting(false);
  };

  const handleSyncNowClick = async () => {
    if (effectiveReadOnly) return;
    setIsTesting(true);
    setTestResult(null);
    const result = await onSyncGas();
    setTestResult(result);
    setIsTesting(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between border-b border-border-default pb-4 sm:pb-5">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-fg tracking-wide flex items-center gap-2.5">
            <SettingsIcon className="w-5 h-5 sm:w-6 sm:h-6 text-accent shrink-0" />
            <span>Налаштування системи Allonsy</span>
          </h2>
          <p className="text-xs text-gray-2 mt-1">
            Керуйте параметрами обліку часу, ставками opportunity cost, етапами персонажа та інтеграцією з Google Sheets.
          </p>
        </div>
      </div>

      {/* Subtabs */}
      <div className="flex flex-wrap gap-1.5 bg-bg-1 border border-border-default p-1.5 rounded-2xl w-full sm:w-fit">
        {[
          { id: 'general', label: 'Основні параметри' },
          { id: 'library', label: 'Бібліотека зображень' },
          { id: 'phrases', label: 'Фрази в хмарці' },
          { id: 'motivation', label: 'Мотиваційні фрази' },
          { id: 'sheets', label: 'Google Sheets / GAS' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeSubTab === tab.id ? 'bg-accent text-bg-1 shadow' : 'text-gray-2 hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Settings Tab */}
      {activeSubTab === 'general' && (
        <form onSubmit={handleGeneralSave} className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 lg:p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider">Фінансові та часові параметри</h3>
            {effectiveReadOnly && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 rounded-lg">
                <Lock className="w-3 h-3" />
                <span>Лише перегляд</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Погодинна ставка opportunity cost ($)</label>
              <input
                type="number"
                disabled={effectiveReadOnly}
                value={formData.hourlyRate}
                onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-60"
              />
              <p className="text-[10px] text-gray-1">Використовується для розрахунку потенційної вартості часу.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Цільові години (Target Hours)</label>
              <input
                type="number"
                disabled={effectiveReadOnly}
                value={formData.targetHours}
                onChange={(e) => setFormData({ ...formData, targetHours: Number(e.target.value) })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-60"
              />
              <p className="text-[10px] text-gray-1">Ціль годин для розрахунку прогресу персонажа та продуктивності.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Режим прогресії</label>
              <select
                disabled={effectiveReadOnly}
                value={formData.progressionMode}
                onChange={(e) => setFormData({ ...formData, progressionMode: e.target.value as any })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-60"
              >
                <option value="all_time">За весь час (All Time)</option>
                <option value="monthly">За поточний місяць (Monthly)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Хвилин за 1 бал винагороди</label>
              <input
                type="number"
                disabled={effectiveReadOnly}
                value={formData.minutesPerPoint}
                onChange={(e) => setFormData({ ...formData, minutesPerPoint: Number(e.target.value) })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
          </div>

          {!effectiveReadOnly && (
            <div className="pt-4 border-t border-border-default flex items-center justify-between">
              {generalSaveMessage && (
                <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  {generalSaveMessage}
                </span>
              )}
              <button
                type="submit"
                className="ml-auto bg-accent hover:bg-accent/90 text-bg-1 px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-lg shadow-accent/20"
              >
                <Save className="w-4 h-4" />
                <span>Зберегти налаштування</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* Image Library Tab */}
      {activeSubTab === 'library' && (
        <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 lg:p-8 space-y-6 shadow-xl">
          <ImageLibrarySection
            settings={formData}
            bonuses={bonuses}
            employees={employees}
            syncState={syncState}
            isReadOnly={effectiveReadOnly}
            onSaveSettings={handleLibrarySaveSettings}
            onUpdateBonusImage={onUpdateBonusImage}
            onUpdateEmployeeImage={onUpdateEmployeeImage}
          />
        </div>
      )}

      {/* Phrases Tab */}
      {activeSubTab === 'phrases' && (() => {
        const activePhrasesCount = phrases.filter((p) => p.isActive !== false && Boolean(p.text?.trim())).length;
        const phrasesStatus = getPhrasesStatusMessage(syncState, phrases.length, activePhrasesCount, 'Фрази');
        return (
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 lg:p-8 space-y-6 shadow-xl">
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider">Фрази для мовної бульбашки персонажа</h3>
            {phrasesStatus.kind !== 'ok' && (
              <div
                data-testid="settings-phrases-status"
                className={`p-4 rounded-2xl border flex items-start gap-3 text-xs ${
                  phrasesStatus.kind === 'schema_error' || phrasesStatus.kind === 'gas_unavailable'
                    ? 'bg-danger/10 border-danger/30 text-danger'
                    : phrasesStatus.kind === 'preview_disabled'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-bg-2 border-border-default text-gray-2'
                }`}
              >
                {phrasesStatus.kind === 'schema_error' || phrasesStatus.kind === 'gas_unavailable' ? (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
                ) : phrasesStatus.kind === 'preview_disabled' ? (
                  <CloudOff className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                ) : (
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
                )}
                <div className="space-y-1">
                  <div className="font-semibold text-fg">{phrasesStatus.title}</div>
                  <div className="leading-relaxed">{phrasesStatus.description}</div>
                </div>
              </div>
            )}
            {!effectiveReadOnly && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Додати нову фразу..."
                  value={newPhraseText}
                  onChange={(e) => setNewPhraseText(e.target.value)}
                  className="flex-1 bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleAddPhrase}
                  className="bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Додати
                </button>
              </div>
            )}

            <div className="space-y-2">
              {phrases.map((phrase, idx) => (
                <div key={phrase.id} className="flex items-center justify-between p-3 rounded-xl bg-bg-2 border border-border-default text-xs gap-3">
                  <div className="flex-1 min-w-0 flex items-center gap-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                        phrase.isActive !== false
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-bg-1 text-gray-2 border border-border-default'
                      }`}
                    >
                      {phrase.isActive !== false ? 'Активна' : 'Вимкнено'}
                    </span>
                    <span className="text-fg truncate">{phrase.text}</span>
                  </div>
                  {!effectiveReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = phrases.filter((_, i) => i !== idx);
                        onSavePhrases(updated);
                      }}
                      className="text-danger hover:text-danger/80 shrink-0"
                    >
                      Видалити
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Motivational Phrases Tab */}
      {activeSubTab === 'motivation' && (() => {
        const activeMotivCount = motivationalPhrases.filter((m) => m.isActive !== false && Boolean(m.template?.trim())).length;
        const motivStatus = getPhrasesStatusMessage(syncState, motivationalPhrases.length, activeMotivCount, 'Мотиваційні фрази');
        return (
          <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 lg:p-8 space-y-6 shadow-xl">
            <h3 className="text-sm font-bold text-fg uppercase tracking-wider">Мотиваційні шаблони банера</h3>
            <p className="text-xs text-gray-2">Підтримувані змінні: {'{hours}'}, {'{earned}'}.</p>
            {motivStatus.kind !== 'ok' && (
              <div
                data-testid="settings-motivation-status"
                className={`p-4 rounded-2xl border flex items-start gap-3 text-xs ${
                  motivStatus.kind === 'schema_error' || motivStatus.kind === 'gas_unavailable'
                    ? 'bg-danger/10 border-danger/30 text-danger'
                    : motivStatus.kind === 'preview_disabled'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-bg-2 border-border-default text-gray-2'
                }`}
              >
                {motivStatus.kind === 'schema_error' || motivStatus.kind === 'gas_unavailable' ? (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
                ) : motivStatus.kind === 'preview_disabled' ? (
                  <CloudOff className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                ) : (
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
                )}
                <div className="space-y-1">
                  <div className="font-semibold text-fg">{motivStatus.title}</div>
                  <div className="leading-relaxed">{motivStatus.description}</div>
                </div>
              </div>
            )}
            {!effectiveReadOnly && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Шаблон фрази (наприклад: Вже {hours} год і ${earned}!)..."
                  value={newMotivTemplate}
                  onChange={(e) => setNewMotivTemplate(e.target.value)}
                  className="flex-1 bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleAddMotivation}
                  className="bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Додати
                </button>
              </div>
            )}

            <div className="space-y-2">
              {motivationalPhrases.map((m, idx) => (
                <div key={m.id} className="flex items-center justify-between p-3 rounded-xl bg-bg-2 border border-border-default text-xs gap-3">
                  <div className="flex-1 min-w-0 flex items-center gap-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                        m.isActive !== false
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-bg-1 text-gray-2 border border-border-default'
                      }`}
                    >
                      {m.isActive !== false ? 'Активна' : 'Вимкнено'}
                    </span>
                    <span className="text-fg truncate">{m.template}</span>
                  </div>
                  {!effectiveReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = motivationalPhrases.filter((_, i) => i !== idx);
                        onSaveMotivational(updated);
                      }}
                      className="text-danger hover:text-danger/80 shrink-0"
                    >
                      Видалити
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Google Sheets / GAS Bound Spreadsheet Integration Tab */}
      {activeSubTab === 'sheets' && (
        <div className="bg-bg-1 border border-border-default rounded-3xl p-4 sm:p-6 lg:p-8 space-y-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-default pb-4">
            <div>
              <h3 className="text-sm font-bold text-fg uppercase tracking-wider flex items-center gap-2">
                <Link2 className="w-4 h-4 text-accent" />
                <span>Google Таблиця через Apps Script</span>
              </h3>
              <p className="text-xs text-gray-2 mt-1">
                Вкажіть URL власної вебпрограми Apps Script і посилання на Google Таблицю. Обидва значення зберігаються в налаштуваннях цього браузера.
              </p>
            </div>

            {/* Runtime / Connection Badge */}
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-bg-2 border border-border-default shrink-0">
              {syncState.status === 'local_preview' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-2">
                  <CloudOff className="w-3.5 h-3.5 text-gray-1" />
                  <span>Локальний режим (AI Studio Preview)</span>
                </div>
              )}
              {syncState.status === 'disconnected' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-2">
                  <CloudOff className="w-3.5 h-3.5 text-gray-1" />
                  <span>GAS • Очікує підключення</span>
                </div>
              )}
              {syncState.status === 'unverified' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span>GAS • Очікує перевірки</span>
                </div>
              )}
              {syncState.status === 'connected' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Підключено: {syncState.spreadsheetName || 'Прив’язана Google Таблиця'}</span>
                </div>
              )}
              {syncState.status === 'error' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-danger" title={syncState.errorMessage || ''}>
                  <AlertCircle className="w-3.5 h-3.5 text-danger" />
                  <span>Помилка доступу до таблиці</span>
                </div>
              )}
            </div>
          </div>

          {/* Per-user GAS Web App URL (Owner only) or Read-Only Notice */}
          {effectiveReadOnly ? (
            <div className="bg-bg-2 border border-accent/30 rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-fg">
                <Lock className="w-4 h-4 text-accent shrink-0" />
                <span>Підключення за посиланням (лише перегляд)</span>
              </div>
              <p className="text-xs text-gray-2 leading-relaxed">
                Таблицю відкрито за спільним посиланням у режимі лише для читання (
                {syncState.readOnlySource === 'gas' ? 'через GAS-проксі' : 'публічний перегляд Google Таблиці'}). Зміна підключень, синхронізація та редагування даних недоступні.
              </p>
            </div>
          ) : (
              <div className="bg-bg-2 border border-border-default rounded-2xl p-5 space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-fg">URL вашої вебпрограми Apps Script</h4>
                  <p className="text-xs text-gray-2 mt-1">Вкажіть власну вебпрограму Apps Script і посилання на свою Google Таблицю. Додаток працюватиме лише з вибраною таблицею.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="url" value={gasUrlDraft} onChange={(event) => setGasUrlDraft(event.target.value)}
                    placeholder="https://script.google.com/macros/s/…/exec"
                    className="flex-1 min-w-0 bg-bg-1 border border-border-default rounded-xl px-3 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                    aria-label="URL вебпрограми Google Apps Script" />
                  <button type="button" onClick={() => {
                    const normalized = normalizeGasWebAppUrl(gasUrlDraft);
                    if (gasUrlDraft.trim() && !normalized) {
                      setTestResult({ success: false, message: 'Введіть коректний URL розгортання Apps Script, що закінчується на /exec.' });
                      return;
                    }
                    const updated = { ...formData, gasWebAppUrl: normalized, googleSpreadsheetInput: sheetUrlDraft.trim() };
                    setFormData(updated);
                    onSaveSettings(updated);
                    setTestResult({ success: true, message: normalized ? 'URL збережено в налаштуваннях цього браузера. Тепер перевірте підключення.' : 'URL підключення видалено з налаштувань цього браузера.' });
                  }} className="bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer">
                    Зберегти підключення
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-fg" htmlFor="sheet-url">Посилання на вашу Google Таблицю</label>
                  <input id="sheet-url" type="url" value={sheetUrlDraft} onChange={(event) => setSheetUrlDraft(event.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                    className="w-full bg-bg-1 border border-border-default rounded-xl px-3 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
                    aria-label="Посилання на власну Google Таблицю" />
                </div>
                <p className="text-[11px] text-gray-2">Для доступу без окремого входу розгортання зазвичай має виконуватися від імені власника скрипту й мати доступ «Усі». Кожен користувач може вказати власну таблицю та власне розгортання Apps Script.</p>
              </div>
          )}

          {/* Shareable Read-Only Links Card (available for owner and read-only viewers) */}
          {(() => {
            const readOnlySession = effectiveReadOnly ? getReadOnlyShareSession() : null;
            const resolvedSheetId = extractSpreadsheetIdFromUrlOrId(
              sheetUrlDraft ||
                readOnlySession?.spreadsheetId ||
                syncState.spreadsheetId ||
                formData.googleSpreadsheetInput ||
                formData.googleSpreadsheetId ||
                ''
            );
            const normalizedGasUrl = normalizeGasWebAppUrl(
              (effectiveReadOnly ? readOnlySession?.gasUrl : '') ||
                gasUrlDraft ||
                formData.gasWebAppUrl ||
                ''
            );
            const currentHref =
              typeof window !== 'undefined' ? window.location.href : 'https://app.example.com/';
            const gasShareUrl =
              resolvedSheetId && normalizedGasUrl
                ? buildReadOnlyShareUrl(currentHref, resolvedSheetId, normalizedGasUrl)
                : '';
            const publicShareUrl = resolvedSheetId
              ? buildReadOnlyShareUrl(currentHref, resolvedSheetId)
              : '';

            return (
              <div className="bg-bg-2 border border-border-default rounded-2xl p-5 space-y-3" data-testid="readonly-share-links-card">
                <div className="flex items-start gap-2.5">
                  <Share2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-fg">Посилання для перегляду без внесення змін</h4>
                    <p className="text-xs text-gray-2 mt-1 leading-relaxed">
                      Натисніть безпосередньо на посилання нижче (або на кнопку «Копіювати»), щоб скопіювати його в буфер обміну. За цим посиланням таблиця відкривається суворо в режимі лише перегляду.
                    </p>
                  </div>
                </div>

                {!resolvedSheetId ? (
                  <div className="p-3 bg-bg-1 rounded-xl border border-border-default text-xs text-gray-2">
                    Вкажіть вище посилання на вашу Google Таблицю, щоб згенерувати посилання для перегляду.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {gasShareUrl && (
                      <div className={`p-3 bg-bg-1 rounded-xl border transition-colors space-y-2 ${
                        copiedShareKey === 'gas' ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-border-default'
                      }`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-semibold text-fg">Посилання через GAS-проксі (рекомендовано для приватних таблиць)</div>
                            <div className="text-[11px] text-gray-2">Працює, навіть якщо сама Google Таблиця не відкрита для всіх за посиланням (потрібен доступ «Усі» для вебпрограми GAS).</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => { void handleCopyShareLink('gas', gasShareUrl); }}
                            className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/90 text-bg-1 text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-center"
                          >
                            {copiedShareKey === 'gas' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedShareKey === 'gas' ? 'Скопійовано' : 'Копіювати'}</span>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => { void handleCopyShareLink('gas', gasShareUrl); }}
                          title="Натисніть, щоб скопіювати посилання"
                          aria-label="Скопіювати посилання для перегляду через GAS-проксі"
                          className={`w-full text-left bg-bg-2 hover:bg-bg-2/80 border rounded-lg px-3 py-2 text-[11px] font-mono transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                            copiedShareKey === 'gas'
                              ? 'border-emerald-500/60 text-emerald-300'
                              : 'border-border-default hover:border-accent/60 text-fg'
                          }`}
                        >
                          <span className="truncate select-all">{gasShareUrl}</span>
                          <span className={`shrink-0 text-[10px] font-sans font-semibold px-2 py-0.5 rounded ${
                            copiedShareKey === 'gas'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-bg-1 text-gray-2'
                          }`}>
                            {copiedShareKey === 'gas' ? 'Скопійовано!' : 'Клік для копіювання'}
                          </span>
                        </button>
                      </div>
                    )}

                    <div className={`p-3 bg-bg-1 rounded-xl border transition-colors space-y-2 ${
                      copiedShareKey === 'public' ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-border-default'
                    }`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-semibold text-fg">Коротке посилання лише з URL таблиці</div>
                          <div className="text-[11px] text-gray-2">Працює без GAS URL, якщо у Google Таблиці ввімкнено доступ «Усі, хто має посилання — Переглядач».</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { void handleCopyShareLink('public', publicShareUrl); }}
                          className="px-3 py-1.5 rounded-lg bg-bg-2 hover:bg-border-default border border-border-default text-fg text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-center"
                        >
                          {copiedShareKey === 'public' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedShareKey === 'public' ? 'Скопійовано' : 'Копіювати'}</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void handleCopyShareLink('public', publicShareUrl); }}
                        title="Натисніть, щоб скопіювати посилання"
                        aria-label="Скопіювати коротке посилання для публічного перегляду Google Таблиці"
                        className={`w-full text-left bg-bg-2 hover:bg-bg-2/80 border rounded-lg px-3 py-2 text-[11px] font-mono transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                          copiedShareKey === 'public'
                            ? 'border-emerald-500/60 text-emerald-300'
                            : 'border-border-default hover:border-accent/60 text-fg'
                        }`}
                      >
                        <span className="truncate select-all">{publicShareUrl}</span>
                        <span className={`shrink-0 text-[10px] font-sans font-semibold px-2 py-0.5 rounded ${
                          copiedShareKey === 'public'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-bg-1 text-gray-2'
                        }`}>
                          {copiedShareKey === 'public' ? 'Скопійовано!' : 'Клік для копіювання'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Environment Status Banner */}
          {effectiveReadOnly ? (
            syncState.status === 'error' ? (
              <div className="bg-danger/10 border border-danger/30 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="text-xs text-gray-1 leading-relaxed space-y-1.5">
                  <span className="font-semibold text-fg block">
                    Помилка завантаження таблиці для перегляду
                  </span>
                  <span className="block text-gray-2">
                    {syncState.errorMessage || 'Перевірте коректність посилання та доступ до Google Таблиці.'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-200 leading-relaxed space-y-1">
                  <span className="font-semibold text-fg block">
                    Дані таблиці відкрито у режимі перегляду
                  </span>
                  <span>
                    Ви можете оновити дані кнопкою «Завантажити з таблиці» або «Оновити дані» у верхній панелі.
                  </span>
                </div>
              </div>
            )
          ) : !isGasHosted ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200 leading-relaxed space-y-1.5">
                <span className="font-semibold text-fg block">
                  Таблицю ще не підключено
                </span>
                <span className="block">
                  {api.getIntegrationInfo().reason}
                </span>
              </div>
            </div>
          ) : syncState.status === 'error' ? (
            <div className="bg-danger/10 border border-danger/30 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="text-xs text-gray-1 leading-relaxed space-y-1.5">
                <span className="font-semibold text-fg block">
                  {syncState.errorCode === 'SPREADSHEET_URL_REQUIRED'
                    ? 'Додайте посилання на свою Google Таблицю'
                    : 'Помилка доступу до прив’язаної Google Таблиці'}
                </span>
                <span className="block text-gray-2">
                  {syncState.errorMessage ||
                    'Перевірте посилання на Google Таблицю в налаштуваннях і доступ скрипту до неї.'}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-200 leading-relaxed space-y-1">
                <span className="font-semibold text-fg block">
                  GAS сервер налаштований для роботи з вашою таблицею
                </span>
                <span>
                  Кожен запит використовує посилання на Google Таблицю, яке ви зберегли в налаштуваннях. Окремий вхід не потрібен.
                </span>
              </div>
            </div>
          )}

          {/* Bound Spreadsheet Read-Only Identity Card */}
          <div className="bg-bg-2 border border-border-default rounded-2xl p-5 space-y-4">
            <h4 className="text-xs font-bold text-fg flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-accent" />
              <span>Інформація про прив’язану Google Таблицю:</span>
            </h4>

            {(isGasHosted || effectiveReadOnly) && (syncState.spreadsheetName || syncState.spreadsheetId) ? (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-bg-1 rounded-xl border border-border-default">
                  <div>
                    <div className="text-[11px] text-gray-2">Назва таблиці</div>
                    <div className="text-xs font-semibold text-fg mt-0.5">
                      {syncState.spreadsheetName || 'Прив’язана Google Таблиця'}
                    </div>
                  </div>
                  {syncState.spreadsheetId && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${syncState.spreadsheetId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium"
                    >
                      <span>Відкрити в Google Таблицях</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {syncState.spreadsheetId && (
                  <div className="p-3 bg-bg-1 rounded-xl border border-border-default">
                    <div className="text-[11px] text-gray-2">Spreadsheet ID</div>
                    <div className="text-xs font-mono text-emerald-400 mt-1 break-all">
                      {syncState.spreadsheetId}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-bg-1 rounded-xl border border-border-default text-xs text-gray-2 leading-relaxed">
                {isGasHosted
                  ? 'Назва та ідентифікатор таблиці з’являться після перевірки з’єднання.'
                  : 'У локальному режимі AI Studio Preview прив’язана таблиця недоступна. Додайте вище URL вебпрограми Apps Script зі своєї копії таблиці.'}
              </div>
            )}
          </div>

          {/* Onboarding Guide */}
          {!effectiveReadOnly && (
            <div className="bg-bg-2 border border-border-default rounded-2xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-fg flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-accent" />
                <span>Як розпочати роботу з власною копією (Onboarding):</span>
              </h4>
              <ul className="text-xs text-gray-2 space-y-2 list-disc pl-5 leading-relaxed">
                {api.getIntegrationInfo().steps.map((stepText, idx) => (
                  <li key={idx}>{stepText}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Connection / Operation Result Banner */}
          {testResult && (
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 text-xs font-medium ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
              )}
              <span className="leading-relaxed">{testResult.message}</span>
            </div>
          )}

          {/* Action Controls */}
          <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2.5 sm:gap-3 pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isSyncing}
              className="bg-accent hover:bg-accent/90 text-bg-1 px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent/20"
            >
              <RefreshCw className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isGasHosted || effectiveReadOnly ? 'Перевірити підключення' : 'Перевірити стан середовища'}</span>
            </button>

            {!effectiveReadOnly && (
              <button
                type="button"
                onClick={handleSetupClick}
                disabled={!isGasHosted || isTesting || isSyncing}
                title={!isGasHosted ? 'Спершу додайте URL вашої GAS вебпрограми вище' : ''}
                className="bg-bg-2 hover:bg-border-default border border-border-default text-fg px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Wrench className="w-3.5 h-3.5 text-accent" />
                <span>Перевірити аркуші (Setup)</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleLoadClick}
              disabled={(!isGasHosted && !effectiveReadOnly) || isTesting || isSyncing}
              title={!isGasHosted && !effectiveReadOnly ? 'Спершу додайте URL вашої GAS вебпрограми вище' : ''}
              className="bg-bg-2 hover:bg-border-default border border-border-default text-fg px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5 text-accent" />
              <span>Завантажити з таблиці</span>
            </button>

            {!effectiveReadOnly && (
              <button
                type="button"
                onClick={handleSyncNowClick}
                disabled={!isGasHosted || isTesting || isSyncing}
                title={!isGasHosted ? 'Спершу додайте URL вашої GAS вебпрограми вище' : ''}
                className="bg-bg-2 hover:bg-border-default border border-border-default text-fg px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Синхронізувати все</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
