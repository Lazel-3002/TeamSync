# Graph Report - kanka-voice  (2026-07-16)

## Corpus Check
- 66 files · ~169,829 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1818 nodes · 5349 edges · 117 communities (75 shown, 42 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 865 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8467bfd1`
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
- Ot
- connect
- If
- inject_megas.js
- pop
- scripts
- fetch_pokemon.js
- fix-html.js
- fix-html-2.js
- tp
- enhance-css.js
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
- uS
- jf
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
- _removeOutgoingAndStoreMessage
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
- set

## God Nodes (most connected - your core abstractions)
1. `n()` - 125 edges
2. `t()` - 121 edges
3. `r()` - 116 edges
4. `i()` - 106 edges
5. `j()` - 76 edges
6. `e()` - 73 edges
7. `a()` - 53 edges
8. `push()` - 53 edges
9. `i()` - 52 edges
10. `s()` - 50 edges

## Surprising Connections (you probably didn't know these)
- `createWindow()` --indirect_call--> `e()`  [INFERRED]
  main.js → js/crypto-js.min.js
- `limitVideoBitrate()` --indirect_call--> `e()`  [INFERRED]
  renderer.js → js/crypto-js.min.js
- `Tf()` --indirect_call--> `C()`  [INFERRED]
  mqtt.min.js → js/crypto-js.min.js
- `promisify()` --indirect_call--> `n()`  [INFERRED]
  mqtt.min.js → src/dist-react/assets/index-DCnN8y-E.js
- `Duplicated handlePokeImgError Fragment (script.html)` --semantically_similar_to--> `window.handlePokeImgError Sprite Fallback Chain`  [INFERRED] [semantically similar]
  script.html → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Electron contextBridge Preload API Usage Across Secondary Windows** — notification_notifyapi, tray_menu_showapp, tray_menu_quitapp [INFERRED 0.80]
- **In-Room Party/Minigame Activities** — index_unogame, index_pokebattle, index_wheelfeature, index_pollfeature [INFERRED 0.75]
- **Legacy Vanilla vs React App Entry Points** — index_teamsyncapp, src_index_entry, src_dist_react_index_entry [INFERRED 0.80]

## Communities (117 total, 42 thin omitted)

### Community 1 - "j"
Cohesion: 0.05
Nodes (117): _acquireLock(), _adminDeletePasskey(), _adminListPasskeys(), _approveAuthorization(), ar(), _authenticate(), _autoRefreshTokenTick(), Br() (+109 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.02
Nodes (39): add(), be(), createNamespace(), createNamespaceIfNotExists(), detectEnvironment(), $e(), eq(), from() (+31 more)

### Community 3 - "renderer.js"
Cohesion: 0.08
Nodes (47): _cancelPendingDisconnect(), canPush(), clearHeartbeats(), connect(), connectionState(), connectWithFallback(), disconnect(), filterBindings() (+39 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 5 - "App.jsx"
Cohesion: 0.10
Nodes (29): ai(), as(), bs(), cs(), dd(), ec(), Fo(), Fu() (+21 more)

### Community 6 - "t"
Cohesion: 0.12
Nodes (38): ac(), Bi(), cf(), dc(), di(), Do(), ea(), Fa() (+30 more)

### Community 7 - "n"
Cohesion: 0.13
Nodes (40): final(), al(), b(), c(), catch(), ce(), cn(), cr() (+32 more)

### Community 8 - "i"
Cohesion: 0.09
Nodes (18): bp(), e0(), eo(), fy(), gs(), Ie(), Rb(), sE() (+10 more)

### Community 9 - "mc"
Cohesion: 0.18
Nodes (23): ao(), ba(), bc(), ca(), cc(), co(), eo(), ff() (+15 more)

### Community 10 - "log"
Cohesion: 0.07
Nodes (36): aA(), an(), ArrayPrototypePush(), cd(), cs(), Cv(), dd(), destroy() (+28 more)

### Community 11 - "push"
Cohesion: 0.06
Nodes (26): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), Bv(), consume(), defaultId(), Eb(), fetch(), find() (+18 more)

### Community 12 - ".push"
Cohesion: 0.67
Nodes (3): processWriteQueue(), socketReady(), writeToProxy()

### Community 13 - "uno.js"
Cohesion: 0.06
Nodes (85): e(), f(), s(), T(), a(), ab(), abort(), addEventListener() (+77 more)

### Community 15 - "gu"
Cohesion: 0.21
Nodes (17): Au(), Cu(), Eu(), gu(), id(), ii(), ku(), ld() (+9 more)

### Community 16 - "Wr"
Cohesion: 0.10
Nodes (25): channel(), clone(), constructor(), getChannel(), getChannels(), getSocket(), _handleTokenChanged(), Ht() (+17 more)

### Community 17 - "Ie"
Cohesion: 0.22
Nodes (29): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+21 more)

### Community 18 - "z"
Cohesion: 0.14
Nodes (29): aE(), ar(), bE(), Br(), Ca(), Ce(), dE(), ey() (+21 more)

### Community 19 - "constructor"
Cohesion: 0.06
Nodes (60): Tt(), setupVUMeter(), applyTransformOptsToQuery(), copy(), createBucket(), createIndex(), createSignedUploadUrl(), createSignedUrl() (+52 more)

### Community 20 - "No"
Cohesion: 0.05
Nodes (86): index(), addUser(), addVideoCard(), appendChat(), appendFileMsg(), applySharedTurn(), applySpeakerTo(), applySpeakerToAll() (+78 more)

### Community 21 - "constructor"
Cohesion: 0.22
Nodes (5): DT(), jt(), ln(), w0(), Wb()

### Community 22 - "write"
Cohesion: 0.08
Nodes (37): drawWb(), initWhiteboard(), _applyTopicAlias(), cb(), _checkDisconnecting(), _cleanUp(), _clearReconnect(), connect() (+29 more)

### Community 23 - "_emitError"
Cohesion: 0.24
Nodes (24): _emitError(), _parse4ByteNum(), _parseAuth(), _parseBuffer(), _parseByte(), _parseByType(), _parseConfirmation(), _parseConnack() (+16 more)

### Community 24 - "a"
Cohesion: 0.67
Nodes (5): handleSBMessage(), initSharedBrowser(), sbApplyRemoteNav(), sbCurrentUrl(), sbNormUrl()

### Community 25 - "Sidebar.jsx"
Cohesion: 0.12
Nodes (19): cloneRequestState(), containedBy(), contains(), explain(), ilikeAllOf(), ilikeAnyOf(), insert(), Ir() (+11 more)

### Community 26 - "join"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 27 - "send"
Cohesion: 0.12
Nodes (29): { spawnPeer, cleanupPeer, waitFor }, APP_DIR, cdp(), cleanupPeer(), clickWhenReady(), createRoom(), ELECTRON_BIN, evalJS() (+21 more)

### Community 28 - "teardown"
Cohesion: 0.12
Nodes (13): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage }, baseUserData, createWindow(), dgram, envPath, fs, getBroadcastAddresses(), getLocalIPs() (+5 more)

### Community 29 - "wd"
Cohesion: 0.16
Nodes (18): ch(), Di(), Em(), fh(), ih(), im(), ji(), lh() (+10 more)

### Community 30 - "main.js"
Cohesion: 0.40
Nodes (5): ArrayPrototypePop(), L0(), N0(), pop(), remove()

### Community 31 - "dependencies"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 32 - "devDependencies"
Cohesion: 0.10
Nodes (31): gp(), ap(), at(), bu(), cp(), delete(), dp(), dt() (+23 more)

### Community 33 - "crypto-js.min.js"
Cohesion: 0.50
Nodes (4): fetchJson(), fs, https, run()

### Community 34 - "_onConnect"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 35 - "la"
Cohesion: 0.13
Nodes (23): bl(), Cl(), dl(), El(), fl(), hl(), Il(), la() (+15 more)

### Community 36 - ".read"
Cohesion: 0.11
Nodes (7): C(), p(), q(), initLuckyWheel(), initPoke(), first(), move()

### Community 37 - "connectWithFallback"
Cohesion: 0.12
Nodes (30): af(), Bt(), df(), Du(), ef(), fd(), gf(), i() (+22 more)

### Community 38 - "decode"
Cohesion: 0.25
Nodes (7): ac(), bm(), ew(), fb(), gm(), Qf(), sc()

### Community 39 - "Vt"
Cohesion: 0.17
Nodes (16): _binaryDecode(), binaryEncode(), _binaryEncodeUserBroadcastPush(), decode(), decodeBroadcast(), decodePush(), decodeReply(), _decodeUserBroadcast() (+8 more)

### Community 40 - "YapayDenetleyici"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 41 - "wt"
Cohesion: 0.18
Nodes (11): Empty App Config File (config.yml), TeamSync Main Window (index.html), Empty Names List File (names.txt), TeamSync Project Overview, playDeaf - Deafen/Undeafen Sound, playOp1 - Discord-Style Toggle Sound, playOp2 - Soft/Deep Toggle Sound, playOp3 - Digital UI Toggle Sound (+3 more)

### Community 44 - "Da"
Cohesion: 0.09
Nodes (32): ajax(), batchSend(), close(), closeAndRetry(), fetchRequest(), _fetchWithTimeout(), hasReceived(), httpSend() (+24 more)

### Community 47 - "connect"
Cohesion: 0.09
Nodes (31): ad(), bo(), build(), cancelRefEvent(), cancelTimeout(), destroy(), ds(), Ed() (+23 more)

### Community 50 - "If"
Cohesion: 0.29
Nodes (7): #E(), j_(), purgeStale(), rentries(), rforEach(), rkeys(), rvalues()

### Community 51 - "inject_megas.js"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !yapaydenetleyici.js, !yapaydenetliyici.md

### Community 52 - "pop"
Cohesion: 0.29
Nodes (8): createTable(), createTableIfNotExists(), dropTable(), listTables(), loadTable(), tableExists(), updateTable(), Vt()

### Community 53 - "scripts"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 54 - "fetch_pokemon.js"
Cohesion: 0.29
Nodes (7): build, appId, directories, productName, win, output, target

### Community 56 - "fix-html.js"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 57 - "fix-html-2.js"
Cohesion: 0.29
Nodes (7): scripts, build, build-full, build:react, dev:react, start, test:e2e

### Community 61 - "tp"
Cohesion: 0.14
Nodes (31): dS(), #F(), load(), Oi(), unsafeExposeInternals(), xA(), a(), bd() (+23 more)

### Community 62 - "enhance-css.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

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
Cohesion: 0.13
Nodes (23): Bb(), cut(), entries(), eraseElementByIterator(), eraseElementByPos(), eraseElementByValue(), forEach(), getElementByPos() (+15 more)

### Community 81 - "uS"
Cohesion: 0.10
Nodes (25): Aa(), appendParams(), ct(), Da(), endpointURL(), execute(), finally(), ga() (+17 more)

### Community 98 - "_removeOutgoingAndStoreMessage"
Cohesion: 0.50
Nodes (4): _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), _removeOutgoingAndStoreMessage(), removeOutgoingMessage()

### Community 130 - "set"
Cohesion: 0.13
Nodes (19): X(), ArrayPrototypeJoin(), Bx(), co(), delete(), G(), JA(), join() (+11 more)

## Ambiguous Edges - Review These
- `Empty App Config File (config.yml)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  config.yml · relation: conceptually_related_to
- `Empty Names List File (names.txt)` → `TeamSync Main Window (index.html)`  [AMBIGUOUS]
  names.txt · relation: conceptually_related_to
- `TeamSync Main Window (index.html)` → `Sound Effect Test Tool (sound_tester.html)`  [AMBIGUOUS]
  sound_tester.html · relation: conceptually_related_to

## Knowledge Gaps
- **198 isolated node(s):** `fs`, `https`, `fs`, `data`, `jsonStr` (+193 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty App Config File (config.yml)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Empty Names List File (names.txt)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `TeamSync Main Window (index.html)` and `Sound Effect Test Tool (sound_tester.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `e()` connect `uno.js` to `j`, `set`, `renderer.js`, `e`, `t`, `n`, `i`, `log`, `push`, `Wr`, `z`, `constructor`, `No`, `write`, `a`, `teardown`, `devDependencies`, `crypto-js.min.js`, `.read`, `connectWithFallback`, `Vt`, `Da`, `connect`, `tp`, `Bb`, `uS`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `r()` connect `tp` to `j`, `set`, `index-DCnN8y-E.js`, `renderer.js`, `App.jsx`, `t`, `n`, `i`, `mc`, `log`, `push`, `uno.js`, `gu`, `Wr`, `z`, `constructor`, `No`, `constructor`, `write`, `send`, `devDependencies`, `la`, `.read`, `connectWithFallback`, `Vt`, `Da`, `connect`, `If`, `Bb`, `uS`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `t()` connect `constructor` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `App.jsx`, `t`, `n`, `i`, `log`, `push`, `uno.js`, `Wr`, `z`, `No`, `write`, `devDependencies`, `la`, `.read`, `connectWithFallback`, `Vt`, `Da`, `Ot`, `connect`, `If`, `pop`, `tp`, `uS`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 94 inferred relationships involving `n()` (e.g. with `a()` and `aA()`) actually correct?**
  _`n()` has 94 INFERRED edges - model-reasoned connections that need verification._