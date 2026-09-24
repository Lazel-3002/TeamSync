# Graph Report - kanka-voice  (2026-09-23)

## Corpus Check
- 108 files · ~581,359 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1619 nodes · 3872 edges · 83 communities (67 shown, 16 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 119 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4506d6ec`
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
- App Entry Point
- nsis
- seed_machine_draft.py
- settings-language.test.js
- TeamSync localization terminology
- showToast
- enterFocus
- deviceLogin
- seed_machine_draft.py
- i18n-coverage.test.js
- TeamSync localization terminology

## God Nodes (most connected - your core abstractions)
1. `t()` - 62 edges
2. `evalJS()` - 55 edges
3. `handleDataMessage()` - 46 edges
4. `bindUI()` - 42 edges
5. `showToast()` - 38 edges
6. `render()` - 36 edges
7. `spawnPeer()` - 34 edges
8. `bindUI()` - 30 edges
9. `waitFor()` - 29 edges
10. `cleanupPeer()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `updateProfile()` --semantically_similar_to--> `Shared Browser Card (#sb-card, webview)`  [INFERRED] [semantically similar]
  electron/cursor-overlay.html → index.html
- `setupVUMeter()` --indirect_call--> `update()`  [INFERRED]
  renderer.js → js/call-tiles.js
- `WebRTC()` --indirect_call--> `answer()`  [INFERRED]
  src/components/WebRTC.jsx → js/profile.js
- `computeLocalBox()` --indirect_call--> `line()`  [INFERRED]
  js/whiteboard.js → tools/net/diagnose.js
- `drawOp()` --indirect_call--> `line()`  [INFERRED]
  js/whiteboard.js → tools/net/diagnose.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **Room Activity Cards (Whiteboard, YouTube Watch-Together, Shared Browser, UNO) share the #grid focus-layout mechanism** — index_grid_cards_area, index_whiteboard_card, index_youtube_watch_together_card, index_shared_browser_card, index_uno_card [EXTRACTED 0.90]
- **Create-Room premium options (RNNoise, SFW AI, Game Mode, Relay, Bitrate) configured together at room creation** — index_step_create_form, index_rnnoise_toggle_option, index_sfw_toggle_option, index_game_mode_toggle_option, index_relay_toggle_option, index_bitrate_select [EXTRACTED 0.90]
- **TeamSync release pipeline: version bump in index/docs marketing pages triggers GitHub Actions build published to GitHub Releases** — github_workflows_release_release_workflow, docs_index_github_releases_link, index_teamsync_login_flow [INFERRED 0.65]

## Communities (83 total, 16 thin omitted)

### Community 0 - "UNO Card Game"
Cohesion: 0.10
Nodes (62): handleUnoMessage(), initUno(), UNO_COLORS, UNO_GLYPH, unoActorEl(), unoAddBot(), unoBecomeHost(), unoBlockEffect() (+54 more)

### Community 1 - "App Shell & Pokedex Data"
Cohesion: 0.08
Nodes (39): App(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle, inputStyle (+31 more)

### Community 2 - "Chat & Renderer Utilities"
Cohesion: 0.03
Nodes (87): ACTIVITY_CARD_IDS, ACTIVITY_COVER_LOCALES, AUDIO_CHANNEL_FIELDS, badWordsList, BUILT_IN_THEME_PRESETS, censorProfaneText(), chatBlobUrls, checkTextWithAI() (+79 more)

### Community 3 - "Electron Main Process"
Cohesion: 0.05
Nodes (48): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, powerMonitor, powerSaveBlocker, screen, shell, Tray, nativeImage, safeStorage }, applyDnsSettings(), baseUserData, boundedString(), createCursorOverlay(), createWindow(), cursorProfile(), deviceIdentityFile (+40 more)

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
Cohesion: 0.14
Nodes (25): applyPttMode(), applyPttShortcut(), beginShortcutRebind(), cancelShortcutRebind(), getPttAccelerator(), getShortcutBinding(), handleShortcutGateKeydown(), LEGACY_SHORTCUT_CODES (+17 more)

### Community 8 - "Sidebar UI Components"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 9 - "WebRTC ICE & TURN"
Cohesion: 0.09
Nodes (39): adoptScreenAudioTransceiver(), applyAudioSdpParams(), applyIceEscalationPolicy(), applyScreenAudioQuality(), applySharedTurn(), applySpeakerTo(), attachPeerScreenAudio(), attachVideo() (+31 more)

### Community 10 - "E2E Test: MQTT/First Run"
Cohesion: 0.12
Nodes (30): allPlayersVoted(), apply(), bindCloseButton(), calculateRoundScores(), challengeEntries(), closeAllCards(), closeNameCity(), emit() (+22 more)

### Community 11 - "E2E Test Harness"
Cohesion: 0.11
Nodes (23): assert, audioState(), setPersonalToggle(), {
  spawnPeer,
  cleanupPeer,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  evalJS,
  waitFor,
}, { spawnPeer, cleanupPeer, waitFor, evalJS, createRoom }, clickWhenReady(), createRoom(), joinRoom() (+15 more)

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
Cohesion: 0.21
Nodes (21): checkSession(), deviceLogin(), getDefaultAccount(), getNickname(), initShortcutSettings(), lbCopyImage(), loadSupabaseProfile(), openServerDM() (+13 more)

### Community 18 - "Build Tooling Dependencies"
Cohesion: 0.15
Nodes (13): concurrently, cross-env, electron, electron-builder, devDependencies, concurrently, cross-env, electron (+5 more)

### Community 19 - "Chat Messaging & Invites"
Cohesion: 0.18
Nodes (19): applyPeerLimiter(), applyPeerVolume(), AUDIO_CHANNELS, buildCardVolumeBox(), buildMenuVolumeBlock(), channelFields(), ensurePeerBoostChain(), getUserVolume() (+11 more)

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
Cohesion: 0.15
Nodes (28): applyAudioBitrateToPeers(), bindUI(), canModerateTarget(), clearFocusInlineLayout(), ensureFocusControlsVisible(), enterFocus(), exitFocus(), founderSuccessorId() (+20 more)

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
Cohesion: 0.33
Nodes (5): assert, fs, inspectAtWidth(), path, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}

