import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  signInWithEmail,
  signUpWithEmail,
  signOut as authSignOut,
  resetPassword,
  changePassword,
  buildProfile,
  AuthUser,
  AuthError,
  GENERIC_AUTH_ERROR_MESSAGE,
} from '../lib/auth';

export const SESSION_RESTORE_ERROR_MESSAGE =
  'We could not check your saved session. Check your connection and sign in again.';
export const PROFILE_LOAD_ERROR_MESSAGE =
  'We could not load your account. Check your connection and sign in again.';
export const PROFILE_NOT_FOUND_MESSAGE =
  'Your account profile is not set up yet. Please contact a BLW York leader.';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  useEffect(() => {
    // Hydrate from existing session. A failure here must end the loading state, never leave the spinner running.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session?.user) {
          loadProfile(session.user.id);
        } else {
          setState({ user: null, loading: false, error: null });
        }
      })
      .catch(() => {
        setState({ user: null, loading: false, error: SESSION_RESTORE_ERROR_MESSAGE });
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
      setState({ user: buildProfile(data), loading: false, error: null });
    } catch (e) {
      // Fail closed with a message a person can act on. The raw exception stays out of the UI.
      console.warn('[auth] profile load failed:', e instanceof Error ? e.name : 'unknown');
      const msg = e instanceof AuthError && e.message === 'Profile not found.'
        ? PROFILE_NOT_FOUND_MESSAGE
        : PROFILE_LOAD_ERROR_MESSAGE;
      setState({ user: null, loading: false, error: msg });
    }
  }

  const signIn = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, error: null }));
    try {
      await signInWithEmail(email, password);
      // onAuthStateChange will call loadProfile
    } catch (e) {
      const msg = e instanceof AuthError ? e.message : GENERIC_AUTH_ERROR_MESSAGE;
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
