const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(__dirname, '..', '..', 'assets', 'pokemon', 'smeargle');
const sourcePath = path.join(outputDir, 'smeargle-green.gif');

// Smeargle'ın Showdown GIF'i tek bir global palette kullanıyor. Kuyruk ve
// sırtındaki boya, palette index 0'da; bu nedenle yalnızca bu rengi değiştirerek
// 40 animasyon karesinin tamamını ve şeffaflığı kayıpsız koruyabiliyoruz.
const variants = {
  green: [131, 167, 69],
  red: [205, 72, 65],
  blue: [70, 130, 180],
  yellow: [225, 178, 48],
  orange: [221, 126, 49],
  indigo: [87, 76, 170],
  teal: [49, 157, 150]
};

function assertSourceGif(buffer) {
  const signature = buffer.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF89a' && signature !== 'GIF87a') {
    throw new Error('Smeargle kaynağı geçerli bir GIF değil.');
  }

  const hasGlobalColorTable = (buffer[10] & 0x80) !== 0;
  if (!hasGlobalColorTable) {
    throw new Error('Smeargle GIF global renk paleti içermiyor.');
  }

  const sourcePaint = [...buffer.subarray(13, 16)];
  if (sourcePaint.join(',') !== variants.green.join(',')) {
    throw new Error(`Beklenmeyen kaynak boya rengi: ${sourcePaint.join(',')}`);
  }
}

function generate() {
  const source = fs.readFileSync(sourcePath);
  assertSourceGif(source);

  for (const [name, rgb] of Object.entries(variants)) {
    const output = Buffer.from(source);
    output[13] = rgb[0];
    output[14] = rgb[1];
    output[15] = rgb[2];
    fs.writeFileSync(path.join(outputDir, `smeargle-${name}.gif`), output);
  }

  console.log(`Smeargle: ${Object.keys(variants).length} animasyonlu renk varyantı oluşturuldu.`);
}

generate();
