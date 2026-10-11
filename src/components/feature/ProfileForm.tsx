import React, { useState, useRef } from 'react';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import type { UserProfile, ProfileUpdatePayload } from '../../hooks/useUserProfile';

interface ProfileFormProps {
  profile: UserProfile;
  saving: boolean;
  onSave: (payload: ProfileUpdatePayload) => Promise<void>;
  onCancel: () => void;
  onAvatarUpload: (file: File) => Promise<string>;
}

function validatePhone(phone: string): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 15) return 'Enter a valid phone number.';
  return undefined;
}

export const ProfileForm: React.FC<ProfileFormProps> = ({
  profile,
  saving,
  onSave,
  onCancel,
  onAvatarUpload,
}) => {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [studentNumber, setStudentNumber] = useState(profile.studentNumber ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (firstName.trim().length < 2) next['firstName'] = 'First name must be at least 2 characters.';
    if (lastName.trim().length < 2) next['lastName'] = 'Last name must be at least 2 characters.';
    const phoneErr = validatePhone(phone);
    if (phoneErr) next['phone'] = phoneErr;
    if (bio.length > 500) next['bio'] = 'Bio must be 500 characters or fewer.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const url = await onAvatarUpload(file);
      setAvatarUrl(url);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setGlobalError(null);
    try {
      await onSave({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone || undefined, bio: bio || undefined, avatarUrl: avatarUrl || undefined, studentNumber: studentNumber || undefined });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase() || profile.email[0].toUpperCase();

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {globalError && (
        <div className="bg-york-50 border border-york-200 rounded-md px-4 py-3 text-sm text-york-700">
          {globalError}
        </div>
      )}

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-full bg-york-600 text-white flex items-center justify-center text-xl font-bold shrink-0 overflow-hidden cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div>
          <button
            type="button"
            className="text-sm font-semibold text-york-600 hover:text-york-700"
            onClick={() => fileRef.current?.click()}
            disabled={avatarUploading}
          >
            {avatarUploading ? 'Uploading…' : 'Change photo'}
          </button>
          <p className="text-xs text-gray-400 mt-0.5">JPG or PNG, max 5 MB</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="First Name"
          value={firstName}
          onChange={setFirstName}
          error={errors['firstName']}
          required
        />
        <Input
          label="Last Name"
          value={lastName}
          onChange={setLastName}
          error={errors['lastName']}
          required
        />
      </div>

      <Input
        label="Email"
        type="email"
        value={profile.email}
        onChange={() => {}}
        readOnly
        helpText="Email is managed through your account settings."
      />

      <Input
        label="Phone"
        type="tel"
        value={phone}
        onChange={setPhone}
        error={errors['phone']}
        placeholder="+1 (416) 555-0100"
      />

      <Input
        label="Student Number"
        value={studentNumber}
        onChange={setStudentNumber}
        placeholder="e.g. 218 456 789"
        helpText="Optional — your York University student ID."
      />

      <Input
        label="Bio"
        type="textarea"
        value={bio}
        onChange={setBio}
        error={errors['bio']}
        maxLength={500}
        placeholder="A short bio about yourself…"
      />

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={saving} disabled={avatarUploading}>
          Save Changes
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
