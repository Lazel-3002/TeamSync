# Graph Report - TeamSync  (2026-07-29)

## Corpus Check
- 87 files · ~526,821 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 965 nodes · 1971 edges · 80 communities (59 shown, 21 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `24677935`
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
- Device Auth & Session
- NPM Scripts
- RNNoise Noise Suppression
- Smeargle Sprite Generator
- Package Metadata
- E2E Test: Lucky Wheel
- E2E Test: Quick Poll
- E2E Test: Focus Minimize
- E2E Test: Friend List
- Pokemon Moves Fetch Tool
- Mega Evolution Data Injector
- Pokemon Sprite Assets
- Watch Together Feature
- README Documentation
- E2E Test: Pokemon Moves
- HTML Patch Tool v1
- HTML Patch Tool v2
- Emoji CSS Patch
- Smeargle Sprite Variants
- E2E Test Runner
- Death Animation Patch
- Guide Patch
- Poke Volume Patch
- CSS Enhancement Patch
- Emoji Fix Patch
- CSS Improvement Patch
- Emoji Improvement Patch
- Whiteboard Feature
- Audio Patch
- Modal Patch
- Poke Fix Patch
- Type Chart Fix Patch
- CSS Types Injection Patch
- HTML Types Injection Patch
- JS Types Injection Patch
- Base64 Poke Restore Patch
- App Icon & Logo Assets
- Cross-Fetch Dependency
- Notification Window
- Cursor Overlay Preload
- Notification Preload
- Tray Preload
- Tray Menu
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
- settings-language.test.js

## God Nodes (most connected - your core abstractions)
1. `evalJS()` - 48 edges
2. `handleDataMessage()` - 38 edges
3. `bindUI()` - 37 edges
4. `spawnPeer()` - 30 edges
5. `showToast()` - 28 edges
6. `waitFor()` - 27 edges
7. `render()` - 26 edges
8. `cleanupPeer()` - 24 edges
9. `initUserSettings()` - 23 edges
10. `createRoom()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Pokemon Selection UI Styles` --semantically_similar_to--> `Poke Savaşları Battle Cover Image`  [INFERRED] [semantically similar]
  index.html → assets/pokemon/poke-battle-cover.png
- `updateProfile()` --semantically_similar_to--> `Shared Browser Card (#sb-card, webview)`  [INFERRED] [semantically similar]
  electron/cursor-overlay.html → index.html
- `initPoke()` --indirect_call--> `t()`  [INFERRED]
  js/poke.js → renderer.js
- `WebRTC()` --indirect_call--> `handleSignal()`  [INFERRED]
  src/components/WebRTC.jsx → renderer.js
- `Features Section (P2P, Device ID, Screen Share, SFW, Activities, RNNoise)` --references--> `Aile Dostu (SFW AI) Toggle`  [INFERRED]
  docs/index.html → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **Room Activity Cards (Whiteboard, YouTube Watch-Together, Shared Browser, UNO) share the #grid focus-layout mechanism** — index_grid_cards_area, index_whiteboard_card, index_youtube_watch_together_card, index_shared_browser_card, index_uno_card [EXTRACTED 0.90]
- **Create-Room premium options (RNNoise, SFW AI, Game Mode, Relay, Bitrate) configured together at room creation** — index_step_create_form, index_rnnoise_toggle_option, index_sfw_toggle_option, index_game_mode_toggle_option, index_relay_toggle_option, index_bitrate_select [EXTRACTED 0.90]
- **TeamSync release pipeline: version bump in index/docs marketing pages triggers GitHub Actions build published to GitHub Releases** — github_workflows_release_release_workflow, docs_index_github_releases_link, index_teamsync_login_flow [INFERRED 0.65]

## Communities (80 total, 21 thin omitted)

### Community 0 - "UNO Card Game"
Cohesion: 0.12
Nodes (56): handleUnoMessage(), initUno(), UNO_COLORS, UNO_GLYPH, unoActorEl(), unoAddBot(), unoBecomeHost(), unoBotName() (+48 more)

### Community 1 - "App Shell & Pokedex Data"
Cohesion: 0.07
Nodes (39): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+31 more)

### Community 2 - "Chat & Renderer Utilities"
Cohesion: 0.04
Nodes (60): acceptServerInvite(), appendFileMsg(), badWordsList, badWordsRegex, chatBlobUrls, checkSession(), closeJoinRequestNote(), connectGlobalBroker() (+52 more)

