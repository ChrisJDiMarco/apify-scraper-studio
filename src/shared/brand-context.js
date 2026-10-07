const PROFILE_FIELDS = { name: 120, offering: 3000, audience: 800, positioning: 3000, icp: 3000, brandVoice: 2000, forbiddenClaims: 3000 };
function validateBrandContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Brand context must be an object.');
  const profile = {};
  for (const [key, limit] of Object.entries(PROFILE_FIELDS)) {
    if (input[key] != null && typeof input[key] !== 'string') throw new Error(`Brand ${key} must be text.`);
    profile[key] = String(input[key] || '').trim();
    if (profile[key].length > limit) throw new Error(`Brand ${key} must be ${limit} characters or fewer.`);
  }
  if (!profile.name) throw new Error('Add a brand or company name.');
  if (input.competitors != null && !Array.isArray(input.competitors)) throw new Error('Competitors must be a list.');
  if ((input.competitors || []).length > 20) throw new Error('Keep this context to 20 competitors or fewer.');
  profile.competitors = (input.competitors || []).map((value) => {
    const name = String(value?.name || '').trim();
    if (name.length > 120) throw new Error('Competitor names must be 120 characters or fewer.');
    let domain = String(value?.domain || '').trim();
    if (domain) {
      let url;
      try { url = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`); } catch (_) { throw new Error('Use a valid competitor website domain.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) throw new Error('Use a public competitor domain without credentials.');
      domain = url.hostname.toLowerCase();
    }
    if (!name && !domain) return null;
    return { name: name || domain, domain };
  }).filter(Boolean);
  return profile;
}
function accountForUrl(value, profile) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    const account = (profile?.competitors || []).find(item => { const domain = String(item.domain || '').toLowerCase().replace(/^www\./, ''); return domain && (hostname === domain || hostname.endsWith(`.${domain}`)); });
    return account?.name || hostname;
  } catch (_) { return ''; }
}
module.exports = { validateBrandContext, accountForUrl, PROFILE_FIELDS };
