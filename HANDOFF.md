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

## Phase 2 — DONE: friend groups, group calls, typing, emoji, reactions
Files: `js/space/crypto.js` (TSCrypto), `js/space/store.js` (TSSpaceStore),
`js/space/groups.js` (TSGroups — the "space" engine), `js/ui/group-view.js`
(TSGroupUI), `js/ui/emoji.js` (TSEmoji), `js/ui/typing.js` (TSTyping),
`js/dm-extras.js` (TSDMX), `css/groups.css`, `resources/emoji/shortcodes.js`
(emojibase-data 16, MIT, + Turkish aliases like `:kalp:` `:agla:` `:ates:`).
- **Identity**: per-account ECDSA P-256 (`ik`) + ECDH P-256 (`ek`), private
  keys non-extractable in IndexedDB `ts-identity`. Public keys travel in
  `res_profile.keys`; stored TOFU in localStorage `teamsync_peer_keys_<me>`
  (`TSCrypto.rememberPeer/peerKeys`), toast on key change.
- **Group = signed event log stored by every member** in IndexedDB
  `ts-spaces-<friendId>` (stores `spaces`, `events` index `[gid, ts]`).
  Event `{id, gid, author, type, body, ts, sig}` (ECDSA over canonical JSON).
  Types: `msg`, `react`, `msg.del`, `rename`, `member.add` (carries ik/ek),
  `member.remove` (owner only), `member.leave`, `call.start`. Every receiver
  verifies signature + membership + permission before storing.
- **Transport**: AES-GCM with group key over the existing global MQTT client;
  topics `teamsync/s/<T>/ev|eph|to/<H>` where T/H are HMACs of the key (routed
  in renderer.js `client.on('message')` before JSON.parse; re-subscribed in
  the `connect` handler after broker failover).
- **Catch-up**: heartbeat on `/eph` every 20 s `{last ts, n events}`; a member
  that is behind sends `sreq` to that member, who replies on the requester's
  `/to/` topic in ≤30-event batches (paced). Probe on subscribe.
- **Invites**: `grp_invite` on the friend's personal topic, group key wrapped
  with ephemeral ECDH → HKDF → AES-GCM to the friend's `ek`, signed by the
  inviter; only accepted from non-muted real friends. Friends whose keys are
  unknown (offline/old version) go to `pendingInvites` and are invited when
  their keys arrive. **Kick** → owner rotates key (`grp_key`, epoch+1) to the
  remaining members; kicked member's app drops the group. Owner leaves →
  earliest-joined member becomes owner and rotates.
- **Group calls**: room `gc-<HMAC(key,'call|gid|epoch')>` via
  `window.TSRoom.start` (starter = founder, others join with
  `state.isJoining=true` + own 15 s timeout). Call beacons on `/eph` every 5 s
  → Teams-style header pill (caller avatar, `00:12` timer, avatars, Katıl /
  Ayrıl) + DM-list row "🔊 Aramada · 0:13" + ring card (`.grp-ring`, silent in
  DND).
- **DMs**: `dm_typing{fromId,name,tv}`, `dm_react{mid,e,op}` (reactions stored
  as `m.reactions = {emoji: ['me'|'them']}`), `dm_ack{mid}`; text DMs to
  friends on presence `v>=2` are tracked in an outbox (`teamsync_dm_outbox_<me>`)
  and resent when the friend comes back online (receiver dedupes by `mid`,
  also via `mergedIds`). Pending messages render faded with ⏱.
- **Typing**: each person's own verb from the profile editor ("mırlıyor 🐱"),
  max 1 signal / 3 s, shown 6 s, never sent while invisible.
- **Emoji**: `:code:` → emoji on send (DM, group, room chat), autocomplete
  after `:`+2 chars (capture-phase keydown so Enter picks instead of sending),
  jumbo rendering for emoji-only messages, picker for reactions.
- Tests: `friend-groups.test.js` (3 real peers: invite, live msg, offline
  catch-up, custom typing verb, reaction, kick + key rotation),
  `group-call-dm-extras.test.js` (DM emoji/reaction/typing, offline outbox
  delivered once, group call ring + header + join + tiles).
- **Harness trap fixed**: `waitFor` now awaits promises (before, any
  `.then(...)` condition passed instantly without checking).

