import React, { useEffect, useRef } from 'react';
import WebRTC from './WebRTC';
import Chat from './Chat';
import RemoteControl from './RemoteControl';

function RoomLobby({ currentAccount, onLogout, myId, targetId, isHandshakeComplete, isHost }) {
  // SVG Icons
  const MicOnIcon = () => <svg className="icon icon-on" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>;
  const MicOffIcon = () => <svg className="icon icon-off" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>;
  
  const DeafOnIcon = () => <svg className="icon icon-on" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>;
  const DeafOffIcon = () => <svg className="icon icon-off" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>;
  
  const ScreenIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>;
  const WbIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>;
  const ActIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 3.86-8.86c.41-.53.96-.86 1.57-.96h3.4v3.4c-.1.61-.43 1.16-.96 1.57A22 22 0 0 1 12 15z"/></svg>;
  const RecIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>;
  const VolIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
  const ManualIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>;
  const SdpIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
  const FounderIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
  const SettingsIcon = () => <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

  // Simulate local user item in user list
  const userList = [
    { id: myId, name: currentAccount?.name || 'Sen', avatar: currentAccount?.avatarUrl, status: '9ms', isSelf: true }
  ];
  if (targetId && isHandshakeComplete) {
    userList.push({ id: targetId, name: 'Karşı Taraf', status: '25ms', isSelf: false });
  }

  return (
    <div id="app" className="app" style={{ display: 'flex' }}>
      
      {/* LEFT SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span id="room-title"># Oyun Odası <span style={{fontSize: '12px', marginLeft:'4px'}}>🔒</span></span>
          <span id="conn" className={`dot ${isHandshakeComplete ? 'on' : ''}`}></span>
          <button id="leave" className="leave" onClick={onLogout}>✕</button>
        </div>

        <div className="lbl">KULLANICILAR</div>
        <ul id="users" className="users">
          {userList.map((u, i) => (
            <li key={i} className="user-item">
              <div style={{ position: 'relative' }}>
                <img src={u.avatar || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjQ1IiByPSIyNSIgZmlsbD0iI2FhYSIvPjxwYXRoIGQ9Ik01MCwgNzAgQzIwLCA3MCAtMTAsIDEwMCAtMTAsIDEwMCBMMTEwLCAxMDAgQzExMCwgMTAwIDgwLCA3MCA1MCwgNzAgWiIgZmlsbD0iI2FhYSIvPjwvc3ZnPg=='} alt="Avatar" className="user-avatar" />
                {u.isSelf && <div className="user-avatar-indicator"></div>}
              </div>
              <div className="user-info">
                <span className="user-name">
                  {u.name}
                  {u.isSelf && <span style={{ color: '#aaa', fontWeight: 'normal', fontSize: '11px', marginLeft: '4px' }}>(sen)</span>}
                </span>
              </div>
              <div className="user-status" style={{ color: '#10b981' }}>{u.status}</div>
            </li>
          ))}
        </ul>

        <div className="lbl">SES TESTİ</div>
        <div className="vu">
          <div id="vu" className="vu-bar" style={{ width: '45%' }}></div>
        </div>
        <div className="vu-info">
          <span id="vu-text" style={{ color: 'white' }}>-20 dB</span>
          <select id="mic-select" defaultValue="default">
            <option value="default">Default - Microphone Array...</option>
          </select>
        </div>
        <div className="thresh-wrap" style={{ position: 'relative', margin: '12px 20px 4px' }}>
          <input type="range" id="mic-thresh" min="0" max="100" defaultValue="20" title="Ses İletim Eşiği" style={{ width: '100%', accentColor: 'var(--acc)', cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'rgba(255,255,255,0.5)', padding: '0 2px' }}>
            <span>0 (Hep Açık)</span>
            <span>Ses Eşiği</span>
            <span>100</span>
          </div>
        </div>

        <div className="lbl" style={{ marginTop: '20px' }}>SOHBET</div>
        <div className="chat" style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative', background: 'transparent' }}>
          {/* Replaced raw messages/form with Chat Component */}
          <Chat currentUserId={myId} targetUserId={targetId} isHandshakeComplete={isHandshakeComplete} />
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main" style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative' }}>
        
        {/* TOP BAR */}
        <div className="top-bar">
          <span style={{ fontSize: '12px', color: 'var(--txt-mut)', fontWeight: '600' }}>SUNUCU ID:</span>
          <span id="display-server-id" style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 'bold', letterSpacing: '1px', color: 'var(--acc-light)', userSelect: 'all', marginLeft: '8px' }}>
            {targetId || myId}
          </span>
          <button id="btn-copy-id" className="btn-sec btn-sm" style={{ padding: '4px 8px', fontSize: '12px', marginLeft: '4px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)' }} title="ID'yi Kopyala">📋</button>
          
          <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)', margin: '0 16px' }}></div>
          
          <button id="btn-show-server-dms" className="btn-pri btn-sm" style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '8px', background: '#8b5cf6', marginRight: '8px' }}>💬 Mesajlar</button>
          <button id="btn-show-server-invites" className="btn-pri btn-sm" style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '8px' }}>👥 Arkadaşlar / Davet Et</button>
        </div>

        {/* GRID AREA */}
        <div id="grid" className="grid" style={{ flex: 1, position: 'relative' }}>
           {!isHandshakeComplete ? (
             <div id="empty-state" className="empty">
               <h2>👋 Bağlantı Bekleniyor</h2>
               <p>Sunucu açıldı. Bağlantı bekleniyor...</p>
             </div>
           ) : (
             <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px' }}>
               <WebRTC currentUserId={myId} targetUserId={targetId} isHandshakeComplete={isHandshakeComplete} />
               <RemoteControl isHandshakeComplete={isHandshakeComplete} onRemoteControlGranted={() => {}} />
             </div>
           )}
        </div>

        {/* BOTTOM CONTROL BAR */}
        <div className="bar">
          <div className="bar-group">
            <button id="mic" className="btn" title="Mikrofon (M)">
              <MicOnIcon />
              <MicOffIcon />
              <span className="lbl">Ses</span>
            </button>
            <button id="deaf" className="btn" title="Sağırlaştır (D)">
              <DeafOnIcon />
              <DeafOffIcon />
              <span className="lbl">Sağır</span>
            </button>
          </div>

          <div className="bar-group center-group">
            <button id="share" className="btn" title="Ekran Paylaş (S)">
              <ScreenIcon />
              <span className="lbl">Ekran</span>
            </button>
            <button id="wb-btn" className="btn" title="Beyaz Tahta (W)">
              <WbIcon />
              <span className="lbl">Tahta</span>
            </button>
            <button id="act-btn" className="btn" title="Etkinlikler (E)">
              <ActIcon />
              <span className="lbl">Etkinlik</span>
            </button>
            <button id="rec" className="btn" title="Kayıt (R)">
              <RecIcon />
              <span className="lbl">Kayıt</span>
            </button>
          </div>

          <div className="bar-group">
            <div className="vol-wrap">
              <button id="vol" className="btn" title="Ses Seviyesi">
                <VolIcon />
                <span className="lbl">Düzey</span>
              </button>
            </div>
            <button id="addip" className="btn" title="Manuel IP Ekle">
              <ManualIcon />
              <span className="lbl">Manuel</span>
            </button>
            <button id="addsdp" className="btn" title="Çapraz Ağ (SDP)">
              <SdpIcon />
              <span className="lbl">Uzak Ağ</span>
            </button>
            {isHost && (
              <button id="founder-settings" className="btn" title="Kurucu Ayarları" style={{ color: '#ffd700' }}>
                <FounderIcon />
                <span className="lbl">Kurucu</span>
              </button>
            )}
            <button id="settings" className="btn" title="Ayarlar">
              <SettingsIcon />
              <span className="lbl">Ayar</span>
            </button>
          </div>
        </div>
      </main>

    </div>
  );
}

export default RoomLobby;
