// The meeting card must not offer "Confirm Attendance" when the viewer's attendance could not be loaded. It shows the
// status as unavailable. When the status is known, the confirm control is shown as before.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeetingCard } from '../components/feature/MeetingCard';
import type { Meeting } from '../types';

const baseMeeting = {
  id: 'm1',
  title: 'Cell night',
  date: '2026-11-27',
  time: '19:00',
  end_time: null,
  category: 'cell',
  location: null,
  zoom_link: null,
  description: null,
  allow_join_requests: false,
  user_confirmed: false,
  attendance_count: 0,
} as unknown as Meeting;

describe('MeetingCard attendance display', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (meeting: Meeting) =>
    act(() => {
      root.render(
        <MeetingCard meeting={meeting} canManage={false} onConfirm={jest.fn()} onCancel={jest.fn()} />,
      );
    });

  it('shows the status as unavailable and offers no confirm button when attendance could not be loaded', () => {
    render({ ...baseMeeting, attendance_status_unavailable: true } as Meeting);

    expect(container.textContent).toMatch(/attendance status is unavailable/i);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => /confirm attendance/i.test(t))).toBe(false);
  });

  it('still offers Confirm Attendance when the status is known and not confirmed', () => {
    render(baseMeeting);

    expect(container.textContent).not.toMatch(/unavailable/i);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => /confirm attendance/i.test(t))).toBe(true);
  });
});
