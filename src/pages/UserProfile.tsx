import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '../components/foundation/Badge';
import { ProfileForm } from '../components/feature/ProfileForm';
import { PushNotificationSettings } from '../components/feature/PushNotificationSettings';
import { useUserProfile } from '../hooks/useUserProfile';
import type { AuthUser } from '../lib/auth';

interface UserProfileProps {
  currentUser: AuthUser | null;
  viewUserId?: string;
}

function maskPhone(phone?: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `•••-•••-${digits.slice(-4)}`;
}

function roleBadgeVariant(role: AuthUser['role']): 'primary' | 'info' | 'gray' | 'success' {
  if (role === 'coordinator') return 'primary';
  if (role === 'admin') return 'info';
  if (role === 'cell_leader') return 'success';
  return 'gray';
}

const ROLE_LABELS: Record<AuthUser['role'], string> = {
  coordinator: 'Coordinator',
  admin: 'Admin',
  cell_leader: 'Cell Leader',
  member: 'Member',
};

export const UserProfile: React.FC<UserProfileProps> = ({ currentUser, viewUserId }) => {
  const targetId = viewUserId ?? currentUser?.id;
  const isOwnProfile = !viewUserId || viewUserId === currentUser?.id;
  const [editing, setEditing] = useState(false);

  const { profile, loading, saving, error, notFound, updateProfile, uploadAvatar } = useUserProfile(targetId);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-york-600 font-medium">{error}</p>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-gray-400">Profile not found.</p>
      </div>
    );
  }

  const displayName =
    profile.firstName || profile.lastName
      ? `${profile.firstName} ${profile.lastName}`.trim()
      : profile.email;

  const initials =
    `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase() ||
    profile.email[0].toUpperCase();

  const joinedFormatted = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long' })
    : '—';

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-york-600">Account</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
          {isOwnProfile ? 'Profile' : 'Member profile'}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Your details and notification settings.</p>
      </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {editing ? (
            <ProfileForm
              profile={profile}
              saving={saving}
              onSave={async (payload) => {
                await updateProfile(payload);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              onAvatarUpload={uploadAvatar}
            />
          ) : (
            <>
              {/* Identity */}
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-full bg-york-600 text-white flex items-center justify-center text-2xl font-bold overflow-hidden">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <h2 className="mt-3 text-xl font-bold text-gray-900 dark:text-slate-100 break-words max-w-full">{displayName}</h2>
                {profile.role && (
                  <Badge variant={roleBadgeVariant(profile.role)} className="mt-2">
                    {ROLE_LABELS[profile.role]}
                  </Badge>
                )}
              </div>

              {isOwnProfile && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="mt-5 flex w-full h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                  Edit profile
                </button>
              )}

              {/* Details */}
              <dl className="mt-5 divide-y divide-gray-100 dark:divide-slate-700">
                <Row label="Email" value={profile.email} />
                <Row label="Phone" value={maskPhone(profile.phone)} />
                {profile.studentNumber && (
                  <Row label="Student #" value={profile.studentNumber} />
                )}
                {profile.cellName && <Row label="Cell" value={profile.cellName} />}
                <Row label="Joined" value={joinedFormatted} />
              </dl>

              {profile.bio && (
                <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-700">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">About</p>
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-slate-300">{profile.bio}</p>
                </div>
              )}
            </>
          )}
        </div>

      {isOwnProfile && (
        <PushNotificationSettings userId={currentUser?.id} />
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center gap-3 py-3">
    <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-slate-400">{label}</dt>
    <dd className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-slate-100">{value}</dd>
  </div>
);
