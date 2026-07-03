import { getSupabase } from './supabaseClient.js';
import { 
  generateKeyPair, 
  exportMyPublicKey, 
  deriveSharedKey, 
  encryptMessage, 
  decryptMessage 
} from './crypto.js';

let activeChannel = null;
export let currentUserId = null;

// Gelen şifreli WebRTC sinyallerini dinleyeceğimiz callback
let onWebRTCSignal = null;
// Handshake tamamlandığında tetiklenecek callback
let onHandshakeComplete = null;

export const setSignalHandlers = (onSignal, onHandshake) => {
  onWebRTCSignal = onSignal;
  onHandshakeComplete = onHandshake;
};

const udpPeerMap = new Map();

/**
 * 1. Supabase kanalına bağlanır veya UDP modunu açar
 */
export const connectSignaling = async (userId) => {
  currentUserId = userId;
  await generateKeyPair();

  const supabase = getSupabase();
  if (!supabase) {
    console.warn('Supabase yok, Yerel Ağ (UDP) modunda çalışıyor.');
    if (window.electronAPI) {
      window.electronAPI.startDiscovery(userId, "Local User", "main");
      
      window.electronAPI.onPeerDiscovered((event, peer) => {
        if (peer.id && peer.ip) udpPeerMap.set(peer.id, peer.ip);
      });

      window.electronAPI.onUDPSignal(async (event, payload) => {
        if (payload.id && payload.ip) udpPeerMap.set(payload.id, payload.ip);
        if (payload.signal && payload.signal.event) {
          if (payload.signal.event === 'handshake') {
            await handleIncomingHandshake(payload.signal.data);
          } else if (payload.signal.event === 'signal') {
            await handleIncomingSignal(payload.signal.data);
          }
        }
      });
    }
    return;
  }

  activeChannel = supabase.channel(`user:${userId}`);

  activeChannel
    .on('broadcast', { event: 'handshake' }, async (payload) => {
      await handleIncomingHandshake(payload.payload);
    })
    .on('broadcast', { event: 'signal' }, async (payload) => {
      await handleIncomingSignal(payload.payload);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`📡 Sinyalizasyon dinleniyor (ID: ${userId})`);
      }
    });
};

const sendUdpOrSupabase = async (targetUserId, eventName, payload) => {
  const supabase = getSupabase();
  if (supabase && activeChannel) {
    const targetChannel = supabase.channel(`user:${targetUserId}`);
    await targetChannel.send({ type: 'broadcast', event: eventName, payload });
  } else if (window.electronAPI) {
    const ip = udpPeerMap.get(targetUserId);
    if (ip) {
      // Pack both event type and payload into the generic signal wrapper
      const udpPayload = { event: eventName, data: payload };
      window.electronAPI.sendUDPSignal(ip, udpPayload);
    } else {
      console.error('UDP: Hedef IP bulunamadı! Cihazlar aynı ağda mı?');
    }
  }
};

/**
 * 2. Karşı tarafa ECDH Handshake (El sıkışma) teklifi gönderir.
 */
export const initiateHandshake = async (targetUserId, userInfo) => {
  const myPubKey = await exportMyPublicKey();
  await sendUdpOrSupabase(targetUserId, 'handshake', {
    from: currentUserId,
    type: 'offer',
    publicKey: myPubKey,
    userInfo: userInfo || { name: 'Bilinmeyen Kullanıcı' }
  });
  console.log(`🤝 ${targetUserId} kişisine Handshake teklifi gönderildi.`);
};

/**
 * 3. Gelen Handshake mesajlarını yönetir.
 */
const handleIncomingHandshake = async (data) => {
  if (!data || !data.from || !data.publicKey) return;

  // Ortak anahtarı türet
  await deriveSharedKey(data.publicKey);
  console.log(`🔐 ${data.from} ile ECDH anahtarı türetildi.`);

  // Eğer bu bir 'offer' ise, biz de kendi public key'imizle 'answer' dönmeliyiz
  if (data.type === 'offer') {
    const myPubKey = await exportMyPublicKey();
    
    // Geçici çözüm: App.jsx global değişkenini okuyamayacağımız için 
    // şimdilik basit bir "Cevaplayan" bilgisi göndereceğiz veya App.jsx'den setSignalHandlers ile alabiliriz.
    // Ancak daha kolayı `currentUserId` göndermek.
    await sendUdpOrSupabase(data.from, 'handshake', {
      from: currentUserId,
      type: 'answer',
      publicKey: myPubKey,
      userInfo: window.__MY_USER_INFO || { name: 'Oda Sahibi' }
    });
    console.log(`🤝 ${data.from} kişisine Handshake cevabı dönüldü.`);
  }

  // Handshake tamamlandığı için UI tarafını bilgilendir
  if (onHandshakeComplete) onHandshakeComplete(data.from, data.userInfo);
};

export const signalEvents = new EventTarget();

/**
 * 4. Gelen şifreli WebRTC sinyalini çözer.
 */
const handleIncomingSignal = async (encryptedBase64) => {
  try {
    const decryptedData = await decryptMessage(encryptedBase64);
    if (decryptedData) {
      if (onWebRTCSignal) onWebRTCSignal(decryptedData);
      signalEvents.dispatchEvent(new CustomEvent('signal', { detail: decryptedData }));
    }
  } catch (err) {
    console.error('Şifreli mesaj çözülemedi:', err);
  }
};

/**
 * 5. Karşı tarafa ŞİFRELİ sinyal gönderir. (Örn: WebRTC SDP veya ICE)
 */
export const sendEncryptedSignal = async (targetUserId, data) => {
  try {
    const encryptedData = await encryptMessage(data);
    await sendUdpOrSupabase(targetUserId, 'signal', encryptedData);
  } catch (error) {
    console.error('Sinyal gönderim hatası:', error);
  }
};

export const disconnectSignaling = async () => {
  const supabase = getSupabase();
  if (supabase && activeChannel) {
    await supabase.removeChannel(activeChannel);
    activeChannel = null;
    currentUserId = null;
  }
};
