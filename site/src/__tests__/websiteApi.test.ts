import { describe, expect, it } from 'vitest';
import { ApiError, createWebsiteApi, mapDbError } from '../api/websiteApi';

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: null };
    return new Response(next.body === null ? '' : JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const config = (token: string | null, impl: typeof fetch) => ({
  url: 'https://project.example.co/',
  anonKey: 'anon-public-key',
  getAccessToken: () => token,
  fetchImpl: impl,
});

describe('database error mapping', () => {
  it('maps the database codes used by the migrations to user-facing kinds', () => {
    expect(mapDbError(403, { code: '42501', message: 'x' }).kind).toBe('forbidden');
    expect(mapDbError(409, { code: '40001', message: 'changed' }).kind).toBe('conflict');
    expect(mapDbError(429, { code: 'P0429', message: 'slow down' }).kind).toBe('rate_limited');
    expect(mapDbError(400, { code: '22023', message: 'bad field' }).kind).toBe('invalid');
    expect(mapDbError(404, { code: 'P0002', message: 'none' }).kind).toBe('not_found');
    expect(mapDbError(401, null).kind).toBe('unauthenticated');
    expect(mapDbError(503, null).kind).toBe('server');
  });

  it('forbidden errors never leak the database message', () => {
    const e = mapDbError(403, { code: '42501', message: 'permission denied for table web_roles' });
    expect(e.message).toBe('You do not have permission for this action.');
    expect(e).toBeInstanceOf(ApiError);
  });
});

describe('administrative calls', () => {
  it('posts RPC arguments with the signed-in token and the anon key as apikey', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: 2 }]);
    const api = createWebsiteApi(config('user-jwt', impl));
    const v = await api.saveDraft('page', 'home', { title: 'Home' }, 1);
    expect(v).toBe(2);
    expect(calls[0].url).toBe('https://project.example.co/rest/v1/rpc/web_save_draft');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-public-key');
    expect(headers.Authorization).toBe('Bearer user-jwt');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_kind: 'page', p_key: 'home', p_body: { title: 'Home' }, p_expected_version: 1 });
  });

  it('surfaces a conflict when the draft changed', async () => {
    const { impl } = fakeFetch([{ status: 409, body: { code: '40001', message: 'changed while editing' } }]);
    const api = createWebsiteApi(config('t', impl));
    await expect(api.saveDraft('page', 'home', {}, 1)).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('turns a permission refusal into a forbidden error', async () => {
    const { impl } = fakeFetch([{ status: 403, body: { code: '42501', message: 'nope' } }]);
    const api = createWebsiteApi(config('t', impl));
    await expect(api.publishContent('page', 'home', 1, 'note')).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('reports a network failure as a network error, not a crash', async () => {
    const impl = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    const api = createWebsiteApi(config('t', impl));
    await expect(api.myPermissions()).rejects.toMatchObject({ kind: 'network' });
  });

  it('reads the list of website permissions for the signed-in user', async () => {
    const { impl } = fakeFetch([{ status: 200, body: [{ permission_key: 'website.pages.edit' }, { permission_key: 'website.blog.edit' }] }]);
    const api = createWebsiteApi(config('t', impl));
    expect(await api.myPermissions()).toEqual(['website.pages.edit', 'website.blog.edit']);
  });

  it('lists roles through the role RPC and maps them to the client shape', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: [{ id: 'r1', name: 'Editor', description: 'd', permissions: ['website.pages.edit'] }] }]);
    const api = createWebsiteApi(config('t', impl));
    const roles = await api.listRoles();
    expect(calls[0].url).toContain('/rest/v1/rpc/web_list_website_roles');
    expect(roles).toEqual([{ id: 'r1', name: 'Editor', description: 'd', permissions: ['website.pages.edit'] }]);
  });

  it('lists assignments through the assignment RPC', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: [{ id: 'a1', role_id: 'r1', profile_id: 'p1', assigned_at: '2026-11-01T00:00:00Z' }] }]);
    const api = createWebsiteApi(config('t', impl));
    const rows = await api.listAssignments();
    expect(calls[0].url).toContain('/rest/v1/rpc/web_list_website_assignments');
    expect(rows).toEqual([{ id: 'a1', roleId: 'r1', profileId: 'p1', assignedAt: '2026-11-01T00:00:00Z' }]);
  });

  it('creates a role with its audit reason', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: 'role-id' }]);
    const api = createWebsiteApi(config('t', impl));
    await api.createRole('Editor', 'd', ['website.pages.edit'], 'Approved for the website team');
    expect(calls[0].url).toContain('/rest/v1/rpc/web_create_website_role');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_name: 'Editor', p_description: 'd', p_permissions: ['website.pages.edit'], p_reason: 'Approved for the website team' });
  });

  it('sets the complete permission set through one atomic RPC call', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: null }]);
    const api = createWebsiteApi(config('t', impl));
    await api.setRolePermissions('r1', ['website.pages.edit', 'website.events.manage'], 'Adjust the team scope');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/rest/v1/rpc/web_set_website_role_permissions');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_role_id: 'r1', p_permissions: ['website.pages.edit', 'website.events.manage'], p_reason: 'Adjust the team scope' });
  });

  it('retires a role through the retirement RPC and assigns or revokes through the backend names', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: null }, { status: 200, body: 'a-id' }, { status: 200, body: null }]);
    const api = createWebsiteApi(config('t', impl));
    await api.retireRole('r1', 'No longer needed');
    await api.assignRole('p1', 'r1', 'Joins the team');
    await api.revokeAssignment('a1', 'Leaves the team');
    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining('/rest/v1/rpc/web_retire_website_role'),
      expect.stringContaining('/rest/v1/rpc/web_assign_website_role'),
      expect.stringContaining('/rest/v1/rpc/web_unassign_website_role'),
    ]);
  });
});

describe('public reads', () => {
  it('never sends a user token for public content, even when a user is signed in', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: [] }]);
    const api = createWebsiteApi(config('user-jwt', impl));
    await api.publicContent();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer anon-public-key');
    expect(calls[0].url).toContain('/rest/v1/v_public_content?');
  });

  it('reads published posts and events through their views only', async () => {
    const { calls, impl } = fakeFetch([
      { status: 200, body: [{ slug: 'a', title: 'A', excerpt: 'e', body: 'b', category: 'c', author_display: 'x', published_at: '2026-10-01T00:00:00Z' }] },
      { status: 200, body: [{ slug: 'bible-study', title: 'Bible Study', summary: 's', event_date: '2026-11-12', event_time: '18:30', location: 'Hall', category: 'Other', featured: true, registration_url: null }] },
    ]);
    const api = createWebsiteApi(config(null, impl));
    const posts = await api.publicPosts();
    const events = await api.publicEvents();
    expect(calls[0].url).toContain('/rest/v1/v_public_posts?');
    expect(calls[1].url).toContain('/rest/v1/v_public_events?');
    expect(posts[0].authorDisplay).toBe('x');
    expect(events[0]).toMatchObject({ slug: 'bible-study', featured: true, eventDate: '2026-11-12' });
  });

  it('public reads never touch an administrative RPC', async () => {
    const { calls, impl } = fakeFetch([{ status: 200, body: [] }, { status: 200, body: [] }, { status: 200, body: [] }]);
    const api = createWebsiteApi(config('t', impl));
    await api.publicContent();
    await api.publicPosts();
    await api.publicEvents();
    expect(calls.every((c) => c.url.includes('/rest/v1/v_public_') && !c.url.includes('/rpc/'))).toBe(true);
  });
});
