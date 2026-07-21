# Graph Report - .  (2026-07-21)

## Corpus Check
- 86 files · ~193,613 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1147 nodes · 2543 edges · 99 communities (69 shown, 30 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 293 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- MQTT Client (vendor)
- Profile Setup
- MQTT Client (vendor)
- Test Harness
- MQTT Client (vendor)
- Renderer UI
- MQTT Client (vendor)
- UNO Game
- Renderer UI
- MQTT Client (vendor)
- MQTT Client (vendor)
- Landing/App Page
- Electron Main
- Renderer UI
- MQTT Client (vendor)
- CryptoJS (vendor)
- Sidebar UI
- Renderer UI
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- Package
- Shared-Browser
- Renderer UI
- MQTT Client (vendor)
- MQTT Client (vendor)
- Package
- MQTT Client (vendor)
- Diagnostics
- Yapaydenetleyici
- MQTT Client (vendor)
- MQTT Client (vendor)
- Renderer UI
- MQTT Client (vendor)
- MQTT Client (vendor)
- Package
- Package
- Package
- Generate Smeargle Variants
- MQTT Client (vendor)
- Package
- Renderer UI
- MQTT Client (vendor)
- Inject Megas
- Smeargle-Red
- Watch-Together
- Fetch Pokemon
- Fix-Html
- Fix-Html-2
- Replace-Emojis-Css
- MQTT Client (vendor)
- Smeargle-Blue
- Whiteboard
- Run-All
- Add-Death-Anim
- Add-Guide
- Add-Poke-Vol
- Enhance-Css
- Fix-Emojis
- Improve-Css
- Improve-Emojis
- MQTT Client (vendor)
- Add-Audio
- Add-Modal
- Fix-Poke
- Fix-Typechart
- Inject-Types-Css
- Inject-Types-Html
- Inject-Types-Js
- Restore-Poke-B64
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- Icon
- Preload-Notification
- Preload-Tray
- Tray-Menu
- Preload
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- MQTT Client (vendor)
- Fez
- Landing/App Page

## God Nodes (most connected - your core abstractions)
1. `i()` - 53 edges
2. `e()` - 51 edges
3. `c()` - 40 edges
4. `a()` - 36 edges
5. `s()` - 33 edges
6. `write()` - 30 edges
7. `o()` - 29 edges
8. `handleDataMessage()` - 28 edges
9. `bindUI()` - 28 edges
10. `Wr()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `_diagRendererProbe()` --indirect_call--> `e()`  [INFERRED]
  main.js → vendor/crypto-js.min.js
- `createWindow()` --indirect_call--> `e()`  [INFERRED]
  main.js → vendor/crypto-js.min.js
- `initPoke()` --indirect_call--> `e()`  [INFERRED]
  js/poke.js → vendor/crypto-js.min.js
- `initPoke()` --indirect_call--> `i()`  [INFERRED]
  js/poke.js → vendor/mqtt.min.js
- `initSharedBrowser()` --indirect_call--> `e()`  [INFERRED]
  js/shared-browser.js → vendor/crypto-js.min.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy Vanilla vs React App Entry Points** — src_index_entry [INFERRED 0.80]
- **P2P serverless voice stack** — readme_p2p_serverless, index_emqx_broker, index_metered_turn, index_supabase [INFERRED 0.75]
- **TeamSync feature set** — docs_index_device_id_login, docs_index_screen_share_remote, docs_index_family_friendly_mode, docs_index_activities, docs_index_noise_suppressor [EXTRACTED 1.00]

## Communities (99 total, 30 thin omitted)

### Community 0 - "MQTT Client (vendor)"
Cohesion: 0.01
Nodes (12): Am(), bl(), _flushStoreProcessingQueue(), Mu(), Oi(), om(), Ph(), _setupKeepaliveManager() (+4 more)

### Community 1 - "Profile Setup"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 2 - "MQTT Client (vendor)"
Cohesion: 0.10
Nodes (42): ArrayPrototypePush(), cd(), createStream(), Cv(), dd(), dump(), dw(), _emitError() (+34 more)

### Community 3 - "Test Harness"
Cohesion: 0.10
Nodes (35): fs, { launch, getPageTarget, cdp, evalJS, waitFor }, os, path, { spawnPeer, cleanupPeer, waitFor }, APP_DIR, cdp(), cleanupPeer() (+27 more)

### Community 4 - "MQTT Client (vendor)"
Cohesion: 0.09
Nodes (34): aE(), ar(), bE(), Br(), Ce(), dE(), ey(), Fe() (+26 more)

### Community 5 - "Renderer UI"
Cohesion: 0.08
Nodes (19): appendChat(), badWordsList, badWordsRegex, broadcastTo(), chatBlobUrls, cleanText(), fileBuffer, getActiveActivity() (+11 more)

### Community 6 - "MQTT Client (vendor)"
Cohesion: 0.09
Nodes (12): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), consume(), fy(), _getBuffer(), _getString(), kf(), lA() (+4 more)

### Community 7 - "UNO Game"
Cohesion: 0.23
Nodes (30): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+22 more)

### Community 8 - "Renderer UI"
Cohesion: 0.13
Nodes (28): addUser(), applyAudioBitrateToPeers(), applyMicState(), applyPttMode(), bindUI(), canManageRoom(), canModerateTarget(), checkAvatar() (+20 more)

### Community 9 - "MQTT Client (vendor)"
Cohesion: 0.16
Nodes (23): o(), s(), a(), ah(), aS(), EE(), endAsync(), fail() (+15 more)

### Community 10 - "MQTT Client (vendor)"
Cohesion: 0.09
Nodes (16): initPoke(), p(), Bv(), destroy(), dS(), first(), Iv(), load() (+8 more)

### Community 11 - "Landing/App Page"
Cohesion: 0.09
Nodes (25): In-Room Activities, Device Identity Login, Family Friendly Mode, TeamSync Landing Page, Advanced Noise Suppressor, Screen Sharing and Remote Control, Notification Window, notifyAPI Bridge (+17 more)

### Community 12 - "Electron Main"
Cohesion: 0.09
Nodes (17): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, createWindow(), deviceIdentityFile, dgram, _diagRendererProbe(), _diagSettingsPath, envPath (+9 more)

### Community 13 - "Renderer UI"
Cohesion: 0.12
Nodes (25): checkSession(), checkTextWithAI(), deviceLogin(), getActiveSlot(), getDeviceAccounts(), limitVideoBitrate(), loadSupabaseProfile(), loginWithProfileData() (+17 more)

### Community 14 - "MQTT Client (vendor)"
Cohesion: 0.13
Nodes (12): aA(), addEventListener(), Eh(), hd(), hS(), Le(), once(), Qm() (+4 more)

### Community 15 - "CryptoJS (vendor)"
Cohesion: 0.13
Nodes (16): C(), H(), T(), X(), z(), ArrayPrototypeJoin(), Bx(), Cx() (+8 more)

### Community 16 - "Sidebar UI"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 17 - "Renderer UI"
Cohesion: 0.17
Nodes (20): applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), applySpeakerToAll(), attemptIceRestart(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure() (+12 more)

### Community 18 - "MQTT Client (vendor)"
Cohesion: 0.22
Nodes (18): f(), an(), c(), end(), fg(), h(), h0(), km() (+10 more)

### Community 19 - "MQTT Client (vendor)"
Cohesion: 0.20
Nodes (18): ab(), aI(), cI(), dl(), eI(), fI(), iI(), lI() (+10 more)

### Community 20 - "MQTT Client (vendor)"
Cohesion: 0.16
Nodes (18): ch(), Di(), Em(), fh(), ih(), im(), ji(), lh() (+10 more)

### Community 21 - "Package"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 22 - "Shared-Browser"
Cohesion: 0.32
Nodes (15): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+7 more)

### Community 23 - "Renderer UI"
Cohesion: 0.21
Nodes (17): addVideoCard(), closeAllCards(), decryptMsg(), disconnectApp(), handleDataMessage(), makeCardFocusable(), releaseChatBlobUrls(), removeInactiveOverlay() (+9 more)

### Community 24 - "MQTT Client (vendor)"
Cohesion: 0.12
Nodes (16): abort(), B_(), co(), D_(), defaultId(), delete(), ep(), format() (+8 more)

### Community 25 - "MQTT Client (vendor)"
Cohesion: 0.14
Nodes (17): cb(), _cleanUp(), _clearReconnect(), connect(), _destroyKeepaliveManager(), DT(), _flush(), _flushVolatile() (+9 more)

### Community 26 - "Package"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 27 - "MQTT Client (vendor)"
Cohesion: 0.27
Nodes (13): constructor(), #F(), forEach(), G(), getElementByPos(), insert(), merge(), pushBack() (+5 more)

### Community 28 - "Diagnostics"
Cohesion: 0.35
Nodes (11): _analyzeCssText(), _append(), appendCapture(), appendRenderer(), crypto, _extractRule(), fs, init() (+3 more)

### Community 29 - "Yapaydenetleyici"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 30 - "MQTT Client (vendor)"
Cohesion: 0.23
Nodes (12): _applyTopicAlias(), _checkDisconnecting(), _nextId(), publish(), _removeTopicAliasAndRecoverTopicName(), _resubscribe(), _sendPacket(), sendPing() (+4 more)

### Community 31 - "MQTT Client (vendor)"
Cohesion: 0.24
Nodes (7): initLuckyWheel(), q(), concat(), copy(), rw(), Tf(), tw()

### Community 32 - "Renderer UI"
Cohesion: 0.24
Nodes (10): appendFileMsg(), attachVideo(), broadcast(), getVideoConstraints(), getVideoSender(), initFileTransfer(), isImageFile(), sendFile() (+2 more)

### Community 33 - "MQTT Client (vendor)"
Cohesion: 0.22
Nodes (10): cut(), eraseElementByIterator(), eraseElementByPos(), eraseElementByValue(), oe(), popBack(), popFront(), reverse() (+2 more)

### Community 34 - "MQTT Client (vendor)"
Cohesion: 0.22
Nodes (8): bp(), eo(), gs(), Jv(), md(), Un(), Vp(), Ys()

### Community 35 - "Package"
Cohesion: 0.25
Nodes (8): build, appId, directories, productName, win, output, icon, target

### Community 36 - "Package"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !tools/dev/yapaydenetleyici.js, !yapaydenetliyici.md

### Community 37 - "Package"
Cohesion: 0.25
Nodes (8): scripts, build, build-full, build:react, dev:react, diag, start, test:e2e

### Community 38 - "Generate Smeargle Variants"
Cohesion: 0.29
Nodes (7): assertSourceGif(), fs, generate(), outputDir, path, sourcePath, variants

### Community 39 - "MQTT Client (vendor)"
Cohesion: 0.25
Nodes (7): ac(), bm(), ew(), fb(), gm(), Qf(), sc()

### Community 40 - "Package"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 41 - "Renderer UI"
Cohesion: 0.43
Nodes (7): dohResolve(), expandTurnFamily(), expandTurnWithIpVariants(), getTurnIpCache(), isIpLiteral(), parseTurnHost(), resolveTurnHostsViaDoH()

### Community 42 - "MQTT Client (vendor)"
Cohesion: 0.29
Nodes (7): #E(), j_(), purgeStale(), rentries(), rforEach(), rkeys(), rvalues()

### Community 43 - "Inject Megas"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 44 - "Smeargle-Red"
Cohesion: 0.50
Nodes (5): Smeargle Red Variant (animated sprite), Smeargle Teal Variant (animated sprite), Smeargle Yellow Variant (animated sprite), TeamSync App Icon (hexagon with group of people), TeamSync Main Screen Screenshot (P2P server/friends UI)

### Community 45 - "Watch-Together"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 46 - "Fetch Pokemon"
Cohesion: 0.50
Nodes (4): fetchJson(), fs, https, run()

### Community 47 - "Fix-Html"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 48 - "Fix-Html-2"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 49 - "Replace-Emojis-Css"
Cohesion: 0.40
Nodes (4): css, endIndex, fs, startIndex

### Community 50 - "MQTT Client (vendor)"
Cohesion: 0.40
Nodes (5): ArrayPrototypePop(), L0(), N0(), pop(), remove()

### Community 51 - "Smeargle-Blue"
Cohesion: 0.50
Nodes (4): Smeargle Blue Sprite, Smeargle Green Sprite, Smeargle Indigo Sprite, Smeargle Orange Sprite

### Community 52 - "Whiteboard"
Cohesion: 0.67
Nodes (3): drawWb(), initWhiteboard(), size()

### Community 54 - "Add-Death-Anim"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 55 - "Add-Guide"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 56 - "Add-Poke-Vol"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 57 - "Enhance-Css"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 58 - "Fix-Emojis"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 59 - "Improve-Css"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 60 - "Improve-Emojis"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

### Community 61 - "MQTT Client (vendor)"
Cohesion: 0.50
Nodes (4): _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), _removeOutgoingAndStoreMessage(), removeOutgoingMessage()

### Community 71 - "MQTT Client (vendor)"
Cohesion: 0.67
Nodes (3): cs(), Rc(), xc()

### Community 72 - "MQTT Client (vendor)"
Cohesion: 0.67
Nodes (3): hw(), qs(), _r()

### Community 73 - "MQTT Client (vendor)"
Cohesion: 0.67
Nodes (3): MI(), rI(), wl()

### Community 74 - "MQTT Client (vendor)"
Cohesion: 0.67
Nodes (3): ms(), nm(), sm()

### Community 75 - "MQTT Client (vendor)"
Cohesion: 0.67
Nodes (3): processWriteQueue(), socketReady(), writeToProxy()

## Knowledge Gaps
- **203 isolated node(s):** `fs`, `path`, `crypto`, `{ contextBridge, ipcRenderer }`, `{ contextBridge, ipcRenderer }` (+198 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `e()` connect `Renderer UI` to `Profile Setup`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `Renderer UI`, `MQTT Client (vendor)`, `Renderer UI`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `Electron Main`, `MQTT Client (vendor)`, `CryptoJS (vendor)`, `MQTT Client (vendor)`, `Shared-Browser`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `Renderer UI`, `MQTT Client (vendor)`, `Fetch Pokemon`, `Whiteboard`, `MQTT Client (vendor)`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Why does `c()` connect `MQTT Client (vendor)` to `MQTT Client (vendor)`, `Profile Setup`, `MQTT Client (vendor)`, `UNO Game`, `MQTT Client (vendor)`, `Renderer UI`, `MQTT Client (vendor)`, `Renderer UI`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `MQTT Client (vendor)`, `MQTT Client (vendor)`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `doRenderUnoGame()` connect `UNO Game` to `MQTT Client (vendor)`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `i()` (e.g. with `initPoke()` and `o()`) actually correct?**
  _`i()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 50 inferred relationships involving `e()` (e.g. with `initPoke()` and `initSharedBrowser()`) actually correct?**
  _`e()` has 50 INFERRED edges - model-reasoned connections that need verification._
- **Are the 27 inferred relationships involving `c()` (e.g. with `doRenderUnoGame()` and `getUnoDeck()`) actually correct?**
  _`c()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `a()` (e.g. with `createPeerConnection()` and `mqtt.min.js`) actually correct?**
  _`a()` has 24 INFERRED edges - model-reasoned connections that need verification._