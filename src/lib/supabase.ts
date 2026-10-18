import { createClient } from '@supabase/supabase-js';
import { parseRecoveryLink, type RecoveryLink } from './recoveryLink';
import { parseConfirmLink, type ConfirmLink } from './confirmLink';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY ?? 'placeholder-key';

// Read before createClient, which may consume the hash or code. Only the link kind and a PKCE code or token hash are kept.
export const recoveryLink: RecoveryLink =
  typeof window === 'undefined' ? { kind: 'none' } : parseRecoveryLink(window.location.hash, window.location.search);

export const confirmLink: ConfirmLink =
  typeof window === 'undefined' ? { kind: 'none' } : parseConfirmLink(window.location.hash, window.location.search);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isConfigured =
  !!process.env.REACT_APP_SUPABASE_URL && !!process.env.REACT_APP_SUPABASE_ANON_KEY;
