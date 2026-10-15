// Behavioural (not source-text) tests: these import and execute the real renderer.
jest.mock('../lib/supabase', () => ({ supabase: {} }));
import { renderComposerEmail, validateEmailPlaceholders, escapeHtml } from '../lib/email/emailComposer';

const recipient = { id: 'u1', full_name: 'Ada <b>Lovelace</b>', email: 'ada@example.test', role: 'member' };
const render = (subject: string, body: string, r = recipient) =>
  renderComposerEmail({ subject, body, recipient: r, senderName: 'Pat', appOrigin: 'https://hub.example.test' });

describe('email composer rendering (behavioural)', () => {
  test('approved placeholders are substituted in subject and body', () => {
    const out = render('Hi {{member.full_name}}', 'Email {{ member.email }} role {{member.role}} from {{sender.name}} at {{organization.name}}');
    expect(out.subject).toBe('Hi Ada <b>Lovelace</b>');
    expect(out.text).toBe('Email ada@example.test role member from Pat at BLW York');
    expect(out.invalidPlaceholders).toEqual([]);
  });

  test('unapproved placeholders are reported and left inert', () => {
    const out = render('{{member.password}}', 'x {{member.phone}} {{__proto__}} {{constructor}}');
    expect(out.invalidPlaceholders.sort()).toEqual(['__proto__', 'constructor', 'member.password', 'member.phone']);
    expect(out.text).toContain('{{member.phone}}');
    expect(validateEmailPlaceholders('a', '{{member.full_name}}')).toEqual([]);
  });

  test('recipient data containing HTML is escaped in the rendered HTML', () => {
    const out = render('Hello', 'Dear {{member.full_name}}');
    expect(out.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(out.html).not.toContain('<b>Lovelace</b>');
  });

  test('script, event-handler and tag injection in the body is neutralised', () => {
    const out = render('s', '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>');
    expect(out.html).not.toMatch(/<script/i);
    expect(out.html).not.toMatch(/<img/i);
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toMatch(/href="javascript:/i);
  });

  test('markdown links are limited to http(s) and cannot break out of the attribute', () => {
    const bad = render('s', '[click](javascript:alert(1)) [x](https://a.test/" onmouseover="alert(1))');
    expect(bad.html).not.toMatch(/href="javascript:/i);
    expect(bad.html).not.toMatch(/<[^>]*sonmouseover=/i);
    const plain = render('s', '[site](https://example.test/path)');
    expect(plain.html).toContain('href="https://example.test/path"');
  });

  test('subject is escaped in the HTML title and cannot inject markup', () => {
    const out = render('</title><script>alert(1)</script>', 'body');
    expect(out.html).not.toMatch(/<script/i);
    expect(out.html).toContain('&lt;/title&gt;');
  });

  test('a placeholder value cannot smuggle another placeholder (no recursive expansion)', () => {
    const out = render('s', '{{member.full_name}}', { ...recipient, full_name: '{{member.email}}' });
    expect(out.text).toBe('{{member.email}}');
  });

  test('footer always carries the preferences link; escapeHtml covers all five characters', () => {
    expect(render('s', 'b').html).toContain('https://hub.example.test/email-preferences');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('the composer emits no open-tracking pixel itself (tracking is added only by the edge function)', () => {
    expect(render('s', 'b').html).not.toMatch(/trackingToken|messageId/);
  });

  // KNOWN DEFECTS. Each passes while the defect exists and will FAIL when it is fixed - flip it to a normal assertion then.
  test('KNOWN DEFECT P2: a link whose URL has a query string is double-escaped (&amp;amp;) and breaks', () => {
    const html = render('s', '[site](https://example.test/path?a=1&b=2)').html;
    expect(html).toContain('href="https://example.test/path?a=1&amp;amp;b=2"'); // desired: ...a=1&amp;b=2
  });

  test('KNOWN DEFECT P2: {{__proto__}} / {{constructor}} resolve through the prototype chain into the rendered text', () => {
    const out = render('s', '{{__proto__}} {{constructor}}');
    expect(out.text).toContain('[object Object]'); // desired: left as {{__proto__}} (UI already blocks sending: invalid placeholder)
    expect(out.invalidPlaceholders).toEqual(['__proto__', 'constructor']);
  });
});
