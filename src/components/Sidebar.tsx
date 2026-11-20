import React, { useEffect } from 'react';
import { LayoutDashboard, Timer, Calendar, History, BarChart3, Award, Users, Settings, X, Coins, ListChecks, Sliders } from 'lucide-react';
import { SyncState } from '../types';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  syncState: SyncState;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  syncState,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Головна', icon: LayoutDashboard },
    { id: 'timer', label: 'Таймер', icon: Timer },
    { id: 'calendar', label: 'Календар', icon: Calendar },
    { id: 'history', label: 'Історія', icon: History },
    { id: 'analytics', label: 'Аналітика', icon: BarChart3 },
    { id: 'team', label: 'Оцінка команди', icon: Users },
    { id: 'bonuses', label: 'Бонуси', icon: Award },
    { id: 'points-team', label: 'Бали команди', icon: Coins },
    { id: 'points-reasons', label: 'Причини балів', icon: ListChecks },
    { id: 'points-settings', label: 'Налаштування балів', icon: Sliders },
    { id: 'settings', label: 'Налаштування', icon: Settings },
  ];

  useEffect(() => {
    if (!isMobileOpen || !onCloseMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  const handleNavClick = (tabId: string) => {
    onSelectTab(tabId);
    onCloseMobile?.();
  };

  const renderSidebarContent = (showCloseButton: boolean) => (
    <>
      {/* Brand / Logo */}
      <div className="p-5 border-b border-border-default flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center font-bold text-bg-1 shadow-lg shadow-accent/20 shrink-0">
            A
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-fg tracking-wide text-sm flex items-center gap-1.5">
              <span>Allonsy</span>
              <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded font-normal">PRO</span>
            </div>
            <div className="text-xs text-gray-2 truncate">Облік часу</div>
          </div>
        </div>

        {showCloseButton && onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Закрити меню навігації"
            className="w-9 h-9 rounded-xl bg-bg-1 border border-border-default flex items-center justify-center text-gray-2 hover:text-fg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-medium tracking-wider text-gray-1 uppercase">
          Навігація
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-accent text-bg-1 shadow-lg shadow-accent/20 font-semibold'
                  : 'text-gray-2 hover:text-fg hover:bg-bg-1'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-bg-1' : 'text-gray-2'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Shared Connection Status Footer */}
      <div className="p-4 border-t border-border-default bg-bg-1/70">
        <div className="flex items-start gap-2.5 text-xs">
          {syncState.status === 'local_preview' && (
            <>
              <div className="w-2 h-2 rounded-full bg-gray-1 mt-1 shrink-0" />
              <div className="flex-1 min-w-0 text-[11px]">
                <div className="font-semibold text-gray-2">Локальний режим (Preview)</div>
                <div className="text-[10px] text-gray-1 leading-tight mt-0.5">
                  Додайте URL власної вебпрограми Apps Script у Налаштуваннях, щоб підключити свою Google Таблицю.
                </div>
              </div>
            </>
          )}

          {syncState.status === 'disconnected' && (
            <>
              <div className="w-2 h-2 rounded-full bg-gray-1 mt-1 shrink-0" />
              <div className="flex-1 min-w-0 text-[11px]">
                <div className="font-semibold text-gray-2">GAS • Не підключено</div>
                <div className="text-[10px] text-gray-1 leading-tight mt-0.5">
                  Скрипт повинен бути прив’язаний до копії шаблону таблиці.
                </div>
              </div>
            </>
          )}

          {syncState.status === 'unverified' && (
            <>
              <div className="w-2 h-2 rounded-full bg-amber-400 mt-1 shrink-0 animate-pulse" />
              <div className="flex-1 min-w-0 text-[11px]">
                <div className="font-semibold text-amber-400">GAS • Підключення...</div>
                <div className="text-[10px] text-gray-2 leading-tight mt-0.5">
                  Завантаження даних із прив’язаної Google Таблиці.
                </div>
              </div>
            </>
          )}

          {syncState.status === 'connected' && (
            <>
              <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />
              <div className="flex-1 min-w-0 text-[11px]">
                <div className="font-semibold text-emerald-400">GAS • Підключено</div>
                <div className="text-[10px] text-gray-2 leading-tight mt-0.5 truncate" title={syncState.spreadsheetName || ''}>
                  {syncState.spreadsheetName || 'Власна Google Таблиця'} (google.script.run)
                </div>
              </div>
            </>
          )}

          {syncState.status === 'error' && (
            <>
              <div className="w-2 h-2 rounded-full bg-danger mt-1 shrink-0" />
              <div className="flex-1 min-w-0 text-[11px]">
                <div className="font-semibold text-danger">Помилка доступу</div>
                <div className="text-[10px] text-gray-2 leading-tight mt-0.5 line-clamp-2" title={syncState.errorMessage || ''}>
                  {syncState.errorMessage || 'Перевірте прив’язку до таблиці та права доступу.'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex w-64 bg-bg-2 border-r border-border-default flex-col shrink-0 select-none">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile & Tablet Slide-Over Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            onClick={onCloseMobile}
            aria-hidden="true"
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Меню навігації"
            className="relative z-10 w-72 max-w-[85vw] h-full bg-bg-2 border-r border-border-default flex flex-col select-none shadow-2xl"
          >
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}
    </>
  );
};
