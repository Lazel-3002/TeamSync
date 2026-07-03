import React, { useState } from 'react';

export default function RemoteControl({ isHandshakeComplete, onRemoteControlGranted }) {
  const [pin, setPin] = useState(Math.floor(1000 + Math.random() * 9000).toString());
  const [enteredPin, setEnteredPin] = useState('');
  const [status, setStatus] = useState('idle'); // idle, waiting, connected

  const generateNewPin = () => {
    setPin(Math.floor(1000 + Math.random() * 9000).toString());
  };

  const verifyPin = (e) => {
    e.preventDefault();
    if (enteredPin === pin) {
      setStatus('connected');
      if (onRemoteControlGranted) onRemoteControlGranted();
    } else {
      alert('Hatalı PIN!');
      setEnteredPin('');
    }
  };

  return (
    <div style={{ padding: '20px', background: '#1e293b', borderRadius: '12px', marginTop: '20px', border: '1px solid #475569' }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>🎮</span> Uzaktan Kontrol Güvenliği
      </h3>
      
      {!isHandshakeComplete ? (
        <div style={{ color: '#ef4444', fontSize: '13px' }}>
          Uzaktan kontrol için uçtan uca şifreli bağlantının kurulması bekleniyor...
        </div>
      ) : status === 'idle' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>SİZE BAĞLANMALARI İÇİN GEREKEN GÜVENLİK PİNİ:</div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', letterSpacing: '4px', color: '#10b981' }}>{pin}</div>
            <button onClick={generateNewPin} style={{ marginTop: '10px', background: 'transparent', color: '#38bdf8', border: 'none', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>
              Yeni PIN Üret
            </button>
          </div>
          
          <form onSubmit={verifyPin} style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              placeholder="Bağlanmak için PIN girin"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              style={{ flex: 1, padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '6px', textAlign: 'center', letterSpacing: '2px', fontSize: '16px' }}
              maxLength={4}
            />
            <button type="submit" style={{ background: '#4f46e5', color: 'white', border: 'none', borderRadius: '6px', padding: '0 20px', cursor: 'pointer', fontWeight: 'bold' }}>
              Onayla
            </button>
          </form>
        </div>
      ) : (
        <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ color: '#10b981', fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>Uzaktan Kontrol Aktif!</div>
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>Karşı taraf bilgisayarınızı kontrol ediyor.</div>
          <button onClick={() => setStatus('idle')} style={{ marginTop: '15px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer' }}>
            Bağlantıyı Kes
          </button>
        </div>
      )}
    </div>
  );
}
