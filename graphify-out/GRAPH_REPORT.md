# Graph Report - ctrl-x-kill-switch  (2026-07-22)

## Corpus Check
- 69 files · ~181,777 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 624 nodes · 1128 edges · 61 communities (40 shown, 21 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e4c4bf00`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- E2E Test Harness
- React App / Signaling / Crypto Core
- Package Dependencies
- Chat & TURN Resolution Utils
- UNO Card Game
- Electron Main Process
- WebRTC Peer & ICE Management
- Landing Page & Docs Concepts
- Screen Share & File Transfer
- Room Moderation & Audio Controls
- Sidebar UI Styles
- Shared Browser Sync
- Build Config & Reference Files
- Device Auth & Presence
- CSS Diagnostics
- AI Denetleyici Tool
- React Activities & UNO Components
- Smeargle Variant Generator
- RNNoise Noise Suppression
- Remote Control & User Menu
- Mega Pokemon Injector
- Sprite / Image Assets
- Watch Together
- Pokemon Data Fetch
- HTML Fix Patch
- HTML Fix Patch 2
- Emoji CSS Replace Patch
- Smeargle Sprite Fallbacks
- E2E Test Runner
- Death Animation Patch
- Guide Patch
- Poke Volume Patch
- CSS Enhance Patch
- Emoji Fix Patch
- CSS Improve Patch
- Emoji Improve Patch
- Whiteboard
- Audio Patch
- Modal Patch
- Poke Fix Patch
- Type Chart Patch
- Types CSS Patch
- Types HTML Patch
- Types JS Patch
- Poke Base64 Restore Patch
- Icon & Logo Assets
- Notification Window
- Preload Notification Bridge
- Preload Tray Bridge
- Tray Menu
- Pokemon Battle Sprites
- Preload Bridge
- Sound Tester
- Tools README
- Fez SVG Asset
- React Entry Point

## God Nodes (most connected - your core abstractions)
1. `handleDataMessage()` - 30 edges
2. `bindUI()` - 29 edges
3. `showToast()` - 21 edges
4. `unoIsHost()` - 18 edges
5. `unoHostApplyPlay()` - 18 edges
6. `evalJS()` - 18 edges
7. `createPeerConnection()` - 16 edges
8. `setupInternetSignaling()` - 15 edges
9. `handleUnoMessage()` - 14 edges
10. `initUno()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `P2P Voice & Video` --semantically_similar_to--> `P2P Serverless Architecture`  [INFERRED] [semantically similar]
  docs/index.html → README.md
- `RNNoise Noise Suppression` --semantically_similar_to--> `RNNoise Toggle Option`  [INFERRED] [semantically similar]
  README.md → index.html
- `Device Identity Login` --semantically_similar_to--> `Device Auth Login Step`  [INFERRED] [semantically similar]
  docs/index.html → index.html
- `WebRTC()` --indirect_call--> `handleSignal()`  [INFERRED]
  src/components/WebRTC.jsx → renderer.js
- `Family-Friendly AI Mode` --conceptually_related_to--> `Join / Create Server Flow`  [INFERRED]
  docs/index.html → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **Serverless P2P Communication Platform** — readme_p2p_serverless, docs_index_p2p_voice_video, index_relay_option, index_emqx_broker [INFERRED 0.75]
- **TeamSync Marketed Feature Set** — docs_index_p2p_voice_video, docs_index_device_id_auth, docs_index_screen_share_remote, docs_index_activities [EXTRACTED 0.75]

## Communities (61 total, 21 thin omitted)

### Community 0 - "E2E Test Harness"
Cohesion: 0.08
Nodes (47): fs, { launch, getPageTarget, cdp, evalJS, waitFor }, os, path, assert, fs, inspectButton(), { launch, getPageTarget, cdp, evalJS, waitFor } (+39 more)

### Community 1 - "React App / Signaling / Crypto Core"
Cohesion: 0.07
Nodes (39): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+31 more)

### Community 2 - "Package Dependencies"
Cohesion: 0.12
Nodes (16): build, appId, directories, files, productName, win, output, icon (+8 more)

### Community 3 - "Chat & TURN Resolution Utils"
Cohesion: 0.07
Nodes (18): appendChat(), badWordsList, badWordsRegex, chatBlobUrls, cleanText(), closeAllCards(), fileBuffer, getActiveActivity() (+10 more)

### Community 4 - "UNO Card Game"
Cohesion: 0.12
Nodes (56): handleUnoMessage(), initUno(), UNO_COLORS, UNO_GLYPH, unoActorEl(), unoAddBot(), unoBecomeHost(), unoBotName() (+48 more)

### Community 5 - "Electron Main Process"
Cohesion: 0.08
Nodes (15): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, deviceIdentityFile, dgram, _diagSettingsPath, envPath, fs, getBroadcastAddresses() (+7 more)

### Community 6 - "WebRTC Peer & ICE Management"
Cohesion: 0.14
Nodes (25): addUser(), applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), applySpeakerToAll(), attemptIceRestart(), checkAvatar(), createPeerConnection() (+17 more)

