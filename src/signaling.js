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

/**
 * 1. Supabase kanalına bağlanır (Dinlemeye başlar)
 */
export const connectSignaling = async (userId) => {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('Supabase yok, Demo modunda çalışıyor.');
    return;
  }

  currentUserId = userId;
  await generateKeyPair();

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

/**
 * 2. Karşı tarafa ECDH Handshake (El sıkışma) teklifi gönderir.
 */
export const initiateHandshake = async (targetUserId) => {
  const supabase = getSupabase();
  if (!supabase) return;

  const myPubKey = await exportMyPublicKey();
  
  const targetChannel = supabase.channel(`user:${targetUserId}`);
  await targetChannel.send({
    type: 'broadcast',
    event: 'handshake',
    payload: {
      from: currentUserId,
      type: 'offer',
      publicKey: myPubKey
    }
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
    const supabase = getSupabase();
    const myPubKey = await exportMyPublicKey();
    
    const targetChannel = supabase.channel(`user:${data.from}`);
    await targetChannel.send({
      type: 'broadcast',
      event: 'handshake',
      payload: {
        from: currentUserId,
        type: 'answer',
        publicKey: myPubKey
      }
    });
    console.log(`🤝 ${data.from} kişisine Handshake cevabı dönüldü.`);
  }

  // Handshake tamamlandığı için UI tarafını bilgilendir
  if (onHandshakeComplete) onHandshakeComplete(data.from);
};

/**
 * 4. Gelen şifreli WebRTC sinyalini çözer.
 */
const handleIncomingSignal = async (encryptedBase64) => {
  try {
    const decryptedData = await decryptMessage(encryptedBase64);
    if (decryptedData && onWebRTCSignal) {
      onWebRTCSignal(decryptedData);
    }
  } catch (err) {
    console.error('Şifreli mesaj çözülemedi:', err);
  }
};

/**
 * 5. Karşı tarafa ŞİFRELİ sinyal gönderir. (Örn: WebRTC SDP veya ICE)
 */
export const sendEncryptedSignal = async (targetUserId, data) => {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const encryptedData = await encryptMessage(data);
    const targetChannel = supabase.channel(`user:${targetUserId}`);
    
    await targetChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: encryptedData,
    });
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
