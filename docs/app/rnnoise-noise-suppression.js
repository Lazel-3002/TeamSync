(function () {
  'use strict';

  const PROCESSOR_NAME = '@sapphi-red/web-noise-suppressor/rnnoise';
  const WORKLET_URL = new URL('vendor/rnnoise/workletProcessor.js', document.baseURI).href;
  const WASM_URL = new URL('vendor/rnnoise/rnnoise.wasm', document.baseURI).href;
  const SIMD_WASM_URL = new URL('vendor/rnnoise/rnnoise_simd.wasm', document.baseURI).href;
  const moduleContexts = new WeakSet();
  let wasmBinaryPromise = null;

  // CSP script-src 'wasm-unsafe-eval' içermiyorsa WebAssembly derlemesi worklet
  // içinde asenkron patlar ve işlemci kurulamadan sonsuza dek sessizlik üretir
  // ("birbirimizi duyamıyoruz" hatası). WebAssembly.validate derleme yapmadığı
  // için bunu yakalayamaz; minik bir modülü gerçekten derleyerek baştan test et.
  function canCompileWasm() {
    try {
      new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      return true;
    } catch (error) {
      console.warn('WebAssembly derlemesi engellendi (CSP wasm-unsafe-eval eksik olabilir):', error);
      return false;
    }
  }

  function isSupported() {
    return typeof AudioWorkletNode === 'function'
      && typeof WebAssembly === 'object'
      && !!(window.AudioContext || window.webkitAudioContext)
      && canCompileWasm();
  }

  function supportsWasmSimd() {
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
        3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ]));
    } catch (error) {
      return false;
    }
  }

  // Chromium's fetch() does not consistently read file:// URLs. XHR supports
  // local app assets in Electron and still works when the UI is served by Vite.
  function loadArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.responseType = 'arraybuffer';
      request.onload = () => {
        if (request.response && (request.status === 0 || (request.status >= 200 && request.status < 300))) {
          resolve(request.response);
        } else {
          reject(new Error(`RNNoise WASM yüklenemedi (${request.status})`));
        }
      };
      request.onerror = () => reject(new Error('RNNoise WASM dosyasına erişilemedi'));
      request.send();
    });
  }

  function loadWasmBinary() {
    if (!wasmBinaryPromise) {
      const url = supportsWasmSimd() ? SIMD_WASM_URL : WASM_URL;
      wasmBinaryPromise = loadArrayBuffer(url).catch(error => {
        wasmBinaryPromise = null;
        throw error;
      });
    }
    return wasmBinaryPromise;
  }

  async function createNoiseFilter({ audioContext, onError }) {
    if (!isSupported() || !audioContext.audioWorklet) {
      throw new Error('AudioWorklet bu sistemde desteklenmiyor');
    }
    // RNNoise processes 480-sample frames at 48 kHz (10 ms). Keeping the
    // context fixed avoids pitch/speed artifacts and unnecessary resampling.
    if (audioContext.sampleRate !== 48000) {
      throw new Error(`RNNoise 48 kHz gerektiriyor (${audioContext.sampleRate} Hz alındı)`);
    }

    const tasks = [loadWasmBinary()];
    if (!moduleContexts.has(audioContext)) {
      tasks.push(audioContext.audioWorklet.addModule(WORKLET_URL));
    }
    const [wasmBinary] = await Promise.all(tasks);
    moduleContexts.add(audioContext);

    const node = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: {
        maxChannels: 1,
        wasmBinary
      }
    });
    node.onprocessorerror = event => {
      if (typeof onError === 'function') {
        onError(event instanceof Error ? event : new Error('RNNoise AudioWorklet durdu'));
      }
    };
    return node;
  }

  function releaseFilter(node) {
    if (!node) return;
    try { node.port.postMessage('destroy'); } catch (error) {}
    try { node.disconnect(); } catch (error) {}
  }

  window.RNNoiseSuppression = {
    isSupported,
    createNoiseFilter,
    releaseFilter,
    paths: {
      worklet: WORKLET_URL,
      wasm: WASM_URL,
      simdWasm: SIMD_WASM_URL
    }
  };
})();
