import type { Page } from '@playwright/test';

// Per-test profile override for the approval gate. Install mockSupabase first; a route registered here is matched before
// it, so only the profiles row changes. Everything else keeps the shared fixture. Mocked Supabase only: this proves the
// client's behaviour, not GoTrue, PostgREST or the database.

export type ProfileScenario =
  | { kind: 'row'; profile: Record<string, unknown> }
  | { kind: 'missing' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range, range-unit',
};

export const SIGNED_IN_USER_ID = 'e2e-user';

export async function mockProfile(page: Page, scenario: ProfileScenario) {
  await page.route(/\/rest\/v1\/profiles(\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    if (request.method() !== 'GET') {
      return route.fallback();
    }
    const url = new URL(request.url());
    if (url.searchParams.get('id') !== `eq.${SIGNED_IN_USER_ID}`) {
      return route.fallback();
    }

    if (scenario.kind === 'missing') {
      // PostgREST answers a .single() request with zero rows using PGRST116 and a 406.
      return route.fulfill({
        status: 406,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          code: 'PGRST116',
          details: 'The result contains 0 rows',
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(scenario.profile),
    });
  });
}

/**
 * A profiles row for the signed-in user. An override of `undefined` removes that field from the row (a missing status),
 * and `null` keeps it as a SQL NULL.
 */
export function profileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    id: SIGNED_IN_USER_ID,
    email: 'leader@yorku.ca',
    full_name: 'Taylor Member',
    role: 'member',
    status: 'active',
    cell_id: null,
    admin_role: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}
