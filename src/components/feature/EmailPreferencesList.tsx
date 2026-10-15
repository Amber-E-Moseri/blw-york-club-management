import React from 'react';
import { CalendarDays, Bell, MessageSquare, Megaphone, Flame, BookMarked, Sparkles, BarChart2, type LucideIcon } from 'lucide-react';
import type { EmailPreferencesInput } from '../../types';

interface PreferenceItem {
  key: keyof EmailPreferencesInput;
  label: string;
  description: string;
  icon: LucideIcon;
}

const PREFERENCE_GROUPS: Array<{ title: string; items: PreferenceItem[] }> = [
  {
    title: 'MEETINGS',
    items: [
      { key: 'meeting_reminders_8am', label: 'Meeting reminders (8 AM)',        description: 'Sent on the morning of each meeting day',                       icon: CalendarDays },
      { key: 'meeting_reminders_1hr', label: 'Meeting reminders (1 hour before)', description: 'Sent one hour before each meeting starts',                    icon: Bell },
    ],
  },
  {
    title: 'MESSAGES & CONTENT',
    items: [
      { key: 'message_notifications', label: 'Messages of the Week',            description: 'New message or weekly word notifications',                      icon: MessageSquare },
      { key: 'admin_announcements',   label: 'Administrative announcements',    description: 'Important updates from club leadership',                        icon: Megaphone },
    ],
  },
  {
    title: 'PERSONAL TRACKING',
    items: [
      { key: 'habit_milestones',      label: 'Habit streak milestones',         description: 'Celebrate 7, 14, 30, 60 and 90-day streaks',                   icon: Flame },
      { key: 'devotional_reminders',  label: 'Missing devotional reminders',    description: "A gentle nudge at 6 PM if today's devotional isn't read",      icon: BookMarked },
      { key: 'testimony_approved',    label: 'Testimony approved notifications', description: 'Notified when your testimony goes live',                       icon: Sparkles },
    ],
  },
  {
    title: 'DIGEST',
    items: [
      { key: 'weekly_digest',         label: 'Weekly digest email',             description: "Sunday summary of the week's activities (off by default)",     icon: BarChart2 },
    ],
  },
];

interface Props {
  preferences: EmailPreferencesInput;
  onChange: (key: keyof EmailPreferencesInput, value: boolean) => void;
  disabled?: boolean;
}

export const EmailPreferencesList: React.FC<Props> = ({ preferences, onChange, disabled }) => {
  return (
    <div className="space-y-6">
      {PREFERENCE_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="text-xs font-bold text-gray-400 tracking-widest mb-3">{group.title}</p>
          <div className="space-y-2">
            {group.items.map((item) => (
              <label
                key={item.key}
                className={`flex items-start gap-4 p-4 rounded-lg border border-gray-100 bg-white cursor-pointer transition-colors dark:bg-slate-800 dark:border-slate-700 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-york-200 hover:bg-red-50 dark:hover:bg-slate-700'}`}
              >
                <item.icon className="w-5 h-5 mt-0.5 shrink-0 text-york-600 dark:text-york-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{item.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                </div>
                <div className="shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={!!preferences[item.key]}
                    onChange={(e) => onChange(item.key, e.target.checked)}
                    disabled={disabled}
                    className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-500"
                  />
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
