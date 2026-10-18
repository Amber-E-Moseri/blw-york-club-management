import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicForm } from '../components/PublicForm';
import { sha256Hex } from '../lib/hash';
import type { FieldSpec } from '../lib/forms';

const FIELDS: FieldSpec[] = [
  { id: 'name', label: 'Full name', kind: 'text', required: true },
  { id: 'email', label: 'Email', kind: 'email', required: true },
];
const CONSENT = 'I agree that BLW York may reply to me.';

function renderForm(onSubmitValid?: (v: Record<string, string>, hp: string, consent: string) => Promise<void>) {
  return render(
    <PublicForm idPrefix="t" title="Send" intro="Intro" submitLabel="Send" consentText={CONSENT} fields={FIELDS}
      successMessage="Received." onSubmitValid={onSubmitValid} />,
  );
}

describe('public form submission', () => {
  it('sends the typed values and the exact consent text through the submitter, then confirms', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => undefined);
    renderForm(submit);
    await user.type(screen.getByLabelText(/Full name/), 'Ada');
    await user.type(screen.getByLabelText(/Email/), 'ada@example.org');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Received.'));
    expect(submit).toHaveBeenCalledTimes(1);
    const [values, honeypot, consent] = submit.mock.calls[0] as unknown as [Record<string, string>, string, string];
    expect(values).toMatchObject({ name: 'Ada', email: 'ada@example.org' });
    expect(honeypot).toBe('');
    expect(consent).toBe(CONSENT);
  });

  it('shows the database refusal to the visitor and does not confirm', async () => {
    const user = userEvent.setup();
    renderForm(async () => { throw new Error('Too many messages were sent recently. Please try again in a few minutes.'); });
    await user.type(screen.getByLabelText(/Full name/), 'Ada');
    await user.type(screen.getByLabelText(/Email/), 'ada@example.org');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many messages');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the honeypot out of the accessibility tree, so people and screen readers never see it', async () => {
    renderForm(async () => undefined);
    // The only textboxes are the two real fields. The honeypot sits inside a hidden container.
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('without a submitter the form keeps its preview behaviour and sends nothing', async () => {
    const user = userEvent.setup();
    renderForm(undefined);
    await user.type(screen.getByLabelText(/Full name/), 'Ada');
    await user.type(screen.getByLabelText(/Email/), 'ada@example.org');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Received.');
  });
});

describe('consent hashing', () => {
  it('computes the standard SHA-256 test vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('always returns 64 lowercase hex characters, as the database requires', async () => {
    expect(await sha256Hex(CONSENT)).toMatch(/^[0-9a-f]{64}$/);
  });
});
