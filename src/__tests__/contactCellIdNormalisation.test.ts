import { supabase } from '../lib/supabase';
import { createContact, updateContact } from '../lib/queries/contacts';

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;
const UUID = '62b1d48e-ca45-427f-a71b-35f5fa327ec6';

const baseInput = {
  contact_name: 'Release Test Contact',
  tag: 'General',
  follow_up_status: 'Open',
  date_contacted: '2026-10-10',
  logged_by: UUID,
};

function insertCapture() {
  const captured: { payload?: Record<string, unknown> } = {};
  mockFrom.mockReturnValue({
    insert: (payload: Record<string, unknown>) => {
      captured.payload = payload;
      return { select: () => ({ single: async () => ({ data: { id: 'c1' }, error: null }) }) };
    },
  });
  return captured;
}

function updateCapture() {
  const captured: { payload?: Record<string, unknown> } = {};
  mockFrom.mockReturnValue({
    update: (payload: Record<string, unknown>) => {
      captured.payload = payload;
      return {
        eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'c1' }, error: null }) }) }),
      };
    },
  });
  return captured;
}

describe('contact cell_id is never sent as an empty string', () => {
  beforeEach(() => mockFrom.mockReset());

  it('createContact sends null for an unassigned cell and keeps logged_by', async () => {
    const captured = insertCapture();
    await createContact({ ...baseInput, cell_id: '' } as Parameters<typeof createContact>[0]);
    expect(captured.payload?.cell_id).toBeNull();
    expect(captured.payload?.logged_by).toBe(UUID);
  });

  it('createContact keeps a real cell uuid unchanged', async () => {
    const captured = insertCapture();
    await createContact({ ...baseInput, cell_id: UUID } as Parameters<typeof createContact>[0]);
    expect(captured.payload?.cell_id).toBe(UUID);
  });

  it('updateContact sends null for an unassigned cell', async () => {
    const captured = updateCapture();
    await updateContact('c1', { cell_id: '' });
    expect(captured.payload?.cell_id).toBeNull();
  });

  it('updateContact leaves cell_id out when the caller does not change it', async () => {
    const captured = updateCapture();
    await updateContact('c1', { notes: 'follow up' });
    expect(captured.payload).not.toHaveProperty('cell_id');
  });
});
