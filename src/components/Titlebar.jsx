import React from 'react';

export default function Titlebar() {
  const handleMin = () => window.electronAPI && window.electronAPI.windowMin();
  const handleMax = () => window.electronAPI && window.electronAPI.windowMax();
  const handleClose = () => window.electronAPI && window.electronAPI.windowClose();
  const handleForceQuit = () => window.electronAPI && window.electronAPI.appQuitForce();

  return (
    <div style={{
      height: '35px',
      background: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      WebkitAppRegion: 'drag',
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      position: 'fixed',
      top: 0, left: 0, right: 0,
      zIndex: 999999
    }}>
      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px' }}>
        <div style={{ fontSize: '14px', marginRight: '8px' }}>🎙️</div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', letterSpacing: '0.5px' }}>TeamSync</div>
      </div>
      <div style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' }}>
        <button onClick={handleForceQuit} title="Görev Sonlandır" style={btnStyleRed}>
          <span style={{ fontFamily: 'serif', fontStyle: 'italic' }}>x<sup style={{ fontSize: '10px' }}>x</sup></span>
        </button>
        <button onClick={handleMin} title="Küçült" style={btnStyle}>&#x2014;</button>
        <button onClick={handleMax} title="Büyüt/Küçült" style={btnStyle}>&#x25A1;</button>
        <button onClick={handleClose} title="Kapat" style={btnStyleHoverRed}>&#x2715;</button>
      </div>
    </div>
  );
}

const btnStyle = {
  background: 'transparent', border: 'none', color: '#94a3b8', width: '46px', height: '100%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '14px'
};

const btnStyleHoverRed = {
  ...btnStyle, transition: '0.2s', ':hover': { background: '#ef4444', color: 'white' }
};

const btnStyleRed = {
  ...btnStyle, color: '#ef4444'
};
