import React, { useEffect, useRef, useState } from 'react';
import { sendEncryptedSignal, signalEvents } from '../signaling.js';

export default function WebRTC({ currentUserId, targetUserId, isHandshakeComplete, isMicOn, isDeafened, isScreenSharing, onScreenShareStop, isRemoteControlActive }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [micStream, setMicStream] = useState(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [isRemotePointerActive, setIsRemotePointerActive] = useState(false);
  const [remotePointer, setRemotePointer] = useState({ x: 0, y: 0, visible: false });
  const dataChannelRef = useRef(null);
  const remotePointerActiveRef = useRef(false);

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
    if (!isRemoteControlActive || !isRemotePointerActive) return;

    const handleKeyDown = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        remotePointerActiveRef.current = false;
        setIsRemotePointerActive(false);
        return;
      }
      if (!e.repeat) sendRemoteInput('keydown', { key: e.key });
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Escape') return;
      e.preventDefault();
      sendRemoteInput('keyup', { key: e.key });
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRemoteControlActive, isRemotePointerActive]);

  useEffect(() => {
    if (isRemoteControlActive) return;
    remotePointerActiveRef.current = false;
    setIsRemotePointerActive(false);
    setRemotePointer(pointer => ({ ...pointer, visible: false }));
  }, [isRemoteControlActive]);

  const getRemoteVideoPoint = (e) => {
    if (!remoteVideoRef.current) return null;
    const rect = remoteVideoRef.current.getBoundingClientRect();
    const sourceWidth = remoteVideoRef.current.videoWidth || rect.width;
    const sourceHeight = remoteVideoRef.current.videoHeight || rect.height;
    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + (rect.height - height) / 2;
    const localX = e.clientX - left;
    const localY = e.clientY - top;
    if (localX < 0 || localY < 0 || localX > width || localY > height) return null;
    return {
      x: localX / width,
      y: localY / height,
      overlayX: e.clientX - rect.left,
      overlayY: e.clientY - rect.top
    };
  };

  const handleRemoteMouseMove = (e) => {
    if (!isRemoteControlActive) return;
    const point = getRemoteVideoPoint(e);
    if (!point) {
      setRemotePointer(pointer => ({ ...pointer, visible: false }));
      return;
    }
    setRemotePointer({ x: point.overlayX, y: point.overlayY, visible: true });
    if (remotePointerActiveRef.current) sendRemoteInput('mousemove', { x: point.x, y: point.y });
  };

  const handleRemoteClick = (e) => {
    if (!isRemoteControlActive || remotePointerActiveRef.current || e.button !== 0) return;
    const point = getRemoteVideoPoint(e);
    if (!point) return;
    e.preventDefault();
    remotePointerActiveRef.current = true;
    setIsRemotePointerActive(true);
    sendRemoteInput('mousemove', { x: point.x, y: point.y });
  };

  const handleRemoteButton = (e, type) => {
    if (!isRemoteControlActive || !remotePointerActiveRef.current) return;
    const point = getRemoteVideoPoint(e);
    if (!point) return;
    e.preventDefault();
    sendRemoteInput(type, { x: point.x, y: point.y, button: e.button });
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
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '8px', background: '#000' }}>
            <video
              ref={remoteVideoRef}
              autoPlay
              style={{ width: '100%', borderRadius: '8px', background: '#000', display: 'block', objectFit: 'contain', cursor: isRemoteControlActive ? 'none' : 'default' }}
              onMouseMove={handleRemoteMouseMove}
              onMouseEnter={handleRemoteMouseMove}
              onMouseLeave={() => setRemotePointer(pointer => ({ ...pointer, visible: false }))}
              onMouseDown={(e) => handleRemoteButton(e, 'mousedown')}
              onMouseUp={(e) => handleRemoteButton(e, 'mouseup')}
              onClick={handleRemoteClick}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={(e) => {
                if (!isRemoteControlActive) return;
                e.preventDefault();
                if (remotePointerActiveRef.current) sendRemoteInput('scroll', { deltaX: e.deltaX, deltaY: e.deltaY });
              }}
            />
            {isRemoteControlActive && (
              <>
                <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 10px', borderRadius: '999px', background: 'rgba(5,8,14,.78)', border: `1px solid ${isRemotePointerActive ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.2)'}`, color: '#fff', fontSize: '11px', pointerEvents: 'none' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isRemotePointerActive ? '#fff' : '#64748b', boxShadow: isRemotePointerActive ? '0 0 7px #fff' : 'none' }} />
                  {isRemotePointerActive ? 'Kontrol sizde — ESC ile bırakın' : 'İzleme modu — kontrol için tıklayın'}
                </div>
                <svg viewBox="0 0 28 32" aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: '28px', height: '32px', opacity: remotePointer.visible ? 1 : 0, color: isRemotePointerActive ? '#fff' : '#080808', transform: `translate3d(${remotePointer.x - 3}px, ${remotePointer.y - 3}px, 0)`, pointerEvents: 'none', filter: isRemotePointerActive ? 'drop-shadow(0 1px 1px #000)' : 'drop-shadow(0 1px 1px #fff)' }}>
                  <path d="M3 2.5v24.2l6.2-6 4.6 9.1 4.1-2.1-4.5-8.8h8.7L3 2.5z" fill="currentColor" stroke={isRemotePointerActive ? '#050505' : '#f8fafc'} strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </div>
        </div>
      )}
      
    </div>
  );
}
