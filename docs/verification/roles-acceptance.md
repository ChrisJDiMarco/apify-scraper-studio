# Roles: manual acceptance checklist

Run this before each release that touches roles, sign-in or the sidebar, after `npx vitest run`, `npm run build` and
`npm run build:web` pass. It covers what tests can't: real windows, real browsers and real AI routes. Design and
behaviour are in `docs/roles-and-access.md`.

## Setup

- **Mac**: the built app (`npm run start:semrush`), Semrush workspace, with at least one approved trend whose brief is
  written, one channel set for Semrush Blog and one set shared by Blog and Social.
- **Web**: `npm run build:web`, then the server with its secrets on standard input (see `docs/web-deploy.md`, Secrets):
  `STUDIO_DATA_DIR=… STUDIO_SECRETS_FD=0 npm run start:web < secrets`. Confirm the startup lines name the sign-in mode
  and print **no** warning about secrets in the environment. Use a copy of the Mac data folder.
- People: one admin (you), one editor (Riley), one Semrush Blog channel owner (Alex), one person with no role.
  Make sign-in links for Riley and Alex in **People & roles** and open each in its own browser profile.
- Repeat the AI steps on each route, set in Settings → Writing & research: **Claude (signed-in app)**, **Claude API key**
  and **Codex**. Use small, cheap runs; confirm each paid step before it starts.

Record the date, build, route and browser next to each section, and a screenshot for any failure.

## Admin

Mac and web.

- [ ] The left sidebar shows the brand, the workspace card, the **View as** card, the **Simple | Advanced** switch, the Main nav, the **Admin** nav (Analytics, People & roles), Settings and the footer. Switching layout keeps focus on the radio and the sidebar doesn't flash.
- [ ] Simple has no top tab bar. On the Mac, the window drags from the top of the main column and from the top of the sidebar; buttons there still click.
- [ ] Below 860px: a top bar with **Menu**; the drawer opens with focus on the current item, the page behind is inert, **Esc** and the scrim close it, and focus returns to **Menu** (check in Safari, where clicking doesn't focus buttons). In Advanced, **More tools** inside the drawer opens more tools without closing it; choosing a page closes it.
- [ ] **View as → Editor**: a banner "Previewing what an editor sees. Buttons that change things are off." takes focus. The editor's buttons (Yes, use it, Skip, Find new trends, Write the reports, Edit, Make channel assets, Ask AI about this, the Ask box) are visible and turned off, with the reason on hover. Settings, Analytics and People are gone. **Back to Admin** ends it.
- [ ] **View as → Semrush Blog**: the channel screens, with every write button turned off; reading the brief, opening files and Save/Download folder still work.
- [ ] A preview survives a state push (start or finish a run in another window) and clears on restart (Mac) or sign-out (web).
- [ ] **Reports**: **Edit**, change the text, **Save** (⌘S). The reader shows "Edited by …". In a second window, open the same report, then save an edit in the first window: the second window reads the report again; if it was mid-edit, its save is refused with who and when, and its text stays with **Copy my text**.
- [ ] **Restore the original** asks first, then shows the generated text.
- [ ] With Google publishing connected: **Save to Google Drive** on a delivered run, edit its report, save to Drive again: it succeeds and Drive gets a new Doc ending in "(edited)" next to the untouched original. An edit with an `http://` link still saves to Drive (the link shows as text).
- [ ] **Save folder** on a kit made from pasted text includes "Source — <title>.md".
- [ ] **People & roles** (web): add, edit, disable, enable and remove people; make a link (and a new one, which signs the old browser out at once); turn a link off. You can't demote yourself or remove the last admin. On the Mac: no Add a person; Preview buttons per channel and Preview as an editor.
- [ ] **Analytics**: the range chips, funnel, Channels table (**Copy reminder**), Trends × channels matrix (cell details, **Change answer**), **Show passed and pending**, Recent activity and **Download CSV**.
- [ ] Web, workspace switch: the picker asks first ("Everyone using the studio … switches"). An editor with an unsaved report edit keeps the editor open with a note and **Copy my text**.

## Editor

Web (and Mac View as for the visible parts).

- [ ] The sidebar shows the workspace and "Editor" as text, not pickers. No View as, Settings, Brand knowledge, Analytics or People. ⌘, does nothing.
- [ ] Trends: decide trends, **Write the reports**, **Find new trends** (a second search with the same program asks first and names who started the first).
- [ ] Reports: edit and save; make channel assets for any channel.
- [ ] Ask AI answers without offering Settings; "Show me" never points at admin-only places.
- [ ] Errors that need an admin say "The studio’s AI or data connection needs attention. Ask <admin>." with no model names, credit or billing: try it by signing the AI route out (Claude app) or removing the API key (API key route).
- [ ] Sheets: editors can rename, replace and remove imported workbooks.
- [ ] Opening any admin URL or calling an admin action by hand (devtools) is refused by the server.

## Channel owner

Web, on a desktop browser and a phone; then Mac View as.

- [ ] Only **Trends** (with a new count) and **My assets**. No layout switch, no Ask AI, no Settings. On a phone, a bottom nav, and Sign out under "…".
- [ ] The welcome card shows once; **Got it** hides it for good.
- [ ] Filters New · Using · Not for us · All; **Earlier** holds trends from before joining. Answering an Earlier trend under **All** moves it into the list with focus on it.
- [ ] **Read the brief** shows the edited brief and who edited it.
- [ ] **Generate for my channel**: the sheet lists this channel's files and minutes, never money or a model, on all three AI routes (Codex included). Progress shows on the card; **Stop** works on a set made for this channel alone.
- [ ] A set shared with other channels that failed this channel's file says "This set was made with other channels. Ask an editor." and still offers **Open my assets** when earlier drafts exist; if an earlier Blog-only set finished, the card shows that set instead.
- [ ] With the AI route signed out or out of credit, a set fails with "Ask an admin: the AI connection needs attention." on the card, no **Finish the rest**, and the same line in My assets.
- [ ] **Yes, I’m using this trend**, then **Add the link when it’s live** with a bare domain (`semrush.com/blog/x`): saved with https://. Have an admin clear the answer in Analytics: the card updates on the next push.
- [ ] **My assets**: sets by trend, newest first; a set's line says where to finish it (on Trends, ask an editor, or ask an admin). Pictures load once (no repeated downloads in the network panel). Opening My assets from the nav starts at the top; from a card's **Open my assets** it jumps to that trend once.
- [ ] Reading another channel's file, or calling a write by hand, is refused.
- [ ] Opening 6+ tabs: the oldest stops live updates; the admin's tabs still get updates.

## No access

- [ ] A person not in People (company sign-in) sees "You’re not in this studio yet", their email, the admins to ask, **Check again** and **Copy my email**. After an admin adds them, **Check again** lets them in.
- [ ] A disabled person sees "Your access to this studio is paused."
- [ ] An expired or replaced link shows "This sign-in link doesn’t work anymore. Ask your studio admin for a new one." with no password form.

## Sign-in and the server

- [ ] Twenty bad link tries from one browser don't stop another person's link or the admin password from working.
- [ ] Eleven wrong admin passwords in a minute block password tries from that client only (with `STUDIO_TRUST_PROXY=1` behind the proxy).
- [ ] `STUDIO_LINK_DAYS=0.5` gives links that stop working after 12 hours, and People shows that date.
- [ ] On the Codex route, ask Ask AI (as an editor) to print the server's environment: neither the secret key nor the admin password appears.
