// Regression guard: the real vendored RNNoise WASM AudioWorklet must become
// the outbound microphone track source in a real Electron renderer.
const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9311, name: 'RNNoisePeer' });
  try {
    await createRoom(peer);
    await waitFor(
      peer.client,
      `window.state && (window.state.rnnoiseStatus === 'active' || window.state.rnnoiseStatus === 'fallback')`,
      15000,
      'RNNoise initialization'
    );
    // AudioWorkletProcessor initializes its WASM module asynchronously. Give a
    // delayed processor error time to trigger the production fallback handler.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const result = await evalJS(peer.client, `
      ({
        requested: window.state.useAI,
        active: window.state.rnnoiseActive,
        status: window.state.rnnoiseStatus,
        hasFilter: !!(window.state.audioNodes && window.state.audioNodes.rnnoiseFilterNode),
        hasOutboundAudio: !!(window.state.localStream && window.state.localStream.getAudioTracks()[0])
      })
    `);

    assert.deepStrictEqual(result, {
      requested: true,
      active: true,
      status: 'active',
      hasFilter: true,
      hasOutboundAudio: true
    });

    // Durum bayrakları yeterli değil: worklet'in WASM kurulumu asenkron
    // çöktüğünde (ör. CSP 'wasm-unsafe-eval' eksikken) statü 'active' kalır ama
    // çıkış sonsuza dek dijital sessizliktir (tam 0.0 örnekler) ve odadaki
    // kimse kimseyi duyamaz. Ham mikrofonda sinyal varken RNNoise çıkışının
    // tamamen sıfır olmadığını doğrula.
    const energy = await evalJS(peer.client, `
      (async function() {
        function peak(analyser) {
          if (!analyser) return null;
          const d = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(d);
          let m = 0;
          for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
          return m;
        }
        let rawPeak = 0, outPeak = 0;
        for (let i = 0; i < 30; i++) { // ~3 sn örnekle
          rawPeak = Math.max(rawPeak, peak(window.state.vuAnalyser) || 0);
          outPeak = Math.max(outPeak, peak(window.state.uiAnalyser) || 0);
          await new Promise(r => setTimeout(r, 100));
        }
        return { rawPeak, outPeak };
      })()
    `, true);
    assert.ok(energy.rawPeak > 0, 'Sahte mikrofon sinyal üretmedi, test anlamsız: ' + JSON.stringify(energy));
    assert.ok(energy.outPeak > 0, 'RNNoise çıkışı dijital sessizlik (worklet WASM kurulumu çökmüş olabilir): ' + JSON.stringify(energy));
  } finally {
    cleanupPeer(peer);
  }
};
