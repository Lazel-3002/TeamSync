import React, { useState, useEffect } from 'react';
import { connectSignaling, initiateHandshake, setSignalHandlers, disconnectSignaling } from './signaling.js';
import { initSupabase } from './supabaseClient.js';
import WebRTC from './components/WebRTC.jsx';
import Chat from './components/Chat.jsx';
import RemoteControl from './components/RemoteControl.jsx';
import Titlebar from './components/Titlebar.jsx';
import ProfileSetup from './components/ProfileSetup.jsx';
import Dashboard from './components/Dashboard.jsx';
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

  const [incomingSignal, setIncomingSignal] = useState(null);
  const [connectedPeers, setConnectedPeers] = useState([]);

  useEffect(() => {
    // Sinyalizasyon dinleyicilerini ayarla
    setSignalHandlers(
      (signalData) => {
        console.log('Şifreli sinyal alındı:', signalData.type);
        setIncomingSignal(signalData);
      },
      (peerId, userInfo) => {
        console.log('Handshake tamamlandı! Peer:', peerId, userInfo);
        setIsHandshakeComplete(true);
        if (!targetId) setTargetId(peerId);
        
        setConnectedPeers(prev => {
          if (!prev.find(p => p.id === peerId)) {
            return [...prev, { id: peerId, name: userInfo?.name || 'Kullanıcı', avatar: userInfo?.avatar }];
          }
          return prev;
        });
      }
    );
  }, [targetId]);

  // Global değişkene koyarak signaling.js'in kolayca okumasını sağla
  useEffect(() => {
    window.__MY_USER_INFO = { name: currentAccount?.name, avatar: currentAccount?.avatarUrl };
  }, [currentAccount]);

  const handleConnect = async (e, passedId, isHost) => {
    if (e && e.preventDefault) e.preventDefault();
    const idToConnect = passedId || targetId;
    if (!idToConnect || !idToConnect.trim()) return;
    
    if (isHost) {
      // Create server: We just wait for incoming connections
      setStatus(`Sunucu Oluşturuldu: ${idToConnect}. Bağlantı bekleniyor...`);
      setIsHandshakeComplete(true);
    } else {
      // Join server: Initiate handshake
      setStatus(`Bağlanılıyor: ${idToConnect}...`);
      await initiateHandshake(idToConnect);
    }
  };

  if (!currentAccount) {
    return <ProfileSetup onComplete={setCurrentAccount} />;
  }

  return (
    <>
      <Titlebar />
      
      {!isHandshakeComplete && isConnected && (
        <Dashboard 
          currentAccount={currentAccount} 
          onLogout={() => setCurrentAccount(null)}
          onJoinRoom={({ id, isHost, password }) => {
            // Generate random ID if host and no ID provided
            const finalId = (isHost && (!id || !id.trim())) ? 
              "teamsync-" + Math.random().toString(36).substring(2, 8).toUpperCase() : 
              id;
            
            if (!finalId || !finalId.trim()) {
              alert("Lütfen geçerli bir Sunucu ID girin!");
              return;
            }
            
            setTargetId(finalId);
            handleConnect(null, finalId, isHost);
          }} 
        />
      )}


      {/* MAIN CONTENT GRID (Inside Room) */}
      {isConnected && isHandshakeComplete && (
        <RoomLobby 
          currentAccount={currentAccount}
          onLogout={() => {
            setIsHandshakeComplete(false);
            setTargetId('');
            setConnectedPeers([]);
          }}
          myId={myId}
          targetId={targetId}
          isHandshakeComplete={isHandshakeComplete}
          isHost={status.includes('Sunucu Oluşturuldu')}
          incomingSignal={incomingSignal}
          connectedPeers={connectedPeers}
        />
      )}
    </>
  );
}

export default App;
