const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
if (!content.includes('id="generic-confirm-modal"')) {
  const html = `
    <div id="generic-confirm-modal" class="modal hidden" style="z-index: 10000; align-items: center; justify-content: center;">
      <div class="mcard" style="width: 400px; padding: 24px; text-align: center;">
        <h3 id="generic-confirm-title" style="margin-bottom: 15px;">⚠️ Onay</h3>
        <p id="generic-confirm-message" style="margin-bottom: 20px; color: #ccc;">Emin misiniz?</p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button id="generic-confirm-yes" class="btn-pri" style="flex: 1; background: #ef4444; border-color: #ef4444; color: white;">Evet</button>
          <button id="generic-confirm-no" class="btn-sec" style="flex: 1;">İptal</button>
        </div>
      </div>
    </div>
  `;
  const newContent = content.replace('</body>', html + '\n</body>');
  fs.writeFileSync('index.html', newContent, 'utf8');
  console.log('Added generic-confirm-modal to index.html');
} else {
  console.log('generic-confirm-modal already exists');
}
