import React, { useState } from 'react';

export default function Sidebar({ currentAccount, onLogout }) {
  const [friends, setFriends] = useState([]); // This will hold friend objects
  const [invites, setInvites] = useState([]); // This will hold incoming invites
  
  const handleCopyId = () => {
    navigator.clipboard.writeText(currentAccount.id);
    // You could add a small toast notification here
  };

  return (
    <div style={sidebarStyle}>
      {/* Top Profile Section */}
      <div style={profileSectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ position: 'relative' }}>
            <img src={currentAccount.avatar} alt="Profile" style={avatarStyle} />
            <div style={onlineDotStyle}></div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={usernameStyle}>{currentAccount.name}</div>
            <div style={idStyle} onClick={handleCopyId} title="ID'yi Kopyala">
              {currentAccount.id} 📋
            </div>
          </div>
        </div>
        <button onClick={onLogout} style={logoutBtnStyle}>🔄 Hesap Değiştir</button>
      </div>

      {/* Main Actions (Join / Create Room) */}
      <div style={actionSectionStyle}>
        <button style={btnJoinStyle}>
          <div style={{ fontSize: '20px', marginBottom: '5px' }}>🚪</div>
          Odaya Katıl
        </button>
        <button style={btnCreateStyle}>
          <div style={{ fontSize: '20px', marginBottom: '5px' }}>🏠</div>
          Oda Kur
        </button>
      </div>

      {/* Friends & Invites Header */}
      <div style={friendsHeaderStyle}>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase' }}>Arkadaşlar</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={iconBtnStyle} title="Davetler">
            📩 {invites.length > 0 && <span style={badgeStyle}>{invites.length}</span>}
          </button>
          <button style={iconBtnStyle} title="Arkadaş Ekle">➕</button>
        </div>
      </div>

      {/* Friends List */}
      <div style={friendsListStyle}>
        {friends.length === 0 ? (
          <div style={emptyTextStyle}>Henüz arkadaş eklemediniz.</div>
        ) : (
          friends.map(friend => (
            <div key={friend.id} style={friendItemStyle}>
              <div style={friendAvatarPlaceholder}>👤</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#f8fafc', fontSize: '14px', fontWeight: 'bold' }}>{friend.name}</div>
                <div style={{ color: '#10b981', fontSize: '11px' }}>Çevrimiçi</div>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* Network Status / Ping */}
      <div style={pingStatusStyle}>
        📶 Sinyalizasyon Ağı Aktif
      </div>
    </div>
  );
}

// --- Styles ---
const sidebarStyle = {
  width: '300px',
  background: '#1e293b',
  borderRight: '1px solid #334155',
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 35px)', // minus Titlebar height
  boxSizing: 'border-box'
};

const profileSectionStyle = {
  padding: '20px',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.8), rgba(30,41,59,0))',
  borderBottom: '1px solid rgba(255,255,255,0.05)'
};

const avatarStyle = {
  width: '50px',
  height: '50px',
  borderRadius: '50%',
  objectFit: 'cover',
  background: 'rgba(255,255,255,0.1)',
  border: '2px solid #38bdf8'
};

const onlineDotStyle = {
  position: 'absolute',
  bottom: 0,
  right: 0,
  width: '12px',
  height: '12px',
  background: '#10b981',
  borderRadius: '50%',
  border: '2px solid #1e293b'
};

const usernameStyle = {
  color: '#f8fafc',
  fontSize: '16px',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

const idStyle = {
  color: '#38bdf8',
  fontSize: '12px',
  fontFamily: 'monospace',
  cursor: 'pointer',
  marginTop: '4px'
};

const logoutBtnStyle = {
  width: '100%',
  marginTop: '15px',
  padding: '8px',
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.15)',
  color: '#94a3b8',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '12px',
  transition: '0.2s'
};

const actionSectionStyle = {
  display: 'flex',
  gap: '10px',
  padding: '20px',
  borderBottom: '1px solid rgba(255,255,255,0.05)'
};

const baseActionBtn = {
  flex: 1,
  padding: '15px 10px',
  borderRadius: '12px',
  border: 'none',
  color: 'white',
  fontWeight: 'bold',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  transition: 'transform 0.2s, box-shadow 0.2s'
};

const btnJoinStyle = {
  ...baseActionBtn,
  background: 'linear-gradient(135deg, #475569, #334155)',
  boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
};

const btnCreateStyle = {
  ...baseActionBtn,
  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)'
};

const friendsHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '15px 20px 5px',
};

const iconBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: '#94a3b8',
  fontSize: '16px',
  cursor: 'pointer',
  position: 'relative'
};

const badgeStyle = {
  position: 'absolute',
  top: '-5px',
  right: '-8px',
  background: '#ef4444',
  color: 'white',
  fontSize: '10px',
  padding: '2px 5px',
  borderRadius: '10px',
  fontWeight: 'bold'
};

const friendsListStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: '10px 20px'
};

const emptyTextStyle = {
  color: '#64748b',
  fontSize: '12px',
  textAlign: 'center',
  marginTop: '20px',
  fontStyle: 'italic'
};

const friendItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '10px',
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '8px',
  marginBottom: '8px',
  cursor: 'pointer',
  transition: '0.2s'
};

const friendAvatarPlaceholder = {
  width: '36px',
  height: '36px',
  borderRadius: '50%',
  background: '#334155',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '18px'
};

const pingStatusStyle = {
  padding: '10px 20px',
  fontSize: '11px',
  color: '#10b981',
  background: 'rgba(0,0,0,0.2)',
  textAlign: 'center',
  fontWeight: 'bold',
  letterSpacing: '0.5px'
};