### Community 32 - "appendChat"
Cohesion: 0.19
Nodes (24): applyPrejoinPrefs(), bind(), closeQuickCall(), enter(), exit(), init(), observe(), onCallEnd() (+16 more)

### Community 33 - "diagnose.js"
Cohesion: 0.13
Nodes (17): RFC-5389, ATTR, buildMsg(), crypto, dgram, errText(), https, RFC-6598 (+9 more)

### Community 35 - "Watch Together Feature"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 36 - "README Documentation"
Cohesion: 0.40
Nodes (5): Build & Portable Distribution, P2P Serverless Architecture, Project Structure Layout, RNNoise Noise Suppression, TeamSync Application

### Community 37 - "E2E Test: Pokemon Moves"
Cohesion: 0.20
Nodes (10): build, appId, directories, npmRebuild, productName, publish, win, output (+2 more)

### Community 38 - "HTML Patch Tool v1"
Cohesion: 0.50
Nodes (3): assert, dispatchKey(), { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor }

### Community 39 - "color-picker.js"
Cohesion: 0.25
Nodes (19): build(), close(), commitValue(), dragify(), ensureStyles(), hexToRgb(), loadRecents(), makeSwatch() (+11 more)

### Community 40 - "shell-dm.js"
Cohesion: 0.25
Nodes (18): bind(), clearUnread(), currentDmView(), dayLabel(), ensureLoaded(), groupedHtml(), isViewing(), lastTimestamp() (+10 more)

### Community 41 - "sendFile"
Cohesion: 0.13
Nodes (19): appendFileMsg(), confirmLargeFileSend(), dataUrlByteSize(), dmContentHtml(), fileCardIcon(), formatFileSize(), getActiveActivity(), initFileTransfer() (+11 more)

### Community 42 - "E2E Test Runner"
Cohesion: 0.33
Nodes (6): fs, main(), path, runIsolatedTest(), { spawn }, TEST_TIMEOUT_MS

### Community 43 - "harness.js"
Cohesion: 0.14
Nodes (12): assert, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}, assert, { spawnPeer, cleanupPeer, evalJS }, APP_DIR, ELECTRON_BIN, fs, makeFriends() (+4 more)

### Community 44 - "ts-ui.js"
Cohesion: 0.22
Nodes (11): avatarHtml(), closePopover(), colorFromString(), formatElapsed(), gameArtHtml(), popover(), safeImg(), sinceHtml() (+3 more)

