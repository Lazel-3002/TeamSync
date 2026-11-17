# Graph Report - TeamSync  (2026-11-17)

## Corpus Check
- 144 files · ~706,766 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2446 nodes · 6001 edges · 103 communities (88 shown, 15 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 202 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7dde565f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- UNO Card Game
- App Shell & Pokedex Data
- Chat & Renderer Utilities
- Electron Main Process
- Pokemon Assets & Landing Docs
- Audio Bitrate & Mic Controls
- User List & Avatars
- Electron Builder Config
- Sidebar UI Components
- WebRTC ICE & TURN
- E2E Test: MQTT/First Run
- E2E Test Harness
- E2E Test: Scroll/Download
- Native Dependencies
- Shared Browser Feature
- Focus Mode UI
- E2E Test: RNNoise Toggle
- Pokemon Data Fetch Tool
- Build Tooling Dependencies
- Chat Messaging & Invites
- Diagnostics Tool
- applyUserTheme
- Yapay Denetleyici Tool
- censorProfaneText
- NPM Scripts
- RNNoise Noise Suppression
- Smeargle Sprite Generator
- Package Metadata
- E2E Test: Quick Poll
- initCustomThemeEditor
- E2E Test: Friend List
- appendChat
- diagnose.js
- Pokemon Sprite Assets
- Watch Together Feature
- README Documentation
- E2E Test: Pokemon Moves
- HTML Patch Tool v1
- color-picker.js
- shell-dm.js
- connectGlobalBroker
- E2E Test Runner
- harness.js
- ts-ui.js
- call-tiles.js
- shell-friends.js
- activity.js
- focus-minimize-responsive.test.js
- rnnoise-audio.test.js
- Whiteboard Feature
- Modal Patch
- groups.js
- net-settings.js
- profile-media-p2p.test.js
- group-view.js
- store.js
- server-dialogs.js
- App Icon & Logo Assets
- harness.js
- Notification Window
- Cursor Overlay Preload
- Notification Preload
- Tray Preload
- Tray Menu
- handlePeerDiscovered
- Echo/Mic Threshold Toggles
- Lucky Wheel Feature
- Poke Feature Init
- Supabase Client Dependency
- Preload Script
- Manual Sound Tester
- Readme Tooling Docs
- Fez SVG Asset
- deep-link.js
- App Entry Point
- seed_machine_draft.py
- settings-language.test.js
- TeamSync localization terminology
- showToast
- enterFocus
- emoji.js
- shell-teams.js
- setRemoteControlEnabled
- seed_machine_draft.py
- TeamSync redesign — handoff prompt for Claude Code
- createWindow
- i18n-coverage.test.js
- TeamSync localization terminology
- renderVirtualCursor
- direct-call.js
- media-collect-resize.test.js
- calls.js
- createPeerConnection
- quick-poll-redesign.test.js
- shell-navigation.test.js
- media-library.test.js
- startPttHook

## God Nodes (most connected - your core abstractions)
1. `t()` - 79 edges
2. `evalJS()` - 76 edges
3. `handleDataMessage()` - 54 edges
4. `spawnPeer()` - 46 edges
5. `bindUI()` - 45 edges
6. `showToast()` - 44 edges
7. `waitFor()` - 43 edges
8. `cleanupPeer()` - 40 edges
9. `render()` - 37 edges
10. `bindUI()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `renderLanguageOptions()` --indirect_call--> `mark()`  [INFERRED]
  renderer.js → js/teams/shell-teams.js
- `updateProfile()` --semantically_similar_to--> `Shared Browser Card (#sb-card, webview)`  [INFERRED] [semantically similar]
  electron/cursor-overlay.html → index.html
- `dragify()` --indirect_call--> `ev()`  [INFERRED]
  js/color-picker.js → test/e2e/server-state.test.js
- `createPeerConnection()` --indirect_call--> `track()`  [INFERRED]
  renderer.js → js/dm-extras.js
- `WebRTC()` --indirect_call--> `track()`  [INFERRED]
  src/components/WebRTC.jsx → js/dm-extras.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **Room Activity Cards (Whiteboard, YouTube Watch-Together, Shared Browser, UNO) share the #grid focus-layout mechanism** — index_grid_cards_area, index_whiteboard_card, index_youtube_watch_together_card, index_shared_browser_card, index_uno_card [EXTRACTED 0.90]
- **Create-Room premium options (RNNoise, SFW AI, Game Mode, Relay, Bitrate) configured together at room creation** — index_step_create_form, index_rnnoise_toggle_option, index_sfw_toggle_option, index_game_mode_toggle_option, index_relay_toggle_option, index_bitrate_select [EXTRACTED 0.90]
- **TeamSync release pipeline: version bump in index/docs marketing pages triggers GitHub Actions build published to GitHub Releases** — github_workflows_release_release_workflow, docs_index_github_releases_link, index_teamsync_login_flow [INFERRED 0.65]

## Communities (103 total, 15 thin omitted)

### Community 0 - "UNO Card Game"
Cohesion: 0.11
Nodes (58): handleUnoMessage(), initUno(), UNO_COLORS, UNO_GLYPH, unoActorEl(), unoAddBot(), unoBecomeHost(), unoBlockEffect() (+50 more)

### Community 1 - "App Shell & Pokedex Data"
Cohesion: 0.08
Nodes (39): App(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle, inputStyle (+31 more)

### Community 2 - "Chat & Renderer Utilities"
Cohesion: 0.02
Nodes (111): ACTIVITY_CARD_IDS, ACTIVITY_COVER_LOCALES, appendFileMsg(), AUDIO_CHANNEL_FIELDS, badWordsList, BUILT_IN_THEME_PRESETS, censorProfaneText(), chatBlobUrls (+103 more)

### Community 3 - "Electron Main Process"
Cohesion: 0.05
Nodes (34): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, powerMonitor, powerSaveBlocker, screen, shell, Tray, nativeImage, safeStorage }, backupKeysFile, baseUserData, boundedString(), codeRotationFile, deepLink, deviceIdentityFile, dgram (+26 more)

### Community 4 - "Pokemon Assets & Landing Docs"
Cohesion: 0.07
Nodes (32): Download CTA Section, Features Section (P2P, Device ID, Screen Share, SFW, Activities, RNNoise), GitHub Releases Link (Lazel-3002/TeamSync), Hero Section (Sıfır Sunucu. Sıfır Sınır.), TeamSync Marketing Landing Page, Zero-Server / No-Account Positioning Rationale, Active Profile Badge Element, Cursor Overlay #cursor Element (+24 more)

### Community 5 - "Audio Bitrate & Mic Controls"
Cohesion: 0.18
Nodes (22): apply(), basePerms(), canManageRole(), channelName(), channelPerms(), checkMessage(), cleanOverrides(), createState() (+14 more)

### Community 6 - "User List & Avatars"
Cohesion: 0.15
Nodes (10): catalogDir, EXPECTED_LOCALES, fs, path, renderer, report, requiredLegacy, requiredStructured (+2 more)

### Community 7 - "Electron Builder Config"
Cohesion: 0.09
Nodes (51): applyPttMode(), applyPttShortcut(), beginShortcutRebind(), cancelShortcutRebind(), copySettingsText(), getNickname(), getPttAccelerator(), getPttHookBinding() (+43 more)

### Community 8 - "Sidebar UI Components"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 9 - "WebRTC ICE & TURN"
Cohesion: 0.13
Nodes (37): applyMicrophoneVolume(), applyRoomNoiseSuppression(), applySimpleUi(), applySpeakerToAll(), applySpeakerVolume(), clearSettingsPreview(), DEVELOPED_LANGUAGES, fillAudioDeviceSelect() (+29 more)

### Community 10 - "E2E Test: MQTT/First Run"
Cohesion: 0.12
Nodes (30): allPlayersVoted(), apply(), bindCloseButton(), calculateRoundScores(), challengeEntries(), closeAllCards(), closeNameCity(), createMultiBrokerClient() (+22 more)

### Community 11 - "E2E Test Harness"
Cohesion: 0.09
Nodes (23): assert, audioState(), setPersonalToggle(), {
  spawnPeer,
  cleanupPeer,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  evalJS,
  waitFor,
}, clickWhenReady(), createRoom(), joinRoom(), setValueWhenReady() (+15 more)

### Community 12 - "E2E Test: Scroll/Download"
Cohesion: 0.18
Nodes (12): fs, { launch, getPageTarget, cdp, evalJS, waitFor }, os, path, assert, fs, inspectButton(), { launch, getPageTarget, cdp, evalJS, waitFor } (+4 more)

### Community 13 - "Native Dependencies"
Cohesion: 0.09
Nodes (23): acorn, cross-fetch, crypto-js, electron-updater, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn (+15 more)

### Community 14 - "Shared Browser Feature"
Cohesion: 0.29
Nodes (16): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbConsumeRemoteEcho(), sbCurrentUrl(), sbHandleHostLeft() (+8 more)

### Community 15 - "Focus Mode UI"
Cohesion: 0.17
Nodes (21): _inject(), isSettingsOpen(), refreshState(), renderSettings(), sanitize(), setCurrent(), sourceLabel(), bind() (+13 more)

### Community 16 - "E2E Test: RNNoise Toggle"
Cohesion: 0.07
Nodes (59): actionButtons(), activityHtml(), answer(), bannerStyle(), bindCardActions(), cardHtml(), durationMenu(), editorDirty() (+51 more)

### Community 17 - "Pokemon Data Fetch Tool"
Cohesion: 0.13
Nodes (31): checkAvatar(), checkSession(), deleteDeviceAccount(), deviceLogin(), findSlotForSession(), getActiveSlot(), getDefaultAccount(), getDeviceAccounts() (+23 more)

### Community 18 - "Build Tooling Dependencies"
Cohesion: 0.15
Nodes (13): concurrently, cross-env, electron, electron-builder, devDependencies, concurrently, cross-env, electron (+5 more)

### Community 19 - "Chat Messaging & Invites"
Cohesion: 0.08
Nodes (40): adoptScreenAudioTransceiver(), applyAudioSdpParams(), applyIceEscalationPolicy(), applyScreenAudioQuality(), applySharedTurn(), applySpeakerTo(), attachPeerScreenAudio(), attachVideo() (+32 more)

### Community 20 - "Diagnostics Tool"
Cohesion: 0.35
Nodes (11): _analyzeCssText(), _append(), appendCapture(), appendRenderer(), crypto, _extractRule(), fs, init() (+3 more)

### Community 21 - "applyUserTheme"
Cohesion: 0.29
Nodes (6): catalogs, dir, fs, output, path, root

### Community 22 - "Yapay Denetleyici Tool"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 23 - "censorProfaneText"
Cohesion: 0.05
Nodes (35): ActivityDetector, findExes(), fs, initActivityDetector(), P, path, readJson(), regQuery() (+27 more)

### Community 24 - "NPM Scripts"
Cohesion: 0.24
Nodes (10): initLuckyWheel(), size(), AMBERS, assert, check(), contrast(), dist(), lum() (+2 more)

### Community 25 - "RNNoise Noise Suppression"
Cohesion: 0.43
Nodes (6): canCompileWasm(), createNoiseFilter(), isSupported(), loadArrayBuffer(), loadWasmBinary(), supportsWasmSimd()

### Community 26 - "Smeargle Sprite Generator"
Cohesion: 0.16
Nodes (23): buildPresence(), customActive(), effective(), endOfToday(), ensureLoaded(), expire(), idleMinutes(), ingestPresence() (+15 more)

### Community 27 - "Package Metadata"
Cohesion: 0.17
Nodes (12): scripts, build, build-full, build:react, dev:react, diag, diag:net, i18n:audit (+4 more)

### Community 29 - "E2E Test: Quick Poll"
Cohesion: 0.25
Nodes (5): assert, fs, os, path, { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor }

### Community 30 - "initCustomThemeEditor"
Cohesion: 0.14
Nodes (30): APP_THEMES, applyCustomThemeColors(), applyPaletteToEditor(), applyUserTheme(), createPaletteCard(), deleteSavedPalette(), getActiveTheme(), getAllThemePresets() (+22 more)

### Community 31 - "E2E Test: Friend List"
Cohesion: 0.06
Nodes (88): activate(), adopt(), boxFor(), canView(), createInvite(), createServer(), deliverPrivate(), discover() (+80 more)

### Community 32 - "appendChat"
Cohesion: 0.19
Nodes (25): applyPrejoinPrefs(), bind(), closeQuickCall(), enter(), exit(), init(), observe(), onCallEnd() (+17 more)

### Community 33 - "diagnose.js"
Cohesion: 0.13
Nodes (17): RFC-5389, ATTR, buildMsg(), crypto, dgram, errText(), https, RFC-6598 (+9 more)

### Community 35 - "Watch Together Feature"
Cohesion: 0.60
Nodes (5): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange(), parseYouTubeId()

### Community 36 - "README Documentation"
Cohesion: 0.40
Nodes (5): Build & Portable Distribution, P2P Serverless Architecture, Project Structure Layout, RNNoise Noise Suppression, TeamSync Application

### Community 37 - "E2E Test: Pokemon Moves"
Cohesion: 0.18
Nodes (11): build, appId, directories, npmRebuild, productName, protocols, publish, win (+3 more)

### Community 38 - "HTML Patch Tool v1"
Cohesion: 0.33
Nodes (5): assert, fs, inspectAtWidth(), path, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}

### Community 39 - "color-picker.js"
Cohesion: 0.11
Nodes (42): build(), close(), commitValue(), dragify(), ensureStyles(), hexToRgb(), loadRecents(), makeSwatch() (+34 more)

### Community 40 - "shell-dm.js"
Cohesion: 0.15
Nodes (29): bind(), callFriend(), callTarget(), clearUnread(), currentDmView(), dayLabel(), ensureLoaded(), expandSections() (+21 more)

### Community 41 - "connectGlobalBroker"
Cohesion: 0.15
Nodes (22): applyPeerLimiter(), applyPeerVolume(), AUDIO_CHANNELS, buildCardVolumeBox(), buildMenuVolumeBlock(), channelFields(), createPaletteBadge(), ensurePeerBoostChain() (+14 more)

### Community 42 - "E2E Test Runner"
Cohesion: 0.33
Nodes (6): fs, main(), path, runIsolatedTest(), { spawn }, TEST_TIMEOUT_MS

### Community 43 - "harness.js"
Cohesion: 0.09
Nodes (21): assert, { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends }, texts(), assert, { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends, waitForPeerConnected }, APP_DIR, ELECTRON_BIN, fs (+13 more)

### Community 44 - "ts-ui.js"
Cohesion: 0.10
Nodes (47): applyBlock(), bind(), blockedList(), blockRecord(), blockSet(), confirmBlock(), dropOutgoing(), emitBlock() (+39 more)

### Community 45 - "call-tiles.js"
Cohesion: 0.13
Nodes (30): add(), clear(), ensureInviteTile(), grid(), peerInfo(), remove(), render(), safeId() (+22 more)

### Community 46 - "shell-friends.js"
Cohesion: 0.21
Nodes (23): applyUserLanguage(), bindUI(), clearFocusInlineLayout(), ensureFocusControlsVisible(), enterFocus(), exitFocus(), initActivitiesUI(), makeCardFocusable() (+15 more)

### Community 47 - "activity.js"
Cohesion: 0.08
Nodes (59): adoptFriendAvatar(), applyOwnAvatar(), armTimer(), db(), decode(), drawCover(), encodeCanvas(), ensure() (+51 more)

### Community 48 - "focus-minimize-responsive.test.js"
Cohesion: 0.22
Nodes (6): assert, fs, inspectFocusLayout(), os, path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}

