import React, { useState } from 'react';

export default function RoomLobby({ currentAccount, onJoinRoom }) {
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [actionType, setActionType] = useState(null); // 'create' or 'join'

  const handleAction = (e) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    
    // In a real app, this would query Supabase for the room and verify the password
    // For now, we simulate joining/creating the room
    const roomId = `room-${roomName.toLowerCase().replace(/\s+/g, '-')}`;
    
    onJoinRoom({
      id: roomId,
      name: roomName,
      isHost: actionType === 'create',
      password: roomPassword
    });
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '15px', marginBottom: '30px' }}>
          <button 
            style={{ ...tabBtnStyle, background: actionType === 'create' ? '#3b82f6' : 'rgba(255,255,255,0.05)', color: actionType === 'create' ? 'white' : '#94a3b8' }} 
            onClick={() => setActionType('create')}
          >
            🏠 Yeni Oda Kur
          </button>
          <button 
            style={{ ...tabBtnStyle, background: actionType === 'join' ? '#10b981' : 'rgba(255,255,255,0.05)', color: actionType === 'join' ? 'white' : '#94a3b8' }} 
            onClick={() => setActionType('join')}
          >
            🚪 Odaya Katıl
          </button>
        </div>

        {actionType && (
          <form onSubmit={handleAction} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={labelStyle}>Oda Adı veya ID'si</label>
              <input 
                type="text" 
                required
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Örn: gizli-karargah"
                style={inputStyle}
              />
            </div>
            
            <div>
              <label style={labelStyle}>Oda Şifresi (E2EE Anahtarı)</label>
              <input 
                type="password" 
                required
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>

            <button type="submit" style={{ ...primaryBtnStyle, background: actionType === 'create' ? '#3b82f6' : '#10b981' }}>
              {actionType === 'create' ? 'Odayı Başlat ve Korumaya Al' : 'Şifreli Odaya Katıl'}
            </button>
          </form>
        )}

        {!actionType && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '14px' }}>
            Lütfen yukarıdan bir işlem seçin. <br />
            <span style={{ fontSize: '12px', marginTop: '10px', display: 'block', color: '#475569' }}>
              (Tüm odalarınız ECDH uçtan uca şifreleme ile korunmaktadır)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Styles ---
const containerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: '20px',
  background: 'radial-gradient(circle at center, #1e293b, #0f172a)'
};

const cardStyle = {
  background: 'rgba(30, 41, 59, 0.7)',
  padding: '40px',
  borderRadius: '24px',
  width: '100%',
  maxWidth: '500px',
  boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.1)',
  backdropFilter: 'blur(10px)'
};

const tabBtnStyle = {
  flex: 1,
  padding: '15px',
  border: 'none',
  borderRadius: '12px',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  transition: 'all 0.3s ease',
};

const labelStyle = {
  display: 'block',
  color: '#94a3b8',
  fontSize: '13px',
  fontWeight: 'bold',
  marginBottom: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
};

const inputStyle = {
  width: '100%',
  padding: '15px',
  background: 'rgba(15, 23, 42, 0.6)',
  border: '1px solid #475569',
  color: 'white',
  borderRadius: '12px',
  fontSize: '16px',
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.2s'
};

const primaryBtnStyle = {
  width: '100%',
  padding: '16px',
  color: 'white',
  border: 'none',
  borderRadius: '12px',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  marginTop: '10px',
  transition: 'transform 0.2s, box-shadow 0.2s',
  boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
};
