# Graph Report - TeamSync  (2026-09-30)

## Corpus Check
- 125 files · ~625,114 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1998 nodes · 4774 edges · 97 communities (82 shown, 15 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 151 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8663a6d2`
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
- E2E Test: Lucky Wheel
- E2E Test: Quick Poll
- E2E Test: Focus Minimize
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
- sendFile
- E2E Test Runner
- harness.js
- ts-ui.js
- call-tiles.js
- shell-friends.js
- activity.js
- quick-poll-redesign.test.js
- rnnoise-audio.test.js
- Whiteboard Feature
- Modal Patch
- groups.js
- initCustomThemeEditor
- server-state.js
- group-view.js
- store.js
- server-dialogs.js
- App Icon & Logo Assets
- Cross-Fetch Dependency
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
- nsis
- seed_machine_draft.py
- settings-language.test.js
- TeamSync localization terminology
- showToast
- enterFocus
- emoji.js
- setRemoteControlEnabled
- seed_machine_draft.py
- TeamSync redesign — handoff prompt for Claude Code
- createWindow
- i18n-coverage.test.js
- TeamSync localization terminology
- renderVirtualCursor
- media-collect-resize.test.js
- getBroadcastAddresses

## God Nodes (most connected - your core abstractions)
1. `t()` - 61 edges
2. `evalJS()` - 61 edges
3. `handleDataMessage()` - 47 edges
4. `bindUI()` - 42 edges
5. `showToast()` - 38 edges
6. `render()` - 37 edges
7. `spawnPeer()` - 37 edges
8. `waitFor()` - 32 edges
9. `cleanupPeer()` - 31 edges
10. `bindUI()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `updateProfile()` --semantically_similar_to--> `Shared Browser Card (#sb-card, webview)`  [INFERRED] [semantically similar]
  electron/cursor-overlay.html → index.html
- `setupVUMeter()` --indirect_call--> `update()`  [INFERRED]
  renderer.js → js/call-tiles.js
- `dragify()` --indirect_call--> `ev()`  [INFERRED]
  js/color-picker.js → test/e2e/server-state.test.js
- `createPeerConnection()` --indirect_call--> `track()`  [INFERRED]
  renderer.js → js/dm-extras.js
- `startRecording()` --indirect_call--> `track()`  [INFERRED]
  renderer.js → js/dm-extras.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **Room Activity Cards (Whiteboard, YouTube Watch-Together, Shared Browser, UNO) share the #grid focus-layout mechanism** — index_grid_cards_area, index_whiteboard_card, index_youtube_watch_together_card, index_shared_browser_card, index_uno_card [EXTRACTED 0.90]
- **Create-Room premium options (RNNoise, SFW AI, Game Mode, Relay, Bitrate) configured together at room creation** — index_step_create_form, index_rnnoise_toggle_option, index_sfw_toggle_option, index_game_mode_toggle_option, index_relay_toggle_option, index_bitrate_select [EXTRACTED 0.90]
- **TeamSync release pipeline: version bump in index/docs marketing pages triggers GitHub Actions build published to GitHub Releases** — github_workflows_release_release_workflow, docs_index_github_releases_link, index_teamsync_login_flow [INFERRED 0.65]

## Communities (97 total, 15 thin omitted)

### Community 0 - "UNO Card Game"
Cohesion: 0.11
Nodes (58): handleUnoMessage(), initUno(), UNO_COLORS, UNO_GLYPH, unoActorEl(), unoAddBot(), unoBecomeHost(), unoBlockEffect() (+50 more)

### Community 1 - "App Shell & Pokedex Data"
Cohesion: 0.08
Nodes (39): App(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle, inputStyle (+31 more)

### Community 2 - "Chat & Renderer Utilities"
Cohesion: 0.02
Nodes (109): acceptServerInvite(), ACTIVITY_CARD_IDS, ACTIVITY_COVER_LOCALES, appendChat(), AUDIO_CHANNEL_FIELDS, badWordsList, beginRoomOperation(), BUILT_IN_THEME_PRESETS (+101 more)

### Community 3 - "Electron Main Process"
Cohesion: 0.06
Nodes (26): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, powerMonitor, powerSaveBlocker, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, boundedString(), deepLink, deviceIdentityFile, dgram, _diagSettingsPath, DNS_PROVIDERS (+18 more)

### Community 4 - "Pokemon Assets & Landing Docs"
Cohesion: 0.07
Nodes (32): Download CTA Section, Features Section (P2P, Device ID, Screen Share, SFW, Activities, RNNoise), GitHub Releases Link (Lazel-3002/TeamSync), Hero Section (Sıfır Sunucu. Sıfır Sınır.), TeamSync Marketing Landing Page, Zero-Server / No-Account Positioning Rationale, Active Profile Badge Element, Cursor Overlay #cursor Element (+24 more)

### Community 5 - "Audio Bitrate & Mic Controls"
Cohesion: 0.40
Nodes (4): assert, fs, path, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}

### Community 6 - "User List & Avatars"
Cohesion: 0.15
Nodes (10): catalogDir, EXPECTED_LOCALES, fs, path, renderer, report, requiredLegacy, requiredStructured (+2 more)

### Community 7 - "Electron Builder Config"
Cohesion: 0.13
Nodes (27): applyPttMode(), applyPttShortcut(), beginShortcutRebind(), cancelShortcutRebind(), getPttAccelerator(), getShortcutBinding(), handleShortcutGateKeydown(), initShortcutSettings() (+19 more)

### Community 8 - "Sidebar UI Components"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 9 - "WebRTC ICE & TURN"
Cohesion: 0.09
Nodes (38): adoptScreenAudioTransceiver(), applyAudioSdpParams(), applyIceEscalationPolicy(), applyScreenAudioQuality(), applySharedTurn(), applySpeakerTo(), attachPeerScreenAudio(), attemptIceRestart() (+30 more)

### Community 10 - "E2E Test: MQTT/First Run"
Cohesion: 0.14
Nodes (26): allPlayersVoted(), apply(), bindCloseButton(), calculateRoundScores(), challengeEntries(), emit(), finishRound(), gamePlayersForStart() (+18 more)

### Community 11 - "E2E Test Harness"
Cohesion: 0.10
Nodes (17): assert, audioState(), setPersonalToggle(), {
  spawnPeer,
  cleanupPeer,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  evalJS,
  waitFor,
}, joinRoom(), setValueWhenReady(), waitForPeerConnected(), assert (+9 more)

### Community 12 - "E2E Test: Scroll/Download"
Cohesion: 0.15
Nodes (16): fs, { launch, getPageTarget, cdp, evalJS, waitFor }, os, path, assert, fs, inspectButton(), { launch, getPageTarget, cdp, evalJS, waitFor } (+8 more)

### Community 13 - "Native Dependencies"
Cohesion: 0.09
Nodes (23): acorn, cross-fetch, crypto-js, electron-updater, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn (+15 more)

### Community 14 - "Shared Browser Feature"
Cohesion: 0.32
Nodes (15): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+7 more)