### Community 49 - "rnnoise-audio.test.js"
Cohesion: 0.08
Nodes (55): label(), bind(), buildModel(), canManageAnything(), cooldownLeft(), findEvent(), fmtTime(), hydrateAll() (+47 more)

### Community 50 - "Whiteboard Feature"
Cohesion: 0.12
Nodes (57): addDetailTags(), addFiles(), advanceDetail(), bindContextMenu(), bindDetailModal(), bindDropzone(), bindFilterGroup(), cleanTag() (+49 more)

### Community 53 - "groups.js"
Cohesion: 0.08
Nodes (62): activate(), activeCall(), adopt(), announceMyCall(), applyEffects(), beaconLoop(), callRoom(), checkPermission() (+54 more)

### Community 54 - "net-settings.js"
Cohesion: 0.14
Nodes (36): askOwnDevices(), bindGoAccount(), buildChecks(), buildPeersInfo(), channelKey(), gather(), goAccountButton(), hostOf() (+28 more)

### Community 55 - "profile-media-p2p.test.js"
Cohesion: 0.13
Nodes (11): assert, chunk(), crc32(), CRC_TABLE, crypto, fs, {
  launch, getPageTarget, cdp, spawnPeer, cleanupPeer, evalJS, waitFor,
  createRoom, joinRoom, waitForPeerConnected, waitForShell, makeFriends,
}, os (+3 more)

