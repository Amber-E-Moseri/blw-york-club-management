import { useCallback, useEffect, useState } from 'react';
import { fetchCellMemberProfile } from '../lib/queries/members';
import type { ProfileUpdatePayload, UserProfile } from './useUserProfile';

/**
 * Read-only profile for a member of a cell the signed-in leader leads. Keyed by member_key, which is not an auth user id.
 * Fields the leader is not allowed to see (student number, identity links, admin attributes, role, status and join date)
 * are absent here, so the detail view cannot show them. Editing is never offered on this path.
 */

export interface UseCellMemberProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
  updateProfile: (payload: ProfileUpdatePayload) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
}

export function useCellMemberProfile(memberKey: string | undefined): UseCellMemberProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!memberKey) {
      setLoading(false);
      setProfile(null);
      setNotFound(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    fetchCellMemberProfile(memberKey)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setProfile(null);
          setNotFound(true);
          return;
        }
        const [firstName = '', ...rest] = (row.full_name ?? '').trim().split(/\s+/);
        setProfile({
          userId: row.member_key,
          fullName: row.full_name ?? '',
          firstName,
          lastName: rest.join(' '),
          email: row.email ?? '',
          // Not part of the leader view. The panel shows the role only to staff.
          role: 'member',
          status: 'active',
          phone: row.phone ?? undefined,
          avatarUrl: row.avatar_url ?? undefined,
          bio: row.bio ?? undefined,
          cellId: row.cell_id ?? undefined,
          joinedAt: '',
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this member.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberKey, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const refuse = useCallback(async (..._args: unknown[]): Promise<never> => {
    throw new Error('Leaders cannot edit another member’s profile.');
  }, []);

  return {
    profile,
    loading,
    saving: false,
    error,
    notFound,
    refetch,
    updateProfile: refuse as UseCellMemberProfileReturn['updateProfile'],
    uploadAvatar: refuse as UseCellMemberProfileReturn['uploadAvatar'],
  };
}