### Community 15 - "Focus Mode UI"
Cohesion: 0.31
Nodes (14): bind(), blobFromDataUrl(), cleanName(), collectActive(), ensureButton(), hide(), isCollectable(), notify() (+6 more)

### Community 16 - "E2E Test: RNNoise Toggle"
Cohesion: 0.07
Nodes (59): actionButtons(), activityHtml(), answer(), bannerStyle(), bindCardActions(), cardHtml(), durationMenu(), editorDirty() (+51 more)

### Community 17 - "Pokemon Data Fetch Tool"
Cohesion: 0.19
Nodes (19): checkAvatar(), checkSession(), deleteDeviceAccount(), deviceLogin(), getActiveSlot(), getDefaultAccount(), getDeviceAccounts(), isDefaultAccountRef() (+11 more)

### Community 18 - "Build Tooling Dependencies"
Cohesion: 0.15
Nodes (13): concurrently, cross-env, electron, electron-builder, devDependencies, concurrently, cross-env, electron (+5 more)

### Community 19 - "Chat Messaging & Invites"
Cohesion: 0.14
Nodes (26): applyPeerLimiter(), applyPeerVolume(), AUDIO_CHANNELS, buildCardVolumeBox(), buildMenuVolumeBlock(), channelFields(), ensurePeerBoostChain(), getNickname() (+18 more)

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
Cohesion: 0.07
Nodes (24): ActivityDetector, findExes(), fs, initActivityDetector(), P, path, readJson(), regQuery() (+16 more)