## Phase 3 — DONE: PC-hosted servers
Files: `js/space/server-state.js` (TSServerState — PURE, also `require`-able
from Node), `js/space/servers.js` (TSServers — network/storage/hosting),
`js/ui/server-view.js` (TSServerUI), `js/ui/server-dialogs.js`
(TSServerDialogs), `css/servers.css`, `electron/deep-link.js`.
Store: `js/space/store.js` is now DB v2 (`ctl` store for control events +
`by_space_ch_ts` index); groups skip records with `kind:'server'`.
- **Model**: a server is a signed event log. Control events (`srv.*`, `ch.*`,
  `role.*`, `member.*`, `ban.*`, `invite.*`, `host.*`) are replicated to every
  member and folded by `TSServerState.derive(events, {genesis})` — sorted by
  (ts,id), each checked against the state at that point (Discord permission
  bits, role hierarchy `outranks`, "can't grant what you don't have", channel
  overrides everyone → roles → `u:<fid>`). `genesis` pins the real
  `srv.create` (a member can't forge an older one). State keeps `keys[fid]`
  (all signing keys ever used) and `everHosts` for signature checks.
  Message events (`msg`, `msg.edit`, `msg.del`, `react`) carry top-level `ch`.
- **Hosts** = owner + co-hosts who accepted `host.offer` (max 5). Members
  submit signed events on `/sub`; an online host checks perms/slow mode/bans
  (`checkMessage`), adds `acc {h, at, hs}` (host signature over id+author sig)
  and publishes on `/ev`. Every receiver verifies BOTH signatures. Several
  hosts online → rank by owner-first then fid; rank>0 waits 700ms·rank.
  Host heartbeat `hhb` every 10 s on `/eph` (cn/clast = control count/last,
  n/last = message count/last). No `hhb` for 26 s → offline → grey rail icon,
  read-only composer, voice disabled. Hosts sync each other (`hsreq`), members
  fetch control log (`creq`) and per-channel history on open (`hreq`,
  "Load older" → `before`). Graceful `bye` on logout/close.
- **Private channels**: any channel some member can't view is "restricted".
  Its events never go on `/ev`: author → each online host with `psub`, host →
  each online viewer via `pev`; ALL `/to/` traffic is pairwise-encrypted
  (ECDH of the two identity keys → HKDF, `pairKey`). Hosts store everything
  (they are trusted by the owner). Members drop events of channels they can't
  view. Private VOICE is only hidden in UI (room id derivable by members).
- **Invites**: code = 10 chars (no I/O). PBKDF2(code, 60k) → meet topic
  `teamsync/inv/<hex>` + AES key. `peek` → server card; `join` → joiner's
  signed `member.join` inside an AES box; host accepts it, replies with the
  server key wrapped to the joiner's ek + `hek` (host ek, to decrypt the first
  pairwise reply before the control log arrives). Requests retry every 3 s.
  Links `teamsync://invite/CODE`: in-app → invite card (MutationObserver fills
  `.inv-card[data-invite]` in DMs/groups/servers); from outside → protocol
  handler (`app.setAsDefaultProtocolClient`, also in `npm start`; NSIS via
  `build.protocols`), a second instance forwards the link over a named pipe.
- **Kick/ban** → the accepting host rotates the key (`rekey` notice on the old
  `/eph`, `srv_key` to members seen recently). Anyone else: no host heartbeat
  → `srv_kreq` to hosts' personal topics → `srv_key` (or `srv_gone` if kicked).
- **Voice channels**: room `sv-<HMAC(key,'voice|sid|ch|epoch')>`, always joined
  as founder (two founders connect fine). Occupancy beacon `vc` every 5 s →
  sidebar list with per-user timers, mute/deaf/LIVE icons.
- **Discovery**: `srv.update {public:true}` + an automatic permanent public
  invite → the rank-0 host publishes a RETAINED signed beacon on
  `teamsync/dir/v1/<hash>` every 5 min (cleared when made private); the
  compass button subscribes to `teamsync/dir/v1/+` for 3.5 s.
- UI: `body[data-home="server"]` swaps the DM column for the channel list;
  `setView('server', sid)`; server menu on the header (invite, settings,
  create channel, hosting, nickname, mark read, leave/delete); settings
  full-screen (overview/public, roles + permission switches, members,
  invites, bans, hosting with offer/revoke/resign); channel settings with a
  tri-state permission grid + slow mode; replies, edits (↑ edits last),
  reactions, @mentions (@everyone only from Manage Server).
- Tests: `server-state.test.js` (Node: hierarchy, overrides, invites, bans,
  hosts, slow mode, order-independence, genesis pin) and `servers.test.js`
  (3 non-friend peers: invite, host accept, private channel confidentiality,
  slow mode, offline read-only, co-host failover + catch-up, voice, kick +
  key rotation).
- Not done / ideas: file & image sharing in server channels, `.tsspace`
  export, @mention autocomplete, per-channel encryption against hosts,
  categories, pinned messages, Ctrl+K search over channels.

## How to verify (the standard in this repo)
Real Electron instances over CDP (`test/e2e/lib/harness.js`): `spawnPeer`,
`createRoom`, `joinRoom`, `waitForPeerConnected`, `makeFriends`. Take
screenshots with `Page.captureScreenshot` and look at them. Run
`npm run test:e2e` before every commit. After code changes run
`graphify update .`.
