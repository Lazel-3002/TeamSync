# TeamSync redesign — handoff prompt for Claude Code

Paste everything below the line into Claude Code, opened in the `kanka-voice`
repo (branch `feat/discord-shell-phase1`).

---

You are continuing a Discord-style redesign of **TeamSync** (repo `kanka-voice`,
Electron 43, vanilla JS — NOT React; `src/` is a dead prototype, ignore it).
The owner is Turkish; UI default language is Turkish. Work on branch
`feat/discord-shell-phase1` (or a branch created from it). Never `git stash`
(other sessions edit this repo); commit after each working step.

## What the owner asked for (from his sketches)
Discord-like app: server rail, DM column, friends page, user panel, status
(Aktif/Boşta/Rahatsız Etmeyin/Görünmez + durations), profile card (banner/GIF,
avatar frames, bio), automatic "Oynuyor" game detection with a timer, friend
groups whose call header looks like MS Teams (caller avatar + `00:12` timer +
"Katıl" button + member count), custom typing effect ("Lazel is purring 🐱…",
emoji allowed), emoji shortcodes/reactions (`:thumbsup:`), and servers with
text+voice channels (occupants listed under voice channels with per-user
timers), roles, role permissions, who-can-see/send per channel, slow mode,
invite links with expiry (1d/3d/7d/30d/unlimited), server search.

## Decisions already made with the owner (do not re-ask)
- Delivered **phase by phase**; the owner tests between phases.
- **No chat/server messages in Supabase** (free plan). Supabase = device login,
  `profiles` row, public `avatars` storage bucket only. Room chat is never
  persisted to Supabase.
- **Servers are hosted on PCs**: the owner's PC + accepted co-hosts keep an
  encrypted replicated copy (channels, roles, members, bans, invites,
  history). Server is up while ≥1 host is online; no host online → server icon
  greyed out, cached history read-only, can't send or join voice.
- **Friend groups: every member is a host** (each stores the chat; on coming
  online you backfill missed messages from any online member).
- Old ID+password rooms stay as **"Hızlı Arama" (Quick call)** under the rail
  "+" button for old-client compatibility.

## Phase 1 — DONE (commits 3d49860, 4506d6e)
- `js/shell-core.js` (router `TSShell.setView('friends'|'dm'|'call')`, rail,
  user panel, voice-mini, quick-call overlay, Ctrl+K switcher). It is
  **observer-driven**: it watches class changes on `#step-*`, `#login`, `#app`
  instead of rewriting old flows. `#app` (room screen) is WRAPPED in
  `#view-call` in index.html, never moved at runtime (`.app > .main` and
  `document.querySelector('.main')` depend on it). The call view hides with
  `visibility:hidden` (`.is-bg`), never `display:none`.
- `#step-action` (old dashboard) stays in the DOM but is CSS-hidden while
  `body.shell-active`; old buttons (`#btn-show-create/join`, `#btn-logout`,
  `#menu-settings`) are driven with `.click()` — E2E harness depends on them.
- `js/shell-friends.js` (tabs, pending, add, Active Now), `js/shell-dm.js`
  (DM list + unread, grouped DM view; `renderDMs` in renderer.js calls
  `TSDM.groupedHtml`), `js/call-tiles.js` (`.ptile[data-tile-uid]` — never use
  `data-uid`/`.vcard` for new things), `js/status.js` (`TSStatus`),
  `js/profile.js` (`TSProfile`, P2P `req_profile`/`res_profile`, image URLs
  only accepted from the Supabase avatars bucket), `js/activity.js` +
  `electron/activity-detector.js` + `electron/activity-parsers.js`
  (Steam/Epic/known-games detection, Steam `RunningAppID` wins),
  `js/ts-ui.js` (avatars, status dots, elapsed ticker, popovers).
- Presence payload gained optional `v:2, st, cs:{t,e}, act:{k,n,el,sid}, pr`.
  Room `hello` gained `presence:{st,act}`. DMs gained `mid` (dedupe).
- CSS: `css/shell.css`, `css/messages.css`, `css/call.css`, `css/profile.css`
  — only theme tokens; no box-shadow for meaning (Simple UI kills it), no
  backdrop-filter; never give `.main` `container-type`.
- New UI strings: `resources/localization/shell-strings.js` (tr+en, merged
  after the catalog loop in renderer.js). Never add to `LEGACY_TEXT_EN`.
- Tests: `npm run test:e2e` (all green: 30 tests). New ones:
  `shell-navigation`, `status-presence` (2 real peers), `activity-detector-parse`.
  Harness helpers: `waitForShell`, `waitStableIdentity`, `makeFriends`.
- `supabase/profile_media.sql` — storage policies for `<uid>/banner.*` and
  `<uid>/avatar_anim.gif` + `profiles.profile_ext jsonb`. **Already applied**
  to the live project `zperyrjpfumtblossyod` (2026-09-23) and verified with a
  real upload.
