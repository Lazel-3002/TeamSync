import React, { useEffect, useRef, useState } from 'react';
import { sendEncryptedSignal, signalEvents } from '../signaling.js';

export default function WebRTC({ currentUserId, targetUserId, isHandshakeComplete, isMicOn, isDeafened, isScreenSharing, onScreenShareStop, isRemoteControlActive }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [micStream, setMicStream] = useState(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const dataChannelRef = useRef(null);

  const sendRemoteInput = (type, data) => {
    if (isRemoteControlActive && dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify({
        type: 'remote-input',
        payload: { type, ...data }
      }));
    }
  };

  useEffect(() => {
    const handleSendChat = (e) => {
      if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
        dataChannelRef.current.send(JSON.stringify({
          type: 'chat',
          payload: e.detail
        }));
      }
    };
    const handleSendGame = (e) => {
      if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
        dataChannelRef.current.send(JSON.stringify({
          type: 'game',
          payload: e.detail
        }));
      }
    };
    
    window.addEventListener('send-webrtc-chat', handleSendChat);
    window.addEventListener('send-webrtc-game', handleSendGame);
    return () => {
      window.removeEventListener('send-webrtc-chat', handleSendChat);
      window.removeEventListener('send-webrtc-game', handleSendGame);
    };
  }, []);

  useEffect(() => {
    if (!isRemoteControlActive) return;

    const handleKeyDown = (e) => { e.preventDefault(); sendRemoteInput('keydown', { key: e.key }); };
    const handleKeyUp = (e) => { e.preventDefault(); sendRemoteInput('keyup', { key: e.key }); };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRemoteControlActive]);

  const handleMouseEvent = (e, type) => {
    if (!isRemoteControlActive || !remoteVideoRef.current) return;
    const rect = remoteVideoRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    // Bounds check
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    
    sendRemoteInput(type, { x, y, button: e.button });
  };
  useEffect(() => {
    let streamToStop;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      streamToStop = stream;
      setMicStream(stream);
    }).catch(err => console.error('Mikrofon alınamadı:', err));

    return () => {
      if (streamToStop) streamToStop.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Mikrofon durumunu güncelle (Ses/Sağır butonlarına tepki)
  useEffect(() => {
    if (micStream) {
      micStream.getAudioTracks().forEach(track => {
        track.enabled = isMicOn && !isDeafened;
      });
    }
  }, [isMicOn, isDeafened, micStream]);

  // Karşı taraf sağırlaştırma durumu
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = isDeafened;
    }
  }, [isDeafened, hasRemoteStream]);

  // Handshake tamamlanınca WebRTC bağlantısını başlat
  useEffect(() => {
    if (isHandshakeComplete && targetUserId) {
      initWebRTC();
    }
  }, [isHandshakeComplete, targetUserId]);

  const initWebRTC = async () => {
    console.log('🔗 WebRTC Bağlantısı Başlatılıyor...');
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:74.125.250.129:19302' }, // stun.l.google.com
        { urls: 'stun:162.159.207.0:3478' },   // stun.cloudflare.com
        { urls: 'turns:15.235.47.158:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:15.235.47.158:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:15.235.47.158:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:15.235.47.158:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:15.235.47.158:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
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
      setHasRemoteStream(true);
    };

    // Data Channel (Chat & Remote Control)
    const dc = pc.createDataChannel('data-channel');
    setupDataChannel(dc);
    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    setPeerConnection(pc);
  };

  const setupDataChannel = (dc) => {
    dataChannelRef.current = dc;
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'remote-input' && window.electronAPI) {
           window.electronAPI.sendRemoteInput(data.payload);
         } else if (data.type === 'chat') {
           const chatEvt = new CustomEvent('webrtc-chat', { detail: data.payload });
           window.dispatchEvent(chatEvt);
         } else if (data.type === 'game') {
           const gameEvt = new CustomEvent('webrtc-game', { detail: data.payload });
           window.dispatchEvent(gameEvt);
         }
      } catch (e) {}
    };
  };

  // Handle incoming signals securely using EventTarget to avoid React state batching drops
  useEffect(() => {
    if (!peerConnection) return;
    
    const handleSignal = async (e) => {
      const signal = e.detail;
      try {
        if (signal.type === 'offer') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await sendEncryptedSignal(targetUserId, { type: 'answer', sdp: answer });
        } else if (signal.type === 'answer') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'ice') {
          await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (err) {
        console.error('Sinyal işleme hatası:', err);
      }
    };
    
    signalEvents.addEventListener('signal', handleSignal);
    return () => {
      signalEvents.removeEventListener('signal', handleSignal);
    };
  }, [peerConnection, targetUserId]);

  async function createAndSendOffer() {
    if (!peerConnection) return;
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await sendEncryptedSignal(targetUserId, {
        type: 'offer',
        sdp: offer
      });
    } catch (e) {
      console.error("Offer gönderilemedi:", e);
    }
  }

  // PeerConnection hazır olduğunda veya micStream geldiğinde track'leri ekle
  useEffect(() => {
    if (peerConnection && micStream) {
      micStream.getTracks().forEach(track => {
        if (!peerConnection.getSenders().find(s => s.track === track)) {
          peerConnection.addTrack(track, micStream);
        }
      });
      
      const isInitiator = currentUserId.toLowerCase() > targetUserId.toLowerCase();
      if (isInitiator) {
        console.log("We are the WebRTC initiator. Creating and sending offer...");
        createAndSendOffer();
      }
    }
  }, [peerConnection, micStream, currentUserId, targetUserId]);

  // Ekran paylaşımı dinleyicisi
  useEffect(() => {
    if (isScreenSharing && !localStream) {
      startScreenShare();
    } else if (!isScreenSharing && localStream) {
      stopScreenShare();
    }
  }, [isScreenSharing]);

  // PeerConnection hazır olduğunda veya ekran paylaşıldığında track'leri ekle
  useEffect(() => {
    if (peerConnection && localStream) {
      localStream.getTracks().forEach(track => {
        if (!peerConnection.getSenders().find(s => s.track === track)) {
          peerConnection.addTrack(track, localStream);
        }
      });
      createAndSendOffer();
    }
  }, [peerConnection, localStream]);

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      
      stream.getVideoTracks()[0].onended = () => {
        if (onScreenShareStop) onScreenShareStop();
        stopScreenShare();
      };

      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (err) {
      console.error('Ekran paylaşımı hatası:', err);
      if (onScreenShareStop) onScreenShareStop();
    }
  };

  const stopScreenShare = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
        if (peerConnection) {
          const sender = peerConnection.getSenders().find(s => s.track === track);
          if (sender) peerConnection.removeTrack(sender);
        }
      });
      setLocalStream(null);
    }
  };

  if (!isScreenSharing && !hasRemoteStream) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: isScreenSharing ? 'row' : 'column', gap: '20px', padding: '20px', background: '#1e293b', borderRadius: '12px', alignItems: 'flex-start', justifyContent: 'center' }}>
      
      {isScreenSharing && (
        <div style={{ flex: 1, width: '100%' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#94a3b8' }}>Ekranınız (Paylaşılıyor)</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            style={{ width: '100%', borderRadius: '8px', background: '#000', display: 'block', border: '2px solid #10b981' }} 
          />
        </div>
      )}
      
      {hasRemoteStream && (
        <div style={{ flex: 1, width: '100%' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#94a3b8' }}>Karşı Taraf (Ekran)</h3>
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            style={{ width: '100%', borderRadius: '8px', background: '#000', display: 'block', cursor: isRemoteControlActive ? 'crosshair' : 'default' }}
            onMouseMove={(e) => handleMouseEvent(e, 'mousemove')}
            onMouseDown={(e) => handleMouseEvent(e, 'mousedown')}
            onMouseUp={(e) => handleMouseEvent(e, 'mouseup')}
            onClick={(e) => handleMouseEvent(e, 'click')}
            onWheel={(e) => {
              if (!isRemoteControlActive) return;
              sendRemoteInput('scroll', { deltaX: e.deltaX, deltaY: e.deltaY });
            }}
          />
        </div>
      )}
      
    </div>
  );
}
