const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class YapayDenetleyici {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.problemsFile = path.join(app.getAppPath(), 'problemler.md');
    this.aiFile = path.join(app.getAppPath(), 'yapaydenetliyici.md');
    this.problems = new Map(); // hash -> { title, desc, lastSeen, count }
    this.loadProblems();
    this.saveProblems(); // Create initial file
    this.setupListeners();
    this.startPeriodicChecks();
  }

  loadProblems() {
    if (fs.existsSync(this.problemsFile)) {
      try {
        const content = fs.readFileSync(this.problemsFile, 'utf-8');
      } catch(e) {}
    }
  }

  saveProblems() {
    let content = '# Bulunan Problemler\n\nBu dosya Yapay Denetleyici tarafından otomatik oluşturulur.\n\n';
    if (this.problems.size === 0) {
      content += '🎉 Tebrikler! Şu an tespit edilen bir problem yok.\n';
    } else {
      for (const [hash, prob] of this.problems.entries()) {
        content += `## ${prob.title} (Son görülme: ${new Date(prob.lastSeen).toLocaleString()})\n`;
        content += `- **Sıklık:** ${prob.count} kez tetiklendi\n`;
        content += `- **Detay:** \n\`\`\`text\n${prob.desc}\n\`\`\`\n\n`;
      }
    }
    fs.writeFileSync(this.problemsFile, content, 'utf-8');
  }

  requestAiHelp(topic, details) {
    const time = new Date().toLocaleString();
    let content = '';
    if (fs.existsSync(this.aiFile)) {
      content = fs.readFileSync(this.aiFile, 'utf-8');
    } else {
      content = '# Antigravity Asistanına Talepler\n\nBu dosya, yerel denetleyicinin kendi kendine çözemediği ve internet/kodlama desteğine ihtiyaç duyduğu konularda Ana Yapay Zeka\'ya bıraktığı notları içerir.\n\n';
    }
    
    // Prevent duplicate spam
    if (!content.includes(topic)) {
      content += `## ⚠️ Yardım Talebi: ${topic} (${time})\n`;
      content += `${details}\n\n`;
      fs.writeFileSync(this.aiFile, content, 'utf-8');
    }
  }

  logProblem(title, desc, severity = 'low') {
    const hash = Buffer.from(title).toString('base64').substring(0, 16);
    if (this.problems.has(hash)) {
      const p = this.problems.get(hash);
      p.lastSeen = Date.now();
      p.count += 1;
    } else {
      this.problems.set(hash, { title, desc, lastSeen: Date.now(), count: 1 });
    }
    this.saveProblems();

    // If it's a severe crash or specific error, ask for AI help
    if (severity === 'high' || desc.includes('TypeError') || desc.includes('ERR_')) {
      this.requestAiHelp(title, `Şu hata yakalandı ve nedenini bilmiyorum. Lütfen kodu analiz et ve bana izin vererek düzelt:\n\n${desc}`);
    }
  }

  setupListeners() {
    this.mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      // level 3 is error
      if (level >= 3) {
        if (message.includes('chrome-extension://') || message.includes('Autoplay is only allowed') || message.includes('ERR_ABORTED (-3)')) return;
        this.logProblem('Arayüz (Renderer) Hatası', `Dosya: ${sourceId}:${line}\nHata: ${message}`, 'high');
      }
    });

    this.mainWindow.webContents.on('render-process-gone', (event, details) => {
      this.logProblem('Çökme (Render Process Gone)', `Sebep: ${details.reason}, Çıkış Kodu: ${details.exitCode}`, 'high');
    });

    process.on('uncaughtException', (err) => {
      this.logProblem('Kritik Sistem Hatası (Uncaught Exception)', err.stack || err.message, 'high');
    });

    process.on('unhandledRejection', (reason) => {
      this.logProblem('Beklenmeyen Promise Hatası (Unhandled Rejection)', String(reason), 'high');
    });
  }

  startPeriodicChecks() {
    // Check every 5 minutes
    setInterval(async () => {
      if (this.mainWindow.isDestroyed()) return;
      
      let changed = false;
      const now = Date.now();
      for (const [hash, prob] of this.problems.entries()) {
        if (now - prob.lastSeen > 60 * 60 * 1000) { // 1 hour timeout
          this.problems.delete(hash);
          changed = true;
        }
      }
      if (changed) this.saveProblems();

      try {
        const healthReport = await this.mainWindow.webContents.executeJavaScript(`
          (() => {
            const report = { healthy: true, issues: [] };
            if (document.querySelectorAll('*').length > 10000) {
              report.healthy = false;
              report.issues.push("DOM elemanı sayısı çok yüksek (>10000). Muhtemel bellek sızıntısı.");
            }
            return report;
          })();
        `);

        if (!healthReport.healthy) {
          healthReport.issues.forEach(issue => {
            this.logProblem('Otonom Test Uyarısı', issue, 'medium');
          });
        }
      } catch (err) {}
    }, 5 * 60 * 1000); // 5 minutes
  }
}

module.exports = (mainWindow) => {
  return new YapayDenetleyici(mainWindow);
};
