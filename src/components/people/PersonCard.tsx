import React from 'react';
import { Mail, ChevronRight } from 'lucide-react';
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
    className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
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
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <PersonStatusBadge role={member.role} />
        {member.cellName && (
          <span className="text-sm text-gray-500 dark:text-slate-400 truncate">{member.cellName}</span>
        )}
      </div>
      {canSeeContact && member.email && (
        <span className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-slate-400 truncate">
          <Mail className="w-3.5 h-3.5 shrink-0" />{member.email}
        </span>
      )}
      {canSeeContact && member.phone && (
        <p className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">{member.phone}</p>
      )}
    </div>

    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-slate-600 shrink-0" />
  </button>
);