### Community 3 - "Electron Main Process"
Cohesion: 0.07
Nodes (37): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, createCursorOverlay(), createWindow(), cursorProfile(), deviceIdentityFile, dgram, _diagSettingsPath (+29 more)

### Community 4 - "Pokemon Assets & Landing Docs"
Cohesion: 0.06
Nodes (37): Blastoise Battle Card, Bulbasaur Battle Card, Charizard Battle Card, Pikachu Battle Card, Poke Savaşları Battle Cover Image, Download CTA Section, Features Section (P2P, Device ID, Screen Share, SFW, Activities, RNNoise), GitHub Releases Link (Lazel-3002/TeamSync) (+29 more)

### Community 5 - "Audio Bitrate & Mic Controls"
Cohesion: 0.10
Nodes (38): addUser(), addVideoCard(), appendChat(), attachVideo(), broadcastTo(), checkAvatar(), checkTextWithAI(), cleanText() (+30 more)

### Community 6 - "User List & Avatars"
Cohesion: 0.21
Nodes (17): applyPeerVolume(), ensurePeerBoostChain(), getNickname(), getUserVolume(), intendedPeerVolumeIsZero(), isPeerScreenOpen(), logVoicePathReport(), openServerDM() (+9 more)

### Community 7 - "Electron Builder Config"
Cohesion: 0.22
Nodes (9): build, appId, directories, productName, publish, win, output, icon (+1 more)

### Community 8 - "Sidebar UI Components"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 9 - "WebRTC ICE & TURN"
Cohesion: 0.15
Nodes (22): applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), attemptIceRestart(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure(), dohResolve() (+14 more)

### Community 10 - "E2E Test: MQTT/First Run"
Cohesion: 0.24
Nodes (9): setValueWhenReady(), waitFor(), assert, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
}, fs, inspectFamily(), path, run() (+1 more)

### Community 11 - "E2E Test Harness"
Cohesion: 0.15
Nodes (15): assert, audioState(), setFounderToggle(), {
  spawnPeer,
  cleanupPeer,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  evalJS,
  waitFor,
}, clickWhenReady(), createRoom(), joinRoom(), waitForPeerConnected() (+7 more)

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
Cohesion: 0.27
Nodes (16): clearFocusInlineLayout(), closeAllCards(), ensureFocusControlsVisible(), enterFocus(), exitFocus(), makeCardFocusable(), minimizeFocus(), openCardFocused() (+8 more)

### Community 16 - "E2E Test: RNNoise Toggle"
Cohesion: 0.25
Nodes (5): armNavCounter(), assert, http, navigateVia(), { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS, waitFor }

### Community 17 - "Pokemon Data Fetch Tool"
Cohesion: 0.22
Nodes (16): extractEvolutionNames(), extractEvolutionStages(), fetchInBatches(), fetchJson(), formatVarietyName(), fs, HIDDEN_VARIETY_PATTERNS, https (+8 more)

### Community 18 - "Build Tooling Dependencies"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 19 - "Chat Messaging & Invites"
Cohesion: 0.15
Nodes (24): applyAudioBitrateToPeers(), applyMicState(), applyPttMode(), applyRoomNoiseSuppression(), bindUI(), broadcast(), canManageRoom(), canModerateTarget() (+16 more)

### Community 20 - "Diagnostics Tool"
Cohesion: 0.35
Nodes (11): _analyzeCssText(), _append(), appendCapture(), appendRenderer(), crypto, _extractRule(), fs, init() (+3 more)

### Community 21 - "applyUserTheme"
Cohesion: 0.33
Nodes (10): APP_THEMES, applyCustomThemeColors(), applyUserTheme(), CUSTOM_THEME_PRESETS, getCustomThemeColors(), hexLuminance(), initCustomThemeEditor(), markActiveCustomPreset() (+2 more)

### Community 22 - "Yapay Denetleyici Tool"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 23 - "Device Auth & Session"
Cohesion: 0.40
Nodes (4): assert, fs, path, {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
}

### Community 24 - "NPM Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, build-full, build:react, dev:react, diag, release, start (+1 more)

### Community 25 - "RNNoise Noise Suppression"
Cohesion: 0.43
Nodes (6): canCompileWasm(), createNoiseFilter(), isSupported(), loadArrayBuffer(), loadWasmBinary(), supportsWasmSimd()

### Community 26 - "Smeargle Sprite Generator"
Cohesion: 0.29
Nodes (7): assertSourceGif(), fs, generate(), outputDir, path, sourcePath, variants

