import React, { useState, useEffect } from 'react';

export default function Chat({ currentUserId, targetUserId, isHandshakeComplete }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    const handleIncomingChat = (e) => {
      const payload = e.detail;
      setMessages(prev => [...prev, { id: Date.now(), text: payload.text, sender: 'peer' }]);
    };
    window.addEventListener('webrtc-chat', handleIncomingChat);
    return () => window.removeEventListener('webrtc-chat', handleIncomingChat);
  }, []);
  
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || !isHandshakeComplete) return;

    const newMsg = { id: Date.now(), text: input, sender: 'me' };
    setMessages(prev => [...prev, newMsg]);
    setInput('');

    // WebRTC DataChannel üzerinden gönderilmesi için event fırlat
    window.dispatchEvent(new CustomEvent('send-webrtc-chat', { detail: { type: 'chat', text: newMsg.text } }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '400px', background: '#0f172a', borderRadius: '12px', border: '1px solid #334155', marginTop: '20px' }}>
      {/* Header */}
      <div style={{ padding: '15px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '15px', color: '#f8fafc' }}>Şifreli Sohbet</h3>
        <span style={{ fontSize: '12px', color: isHandshakeComplete ? '#10b981' : '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isHandshakeComplete ? '#10b981' : '#ef4444' }}></span>
          {isHandshakeComplete ? 'E2EE Aktif' : 'Bağlantı Bekleniyor'}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '13px', marginTop: 'auto', marginBottom: 'auto' }}>
            Mesajlarınız uçtan uca şifrelenmektedir.
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ 
            alignSelf: msg.sender === 'me' ? 'flex-end' : 'flex-start',
            background: msg.sender === 'me' ? '#4f46e5' : '#334155',
            padding: '10px 14px',
            borderRadius: '16px',
            borderBottomRightRadius: msg.sender === 'me' ? '4px' : '16px',
            borderBottomLeftRadius: msg.sender === 'me' ? '16px' : '4px',
            maxWidth: '75%',
            fontSize: '14px',
            wordBreak: 'break-word'
          }}>
            {msg.text}
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} style={{ padding: '15px', borderTop: '1px solid #334155', display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!isHandshakeComplete}
          placeholder={isHandshakeComplete ? "Şifreli bir mesaj yazın..." : "Anahtar değişimi bekleniyor..."}
          style={{ flex: 1, padding: '12px 16px', background: '#1e293b', border: '1px solid #475569', borderRadius: '20px', color: 'white', outline: 'none' }}
        />
        <button 
          type="submit"
          disabled={!isHandshakeComplete || !input.trim()}
          style={{ 
            background: '#4f46e5', color: 'white', border: 'none', 
            borderRadius: '50%', width: '42px', height: '42px', 
            cursor: isHandshakeComplete && input.trim() ? 'pointer' : 'not-allowed',
            opacity: isHandshakeComplete && input.trim() ? 1 : 0.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          ➤
        </button>
      </form>
    </div>
  );
}
