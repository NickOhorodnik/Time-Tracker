import React from 'react';
import { RefreshCw, Bell, AlertCircle, CloudOff, CheckCircle2, Menu, Eye } from 'lucide-react';
import { SyncState } from '../types';
import { api } from '../services/api';

interface HeaderProps {
  onSync: () => void;
  onRefreshSheet?: () => void;
  isSyncing: boolean;
  syncState: SyncState;
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSync,
  onRefreshSheet,
  isSyncing,
  syncState,
  onOpenMobileMenu,
}) => {
  const isGasHosted = syncState.runtimeMode === 'gas_hosted';
  const isReadOnly = Boolean(syncState.isReadOnly);
  const canSyncInGas = isGasHosted;
  const remoteDisabled = isSyncing || !canSyncInGas;
  const handleActionClick = isReadOnly ? (onRefreshSheet || onSync) : onSync;

  return (
    <header className="h-14 sm:h-16 bg-bg-2 border-b border-border-default px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0 select-none">
      <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Відкрити меню навігації"
            className="lg:hidden w-10 h-10 rounded-xl bg-bg-1 border border-border-default flex items-center justify-center text-fg hover:border-accent transition-colors cursor-pointer shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-semibold text-fg tracking-wide truncate">
            {isReadOnly ? 'Режим перегляду Allonsy' : 'Вітаю, Повелитель'}
          </h1>
          <p className="text-[11px] sm:text-xs text-gray-2 truncate">
            {new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {isReadOnly && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/30 text-[11px] text-accent font-semibold">
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <span>Лише перегляд</span>
          </div>
        )}

        {/* Single Source of Truth: Shared Connection Status Indicator */}
        {syncState.status === 'local_preview' && (
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-1 border border-border-default text-[11px] text-gray-2 font-medium"
            title={api.getIntegrationInfo().reason}
          >
            <CloudOff className="w-3.5 h-3.5 text-gray-1" />
            <span>Локальний режим (AI Studio Preview)</span>
          </div>
        )}

        {syncState.status === 'disconnected' && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-1 border border-border-default text-[11px] text-gray-2 font-medium">
            <CloudOff className="w-3.5 h-3.5 text-gray-1" />
            <span>Прив'язана таблиця недоступна</span>
          </div>
        )}

        {syncState.status === 'unverified' && (
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-1 border border-amber-500/30 text-[11px] text-amber-400 font-medium"
            title="Очікується відповідь від Google Таблиці."
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            <span>{isReadOnly ? 'Завантаження таблиці...' : 'GAS • Підключення до таблиці...'}</span>
          </div>
        )}

        {syncState.status === 'connected' && (
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-1 border border-emerald-500/30 text-[11px] text-emerald-400 font-medium"
            title={
              isReadOnly
                ? `Відкрито лише для перегляду: «${syncState.spreadsheetName || syncState.spreadsheetId || 'Google Sheets'}»`
                : `Підключено до таблиці «${syncState.spreadsheetName || 'Google Sheets'}»`
            }
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {isReadOnly ? 'Таблиця' : 'Підключено'}: {syncState.spreadsheetName || syncState.spreadsheetId || 'Google Sheets'}
            </span>
          </div>
        )}

        {syncState.status === 'error' && (
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-1 border border-danger/30 text-[11px] text-danger font-medium cursor-help"
            title={syncState.errorMessage || 'Помилка доступу до Google Таблиці'}
          >
            <AlertCircle className="w-3.5 h-3.5 text-danger" />
            <span>Помилка доступу до таблиці</span>
          </div>
        )}

        {/* Sync or Refresh Button */}
        <button
          type="button"
          onClick={handleActionClick}
          disabled={remoteDisabled}
          aria-label={isReadOnly ? 'Оновити дані з таблиці' : isSyncing ? 'Синхронізація' : 'Синхронізувати'}
          className="flex items-center justify-center gap-2 bg-bg-1 hover:bg-border-default border border-border-default text-fg h-9 sm:h-auto px-2.5 sm:px-3.5 sm:py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          title={
            !isGasHosted
              ? api.getIntegrationInfo().reason
              : isReadOnly
              ? 'Оновити дані з таблиці (без внесення змін)'
              : 'Синхронізувати структуровані дані з Google Таблицею'
          }
        >
          <RefreshCw className={`w-3.5 h-3.5 text-accent ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">
            {isReadOnly
              ? isSyncing
                ? 'Оновлення...'
                : 'Оновити дані'
              : isSyncing
              ? 'Синхронізація...'
              : 'Синхронізувати'}
          </span>
        </button>

        {/* Notifications */}
        <button
          type="button"
          aria-label="Сповіщення"
          className="w-9 h-9 rounded-lg bg-bg-1 border border-border-default flex items-center justify-center text-gray-2 hover:text-fg transition-colors relative shrink-0"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent"></span>
        </button>

        {/* User Avatar */}
        <div className="w-9 h-9 rounded-xl bg-accent p-0.5 shadow-md shrink-0">
          <div className="w-full h-full bg-bg-1 rounded-[10px] flex items-center justify-center font-bold text-fg text-xs">
            {isReadOnly ? 'ГІ' : 'КО'}
          </div>
        </div>
      </div>
    </header>
  );
};
