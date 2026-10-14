import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPendingApprovals, PlacementControl } from '../pages/AdminPendingApprovals';
import type { AuthUser } from '../lib/auth';
import type { Cell } from '../types';

jest.mock('../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: jest.fn() } }));
jest.mock('../lib/queries/contacts', () => ({ fetchCells: jest.fn(() => new Promise(() => {})) }));

const user = (role: AuthUser['role'], status: AuthUser['status'] = 'active'): AuthUser => ({
  id: 'u1', email: 'u1@example.org', name: 'Test User', role, status, createdAt: new Date(0),
});

const cells: Cell[] = [{ id: 'c1', name: 'North' }];
const applicant = {
  id: 'p1', email: 'p@example.org', full_name: 'Pending Person', student_number: null,
  joined_at: '2026-01-01', status: 'pending' as const, cell_id: null,
};

describe('pending applicant placement (admin UI)', () => {
  it('denies the approvals page to a cell leader, so no placement control is reachable', () => {
    const html = renderToStaticMarkup(<AdminPendingApprovals user={user('cell_leader')} />);
    expect(html).toContain('Access denied');
    expect(html).not.toContain('Place in cell');
  });

  it('denies the approvals page to an ordinary member', () => {
    expect(renderToStaticMarkup(<AdminPendingApprovals user={user('member')} />)).toContain('Access denied');
  });

  it('renders the placement control disabled until a cell and a reason are both given', () => {
    const html = renderToStaticMarkup(
      <PlacementControl applicant={applicant} cells={cells} actor={user('coordinator')} onPlaced={() => {}} />,
    );
    expect(html).toContain('Place in cell');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<span>)?Place in cell/);
  });

  it('says so when there are no active cells', () => {
    const html = renderToStaticMarkup(
      <PlacementControl applicant={applicant} cells={[]} actor={user('admin')} onPlaced={() => {}} />,
    );
    expect(html).toContain('No active cells exist yet');
  });
});