### Community 56 - "group-view.js"
Cohesion: 0.18
Nodes (27): askProfile(), avatarFor(), bind(), buildModel(), fmtTime(), friendCandidates(), goAddFriendPage(), groupOnline() (+19 more)

### Community 57 - "store.js"
Cohesion: 0.21
Nodes (13): addControl(), addEvents(), allSpaces(), channelEvents(), controlOf(), countOf(), eventsOf(), getEvent() (+5 more)

### Community 58 - "server-dialogs.js"
Cohesion: 0.25
Nodes (15): expiryText(), fileToIcon(), flushPendingLink(), handleLink(), iconPicker(), modal(), openChannelSettings(), openCreate() (+7 more)

### Community 60 - "harness.js"
Cohesion: 0.09
Nodes (21): assert, fs, openPage(), path, scrollTo(), shot(), {
  spawnPeer, cleanupPeer, evalJS, waitFor, createRoom, joinRoom, waitForPeerConnected, waitStableIdentity,
}, assert (+13 more)

### Community 66 - "handlePeerDiscovered"
Cohesion: 0.23
Nodes (17): lbApply(), lbClamp(), lbClose(), lbComputeFitScale(), lbEnsure(), lbFit(), lbKeyHandler(), lbRotate() (+9 more)

### Community 68 - "Lucky Wheel Feature"
Cohesion: 0.06
Nodes (87): addBot(), addBotMemory(), addLobbyChatMessage(), addressedMessageFor(), afterNight(), analyzeChatClaim(), applyBotReward(), applyBotRole() (+79 more)

