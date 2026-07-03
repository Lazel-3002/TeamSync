import React, { useState, useEffect } from 'react';

export default function ProfileSetup({ onComplete }) {
  const [accounts, setAccounts] = useState([]);
  const [step, setStep] = useState('accounts'); // accounts, new-name, new-pokemon
  const [name, setName] = useState('');
  const [selectedBasePoke, setSelectedBasePoke] = useState(null);
  const [selectedEvoUrl, setSelectedEvoUrl] = useState('');
  
  const [pokemonFamilies, setPokemonFamilies] = useState([]);

  useEffect(() => {
    // Load accounts from electron IPC
    if (window.electronAPI) {
      window.electronAPI.loadAccounts().then(accs => setAccounts(accs || []));
    }
    // Load pokemon families from window (loaded via pokeData.js)
    if (window.POKEMON_FAMILIES) {
      // Shuffle 10 random base pokemons to show
      const shuffled = [...window.POKEMON_FAMILIES].sort(() => 0.5 - Math.random());
      setPokemonFamilies(shuffled.slice(0, 10));
    }
  }, []);

  const handleSelectAccount = (acc) => {
    onComplete(acc);
  };

  const handleDeleteAccount = async (e, id) => {
    e.stopPropagation();
    const newAccounts = accounts.filter(a => a.id !== id);
    setAccounts(newAccounts);
    if (window.electronAPI) await window.electronAPI.saveAccounts(newAccounts);
  };

  const handleSaveNewAccount = async () => {
    if (!name.trim() || !selectedEvoUrl) return;
    const newId = 'TS-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const newAcc = {
      id: newId,
      name: name.trim(),
      avatar: selectedEvoUrl,
      lastLogin: Date.now()
    };
    
    const newAccounts = [...accounts, newAcc];
    setAccounts(newAccounts);
    if (window.electronAPI) await window.electronAPI.saveAccounts(newAccounts);
    
    onComplete(newAcc);
  };

  if (step === 'accounts') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 20px', color: '#f8fafc', textAlign: 'center' }}>Hesap Seçin</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', marginBottom: '20px' }}>
            {accounts.length === 0 ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>Kayıtlı hesap bulunamadı.</div>
            ) : (
              accounts.map(acc => (
                <div key={acc.id} onClick={() => handleSelectAccount(acc)} style={accountItemStyle}>
                  <img src={acc.avatar} alt="avatar" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', color: '#f8fafc' }}>{acc.name}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>ID: {acc.id}</div>
                  </div>
                  <button onClick={(e) => handleDeleteAccount(e, acc.id)} style={deleteBtnStyle}>✕</button>
                </div>
              ))
            )}
          </div>
          
          <button onClick={() => setStep('new-name')} style={primaryBtnStyle}>+ Yeni Hesap Oluştur</button>
        </div>
      </div>
    );
  }

  if (step === 'new-name') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 20px', color: '#f8fafc', textAlign: 'center' }}>Adınızı Girin</h2>
          <input 
            type="text" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="Örn: Ayşe" 
            maxLength={20}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button onClick={() => setStep('accounts')} style={secondaryBtnStyle}>İptal</button>
            <button onClick={() => { if(name.trim()) setStep('new-pokemon') }} style={{...primaryBtnStyle, opacity: name.trim() ? 1 : 0.5}}>İleri</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'new-pokemon') {
    return (
      <div style={containerStyle}>
        {!selectedBasePoke ? (
          <div style={{ ...cardStyle, maxWidth: '800px', width: '90%' }}>
            <h2 style={{ margin: '0 0 20px', color: '#f8fafc', textAlign: 'center' }}>Başlangıç Pokémonunuzu Seçin</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '15px' }}>
              {pokemonFamilies.map(fam => (
                <div key={fam.baseName} onClick={() => setSelectedBasePoke(fam)} style={pokeBaseCardStyle}>
                  <img src={fam.evolutions[0].url} alt={fam.baseName} style={{ width: '60px', height: '60px', objectFit: 'contain' }} />
                  <div style={{ fontWeight: 'bold', color: 'white', marginTop: '10px', fontSize: '14px' }}>{fam.displayName}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep('new-name')} style={{...secondaryBtnStyle, marginTop: '20px'}}>Geri</button>
          </div>
        ) : (
          <div style={{ ...cardStyle, maxWidth: '800px', width: '90%' }}>
            <h2 style={{ margin: '0 0 20px', color: '#f8fafc', textAlign: 'center' }}>{selectedBasePoke.displayName} - Evrim Seçimi</h2>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
              {selectedBasePoke.evolutions.map(evo => (
                <div key={evo.name} onClick={() => setSelectedEvoUrl(evo.url)} style={{ ...pokeEvoCardStyle, borderColor: selectedEvoUrl === evo.url ? '#10b981' : 'rgba(255,255,255,0.2)' }}>
                  <img src={evo.url} alt={evo.name} style={{ width: '100px', height: '100px', objectFit: 'contain' }} />
                  <div style={{ fontWeight: 'bold', color: '#fbbf24', marginTop: '15px' }}>{evo.name}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '30px' }}>
              <button onClick={() => setSelectedBasePoke(null)} style={secondaryBtnStyle}>Geri</button>
              <button onClick={handleSaveNewAccount} disabled={!selectedEvoUrl} style={{...primaryBtnStyle, opacity: selectedEvoUrl ? 1 : 0.5}}>Bu Avatarla Başla</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// --- Styles ---
const containerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: '20px'
};

const cardStyle = {
  background: '#1e293b', padding: '30px', borderRadius: '16px', width: '100%', maxWidth: '400px', 
  boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid #334155'
};

const inputStyle = {
  width: '100%', padding: '12px 15px', background: '#0f172a', border: '1px solid #475569', 
  color: 'white', borderRadius: '8px', fontSize: '16px', boxSizing: 'border-box'
};

const accountItemStyle = {
  display: 'flex', alignItems: 'center', gap: '15px', padding: '12px', background: 'rgba(255,255,255,0.05)', 
  borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', border: '1px solid rgba(255,255,255,0.05)'
};

const deleteBtnStyle = {
  background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '5px'
};

const primaryBtnStyle = {
  width: '100%', padding: '12px', background: '#3b82f6', color: 'white', border: 'none', 
  borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s'
};

const secondaryBtnStyle = {
  width: '100%', padding: '12px', background: '#475569', color: 'white', border: 'none', 
  borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s'
};

const pokeBaseCardStyle = {
  background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(255,255,255,0.1)', borderRadius: '15px', 
  padding: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', transition: '0.3s'
};

const pokeEvoCardStyle = {
  background: 'rgba(255,255,255,0.05)', border: '3px solid rgba(255,255,255,0.2)', borderRadius: '20px', 
  padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', transition: '0.3s', width: '160px'
};
