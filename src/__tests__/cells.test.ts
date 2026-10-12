import { summarizeCells } from '../lib/cells';
import type { Cell, Member } from '../types';

const member = (id: string, full_name: string, cell_id?: string): Member => ({
  id,
  full_name,
  email: `${id}@example.org`,
  role: 'member',
  joined_at: '2026-01-01',
  cell_id,
});

describe('summarizeCells', () => {
  const cells: Cell[] = [
    { id: 'c1', name: 'North', leader_id: 'l1' },
    { id: 'c2', name: 'South' },
  ];
  const members: Member[] = [
    member('l1', 'Lerato Dube', 'c1'),
    member('m2', 'Zanele Ndlovu', 'c1'),
    member('m1', 'Amahle Khumalo', 'c1'),
    member('m3', 'Sipho Mokoena', undefined),
  ];

  it('attaches the leader name and the members of each cell', () => {
    const [north, south] = summarizeCells(cells, members);

    expect(north.leaderName).toBe('Lerato Dube');
    expect(north.members.map((m) => m.full_name)).toEqual(['Amahle Khumalo', 'Lerato Dube', 'Zanele Ndlovu']);
    expect(south.leaderName).toBeNull();
    expect(south.members).toEqual([]);
  });

  it('keeps leader names when the leader is not in a cell themselves', () => {
    const result = summarizeCells(
      [{ id: 'c3', name: 'East', leader_id: 'l9' }],
      [member('l9', 'Thabo Radebe')]
    );
    expect(result[0].leaderName).toBe('Thabo Radebe');
    expect(result[0].members).toEqual([]);
  });

  it('ignores members who have no cell', () => {
    const result = summarizeCells(cells, members);
    const allMembers = result.flatMap((c) => c.members.map((m) => m.id));
    expect(allMembers).not.toContain('m3');
  });
});
