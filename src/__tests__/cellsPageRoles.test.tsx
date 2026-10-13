import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cells } from '../pages/Cells';
import type { AuthUser } from '../lib/auth';

jest.mock('../lib/supabase', () => ({ supabase: { from: () => ({}) } }));

const user = (role: AuthUser['role'], status: AuthUser['status'] = 'active'): AuthUser => ({
  id: 'u1', email: 'u1@example.org', name: 'Test User', role, status, createdAt: new Date(0),
});

const render = (u: AuthUser | null) => renderToStaticMarkup(<Cells user={u} />);

describe('Cells page role gating', () => {
  it('gives an active coordinator the create control', () => {
    const html = render(user('coordinator'));
    expect(html).toContain('New cell');
  });

  it('gives an active admin the create control', () => {
    expect(render(user('admin'))).toContain('New cell');
  });

  it('keeps cell leaders read-only', () => {
    const html = render(user('cell_leader'));
    expect(html).not.toContain('New cell');
    expect(html).toContain('Cells');
  });

  it('hides the cell list from ordinary members', () => {
    const html = render(user('member'));
    expect(html).toContain('Cells are visible to cell leaders, admins and coordinators.');
    expect(html).not.toContain('New cell');
  });

  it('hides management from a coordinator whose account is inactive', () => {
    const html = render(user('coordinator', 'inactive'));
    expect(html).not.toContain('New cell');
  });

  it('renders nothing privileged without a session', () => {
    expect(render(null)).not.toContain('New cell');
  });
});