### Community 27 - "Package Metadata"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, releaseName, version

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
Cohesion: 0.29
Nodes (5): assert, fs, inspectPoll(), path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
}

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

### Community 32 - "Pokemon Moves Fetch Tool"
Cohesion: 0.47
Nodes (5): cleanEffectText(), fetchJson(), fs, https, run()

### Community 33 - "Mega Evolution Data Injector"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

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
Cohesion: 0.40
Nodes (4): assert, fs, path, {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
}

### Community 38 - "HTML Patch Tool v1"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 39 - "HTML Patch Tool v2"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 40 - "Emoji CSS Patch"
Cohesion: 0.40
Nodes (4): css, endIndex, fs, startIndex

### Community 41 - "Smeargle Sprite Variants"
Cohesion: 0.50
Nodes (4): Smeargle Blue Sprite, Smeargle Green Sprite, Smeargle Indigo Sprite, Smeargle Orange Sprite

### Community 43 - "Death Animation Patch"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 44 - "Guide Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 45 - "Poke Volume Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 46 - "CSS Enhancement Patch"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 47 - "Emoji Fix Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 48 - "CSS Improvement Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 49 - "Emoji Improvement Patch"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

### Community 50 - "Whiteboard Feature"
Cohesion: 0.16
Nodes (32): addFiles(), bindDropzone(), bindFilterGroup(), closeAttachmentMenu(), closePicker(), createMediaPreview(), createPickerCard(), createSettingsCard() (+24 more)

### Community 60 - "Cross-Fetch Dependency"
Cohesion: 0.17
Nodes (28): applyMicrophoneVolume(), applySpeakerToAll(), applySpeakerVolume(), applyUserLanguage(), fillAudioDeviceSelect(), formatUserTime(), getUserLanguage(), getUserTheme() (+20 more)

### Community 68 - "Lucky Wheel Feature"
Cohesion: 0.08
Nodes (62): initLuckyWheel(), addBot(), addBotMemory(), addLobbyChatMessage(), addressedMessageFor(), afterNight(), applyBotRole(), armPhaseTimer() (+54 more)

### Community 69 - "Poke Feature Init"
Cohesion: 0.14
Nodes (17): initPoke(), evalJS(), assert, installMockOllama(), installNightScenario(), setLobbyPhaseState(), setupLobbyRecord(), { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } (+9 more)

### Community 70 - "Supabase Client Dependency"
Cohesion: 0.29
Nodes (7): files, **/*, !dist, !.env, !problemler.md, !tools/dev/yapaydenetleyici.js, !yapaydenetliyici.md

### Community 79 - "nsis"
Cohesion: 0.33
Nodes (6): nsis, artifactName, deleteAppDataOnUninstall, oneClick, perMachine, runAfterFinish

### Community 81 - "settings-language.test.js"
Cohesion: 0.10
Nodes (19): { spawnPeer, cleanupPeer, waitFor }, assert, { spawnPeer, cleanupPeer, evalJS }, { spawnPeer, cleanupPeer, waitFor, evalJS, createRoom }, APP_DIR, cleanupPeer(), ELECTRON_BIN, fs (+11 more)

## Ambiguous Edges - Review These
- `window.handlePokeImgError() sprite fallback chain` → `PokeAPI (pokeapi.co)`  [AMBIGUOUS]
  index.html · relation: calls

## Knowledge Gaps
- **305 isolated node(s):** `fs`, `path`, `crypto`, `{ contextBridge, ipcRenderer }`, `{ contextBridge, ipcRenderer }` (+300 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `window.handlePokeImgError() sprite fallback chain` and `PokeAPI (pokeapi.co)`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `t()` connect `Cross-Fetch Dependency` to `Audio Bitrate & Mic Controls`, `Chat & Renderer Utilities`, `Chat Messaging & Invites`, `Poke Feature Init`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `initPoke()` connect `Poke Feature Init` to `Cross-Fetch Dependency`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `crypto` to the rest of the system?**
  _305 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UNO Card Game` be split into smaller, more focused modules?**
  _Cohesion score 0.11779448621553884 - nodes in this community are weakly interconnected._
- **Should `App Shell & Pokedex Data` be split into smaller, more focused modules?**
  _Cohesion score 0.07205387205387205 - nodes in this community are weakly interconnected._
- **Should `Chat & Renderer Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.03827751196172249 - nodes in this community are weakly interconnected._