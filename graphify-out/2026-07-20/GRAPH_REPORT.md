# Graph Report - kanka-voice  (2026-07-20)

## Corpus Check
- 66 files · ~175,208 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1127 nodes · 2489 edges · 118 communities (71 shown, 47 thin omitted)
- Extraction: 88% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 284 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b6019992`
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
- end
- inject-types-css.js
- read
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
- reschedule
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
2. `e()` - 50 edges
3. `c()` - 40 edges
4. `a()` - 36 edges
5. `s()` - 33 edges
6. `write()` - 30 edges
7. `o()` - 29 edges
8. `bindUI()` - 28 edges
9. `handleDataMessage()` - 27 edges
10. `Wr()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `createWindow()` --indirect_call--> `e()`  [INFERRED]
  main.js → vendor/crypto-js.min.js
- `Duplicated handlePokeImgError Fragment (script.html)` --semantically_similar_to--> `window.handlePokeImgError Sprite Fallback Chain`  [INFERRED] [semantically similar]
  script.html → index.html
- `Duplicated handlePokeImgError Fragment (script.txt)` --semantically_similar_to--> `window.handlePokeImgError Sprite Fallback Chain`  [INFERRED] [semantically similar]
  script.txt → index.html
- `notifyAPI.onShowNotification Preload Bridge Call` --semantically_similar_to--> `window.trayAPI.showApp Preload Bridge Call`  [INFERRED] [semantically similar]
  notification.html → tray-menu.html
- `Duplicated handlePokeImgError Fragment (script.html)` --semantically_similar_to--> `Duplicated handlePokeImgError Fragment (script.txt)`  [INFERRED] [semantically similar]
  script.html → script.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Electron contextBridge Preload API Usage Across Secondary Windows** — notification_notifyapi, tray_menu_showapp, tray_menu_quitapp [INFERRED 0.80]
- **In-Room Party/Minigame Activities** — index_unogame, index_pokebattle, index_wheelfeature, index_pollfeature [INFERRED 0.75]
- **Legacy Vanilla vs React App Entry Points** — index_teamsyncapp, src_index_entry, src_dist_react_index_entry [INFERRED 0.80]

## Communities (118 total, 47 thin omitted)

### Community 0 - "mqtt.min.js"
Cohesion: 0.01
Nodes (22): Am(), AT(), bl(), eI(), _flushStoreProcessingQueue(), h0(), iI(), Iv() (+14 more)

### Community 1 - "j"
Cohesion: 0.08
Nodes (16): ArrayPrototypeIndexOf(), ArrayPrototypeSlice(), consume(), Eb(), fetch(), forceFetch(), fy(), _getBuffer() (+8 more)

### Community 2 - "index-DCnN8y-E.js"
Cohesion: 0.26
Nodes (16): ar(), bE(), Ce(), dE(), ey(), gE(), Gn(), hE() (+8 more)

### Community 3 - "renderer.js"
Cohesion: 0.23
Nodes (12): _applyTopicAlias(), _checkDisconnecting(), _nextId(), publish(), _removeTopicAliasAndRecoverTopicName(), _resubscribe(), _sendPacket(), sendPing() (+4 more)

### Community 4 - "e"
Cohesion: 0.06
Nodes (44): App(), Activities(), Chat(), Dashboard(), accountItemStyle, cardStyle, containerStyle, deleteBtnStyle (+36 more)

### Community 5 - "App.jsx"
Cohesion: 0.15
Nodes (13): H(), T(), X(), z(), ArrayPrototypeJoin(), Cx(), JA(), join() (+5 more)

### Community 6 - "t"
Cohesion: 0.18
Nodes (28): ArrayPrototypePush(), createStream(), dw(), _emitError(), P_(), _parse4ByteNum(), _parseAuth(), _parseBuffer() (+20 more)