### Community 24 - "NPM Scripts"
Cohesion: 0.22
Nodes (21): bindUI(), clearFocusInlineLayout(), ensureFocusControlsVisible(), enterFocus(), exitFocus(), getSfwChatBanThreshold(), initActivitiesUI(), isChatBanned() (+13 more)

### Community 25 - "RNNoise Noise Suppression"
Cohesion: 0.43
Nodes (6): canCompileWasm(), createNoiseFilter(), isSupported(), loadArrayBuffer(), loadWasmBinary(), supportsWasmSimd()

### Community 26 - "Smeargle Sprite Generator"
Cohesion: 0.16
Nodes (23): buildPresence(), customActive(), effective(), endOfToday(), ensureLoaded(), expire(), idleMinutes(), ingestPresence() (+15 more)

### Community 27 - "Package Metadata"
Cohesion: 0.17
Nodes (12): scripts, build, build-full, build:react, dev:react, diag, diag:net, i18n:audit (+4 more)

### Community 28 - "E2E Test: Lucky Wheel"
Cohesion: 0.29
Nodes (5): assert, fs, inspectWheel(), path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
}

### Community 29 - "E2E Test: Quick Poll"
Cohesion: 0.25
Nodes (5): assert, fs, os, path, { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor }

### Community 30 - "E2E Test: Focus Minimize"
Cohesion: 0.33
Nodes (5): assert, fs, inspectControls(), path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}

### Community 31 - "E2E Test: Friend List"
Cohesion: 0.06
Nodes (87): activate(), boxFor(), canView(), createInvite(), createServer(), deliverPrivate(), discover(), ensureStarted() (+79 more)

### Community 32 - "appendChat"
Cohesion: 0.19
Nodes (24): applyPrejoinPrefs(), bind(), closeQuickCall(), enter(), exit(), init(), observe(), onCallEnd() (+16 more)

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
Cohesion: 0.11
Nodes (17): { spawnPeer, cleanupPeer, waitFor, evalJS, createRoom }, clickWhenReady(), createRoom(), waitFor(), assert, {
  spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected,
  evalJS, waitFor, clickWhenReady
}, assert, { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } (+9 more)

### Community 39 - "color-picker.js"
Cohesion: 0.11
Nodes (42): build(), close(), commitValue(), dragify(), ensureStyles(), hexToRgb(), loadRecents(), makeSwatch() (+34 more)

### Community 40 - "shell-dm.js"
Cohesion: 0.25
Nodes (17): bind(), clearUnread(), currentDmView(), dayLabel(), ensureLoaded(), groupedHtml(), isViewing(), lastTimestamp() (+9 more)

### Community 41 - "sendFile"
Cohesion: 0.07
Nodes (35): addVideoCard(), appendFileMsg(), attachVideo(), closeFilePreview(), confirmLargeFileSend(), dataUrlByteSize(), dataUrlToBlob(), dmContentHtml() (+27 more)

### Community 42 - "E2E Test Runner"
Cohesion: 0.33
Nodes (6): fs, main(), path, runIsolatedTest(), { spawn }, TEST_TIMEOUT_MS

### Community 43 - "harness.js"
Cohesion: 0.11
Nodes (20): assert, { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends }, texts(), assert, { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends, waitForPeerConnected }, APP_DIR, ELECTRON_BIN, fs (+12 more)

### Community 44 - "ts-ui.js"
Cohesion: 0.22
Nodes (11): avatarHtml(), closePopover(), colorFromString(), formatElapsed(), gameArtHtml(), popover(), safeImg(), sinceHtml() (+3 more)

### Community 45 - "call-tiles.js"
Cohesion: 0.14
Nodes (28): add(), clear(), ensureInviteTile(), grid(), peerInfo(), remove(), render(), safeId() (+20 more)

### Community 46 - "shell-friends.js"
Cohesion: 0.42
Nodes (11): bind(), friendRows(), onFriendRequestSent(), outgoing(), render(), renderActiveNow(), renderBadges(), renderPending() (+3 more)

