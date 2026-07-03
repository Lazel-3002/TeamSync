/**
 * TeamSync Uçtan Uca Şifreleme (E2EE) Modülü
 * Askeri Düzey Elliptic Curve Diffie-Hellman (ECDH) ve AES-GCM entegrasyonu.
 */

const CURVE_NAME = 'P-256';
const ALGO_AES = 'AES-GCM';

// Cihazımızda tutacağımız anahtarlar (Asla internete gönderilmez)
let myKeyPair = null;

// Karşı tarafın gönderdiği public key ile oluşturulan ortak (shared) şifreleme anahtarı
let sharedAesKey = null;

/**
 * 1. ADIM: Kendi Public (Genel) ve Private (Gizli) anahtar çiftimizi üretir.
 * Bu işlem uygulama açıldığında bir kez yapılır.
 */
export async function generateKeyPair() {
  if (myKeyPair) return myKeyPair;
  
  myKeyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE_NAME },
    true,
    ['deriveKey', 'deriveBits']
  );
  return myKeyPair;
}

/**
 * 2. ADIM: Karşı tarafa (Supabase üzerinden) göndermek için 
 * Public (Genel) anahtarımızı base64 formatına çevirir.
 */
export async function exportMyPublicKey() {
  if (!myKeyPair) await generateKeyPair();
  
  const exported = await window.crypto.subtle.exportKey('raw', myKeyPair.publicKey);
  const exportedBytes = new Uint8Array(exported);
  return btoa(String.fromCharCode.apply(null, exportedBytes));
}

/**
 * 3. ADIM: Karşı tarafın (Supabase üzerinden gelen) base64 formatındaki 
 * Public anahtarını içeri aktarır.
 */
export async function importPeerPublicKey(base64Key) {
  const binaryDerString = atob(base64Key);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  
  return await window.crypto.subtle.importKey(
    'raw',
    binaryDer,
    { name: 'ECDH', namedCurve: CURVE_NAME },
    true,
    []
  );
}

/**
 * 4. ADIM: Kendi GİZLİ anahtarımız ile Karşı Tarafın GENEL anahtarını birleştirerek
 * eşsiz ve tek kullanımlık bir AES-256 şifreleme anahtarı (Shared Secret) türetir.
 * 
 * Bu sayede internette hiçbir şifre iletilmez, matematiksel olarak 
 * iki bilgisayar aynı şifreyi kendi içlerinde bulur!
 */
export async function deriveSharedKey(peerPublicKeyBase64) {
  if (!myKeyPair) await generateKeyPair();
  
  const peerPublicKey = await importPeerPublicKey(peerPublicKeyBase64);
  
  sharedAesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: peerPublicKey
    },
    myKeyPair.privateKey,
    {
      name: ALGO_AES,
      length: 256
    },
    false, // Türetilen anahtar dışarı çıkartılamaz (GÜVENLİK!)
    ['encrypt', 'decrypt']
  );
  
  console.log('🔐 ECDH Ortak Güvenlik Anahtarı (Shared Secret) Başarıyla Türetildi!');
  return sharedAesKey;
}

/**
 * 5. ADIM: Türetilen ortak AES anahtarı ile JSON verilerini şifreler.
 */
export async function encryptMessage(data) {
  if (!sharedAesKey) throw new Error('Ortak güvenlik anahtarı (Shared Key) henüz oluşturulmadı! Önce el sıkışma (Handshake) yapılmalı.');
  
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(data));
  
  // Her şifreleme için benzersiz (unique) bir IV (Initialization Vector)
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: ALGO_AES, iv: iv },
    sharedAesKey,
    encodedData
  );
  
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  
  // IV ve şifreli veriyi tek pakette birleştir
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv);
  combined.set(encryptedBytes, iv.length);
  
  return btoa(String.fromCharCode.apply(null, combined));
}

/**
 * 6. ADIM: Şifrelenmiş veriyi ortak AES anahtarıyla çözer.
 */
export async function decryptMessage(encryptedBase64) {
  if (!sharedAesKey) throw new Error('Ortak güvenlik anahtarı (Shared Key) henüz oluşturulmadı!');
  
  try {
    const combinedStr = atob(encryptedBase64);
    const combined = new Uint8Array(combinedStr.length);
    for (let i = 0; i < combinedStr.length; i++) {
      combined[i] = combinedStr.charCodeAt(i);
    }
    
    // İlk 12 bayt her zaman IV'dir
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);
    
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: ALGO_AES, iv: iv },
      sharedAesKey,
      encryptedData
    );
    
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
  } catch (error) {
    console.error('❌ Şifre çözme hatası (Muhtemelen anahtarlar eşleşmedi):', error);
    return null;
  }
}