### Community 7 - "n"
Cohesion: 0.14
Nodes (26): o(), s(), a(), ah(), aS(), EE(), end(), endAsync() (+18 more)

### Community 8 - "i"
Cohesion: 0.24
Nodes (16): f(), addEventListener(), c(), fg(), h(), hS(), kx(), l_() (+8 more)

### Community 9 - "mc"
Cohesion: 0.19
Nodes (8): e0(), Ie(), sE(), xd(), Xs(), Yv(), Zi(), Zv()

### Community 10 - "log"
Cohesion: 0.16
Nodes (18): ch(), Di(), Em(), fh(), ih(), im(), ji(), lh() (+10 more)

### Community 13 - "uno.js"
Cohesion: 0.25
Nodes (7): ac(), bm(), ew(), fb(), gm(), Qf(), sc()

### Community 14 - "we"
Cohesion: 0.24
Nodes (11): appendFileMsg(), attachVideo(), broadcast(), escapeHtml(), getVideoConstraints(), getVideoSender(), initFileTransfer(), sendFile() (+3 more)

### Community 15 - "gu"
Cohesion: 0.30
Nodes (4): { app }, fs, path, YapayDenetleyici

### Community 16 - "Wr"
Cohesion: 0.14
Nodes (17): cb(), _cleanUp(), _clearReconnect(), connect(), _destroyKeepaliveManager(), DT(), _flush(), _flushVolatile() (+9 more)

### Community 17 - "Ie"
Cohesion: 0.23
Nodes (30): animateCardDraw(), animateRemotePlay(), botPlay(), canPlay(), checkAndProcessCollectedHands(), distributeHands(), doRenderUnoGame(), endUnoGame() (+22 more)

### Community 19 - "constructor"
Cohesion: 0.21
Nodes (17): applyIceEscalationPolicy(), applySharedTurn(), applySpeakerTo(), attemptIceRestart(), createPeerConnection(), detectTunnelInterference(), diagnoseIceFailure(), getIceServers() (+9 more)

### Community 20 - "No"
Cohesion: 0.08
Nodes (24): appendChat(), applySpeakerToAll(), badWordsList, badWordsRegex, chatBlobUrls, cleanText(), dohResolve(), expandTurnFamily() (+16 more)

### Community 21 - "constructor"
Cohesion: 0.22
Nodes (8): bp(), eo(), gs(), Jv(), md(), Un(), Vp(), Ys()

### Community 22 - "write"
Cohesion: 0.33
Nodes (5): data, families, formsToAdd, fs, jsonStr

### Community 23 - "_emitError"
Cohesion: 0.20
Nodes (10): aA(), ArrayPrototypePop(), ep(), L0(), N0(), pa(), pop(), q0() (+2 more)

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
Cohesion: 0.10
Nodes (15): { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }, baseUserData, createWindow(), deviceIdentityFile, dgram, envPath, fs, getBroadcastAddresses() (+7 more)

### Community 29 - "wd"
Cohesion: 0.50
Nodes (4): fetchJson(), fs, https, run()

### Community 30 - "main.js"
Cohesion: 0.31
Nodes (9): aE(), Br(), Jp(), mE(), pn(), ty(), Xp(), Yp() (+1 more)

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
Cohesion: 0.33
Nodes (13): ab(), aI(), cI(), dl(), fI(), lI(), Ox(), pl() (+5 more)

### Community 37 - "connectWithFallback"
Cohesion: 0.50
Nodes (3): css, fs, pokeJs

### Community 38 - "decode"
Cohesion: 0.21
Nodes (17): addVideoCard(), closeAllCards(), decryptMsg(), disconnectApp(), handleDataMessage(), makeCardFocusable(), releaseChatBlobUrls(), removeInactiveOverlay() (+9 more)

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
Cohesion: 0.14
Nodes (13): initLuckyWheel(), initPoke(), C(), p(), q(), concat(), copy(), first() (+5 more)

