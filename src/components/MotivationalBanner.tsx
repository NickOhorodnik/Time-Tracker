import React, { useState, useEffect } from 'react';
import { MotivationalPhrase, SyncState } from '../types';
import { Sparkles, AlertCircle, CloudOff, Info } from 'lucide-react';
import { getPhrasesStatusMessage } from '../utils/syncStatusMessages';

interface MotivationalBannerProps {
  phrases: MotivationalPhrase[];
  totalHours: number;
  hourlyRate: number;
  rotationMinutes: number;
  variant?: 'full' | 'minimal';
  syncState?: SyncState;
}

function isPhraseRowActive(phrase: MotivationalPhrase & { active?: unknown; активна?: unknown }): boolean {
  const flag =
    phrase.isActive !== undefined
      ? phrase.isActive
      : phrase.active !== undefined
      ? phrase.active
      : phrase.активна;
  if (flag === undefined || flag === null || flag === '') return true;
  if (typeof flag === 'boolean') return flag;
  if (typeof flag === 'number') return flag !== 0;
  const norm = String(flag).trim().toLowerCase();
  if (norm === 'false' || norm === '0' || norm === 'ні' || norm === 'хиба' || norm === 'no' || norm === 'n') return false;
  return norm === 'true' || norm === '1' || norm === 'так' || norm === 'істина' || norm === 'yes' || norm === 'y';
}

export const MotivationalBanner: React.FC<MotivationalBannerProps> = ({
  phrases,
  totalHours,
  hourlyRate,
  rotationMinutes,
  variant = 'full',
  syncState,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const activePhrases = phrases.filter((p) => isPhraseRowActive(p as any) && Boolean(
    String((p as any).template || (p as any).шаблон || (p as any).text || (p as any).текст || '').trim()
  ));

  useEffect(() => {
    if (activePhrases.length <= 1) return;
    const intervalMs = Math.max(1, rotationMinutes) * 60 * 1000;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % activePhrases.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [activePhrases.length, rotationMinutes]);

  if (activePhrases.length === 0) {
    const statusInfo = getPhrasesStatusMessage(syncState, phrases.length, 0, 'Мотиваційні фрази');
    const isError = statusInfo.kind === 'schema_error' || statusInfo.kind === 'gas_unavailable';
    const isPreview = statusInfo.kind === 'preview_disabled';
    const Icon = isError ? AlertCircle : isPreview ? CloudOff : Info;
    const iconBoxClass = isError
      ? 'bg-danger/15 border-danger/30 text-danger'
      : isPreview
      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
      : 'bg-bg-2 border-border-default text-gray-2';
    const headingClass = isError
      ? 'text-danger'
      : isPreview
      ? 'text-amber-300'
      : 'text-gray-2';

    return (
      <div
        data-testid="motivational-banner-empty-state"
        className={variant === 'full' ? 'bg-bg-1 border border-border-default p-3.5 sm:p-4 rounded-2xl shadow-lg flex items-center justify-between gap-3 sm:gap-4' : 'flex items-center justify-between gap-3 sm:gap-4'}
      >
        <div className="flex items-center gap-3 sm:gap-3.5 flex-1 min-w-0">
          <div className={`w-8 h-8 md:w-9 md:h-9 rounded-xl border flex items-center justify-center shrink-0 ${iconBoxClass}`}>
            <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </div>
          <div className="min-w-0">
            <div className={`text-[9px] md:text-[10px] font-semibold uppercase tracking-wider mb-0.5 truncate ${headingClass}`}>
              {statusInfo.title}
            </div>
            <div className="text-xs md:text-sm text-gray-2 break-words">
              {statusInfo.description}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentRow = activePhrases[currentIndex % activePhrases.length] as MotivationalPhrase & {
    text?: string;
    текст?: string;
    шаблон?: string;
  };
  const currentTemplate = String(
    currentRow.template || currentRow.шаблон || currentRow.text || currentRow.текст || ''
  );

  const costUSD = Math.round(totalHours * hourlyRate);
  const formattedCost = costUSD.toLocaleString();

  // Render template placeholders: {hours}, {earned}, {cost}, {rate} (also handles ${earned}/${cost} without double $)
  const renderedText = currentTemplate
    .replace(/\{hours\}/g, totalHours.toFixed(1))
    .replace(/\$\{(?:earned|cost)\}/g, `$${formattedCost}`)
    .replace(/\{(?:earned|cost)\}/g, `$${formattedCost}`)
    .replace(/\{rate\}/g, `$${hourlyRate}/год`);

  return (
    <div className={variant === 'full' ? "bg-bg-1 border border-border-default p-3.5 sm:p-4 rounded-2xl shadow-lg flex items-center justify-between gap-3 sm:gap-4" : "flex items-center justify-between gap-3 sm:gap-4"}>
      <div className="flex items-center gap-3 sm:gap-3.5 flex-1 min-w-0">
        <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0 text-accent">
          <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] md:text-[10px] font-semibold text-accent uppercase tracking-wider mb-0.5 truncate">
            Мотиваційний індикатор агенції
          </div>
          <div className="text-xs md:text-sm font-medium text-fg break-words">
            {renderedText}
          </div>
        </div>
      </div>
    </div>
  );
};
