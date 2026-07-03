/**
 * TeamSync Uçtan Uca Şifreleme (E2EE) Modülü
 * Web Crypto API kullanarak mesajları ve sinyalleri şifreler.
 */

// Anahtarları saklayacağımız bellek değişkenleri
let encryptionKey = null;

// AES-GCM kullanacağız (hızlı ve güvenli)
const ALGO = 'AES-GCM';

/**
 * 256-bit AES anahtarı oluşturur.
 */
export async function generateKey() {
  if (encryptionKey) return encryptionKey;
  
  // Şimdilik test amaçlı sabit veya kolay paylaşılan bir anahtar türetebiliriz
  // İleride RSA ile asimetrik anahtar değişimi eklenebilir.
  encryptionKey = await window.crypto.subtle.generateKey(
    { name: ALGO, length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  return encryptionKey;
}

/**
 * Verilen JSON nesnesini şifreler
 */
export async function encryptMessage(data, key) {
  if (!key) throw new Error('Şifreleme anahtarı bulunamadı!');
  
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(data));
  
  // AES-GCM için her mesajda farklı (unique) bir IV (Initialization Vector) gerekir
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: ALGO, iv: iv },
    key,
    encodedData
  );
  
  // ArrayBuffer'ı base64 string'e çevirip içine IV'yi de ekliyoruz
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  
  // iv ve şifreli mesajı birleştirip base64 formatında dönüyoruz
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv);
  combined.set(encryptedBytes, iv.length);
  
  return btoa(String.fromCharCode.apply(null, combined));
}

/**
 * Şifreli mesajı (base64 string) çözer ve JSON olarak döner
 */
export async function decryptMessage(encryptedBase64, key) {
  if (!key) throw new Error('Şifreleme anahtarı bulunamadı!');
  
  try {
    const combinedStr = atob(encryptedBase64);
    const combined = new Uint8Array(combinedStr.length);
    for (let i = 0; i < combinedStr.length; i++) {
      combined[i] = combinedStr.charCodeAt(i);
    }
    
    // İlk 12 byte IV
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);
    
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: ALGO, iv: iv },
      key,
      encryptedData
    );
    
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
  } catch (error) {
    console.error('Şifre çözme hatası:', error);
    return null;
  }
}

/**
 * İsteğe bağlı: Anahtarı dışa aktarır (string olarak)
 */
export async function exportKey(key) {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode.apply(null, new Uint8Array(exported)));
}

/**
 * İsteğe bağlı: Dışarıdan gelen anahtarı içeri aktarır
 */
export async function importKey(keyBase64) {
  const binaryDerString = atob(keyBase64);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  
  return await window.crypto.subtle.importKey(
    'raw',
    binaryDer,
    { name: ALGO, length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}
