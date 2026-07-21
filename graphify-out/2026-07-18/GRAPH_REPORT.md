# Graph Report - kanka-voice  (2026-07-18)

## Corpus Check
- 67 files · ~179,953 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1852 nodes · 5455 edges · 120 communities (82 shown, 38 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 868 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b118fe5b`
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
- If
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
- shared-browser.js
- Bn
- cs
- _r
- processWriteQueue
- add-audio.js
- add-modal.js
- fix-poke.js
- fix-typechart.js
- inject-types-css.js
- inject-types-html.js
- inject-types-js.js
- Bb
- addUser
- jf
- pa
- reverseUpperBound
- T_
- uc
- Yf
- preload.js
- preload-flag.js
- preload-tray.js
- README.md
- initPoke
- pop
- connect
- escapeHtml
- Lu
- ajax
- subscribe
- match
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
- _removeOutgoingAndStoreMessage

## God Nodes (most connected - your core abstractions)
1. `n()` - 125 edges
2. `t()` - 121 edges
3. `r()` - 116 edges
4. `i()` - 106 edges
5. `e()` - 76 edges
6. `j()` - 76 edges
7. `a()` - 53 edges
8. `push()` - 53 edges
9. `i()` - 52 edges
10. `s()` - 50 edges

## Surprising Connections (you probably didn't know these)
- `createWindow()` --indirect_call--> `e()`  [INFERRED]
  main.js → js/crypto-js.min.js
- `fail()` --indirect_call--> `s()`  [INFERRED]
  mqtt.min.js → js/crypto-js.min.js
- `success()` --indirect_call--> `s()`  [INFERRED]
  mqtt.min.js → js/crypto-js.min.js
- `Tf()` --indirect_call--> `C()`  [INFERRED]
  mqtt.min.js → js/crypto-js.min.js
- `h0()` --indirect_call--> `f()`  [INFERRED]
  mqtt.min.js → js/crypto-js.min.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Electron contextBridge Preload API Usage Across Secondary Windows** — notification_notifyapi, tray_menu_showapp, tray_menu_quitapp [INFERRED 0.80]
- **In-Room Party/Minigame Activities** — index_unogame, index_pokebattle, index_wheelfeature, index_pollfeature [INFERRED 0.75]
- **Legacy Vanilla vs React App Entry Points** — index_teamsyncapp, src_index_entry, src_dist_react_index_entry [INFERRED 0.80]

## Communities (120 total, 38 thin omitted)

### Community 0 - "mqtt.min.js"
Cohesion: 0.01
Nodes (57): Am(), AT(), Bb(), bl(), #E(), EE(), eI(), fail() (+49 more)

### Community 1 - "j"
Cohesion: 0.12
Nodes (47): _adminDeletePasskey(), _adminListPasskeys(), _approveAuthorization(), _authenticate(), Br(), _challenge(), _challengeAndVerify(), createNewAbortSignal() (+39 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.02
Nodes (53): ew(), add(), _createCustomProvider(), createNamespace(), createNamespaceIfNotExists(), _createOAuthClient(), _deleteCustomProvider(), _deleteOAuthClient() (+45 more)

### Community 3 - "renderer.js"
Cohesion: 0.09
Nodes (40): Nt(), _cancelPendingDisconnect(), clearHeartbeats(), connect(), connectionState(), disconnect(), flushSendBuffer(), _handleNodeJsRaceCondition() (+32 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 5 - "App.jsx"
Cohesion: 0.10
Nodes (21): cloneRequestState(), containedBy(), contains(), dropNamespace(), explain(), ilikeAllOf(), ilikeAnyOf(), insert() (+13 more)

### Community 6 - "t"
Cohesion: 0.07
Nodes (60): q(), initLuckyWheel(), ac(), af(), ba(), cc(), cf(), dc() (+52 more)

### Community 7 - "n"
Cohesion: 0.13
Nodes (10): e0(), Ie(), Rb(), sE(), wd(), xd(), Xs(), Yv() (+2 more)

### Community 9 - "mc"
Cohesion: 0.15
Nodes (20): fetchJson(), fs, https, run(), e(), gA(), MT(), Tt() (+12 more)

### Community 10 - "log"
Cohesion: 0.08
Nodes (28): cd(), cs(), Cv(), dd(), delete(), dump(), Eh(), ep() (+20 more)

### Community 11 - "push"
Cohesion: 0.16
Nodes (4): ArrayPrototypeIndexOf(), fy(), memo(), we()

### Community 12 - ".push"
Cohesion: 0.17
Nodes (28): _acquireLock(), ar(), _autoRefreshTokenTick(), _callRefreshToken(), _debug(), _emitInitialSession(), exchangeCodeForSession(), initialize() (+20 more)

### Community 13 - "uno.js"
Cohesion: 0.13
Nodes (17): abort(), _applyTopicAlias(), B_(), close(), co(), concat(), copy(), format() (+9 more)

### Community 14 - "we"
Cohesion: 0.17
Nodes (19): f(), a(), c(), Fe(), fg(), final(), jt(), l_() (+11 more)

### Community 15 - "gu"
Cohesion: 0.11
Nodes (24): as(), catch(), cn(), ct(), Da(), dd(), finally(), ga() (+16 more)

### Community 16 - "Wr"
Cohesion: 0.10
Nodes (27): channel(), clone(), constructor(), getChannel(), getChannels(), getSocket(), ha(), _handleTokenChanged() (+19 more)

### Community 17 - "Ie"
Cohesion: 0.23
Nodes (30): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+22 more)

### Community 18 - "z"
Cohesion: 0.18
Nodes (24): aE(), ar(), bE(), Br(), Ca(), Ce(), dE(), ey() (+16 more)

### Community 19 - "constructor"
Cohesion: 0.09
Nodes (20): ArrayPrototypeSlice(), Bv(), consume(), destroy(), Eb(), first(), _getBuffer(), _getString() (+12 more)

### Community 20 - "No"
Cohesion: 0.09
Nodes (23): appendChat(), applySpeakerToAll(), badWordsList, badWordsRegex, cleanText(), dohResolve(), expandTurnFamily(), expandTurnWithIpVariants() (+15 more)

### Community 21 - "constructor"
Cohesion: 0.20
Nodes (14): Aa(), _binaryDecode(), decode(), decodeBroadcast(), decodePush(), decodeReply(), _decodeUserBroadcast(), ds() (+6 more)

### Community 22 - "write"
Cohesion: 0.05
Nodes (63): ho(), uS(), setupVUMeter(), applyTransformOptsToQuery(), copy(), createBucket(), createIndex(), createSignedUploadUrl() (+55 more)

### Community 23 - "_emitError"
Cohesion: 0.24
Nodes (24): _emitError(), _parse4ByteNum(), _parseAuth(), _parseBuffer(), _parseByte(), _parseByType(), _parseConfirmation(), _parseConnack() (+16 more)

### Community 24 - "a"
Cohesion: 0.32
Nodes (15): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+7 more)

### Community 25 - "Sidebar.jsx"
Cohesion: 0.07
Nodes (70): dS(), #F(), load(), Oi(), xA(), a(), bd(), bo() (+62 more)

### Community 26 - "join"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 27 - "send"
Cohesion: 0.11
Nodes (31): { spawnPeer, cleanupPeer, waitFor }, APP_DIR, cdp(), cleanupPeer(), clickWhenReady(), createRoom(), ELECTRON_BIN, evalJS() (+23 more)

### Community 28 - "teardown"
Cohesion: 0.10
Nodes (15): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, createWindow(), deviceIdentityFile, dgram, envPath, fs, getBroadcastAddresses() (+7 more)

### Community 29 - "wd"
Cohesion: 0.16
Nodes (18): ch(), Di(), Em(), fh(), ih(), im(), ji(), lh() (+10 more)

### Community 30 - "main.js"
Cohesion: 0.15
Nodes (23): applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), attemptIceRestart(), checkAvatar(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure() (+15 more)

### Community 31 - "dependencies"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 32 - "devDependencies"
Cohesion: 0.05
Nodes (62): gp(), ad(), ai(), ap(), Au(), bs(), bu(), cd() (+54 more)

### Community 33 - "crypto-js.min.js"
Cohesion: 0.08
Nodes (29): drawWb(), initWhiteboard(), cb(), _cleanUp(), _clearReconnect(), connect(), constructor(), defaultId() (+21 more)

### Community 34 - "_onConnect"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 35 - "la"
Cohesion: 0.17
Nodes (22): no(), ao(), bc(), be(), ca(), ce(), co(), ge() (+14 more)

### Community 36 - ".read"
Cohesion: 0.27
Nodes (13): bl(), Cl(), dl(), El(), fl(), Il(), la(), ol() (+5 more)

### Community 37 - "connectWithFallback"
Cohesion: 0.15
Nodes (15): at(), df(), gf(), If(), jf(), jl(), ju(), kf() (+7 more)

### Community 38 - "decode"
Cohesion: 0.23
Nodes (16): index(), addVideoCard(), closeAllCards(), decryptMsg(), disconnectApp(), handleDataMessage(), makeCardFocusable(), removeInactiveOverlay() (+8 more)

### Community 39 - "Vt"
Cohesion: 0.24
Nodes (10): binaryEncode(), _binaryEncodeUserBroadcastPush(), encode(), _encodeBinaryUserBroadcastPush(), _encodeJsonUserBroadcastPush(), _encodeUserBroadcastPush(), _isArrayBuffer(), _pick() (+2 more)

### Community 40 - "YapayDenetleyici"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 41 - "wt"
Cohesion: 0.18
Nodes (11): Empty App Config File (config.yml), TeamSync Main Window (index.html), Empty Names List File (names.txt), TeamSync Project Overview, playDeaf - Deafen/Undeafen Sound, playOp1 - Discord-Style Toggle Sound, playOp2 - Soft/Deep Toggle Sound, playOp3 - Digital UI Toggle Sound (+3 more)

### Community 43 - "uS"
Cohesion: 0.11
Nodes (24): build(), cancelRefEvent(), cancelTimeout(), connectWithFallback(), destroy(), filterBindings(), isMember(), joinRef() (+16 more)

### Community 44 - "Da"
Cohesion: 0.21
Nodes (16): T(), addEventListener(), an(), D_(), end(), h(), hS(), kx() (+8 more)

### Community 45 - "_sendPacket"
Cohesion: 0.14
Nodes (31): X(), ab(), aI(), ArrayPrototypeJoin(), Bx(), cI(), Cx(), dl() (+23 more)

### Community 46 - "Ot"
Cohesion: 0.14
Nodes (4): C(), p(), initPoke(), move()

### Community 47 - "connect"
Cohesion: 0.19
Nodes (14): appendFileMsg(), escapeHtml(), getActiveSlot(), getDeviceAccounts(), initFileTransfer(), loginWithProfileData(), renderDeviceAccounts(), renderFriends() (+6 more)

### Community 48 - "log"
Cohesion: 0.16
Nodes (17): canPush(), fetchRequest(), _fetchWithTimeout(), hasReceived(), httpSend(), isJoined(), isJoining(), leave() (+9 more)

### Community 50 - "If"
Cohesion: 0.18
Nodes (21): s(), ah(), aS(), _checkDisconnecting(), endAsync(), find(), forEach(), i() (+13 more)

### Community 51 - "inject_megas.js"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !yapaydenetleyici.js, !yapaydenetliyici.md

### Community 52 - "pop"
Cohesion: 0.29
Nodes (6): ac(), bm(), fb(), gm(), Qf(), sc()

### Community 53 - "scripts"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 54 - "fetch_pokemon.js"
Cohesion: 0.29
Nodes (7): build, appId, directories, productName, win, output, target

### Community 55 - "decode"
Cohesion: 0.20
Nodes (14): attachVideo(), bindUI(), broadcast(), getVideoConstraints(), getVideoSender(), initActivitiesUI(), playNote(), playSound() (+6 more)

### Community 56 - "fix-html.js"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 57 - "fix-html-2.js"
Cohesion: 0.29
Nodes (7): scripts, build, build-full, build:react, dev:react, start, test:e2e

### Community 58 - "bindUI"
Cohesion: 0.29
Nodes (6): bp(), eo(), gs(), Un(), Vp(), Ys()

### Community 59 - "Zd"
Cohesion: 0.13
Nodes (19): Bt(), createUser(), _deleteFactor(), deleteUser(), _getAuthenticatorAssuranceLevel(), getClaims(), getSession(), getUser() (+11 more)

### Community 60 - "resolveTurnHostsViaDoH"
Cohesion: 0.29
Nodes (8): createTable(), createTableIfNotExists(), dropTable(), listTables(), loadTable(), tableExists(), updateTable(), Vt()

### Community 61 - "tp"
Cohesion: 0.23
Nodes (12): ajax(), appendParams(), batchSend(), close(), closeAndRetry(), endpointURL(), isActive(), match() (+4 more)

### Community 62 - "enhance-css.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 64 - "improve-css.js"
Cohesion: 0.40
Nodes (5): notifyAPI.onShowNotification Preload Bridge Call, Notification Popup Window (notification.html), window.trayAPI.quitApp Preload Bridge Call, window.trayAPI.showApp Preload Bridge Call, Tray Menu Window (tray-menu.html)

### Community 66 - "shared-browser.js"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 67 - "Bn"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 68 - "cs"
Cohesion: 0.40
Nodes (4): css, endIndex, fs, startIndex

### Community 69 - "_r"
Cohesion: 0.67
Nodes (4): window.handlePokeImgError Sprite Fallback Chain, PokeSavaş Pokemon Battle Minigame, Duplicated handlePokeImgError Fragment (script.html), Duplicated handlePokeImgError Fragment (script.txt)

### Community 72 - "processWriteQueue"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 73 - "add-audio.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 74 - "add-modal.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 75 - "fix-poke.js"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 76 - "fix-typechart.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 77 - "inject-types-css.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 78 - "inject-types-html.js"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

### Community 80 - "Bb"
Cohesion: 0.13
Nodes (21): ArrayPrototypePush(), createStream(), cut(), dw(), entries(), eraseElementByIterator(), eraseElementByPos(), eraseElementByValue() (+13 more)

### Community 81 - "addUser"
Cohesion: 0.50
Nodes (5): addUser(), broadcastTo(), requestControl(), sendCtrlEvent(), showUserContextMenu()

### Community 97 - "initPoke"
Cohesion: 0.19
Nodes (29): al(), b(), c(), d(), Ee(), ep(), fd(), H() (+21 more)

### Community 98 - "pop"
Cohesion: 0.33
Nodes (6): aA(), ArrayPrototypePop(), L0(), N0(), pop(), remove()

### Community 128 - "_removeOutgoingAndStoreMessage"
Cohesion: 0.50
Nodes (4): _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), _removeOutgoingAndStoreMessage(), removeOutgoingMessage()

## Ambiguous Edges - Review These
- `Empty App Config File (config.yml)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  config.yml · relation: conceptually_related_to
- `Empty Names List File (names.txt)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  names.txt · relation: conceptually_related_to
- `TeamSync Main Window (index.html)` → `Sound Effect Test Tool (sound_tester.html)`  [AMBIGUOUS]
  sound_tester.html · relation: conceptually_related_to

## Knowledge Gaps
- **202 isolated node(s):** `fs`, `https`, `fs`, `data`, `jsonStr` (+197 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty App Config File (config.yml)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Empty Names List File (names.txt)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `TeamSync Main Window (index.html)` and `Sound Effect Test Tool (sound_tester.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `e()` connect `mc` to `j`, `renderer.js`, `e`, `t`, `n`, `log`, `push`, `uno.js`, `we`, `Wr`, `z`, `constructor`, `No`, `constructor`, `write`, `a`, `Sidebar.jsx`, `teardown`, `devDependencies`, `crypto-js.min.js`, `Vt`, `uS`, `Da`, `_sendPacket`, `Ot`, `connect`, `If`, `decode`, `bindUI`, `Zd`, `Bb`, `addUser`, `initPoke`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `r()` connect `Sidebar.jsx` to `mqtt.min.js`, `j`, `index-DCnN8y-E.js`, `renderer.js`, `t`, `n`, `mc`, `log`, `push`, `.push`, `uno.js`, `we`, `gu`, `Wr`, `z`, `constructor`, `constructor`, `write`, `send`, `devDependencies`, `crypto-js.min.js`, `la`, `.read`, `Da`, `_sendPacket`, `connect`, `If`, `tp`, `initPoke`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `t()` connect `write` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `App.jsx`, `t`, `n`, `mc`, `log`, `push`, `.push`, `uno.js`, `we`, `gu`, `Wr`, `z`, `constructor`, `No`, `constructor`, `Sidebar.jsx`, `devDependencies`, `crypto-js.min.js`, `.read`, `Vt`, `uS`, `Da`, `Ot`, `log`, `teardown`, `If`, `decode`, `resolveTurnHostsViaDoH`, `initPoke`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Are the 94 inferred relationships involving `n()` (e.g. with `a()` and `aA()`) actually correct?**
  _`n()` has 94 INFERRED edges - model-reasoned connections that need verification._