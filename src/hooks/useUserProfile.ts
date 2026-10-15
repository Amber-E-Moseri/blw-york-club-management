import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  userId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'coordinator' | 'admin' | 'cell_leader' | 'member';
  status: 'pending' | 'active' | 'inactive' | 'rejected';
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  studentNumber?: string;
  cellId?: string;
  cellName?: string;
  joinedAt: string;
}

export interface ProfileUpdatePayload {
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  studentNumber?: string;
}

interface UseUserProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
  updateProfile: (payload: ProfileUpdatePayload) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export function useUserProfile(userId: string | undefined): UseUserProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setProfile(null);
      setNotFound(false);
      return;
    }
    const targetUserId = userId;
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      setNotFound(false);
      setProfile(null);

      try {
        const { data: base, error: baseErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, role, status, joined_at, cell_id, student_number')
          .eq('id', targetUserId)
          .maybeSingle();

        if (baseErr) throw new Error(baseErr.message);
        if (!base) {
          if (!cancelled) setNotFound(true);
          return;
        }

        const { data: extra, error: extraErr } = await supabase
          .from('user_profiles')
          .select('first_name, last_name, phone, avatar_url, bio, student_number, created_at')
          .eq('user_id', targetUserId)
          .maybeSingle();

        if (extraErr && extraErr.code !== 'PGRST116') throw new Error(extraErr.message);

        let cellName: string | undefined;
        if (base.cell_id) {
          const { data: cell, error: cellErr } = await supabase
            .from('cells')
            .select('name')
            .eq('id', base.cell_id)
            .maybeSingle();
          if (cellErr) throw new Error(cellErr.message);
          cellName = cell?.name;
        }

        const fullName = (base.full_name as string | null) ?? '';
        const fallbackName = splitName(fullName);
        const firstName = (extra?.first_name as string | null) || fallbackName.firstName;
        const lastName = (extra?.last_name as string | null) || fallbackName.lastName;

        if (!cancelled) {
          setProfile({
            userId: targetUserId,
            fullName,
            firstName,
            lastName,
            email: (base.email as string | null) ?? '',
            role: base.role as UserProfile['role'],
            status: base.status as UserProfile['status'],
            phone: extra?.phone as string | undefined,
            avatarUrl: (extra?.avatar_url as string | undefined) ?? (base.avatar_url as string | undefined),
            bio: extra?.bio as string | undefined,
            studentNumber:
              (extra?.student_number as string | undefined) ?? (base.student_number as string | undefined),
            cellId: base.cell_id as string | undefined,
            cellName,
            joinedAt: (base.joined_at as string | undefined) ?? (extra?.created_at as string | undefined) ?? '',
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Profile could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();
    return () => { cancelled = true; };
  }, [userId, tick]);

  const updateProfile = useCallback(
    async (payload: ProfileUpdatePayload) => {
      if (!userId) return;
      setSaving(true);
      setError(null);
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw new Error(authErr.message);
        const actorId = authData.user?.id;
        if (!actorId) throw new Error('Not authenticated.');

        const { data: actorProfile, error: actorErr } = await supabase
          .from('profiles')
          .select('role, status')
          .eq('id', actorId)
          .maybeSingle();
        if (actorErr) throw new Error(actorErr.message);
        const isOwnProfile = actorId === userId;
        const isCoordinator = actorProfile?.role === 'coordinator';
        const actorIsActive = actorProfile?.status === 'active';
        const actorIsPending = actorProfile?.status === 'pending';
        if (!actorIsActive && !(isOwnProfile && actorIsPending)) {
          throw new Error('Profile editing requires an active account, except pending members may update their own onboarding details.');
        }
        if (!isOwnProfile && !isCoordinator) {
          throw new Error('Not authorised to edit this profile.');
        }

        const fullName = `${payload.firstName.trim()} ${payload.lastName.trim()}`.trim();
        if (fullName.length < 2) throw new Error('Full name must be at least 2 characters.');

        if (isOwnProfile || isCoordinator) {
          const { error: profileErr } = await supabase
            .from('profiles')
            .update({
              full_name: fullName,
              student_number: payload.studentNumber ?? null,
              avatar_url: payload.avatarUrl ?? null,
            })
            .eq('id', userId);
          if (profileErr) throw new Error(profileErr.message);
        }

        if (isOwnProfile || isCoordinator) {
          const { error: userProfileErr } = await supabase
            .from('user_profiles')
            .upsert({
              user_id: userId,
              first_name: payload.firstName,
              last_name: payload.lastName,
              phone: payload.phone ?? null,
              avatar_url: payload.avatarUrl ?? null,
              bio: payload.bio ?? null,
              student_number: payload.studentNumber ?? null,
              updated_at: new Date().toISOString(),
            });
          if (userProfileErr) throw new Error(userProfileErr.message);
        }

        refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [userId, refetch]
  );

  const uploadAvatar = useCallback(
    async (file: File): Promise<string> => {
      if (!userId) throw new Error('Not authenticated.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');
      const ext = file.name.split('.').pop();
      const path = `avatars/${userId}.${ext}`;
      const { error: err } = await supabase.storage.from('user-media').upload(path, file, { upsert: true });
      if (err) throw new Error(err.message);
      const { data } = supabase.storage.from('user-media').getPublicUrl(path);
      return data.publicUrl;
    },
    [userId]
  );

  return { profile, loading, saving, error, notFound, refetch, updateProfile, uploadAvatar };
}
