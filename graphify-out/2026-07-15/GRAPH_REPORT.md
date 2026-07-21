# Graph Report - kanka-voice  (2026-07-15)

## Corpus Check
- 60 files · ~166,270 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1720 nodes · 5195 edges · 100 communities (74 shown, 26 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 835 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e61c38ef`
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
- hu
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
- Ot
- Da
- Qf
- #E
- files
- package.json
- build
- If
- inject_megas.js
- pop
- scripts
- fetch_pokemon.js
- watch-together.js
- fix-html.js
- fix-html-2.js
- replace-emojis-css.js
- add-death-anim.js
- add-guide.js
- add-poke-vol.js
- enhance-css.js
- fix-emojis.js
- improve-css.js
- improve-emojis.js
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
- restore-poke-b64.js
- Bb
- [Symbol.iterator]
- uS
- jf
- pa
- reverseUpperBound
- T_
- uc
- Yf
- preload.js
- preload-flag.js
- preload-notification.js
- preload-tray.js
- README.md

## God Nodes (most connected - your core abstractions)
1. `n()` - 125 edges
2. `t()` - 121 edges
3. `r()` - 111 edges
4. `i()` - 106 edges
5. `j()` - 76 edges
6. `e()` - 73 edges
7. `a()` - 53 edges
8. `push()` - 53 edges
9. `i()` - 52 edges
10. `constructor()` - 50 edges

## Surprising Connections (you probably didn't know these)
- `createWindow()` --indirect_call--> `e()`  [INFERRED]
  main.js → js/crypto-js.min.js
- `limitVideoBitrate()` --indirect_call--> `e()`  [INFERRED]
  renderer.js → js/crypto-js.min.js
- `Tf()` --indirect_call--> `C()`  [INFERRED]
  mqtt.min.js → js/crypto-js.min.js
- `promisify()` --indirect_call--> `n()`  [INFERRED]
  mqtt.min.js → src/dist-react/assets/index-DCnN8y-E.js
- `fetchJson()` --indirect_call--> `e()`  [INFERRED]
  fetch_pokemon.js → js/crypto-js.min.js

## Import Cycles
- None detected.

## Communities (100 total, 26 thin omitted)

### Community 1 - "j"
Cohesion: 0.05
Nodes (116): _acquireLock(), _adminDeletePasskey(), _adminListPasskeys(), _approveAuthorization(), _authenticate(), _autoRefreshTokenTick(), binaryEncode(), Br() (+108 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.02
Nodes (49): add(), appendParams(), bs(), createNamespace(), createNamespaceIfNotExists(), detectEnvironment(), endpointURL(), eq() (+41 more)

### Community 3 - "renderer.js"
Cohesion: 0.06
Nodes (72): index(), addUser(), addVideoCard(), appendChat(), appendFileMsg(), attachVideo(), attemptIceRestart(), badWordsList (+64 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (62): e(), f(), T(), a(), addEventListener(), aE(), an(), aS() (+54 more)

### Community 5 - "App.jsx"
Cohesion: 0.06
Nodes (43): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+35 more)

### Community 6 - "t"
Cohesion: 0.07
Nodes (50): Tt(), setupVUMeter(), applyTransformOptsToQuery(), copy(), createBucket(), createIndex(), createSignedUploadUrl(), createSignedUrl() (+42 more)

### Community 7 - "n"
Cohesion: 0.10
Nodes (46): load(), Oi(), xA(), af(), bd(), Bt(), ct(), dp() (+38 more)

### Community 8 - "i"
Cohesion: 0.07
Nodes (42): s(), abort(), _applyTopicAlias(), AT(), B_(), bl(), _checkDisconnecting(), close() (+34 more)

### Community 9 - "mc"
Cohesion: 0.10
Nodes (44): WebRTC(), ac(), Bi(), cf(), dc(), di(), Do(), ea() (+36 more)

### Community 10 - "log"
Cohesion: 0.09
Nodes (44): _cancelPendingDisconnect(), clearHeartbeats(), connect(), connectionState(), disconnect(), filterBindings(), flushSendBuffer(), _handleNodeJsRaceCondition() (+36 more)

### Community 11 - "push"
Cohesion: 0.12
Nodes (43): al(), b(), bo(), c(), catch(), ce(), d(), ds() (+35 more)

### Community 12 - ".push"
Cohesion: 0.09
Nodes (39): X(), ArrayPrototypeJoin(), ArrayPrototypePush(), Bx(), cd(), cut(), dS(), dump() (+31 more)

### Community 13 - "uno.js"
Cohesion: 0.14
Nodes (38): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+30 more)

### Community 14 - "we"
Cohesion: 0.08
Nodes (16): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), consume(), Eb(), fetch(), find(), forceFetch(), _getBuffer() (+8 more)

### Community 15 - "hu"
Cohesion: 0.10
Nodes (29): q(), initLuckyWheel(), at(), bu(), cp(), delete(), dt(), Du() (+21 more)

### Community 16 - "Wr"
Cohesion: 0.11
Nodes (27): ab(), ah(), aI(), Am(), cI(), Di(), dl(), eI() (+19 more)

### Community 17 - "Ie"
Cohesion: 0.08
Nodes (20): bp(), e0(), eo(), fy(), gs(), Ie(), Jv(), md() (+12 more)

### Community 18 - "z"
Cohesion: 0.11
Nodes (28): ai(), as(), cs(), dd(), ec(), Fo(), ft(), Fu() (+20 more)

### Community 19 - "constructor"
Cohesion: 0.10
Nodes (26): drawWb(), initWhiteboard(), cb(), _cleanUp(), _clearReconnect(), co(), connect(), constructor() (+18 more)

### Community 20 - "No"
Cohesion: 0.15
Nodes (27): ao(), ba(), bc(), be(), ca(), cc(), co(), $e() (+19 more)

### Community 21 - "constructor"
Cohesion: 0.10
Nodes (26): channel(), clone(), constructor(), finally(), getChannel(), getChannels(), getSocket(), _handleTokenChanged() (+18 more)

### Community 22 - "write"
Cohesion: 0.18
Nodes (24): ar(), bE(), Br(), Ce(), dE(), ey(), Fe(), gE() (+16 more)

### Community 23 - "_emitError"
Cohesion: 0.24
Nodes (24): _emitError(), _parse4ByteNum(), _parseAuth(), _parseBuffer(), _parseByte(), _parseByType(), _parseConfirmation(), _parseConnack() (+16 more)

### Community 24 - "a"
Cohesion: 0.19
Nodes (22): a(), Au(), cd(), ci(), Cu(), et(), Eu(), gu() (+14 more)

### Community 25 - "Sidebar.jsx"
Cohesion: 0.10
Nodes (19): actionSectionStyle, avatarStyle, badgeStyle, baseActionBtn, btnCreateStyle, btnJoinStyle, emptyTextStyle, friendAvatarPlaceholder (+11 more)

### Community 26 - "join"
Cohesion: 0.10
Nodes (21): cloneRequestState(), containedBy(), contains(), dropNamespace(), explain(), ilikeAllOf(), ilikeAnyOf(), insert() (+13 more)

### Community 27 - "send"
Cohesion: 0.14
Nodes (20): ajax(), batchSend(), canPush(), close(), closeAndRetry(), _fetchWithTimeout(), hasReceived(), httpSend() (+12 more)

### Community 28 - "teardown"
Cohesion: 0.11
Nodes (20): cancelRefEvent(), cancelTimeout(), destroy(), isFilterValueEqual(), matchReceive(), _notThisChannelEvent(), pt(), removeAllChannels() (+12 more)

### Community 29 - "wd"
Cohesion: 0.16
Nodes (19): ad(), ar(), cr(), dr(), Ed(), Er(), fr(), Gd() (+11 more)

### Community 30 - "main.js"
Cohesion: 0.12
Nodes (13): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage }, baseUserData, createWindow(), dgram, envPath, fs, getBroadcastAddresses(), getLocalIPs() (+5 more)

### Community 31 - "dependencies"
Cohesion: 0.12
Nodes (17): acorn, cross-fetch, crypto-js, @ghostery/adblocker-electron, @jitsi/robotjs, dependencies, acorn, cross-fetch (+9 more)

### Community 32 - "devDependencies"
Cohesion: 0.13
Nodes (15): concurrently, cross-env, electron, electron-builder, electron-packager, devDependencies, concurrently, cross-env (+7 more)

### Community 33 - "crypto-js.min.js"
Cohesion: 0.13
Nodes (5): C(), p(), initPoke(), first(), move()

### Community 34 - "_onConnect"
Cohesion: 0.15
Nodes (14): dd(), fd(), _flushStoreProcessingQueue(), _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), kv(), _onConnect(), Ov() (+6 more)

### Community 35 - "la"
Cohesion: 0.24
Nodes (14): bl(), Cl(), dl(), El(), fl(), Il(), la(), Nl() (+6 more)

### Community 36 - ".read"
Cohesion: 0.18
Nodes (8): Bv(), destroy(), Iv(), Mv(), reschedule(), setKeepalive(), Ws(), yd()

### Community 37 - "connectWithFallback"
Cohesion: 0.22
Nodes (13): build(), connectWithFallback(), makeRef(), off(), on(), onClose(), onError(), onMessage() (+5 more)

### Community 38 - "decode"
Cohesion: 0.24
Nodes (12): _binaryDecode(), _binaryEncodeUserBroadcastPush(), decode(), decodeBroadcast(), decodePush(), decodeReply(), _decodeUserBroadcast(), _encodeBinaryUserBroadcastPush() (+4 more)

### Community 39 - "Vt"
Cohesion: 0.18
Nodes (12): createTable(), createTableIfNotExists(), df(), dropTable(), listTables(), loadTable(), of(), tableExists() (+4 more)

### Community 40 - "YapayDenetleyici"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 41 - "wt"
Cohesion: 0.24
Nodes (11): ch(), fh(), ih(), nh(), oh(), Pm(), Rm(), Tm() (+3 more)

### Community 42 - "jt"
Cohesion: 0.22
Nodes (5): DT(), jt(), ln(), w0(), Wb()

### Community 44 - "Da"
Cohesion: 0.25
Nodes (9): Aa(), cn(), Da(), ia(), ja(), Ka(), Mo(), Oa() (+1 more)

### Community 45 - "Qf"
Cohesion: 0.25
Nodes (7): ac(), bm(), ew(), fb(), gm(), Qf(), sc()

### Community 46 - "#E"
Cohesion: 0.25
Nodes (8): #E(), j_(), purgeStale(), rentries(), rforEach(), rkeys(), rvalues(), unsafeExposeInternals()

### Community 47 - "files"
Cohesion: 0.25
Nodes (8): files, **/*, !dist, !.env, !node_modules, !problemler.md, !yapaydenetleyici.js, !yapaydenetliyici.md

### Community 48 - "package.json"
Cohesion: 0.29
Nodes (6): author, description, license, main, name, version

### Community 49 - "build"
Cohesion: 0.29
Nodes (7): build, appId, directories, productName, win, output, target

### Community 50 - "If"
Cohesion: 0.43
Nodes (7): ef(), gf(), If(), jf(), kf(), Lf(), Mf()

### Community 51 - "inject_megas.js"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 52 - "pop"
Cohesion: 0.33
Nodes (6): aA(), ArrayPrototypePop(), L0(), N0(), pop(), remove()

### Community 53 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, build-full, build:react, dev:react, start

### Community 54 - "fetch_pokemon.js"
Cohesion: 0.50
Nodes (4): fetchJson(), fs, https, run()

### Community 55 - "watch-together.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 56 - "fix-html.js"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 57 - "fix-html-2.js"
Cohesion: 0.40
Nodes (4): content, fs, pokeEndIdx, pokeStartIdx

### Community 58 - "replace-emojis-css.js"
Cohesion: 0.40
Nodes (4): css, endIndex, fs, startIndex

### Community 59 - "add-death-anim.js"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 60 - "add-guide.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 61 - "add-poke-vol.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 62 - "enhance-css.js"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 63 - "fix-emojis.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 64 - "improve-css.js"
Cohesion: 0.50
Nodes (3): fs, html, pokeJs

### Community 65 - "improve-emojis.js"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

### Community 68 - "cs"
Cohesion: 0.67
Nodes (3): cs(), Rc(), xc()

### Community 69 - "_r"
Cohesion: 0.67
Nodes (3): hw(), qs(), _r()

### Community 70 - "rI"
Cohesion: 0.67
Nodes (3): MI(), rI(), wl()

### Community 71 - "ms"
Cohesion: 0.67
Nodes (3): ms(), nm(), sm()

### Community 72 - "processWriteQueue"
Cohesion: 0.67
Nodes (3): processWriteQueue(), socketReady(), writeToProxy()

## Knowledge Gaps
- **150 isolated node(s):** `fs`, `https`, `fs`, `data`, `jsonStr` (+145 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `e()` connect `e` to `j`, `renderer.js`, `App.jsx`, `t`, `n`, `i`, `mc`, `log`, `push`, `.push`, `we`, `hu`, `Ie`, `constructor`, `constructor`, `teardown`, `wd`, `main.js`, `crypto-js.min.js`, `.read`, `decode`, `Da`, `fetch_pokemon.js`, `shared-browser.js`, `[Symbol.iterator]`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `t()` connect `t` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `e`, `n`, `i`, `mc`, `log`, `push`, `.push`, `uno.js`, `we`, `hu`, `Ie`, `z`, `constructor`, `constructor`, `write`, `a`, `join`, `send`, `teardown`, `wd`, `crypto-js.min.js`, `la`, `.read`, `connectWithFallback`, `decode`, `Vt`, `Ot`, `Da`, `#E`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `r()` connect `n` to `j`, `index-DCnN8y-E.js`, `renderer.js`, `e`, `t`, `i`, `mc`, `log`, `push`, `.push`, `we`, `hu`, `Ie`, `z`, `constructor`, `No`, `constructor`, `write`, `a`, `send`, `teardown`, `wd`, `la`, `.read`, `decode`, `jt`, `Da`, `#E`, `cs`, `Bb`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 94 inferred relationships involving `n()` (e.g. with `a()` and `aA()`) actually correct?**
  _`n()` has 94 INFERRED edges - model-reasoned connections that need verification._
- **Are the 72 inferred relationships involving `t()` (e.g. with `initPoke()` and `a()`) actually correct?**
  _`t()` has 72 INFERRED edges - model-reasoned connections that need verification._
- **Are the 95 inferred relationships involving `r()` (e.g. with `initLuckyWheel()` and `a()`) actually correct?**
  _`r()` has 95 INFERRED edges - model-reasoned connections that need verification._
- **Are the 44 inferred relationships involving `i()` (e.g. with `ac()` and `_approveAuthorization()`) actually correct?**
  _`i()` has 44 INFERRED edges - model-reasoned connections that need verification._