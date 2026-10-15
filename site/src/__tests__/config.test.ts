import { describe, expect, it } from 'vitest';
import { decodeRole, readApiConfig } from '../api/config';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.sig`;

describe('readApiConfig', () => {
  it('returns null when either value is missing, so the site falls back to sample content', () => {
    expect(readApiConfig({})).toBeNull();
    expect(readApiConfig({ VITE_SUPABASE_URL: 'https://p.example.co' })).toBeNull();
    expect(readApiConfig({ VITE_SUPABASE_ANON_KEY: jwt('anon') })).toBeNull();
  });

  it('accepts an https project URL with the anon key', () => {
    expect(readApiConfig({ VITE_SUPABASE_URL: 'https://p.example.co', VITE_SUPABASE_ANON_KEY: jwt('anon') })).toEqual({ url: 'https://p.example.co', anonKey: jwt('anon') });
  });

  it('refuses a plain http URL unless it is a local development address', () => {
    expect(readApiConfig({ VITE_SUPABASE_URL: 'http://api.example.co', VITE_SUPABASE_ANON_KEY: jwt('anon') })).toBeNull();
    expect(readApiConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: jwt('anon') })).not.toBeNull();
  });

  it('refuses a service-role key in the browser configuration', () => {
    expect(readApiConfig({ VITE_SUPABASE_URL: 'https://p.example.co', VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toBeNull();
  });
});

describe('decodeRole', () => {
  it('reads the role claim and returns null for malformed tokens', () => {
    expect(decodeRole(jwt('anon'))).toBe('anon');
    expect(decodeRole('not-a-jwt')).toBeNull();
  });
});
