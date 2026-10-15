import React from 'react';
import { Phone, Mail, ChevronRight } from 'lucide-react';
import { getInitials } from '../../lib/utils';
import { PersonStatusBadge } from './PersonStatusBadge';
import type { Member } from '../../types';

interface PersonCardProps {
  member: Member & { cellName?: string };
  onSelect: () => void;
  canSeeContact: boolean;
}

export const PersonCard: React.FC<PersonCardProps> = ({ member, onSelect, canSeeContact }) => (
  <button
    type="button"
    onClick={onSelect}
    className="w-full text-left bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3 hover:border-york-300 dark:hover:border-york-700 hover:shadow-md transition-all active:scale-[0.99]"
  >
    {/* Avatar */}
    <div className="w-10 h-10 rounded-full bg-york-600 text-white flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
      {member.avatar_url ? (
        <img src={member.avatar_url} alt={member.full_name} className="w-full h-full object-cover" />
      ) : (
        getInitials(member.full_name)
      )}
    </div>

    {/* Info */}
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-sm text-gray-900 dark:text-slate-100 truncate">{member.full_name}</p>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        <PersonStatusBadge role={member.role} size="xs" />
        {member.cellName && (
          <span className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{member.cellName}</span>
        )}
      </div>
      {canSeeContact && (
        <div className="flex items-center gap-3 mt-1">
          {member.email && (
            <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 truncate">
              <Mail className="w-3 h-3 shrink-0" />{member.email}
            </span>
          )}
          {member.phone && (
            <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500">
              <Phone className="w-3 h-3 shrink-0" />{member.phone}
            </span>
          )}
        </div>
      )}
    </div>

    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-slate-600 shrink-0" />
  </button>
);