### Community 69 - "Poke Feature Init"
Cohesion: 0.07
Nodes (33): assert, fs, inspectControls(), path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}, evalJS(), assert, fs (+25 more)

### Community 70 - "Supabase Client Dependency"
Cohesion: 0.29
Nodes (7): files, **/*, !dist, !.env, !problemler.md, !tools/dev/yapaydenetleyici.js, !yapaydenetliyici.md

### Community 75 - "deep-link.js"
Cohesion: 0.25
Nodes (9): forwardToPrimary(), fs, linkFromArgv(), listen(), net, normalize(), os, path (+1 more)

### Community 80 - "seed_machine_draft.py"
Cohesion: 0.08
Nodes (59): apply(), applyStored(), bindHandle(), clamp(), init(), limitFor(), measuredReserve(), stored() (+51 more)

### Community 81 - "settings-language.test.js"
Cohesion: 0.07
Nodes (25): assert, fs, path, { spawnPeer, cleanupPeer, evalJS, waitFor }, { spawnPeer, cleanupPeer, waitFor }, assert, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}, assert (+17 more)

### Community 82 - "TeamSync localization terminology"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, releaseName, version

### Community 84 - "showToast"
Cohesion: 0.06
Nodes (73): acceptFounderClaim(), addUser(), addVideoCard(), applyAudioBitrateToPeers(), applyFounder(), applyFounderSettingsSnapshot(), applyMicState(), broadcast() (+65 more)

### Community 85 - "enterFocus"
Cohesion: 0.33
Nodes (6): nsis, artifactName, deleteAppDataOnUninstall, oneClick, perMachine, runAfterFinish

### Community 86 - "emoji.js"
Cohesion: 0.38
Nodes (7): attach(), choose(), closePopup(), openPicker(), renderPopup(), search(), tokenAtCaret()

### Community 87 - "shell-teams.js"
Cohesion: 0.22
Nodes (20): activeFid(), bind(), buildCallToolbar(), clearFind(), closeFind(), inCall(), joinById(), mark() (+12 more)

### Community 88 - "setRemoteControlEnabled"
Cohesion: 0.29
Nodes (11): acquireInputHook(), handleLocalMouseDown(), handleLocalMouseMove(), hideVirtualCursor(), normalizePrimaryPoint(), releaseInputHook(), renderCursorForOwner(), setRemoteControlEnabled() (+3 more)

### Community 89 - "seed_machine_draft.py"
Cohesion: 0.60
Nodes (4): load(), Generate review-required locale drafts; never use this at application runtime., run(), save()

### Community 90 - "TeamSync redesign — handoff prompt for Claude Code"
Cohesion: 0.20
Nodes (9): Decisions already made with the owner (do not re-ask), How to verify (the standard in this repo), Phase 1 — DONE (commits 3d49860, 4506d6e), Phase 2 — DONE: friend groups, group calls, typing, emoji, reactions, Phase 3 — DONE: PC-hosted servers, Phase 4 — Teams-inspired shell (branch `feat/teams-tarzi-arayuz`), Phase 5 — integration (uncommitted working tree), TeamSync redesign — handoff prompt for Claude Code (+1 more)

### Community 91 - "createWindow"
Cohesion: 0.33
Nodes (6): applyDnsSettings(), createWindow(), getDnsProvider(), getTrayStrings(), mainT(), readSettings()

### Community 92 - "i18n-coverage.test.js"
Cohesion: 0.06
Nodes (111): accentColor(), addOps(), announceRemoteActivity(), applyLive(), bboxOf(), bindUI(), buildSwatches(), call() (+103 more)

### Community 94 - "renderVirtualCursor"
Cohesion: 0.40
Nodes (6): createCursorOverlay(), cursorProfile(), getControlBounds(), renderVirtualCursor(), safeCursorAvatar(), validNormalizedPoint()

### Community 98 - "direct-call.js"
Cohesion: 0.25
Nodes (20): accept(), announceEnd(), answered(), call(), decline(), dismissIncoming(), inviteFids(), inviteToCurrent() (+12 more)

### Community 99 - "media-collect-resize.test.js"
Cohesion: 0.40
Nodes (4): assert, fs, path, { spawnPeer, cleanupPeer, evalJS, waitFor }

### Community 100 - "calls.js"
Cohesion: 0.42
Nodes (8): bind(), bucket(), dirLabel(), entryHtml(), fmtDuration(), kindLabel(), render(), renderBadge()

### Community 101 - "createPeerConnection"
Cohesion: 0.08
Nodes (36): acceptServerInvite(), appendChat(), beginRoomOperation(), censoredTextHtml(), cleanFriendEventName(), cleanText(), completeOutgoingFriendship(), connectGlobalBroker() (+28 more)

### Community 102 - "quick-poll-redesign.test.js"
Cohesion: 0.29
Nodes (5): assert, fs, inspectPoll(), path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}

### Community 103 - "shell-navigation.test.js"
Cohesion: 0.17
Nodes (15): accountCodeFor(), accountRefFor(), accountRefOf(), backupKeyFor(), credentialsFor(), deriveDeviceId(), displayCodeFor(), loadBackupKeys() (+7 more)

### Community 106 - "media-library.test.js"
Cohesion: 0.40
Nodes (4): assert, fs, path, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}

### Community 107 - "startPttHook"
Cohesion: 0.83
Nodes (4): pttHookKeydown(), pttHookKeyup(), startPttHook(), stopPttHook()

## Ambiguous Edges - Review These
- `window.handlePokeImgError() sprite fallback chain` → `PokeAPI (pokeapi.co)`  [AMBIGUOUS]
  index.html · relation: calls

## Knowledge Gaps
- **393 isolated node(s):** `fs`, `path`, `crypto`, `fs`, `path` (+388 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `window.handlePokeImgError() sprite fallback chain` and `PokeAPI (pokeapi.co)`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `label()` connect `rnnoise-audio.test.js` to `createPeerConnection`, `Electron Builder Config`, `shell-dm.js`, `E2E Test: MQTT/First Run`, `ts-ui.js`, `E2E Test: RNNoise Toggle`, `Whiteboard Feature`, `shell-teams.js`, `NPM Scripts`, `group-view.js`?**
  _High betweenness centrality (0.263) - this node is a cross-community bridge._
- **Why does `t()` connect `color-picker.js` to `rnnoise-audio.test.js`, `groups.js`, `E2E Test: Friend List`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `line()` connect `Lucky Wheel Feature` to `diagnose.js`, `i18n-coverage.test.js`, `net-settings.js`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `crypto` to the rest of the system?**
  _393 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UNO Card Game` be split into smaller, more focused modules?**
  _Cohesion score 0.11279953243717125 - nodes in this community are weakly interconnected._
- **Should `App Shell & Pokedex Data` be split into smaller, more focused modules?**
  _Cohesion score 0.07767722473604827 - nodes in this community are weakly interconnected._