### Community 47 - "activity.js"
Cohesion: 0.36
Nodes (7): _inject(), isSettingsOpen(), refreshState(), renderSettings(), sanitize(), setCurrent(), sourceLabel()

### Community 48 - "quick-poll-redesign.test.js"
Cohesion: 0.29
Nodes (5): assert, fs, inspectPoll(), path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}

### Community 49 - "rnnoise-audio.test.js"
Cohesion: 0.10
Nodes (49): bind(), buildModel(), canManageAnything(), cooldownLeft(), findEvent(), fmtTime(), hydrateAll(), hydrateInvite() (+41 more)

### Community 50 - "Whiteboard Feature"
Cohesion: 0.12
Nodes (57): addDetailTags(), addFiles(), advanceDetail(), bindContextMenu(), bindDetailModal(), bindDropzone(), bindFilterGroup(), cleanTag() (+49 more)

### Community 53 - "groups.js"
Cohesion: 0.10
Nodes (49): activate(), activeCall(), applyEffects(), beaconLoop(), callRoom(), checkPermission(), createGroup(), deliverKeys() (+41 more)

### Community 54 - "initCustomThemeEditor"
Cohesion: 0.12
Nodes (29): applyCustomThemeColors(), applyPaletteToEditor(), createPaletteBadge(), createPaletteCard(), deleteSavedPalette(), getAllThemePresets(), getCustomThemeColors(), getEditorColors() (+21 more)

### Community 55 - "server-state.js"
Cohesion: 0.14
Nodes (25): apply(), basePerms(), canManageRole(), channelName(), channelPerms(), checkMessage(), cleanOverrides(), createState() (+17 more)

### Community 56 - "group-view.js"
Cohesion: 0.23
Nodes (19): avatarFor(), bind(), buildModel(), fmtTime(), isViewing(), listItems(), openAddMembers(), panelOpen() (+11 more)

### Community 57 - "store.js"
Cohesion: 0.21
Nodes (13): addControl(), addEvents(), allSpaces(), channelEvents(), controlOf(), countOf(), eventsOf(), getEvent() (+5 more)

### Community 58 - "server-dialogs.js"
Cohesion: 0.28
Nodes (14): expiryText(), fileToIcon(), flushPendingLink(), handleLink(), iconPicker(), modal(), openChannelSettings(), openCreate() (+6 more)

### Community 60 - "Cross-Fetch Dependency"
Cohesion: 0.10
Nodes (51): APP_THEMES, applyMicrophoneVolume(), applyRoomNoiseSuppression(), applySimpleUi(), applySpeakerToAll(), applySpeakerVolume(), applyUserLanguage(), applyUserTheme() (+43 more)

### Community 66 - "handlePeerDiscovered"
Cohesion: 0.25
Nodes (16): lbApply(), lbClamp(), lbClose(), lbComputeFitScale(), lbEnsure(), lbFit(), lbKeyHandler(), lbRotate() (+8 more)

### Community 68 - "Lucky Wheel Feature"
Cohesion: 0.06
Nodes (88): initLuckyWheel(), addBot(), addBotMemory(), addLobbyChatMessage(), addressedMessageFor(), afterNight(), analyzeChatClaim(), applyBotReward() (+80 more)

### Community 69 - "Poke Feature Init"
Cohesion: 0.12
Nodes (21): assert, fs, inspectAtWidth(), path, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}, evalJS(), assert, installMockOllama() (+13 more)

