// ÇOKLU BROKER İSTEMCİSİ — masaüstündeki createMultiBrokerClient'ın
// (renderer.js) telefon kopyası. Faz 1'de ikisi tek ortak dosyaya (core/)
// taşınacak; o zamana kadar davranış birebir aynı tutulmalı:
// bütün broker'lara aynı anda bağlan, her yayını bağlı olan HER broker'a gönder,
// gelen kopyaları içerik özetiyle ayıkla. Bir ortak broker ayakta olduğu sürece
// telefon ile PC buluşur.

export const SIGNALING_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const DEDUPE_MS = 2000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;

export function createMultiBrokerClient(tag, makeClientId) {
  const mqtt = window.mqtt;
  if (!mqtt) throw new Error('mqtt.min.js yüklenmedi');
  const handlers = {};
  const subs = new Map();
  const seen = new Map();
  let anyConnected = false;
  let ended = false;

  const emit = (ev, ...args) => (handlers[ev] || []).forEach(fn => {
    try { fn(...args); } catch (e) { console.error(`MQTT [${tag}] ${ev} hata:`, e); }
  });

  const isDuplicate = (topic, message) => {
    const now = Date.now();
    if (seen.size > 500) seen.forEach((ts, k) => { if (now - ts > DEDUPE_MS) seen.delete(k); });
    let h = 2166136261;
    for (let i = 0; i < topic.length; i++) { h ^= topic.charCodeAt(i); h = Math.imul(h, 16777619); }
    const len = message ? message.length : 0;
    for (let i = 0; i < len; i++) { h ^= message[i]; h = Math.imul(h, 16777619); }
    const key = topic.length + ':' + len + ':' + (h >>> 0);
    const ts = seen.get(key);
    if (ts != null && now - ts < DEDUPE_MS) return true;
    seen.set(key, now);
    return false;
  };

  const clients = SIGNALING_BROKERS.map((url) => {
    const c = mqtt.connect(url, { clientId: makeClientId(), keepalive: 60, reconnectPeriod: 0, connectTimeout: 6000 });
    let retryDelay = RECONNECT_MIN_MS;
    let retryTimer = null;
    const retryNow = () => {
      if (ended || c.connected || !retryTimer) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      retryDelay = RECONNECT_MIN_MS;
      try { c.reconnect(); } catch (e) {}
    };
    c.on('close', () => {
      if (ended) return;
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!ended && !c.connected) { try { c.reconnect(); } catch (e) {} }
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
      }
      if (anyConnected && !clients.some(x => x.connected)) { anyConnected = false; emit('close'); }
    });
    // Telefon Wi-Fi ↔ mobil veri arasında geçince ya da uygulama öne gelince
    // uzun beklemeyi atla.
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) retryNow(); });
    c.on('connect', () => {
      retryDelay = RECONNECT_MIN_MS;
      if (ended) { try { c.end(true); } catch (e) {} return; }
      subs.forEach((opts, topic) => { try { c.subscribe(topic, opts); } catch (e) {} });
      if (!anyConnected) { anyConnected = true; emit('connect'); }
      emit('brokers');
    });
    c.on('close', () => emit('brokers'));
    c.on('error', (err) => { if (!ended) console.warn(`MQTT [${tag}] ${url}:`, err && err.message ? err.message : err); });
    c.on('message', (topic, message) => {
      if (ended || isDuplicate(topic, message)) return;
      emit('message', topic, message);
    });
    return c;
  });

  const live = () => clients.filter(c => c.connected);

  return {
    get connected() { return !ended && clients.some(c => c.connected); },
    brokers() { return SIGNALING_BROKERS.map((url, i) => ({ url, connected: !ended && !!clients[i].connected })); },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
    publish(topic, message, opts) {
      const targets = live();
      (targets.length ? targets : clients).forEach(c => { try { c.publish(topic, message, opts || {}); } catch (e) {} });
      return this;
    },
    subscribe(topic, opts) {
      subs.set(topic, opts || { qos: 0 });
      live().forEach(c => { try { c.subscribe(topic, opts || { qos: 0 }); } catch (e) {} });
      return this;
    },
    end() {
      ended = true;
      clients.forEach(c => { try { c.end(true); } catch (e) {} });
    },
  };
}
