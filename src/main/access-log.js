'use strict';
// The access log in words: each team-store audit row (who changed people, roles or access) becomes one plain sentence,
// such as "Alex turned off Edit AI prompts for Editor". The People page adds who it affects and when. Pure CommonJS,
// Electron-free; labels come from the row itself (role names are kept at the time of the change) or the policy.
const roles = require('./roles');

const list = (value) => (Array.isArray(value) ? value : []);
const possessive = (name) => `${name}’s`;
// "a, b and c"
function joinAnd(parts) {
  const rows = parts.filter(Boolean);
  if (rows.length <= 1) return rows[0] || '';
  return `${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`;
}

function context(ctx = {}) {
  const channels = new Map(list(ctx.channels).map((channel) => [channel.id, channel.name]));
  return {
    capability: (id) => (typeof ctx.capabilityLabel === 'function' ? ctx.capabilityLabel(id) : roles.capLabel(id)),
    channel: (id) => channels.get(id) || (typeof ctx.channelName === 'function' ? ctx.channelName(id) : '') || id || 'no channel',
    role: (id, label) => label || (typeof ctx.roleLabel === 'function' ? ctx.roleLabel(id) : '') || roles.ROLES.find((role) => role.id === id)?.label || 'another role',
  };
}

// One capability change for a person: "turned on Ask AI", "turned off Sheets", "set Sheets back to the role’s default".
function personCapability(change, c) {
  const what = c.capability(change.capability);
  if (change.to === 'on') return `turned on ${what}`;
  if (change.to === 'off') return `turned off ${what}`;
  return `set ${what} back to the role’s default`;
}

// row: { kind, by:{ name }, target:{ type, id, name }, changes:[…], affected } → a sentence.
function describeAuditRow(row, ctx = {}) {
  const c = context(ctx);
  const who = String(row?.by?.name || 'Someone');
  const name = String(row?.target?.name || (row?.target?.type === 'role' ? 'a role' : 'someone'));
  const changes = list(row?.changes);
  const field = (key) => changes.find((entry) => entry.field === key);
  switch (row?.kind) {
    case 'member-added': {
      const role = field('role'); const channel = field('channelId');
      const extra = changes.filter((entry) => entry.field === 'capability').length;
      return `${who} added ${name} as ${c.role(role?.to, role?.toLabel)}${channel?.to ? ` for ${c.channel(channel.to)}` : ''}${extra ? ` with ${extra} ${extra === 1 ? 'access change' : 'access changes'}` : ''}`;
    }
    case 'member-changed': {
      const parts = [];
      for (const entry of changes) {
        if (entry.field === 'role') parts.push(`role from ${c.role(entry.from, entry.fromLabel)} to ${c.role(entry.to, entry.toLabel)}`);
        else if (entry.field === 'name') parts.push(`name to ${entry.to}`);
        else if (entry.field === 'email') parts.push(`email to ${entry.to || 'none'}`);
        else if (entry.field === 'channelId') parts.push(`channel to ${c.channel(entry.to)}`);
      }
      const reset = changes.some((entry) => entry.field === 'grant' || entry.field === 'deny');
      if (reset) parts.push('own access back to the role’s');
      return parts.length ? `${who} changed ${possessive(name)} ${joinAnd(parts)}` : `${who} changed ${name}`;
    }
    case 'member-disabled': return `${who} disabled ${name}`;
    case 'member-enabled': return `${who} turned ${name} back on`;
    case 'member-removed': return `${who} removed ${name}`;
    case 'member-access': {
      const rows = changes.filter((entry) => entry.field === 'capability' && entry.capability);
      if (rows.length === 1) return `${who} ${personCapability(rows[0], c)} for ${name}`;
      return `${who} changed ${rows.length} things ${name} can do: ${joinAnd(rows.map((entry) => personCapability(entry, c)))}`;
    }
    case 'link-issued': return `${who} made a new sign-in link for ${name}`;
    case 'link-revoked': return `${who} signed ${name} out of every browser`;
    case 'role-created': {
      const base = field('base');
      return `${who} made the ${name} role, built on ${c.role(base?.to, base?.toLabel)}`;
    }
    case 'role-changed': {
      const parts = [];
      const label = field('label'); const description = field('description');
      const turned = changes.filter((entry) => entry.field === 'capability' && entry.capability);
      const on = turned.filter((entry) => entry.to === true).map((entry) => c.capability(entry.capability));
      const off = turned.filter((entry) => entry.to === false).map((entry) => c.capability(entry.capability));
      if (label) parts.push(`renamed the ${label.from} role to ${label.to}`);
      if (description) parts.push(`changed the ${label ? label.to : name} role’s description`);
      if (on.length) parts.push(`turned on ${joinAnd(on)}`);
      if (off.length) parts.push(`turned off ${joinAnd(off)}`);
      if (!parts.length) return `${who} changed the ${name} role`;
      return `${who} ${joinAnd(parts)}${on.length || off.length ? ` for ${label ? label.to : name}` : ''}`;
    }
    case 'role-deleted': {
      const moved = field('role');
      const count = Number(row?.affected) || 0;
      return `${who} deleted the ${name} role${moved?.to && count ? ` and moved ${count} ${count === 1 ? 'person' : 'people'} to ${c.role(moved.to, moved.toLabel)}` : ''}`;
    }
    case 'policy-changed': {
      const entry = changes.find((item) => item.field === 'capability' && item.capability);
      if (!entry) return `${who} changed what ${name} can do`;
      return `${who} turned ${entry.to ? 'on' : 'off'} ${c.capability(entry.capability)} for ${name}`;
    }
    default: return `${who} changed access`;
  }
}

// The rows the People page shows: who did it (name only), the sentence, and the rest as stored.
function accessLogRows(rows, ctx = {}) {
  return list(rows).map((row) => ({ id: row.id, at: row.at, by: { name: String(row.by?.name || 'Someone') }, kind: row.kind, text: describeAuditRow(row, ctx), target: row.target, changes: list(row.changes), affected: Number(row.affected) || 0 }));
}

module.exports = { describeAuditRow, accessLogRows };
