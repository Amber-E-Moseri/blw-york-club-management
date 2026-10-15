import { exportMembersCSV } from '../lib/queries/export';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

afterEach(() => jest.clearAllMocks());

test('exports member profile details through the authorized RPC', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: [
      {
        id: 'member-1',
        full_name: 'Ada "Countess" Lovelace',
        email: 'ada@example.com',
        student_number: '123456789',
        role: 'member',
        status: 'active',
        cell_id: 'cell-1',
        avatar_url: 'https://example.com/avatar.png',
        joined_at: '2026-09-01T00:00:00Z',
      },
    ],
    error: null,
  });

  const csv = await exportMembersCSV();

  expect(supabase.rpc).toHaveBeenCalledWith('export_members_authorized', { export_status: 'all' });
  expect(csv.split('\n')[0]).toBe('ID,Name,Email,Student Number,Role,Status,Cell,Avatar URL,Joined At');
  expect(csv).toContain('"Ada ""Countess"" Lovelace"');
  expect(csv).toContain('"active"');
});

test('requests active member exports through the RPC filter', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: [], error: null });

  await exportMembersCSV('active');

  expect(supabase.rpc).toHaveBeenCalledWith('export_members_authorized', { export_status: 'active' });
});

test('requests archived member exports through the RPC filter', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: [], error: null });

  await exportMembersCSV('archived');

  expect(supabase.rpc).toHaveBeenCalledWith('export_members_authorized', { export_status: 'archived' });
});

test('surfaces database authorization failures', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: null,
    error: { message: 'Not authorised to export member data.' },
  });

  await expect(exportMembersCSV()).rejects.toThrow('Not authorised to export member data.');
});
