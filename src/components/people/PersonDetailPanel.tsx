import React, { useEffect, useState } from 'react';
import { X, Mail, Phone, Calendar, Building2, ExternalLink, Edit3, AlertCircle, CheckCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useUserProfile } from '../../hooks/useUserProfile';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import { PersonStatusBadge } from './PersonStatusBadge';
import type { AuthUser } from '../../lib/auth';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface PersonDetailPanelProps {
  memberId: string | null;
  onClose: () => void;
  currentUser: AuthUser;
  onSaved?: () => void;
}

function maskPhone(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `•••-•••-${digits.slice(-4)}`;
}

function safeFormat(dateStr?: string): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'MMMM yyyy'); } catch { return dateStr; }
}

export const PersonDetailPanel: React.FC<PersonDetailPanelProps> = ({
  memberId, onClose, currentUser, onSaved,
}) => {
  const { profile, loading, saving, error, notFound, updateProfile } = useUserProfile(memberId ?? undefined);
  const level = ROLE_LEVEL[currentUser.role] ?? 0;
  const isAdmin = level >= 2;
  const isCoordinator = currentUser.role === 'coordinator';
  const isOwnProfile = memberId === currentUser.id;
  const canEdit = isCoordinator || isOwnProfile;
  const [editing, setEditing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (editing) setEditing(false);
        else onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, onClose]);

  useEffect(() => {
    setEditing(false);
    setSuccess(null);
  }, [memberId]);

  if (!memberId) return null;

  const displayName = profile
    ? profile.fullName || `${profile.firstName} ${profile.lastName}`.trim() || profile.email
    : '…';
  const initials = profile
    ? `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase() || profile.email[0]?.toUpperCase()
    : '?';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 dark:bg-black/50 z-40 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-profile-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 dark:border-slate-700">
          <h2 id="member-profile-title" className="text-sm font-bold text-gray-900 dark:text-slate-100">Member profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Close member profile"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-xs text-center">
              <AlertCircle className="w-8 h-8 text-york-600 mx-auto mb-3" aria-hidden="true" />
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Profile could not be loaded.</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{error}</p>
            </div>
          </div>
        ) : notFound || !profile ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-xs text-center">
              <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">Profile not found.</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                No visible member profile exists for this directory entry.
              </p>
            </div>
          </div>
        ) : editing ? (
          <ProfileEditForm
            profile={profile}
            saving={saving}
            canEditPersonalDetails={isOwnProfile}
            onCancel={() => setEditing(false)}
            onSave={async (payload) => {
              await updateProfile(payload);
              setEditing(false);
              setSuccess('Profile saved.');
              onSaved?.();
            }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Avatar + name */}
            <div className="px-5 pt-6 pb-5 border-b border-gray-100 dark:border-slate-700">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-full bg-york-600 text-white flex items-center justify-center text-xl font-bold shrink-0 overflow-hidden">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900 dark:text-slate-100 truncate">{displayName}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <PersonStatusBadge role={profile.role} size="xs" />
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300 capitalize">
                      {profile.status}
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="text-xs text-gray-400 dark:text-slate-500">
                      Joined {safeFormat(profile.joinedAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              {(isAdmin || isOwnProfile) && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {profile.email && (
                    <a
                      href={`mailto:${profile.email}`}
                      className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-york-600 dark:text-york-400 border border-york-200 dark:border-york-800 rounded-lg hover:bg-york-50 dark:hover:bg-york-900/20 transition-colors"
                    >
                      <Mail className="w-3.5 h-3.5" /> Email
                    </a>
                  )}
                  {profile.phone && isAdmin && (
                    <a
                      href={`tel:${profile.phone}`}
                      className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                  )}
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      icon={<Edit3 className="w-3.5 h-3.5" />}
                      onClick={() => { setSuccess(null); setEditing(true); }}
                    >
                      Edit profile
                    </Button>
                  )}
                </div>
              )}
              {success && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
                  <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  {success}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="px-5 py-4 space-y-4">
              {/* Contact info */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Contact</p>
                <div className="space-y-2">
                  <Detail icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={profile.email} />
                  {isAdmin ? (
                    <Detail icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={profile.phone || '—'} />
                  ) : profile.phone ? (
                    <Detail icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={maskPhone(profile.phone)} />
                  ) : null}
                </div>
              </section>

              {/* Ministry info */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Ministry</p>
                <div className="space-y-2">
                  {profile.cellName && (
                    <Detail icon={<Building2 className="w-3.5 h-3.5" />} label="Cell" value={profile.cellName} />
                  )}
                  <Detail icon={<Building2 className="w-3.5 h-3.5" />} label="Role" value={profile.role.replace('_', ' ')} />
                  <Detail icon={<Building2 className="w-3.5 h-3.5" />} label="Status" value={profile.status} />
                  <Detail icon={<Calendar className="w-3.5 h-3.5" />} label="Joined" value={safeFormat(profile.joinedAt)} />
                  {isAdmin && profile.studentNumber && (
                    <Detail icon={<ExternalLink className="w-3.5 h-3.5" />} label="Student #" value={profile.studentNumber} />
                  )}
                </div>
              </section>

              {/* Bio */}
              {profile.bio && (
                <section>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">About</p>
                  <p className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed">{profile.bio}</p>
                </section>
              )}

              {/* Outreach bridge — admin only, non-self */}
              {isAdmin && !isOwnProfile && (
                <section className="pt-2 border-t border-gray-100 dark:border-slate-700">
                  <a
                    href="/contacts"
                    className="flex items-center gap-2 text-xs font-semibold text-york-600 dark:text-york-400 hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View outreach records
                  </a>
                </section>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

const Detail: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2">
    <span className="w-4 h-4 mt-0.5 text-gray-300 dark:text-slate-600 shrink-0">{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] text-gray-400 dark:text-slate-500 font-medium">{label}</p>
      <p className="text-sm text-gray-800 dark:text-slate-200 break-words">{value}</p>
    </div>
  </div>
);

interface ProfileEditFormProps {
  profile: NonNullable<ReturnType<typeof useUserProfile>['profile']>;
  saving: boolean;
  canEditPersonalDetails: boolean;
  onSave: (payload: {
    firstName: string;
    lastName: string;
    phone?: string;
    bio?: string;
    studentNumber?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

const ProfileEditForm: React.FC<ProfileEditFormProps> = ({
  profile,
  saving,
  canEditPersonalDetails,
  onSave,
  onCancel,
}) => {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [studentNumber, setStudentNumber] = useState(profile.studentNumber ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (firstName.trim().length < 2) next['firstName'] = 'First name must be at least 2 characters.';
    if (lastName.trim().length < 2) next['lastName'] = 'Last name must be at least 2 characters.';
    const digits = phone.replace(/\D/g, '');
    if (phone && (digits.length < 10 || digits.length > 15)) next['phone'] = 'Enter a valid phone number.';
    if (bio.length > 500) next['bio'] = 'Bio must be 500 characters or fewer.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setSaveError(null);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        studentNumber: studentNumber.trim() || undefined,
        bio: bio.trim() || undefined,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
      {saveError && (
        <div className="rounded-lg border border-york-200 bg-york-50 px-3 py-2 text-sm text-york-700">
          {saveError}
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Edit profile</p>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
          Role, status, cell, and account email are managed separately.
          {!canEditPersonalDetails ? ' Phone and bio are self-managed fields under current permissions.' : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="First name" value={firstName} onChange={setFirstName} error={errors['firstName']} required />
        <Input label="Last name" value={lastName} onChange={setLastName} error={errors['lastName']} required />
      </div>

      <Input label="Email" type="email" value={profile.email} onChange={() => {}} readOnly />
      <Input
        label="Phone"
        type="tel"
        value={phone}
        onChange={setPhone}
        error={errors['phone']}
        placeholder="+1 (416) 555-0100"
        disabled={!canEditPersonalDetails}
      />
      <Input label="Student number" value={studentNumber} onChange={setStudentNumber} placeholder="e.g. 218 456 789" />
      <Input
        label="Bio"
        type="textarea"
        value={bio}
        onChange={setBio}
        error={errors['bio']}
        maxLength={500}
        rows={4}
        disabled={!canEditPersonalDetails}
      />

      <div className="rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <ReadOnlyField label="Role" value={profile.role.replace('_', ' ')} />
          <ReadOnlyField label="Status" value={profile.status} />
          <ReadOnlyField label="Cell" value={profile.cellName ?? '—'} />
          <ReadOnlyField label="Joined" value={safeFormat(profile.joinedAt)} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Button type="submit" loading={saving} disabled={saving} fullWidth>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving} fullWidth>
          Cancel
        </Button>
      </div>
    </form>
  );
};

const ReadOnlyField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="mt-1 capitalize text-gray-700 dark:text-slate-200">{value}</p>
  </div>
);
