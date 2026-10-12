import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventCard } from '../components/feature/EventCard';
import type { Event } from '../types';

const event: Event = {
  id: 'e1',
  title: 'Bible Study',
  description: '',
  date: '2026-10-18',
  time: '19:00',
  location: 'Room 2',
  category: 'Bible Study',
  created_by: 'u1',
  created_at: '2026-10-01T00:00:00Z',
};

function render(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<EventCard event={event} />);
  return container;
}

describe('EventCard calendar links', () => {
  it('links to a pre-filled Google Calendar event in a new tab', () => {
    const link = render().querySelector('a[target="_blank"]') as HTMLAnchorElement | null;

    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Add to Google Calendar');
    expect(link?.getAttribute('rel')).toContain('noopener');

    const url = new URL(link?.getAttribute('href') ?? '');
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('text')).toBe('Bible Study');
    expect(url.searchParams.get('dates')).toBe('20261018T230000Z/20261019T000000Z');
    expect(url.searchParams.get('location')).toBe('Room 2');
  });

  it('offers an .ics download button for Apple Calendar and Outlook', () => {
    const buttons = Array.from(render().querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toContain('Add to Apple / Outlook (.ics)');
  });
});
