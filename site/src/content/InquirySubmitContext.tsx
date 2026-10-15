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

/** Provided only when the site is connected to the backend. Without it, forms keep their preview behaviour. */
export function InquirySubmitProvider({ value, children }: { value: InquirySubmitter | null; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInquirySubmitter(): InquirySubmitter | null {
  return useContext(Ctx);
}
