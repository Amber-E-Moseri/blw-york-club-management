import React from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { X } from 'lucide-react';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, install, dismiss } = usePWAInstall();

  if (!isInstallable) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4 sm:p-0 sm:bottom-4 sm:right-4 sm:left-auto">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg p-4 flex items-start gap-3 max-w-sm">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden">
          <img src="/logo.png" alt="BLW York" className="w-full h-full" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 dark:text-slate-100">Add to Home Screen</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Install BLW York Hub for quick access and offline use.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={install}
              className="px-3 py-1.5 bg-york-600 text-white text-xs font-semibold rounded-md hover:bg-york-700 transition-colors"
            >
              Install
            </button>
            <button
              onClick={dismiss}
              className="px-3 py-1.5 text-gray-500 dark:text-slate-400 text-xs font-medium hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
