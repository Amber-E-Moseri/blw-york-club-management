import React from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO } from 'date-fns';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { DashboardCard, Skeleton } from './DashboardCard';
import type { AttentionContact } from '../../hooks/useDashboardStats';

interface NeedsAttentionProps {
  contacts: AttentionContact[];
  loading: boolean;
}

function daysLabel(dateContacted: string): { text: string; urgent: boolean } {
  const days = differenceInDays(new Date(), parseISO(dateContacted));
  if (days === 0) return { text: 'Contacted today', urgent: false };
  if (days === 1) return { text: '1 day ago', urgent: false };
  if (days <= 3) return { text: `${days} days ago`, urgent: false };
  return { text: `${days} days ago`, urgent: true };
}

export const NeedsAttention: React.FC<NeedsAttentionProps> = ({ contacts, loading }) => {
  const navigate = useNavigate();

  return (
    <DashboardCard
      title="Needs Attention"
      action={{ label: 'Open CRM', onClick: () => navigate('/contacts') }}
      noPadding
    >
      {loading ? (
        <div className="px-5 py-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="px-5 py-6 flex flex-col items-center text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">You're caught up</p>
          <p className="text-xs text-gray-400 dark:text-slate-500">No follow-ups currently need attention.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {contacts.map((contact) => {
            const { text, urgent } = daysLabel(contact.date_contacted);
            return (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => navigate('/contacts')}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-left group"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${urgent ? 'bg-york-100 text-york-700 dark:bg-york-900/30 dark:text-york-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {contact.contact_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">
                      {contact.contact_name}
                    </p>
                    <p className={`text-xs ${urgent ? 'text-york-600 dark:text-york-400 font-medium' : 'text-gray-400 dark:text-slate-500'}`}>
                      {text} · {contact.follow_up_status}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-york-600 transition-colors shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
};
