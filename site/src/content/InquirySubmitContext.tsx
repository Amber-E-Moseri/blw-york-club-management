import { createContext, useContext, type ReactNode } from 'react';

export interface InquiryInput {
  kind: 'contact' | 'new_here' | 'prayer';
  name: string;
  email: string;
  phone: string;
  message: string;
  topic: string;
  /** The exact consent text the visitor agreed to. Its SHA-256 hash is stored with the message. */
  consentText: string;
  /** Hidden spam trap. Any value is a bot signal; the database accepts it silently and stores nothing. */
  honeypot: string;
}

export type InquirySubmitter = (input: InquiryInput) => Promise<void>;

const Ctx = createContext<InquirySubmitter | null>(null);

/** Provided only when the site is connected to the backend. Without it, forms run in demo mode and send nothing. */
export function InquirySubmitProvider({ value, children }: { value: InquirySubmitter | null; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInquirySubmitter(): InquirySubmitter | null {
  return useContext(Ctx);
}

/**
 * Turnstile state for the protected inquiry path. The widget writes the token here; the submitter reads and clears it.
 * The token is single-use, so the widget is reset after every attempt, successful or not.
 */
export interface TurnstileHandle {
  siteKey: string;
  token: string | null;
  setToken: (token: string | null) => void;
  /** Registered by the rendered widget. Null when no widget is on the page. */
  reset: (() => void) | null;
}

const TurnstileCtx = createContext<TurnstileHandle | null>(null);

export function TurnstileProvider({ value, children }: { value: TurnstileHandle | null; children: ReactNode }) {
  return <TurnstileCtx.Provider value={value}>{children}</TurnstileCtx.Provider>;
}

export function useTurnstile(): TurnstileHandle | null {
  return useContext(TurnstileCtx);
}
