'use strict';
// The studio's emails, each as { subject, text, html }: the invite (with the person's own sign-in link, or "sign in with
// your company account" when the studio uses company sign-in) and the notice admins get when someone signs in for the
// first time. Everything a person typed is escaped in the HTML. CommonJS, Electron-free.
const STUDIO = 'Golden Thread';
const GOLD = '#b8860b';
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const line = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
// "an Editor", "an Admin", "a Channel owner"
const withArticle = (label) => (label ? `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}` : '');
// Nov 20, 2026, in UTC so the server's time zone never changes the date.
function day(value) {
  const ms = Date.parse(value || ''); if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
}

// One card: a heading, paragraphs (already-escaped HTML), an optional button and a footnote. Tables and inline styles,
// which every mail client renders.
function layout({ studioName, heading, paragraphs, button, footnote }) {
  const body = paragraphs.map((html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#2b2b2b">${html}</p>`).join('');
  const action = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:${GOLD}"><a href="${escape(button.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escape(button.label)}</a></td></tr></table>` : '';
  const note = footnote ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b6b">${footnote}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(heading)}</title></head>`
    + '<body style="margin:0;padding:0;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef"><tr><td align="center" style="padding:32px 16px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e7e2d6">'
    + `<tr><td style="padding:28px 32px 8px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${GOLD}">${escape(studioName)}</td></tr>`
    + `<tr><td style="padding:8px 32px 28px"><h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#1a1a1a">${escape(heading)}</h1>${body}${action}${note}</td></tr>`
    + '</table></td></tr></table></body></html>';
}

// inviteEmail({ name, inviter, roleLabel, url, expiresAt, origin, sso, studioName }). url is their personal sign-in
// link; with company sign-in (sso) there is no link and they sign in at origin.
function inviteEmail({ name = '', inviter = '', roleLabel = '', url = '', expiresAt = null, origin = '', sso = false, studioName = STUDIO } = {}) {
  const studio = line(studioName) || STUDIO; const who = line(inviter); const role = line(roleLabel);
  const greeting = line(name) ? `Hi ${line(name)},` : 'Hi,';
  const invited = `${who || 'An admin'} invited you to the ${studio} studio${role ? ` as ${withArticle(role)}` : ''}.`;
  const until = day(expiresAt);
  const subject = `You’ve been invited to the ${studio} studio`;
  if (sso || !url) {
    const where = line(origin);
    const text = [greeting, '', invited, '', `Sign in with your company account${where ? ` at ${where}` : ''}.`, '', `— ${studio}`].join('\n');
    const html = layout({ studioName: studio, heading: 'You’ve been invited to the studio', paragraphs: [escape(greeting), escape(invited), `Sign in with your company account${where ? ` at <a href="${escape(where)}" style="color:${GOLD}">${escape(where)}</a>` : ''}.`], button: where ? { url: where, label: `Open ${studio}` } : null, footnote: '' });
    return { subject, text, html };
  }
  const care = `This link is just for you, so please don’t forward it.${until ? ` It works until ${until}.` : ''} If it stops working, ask ${who || 'an admin'} for a new one.`;
  const text = [greeting, '', invited, '', 'Sign in with your personal link:', url, '', care, '', `— ${studio}`].join('\n');
  const html = layout({ studioName: studio, heading: 'You’ve been invited to the studio', paragraphs: [escape(greeting), escape(invited)], button: { url, label: `Sign in to ${studio}` }, footnote: `${escape(care)}<br><br>If the button doesn’t work, paste this into your browser:<br><span style="word-break:break-all">${escape(url)}</span>` });
  return { subject, text, html };
}

// firstSignInEmail({ name, email, roleLabel, at, origin, studioName }): to admins, when someone signs in for the first time.
function firstSignInEmail({ name = '', email = '', roleLabel = '', at = '', origin = '', studioName = STUDIO } = {}) {
  const studio = line(studioName) || STUDIO; const who = line(name) || line(email) || 'Someone'; const role = line(roleLabel);
  const details = [line(email) && line(email) !== who ? line(email) : '', role].filter(Boolean).join(', ');
  const when = day(at);
  const subject = `${who} just signed in for the first time`;
  const sentence = `${who}${details ? ` (${details})` : ''} just signed in to ${studio} for the first time${when ? ` on ${when}` : ''}.`;
  const where = line(origin);
  const people = where ? `You can see them and change their access in People: ${where}` : 'You can see them and change their access in People.';
  const text = [sentence, '', people, '', `You’re getting this because you’re an admin of ${studio}.`].join('\n');
  const html = layout({ studioName: studio, heading: subject, paragraphs: [escape(sentence), 'You can see them and change their access in People.'], button: where ? { url: where, label: `Open ${studio}` } : null, footnote: `You’re getting this because you’re an admin of ${escape(studio)}.` });
  return { subject, text, html };
}

module.exports = { inviteEmail, firstSignInEmail, escape, STUDIO };
