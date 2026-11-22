// Java tarafındaki TsCall eklentisinin JS köprüsü
// (android/app/src/main/java/com/teamsync/mobile/TsCallPlugin.java).
// Tarayıcıda (web sürümü / vite dev) eklenti yoktur; çağrılar sessizce hiçbir
// şey yapmaz, web'e uygun karşılığı olanlar onu kullanır.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

const TsCall = registerPlugin('TsCall');
export const isNative = () => Capacitor.isNativePlatform();

async function call(name, args) {
  if (!isNative()) return null;
  try { return await TsCall[name](args || {}); } catch (e) { console.warn('TsCall.' + name, e); throw e; }
}

export const startCallService = (title, text) => call('start', { title, text }).catch(() => {});
export const stopCallService = () => call('stop').catch(() => {});
// 'speaker' | 'earpiece' — kulaklık/Bluetooth takılıysa Android onu kendisi seçer.
export const setAudioRoute = route => call('setRoute', { route }).catch(() => {});
export const requestNotifications = () => call('requestNotifications').catch(() => {});

let notifySeq = 4200;
export function notify(title, text) {
  if (isNative()) return call('notify', { id: ++notifySeq, title, text }).catch(() => {});
  // Web: tarayıcı bildirimi (izin verildiyse).
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body: text, icon: './icon.png' });
  } catch (e) {}
  return null;
}

// İlk seferde 'NEEDS_PERMISSION' ile reddedilir: Android "bu kaynaktan
// uygulama yükle" izin ekranını açar; kullanıcı izin verip tekrar dokunur.
export const installApk = url => call('installApk', { url });

export function openExternal(url) {
  if (isNative()) return call('openUrl', { url }).catch(() => {});
  window.location.href = url;
  return null;
}

// teamsync://join/<oda> ile açılma (uygulama kapalıyken ya da açıkken).
export async function onDeepLink(handler) {
  if (!isNative()) return;
  App.addListener('appUrlOpen', ({ url }) => handler(url));
  try {
    const launch = await App.getLaunchUrl();
    if (launch && launch.url) handler(launch.url);
  } catch (e) {}
}

export function appVersion() {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
}
