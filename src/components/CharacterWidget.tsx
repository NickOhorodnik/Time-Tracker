import React, { useState, useEffect, useRef } from 'react';
import { ImageOff, AlertCircle, CloudOff } from 'lucide-react';
import { CharacterStage, Phrase, SyncState } from '../types';
import { resolveAssetUrl } from '../utils/assetResolver';
import { getCharacterImageStatusMessage, getPhrasesStatusMessage } from '../utils/syncStatusMessages';

interface CharacterWidgetProps {
  stages: CharacterStage[];
  totalHours: number;
  targetHours: number;
  progressionMode: 'monthly' | 'all_time';
  monthlyHours: number;
  phrases: Phrase[];
  bubbleDurationMs: number;
  imageProgressionEnabled: boolean;
  variant?: 'card' | 'minimal';
  desktopBubblePlacement?: 'left' | 'top';
  syncState?: SyncState;
}

export const CharacterWidget: React.FC<CharacterWidgetProps> = ({
  stages,
  totalHours,
  targetHours,
  progressionMode,
  monthlyHours,
  phrases,
  bubbleDurationMs,
  imageProgressionEnabled,
  variant = 'card',
  desktopBubblePlacement = 'left',
  syncState,
}) => {
  const [currentPhrase, setCurrentPhrase] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const phraseQueueRef = useRef<string[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const relevantHours = progressionMode === 'monthly' ? monthlyHours : totalHours;
  const target = targetHours > 0 ? targetHours : 0;
  const progressPercent = target > 0 ? Math.min(100, Math.round((relevantHours / target) * 100)) : 0;

  const currentStageObj = React.useMemo(() => {
    const safeStages = Array.isArray(stages) ? stages : [];
    if (safeStages.length === 0) {
      return { stage: 1, name: 'Етап 1', thresholdPercent: 0, primaryImage: '', alternateImage: '' };
    }

    if (!imageProgressionEnabled) {
      const firstWithImage = safeStages.find((s) => resolveAssetUrl(s.primaryImage));
      return firstWithImage || safeStages[0];
    }

    const sorted = [...safeStages].sort((a, b) => a.thresholdPercent - b.thresholdPercent);
    let matchedIndex = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (progressPercent >= sorted[i].thresholdPercent) {
        matchedIndex = i;
      }
    }

    let fallbackStage = sorted[matchedIndex];
    if (!resolveAssetUrl(fallbackStage.primaryImage)) {
      for (let i = matchedIndex; i >= 0; i--) {
        if (resolveAssetUrl(sorted[i].primaryImage)) {
          fallbackStage = sorted[i];
          break;
        }
      }
    }

    if (!resolveAssetUrl(fallbackStage.primaryImage)) {
      const anyWithImage = sorted.find((s) => resolveAssetUrl(s.primaryImage));
      fallbackStage = anyWithImage || sorted[0] || fallbackStage;
    }

    return fallbackStage;
  }, [stages, progressPercent, imageProgressionEnabled]);

  // Shuffle-bag phrase picker (never invents character dialogue)
  const getNextPhrase = () => {
    const activePhrases = (Array.isArray(phrases) ? phrases : [])
      .filter((p) => {
        const rawActive =
          (p as any).isActive !== undefined
            ? (p as any).isActive
            : (p as any).active !== undefined
            ? (p as any).active
            : (p as any).активна;
        if (rawActive === false || rawActive === 0) return false;
        if (typeof rawActive === 'string') {
          const norm = rawActive.trim().toLowerCase();
          if (norm === 'false' || norm === '0' || norm === 'ні' || norm === 'хиба' || norm === 'no') return false;
        }
        return Boolean((p.text || (p as any).текст || '').trim());
      })
      .map((p) => (p.text || (p as any).текст || '').trim());

    if (activePhrases.length === 0) {
      const statusMsg = getPhrasesStatusMessage(syncState, phrases.length, 0, 'Фрази');
      return `${statusMsg.title}: ${statusMsg.description}`;
    }

    const pool = phraseQueueRef.current.filter((item) => activePhrases.includes(item));
    if (pool.length === 0) {
      phraseQueueRef.current = [...activePhrases].sort(() => Math.random() - 0.5);
    } else {
      phraseQueueRef.current = pool;
    }

    return phraseQueueRef.current.pop() || activePhrases[0];
  };

  const handleCharacterClick = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const phrase = getNextPhrase();
    setCurrentPhrase(phrase);
    setIsSpeaking(true);

    timeoutRef.current = setTimeout(() => {
      setIsSpeaking(false);
    }, bubbleDurationMs || 6000);
  };

  const primaryImg = resolveAssetUrl(currentStageObj.primaryImage);
  const alternateImg = resolveAssetUrl(currentStageObj.alternateImage) || primaryImg;
  const currentImage = isSpeaking && alternateImg ? alternateImg : primaryImg;
  const isImageBroken = Boolean(currentImage && brokenImageUrl === currentImage);
  const hasDisplayableImage = Boolean(currentImage && !isImageBroken);

  const renderEmptyOrErrorState = (compact: boolean) => {
    const imgStatus = getCharacterImageStatusMessage(
      syncState,
      currentStageObj.stage,
      isImageBroken,
      currentImage
    );
    const isErrorState =
      isImageBroken ||
      imgStatus.kind === 'invalid_media_url' ||
      imgStatus.kind === 'schema_error' ||
      imgStatus.kind === 'gas_unavailable';
    const isPreviewState = imgStatus.kind === 'preview_disabled';

    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center text-center gap-1.5 rounded-2xl border border-dashed ${
          isErrorState
            ? 'border-danger/40 bg-danger/5 text-danger'
            : isPreviewState
            ? 'border-amber-500/40 bg-amber-500/5 text-amber-200'
            : 'border-border-default bg-bg-2/60 text-gray-2'
        } ${compact ? 'px-3 py-3' : 'px-4 py-6'}`}
        data-testid="character-image-empty-state"
      >
        {isErrorState ? (
          <AlertCircle className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} shrink-0 text-danger`} />
        ) : isPreviewState ? (
          <CloudOff className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} shrink-0 text-amber-400`} />
        ) : (
          <ImageOff className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} shrink-0 text-gray-1`} />
        )}
        <div className="text-[11px] font-semibold text-fg leading-snug">
          {imgStatus.title}
        </div>
        <div className="text-[10px] text-gray-2 leading-relaxed max-w-[210px] line-clamp-3">
          {imgStatus.description}
        </div>
      </div>
    );
  };

  if (variant === 'minimal') {
    const bubblePositionClass =
      desktopBubblePlacement === 'left'
        ? 'left-1/2 -translate-x-1/2 bottom-full mb-2.5 md:left-auto md:translate-x-0 md:right-[calc(100%+14px)] md:top-1/2 md:-translate-y-1/2 md:bottom-auto md:mb-0'
        : 'left-1/2 -translate-x-1/2 bottom-full mb-2.5';

    const tailPositionClass =
      desktopBubblePlacement === 'left'
        ? 'left-[28%] -bottom-[9px] border-r-2 border-b-2 md:left-auto md:-right-[9px] md:top-1/2 md:-translate-y-1/2 md:bottom-auto md:border-b-0 md:border-t-2 md:border-r-2'
        : 'left-[28%] -bottom-[9px] border-r-2 border-b-2';

    const bubbleWidthClass =
      desktopBubblePlacement === 'left'
        ? 'w-[min(290px,calc(100vw-48px))] md:w-[240px] lg:w-[290px]'
        : 'w-[min(290px,calc(100vw-48px))]';

    return (
      <div className="relative group flex flex-col items-center select-none overflow-visible">
        {isSpeaking && (
          <div
            onClick={(e) => { e.stopPropagation(); setIsSpeaking(false); }}
            className={`absolute ${bubblePositionClass} z-[99999] ${bubbleWidthClass} max-w-[300px] bg-white border-2 border-black p-3.5 sm:p-4 rounded-2xl shadow-2xl shadow-black/70 cursor-pointer animate-in fade-in zoom-in-95 duration-200 pointer-events-auto`}
            title="Натисніть, щоб закрити хмарку"
          >
            <div className="text-xs sm:text-[13px] text-black font-medium leading-relaxed">
              {currentPhrase}
            </div>
            <div className={`absolute ${tailPositionClass} w-4 h-4 bg-white border-black transform rotate-45 pointer-events-none`} />
          </div>
        )}

        <div
          onClick={handleCharacterClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCharacterClick();
            }
          }}
          className="relative cursor-pointer transition-transform duration-200 active:scale-95 w-full max-w-[240px] h-[168px] md:h-[220px] flex items-center justify-center pointer-events-auto"
          title="Натисніть, щоб відкрити фразу в хмарці"
        >
          {hasDisplayableImage ? (
            <img
              src={currentImage}
              alt={currentStageObj.name || `Етап ${currentStageObj.stage}`}
              referrerPolicy="no-referrer"
              onClick={handleCharacterClick}
              onLoad={() => {
                if (brokenImageUrl === currentImage) setBrokenImageUrl(null);
              }}
              onError={() => {
                setBrokenImageUrl(currentImage);
              }}
              className={`w-full h-full object-contain object-bottom opacity-100 transition-all duration-300 ${
                isSpeaking
                  ? 'scale-105 filter drop-shadow-[0_0_25px_rgba(194,255,82,0.45)]'
                  : 'hover:scale-105 filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.4)]'
              }`}
            />
          ) : (
            renderEmptyOrErrorState(true)
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative group flex flex-col items-center select-none overflow-visible">
      {isSpeaking && (
        <div
          onClick={(e) => { e.stopPropagation(); setIsSpeaking(false); }}
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 z-[99999] w-[min(280px,calc(100vw-48px))] max-w-[280px] bg-white border-2 border-black p-3.5 rounded-2xl shadow-2xl shadow-black/70 cursor-pointer animate-in fade-in zoom-in-95 duration-200 pointer-events-auto"
          title="Натисніть, щоб закрити хмарку"
        >
          <div className="text-xs text-black font-medium leading-relaxed">
            {currentPhrase}
          </div>
          <div className="absolute left-[28%] -bottom-[9px] w-4 h-4 bg-white border-r-2 border-b-2 border-black transform rotate-45 pointer-events-none" />
        </div>
      )}

      <div
        onClick={handleCharacterClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCharacterClick();
          }
        }}
        className="relative cursor-pointer overflow-hidden rounded-2xl border border-border-default bg-bg-1 shadow-xl hover:border-accent/50 transition-all duration-300 w-full max-w-[280px] h-[340px] flex items-center justify-center p-2"
        title="Натисніть, щоб отримати фразу в хмарці"
      >
        <div className="absolute top-3 left-3 z-10 bg-bg-2 border border-border-default px-2.5 py-1 rounded-full text-[11px] font-semibold text-accent flex items-center gap-1.5 shadow">
          <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
          <span>{currentStageObj.name || `Етап ${currentStageObj.stage}`}</span>
        </div>

        <div className="absolute top-3 right-3 z-10 bg-bg-2 border border-border-default px-2.5 py-1 rounded-full text-[11px] font-semibold text-gray-2">
          {progressPercent}%
        </div>

        {hasDisplayableImage ? (
          <img
            src={currentImage}
            alt={currentStageObj.name || `Етап ${currentStageObj.stage}`}
            referrerPolicy="no-referrer"
            onLoad={() => {
              if (brokenImageUrl === currentImage) setBrokenImageUrl(null);
            }}
            onError={() => {
              setBrokenImageUrl(currentImage);
            }}
            className={`w-full h-full object-contain object-bottom opacity-100 transition-transform duration-300 ${
              isSpeaking ? 'scale-105 filter drop-shadow-[0_0_20px_rgba(194,255,82,0.45)]' : 'group-hover:scale-102'
            }`}
          />
        ) : (
          renderEmptyOrErrorState(false)
        )}

        <div className="absolute bottom-2 inset-x-3 bg-bg-2 border border-border-default py-1.5 px-3 rounded-xl text-center text-[10px] text-gray-2 opacity-0 group-hover:opacity-100 transition-opacity">
          Натисніть для фрази в хмарці
        </div>
      </div>
    </div>
  );
};
