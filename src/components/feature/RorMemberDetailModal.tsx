import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { RorStreakBadge } from './RorStreakBadge';
import { RorCalendar } from './RorCalendar';
import { fetchMemberReadDates, fetchRorStreak } from '../../lib/queries/rorStreaks';
import type { CellMemberRorRow, RorStreak } from '../../lib/queries/rorStreaks';

interface Props {
  member: CellMemberRorRow;
  devotionalId: string | null;
  devotionalTotalDays: number;
  devotionalMonth: number;
  devotionalYear: number;
  onClose: () => void;
}

export const RorMemberDetailModal: React.FC<Props> = ({
  member, devotionalId, devotionalTotalDays, devotionalMonth, devotionalYear, onClose,
}) => {
  const [streak, setStreak] = useState<RorStreak | null>(null);
  const [readDates, setReadDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const monthYear = `${devotionalYear}-${String(devotionalMonth).padStart(2, '0')}`;

    Promise.all([
      fetchRorStreak(member.member_id, today, monthYear),
      devotionalId ? fetchMemberReadDates(member.member_id, devotionalId) : Promise.resolve([]),
    ]).then(([s, d]) => {
      if (mounted) { setStreak(s); setReadDates(d); setLoading(false); }
    }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [member.member_id, devotionalId, devotionalMonth, devotionalYear]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reading progress for ${member.full_name}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">{member.full_name}</h2>
            {member.cell_name && (
              <p className="text-xs text-gray-500 dark:text-slate-400">{member.cell_name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-7 h-7 border-3 border-york-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : streak ? (
            <>
              <RorStreakBadge streak={streak} />
              {devotionalId && (
                <RorCalendar
                  totalDays={devotionalTotalDays}
                  readDates={readDates}
                  month={devotionalMonth}
                  year={devotionalYear}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">No reading data available.</p>
          )}
          <p className="text-xs text-gray-400 dark:text-slate-500 text-center">
            This data is read-only. You cannot modify another member's reading records.
          </p>
        </div>
      </div>
    </div>
  );
};