### Community 45 - "call-tiles.js"
Cohesion: 0.35
Nodes (11): add(), clear(), ensureInviteTile(), grid(), peerInfo(), remove(), render(), safeId() (+3 more)

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

### Community 50 - "Whiteboard Feature"
Cohesion: 0.12
Nodes (57): addDetailTags(), addFiles(), advanceDetail(), bindContextMenu(), bindDetailModal(), bindDropzone(), bindFilterGroup(), cleanTag() (+49 more)

### Community 60 - "Cross-Fetch Dependency"
Cohesion: 0.07
Nodes (70): APP_THEMES, applyCustomThemeColors(), applyMicrophoneVolume(), applyPaletteToEditor(), applyRoomNoiseSuppression(), applySimpleUi(), applySpeakerToAll(), applySpeakerVolume() (+62 more)

### Community 66 - "handlePeerDiscovered"
Cohesion: 0.23
Nodes (17): lbApply(), lbClamp(), lbClose(), lbComputeFitScale(), lbEnsure(), lbFit(), lbKeyHandler(), lbRotate() (+9 more)

### Community 68 - "Lucky Wheel Feature"
Cohesion: 0.06
Nodes (88): initLuckyWheel(), addBot(), addBotMemory(), addLobbyChatMessage(), addressedMessageFor(), afterNight(), analyzeChatClaim(), applyBotReward() (+80 more)

### Community 69 - "Poke Feature Init"
Cohesion: 0.11
Nodes (21): evalJS(), armNavCounter(), assert, http, navigateVia(), { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS, waitFor }, assert, installMockOllama() (+13 more)

### Community 70 - "Supabase Client Dependency"
Cohesion: 0.29
Nodes (7): files, **/*, !dist, !.env, !problemler.md, !tools/dev/yapaydenetleyici.js, !yapaydenetliyici.md

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
Cohesion: 0.11
Nodes (14): { spawnPeer, cleanupPeer, waitFor }, cleanupPeer(), assert, fs, path, { spawnPeer, cleanupPeer, evalJS, waitFor }, assert, fs (+6 more)

### Community 82 - "TeamSync localization terminology"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, releaseName, version

### Community 84 - "showToast"
Cohesion: 0.10
Nodes (45): addUser(), addVideoCard(), applyMicState(), broadcast(), broadcastTo(), canManageRoom(), clearControlOffer(), closeActiveControlSession() (+37 more)

### Community 85 - "enterFocus"
Cohesion: 0.33
Nodes (6): nsis, artifactName, deleteAppDataOnUninstall, oneClick, perMachine, runAfterFinish

### Community 87 - "deviceLogin"
Cohesion: 0.08
Nodes (38): acceptServerInvite(), appendChat(), beginRoomOperation(), censoredTextHtml(), checkAvatar(), connectGlobalBroker(), deleteDeviceAccount(), disconnectApp() (+30 more)

### Community 89 - "seed_machine_draft.py"
Cohesion: 0.60
Nodes (4): load(), Generate review-required locale drafts; never use this at application runtime., run(), save()

### Community 92 - "i18n-coverage.test.js"
Cohesion: 0.06
Nodes (111): accentColor(), addOps(), announceRemoteActivity(), applyLive(), bboxOf(), bindUI(), buildSwatches(), call() (+103 more)

## Ambiguous Edges - Review These
- `window.handlePokeImgError() sprite fallback chain` → `PokeAPI (pokeapi.co)`  [AMBIGUOUS]
  index.html · relation: calls

## Knowledge Gaps
- **330 isolated node(s):** `fs`, `path`, `crypto`, `fs`, `path` (+325 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `window.handlePokeImgError() sprite fallback chain` and `PokeAPI (pokeapi.co)`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `remove()` connect `call-tiles.js` to `Whiteboard Feature`, `Lucky Wheel Feature`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `setupVUMeter()` connect `Cross-Fetch Dependency` to `Chat & Renderer Utilities`, `call-tiles.js`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **Why does `update()` connect `call-tiles.js` to `Cross-Fetch Dependency`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `crypto` to the rest of the system?**
  _330 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UNO Card Game` be split into smaller, more focused modules?**
  _Cohesion score 0.09821428571428571 - nodes in this community are weakly interconnected._
- **Should `App Shell & Pokedex Data` be split into smaller, more focused modules?**
  _Cohesion score 0.07767722473604827 - nodes in this community are weakly interconnected._