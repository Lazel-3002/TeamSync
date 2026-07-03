import React, { useState, useEffect } from 'react';
import { connectSignaling, initiateHandshake, setSignalHandlers, disconnectSignaling } from './signaling.js';
import { initSupabase } from './supabaseClient.js';
import WebRTC from './components/WebRTC.jsx';
import Chat from './components/Chat.jsx';
import RemoteControl from './components/RemoteControl.jsx';
import Titlebar from './components/Titlebar.jsx';
import ProfileSetup from './components/ProfileSetup.jsx';
import Sidebar from './components/Sidebar.jsx';
import RoomLobby from './components/RoomLobby.jsx';

function App() {
  const [currentAccount, setCurrentAccount] = useState(null);
  const [status, setStatus] = useState('Başlatılıyor...');
  const [myId, setMyId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isHandshakeComplete, setIsHandshakeComplete] = useState(false);

  useEffect(() => {
    async function setup() {
      setStatus('Supabase Bağlantısı Kuruluyor...');
      const supabase = await initSupabase();
      
      if (!supabase) {
        setStatus('Uyarı: Supabase bilgileri eksik, Demo Modu aktif.');
      }

      // Kendi rastgele ID'mizi oluştur
      const newMyId = Math.random().toString(36).substring(2, 8).toUpperCase();
      setMyId(newMyId);
      
      setStatus('Sinyalizasyon Ağına Bağlanılıyor...');
      await connectSignaling(newMyId);
      
      setStatus('Hazır. Bağlantı Bekleniyor.');
      setIsConnected(true);
    }
    
    setup();
    
    // Uygulama kapandığında bağlantıyı kes
    return () => {
      disconnectSignaling();
    };
  }, []);

  useEffect(() => {
    // Sinyalizasyon dinleyicilerini ayarla
    setSignalHandlers(
      (signalData) => {
        console.log('Şifreli sinyal alındı:', signalData.type);
        // İleride WebRTC ve Chat bileşenlerine bu verileri yönlendireceğiz
      },
      (peerId) => {
        console.log('Handshake tamamlandı! Peer:', peerId);
        setIsHandshakeComplete(true);
        if (!targetId) setTargetId(peerId);
      }
    );
  }, [targetId]);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!targetId.trim()) return;
    
    setStatus('Handshake teklifi gönderiliyor...');
    await initiateHandshake(targetId);
  };

  if (!currentAccount) {
    return (
      <>
        <Titlebar />
        <div style={{ paddingTop: '50px' }}>
          <ProfileSetup onComplete={(acc) => {
            setCurrentAccount(acc);
            setMyId(acc.id);
            // Optionally auto-connect signaling here
          }} />
        </div>
      </>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Titlebar />
      
      {/* Container below titlebar */}
      <div style={{ display: 'flex', width: '100%', marginTop: '35px' }}>
        
        {/* Left Sidebar */}
        <Sidebar currentAccount={currentAccount} onLogout={() => setCurrentAccount(null)} />

        {/* Main Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0f172a', padding: '20px', overflowY: 'auto' }}>
          
          {/* ROOM LOBBY / CONNECTION FORM */}
          {!isHandshakeComplete && isConnected && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <RoomLobby 
                currentAccount={currentAccount} 
                onJoinRoom={({ id, name, isHost, password }) => {
                  setTargetId(id);
                  handleConnect({ preventDefault: () => {} });
                }} 
              />
            </div>
          )}

          {/* MAIN CONTENT GRID */}
          {isConnected && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', height: '100%' }}>
              {/* Sol Sütun: WebRTC ve Uzaktan Kontrol */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <WebRTC 
                  currentUserId={myId} 
                  targetUserId={targetId} 
                  isHandshakeComplete={isHandshakeComplete} 
                />
                <RemoteControl 
                  isHandshakeComplete={isHandshakeComplete}
                  onRemoteControlGranted={() => console.log('Uzaktan kontrol erişimi verildi!')}
                />
              </div>

              {/* Sağ Sütun: Şifreli Mesajlaşma */}
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Chat 
                  currentUserId={myId} 
                  targetUserId={targetId} 
                  isHandshakeComplete={isHandshakeComplete} 
                />
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  );
}

export default App;
