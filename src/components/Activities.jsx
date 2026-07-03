import React, { useState } from 'react';
import UnoGame from './UnoGame';

export default function Activities({ onClose, myId, targetId, isHost, connectedPeers, currentAccount }) {
  const [activeActivity, setActiveActivity] = useState(null);

  const activitiesList = [
    { id: 'browser', name: 'Ortak Tarayıcı', icon: '🌐', color: '#3b82f6' },
    { id: 'uno', name: 'UNO', icon: '🃏', color: '#ef4444' },
    { id: 'wheel', name: 'Şans Çarkı', icon: '🎡', color: '#f59e0b' },
    { id: 'coin', name: 'Yazı Tura', icon: '🪙', color: '#10b981' },
    { id: 'pokemon', name: 'Pokemon', icon: '🐉', color: '#ec4899' }
  ];

  const renderActivityContent = () => {
    switch (activeActivity) {
      case 'browser':
        return (
          <div style={{ width: '100%', height: '100%', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
            <iframe src="https://duckduckgo.com" style={{ width: '100%', height: '100%', border: 'none' }} title="Ortak Tarayıcı" />
          </div>
        );
      case 'uno':
        return <UnoGame myId={myId} targetId={targetId} isHost={isHost} connectedPeers={connectedPeers} currentAccount={currentAccount} />;
      case 'pokemon':
        return (
          <div style={{ width: '100%', height: '100%', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
            <iframe src="https://play.pokemonshowdown.com/" style={{ width: '100%', height: '100%', border: 'none' }} title="Pokemon" />
          </div>
        );
      case 'coin':
        return <CoinFlip />;
      case 'wheel':
        return <WheelOfFortune />;
      default:
        return null;
    }
  };

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
      background: 'rgba(15, 23, 42, 0.95)', zIndex: 100, 
      display: 'flex', flexDirection: 'column', padding: '20px', backdropFilter: 'blur(10px)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          {activeActivity ? (
            <>
              <button 
                onClick={() => setActiveActivity(null)} 
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '20px' }}
              >
                ←
              </button>
              {activitiesList.find(a => a.id === activeActivity)?.name}
            </>
          ) : (
            <>🎯 Etkinlikler</>
          )}
        </h2>
        <button 
          onClick={onClose} 
          style={{ background: 'rgba(239, 68, 68, 0.2)', border: 'none', color: '#ef4444', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {!activeActivity ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', width: '100%', maxWidth: '800px' }}>
            {activitiesList.map(act => (
              <div 
                key={act.id}
                onClick={() => setActiveActivity(act.id)}
                style={{ 
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', 
                  borderRadius: '16px', padding: '30px 20px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-5px)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              >
                <div style={{ fontSize: '48px', width: '80px', height: '80px', borderRadius: '50%', background: `${act.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: act.color }}>
                  {act.icon}
                </div>
                <span style={{ color: 'white', fontWeight: 'bold', fontSize: '18px' }}>{act.name}</span>
              </div>
            ))}
          </div>
        ) : (
          renderActivityContent()
        )}
      </div>
    </div>
  );
}

// === BOZUK PARA ATMA (Yazı Tura) ===
function CoinFlip() {
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState(null); // 'yazi' or 'tura'

  const flipCoin = () => {
    if (flipping) return;
    setFlipping(true);
    setResult(null);
    
    setTimeout(() => {
      const isYazi = Math.random() > 0.5;
      setResult(isYazi ? 'yazi' : 'tura');
      setFlipping(false);
    }, 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '40px' }}>
      <div style={{ 
        width: '150px', height: '150px', borderRadius: '50%', 
        background: 'linear-gradient(135deg, #fcd34d, #d97706)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '40px', fontWeight: 'bold', color: '#78350f',
        boxShadow: '0 10px 25px rgba(245, 158, 11, 0.5)',
        border: '8px solid #f59e0b',
        transition: 'transform 2s cubic-bezier(0.4, 2.0, 0.2, 1)',
        transform: flipping ? 'rotateY(1800deg) scale(1.2)' : 'rotateY(0deg) scale(1)',
        transformStyle: 'preserve-3d'
      }}>
        {flipping ? '❓' : (result === 'yazi' ? 'YAZI' : (result === 'tura' ? 'TURA' : '💰'))}
      </div>
      
      <button 
        onClick={flipCoin}
        disabled={flipping}
        style={{ 
          padding: '12px 30px', fontSize: '18px', fontWeight: 'bold', 
          background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: flipping ? 'not-allowed' : 'pointer',
          opacity: flipping ? 0.6 : 1
        }}
      >
        {flipping ? 'Atılıyor...' : 'Parayı At!'}
      </button>
      
      {result && !flipping && (
        <div style={{ color: '#fbbf24', fontSize: '24px', fontWeight: 'bold', animation: 'fadeIn 0.5s' }}>
          Sonuç: {result.toUpperCase()}!
        </div>
      )}
    </div>
  );
}

// === ŞANS ÇARKI ===
function WheelOfFortune() {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState(null);
  
  const segments = ['Kazan!', 'Pas', 'Tekrar At', 'Kaybettin', 'İpucu', 'Bonus'];
  const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    setWinner(null);
    
    // Rastgele dönüş sayısı ve ekstra açı
    const spins = 5 + Math.floor(Math.random() * 5); // 5-10 tam tur
    const extraAngle = Math.floor(Math.random() * 360);
    const totalRotation = rotation + (spins * 360) + extraAngle;
    
    setRotation(totalRotation);
    
    setTimeout(() => {
      // Hangi dilimin geldiğini hesapla
      const normalizedAngle = totalRotation % 360;
      // Çark saat yönünde dönüyor, ibre üstte (0 derece)
      // Segment başına düşen açı
      const anglePerSegment = 360 / segments.length;
      // Seçilen segment endeksi
      const index = Math.floor((360 - normalizedAngle) / anglePerSegment) % segments.length;
      
      setWinner(segments[index]);
      setSpinning(false);
    }, 4000); // CSS transition süresi ile aynı
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '30px' }}>
      <div style={{ position: 'relative', width: '300px', height: '300px' }}>
        {/* İbre */}
        <div style={{ 
          position: 'absolute', top: '-15px', left: '50%', transform: 'translateX(-50%)', 
          width: '0', height: '0', 
          borderLeft: '15px solid transparent', borderRight: '15px solid transparent', borderTop: '25px solid white',
          zIndex: 10 
        }}></div>
        
        {/* Çark Gövdesi */}
        <div style={{ 
          width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', position: 'relative',
          transition: 'transform 4s cubic-bezier(0.1, 0.8, 0.1, 1)', // Smooth yavaşlama efekti
          transform: `rotate(${rotation}deg)`,
          boxShadow: '0 0 20px rgba(0,0,0,0.5)',
          border: '5px solid white'
        }}>
          {segments.map((seg, i) => {
            const angle = i * (360 / segments.length);
            const skew = 90 - (360 / segments.length);
            return (
              <div key={i} style={{
                position: 'absolute', top: 0, right: 0, width: '50%', height: '50%',
                transformOrigin: '0% 100%',
                transform: `rotate(${angle}deg) skewY(-${skew}deg)`,
                background: colors[i],
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
              }}>
                <span style={{ 
                  transform: `skewY(${skew}deg) rotate(${360 / segments.length / 2}deg) translateY(-80px)`,
                  position: 'absolute', color: 'white', fontWeight: 'bold', fontSize: '14px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                }}>
                  {seg}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      
      <button 
        onClick={spin}
        disabled={spinning}
        style={{ 
          padding: '12px 40px', fontSize: '20px', fontWeight: 'bold', 
          background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '8px', cursor: spinning ? 'not-allowed' : 'pointer',
          opacity: spinning ? 0.6 : 1, boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4)'
        }}
      >
        {spinning ? 'Dönüyor...' : 'Çevir!'}
      </button>
      
      {winner && !spinning && (
        <div style={{ color: '#10b981', fontSize: '32px', fontWeight: 'bold', animation: 'fadeIn 0.5s' }}>
          {winner}!
        </div>
      )}
    </div>
  );
}
