import React, { useState } from 'react';
import { Card } from '../components/foundation/Card';
import { Button } from '../components/foundation/Button';
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
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-h1">{isOwnProfile ? 'My Profile' : 'Member Profile'}</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Card>
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
              {/* Header row */}
              <div className="flex items-start gap-5 mb-6">
                <div className="w-20 h-20 rounded-full bg-york-600 text-white flex items-center justify-center text-2xl font-bold shrink-0 overflow-hidden">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-h2 truncate">{displayName}</h2>
                  {profile.role && (
                    <Badge variant={roleBadgeVariant(profile.role)} className="mt-1">
                      {ROLE_LABELS[profile.role]}
                    </Badge>
                  )}
                </div>
                {isOwnProfile && (
                  <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
              </div>

              {/* Details */}
              <dl className="space-y-3 text-small">
                <Row label="Email" value={profile.email} />
                <Row label="Phone" value={maskPhone(profile.phone)} />
                {profile.studentNumber && (
                  <Row label="Student #" value={profile.studentNumber} />
                )}
                {profile.cellName && <Row label="Cell" value={profile.cellName} />}
                <Row label="Joined" value={joinedFormatted} />
              </dl>

              {profile.bio && (
                <div className="mt-5 pt-5 border-t border-gray-100">
                  <p className="text-tiny font-semibold text-gray-400 uppercase tracking-wider mb-2">About</p>
                  <p className="text-small text-gray-600">{profile.bio}</p>
                </div>
              )}
            </>
          )}
        </Card>

        {isOwnProfile && (
          <PushNotificationSettings userId={currentUser?.id} />
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex gap-2">
    <dt className="font-semibold text-gray-400 w-24 shrink-0">{label}</dt>
    <dd className="text-gray-900">{value}</dd>
  </div>
);
