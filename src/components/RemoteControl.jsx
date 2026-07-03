import React, { useState } from 'react';

export default function RemoteControl({ isHandshakeComplete, onRemoteControlGranted }) {
  const generateComplexPin = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$*!';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const [pin, setPin] = useState(generateComplexPin());
  const [enteredPin, setEnteredPin] = useState('');
  const [status, setStatus] = useState('idle'); // idle, waiting, connected

  const generateNewPin = () => {
    setPin(generateComplexPin());
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
    <div style={{ position: 'absolute', top: '15px', left: '15px', zIndex: 10, display: 'flex', alignItems: 'center', background: 'rgba(15, 23, 42, 0.85)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(5px)', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
      {!isHandshakeComplete ? (
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>🎮 Uzaktan Kontrol: Bekleniyor</span>
      ) : status === 'idle' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title="Tıklayarak yeni PIN üret" onClick={generateNewPin} style={{cursor: 'pointer'}}>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>🎮 PIN:</span>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#10b981', letterSpacing: '1px' }}>{pin}</span>
          </div>
          <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.2)' }}></div>
          <form onSubmit={verifyPin} style={{ display: 'flex', gap: '6px' }}>
            <input 
              type="text" 
              placeholder="PIN gir"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              style={{ width: '80px', padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', textAlign: 'center', fontSize: '11px', outline: 'none', letterSpacing: '1px' }}
              maxLength={8}
            />
            <button type="submit" style={{ background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', padding: '0 8px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
              Bağlan
            </button>
          </form>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
           <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 'bold' }}>🟢 Uzaktan Kontrol Aktif</span>
           <button onClick={() => setStatus('idle')} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '10px' }}>Bitir</button>
        </div>
      )}
    </div>
  );
}