### Community 70 - "Supabase Client Dependency"
Cohesion: 0.29
Nodes (7): files, **/*, !dist, !.env, !problemler.md, !tools/dev/yapaydenetleyici.js, !yapaydenetliyici.md

### Community 75 - "deep-link.js"
Cohesion: 0.25
Nodes (9): forwardToPrimary(), fs, linkFromArgv(), listen(), net, normalize(), os, path (+1 more)

### Community 79 - "nsis"
Cohesion: 0.22
Nodes (6): assert, fs, inspectFocusLayout(), os, path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}

### Community 80 - "seed_machine_draft.py"
Cohesion: 0.47
Nodes (8): apply(), applyStored(), bindHandle(), clamp(), init(), limitFor(), measuredReserve(), stored()

### Community 81 - "settings-language.test.js"
Cohesion: 0.13
Nodes (10): { spawnPeer, cleanupPeer, waitFor }, assert, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}, assert, { spawnPeer, cleanupPeer, evalJS }, cleanupPeer(), assert, { spawnPeer, cleanupPeer, evalJS } (+2 more)

### Community 82 - "TeamSync localization terminology"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, releaseName, version

### Community 84 - "showToast"
Cohesion: 0.08
Nodes (53): acceptFounderClaim(), addUser(), applyAudioBitrateToPeers(), applyMicState(), broadcast(), broadcastTo(), canManageRoom(), canModerateTarget() (+45 more)

### Community 85 - "enterFocus"
Cohesion: 0.33
Nodes (6): nsis, artifactName, deleteAppDataOnUninstall, oneClick, perMachine, runAfterFinish

### Community 86 - "emoji.js"
Cohesion: 0.38
Nodes (7): attach(), choose(), closePopup(), openPicker(), renderPopup(), search(), tokenAtCaret()

### Community 88 - "setRemoteControlEnabled"
Cohesion: 0.39
Nodes (9): handleLocalMouseDown(), handleLocalMouseMove(), hideVirtualCursor(), normalizePrimaryPoint(), renderCursorForOwner(), setRemoteControlEnabled(), startLocalInputHook(), stopLocalInputHook() (+1 more)

### Community 89 - "seed_machine_draft.py"
Cohesion: 0.60
Nodes (4): load(), Generate review-required locale drafts; never use this at application runtime., run(), save()

### Community 90 - "TeamSync redesign — handoff prompt for Claude Code"
Cohesion: 0.25
Nodes (7): Decisions already made with the owner (do not re-ask), How to verify (the standard in this repo), Phase 1 — DONE (commits 3d49860, 4506d6e), Phase 2 — DONE: friend groups, group calls, typing, emoji, reactions, Phase 3 — DONE: PC-hosted servers, TeamSync redesign — handoff prompt for Claude Code, What the owner asked for (from his sketches)

### Community 91 - "createWindow"
Cohesion: 0.33
Nodes (6): applyDnsSettings(), createWindow(), getDnsProvider(), getTrayStrings(), mainT(), readSettings()

### Community 92 - "i18n-coverage.test.js"
Cohesion: 0.06
Nodes (111): accentColor(), addOps(), announceRemoteActivity(), applyLive(), bboxOf(), bindUI(), buildSwatches(), call() (+103 more)

### Community 94 - "renderVirtualCursor"
Cohesion: 0.40
Nodes (6): createCursorOverlay(), cursorProfile(), getControlBounds(), renderVirtualCursor(), safeCursorAvatar(), validNormalizedPoint()

### Community 95 - "media-collect-resize.test.js"
Cohesion: 0.40
Nodes (4): assert, fs, path, { spawnPeer, cleanupPeer, evalJS, waitFor }

### Community 96 - "getBroadcastAddresses"
Cohesion: 0.67
Nodes (3): getBroadcastAddresses(), getLocalIPs(), startDiscovery()

## Ambiguous Edges - Review These
- `window.handlePokeImgError() sprite fallback chain` → `PokeAPI (pokeapi.co)`  [AMBIGUOUS]
  index.html · relation: calls

## Knowledge Gaps
- **352 isolated node(s):** `fs`, `path`, `crypto`, `fs`, `path` (+347 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `window.handlePokeImgError() sprite fallback chain` and `PokeAPI (pokeapi.co)`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `render()` connect `Lucky Wheel Feature` to `rnnoise-audio.test.js`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `t()` connect `color-picker.js` to `rnnoise-audio.test.js`, `groups.js`, `E2E Test: Friend List`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `css` connect `initCustomThemeEditor` to `UNO Card Game`, `rnnoise-audio.test.js`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `crypto` to the rest of the system?**
  _352 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UNO Card Game` be split into smaller, more focused modules?**
  _Cohesion score 0.11279953243717125 - nodes in this community are weakly interconnected._
- **Should `App Shell & Pokedex Data` be split into smaller, more focused modules?**
  _Cohesion score 0.07767722473604827 - nodes in this community are weakly interconnected._