### Community 7 - "Landing Page & Docs Concepts"
Cohesion: 0.11
Nodes (23): Together Activities (UNO, Wheel, Synced Video, Whiteboard), Device Identity Login, Family-Friendly AI Mode, GitHub Repository (Lazel-3002/TeamSync), TeamSync Landing Page, P2P Voice & Video, Screen Sharing & Remote Control, TeamSync App Shell (Main UI) (+15 more)

### Community 8 - "Screen Share & File Transfer"
Cohesion: 0.20
Nodes (18): addVideoCard(), broadcastTo(), checkTextWithAI(), closeCtrlModal(), decryptMsg(), disconnectApp(), handleDataMessage(), makeCardFocusable() (+10 more)

### Community 9 - "Room Moderation & Audio Controls"
Cohesion: 0.13
Nodes (25): applyAudioBitrateToPeers(), applyMicState(), applyPttMode(), applyRoomNoiseSuppression(), bindUI(), canManageRoom(), canModerateTarget(), getAudioBitrate() (+17 more)

### Community 10 - "Sidebar UI Styles"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 11 - "Shared Browser Sync"
Cohesion: 0.32
Nodes (15): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+7 more)

### Community 12 - "Build Config & Reference Files"
Cohesion: 0.04
Nodes (48): acorn, author, dependencies, acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs (+40 more)

### Community 13 - "Device Auth & Presence"
Cohesion: 0.19
Nodes (16): checkSession(), deviceLogin(), getActiveSlot(), getDeviceAccounts(), loadSupabaseProfile(), loginWithProfileData(), playNote(), playSound() (+8 more)

### Community 14 - "CSS Diagnostics"
Cohesion: 0.35
Nodes (11): _analyzeCssText(), _append(), appendCapture(), appendRenderer(), crypto, _extractRule(), fs, init() (+3 more)

### Community 15 - "AI Denetleyici Tool"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 16 - "React Activities & UNO Components"
Cohesion: 0.21
Nodes (12): appendFileMsg(), attachVideo(), broadcast(), escapeHtml(), getVideoConstraints(), getVideoSender(), initFileTransfer(), isImageFile() (+4 more)

### Community 17 - "Smeargle Variant Generator"
Cohesion: 0.29
Nodes (7): assertSourceGif(), fs, generate(), outputDir, path, sourcePath, variants

### Community 18 - "RNNoise Noise Suppression"
Cohesion: 0.43
Nodes (6): canCompileWasm(), createNoiseFilter(), isSupported(), loadArrayBuffer(), loadWasmBinary(), supportsWasmSimd()

### Community 19 - "Remote Control & User Menu"
Cohesion: 0.43
Nodes (7): dohResolve(), expandTurnFamily(), expandTurnWithIpVariants(), getTurnIpCache(), isIpLiteral(), parseTurnHost(), resolveTurnHostsViaDoH()

### Community 20 - "Mega Pokemon Injector"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 21 - "Sprite / Image Assets"
Cohesion: 0.50
Nodes (5): Smeargle Red Variant (animated sprite), Smeargle Teal Variant (animated sprite), Smeargle Yellow Variant (animated sprite), TeamSync App Icon (hexagon with group of people), TeamSync Main Screen Screenshot (P2P server/friends UI)

### Community 22 - "Watch Together"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 24 - "Pokemon Data Fetch"
Cohesion: 0.50
Nodes (4): fetchJson(), fs, https, run()

### Community 25 - "HTML Fix Patch"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 26 - "HTML Fix Patch 2"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 27 - "Emoji CSS Replace Patch"
Cohesion: 0.40
Nodes (4): css, endIndex, fs, startIndex

### Community 28 - "Smeargle Sprite Fallbacks"
Cohesion: 0.50
Nodes (4): Smeargle Blue Sprite, Smeargle Green Sprite, Smeargle Indigo Sprite, Smeargle Orange Sprite

### Community 30 - "Death Animation Patch"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 31 - "Guide Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 32 - "Poke Volume Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 33 - "CSS Enhance Patch"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 34 - "Emoji Fix Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 35 - "CSS Improve Patch"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 36 - "Emoji Improve Patch"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

## Knowledge Gaps
- **220 isolated node(s):** `fs`, `path`, `crypto`, `{ contextBridge, ipcRenderer }`, `{ contextBridge, ipcRenderer }` (+215 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleSignal()` connect `WebRTC Peer & ICE Management` to `Room Moderation & Audio Controls`, `Chat & TURN Resolution Utils`, `React App / Signaling / Crypto Core`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `WebRTC()` connect `React App / Signaling / Crypto Core` to `WebRTC Peer & ICE Management`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `crypto` to the rest of the system?**
  _220 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `E2E Test Harness` be split into smaller, more focused modules?**
  _Cohesion score 0.07656341320864991 - nodes in this community are weakly interconnected._
- **Should `React App / Signaling / Crypto Core` be split into smaller, more focused modules?**
  _Cohesion score 0.07205387205387205 - nodes in this community are weakly interconnected._
- **Should `Package Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `Chat & TURN Resolution Utils` be split into smaller, more focused modules?**
  _Cohesion score 0.07459677419354839 - nodes in this community are weakly interconnected._