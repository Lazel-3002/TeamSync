import React, { useState, useEffect } from 'react';

function App() {
  const [status, setStatus] = useState('Yükleniyor...');

  useEffect(() => {
    setStatus('React Altyapısı Hazır!');
  }, []);

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h1>TeamSync Yeniden Doğuyor 🚀</h1>
      <p>{status}</p>
      <p style={{ color: '#aaa', fontSize: '12px' }}>Vite + React + Electron + Güvenlik Entegrasyonu Tamamlandı</p>
    </div>
  );
}

export default App;