### Community 47 - "connect"
Cohesion: 0.12
Nodes (25): checkSession(), checkTextWithAI(), deviceLogin(), getActiveSlot(), getDeviceAccounts(), limitVideoBitrate(), loadSupabaseProfile(), loginWithProfileData() (+17 more)

### Community 48 - "log"
Cohesion: 0.50
Nodes (3): fs, pokeJs, styleCss

### Community 49 - "teardown"
Cohesion: 0.50
Nodes (4): _invokeAllStoreProcessingQueue(), _invokeStoreProcessingQueue(), _removeOutgoingAndStoreMessage(), removeOutgoingMessage()

### Community 50 - "If"
Cohesion: 0.67
Nodes (3): Eh(), Qm(), zm()

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
Cohesion: 0.29
Nodes (7): scripts, build, build-full, build:react, dev:react, start, test:e2e

### Community 62 - "enhance-css.js"
Cohesion: 0.70
Nodes (4): handleWTMessage(), initWatchTogether(), loadWTVideo(), onWTStateChange()

### Community 64 - "improve-css.js"
Cohesion: 0.40
Nodes (5): notifyAPI.onShowNotification Preload Bridge Call, Notification Popup Window (notification.html), window.trayAPI.quitApp Preload Bridge Call, window.trayAPI.showApp Preload Bridge Call, Tray Menu Window (tray-menu.html)

### Community 67 - "Bn"
Cohesion: 0.14
Nodes (24): constructor(), cut(), eraseElementByIterator(), eraseElementByPos(), eraseElementByValue(), #F(), forEach(), G() (+16 more)

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

### Community 76 - "end"
Cohesion: 0.22
Nodes (5): Cv(), hd(), Le(), pd(), U0()

### Community 78 - "read"
Cohesion: 0.25
Nodes (9): an(), dd(), fd(), kv(), Ov(), read(), Rv(), Tv() (+1 more)

### Community 80 - "Bb"
Cohesion: 0.22
Nodes (4): destroy(), Fe(), Rb(), wd()

### Community 81 - "addUser"
Cohesion: 0.50
Nodes (5): addUser(), broadcastTo(), requestControl(), sendCtrlEvent(), showUserContextMenu()

### Community 82 - "cd"
Cohesion: 0.32
Nodes (7): cd(), cs(), dump(), Fs(), Qi(), Rc(), xc()

### Community 83 - "fetch"
Cohesion: 0.67
Nodes (3): drawWb(), initWhiteboard(), size()

### Community 87 - "T_"
Cohesion: 0.19
Nodes (13): abort(), B_(), Bx(), close(), co(), D_(), defaultId(), format() (+5 more)

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
- **209 isolated node(s):** `{ contextBridge, ipcRenderer }`, `{ contextBridge, ipcRenderer }`, `{ app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage }`, `path`, `dgram` (+204 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **47 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty App Config File (config.yml)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Empty Names List File (names.txt)` and `TeamSync Main Window (index.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `TeamSync Main Window (index.html)` and `Sound Effect Test Tool (sound_tester.html)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `e()` connect `connect` to `j`, `e`, `App.jsx`, `n`, `i`, `mc`, `we`, `No`, `constructor`, `a`, `teardown`, `wd`, `Ot`, `decode`, `shared-browser.js`, `Bn`, `end`, `addUser`, `cd`, `fetch`, `T_`, `uc`, `Bv`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `c()` connect `i` to `mqtt.min.js`, `index-DCnN8y-E.js`, `Bn`, `e`, `.read`, `n`, `Ot`, `connect`, `Bb`, `Ie`, `constructor`, `T_`, `main.js`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `we()` connect `j` to `mqtt.min.js`, `index-DCnN8y-E.js`, `Ot`, `connect`, `Bb`, `T_`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `i()` (e.g. with `initPoke()` and `o()`) actually correct?**
  _`i()` has 35 INFERRED edges - model-reasoned connections that need verification._