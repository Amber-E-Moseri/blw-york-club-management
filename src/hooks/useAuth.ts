import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { releaseDeviceSubscription } from './usePushNotifications';
import {
  signInWithEmail,
  signUpWithEmail,
  signOut as authSignOut,
  resetPassword,
  changePassword,
  buildProfile,
  AuthUser,
  AuthError,
} from '../lib/auth';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  useEffect(() => {
    // Hydrate from existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setState({ user: null, loading: false, error: null });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id);
      else setState({ user: null, loading: false, error: null });
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(id: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      // Leadership is the assignment cells.leader_id. A failed lookup fails the load rather than silently demoting a leader.
      const { data: led, error: ledError } = await supabase
        .from('cells')
        .select('id')
        .eq('leader_id', id);
      if (ledError) throw ledError;
      const user = { ...buildProfile(data), ledCellIds: (led ?? []).map((c) => c.id as string) };
      setState({ user, loading: false, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load profile.';
      setState({ user: null, loading: false, error: msg });
    }
  }

  const signIn = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, error: null }));
    try {
      await signInWithEmail(email, password);
      // onAuthStateChange will call loadProfile
    } catch (e) {
      const msg = e instanceof AuthError ? e.message : 'Sign-in failed.';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    studentNumber?: string,
  ): Promise<boolean> => {
    setState((s) => ({ ...s, error: null }));
    try {
      await signUpWithEmail(email, password, fullName, studentNumber);
      return true;
    } catch (e) {
      const msg = e instanceof AuthError ? e.message : 'Sign-up failed.';
      setState((s) => ({ ...s, loading: false, error: msg }));
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    // Detach this browser from the account while the session can still authorise the delete. Otherwise the
    // next person on this device would inherit the previous account's notifications. A failure must not block sign-out.
    await releaseDeviceSubscription().catch((err) =>
      console.warn('[Push] could not release device subscription', err instanceof Error ? err.message : err)
    );
    await authSignOut();
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    await resetPassword(email);
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    await changePassword(newPassword);
  }, []);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
  };
}
