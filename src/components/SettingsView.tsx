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
} from 'lucide-react';
import { ImageLibrarySection } from './ImageLibrarySection';
import { api } from '../services/api';
import { normalizeGasWebAppUrl } from '../services/gasBridge';
import { getPhrasesStatusMessage } from '../utils/syncStatusMessages';

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

  const isGasHosted = syncState.runtimeMode === 'gas_hosted';

  const handleLibrarySaveSettings = (updatedSettings: AppSettings) => {
    setFormData(updatedSettings);
    onSaveSettings(updatedSettings);
  };

  const handleGeneralSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setGeneralSaveMessage('Налаштування успішно збережено локально!');
  };

  const handleAddPhrase = () => {
    if (!newPhraseText.trim()) return;
    const updated = [
      ...phrases,
      { id: `ph-${Date.now()}`, text: newPhraseText.trim(), isActive: true, order: phrases.length + 1 },
    ];
    onSavePhrases(updated);
    setNewPhraseText('');
  };

  const handleAddMotivation = () => {
    if (!newMotivTemplate.trim()) return;
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
          <h3 className="text-sm font-bold text-fg uppercase tracking-wider">Фінансові та часові параметри</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Погодинна ставка opportunity cost ($)</label>
              <input
                type="number"
                value={formData.hourlyRate}
                onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
              />
              <p className="text-[10px] text-gray-1">Використовується для розрахунку потенційної вартості часу.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Цільові години (Target Hours)</label>
              <input
                type="number"
                value={formData.targetHours}
                onChange={(e) => setFormData({ ...formData, targetHours: Number(e.target.value) })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
              />
              <p className="text-[10px] text-gray-1">Ціль годин для розрахунку прогресу персонажа та продуктивності.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Режим прогресії</label>
              <select
                value={formData.progressionMode}
                onChange={(e) => setFormData({ ...formData, progressionMode: e.target.value as any })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="all_time">За весь час (All Time)</option>
                <option value="monthly">За поточний місяць (Monthly)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-2">Хвилин за 1 бал винагороди</label>
              <input
                type="number"
                value={formData.minutesPerPoint}
                onChange={(e) => setFormData({ ...formData, minutesPerPoint: Number(e.target.value) })}
                className="w-full bg-bg-2 border border-border-default rounded-xl px-4 py-2.5 text-xs text-fg focus:outline-none focus:border-accent"
              />
            </div>
          </div>

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

          {/* Per-user GAS Web App URL */}
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
              }} className="bg-accent hover:bg-accent/90 text-bg-1 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap">
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

          {/* Environment Status Banner */}
          {!isGasHosted ? (
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

            {isGasHosted && (syncState.spreadsheetName || syncState.spreadsheetId) ? (
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
                    <div className="text-[11px] text-gray-2">Spreadsheet ID (визначено автоматично з активного контейнера)</div>
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
              <span>{isGasHosted ? 'Перевірити підключення' : 'Перевірити стан середовища'}</span>
            </button>

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

            <button
              type="button"
              onClick={handleLoadClick}
              disabled={!isGasHosted || isTesting || isSyncing}
              title={!isGasHosted ? 'Спершу додайте URL вашої GAS вебпрограми вище' : ''}
              className="bg-bg-2 hover:bg-border-default border border-border-default text-fg px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5 text-accent" />
              <span>Завантажити з таблиці</span>
            </button>

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
          </div>
        </div>
      )}
    </div>
  );
};
