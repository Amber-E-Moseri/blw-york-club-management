import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { sampleContent } from '../content/sample-data';
import type { SiteContent } from '../content/types';

function renderAt(path: string, content?: SiteContent) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App content={content} />
    </MemoryRouter>,
  );
}

describe('navigation and layout', () => {
  it('shows the sample-content banner and a single page h1 on the home page', () => {
    renderAt('/');
    expect(screen.getByText(/Design preview/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('exposes every approved public route in the main navigation', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const item of sampleContent.nav) {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.path);
    }
  });

  it('marks the current page in the navigation', () => {
    renderAt('/about');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
  });

  it('toggles the mobile menu with aria-expanded and closes it on Escape', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('events', () => {
  it('switches between upcoming and past events', async () => {
    const user = userEvent.setup();
    renderAt('/events');
    expect(screen.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Past' }));
    expect(screen.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an event detail page with calendar downloads and a registration link', () => {
    renderAt('/events/bible-study');
    expect(screen.getByRole('heading', { level: 1, name: 'Bible Study' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Register/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /Download .ics file/ })).toHaveAttribute('download', 'bible-study.ics');
  });

  it('omits the registration button when an event has no registration URL', () => {
    renderAt('/events/sunday-service');
    expect(screen.queryByRole('link', { name: /Register/ })).not.toBeInTheDocument();
  });
});

describe('Foundation School external link', () => {
  it('links to the configured https enrolment URL in a new tab', () => {
    renderAt('/foundation-school');
    const link = screen.getByRole('link', { name: /Enrol in Foundation School/ });
    expect(link).toHaveAttribute('href', sampleContent.settings.foundationEnrollUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides the enrol button and shows the coming-soon message when the URL is unsafe', () => {
    const content: SiteContent = {
      ...sampleContent,
      settings: { ...sampleContent.settings, foundationEnrollUrl: 'http://insecure.example/enrol' },
    };
    renderAt('/foundation-school', content);
    expect(screen.queryByRole('link', { name: /Enrol in Foundation School/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Enrolment details coming soon/)).toBeInTheDocument();
  });
});

describe('Rhapsody', () => {
  it('filters the library by search text', async () => {
    const user = userEvent.setup();
    renderAt('/rhapsody');
    await user.type(screen.getByRole('searchbox', { name: /Search editions/ }), 'daily');
    expect(screen.getByRole('status')).toHaveTextContent('2 editions');
  });

  it('opens the reader with an embedded PDF and a download link', () => {
    renderAt('/rhapsody/oct-2026');
    expect(screen.getByRole('heading', { level: 1, name: 'October 2026' })).toBeInTheDocument();
    expect(document.querySelector('object[type="application/pdf"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/assets/sample-rhapsody.pdf');
  });
});

describe('blog', () => {
  it('opens an article with related posts', () => {
    renderAt('/blog/what-god-did');
    expect(screen.getByRole('heading', { level: 1, name: 'What God Did at Our Outreach Night' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Related posts' })).toBeInTheDocument();
  });

  it('filters articles by category', async () => {
    const user = userEvent.setup();
    renderAt('/blog');
    await user.click(screen.getByRole('button', { name: 'Testimonies' }));
    expect(screen.getByRole('link', { name: 'From Uncertainty to Purpose: My Journey at York' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Leading by Serving' })).not.toBeInTheDocument();
  });
});

describe('forms', () => {
  it('shows field errors, focuses the first invalid field, and succeeds only with consent', async () => {
    const user = userEvent.setup();
    renderAt('/contact');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    // Topic is the first field in the form, so it receives focus first.
    expect(screen.getByLabelText(/Topic/)).toHaveFocus();
    expect(screen.getByLabelText(/Topic/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Please complete this field.').length).toBeGreaterThan(0);

    const name = screen.getByLabelText(/Full name/);
    await user.type(name, 'Ada');
    await user.type(screen.getByLabelText(/Email/), 'ada@example.org');
    await user.selectOptions(screen.getByLabelText(/Topic/), 'Events');
    await user.type(screen.getByLabelText(/Message/), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByText(/consent/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByRole('status')).toHaveTextContent('nothing was sent or stored');
  });
});