- Live DB hardening (2026-09-23, migration `lock_profiles_and_handle_new_user`):
  `profiles` rows are readable/writable only by their owner (they used to be
  world-readable incl. friend lists); `handle_new_user()` has a fixed
  search_path and can't be called via RPC. The app only ever reads its own row.
  ~1,480 throwaway E2E accounts were deleted; 7 real accounts remain.
- E2E tests now run the app with `TEAMSYNC_E2E_OFFLINE=1` (set in
  `test/e2e/lib/harness.js`): no Supabase login, classic first-run name step,
  so test runs no longer create real accounts. Use `TEAMSYNC_E2E_ONLINE=1`
  only for a test that truly needs the real backend.

## Phase 2 — NEXT: friend groups, typing indicator, emoji & reactions
Build a shared **space engine** in `js/space/*` (used again in Phase 3):
- Identity: WebCrypto P-256 ECDSA (`ik`, signing) + ECDH (`ek`) per account,
  non-extractable, stored in IndexedDB; public keys published in
  `res_profile`, bound to the friend ID on first use (warn on key change).
- A space = signed event log. Groups: every member is a host. Group key
  `K_g` (AES-GCM-256) delivered to invitees via ECDH-wrapped `grp_invite` on
  their personal topic `teamsync/user/<friendId>/events`. Topics derived from
  `HMAC(K_g,…)`: `teamsync/s/<T>/hb` (heartbeat), `/ev` (events+receipts),
  `/to/<H(fid)>` (directed backfill), `/eph` (typing, call state).
  Hybrid logical clock ordering; IndexedDB `ts-spaces-<fid>`; ≤56 KB per
  publish (fragment above), ~15 ms pacing; re-subscribe after broker failover
  (`setupGlobalMQTT`/`connectGlobalBroker` in renderer.js). Kick/leave rotates
  the key. Max 25 members.
- UI: "+" next to "DİREKT MESAJLAR" creates a group (pick friends); groups in
  the DM list with stacked avatars + member count; group view header like
  Teams: name, member count; during a call: caller avatar, `00:12` timer,
  **Katıl** (or Ayrıl). Group call = existing room via `window.TSRoom.start`
  with roomId `gc-<HMAC(K_g,'call:'+epoch)>`; `call` heartbeat every 5 s on
  `/eph`; ring toast with Accept/Decline (silent in DND via `TSStatus.isDnd()`).
- Typing: 1:1 `dm_typing{fromId, tv}` on the personal topic; groups `typing`
  on `/eph`; max 1 per 3 s, shown 6 s; `tv` = typer's own verb
  (`TSProfile.typingVerbOf`, saved in the profile editor already), ≤24 chars,
  escaped. Not sent while invisible.
- Emoji: `resources/emoji/shortcodes.json` (emojibase data, MIT) + Turkish
  aliases; autocomplete after `:` + 2 chars; `:thumbsup:` → 👍; emoji-only
  messages rendered large. Reactions: 1:1 `dm_react{mid,e,op}` stored on the
  message; groups via engine events.
- DM reliability: outbox + `dm_ack{mid}`, resend when the friend comes online.
- Tests: 3-peer group (offline member catches up; kicked member stops
  receiving after key rotation); typing/reactions between 2 peers; group call
  ring + Katıl + timer; Node unit test that random delivery order yields the
  same state.

## Phase 3 — later: hosted servers
Same engine. Owner + accepted co-hosts (`host.offer` → `host.accept`) store
everything; members cache last 500 msgs/channel. Hosts receipt events
(`{host,hseq,hlc,hsig}`); every PC re-validates signatures, membership, bans,
Discord-style permission bitfield with role/member channel overrides, slow
mode. Private channels get their own key, rotated on revoke. Invites
`teamsync://invite/<sid8>-<code>` (1d/3d/7d/30d/never, max uses): joiner and
host meet on `teamsync/inv/<H(code)>`, ECDH + HMAC proof so the code never
crosses the wire. Voice channels map to rooms `sv-<HMAC(K_s,ch)>` via a new
`TSRoom.joinOrCreate` (alone is not an error); occupancy beacons every 10 s
give per-user timers under each voice channel. No host heartbeat for 25 s →
greyed/read-only. Server search = signed directory beacons on
`teamsync/dir/v1/…` while a host is online. Export/backup `.tsspace` file.

## How to verify (the standard in this repo)
Real Electron instances over CDP (`test/e2e/lib/harness.js`): `spawnPeer`,
`createRoom`, `joinRoom`, `waitForPeerConnected`, `makeFriends`. Take
screenshots with `Page.captureScreenshot` and look at them. Run
`npm run test:e2e` before every commit. After code changes run
`graphify update .`.
