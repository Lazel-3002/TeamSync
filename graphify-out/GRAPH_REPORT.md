# Graph Report - TeamSync  (2026-08-18)

## Corpus Check
- 88 files · ~512,736 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1298 nodes · 3080 edges · 82 communities (65 shown, 17 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `20503bee`
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
- shortcutSuppressionReason
- Pokemon Sprite Assets
- Watch Together Feature
- README Documentation
- E2E Test: Pokemon Moves
- HTML Patch Tool v1
- sendFile
- showJoinRequestNote
- Smeargle Sprite Variants
- E2E Test Runner
- saveRoomBans
- releaseSpeakingNode
- filterActivityCards
- setAuthorizedCursorProfile
- shortcutComboLabel
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
- broadcast
- deviceLogin
- seed_machine_draft.py
- i18n-coverage.test.js
- TeamSync localization terminology
- media-collect-resize.test.js

## God Nodes (most connected - your core abstractions)
1. `evalJS()` - 51 edges
2. `handleDataMessage()` - 43 edges
3. `bindUI()` - 41 edges
4. `render()` - 35 edges
5. `showToast()` - 35 edges
6. `spawnPeer()` - 32 edges
7. `bindUI()` - 30 edges
8. `t()` - 27 edges
9. `waitFor()` - 26 edges
10. `cleanupPeer()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `Pokemon Selection UI Styles` --semantically_similar_to--> `Poke Savaşları Battle Cover Image`  [INFERRED] [semantically similar]
  index.html → assets/pokemon/poke-battle-cover.png
- `updateProfile()` --semantically_similar_to--> `Shared Browser Card (#sb-card, webview)`  [INFERRED] [semantically similar]
  electron/cursor-overlay.html → index.html
- `WebRTC()` --indirect_call--> `handleSignal()`  [INFERRED]
  src/components/WebRTC.jsx → renderer.js
- `Features Section (P2P, Device ID, Screen Share, SFW, Activities, RNNoise)` --references--> `Aile Dostu (SFW AI) Toggle`  [INFERRED]
  docs/index.html → index.html
- `Smeargle Teal Variant (animated sprite)` --conceptually_related_to--> `TeamSync Main Screen Screenshot (P2P server/friends UI)`  [INFERRED]
  assets/pokemon/smeargle/smeargle-teal.gif → docs/assets/screenshot-main.png

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **Room Activity Cards (Whiteboard, YouTube Watch-Together, Shared Browser, UNO) share the #grid focus-layout mechanism** — index_grid_cards_area, index_whiteboard_card, index_youtube_watch_together_card, index_shared_browser_card, index_uno_card [EXTRACTED 0.90]
- **Create-Room premium options (RNNoise, SFW AI, Game Mode, Relay, Bitrate) configured together at room creation** — index_step_create_form, index_rnnoise_toggle_option, index_sfw_toggle_option, index_game_mode_toggle_option, index_relay_toggle_option, index_bitrate_select [EXTRACTED 0.90]
- **TeamSync release pipeline: version bump in index/docs marketing pages triggers GitHub Actions build published to GitHub Releases** — github_workflows_release_release_workflow, docs_index_github_releases_link, index_teamsync_login_flow [INFERRED 0.65]

## Communities (82 total, 17 thin omitted)

### Community 0 - "UNO Card Game"
Cohesion: 0.10
Nodes (60): handleUnoMessage(), initUno(), UNO_COLORS, UNO_GLYPH, unoActorEl(), unoAddBot(), unoBecomeHost(), unoBotName() (+52 more)

### Community 1 - "App Shell & Pokedex Data"
Cohesion: 0.08
Nodes (39): App(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle, inputStyle (+31 more)

### Community 2 - "Chat & Renderer Utilities"
Cohesion: 0.04
Nodes (38): ACTIVITY_COVER_LOCALES, AUDIO_CHANNEL_FIELDS, badWordsList, BUILT_IN_THEME_PRESETS, chatBlobUrls, ctrlOfferAcceptBtn, ctrlOfferDenyBtn, CUSTOM_COLOR_SWATCHES (+30 more)

### Community 3 - "Electron Main Process"
Cohesion: 0.06
Nodes (42): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, powerSaveBlocker, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, boundedString(), createCursorOverlay(), createWindow(), cursorProfile(), deviceIdentityFile, dgram (+34 more)

### Community 4 - "Pokemon Assets & Landing Docs"
Cohesion: 0.06
Nodes (37): Blastoise Battle Card, Bulbasaur Battle Card, Charizard Battle Card, Pikachu Battle Card, Poke Savaşları Battle Cover Image, Download CTA Section, Features Section (P2P, Device ID, Screen Share, SFW, Activities, RNNoise), GitHub Releases Link (Lazel-3002/TeamSync) (+29 more)

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
Cohesion: 0.17
Nodes (23): applyPttShortcut(), beginShortcutRebind(), cancelShortcutRebind(), getPttAccelerator(), getShortcutBinding(), handleShortcutGateKeydown(), initShortcutSettings(), LEGACY_SHORTCUT_CODES (+15 more)

### Community 8 - "Sidebar UI Components"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 9 - "WebRTC ICE & TURN"
Cohesion: 0.07
Nodes (40): adoptScreenAudioTransceiver(), applyAudioSdpParams(), applyIceEscalationPolicy(), applyScreenAudioQuality(), applySharedTurn(), applySpeakerTo(), applySpeakerToAll(), attachPeerScreenAudio() (+32 more)

### Community 10 - "E2E Test: MQTT/First Run"
Cohesion: 0.13
Nodes (29): allPlayersVoted(), apply(), bindCloseButton(), calculateRoundScores(), challengeEntries(), closeAllCards(), closeNameCity(), emit() (+21 more)

### Community 11 - "E2E Test Harness"
Cohesion: 0.13
Nodes (22): { spawnPeer, cleanupPeer, waitFor, evalJS, createRoom }, APP_DIR, clickWhenReady(), createRoom(), ELECTRON_BIN, fs, joinRoom(), os (+14 more)

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
Cohesion: 0.15
Nodes (25): Activities(), ACTIVITY_LIST, activityCard, activityIcon, bigButton(), categoryLabels(), centerStyle, challengeKey() (+17 more)

### Community 17 - "Pokemon Data Fetch Tool"
Cohesion: 0.21
Nodes (17): checkSession(), deleteDeviceAccount(), deviceLogin(), getActiveSlot(), getDefaultAccount(), getDeviceAccounts(), isDefaultAccountRef(), loadSupabaseProfile() (+9 more)

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
Cohesion: 0.29
Nodes (8): censorProfaneText(), checkTextWithAI(), filterProjection(), isProfaneText(), isSubsequence(), levenshteinDistance(), maskCensoredSegment(), normalizeFilterText()

### Community 24 - "NPM Scripts"
Cohesion: 0.11
Nodes (40): applyAudioBitrateToPeers(), applyMicState(), applyPttMode(), applyUserLanguage(), bindUI(), broadcast(), canManageRoom(), canModerateTarget() (+32 more)

### Community 25 - "RNNoise Noise Suppression"
Cohesion: 0.43
Nodes (6): canCompileWasm(), createNoiseFilter(), isSupported(), loadArrayBuffer(), loadWasmBinary(), supportsWasmSimd()

### Community 26 - "Smeargle Sprite Generator"
Cohesion: 0.25
Nodes (5): armNavCounter(), assert, http, navigateVia(), { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS, waitFor }

### Community 27 - "Package Metadata"
Cohesion: 0.18
Nodes (11): scripts, build, build-full, build:react, dev:react, diag, i18n:audit, i18n:build-runtime (+3 more)

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
Cohesion: 0.24
Nodes (15): APP_THEMES, applyCustomThemeColors(), applyUserTheme(), getAllThemePresets(), getCustomThemeColors(), getThemePresetLabel(), hexLuminance(), initCustomThemeEditor() (+7 more)

### Community 33 - "shortcutSuppressionReason"
Cohesion: 0.20
Nodes (11): ACTIVITY_CARD_IDS, getShortcutsMasterEnabled(), isActivityForeground(), isRemoteControlEngaged(), isShortcutOverlayForeground(), isShortcutSuppressed(), isShortcutTypingTarget(), SHORTCUT_SUPPRESSION_EXEMPT (+3 more)

### Community 34 - "Pokemon Sprite Assets"
Cohesion: 0.50
Nodes (5): Smeargle Red Variant (animated sprite), Smeargle Teal Variant (animated sprite), Smeargle Yellow Variant (animated sprite), TeamSync App Icon (hexagon with group of people), TeamSync Main Screen Screenshot (P2P server/friends UI)

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

### Community 39 - "sendFile"
Cohesion: 0.40
Nodes (5): appendFileMsg(), confirmLargeFileSend(), initFileTransfer(), isImageFile(), sendFile()

### Community 40 - "showJoinRequestNote"
Cohesion: 0.50
Nodes (4): closeJoinRequestNote(), isPersistentFriendId(), publishJoinEvent(), showJoinRequestNote()

### Community 41 - "Smeargle Sprite Variants"
Cohesion: 0.50
Nodes (4): Smeargle Blue Sprite, Smeargle Green Sprite, Smeargle Indigo Sprite, Smeargle Orange Sprite

### Community 42 - "E2E Test Runner"
Cohesion: 0.33
Nodes (6): fs, main(), path, runIsolatedTest(), { spawn }, TEST_TIMEOUT_MS

### Community 43 - "saveRoomBans"
Cohesion: 0.67
Nodes (3): loadRoomBans(), roomBansKey(), saveRoomBans()

### Community 44 - "releaseSpeakingNode"
Cohesion: 0.67
Nodes (4): releaseSpeakingNode(), runSpeakingDetection(), setupSpeakingDetection(), updateUserUI()

### Community 50 - "Whiteboard Feature"
Cohesion: 0.12
Nodes (57): addDetailTags(), addFiles(), advanceDetail(), bindContextMenu(), bindDetailModal(), bindDropzone(), bindFilterGroup(), cleanTag() (+49 more)

### Community 60 - "Cross-Fetch Dependency"
Cohesion: 0.14
Nodes (32): applyMicrophoneVolume(), applyRoomNoiseSuppression(), applySimpleUi(), applySpeakerVolume(), fillAudioDeviceSelect(), getSimpleUiEnabled(), getUserLanguage(), getUserTheme() (+24 more)

### Community 66 - "handlePeerDiscovered"
Cohesion: 0.23
Nodes (17): lbApply(), lbClamp(), lbClose(), lbComputeFitScale(), lbEnsure(), lbFit(), lbKeyHandler(), lbRotate() (+9 more)

### Community 68 - "Lucky Wheel Feature"
Cohesion: 0.06
Nodes (87): initLuckyWheel(), addBot(), addBotMemory(), addLobbyChatMessage(), addressedMessageFor(), afterNight(), analyzeChatClaim(), applyBotReward() (+79 more)

### Community 69 - "Poke Feature Init"
Cohesion: 0.13
Nodes (20): assert, audioState(), setPersonalToggle(), {
  spawnPeer,
  cleanupPeer,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  evalJS,
  waitFor,
}, evalJS(), assert, installMockOllama(), installNightScenario() (+12 more)

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
Cohesion: 0.54
Nodes (7): apply(), applyStored(), bindHandle(), clamp(), init(), limitFor(), stored()

### Community 81 - "settings-language.test.js"
Cohesion: 0.09
Nodes (15): { spawnPeer, cleanupPeer, waitFor }, assert, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}, assert, { spawnPeer, cleanupPeer, evalJS }, cleanupPeer(), assert, fs (+7 more)

### Community 82 - "TeamSync localization terminology"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, releaseName, version

### Community 84 - "showToast"
Cohesion: 0.11
Nodes (40): addUser(), addVideoCard(), broadcastTo(), clearControlOffer(), closeActiveControlSession(), closeCtrlModal(), closeCtrlOfferNote(), decryptMsg() (+32 more)

### Community 85 - "enterFocus"
Cohesion: 0.33
Nodes (6): nsis, artifactName, deleteAppDataOnUninstall, oneClick, perMachine, runAfterFinish

### Community 86 - "broadcast"
Cohesion: 0.40
Nodes (4): assert, fs, path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
}

### Community 87 - "deviceLogin"
Cohesion: 0.10
Nodes (28): acceptServerInvite(), appendChat(), beginRoomOperation(), censoredTextHtml(), checkAvatar(), cleanText(), connectGlobalBroker(), disconnectApp() (+20 more)

### Community 89 - "seed_machine_draft.py"
Cohesion: 0.60
Nodes (4): load(), Generate review-required locale drafts; never use this at application runtime., run(), save()

### Community 92 - "i18n-coverage.test.js"
Cohesion: 0.06
Nodes (111): accentColor(), addOps(), announceRemoteActivity(), applyLive(), bboxOf(), bindUI(), buildSwatches(), call() (+103 more)

### Community 100 - "media-collect-resize.test.js"
Cohesion: 0.40
Nodes (4): assert, fs, path, { spawnPeer, cleanupPeer, evalJS, waitFor }

## Ambiguous Edges - Review These
- `window.handlePokeImgError() sprite fallback chain` → `PokeAPI (pokeapi.co)`  [AMBIGUOUS]
  index.html · relation: calls

## Knowledge Gaps
- **304 isolated node(s):** `fs`, `path`, `crypto`, `{ contextBridge, ipcRenderer }`, `{ contextBridge, ipcRenderer }` (+299 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `window.handlePokeImgError() sprite fallback chain` and `PokeAPI (pokeapi.co)`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `handleSignal()` connect `WebRTC ICE & TURN` to `NPM Scripts`, `App Shell & Pokedex Data`, `Chat & Renderer Utilities`, `deviceLogin`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `WebRTC()` connect `App Shell & Pokedex Data` to `WebRTC ICE & TURN`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `evalJS()` connect `Poke Feature Init` to `media-collect-resize.test.js`, `Audio Bitrate & Mic Controls`, `HTML Patch Tool v1`, `E2E Test Harness`, `E2E Test: Scroll/Download`, `nsis`, `settings-language.test.js`, `broadcast`, `Smeargle Sprite Generator`, `E2E Test: Lucky Wheel`, `E2E Test: Quick Poll`, `E2E Test: Focus Minimize`, `E2E Test: Friend List`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `render()` (e.g. with `addBot()` and `continueAfterVoteResult()`) actually correct?**
  _`render()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `fs`, `path`, `crypto` to the rest of the system?**
  _304 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UNO Card Game` be split into smaller, more focused modules?**
  _Cohesion score 0.10206240084611316 - nodes in this community are weakly interconnected._