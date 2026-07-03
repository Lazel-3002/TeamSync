import React, { useState, useEffect } from 'react';
import { connectSignaling, initiateHandshake, setSignalHandlers, disconnectSignaling } from './signaling.js';
import { initSupabase } from './supabaseClient.js';
import WebRTC from './components/WebRTC.jsx';
import Chat from './components/Chat.jsx';
import RemoteControl from './components/RemoteControl.jsx';

function App() {
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
        setStatus('Hata: Supabase bilgileri eksik!');
        return;
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

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '30px', color: '#f8fafc' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', padding: '20px', background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', background: 'linear-gradient(to right, #818cf8, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TeamSync V2
          </h1>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '5px' }}>{status}</div>
        </div>
        
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px 20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>SİZİN ID'NİZ:</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace', color: '#38bdf8' }}>{myId || '...'}</div>
        </div>
      </div>

      {/* CONNECTION FORM */}
      {!isHandshakeComplete && isConnected && (
        <form onSubmit={handleConnect} style={{ display: 'flex', gap: '15px', marginBottom: '30px', background: '#1e293b', padding: '20px', borderRadius: '12px' }}>
          <input 
            type="text" 
            placeholder="Bağlanılacak kişinin ID'si" 
            value={targetId}
            onChange={(e) => setTargetId(e.target.value.toUpperCase())}
            style={{ flex: 1, padding: '12px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '6px', fontSize: '16px', textTransform: 'uppercase' }}
          />
          <button type="submit" style={{ padding: '0 25px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)' }}>
            Bağlan (E2EE)
          </button>
        </form>
      )}

      {/* MAIN CONTENT GRID */}
      {isConnected && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          
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
          <div>
            <Chat 
              currentUserId={myId} 
              targetUserId={targetId} 
              isHandshakeComplete={isHandshakeComplete} 
            />
          </div>
        </div>
      )}
      
    </div>
  );
}

export default App;
