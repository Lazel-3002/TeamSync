# Graph Report - kanka-voice  (2026-07-17)

## Corpus Check
- 67 files · ~177,050 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1836 nodes · 5410 edges · 129 communities (89 shown, 40 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 864 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6289874f`
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
- _r
- shared-browser.js
- Bn
- cs
- _r
- rI
- ms
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
- Bn
- jf
- pa
- reverseUpperBound
- T_
- uc
- Yf
- preload.js
- preload-flag.js
- reverseUpperBound
- preload-tray.js
- README.md
- T_
- Bb
- bp
- _removeOutgoingAndStoreMessage
- teardown
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
- initPoke

## God Nodes (most connected - your core abstractions)
1. `n()` - 125 edges
2. `t()` - 121 edges
3. `r()` - 116 edges
4. `i()` - 106 edges
5. `j()` - 76 edges
6. `e()` - 72 edges
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

## Communities (129 total, 40 thin omitted)

### Community 0 - "mqtt.min.js"
Cohesion: 0.01
Nodes (9): EE(), fail(), h0(), km(), lg(), Mu(), promisify(), success() (+1 more)

### Community 1 - "j"
Cohesion: 0.11
Nodes (60): _acquireLock(), _approveAuthorization(), ar(), _authenticate(), _callRefreshToken(), _challenge(), _challengeAndVerify(), createNewAbortSignal() (+52 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.02
Nodes (67): ew(), add(), _createCustomProvider(), createNamespace(), createNamespaceIfNotExists(), _createOAuthClient(), createTable(), createTableIfNotExists() (+59 more)

### Community 3 - "renderer.js"
Cohesion: 0.06
Nodes (67): build(), _cancelPendingDisconnect(), canPush(), clearHeartbeats(), connect(), connectionState(), connectWithFallback(), disconnect() (+59 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 5 - "App.jsx"
Cohesion: 0.11
Nodes (21): ci(), cloneRequestState(), containedBy(), explain(), ilikeAllOf(), ilikeAnyOf(), insert(), Ir() (+13 more)

### Community 6 - "t"
Cohesion: 0.09
Nodes (54): ac(), af(), bc(), be(), Bi(), ca(), cf(), co() (+46 more)

### Community 7 - "n"
Cohesion: 0.15
Nodes (37): al(), b(), bo(), c(), catch(), ce(), d(), Ee() (+29 more)

### Community 8 - "i"
Cohesion: 0.13
Nodes (11): e0(), fy(), Ie(), Rb(), sE(), wd(), xd(), Xs() (+3 more)

### Community 9 - "mc"
Cohesion: 0.11
Nodes (20): fetchJson(), fs, https, run(), e(), drawWb(), initWhiteboard(), Ca() (+12 more)

### Community 10 - "log"
Cohesion: 0.06
Nodes (38): an(), cd(), cs(), Cv(), dd(), dump(), Eh(), end() (+30 more)

### Community 11 - "push"
Cohesion: 0.08
Nodes (16): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), consume(), Eb(), fetch(), find(), forceFetch(), _getBuffer() (+8 more)

### Community 12 - ".push"
Cohesion: 0.67
Nodes (3): processWriteQueue(), socketReady(), writeToProxy()

### Community 13 - "uno.js"
Cohesion: 0.17
Nodes (19): ab(), aI(), Am(), cI(), dl(), eI(), fI(), iI() (+11 more)

### Community 14 - "we"
Cohesion: 0.07
Nodes (35): X(), ac(), bm(), Bx(), cb(), _cleanUp(), _clearReconnect(), connect() (+27 more)

### Community 15 - "gu"
Cohesion: 0.08
Nodes (29): ai(), as(), bs(), cs(), dd(), ft(), Fu(), generateLink() (+21 more)

### Community 16 - "Wr"
Cohesion: 0.12
Nodes (21): channel(), clone(), constructor(), getChannel(), getChannels(), getSocket(), ha(), _handleTokenChanged() (+13 more)

### Community 17 - "Ie"
Cohesion: 0.23
Nodes (30): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+22 more)

### Community 18 - "z"
Cohesion: 0.18
Nodes (25): aE(), ar(), bE(), Br(), Ce(), dE(), ey(), Fe() (+17 more)

### Community 19 - "constructor"
Cohesion: 0.18
Nodes (17): applyTransformOptsToQuery(), createSignedUploadUrl(), createSignedUrl(), createSignedUrls(), deleteBucket(), download(), exists(), _getFinalPath() (+9 more)

### Community 20 - "No"
Cohesion: 0.09
Nodes (17): appendChat(), applySpeakerTo(), applySpeakerToAll(), badWordsList, badWordsRegex, cleanText(), fileBuffer, getActiveActivity() (+9 more)

### Community 21 - "constructor"
Cohesion: 0.18
Nodes (21): _autoRefreshTokenTick(), _debug(), dispose(), _emitInitialSession(), _getSessionFromURL(), _getUrlForProvider(), _handleProviderSignIn(), _handleVisibilityChange() (+13 more)

### Community 22 - "write"
Cohesion: 0.14
Nodes (22): copy(), createBucket(), createIndex(), deleteIndex(), deleteVectors(), emptyBucket(), getBucket(), getIndex() (+14 more)

### Community 23 - "_emitError"
Cohesion: 0.20
Nodes (27): ArrayPrototypePush(), createStream(), dw(), _emitError(), _parse4ByteNum(), _parseAuth(), _parseBuffer(), _parseByte() (+19 more)

### Community 24 - "a"
Cohesion: 0.42
Nodes (12): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+4 more)

### Community 25 - "Sidebar.jsx"
Cohesion: 0.13
Nodes (31): no(), a(), Aa(), ao(), ba(), cc(), Da(), ds() (+23 more)

### Community 26 - "join"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 27 - "send"
Cohesion: 0.08
Nodes (42): _fetchWithTimeout(), hasReceived(), httpSend(), parseJSON(), receive(), request(), send(), track() (+34 more)

### Community 28 - "teardown"
Cohesion: 0.12
Nodes (13): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage }, baseUserData, createWindow(), dgram, envPath, fs, getBroadcastAddresses(), getLocalIPs() (+5 more)

### Community 29 - "wd"
Cohesion: 0.14
Nodes (19): ah(), ch(), Di(), Em(), fh(), ih(), im(), ji() (+11 more)

### Community 30 - "main.js"
Cohesion: 0.23
Nodes (15): applyIceEscalationPolicy(), attemptIceRestart(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure(), getIceServers(), isJunkIceCandidate(), logVoicePathReport() (+7 more)

### Community 31 - "dependencies"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 32 - "devDependencies"
Cohesion: 0.05
Nodes (67): gp(), ad(), ap(), at(), Au(), bl(), bu(), Cl() (+59 more)

### Community 33 - "crypto-js.min.js"
Cohesion: 0.14
Nodes (19): _applyTopicAlias(), _checkDisconnecting(), defaultId(), l_(), _nextId(), publish(), publishAsync(), _removeTopicAliasAndRecoverTopicName() (+11 more)

### Community 34 - "_onConnect"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 35 - "la"
Cohesion: 0.22
Nodes (11): _adminDeletePasskey(), _adminListPasskeys(), createUser(), _deleteFactor(), deleteUser(), getUserById(), inviteUserByEmail(), Kr() (+3 more)

### Community 36 - ".read"
Cohesion: 0.15
Nodes (3): C(), q(), initLuckyWheel()

### Community 37 - "connectWithFallback"
Cohesion: 0.11
Nodes (23): Bt(), df(), fd(), gf(), If(), jf(), jt(), kf() (+15 more)

### Community 38 - "decode"
Cohesion: 0.23
Nodes (16): index(), addVideoCard(), closeAllCards(), decryptMsg(), disconnectApp(), handleDataMessage(), makeCardFocusable(), removeInactiveOverlay() (+8 more)

### Community 39 - "Vt"
Cohesion: 0.18
Nodes (16): _binaryDecode(), binaryEncode(), _binaryEncodeUserBroadcastPush(), decode(), decodeBroadcast(), decodePush(), decodeReply(), _decodeUserBroadcast() (+8 more)

### Community 40 - "YapayDenetleyici"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 41 - "wt"
Cohesion: 0.18
Nodes (11): Empty App Config File (config.yml), TeamSync Main Window (index.html), Empty Names List File (names.txt), TeamSync Project Overview, playDeaf - Deafen/Undeafen Sound, playOp1 - Discord-Style Toggle Sound, playOp2 - Soft/Deep Toggle Sound, playOp3 - Digital UI Toggle Sound (+3 more)

### Community 43 - "uS"
Cohesion: 0.10
Nodes (22): ArrayPrototypeJoin(), bl(), Bv(), destroy(), first(), ho(), i(), Iv() (+14 more)

### Community 44 - "Da"
Cohesion: 0.21
Nodes (13): ajax(), appendParams(), batchSend(), close(), closeAndRetry(), endpointURL(), isActive(), match() (+5 more)

### Community 45 - "_sendPacket"
Cohesion: 0.16
Nodes (31): f(), T(), a(), abort(), addEventListener(), B_(), c(), concat() (+23 more)

### Community 47 - "connect"
Cohesion: 0.22
Nodes (5): DT(), jt(), ln(), w0(), Wb()

### Community 48 - "log"
Cohesion: 0.12
Nodes (18): Br(), cancelRefEvent(), cancelTimeout(), contains(), destroy(), matchReceive(), Mr(), Pr() (+10 more)

### Community 49 - "teardown"
Cohesion: 0.38
Nodes (7): Px(), Fo(), is(), ns(), rs(), ts(), Ye()

### Community 50 - "If"
Cohesion: 0.29
Nodes (7): #E(), j_(), purgeStale(), rentries(), rforEach(), rkeys(), rvalues()

### Community 51 - "inject_megas.js"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !yapaydenetleyici.js, !yapaydenetliyici.md

### Community 52 - "pop"
Cohesion: 0.32
Nodes (8): setupVUMeter(), encodeMetadata(), _removeEmptyFolders(), toBase64(), update(), upload(), uploadOrUpdate(), uploadToSignedUrl()

### Community 53 - "scripts"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 54 - "fetch_pokemon.js"
Cohesion: 0.29
Nodes (7): build, appId, directories, productName, win, output, target

### Community 55 - "decode"
Cohesion: 0.17
Nodes (17): appendFileMsg(), attachVideo(), bindUI(), broadcast(), escapeHtml(), getVideoConstraints(), getVideoSender(), initActivitiesUI() (+9 more)

### Community 56 - "fix-html.js"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 57 - "fix-html-2.js"
Cohesion: 0.29
Nodes (7): scripts, build, build-full, build:react, dev:react, start, test:e2e

### Community 58 - "bindUI"
Cohesion: 0.38
Nodes (7): Ht(), onJoinPayload(), onLeavePayload(), st(), state(), transformState(), ut()

### Community 59 - "Zd"
Cohesion: 0.14
Nodes (14): aA(), ArrayPrototypePop(), AT(), close(), ep(), L0(), N0(), pa() (+6 more)

### Community 60 - "resolveTurnHostsViaDoH"
Cohesion: 0.36
Nodes (8): applySharedTurn(), dohResolve(), expandTurnFamily(), expandTurnWithIpVariants(), getTurnIpCache(), isIpLiteral(), parseTurnHost(), resolveTurnHostsViaDoH()

### Community 61 - "tp"
Cohesion: 0.09
Nodes (48): s(), aS(), co(), k_(), Oi(), _s(), unsafeExposeInternals(), bd() (+40 more)

### Community 62 - "enhance-css.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 63 - "renderFriends"
Cohesion: 0.50
Nodes (5): playNote(), playSound(), renderFriends(), saveProfile(), setupGlobalMQTT()

### Community 64 - "improve-css.js"
Cohesion: 0.40
Nodes (5): notifyAPI.onShowNotification Preload Bridge Call, Notification Popup Window (notification.html), window.trayAPI.quitApp Preload Bridge Call, window.trayAPI.showApp Preload Bridge Call, Tray Menu Window (tray-menu.html)

### Community 65 - "_r"
Cohesion: 0.67
Nodes (3): hw(), qs(), _r()

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

### Community 70 - "rI"
Cohesion: 0.67
Nodes (3): MI(), rI(), wl()

### Community 71 - "ms"
Cohesion: 0.67
Nodes (3): ms(), nm(), sm()

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
Cohesion: 0.11
Nodes (26): Bb(), cut(), dS(), entries(), eraseElementByIterator(), eraseElementByPos(), eraseElementByValue(), forEach() (+18 more)

### Community 81 - "addUser"
Cohesion: 0.40
Nodes (6): checkAvatar(), getShareableTurn(), handlePeerDiscovered(), handleSignal(), loadAIFilter(), setupInternetSignaling()

### Community 96 - "Bb"
Cohesion: 0.33
Nodes (6): cn(), jl(), Lu(), ot(), qf(), _u()

### Community 97 - "bp"
Cohesion: 0.29
Nodes (6): bp(), eo(), gs(), Un(), Vp(), Ys()

### Community 98 - "_removeOutgoingAndStoreMessage"
Cohesion: 0.50
Nodes (4): _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), _removeOutgoingAndStoreMessage(), removeOutgoingMessage()

### Community 99 - "teardown"
Cohesion: 0.40
Nodes (6): removeAllChannels(), removeChannel(), teardown(), unsubscribe(), waitForBufferDone(), waitForSocketClosed()

### Community 128 - "initPoke"
Cohesion: 0.50
Nodes (3): p(), initPoke(), move()

## Ambiguous Edges - Review These
- `Empty App Config File (config.yml)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  config.yml · relation: conceptually_related_to
- `Empty Names List File (names.txt)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  names.txt · relation: conceptually_related_to
- `TeamSync Main Window (index.html)` → `Sound Effect Test Tool (sound_tester.html)`  [AMBIGUOUS]
  sound_tester.html · relation: conceptually_related_to

## Knowledge Gaps
- **200 isolated node(s):** `fs`, `https`, `fs`, `data`, `jsonStr` (+195 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty App Config File (config.yml)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Empty Names List File (names.txt)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `TeamSync Main Window (index.html)` and `Sound Effect Test Tool (sound_tester.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `e()` connect `mc` to `initPoke`, `j`, `renderer.js`, `e`, `t`, `n`, `i`, `log`, `push`, `we`, `Wr`, `No`, `constructor`, `a`, `Sidebar.jsx`, `teardown`, `devDependencies`, `.read`, `connectWithFallback`, `Vt`, `uS`, `_sendPacket`, `log`, `decode`, `Zd`, `tp`, `renderFriends`, `Bb`, `bp`, `teardown`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `r()` connect `tp` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `App.jsx`, `t`, `n`, `i`, `mc`, `log`, `push`, `we`, `gu`, `Wr`, `z`, `write`, `Sidebar.jsx`, `send`, `devDependencies`, `.read`, `connectWithFallback`, `Vt`, `uS`, `Da`, `_sendPacket`, `connect`, `teardown`, `If`, `pop`, `decode`, `bindUI`, `Bb`, `Bb`, `teardown`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `t()` connect `write` to `initPoke`, `j`, `index-DCnN8y-E.js`, `renderer.js`, `t`, `n`, `i`, `mc`, `log`, `push`, `we`, `gu`, `Wr`, `z`, `constructor`, `No`, `constructor`, `Sidebar.jsx`, `send`, `devDependencies`, `crypto-js.min.js`, `connectWithFallback`, `Vt`, `uS`, `_sendPacket`, `Ot`, `log`, `teardown`, `If`, `decode`, `bindUI`, `tp`, `Bb`, `teardown`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Are the 94 inferred relationships involving `n()` (e.g. with `a()` and `aA()`) actually correct?**
  _`n()` has 94 INFERRED edges - model-reasoned connections that need verification._