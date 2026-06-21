function initWhiteboard() {
  const canvas = document.getElementById('wb-canvas');
  state.wbContext = canvas.getContext('2d');
  
  canvas.width = 1920;
  canvas.height = 1080;
  state.wbContext.fillStyle = '#ffffff';
  state.wbContext.fillRect(0,0,1920,1080);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.offsetX * (1920 / rect.width),
      y: e.offsetY * (1080 / rect.height)
    };
  }

  let startX = 0, startY = 0;
  let isDrawingShape = false;
  let tempCanvasData = null;
  const wbCard = document.getElementById('wb-card');
  
  canvas.addEventListener('mousedown', e => {
    if (focusedCard !== wbCard) return;
    state.drawing = true;
    const pos = getPos(e);
    startX = pos.x; startY = pos.y;
    const tool = document.getElementById('wb-tool').value;
    if (tool !== 'pen') {
      isDrawingShape = true;
      tempCanvasData = state.wbContext.getImageData(0,0,1920, 1080);
    }
  });
  
  canvas.addEventListener('mousemove', e => {
    if (!state.drawing) return;
    const pos = getPos(e);
    const tool = document.getElementById('wb-tool').value;
    const color = document.getElementById('wb-color').value;
    const size = document.getElementById('wb-size').value;
    
    if (tool === 'pen') {
      drawWb(tool, startX, startY, pos.x, pos.y, color, size);
      broadcast({ type: 'draw', tool, x0: startX/1920, y0: startY/1080, x1: pos.x/1920, y1: pos.y/1080, color, size });
      startX = pos.x; startY = pos.y;
    } else if (isDrawingShape) {
      state.wbContext.putImageData(tempCanvasData, 0, 0);
      drawWb(tool, startX, startY, pos.x, pos.y, color, size);
    }
  });
  
  window.addEventListener('mouseup', e => {
    if (state.drawing && isDrawingShape && e.target === canvas) {
      const pos = getPos(e);
      const tool = document.getElementById('wb-tool').value;
      const color = document.getElementById('wb-color').value;
      const size = document.getElementById('wb-size').value;
      
      if (tool === 'text') {
        const text = prompt('Yazılacak metin:');
        if (text) {
          drawWb('text', startX, startY, pos.x, pos.y, color, size, text);
          broadcast({ type: 'draw', tool: 'text', x0: startX/1920, y0: startY/1080, color, size, text });
        } else {
          state.wbContext.putImageData(tempCanvasData, 0, 0);
        }
      } else {
        broadcast({ type: 'draw', tool, x0: startX/1920, y0: startY/1080, x1: pos.x/1920, y1: pos.y/1080, color, size });
      }
    }
    state.drawing = false;
    isDrawingShape = false;
  });
  
  makeCardFocusable(wbCard);

  document.getElementById('wb-btn').addEventListener('click', () => {
    state.wbJoined = true;
    closeAllCards();
    wbCard.classList.toggle('hidden');
    makeCardFocusable(document.getElementById('wb-card'));
    if (!wbCard.classList.contains('hidden') && !focusedCard) toggleFocus(wbCard);
  });

  document.getElementById('wb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    if (focusedCard === wbCard) toggleFocus(wbCard);
    wbCard.classList.add('hidden');
    state.wbJoined = false;
  });
  
  document.getElementById('wb-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    state.wbContext.fillStyle = '#ffffff';
    state.wbContext.fillRect(0,0,1920,1080);
    broadcast({ type: 'wb-clear' });
  });
}

function drawWb(tool, x0, y0, x1, y1, color, size, text='') {
  const ctx = state.wbContext;
  if (!ctx) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 2;
  ctx.lineCap = 'round';
  
  if (tool === 'pen') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  } else if (tool === 'rect') {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.stroke();
  } else if (tool === 'circle') {
    ctx.ellipse(x0, y0, Math.abs(x1 - x0), Math.abs(y1 - y0), 0, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (tool === 'text') {
    ctx.font = `${size * 6}px Inter`;
    ctx.fillText(text, x0, y0);
  }
  ctx.closePath();
}
