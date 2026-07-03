import React, { useState } from 'react';

export default function Dashboard({ currentAccount, onLogout, onJoinRoom }) {
  const [friends, setFriends] = useState([]);
  const [invites, setInvites] = useState([]);
  const [activeTab, setActiveTab] = useState('menu'); // 'menu' | 'join' | 'create'

  const handleCopyId = () => {
    navigator.clipboard.writeText(currentAccount.id);
  };

  return (
    <div id="login" className="login-wrap">
      <div className="login-card expanded dm-open">
        <div className="menu-layout">
          
          {/* Sol Menü: Profil ve Eylemler */}
      <div className="menu-left">
        <div className="menu-profile-card">
          <div className="profile-avatar-wrapper" style={{ position: 'relative', cursor: 'pointer' }}>
            <img src={currentAccount.avatar} alt="Avatar" className="profile-avatar" style={{ objectFit: 'cover' }} />
          </div>
          <div className="profile-info">
            <div className="profile-name">
              <span className="menu-username">{currentAccount.name}</span>
            </div>
            <div className="profile-id-row">
              <span className="muted" style={{ fontSize: '11px' }}>ID: </span>
              <span className="menu-id-value">{currentAccount.id}</span>
              <button onClick={handleCopyId} className="icon-btn sm" title="ID'yi Kopyala">📋</button>
            </div>
            <button onClick={onLogout} className="btn-sec btn-sm" style={{ marginTop: '8px', fontSize: '11px', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', borderRadius: '6px', color: 'var(--txt-mut)', cursor: 'pointer' }}>
              🔄 Hesap Değiştir
            </button>
          </div>
        </div>

        <div className="menu-main-actions">
          <button onClick={() => setActiveTab('join')} className="action-card sec">
            <div className="ac-icon">🔗</div>
            <div className="ac-text">Sunucuya Katıl</div>
            <div className="ac-sub">Bir odaya giriş yap</div>
          </button>
          <button onClick={() => setActiveTab('create')} className="action-card pri">
            <div className="ac-icon">➕</div>
            <div className="ac-text">Sunucu Oluştur</div>
            <div className="ac-sub">Kendi odanı kur</div>
          </button>
        </div>
      </div>

      {/* Orta Menü: Arkadaşlar veya Oda Kurma/Katılma Formu */}
      <div className="menu-middle" style={{ display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'menu' && (
          <div className="menu-friends-section">
            <div className="menu-friends-header">
              <h3 className="menu-friends-title">👥 Arkadaşlar</h3>
              <div className="menu-friends-actions">
                <button className="icon-btn has-badge" title="Davetler">
                  📩 {invites.length > 0 && <span className="badge">{invites.length}</span>}
                </button>
                <button className="icon-btn" title="Arkadaş Ekle">➕</button>
              </div>
            </div>
            <ul className="menu-friends-list">
              {friends.length === 0 ? (
                <li className="muted menu-empty-friends">Henüz hiç arkadaşın yok.</li>
              ) : (
                friends.map(f => <li key={f.id}>{f.name}</li>)
              )}
            </ul>
          </div>
        )}

        {activeTab === 'join' && (
          <div style={{ padding: '20px' }}>
            <button onClick={() => setActiveTab('menu')} className="btn-sec btn-sm" style={{ marginBottom: '15px' }}>⬅ Geri</button>
            <h3 style={{ marginBottom: '15px', color: 'white' }}>🔗 Sunucuya Katıl</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label>Sunucu ID</label>
              <input type="text" placeholder="Örn: A7X9B2" id="join-id-input" />
              <label>Şifre <span className="muted">(opsiyonel)</span></label>
              <input type="password" placeholder="•••••" id="join-pass-input" />
              <button 
                onClick={() => onJoinRoom({ id: document.getElementById('join-id-input').value, isHost: false })}
                className="btn-pri" style={{ marginTop: '10px' }}>Katıl</button>
            </div>
          </div>
        )}

        {activeTab === 'create' && (
          <div style={{ padding: '20px' }}>
            <button onClick={() => setActiveTab('menu')} className="btn-sec btn-sm" style={{ marginBottom: '15px' }}>⬅ Geri</button>
            <h3 style={{ marginBottom: '15px', color: 'white' }}>➕ Sunucu Oluştur</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label>Sunucu Adı</label>
              <input type="text" placeholder="Örn: Oyun Odası" id="create-id-input" />
              <label>Şifre <span className="muted">(opsiyonel)</span></label>
              <input type="password" placeholder="•••••" id="create-pass-input" />
              <button 
                onClick={() => onJoinRoom({ id: document.getElementById('create-id-input').value, isHost: true })}
                className="btn-pri" style={{ marginTop: '10px' }}>Oluştur</button>
            </div>
          </div>
        )}

        {/* IP Bilgisi - Altta */}
        <div style={{ marginTop: 'auto', textAlign: 'center', padding: '10px' }}>
          <p className="hint" style={{ color: 'var(--ok)', margin: 0, fontSize: '11px' }}>🌐 İnternet üzerinden bağlantı aktif</p>
        </div>
      </div>

      {/* Sağ Menü: Sohbet */}
      <div className="menu-right">
        <div className="dm-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Şifreli Sohbet</span>
          </div>
        </div>
        <div className="dm-messages">
          <div className="muted" style={{ textAlign: 'center', marginTop: '50px' }}>Mesajlaşmaya başlamak için bir arkadaş seç.</div>
        </div>
        <div className="dm-input-area">
          <button title="Dosya Gönder" style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer' }}>📎</button>
          <input type="text" placeholder="Mesaj yaz..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', outline: 'none' }} />
          <button title="Gönder" style={{ background: 'var(--acc)', border: 'none', color: 'white', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>➤</button>
        </div>
      </div>

        </div>
      </div>
    </div>
  );
}
