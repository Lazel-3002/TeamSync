# Graph Report - kanka-voice  (2026-07-18)

## Corpus Check
- 67 files · ~266,470 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1853 nodes · 5456 edges · 123 communities (82 shown, 41 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 868 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ae1fe5a8`
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
- fetch
- shared-browser.js
- Bn
- cs
- _r
- jf
- reverseUpperBound
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
- T_
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

## Communities (123 total, 41 thin omitted)

### Community 0 - "mqtt.min.js"
Cohesion: 0.01
Nodes (6): fail(), h0(), lg(), Ph(), promisify(), success()

### Community 1 - "j"
Cohesion: 0.05
Nodes (113): _acquireLock(), _adminDeletePasskey(), _adminListPasskeys(), _approveAuthorization(), ar(), _authenticate(), _autoRefreshTokenTick(), Br() (+105 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.02
Nodes (38): add(), appendParams(), createNamespace(), createNamespaceIfNotExists(), detectEnvironment(), di(), endpointURL(), eq() (+30 more)

### Community 3 - "renderer.js"
Cohesion: 0.08
Nodes (47): _cancelPendingDisconnect(), canPush(), clearHeartbeats(), connect(), connectionState(), disconnect(), filterBindings(), flushSendBuffer() (+39 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 5 - "App.jsx"
Cohesion: 0.09
Nodes (25): setupVUMeter(), cloneRequestState(), containedBy(), contains(), dropNamespace(), explain(), ilikeAllOf(), ilikeAnyOf() (+17 more)

### Community 6 - "t"
Cohesion: 0.09
Nodes (48): ac(), be(), Bi(), cf(), dc(), Do(), ea(), Fa() (+40 more)

### Community 7 - "n"
Cohesion: 0.09
Nodes (18): bp(), e0(), eo(), fy(), gs(), Ie(), Rb(), sE() (+10 more)

### Community 8 - "i"
Cohesion: 0.11
Nodes (23): ai(), as(), cs(), dd(), Fo(), generateLink(), gs(), is() (+15 more)

### Community 9 - "mc"
Cohesion: 0.14
Nodes (18): fetchJson(), fs, https, run(), e(), drawWb(), initWhiteboard(), Ca() (+10 more)

### Community 10 - "log"
Cohesion: 0.08
Nodes (29): cd(), cs(), Cv(), dd(), DT(), dump(), fd(), _flushStoreProcessingQueue() (+21 more)

### Community 11 - "push"
Cohesion: 0.08
Nodes (14): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), Bn(), consume(), copy(), find(), _getBuffer(), _getString() (+6 more)

### Community 12 - ".push"
Cohesion: 0.15
Nodes (22): bo(), ci(), cr(), ds(), Ed(), fr(), fs(), gn() (+14 more)

### Community 13 - "uno.js"
Cohesion: 0.14
Nodes (15): abort(), AT(), B_(), close(), delete(), ep(), j_(), L0() (+7 more)

### Community 14 - "we"
Cohesion: 0.07
Nodes (40): a(), aA(), ab(), ah(), aI(), Am(), c(), cI() (+32 more)

### Community 15 - "gu"
Cohesion: 0.17
Nodes (16): catch(), ce(), Ee(), execute(), finally(), ge(), getPromise(), Hd() (+8 more)

### Community 16 - "Wr"
Cohesion: 0.07
Nodes (36): channel(), clone(), constructor(), ct(), dr(), Er(), ga(), getChannel() (+28 more)

### Community 17 - "Ie"
Cohesion: 0.23
Nodes (30): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+22 more)

### Community 18 - "z"
Cohesion: 0.18
Nodes (25): aE(), ar(), bE(), Br(), Ce(), dE(), ey(), Fe() (+17 more)

### Community 20 - "No"
Cohesion: 0.09
Nodes (20): applySpeakerToAll(), badWordsList, badWordsRegex, dohResolve(), expandTurnFamily(), expandTurnWithIpVariants(), fileBuffer, getActiveActivity() (+12 more)

### Community 21 - "constructor"
Cohesion: 0.14
Nodes (27): a(), Aa(), ba(), cc(), Da(), Du(), ec(), eo() (+19 more)

### Community 22 - "write"
Cohesion: 0.08
Nodes (45): applyTransformOptsToQuery(), copy(), createBucket(), createIndex(), createSignedUploadUrl(), createSignedUrl(), createSignedUrls(), deleteBucket() (+37 more)

### Community 23 - "_emitError"
Cohesion: 0.20
Nodes (27): ArrayPrototypePush(), createStream(), dw(), _emitError(), _parse4ByteNum(), _parseAuth(), _parseBuffer(), _parseByte() (+19 more)

### Community 24 - "a"
Cohesion: 0.32
Nodes (15): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbBroadcastAuth(), sbCanInteract(), sbCurrentUrl(), sbHandleHostLeft(), sbIsHost() (+7 more)

### Community 25 - "Sidebar.jsx"
Cohesion: 0.11
Nodes (36): s(), addEventListener(), aS(), co(), dS(), #F(), hS(), load() (+28 more)

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
Nodes (17): ch(), Di(), Em(), fh(), ih(), im(), ji(), lh() (+9 more)

### Community 30 - "main.js"
Cohesion: 0.21
Nodes (17): applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), attemptIceRestart(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure(), getIceServers() (+9 more)

### Community 31 - "dependencies"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 32 - "devDependencies"
Cohesion: 0.07
Nodes (54): gp(), ad(), ap(), at(), Au(), bs(), bu(), cd() (+46 more)

### Community 33 - "crypto-js.min.js"
Cohesion: 0.08
Nodes (35): ac(), _applyTopicAlias(), Bv(), cb(), _cleanUp(), _clearReconnect(), connect(), constructor() (+27 more)

### Community 34 - "_onConnect"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 35 - "la"
Cohesion: 0.19
Nodes (21): no(), af(), ao(), bc(), ca(), co(), ff(), he() (+13 more)

### Community 36 - ".read"
Cohesion: 0.22
Nodes (15): bl(), Cl(), dl(), El(), fl(), Il(), la(), Nl() (+7 more)

### Community 37 - "connectWithFallback"
Cohesion: 0.09
Nodes (26): Bt(), cn(), df(), gf(), Gt(), If(), jf(), jl() (+18 more)

### Community 38 - "decode"
Cohesion: 0.23
Nodes (16): index(), addVideoCard(), closeAllCards(), decryptMsg(), disconnectApp(), handleDataMessage(), makeCardFocusable(), removeInactiveOverlay() (+8 more)

### Community 39 - "Vt"
Cohesion: 0.17
Nodes (16): _binaryDecode(), binaryEncode(), _binaryEncodeUserBroadcastPush(), decode(), decodeBroadcast(), decodePush(), decodeReply(), _decodeUserBroadcast() (+8 more)

### Community 40 - "YapayDenetleyici"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 41 - "wt"
Cohesion: 0.18
Nodes (11): Empty App Config File (config.yml), TeamSync Main Window (index.html), Empty Names List File (names.txt), TeamSync Project Overview, playDeaf - Deafen/Undeafen Sound, playOp1 - Discord-Style Toggle Sound, playOp2 - Soft/Deep Toggle Sound, playOp3 - Digital UI Toggle Sound (+3 more)

### Community 43 - "uS"
Cohesion: 0.22
Nodes (13): build(), connectWithFallback(), makeRef(), off(), on(), onClose(), onError(), onMessage() (+5 more)

### Community 44 - "Da"
Cohesion: 0.50
Nodes (4): D_(), processWriteQueue(), socketReady(), writeToProxy()

### Community 45 - "_sendPacket"
Cohesion: 0.12
Nodes (32): T(), X(), ArrayPrototypeJoin(), ArrayPrototypePop(), Bx(), concat(), Cx(), format() (+24 more)

### Community 46 - "Ot"
Cohesion: 0.11
Nodes (7): C(), p(), q(), initLuckyWheel(), initPoke(), first(), move()

### Community 47 - "connect"
Cohesion: 0.24
Nodes (11): getActiveSlot(), getDeviceAccounts(), loginWithProfileData(), playNote(), playSound(), renderDeviceAccounts(), renderFriends(), saveDeviceAccounts() (+3 more)

### Community 48 - "log"
Cohesion: 0.07
Nodes (39): ajax(), batchSend(), cancelRefEvent(), cancelTimeout(), close(), closeAndRetry(), destroy(), fetchRequest() (+31 more)

### Community 50 - "If"
Cohesion: 0.33
Nodes (6): #E(), purgeStale(), rentries(), rforEach(), rkeys(), rvalues()

### Community 51 - "inject_megas.js"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !yapaydenetleyici.js, !yapaydenetliyici.md

### Community 52 - "pop"
Cohesion: 0.67
Nodes (3): bm(), gm(), Qf()

### Community 53 - "scripts"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 54 - "fetch_pokemon.js"
Cohesion: 0.25
Nodes (8): build, appId, directories, productName, win, output, icon, target

### Community 55 - "decode"
Cohesion: 0.24
Nodes (12): attachVideo(), bindUI(), broadcast(), getVideoConstraints(), getVideoSender(), initActivitiesUI(), setMicEnabled(), startRecording() (+4 more)

### Community 56 - "fix-html.js"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 57 - "fix-html-2.js"
Cohesion: 0.29
Nodes (7): scripts, build, build-full, build:react, dev:react, start, test:e2e

### Community 58 - "bindUI"
Cohesion: 0.67
Nodes (3): hw(), qs(), _r()

### Community 59 - "Zd"
Cohesion: 0.67
Nodes (3): MI(), rI(), wl()

### Community 60 - "resolveTurnHostsViaDoH"
Cohesion: 0.29
Nodes (8): createTable(), createTableIfNotExists(), dropTable(), listTables(), loadTable(), tableExists(), updateTable(), Vt()

### Community 61 - "tp"
Cohesion: 0.67
Nodes (3): ms(), nm(), sm()

### Community 62 - "enhance-css.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 63 - "renderFriends"
Cohesion: 0.67
Nodes (3): appendFileMsg(), initFileTransfer(), sendFile()

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
Cohesion: 0.06
Nodes (47): Bb(), bl(), _checkDisconnecting(), cut(), destroy(), entries(), eraseElementByIterator(), eraseElementByPos() (+39 more)

### Community 81 - "addUser"
Cohesion: 0.16
Nodes (16): addUser(), appendChat(), broadcastTo(), checkAvatar(), cleanText(), escapeHtml(), getShareableTurn(), handlePeerDiscovered() (+8 more)

### Community 97 - "initPoke"
Cohesion: 0.19
Nodes (31): f(), an(), fg(), final(), h(), Lu(), xx(), al() (+23 more)

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
- **203 isolated node(s):** `fs`, `https`, `fs`, `data`, `jsonStr` (+198 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **41 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty App Config File (config.yml)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Empty Names List File (names.txt)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `TeamSync Main Window (index.html)` and `Sound Effect Test Tool (sound_tester.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `r()` connect `Sidebar.jsx` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `App.jsx`, `t`, `n`, `i`, `mc`, `log`, `push`, `.push`, `uno.js`, `we`, `gu`, `Wr`, `z`, `constructor`, `write`, `send`, `devDependencies`, `crypto-js.min.js`, `.read`, `connectWithFallback`, `Vt`, `Ot`, `log`, `If`, `renderFriends`, `Bb`, `initPoke`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `e()` connect `mc` to `j`, `renderer.js`, `e`, `t`, `n`, `log`, `push`, `.push`, `uno.js`, `we`, `Wr`, `No`, `constructor`, `a`, `Sidebar.jsx`, `teardown`, `devDependencies`, `crypto-js.min.js`, `connectWithFallback`, `Vt`, `Ot`, `connect`, `log`, `decode`, `renderFriends`, `Bb`, `addUser`, `initPoke`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `t()` connect `write` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `App.jsx`, `t`, `n`, `i`, `mc`, `log`, `push`, `.push`, `uno.js`, `we`, `gu`, `Wr`, `z`, `No`, `constructor`, `Sidebar.jsx`, `devDependencies`, `crypto-js.min.js`, `.read`, `connectWithFallback`, `Vt`, `uS`, `Ot`, `log`, `teardown`, `decode`, `resolveTurnHostsViaDoH`, `Bb`, `initPoke`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 94 inferred relationships involving `n()` (e.g. with `a()` and `aA()`) actually correct?**
  _`n()` has 94 INFERRED edges - model-reasoned connections that need verification._