# Graph Report - kanka-voice  (2026-07-21)

## Corpus Check
- 68 files · ~193,613 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1153 nodes · 2529 edges · 114 communities (69 shown, 45 thin omitted)
- Extraction: 88% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 288 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `07c8404f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- mqtt.min.js
- j
- index-DCnN8y-E.js
- renderer.js
- e
- App.jsx
- t
- n
- i
- mc
- log
- push
- .push
- uno.js
- we
- gu
- Wr
- Ie
- z
- constructor
- No
- constructor
- write
- _emitError
- a
- Sidebar.jsx
- join
- send
- teardown
- wd
- main.js
- dependencies
- devDependencies
- crypto-js.min.js
- _onConnect
- la
- .read
- connectWithFallback
- decode
- Vt
- YapayDenetleyici
- wt
- jt
- uS
- Da
- _sendPacket
- Ot
- connect
- log
- teardown
- inject_megas.js
- pop
- scripts
- fetch_pokemon.js
- decode
- fix-html.js
- fix-html-2.js
- bindUI
- Zd
- resolveTurnHostsViaDoH
- tp
- enhance-css.js
- renderFriends
- improve-css.js
- fetch
- Bn
- cs
- _r
- jf
- reverseUpperBound
- processWriteQueue
- add-audio.js
- add-modal.js
- fix-poke.js
- inject-types-css.js
- inject-types-js.js
- Bb
- addUser
- cd
- fetch
- jf
- pa
- reverseUpperBound
- T_
- uc
- Yf
- preload.js
- preload-flag.js
- Yf
- preload-tray.js
- README.md
- Bv
- pa
- Lu
- decode
- teardown
- initPoke
- addUser
- zt
- ut
- gr
- Poll / Anket Feature
- Relay/TURN Fallback Option (Sunucu Bilgisayarınız Olsun)
- AI Content Moderation (Aile Dostu)
- Shared Browser Webview (sb-card)
- UNO Card Game Activity
- Local Video Sync Playback (lvs-card)
- YouTube Watch-Together (wt-card)
- Wheel of Fortune (Şans Çarkı)
- Shared Whiteboard (wb-card)
- Pikachu App Icon

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
- `Duplicated handlePokeImgError Fragment (script.html)` --semantically_similar_to--> `window.handlePokeImgError Sprite Fallback Chain`  [INFERRED] [semantically similar]
  script.html → index.html
- `Duplicated handlePokeImgError Fragment (script.txt)` --semantically_similar_to--> `window.handlePokeImgError Sprite Fallback Chain`  [INFERRED] [semantically similar]
  script.txt → index.html
- `notifyAPI.onShowNotification Preload Bridge Call` --semantically_similar_to--> `window.trayAPI.showApp Preload Bridge Call`  [INFERRED] [semantically similar]
  notification.html → tray-menu.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Electron contextBridge Preload API Usage Across Secondary Windows** — notification_notifyapi, tray_menu_showapp, tray_menu_quitapp [INFERRED 0.80]
- **In-Room Party/Minigame Activities** — index_unogame, index_pokebattle, index_wheelfeature, index_pollfeature [INFERRED 0.75]
- **Legacy Vanilla vs React App Entry Points** — index_teamsyncapp, src_index_entry, src_dist_react_index_entry [INFERRED 0.80]

## Communities (114 total, 45 thin omitted)

### Community 0 - "mqtt.min.js"
Cohesion: 0.01
Nodes (18): Am(), AT(), bl(), DT(), _flushStoreProcessingQueue(), h0(), Iv(), km() (+10 more)

### Community 1 - "j"
Cohesion: 0.05
Nodes (26): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), Bn(), concat(), consume(), copy(), e0(), fy() (+18 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.11
Nodes (29): aE(), ar(), bE(), Br(), Ce(), Cv(), dE(), ey() (+21 more)

### Community 3 - "renderer.js"
Cohesion: 0.27
Nodes (9): _applyTopicAlias(), D_(), defaultId(), _removeTopicAliasAndRecoverTopicName(), _sendPacket(), sendPing(), _storeAndSend(), _storePacket() (+1 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 5 - "App.jsx"
Cohesion: 0.18
Nodes (15): s(), T(), ah(), fail(), Fe(), i(), kE(), o_() (+7 more)

### Community 6 - "t"
Cohesion: 0.11
Nodes (40): ArrayPrototypePush(), cd(), createStream(), dd(), dump(), dw(), _emitError(), fd() (+32 more)

### Community 7 - "n"
Cohesion: 0.20
Nodes (9): a(), Eh(), jt(), ln(), _onConnect(), Qm(), return(), throw() (+1 more)

### Community 8 - "i"
Cohesion: 0.23
Nodes (17): f(), addEventListener(), c(), fg(), h(), hS(), kx(), l_() (+9 more)

### Community 9 - "mc"
Cohesion: 0.35
Nodes (11): _analyzeCssText(), _append(), appendCapture(), appendRenderer(), crypto, _extractRule(), fs, init() (+3 more)

### Community 10 - "log"
Cohesion: 0.16
Nodes (18): ch(), Di(), Em(), fh(), ih(), im(), ji(), lh() (+10 more)

### Community 12 - ".push"
Cohesion: 0.29
Nodes (7): assertSourceGif(), fs, generate(), outputDir, path, sourcePath, variants

### Community 13 - "uno.js"
Cohesion: 0.17
Nodes (11): ac(), bm(), cb(), ew(), fb(), _flush(), gm(), hI() (+3 more)

### Community 14 - "we"
Cohesion: 0.40
Nodes (5): closeAllCards(), disconnectApp(), releaseChatBlobUrls(), resetSharedBrowserState(), updateFocusLockBtn()

### Community 15 - "gu"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 16 - "Wr"
Cohesion: 0.13
Nodes (21): an(), _cleanUp(), _clearReconnect(), connect(), _destroyKeepaliveManager(), end(), endAsync(), ep() (+13 more)

### Community 17 - "Ie"
Cohesion: 0.23
Nodes (30): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+22 more)

### Community 18 - "z"
Cohesion: 0.12
Nodes (8): cut(), destroy(), dS(), load(), Ot(), reschedule(), setKeepalive(), Ve()

### Community 19 - "constructor"
Cohesion: 0.17
Nodes (20): applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), applySpeakerToAll(), attemptIceRestart(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure() (+12 more)

### Community 20 - "No"
Cohesion: 0.08
Nodes (21): appendChat(), badWordsList, badWordsRegex, chatBlobUrls, cleanText(), dohResolve(), expandTurnFamily(), expandTurnWithIpVariants() (+13 more)

### Community 21 - "constructor"
Cohesion: 0.18
Nodes (10): bp(), eo(), first(), gs(), Jv(), md(), td(), Un() (+2 more)

### Community 22 - "write"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 23 - "_emitError"
Cohesion: 0.33
Nodes (6): aA(), ArrayPrototypePop(), L0(), N0(), pop(), remove()

### Community 24 - "a"
Cohesion: 0.32
Nodes (15): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+7 more)

### Community 25 - "Sidebar.jsx"
Cohesion: 0.33
Nodes (6): #E(), purgeStale(), rentries(), rforEach(), rkeys(), rvalues()

### Community 26 - "join"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 27 - "send"
Cohesion: 0.10
Nodes (35): fs, { launch, getPageTarget, cdp, evalJS, waitFor }, os, path, { spawnPeer, cleanupPeer, waitFor }, APP_DIR, cdp(), cleanupPeer() (+27 more)

### Community 28 - "teardown"
Cohesion: 0.09
Nodes (17): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, createWindow(), deviceIdentityFile, dgram, _diagRendererProbe(), _diagSettingsPath, envPath (+9 more)

### Community 29 - "wd"
Cohesion: 0.50
Nodes (4): fetchJson(), fs, https, run()

### Community 31 - "dependencies"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 32 - "devDependencies"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 33 - "crypto-js.min.js"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 34 - "_onConnect"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 35 - "la"
Cohesion: 0.40
Nodes (4): css, endIndex, fs, startIndex

### Community 36 - ".read"
Cohesion: 0.20
Nodes (14): o(), aS(), _checkDisconnecting(), EE(), k_(), _nextId(), publish(), publishAsync() (+6 more)

### Community 37 - "connectWithFallback"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 38 - "decode"
Cohesion: 0.16
Nodes (22): addVideoCard(), appendFileMsg(), attachVideo(), broadcast(), decryptMsg(), getVideoConstraints(), getVideoSender(), handleDataMessage() (+14 more)

### Community 39 - "Vt"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 40 - "YapayDenetleyici"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 41 - "wt"
Cohesion: 0.18
Nodes (11): Empty App Config File (config.yml), TeamSync Main Window (index.html), Empty Names List File (names.txt), TeamSync Project Overview, playDeaf - Deafen/Undeafen Sound, playOp1 - Discord-Style Toggle Sound, playOp2 - Soft/Deep Toggle Sound, playOp3 - Digital UI Toggle Sound (+3 more)

### Community 43 - "uS"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 44 - "Da"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 45 - "_sendPacket"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 46 - "Ot"
Cohesion: 0.07
Nodes (34): initLuckyWheel(), initPoke(), C(), H(), p(), q(), X(), z() (+26 more)

### Community 47 - "connect"
Cohesion: 0.11
Nodes (27): checkSession(), checkTextWithAI(), deviceLogin(), escapeHtml(), getActiveSlot(), getDeviceAccounts(), limitVideoBitrate(), loadSupabaseProfile() (+19 more)

### Community 48 - "log"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

### Community 49 - "teardown"
Cohesion: 0.50
Nodes (4): _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), _removeOutgoingAndStoreMessage(), removeOutgoingMessage()

### Community 51 - "inject_megas.js"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !tools/dev/yapaydenetleyici.js, !yapaydenetliyici.md

### Community 53 - "scripts"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 54 - "fetch_pokemon.js"
Cohesion: 0.25
Nodes (8): build, appId, directories, productName, win, output, icon, target

### Community 55 - "decode"
Cohesion: 0.13
Nodes (26): applyAudioBitrateToPeers(), applyMicState(), applyPttMode(), bindUI(), canManageRoom(), canModerateTarget(), checkAvatar(), getAudioBitrate() (+18 more)

### Community 57 - "fix-html-2.js"
Cohesion: 0.25
Nodes (8): scripts, build, build-full, build:react, dev:react, diag, start, test:e2e

### Community 62 - "enhance-css.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 64 - "improve-css.js"
Cohesion: 0.40
Nodes (5): notifyAPI.onShowNotification Preload Bridge Call, Notification Popup Window (notification.html), window.trayAPI.quitApp Preload Bridge Call, window.trayAPI.showApp Preload Bridge Call, Tray Menu Window (tray-menu.html)

### Community 67 - "Bn"
Cohesion: 0.36
Nodes (9): constructor(), #F(), forEach(), insert(), merge(), pushBack(), setElement(), shrinkToFit() (+1 more)

### Community 68 - "cs"
Cohesion: 0.67
Nodes (3): hw(), qs(), _r()

### Community 69 - "_r"
Cohesion: 0.67
Nodes (4): window.handlePokeImgError Sprite Fallback Chain, PokeSavaş Pokemon Battle Minigame, Duplicated handlePokeImgError Fragment (script.html), Duplicated handlePokeImgError Fragment (script.txt)

### Community 70 - "jf"
Cohesion: 0.67
Nodes (3): MI(), rI(), wl()

### Community 71 - "reverseUpperBound"
Cohesion: 0.67
Nodes (3): ms(), nm(), sm()

### Community 72 - "processWriteQueue"
Cohesion: 0.67
Nodes (3): processWriteQueue(), socketReady(), writeToProxy()

### Community 81 - "addUser"
Cohesion: 0.50
Nodes (5): addUser(), broadcastTo(), requestControl(), sendCtrlEvent(), showUserContextMenu()

### Community 82 - "cd"
Cohesion: 0.67
Nodes (3): cs(), Rc(), xc()

### Community 83 - "fetch"
Cohesion: 0.67
Nodes (3): drawWb(), initWhiteboard(), size()

### Community 87 - "T_"
Cohesion: 0.24
Nodes (10): abort(), B_(), close(), co(), format(), j_(), next(), set() (+2 more)

### Community 88 - "uc"
Cohesion: 0.21
Nodes (13): entries(), eraseElementByIterator(), eraseElementByPos(), eraseElementByValue(), getElementByPos(), oe(), popBack(), popFront() (+5 more)

### Community 95 - "Bv"
Cohesion: 0.67
Nodes (3): Bv(), Mv(), Ws()

## Ambiguous Edges - Review These
- `Empty App Config File (config.yml)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  config.yml · relation: conceptually_related_to
- `Empty Names List File (names.txt)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  names.txt · relation: conceptually_related_to
- `TeamSync Main Window (index.html)` → `Sound Effect Test Tool (sound_tester.html)`  [AMBIGUOUS]
  sound_tester.html · relation: conceptually_related_to

## Knowledge Gaps
- **219 isolated node(s):** `fs`, `path`, `crypto`, `{ contextBridge, ipcRenderer }`, `{ contextBridge, ipcRenderer }` (+214 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **45 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty App Config File (config.yml)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Empty Names List File (names.txt)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `TeamSync Main Window (index.html)` and `Sound Effect Test Tool (sound_tester.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `e()` connect `connect` to `j`, `index-DCnN8y-E.js`, `e`, `App.jsx`, `t`, `n`, `i`, `Wr`, `z`, `No`, `constructor`, `a`, `teardown`, `wd`, `.read`, `decode`, `Ot`, `decode`, `addUser`, `fetch`, `T_`, `uc`, `Bv`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `c()` connect `i` to `mqtt.min.js`, `j`, `index-DCnN8y-E.js`, `Bn`, `e`, `.read`, `App.jsx`, `n`, `Ot`, `connect`, `Wr`, `Ie`, `constructor`, `T_`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `doRenderUnoGame()` connect `Ie` to `i`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `i()` (e.g. with `initPoke()` and `o()`) actually correct?**
  _`i()` has 35 INFERRED edges - model-reasoned connections that need verification._