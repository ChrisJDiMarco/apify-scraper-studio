'use strict';
// The studio's emails, each as { subject, text, html }: the invite (with the person's own one-time sign-in link, or how to
// sign in with Google or their company account), a sign-in link someone asked for, the notice admins get when
// someone signs in for the first time, and the one they get when a run stops failed or partway. Everything a person typed is escaped in the HTML. CommonJS, Electron-free.
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

// inviteEmail({ name, email, inviter, roleLabel, url, expiresAt, origin, sso, google, again, studioName }). url is their
// one-time sign-in link; with company sign-in (sso) or Google sign-in there is no link and they sign in at origin with
// that account. again: a new link an admin sent later, not the first invite.
function inviteEmail({ name = '', email = '', inviter = '', roleLabel = '', url = '', expiresAt = null, origin = '', sso = false, google = false, again = false, studioName = STUDIO } = {}) {
  const studio = line(studioName) || STUDIO; const who = line(inviter); const role = line(roleLabel); const address = line(email);
  const greeting = line(name) ? `Hi ${line(name)},` : 'Hi,';
  const invited = again ? `${who || 'An admin'} sent you a new link to sign in to the ${studio} studio.` : `${who || 'An admin'} invited you to the ${studio} studio${role ? ` as ${withArticle(role)}` : ''}.`;
  const until = day(expiresAt);
  const subject = again ? `Your sign-in link for the ${studio} studio` : `You’ve been invited to the ${studio} studio`;
  const heading = again ? 'Your sign-in link' : 'You’ve been invited to the studio';
  if (sso || google || !url) {
    const where = line(origin);
    const how = google ? `Choose “Sign in with Google” and use your Google account${address ? ` for ${address}` : ''}.` : 'Sign in with your company account.';
    const at = where ? `Open ${where}, then ${how.charAt(0).toLowerCase()}${how.slice(1)}` : how;
    const text = [greeting, '', invited, '', at, '', `— ${studio}`].join('\n');
    const html = layout({ studioName: studio, heading, paragraphs: [escape(greeting), escape(invited), escape(how)], button: where ? { url: where, label: `Open ${studio}` } : null, footnote: google ? 'No Google account for this address? Choose “Email me a sign-in link” on the sign-in page instead.' : '' });
    return { subject, text, html };
  }
  const care = `This link signs you in once, on one browser, and is just for you, so please don’t forward it.${until ? ` Use it by ${until}.` : ''} Later, sign in from the studio’s sign-in page${who ? ` or ask ${who} for a new link` : ''}.`;
  const text = [greeting, '', invited, '', 'Sign in with your personal link:', url, '', care, '', `— ${studio}`].join('\n');
  const html = layout({ studioName: studio, heading, paragraphs: [escape(greeting), escape(invited)], button: { url, label: `Sign in to ${studio}` }, footnote: `${escape(care)}<br><br>If the button doesn’t work, paste this into your browser:<br><span style="word-break:break-all">${escape(url)}</span>` });
  return { subject, text, html };
}

// signInLinkEmail({ name, url, minutes, studioName }): the link someone asked for on the sign-in page.
function signInLinkEmail({ name = '', url = '', minutes = 20, studioName = STUDIO } = {}) {
  const studio = line(studioName) || STUDIO; const greeting = line(name) ? `Hi ${line(name)},` : 'Hi,';
  const subject = `Sign in to ${studio}`;
  const lead = `Here’s the sign-in link you asked for. It works once, for the next ${minutes} minutes.`;
  const care = 'If you didn’t ask for it, you can ignore this email: nobody can sign in without opening this link.';
  const text = [greeting, '', lead, url, '', care, '', `— ${studio}`].join('\n');
  const html = layout({ studioName: studio, heading: subject, paragraphs: [escape(greeting), escape(lead)], button: { url, label: `Sign in to ${studio}` }, footnote: `${escape(care)}<br><br>If the button doesn’t work, paste this into your browser:<br><span style="word-break:break-all">${escape(url)}</span>` });
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

// A run's error as an email may show it: no file paths, link queries, keys or tokens, on one line, at most 400 characters.
function scrubError(value) {
  return line(value)
    .replace(/\b(https?:\/\/[^/\s?#'"<>]+)[^\s'"<>]*/gi, '$1')
    .replace(/(?<![\w:/.])(?:~|[A-Za-z]:)?(?:[\\/][\w.@~+-]+){2,}[\\/]?/g, '[file]')
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization)\s*[:=]\s*)["']?[^\s"',;]+/gi, '$1[redacted]')
    .replace(/\b(?:sk|re|key|ghp|gho|xox[abp]|apify_api|AKIA)[_-][\w-]{8,}/g, '[redacted]')
    .replace(/[\w-]{32,}/g, '[redacted]')
    .slice(0, 400);
}
const dollars = (value) => `$${(Number(value) || 0).toFixed(2)}`;
// What kind of run it was, as the studio names it.
function runKind({ type = '', quickScan = false, scanReport = false } = {}) {
  if (type === 'research') return quickScan ? 'quick scan' : 'research run';
  return scanReport ? 'quick scan’s trends report' : 'content run';
}

// runStoppedEmail({ title, type, quickScan, scanReport, status, reached, error, costUsd, startedBy, origin, studioName }):
// to admins and whoever started it, when a run ends failed or partial. reached is the last step it showed
// ("Tagging posts · batch 64 of 65"); error is scrubbed here.
function runStoppedEmail({ title = '', type = '', quickScan = false, scanReport = false, status = 'failed', reached = '', error = '', costUsd = 0, startedBy = '', origin = '', studioName = STUDIO } = {}) {
  const studio = line(studioName) || STUDIO; const name = line(title) || 'Untitled run'; const kind = runKind({ type, quickScan, scanReport });
  const partial = status === 'partial'; const who = line(startedBy); const step = line(reached).slice(0, 200); const problem = scrubError(error);
  const Kind = kind.charAt(0).toUpperCase() + kind.slice(1);
  const subject = partial ? `${Kind} partly finished: ${name}` : `${Kind} failed: ${name}`;
  const lead = `The ${kind} “${name}”${who ? `, started by ${who},` : ''} ${partial ? 'finished, but some of its outputs didn’t.' : 'stopped before it finished.'}`;
  const facts = [step ? `It got as far as: ${step}` : '', problem ? `What went wrong: ${problem}` : '', `Cost so far: ${dollars(costUsd)}`].filter(Boolean);
  const retry = 'Open the run and choose “Retry unfinished outputs”: work that already finished is kept and isn’t paid for again.';
  const where = line(origin);
  const footnote = `You’re getting this because you’re an admin of ${studio} or you started this run.`;
  const text = [lead, '', ...facts, '', retry, ...(where ? ['', `Open ${studio}: ${where}`] : []), '', footnote].join('\n');
  const html = layout({ studioName: studio, heading: subject, paragraphs: [escape(lead), facts.map(escape).join('<br>'), escape(retry)], button: where ? { url: where, label: `Open ${studio}` } : null, footnote: escape(footnote) });
  return { subject, text, html };
}

module.exports = { inviteEmail, signInLinkEmail, firstSignInEmail, runStoppedEmail, scrubError, escape, STUDIO };
