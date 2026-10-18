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
  Invite Riley and Alex in **People & access** (password mode makes their links in the same step) and open each in its
  own browser profile.
- Repeat the AI steps on each route, set in Settings → Writing & research: **Claude (signed-in app)**, **Claude API key**
  and **Codex**. Use small, cheap runs; confirm each paid step before it starts.

Record the date, build, route and browser next to each section, and a screenshot for any failure.

## Admin

Mac and web.

- [ ] The left sidebar shows, top to bottom: the wordmark and workspace switcher; **New**, **Search…** and **Ask AI**; the Main nav; the **Studio** group (Prompts, Analytics, People & access, Settings); then the footer with **N running** (while work runs), the **Simple | Advanced** switch and the account menu. Switching layout keeps focus on the radio and the sidebar doesn't flash.
- [ ] Account menu → **View as** lists Admin, Editor, any custom roles, and a **View as a channel owner** group.
- [ ] Simple has no top tab bar. On the Mac, the window drags from the top of the main column and from the top of the sidebar; buttons there still click.
- [ ] Below 860px: a top bar with **Menu**; the drawer opens with focus on the current item, the page behind is inert, **Esc** and the scrim close it, and focus returns to **Menu** (check in Safari, where clicking doesn't focus buttons). In Advanced, **Data tools** inside the drawer opens or closes the group without closing the drawer; choosing a page closes it.
- [ ] Account menu → **View as** → **Editor**: a banner "Previewing what an editor sees. Buttons that change things are off." takes focus. The editor's buttons (Yes, use it, Skip, Find new trends, Write reports, Edit, Make channel assets, Ask AI about this, the Ask box) are visible and turned off, with the reason on hover. Settings, Analytics and People are gone. **Back to Admin** ends it.
- [ ] Account menu → **View as a channel owner** → **Semrush Blog**: the channel screens, with every write button turned off; reading the brief, opening files and Save/Download folder still work.
- [ ] A preview survives a state push (start or finish a run in another window) and clears on restart (Mac) or sign-out (web).
- [ ] **Reports**: **Edit**, change the text, **Save** (⌘S). The reader shows "Edited by …". In a second window, open the same report, then save an edit in the first window: the second window reads the report again; if it was mid-edit, its save is refused with who and when, and its text stays with **Copy my text**.
- [ ] **Restore the original** asks first, then shows the generated text.
- [ ] With Google publishing connected: **Save to Google Drive** on a delivered run, edit its report, save to Drive again: it succeeds and Drive gets a new Doc ending in "(edited)" next to the untouched original. An edit with an `http://` link still saves to Drive (the link shows as text).
- [ ] **Save folder** on a kit made from pasted text includes "Source — <title>.md".
- [ ] **People & access › People** (web): the coverage strip says "All 10 channels have an owner" or names the open ones with **Assign** (which opens Invite set to that channel). Search (press **/**), the Role, Status, Channel and Sort filters and the live count work; "No one matches" offers **Clear filters**. Below 860px the rows are cards. The tab you were on is still open after a reload.
- [ ] **Invite people**: paste three addresses at once (one invalid, one already in the studio, one listed twice): each is flagged and skipped; names are optional and default from the email. Invite as a Channel owner asks for the channel. In password mode the result lists each person with **Copy link** / **Copy message** and **Copy all links**; with company sign-in it says where they sign in and offers **Copy invite message**.
- [ ] **Person sheet**: Details (name, email, role cards with Can/Can’t, channel for a channel role), Access (Role default · On · Off per capability; locked rows say why; turning on Start research for someone without See research and evidence turns that on too, with a note; the summary reads "Riley can do N of 22 things · 1 change from Editor"), Sign-in (make or turn off the link) and Activity (the access log about them, **Load older**). Save sends only what changed. You can't change your own role or access, or the last admin's role. Disable, enable and remove ask first in the studio's own dialog.
- [ ] **People & access › Roles**: the matrix shows Admin locked ("Everything. Can’t be changed."), Editor, Channel owner and any custom roles, grouped, with **Costs money** tags. Turning off **See research and evidence** for Editor turns off what needs it, with a note; the dirty bar reads "N changes · affects M people"; **Review and save** lists each role's changes and who's affected, then saves once. Saving from a second admin window that opened earlier says who changed roles and when, with **Reload**. Settings and People and access can't be turned on for anyone. Below 860px, **Show** picks one role at a time and the page never scrolls sideways.
- [ ] **New role** from Viewer: the new column starts with reads and **Use Ask AI** only. Give it to a person: they see no costs anywhere (state, report reader, run cards, Ask AI) and no Sheets or Data tools. **Ask AI** works, with "Saved for you only. AI can be mistaken." under the box. **Rename** and **Delete** (which asks where to move its people) work; a role in use can't be deleted without moving them.
- [ ] **Preview as…**: a role, a custom channel role (asks which channel) and one person ("Previewing what Riley Jones (Editor, 1 change) sees."). The preview matches what that person sees; every write is refused; **Back to Admin** ends it.
- [ ] **People & access › Access log**: each change above is a sentence ("Alex turned off Edit AI prompts for Editor · affects 4 people · Oct 17, 10:42") that opens to show its changes; the Person, Role and What filters, **Load older** and **Download CSV** work. Turning off a sign-in link is logged.
- [ ] On the Mac: People shows the Mac note with Preview buttons per channel and Preview as an editor; Roles and Access log work, and a role change shows in View as at once.
- [ ] **Analytics**: the range chips, funnel, Channels table (**Copy reminder**), Trends × channels matrix (cell details, **Change answer**), **Show skipped and waiting**, Recent activity and **Download CSV**.
- [ ] Web, workspace switch: the picker asks first ("Everyone using the studio … switches"). An editor with an unsaved report edit keeps the editor open with a note and **Copy my text**.

## Editor

Web (and Mac View as for the visible parts).

- [ ] The sidebar shows the workspace and "Editor" as text, not pickers. The **Studio** group has only Prompts. No View as, Settings, Brand knowledge, Analytics or People & access. ⌘, does nothing.
- [ ] With **Start research** turned off for Editor (Roles tab), **Find new trends** is gone, and a call by hand is refused with "Your access doesn’t include “Start research”. Ask <admin> if you need it." Turned back on for this one person (their Access tab), it works again for them only.
- [ ] Trends: decide trends (and **Undo**), **Write reports**, **Find new trends** (a second search with the same program asks first and names who started the first).
- [ ] Reports: edit and save; make channel assets for any channel. In Advanced, **Make channel assets** (Library preview, a Ready card on the Trend board) opens the dialog over the page without switching layout.
- [ ] **Prompts** opens and an edit saves as a new version; **New → Quick scan** opens Ask AI with the plan, and nothing runs before **Start scan**.
- [ ] A trend card's **Show 2 real posts** shows two posts (or "No posts saved for this trend.") without any AI cost.
- [ ] Ask AI answers without offering Settings; "Show me" never points at admin-only places.
- [ ] Errors that need an admin say "The studio’s AI or data connection needs attention. Ask <admin>." with no model names, credit or billing: try it by signing the AI route out (Claude app) or removing the API key (API key route).
- [ ] Sheets: editors can rename, replace and remove imported workbooks.
- [ ] Opening any admin URL or calling an admin action by hand (devtools) is refused by the server.

## Channel owner

Web, on a desktop browser and a phone; then Mac View as.

- [ ] Only **Trends** (with a new count), **My assets**, **My plan**, **Inbox** and **Ask AI** (with its ⌘J / Ctrl+J key). No layout switch, no Settings. On a phone, a bottom nav (with Ask AI), and Sign out under "…".
- [ ] **Ask AI**: "What's new for my channel?" names only trends offered to Blog; asking about Social's drafts, research runs, prompts or costs says that isn't part of what they can see. "Generate drafts for <trend>" lists Blog's files and minutes (no money) before **Generate**; "We're using <trend>" opens a card with Blog as the only channel. The line under the box says "Saved for you only. AI can be mistaken." Conversations the person had before they were Blog's channel owner (as an editor, or for another channel) don't show here.
- [ ] Turn **Use Ask AI** off for Channel owner in **People & access › Roles**: the entry leaves the sidebar and the phone bar on the next push, ⌘J does nothing, and calling `help:ask` by hand is refused. Turn it back on: it returns. A restart keeps whichever you chose.
- [ ] **View as** Blog's channel owner: the Ask AI entry and page show, the question box is off ("Buttons that change things are off in a preview."), and the server refuses a question.
- [ ] A custom role built on Channel owner (for example Channel reviewer) gets the same channel screens, without **Generate for my channel** when it can’t make assets.
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
