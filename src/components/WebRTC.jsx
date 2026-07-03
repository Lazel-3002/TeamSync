import React, { useEffect, useRef, useState } from 'react';
import { sendEncryptedSignal } from '../signaling.js';

export default function WebRTC({ currentUserId, targetUserId, isHandshakeComplete }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [peerConnection, setPeerConnection] = useState(null);

  useEffect(() => {
    if (isHandshakeComplete && targetUserId) {
      // Handshake tamamlandı, güvenli WebRTC bağlantısını kur
      initWebRTC();
    }
  }, [isHandshakeComplete, targetUserId]);

  const initWebRTC = async () => {
    console.log('🔗 WebRTC Bağlantısı Başlatılıyor (Şifreli Sinyal Ağı üzerinden)...');
    
    // ICE Sunucuları
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        // ICE adaylarını ŞİFRELİ olarak yolluyoruz
        await sendEncryptedSignal(targetUserId, {
          type: 'ice',
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    setPeerConnection(pc);
  };

  const startCall = async () => {
    if (!peerConnection) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Teklifi ŞİFRELİ yolluyoruz
      await sendEncryptedSignal(targetUserId, {
        type: 'offer',
        sdp: offer
      });
    } catch (err) {
      console.error('Kamera/Mikrofon erişim hatası:', err);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '20px', background: '#1e293b', borderRadius: '12px' }}>
      <div style={{ flex: 1 }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#94a3b8' }}>Sizin Kameranız</h3>
        <video 
          ref={localVideoRef} 
          autoPlay 
          muted 
          style={{ width: '100%', borderRadius: '8px', background: '#000' }} 
        />
        <button 
          onClick={startCall}
          disabled={!isHandshakeComplete}
          style={{ 
            marginTop: '10px', width: '100%', padding: '10px', 
            background: isHandshakeComplete ? '#4f46e5' : '#475569', 
            color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' 
          }}
        >
          {isHandshakeComplete ? '🔒 Şifreli Aramayı Başlat' : 'Bekleniyor...'}
        </button>
      </div>
      
      <div style={{ flex: 1 }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#94a3b8' }}>Karşı Taraf</h3>
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          style={{ width: '100%', borderRadius: '8px', background: '#000' }} 
        />
      </div>
    </div>
  );
}
