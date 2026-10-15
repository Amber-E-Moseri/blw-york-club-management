import type { Page, Route } from '@playwright/test';

const user = {
  id: 'e2e-user',
  email: 'leader@yorku.ca',
  user_metadata: {
    full_name: 'Jordan Leader',
    role: 'admin',
    status: 'active',
  },
  created_at: '2026-01-01T00:00:00.000Z',
};

const profile = {
  id: user.id,
  email: user.email,
  full_name: 'Jordan Leader',
  role: 'admin',
  status: 'active',
  cell_id: null,
  admin_role: null,
  joined_at: user.created_at,
};

const session = {
  access_token: 'e2e-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'e2e-refresh-token',
  user,
};

const fixtures: Record<string, unknown[]> = {
  profiles: [profile],
  member_directory: [
    {
      ...profile,
      avatar_url: null,
      student_number: '900000001',
    },
  ],
  user_profiles: [
    {
      user_id: user.id,
      first_name: 'Jordan',
      last_name: 'Leader',
      phone: null,
      avatar_url: null,
      bio: null,
      student_number: '900000001',
      created_at: user.created_at,
      updated_at: user.created_at,
    },
  ],
  contacts: [],
  habit_entries: [],
  habit_templates: [],
  devotional_views: [],
  monthly_devotionals: [],
  devotional_daily_pages: [],
  weekly_messages: [],
  events: [
    {
      id: 'event-1',
      title: 'Sunday Service',
      description: 'Weekly worship gathering',
      date: '2026-09-13',
      time: '10:00',
      location: 'York University',
      type: 'service',
      created_at: '2026-09-01T00:00:00.000Z',
    },
  ],
  announcements: [
    {
      id: 'announcement-1',
      title: 'Welcome Back',
      body: 'A new semester begins.',
      author_name: 'Jordan Leader',
      created_at: '2026-09-01T00:00:00.000Z',
    },
  ],
  meetings: [
    {
      id: 'meeting-1',
      title: 'Leadership Sync',
      date: '2026-09-14',
      time: '18:00',
      location: 'Room 101',
      visibility: 'leaders',
      created_at: '2026-09-01T00:00:00.000Z',
    },
  ],
  prayer_requests: [],
  testimonies: [],
};

export async function mockSupabase(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (!url.pathname.startsWith('/auth/v1/') && !url.pathname.startsWith('/rest/v1/')) {
      return route.continue();
    }

    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname === '/auth/v1/token') {
      return json(route, { ...session });
    }

    if (url.pathname === '/auth/v1/signup') {
      return json(route, { user: { ...user, email: 'new@yorku.ca' }, session: null });
    }

    if (url.pathname === '/auth/v1/user') {
      return json(route, { ...user });
    }

    if (url.pathname === '/auth/v1/logout') {
      return json(route, {});
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop() ?? '';
      const rows = fixtures[table] ?? [];
      const wantsSingleProfile = table === 'profiles' && url.searchParams.get('id') === `eq.${user.id}`;
      const wantsSingleUserProfile = table === 'user_profiles' && url.searchParams.get('user_id') === `eq.${user.id}`;
      const body = wantsSingleProfile ? profile : wantsSingleUserProfile ? (rows[0] ?? null) : rows;
      const headers = {
        ...corsHeaders,
        'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
        'range-unit': 'items',
      };

      if (request.method() === 'HEAD') {
        return route.fulfill({
          status: 200,
          headers,
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });
    }

    return json(route, {});
  });
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders,
    body: JSON.stringify(body),
  });
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range, range-unit',
};
