#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const dir = path.join(root, 'resources', 'localization', 'catalogs');
const output = path.join(root, 'resources', 'localization', 'catalogs.bundle.js');
const catalogs = {};
for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  catalogs[catalog.locale] = { structured: catalog.structured, legacy: catalog.legacy };
}
fs.writeFileSync(output, `window.TeamSyncLocaleCatalogs = ${JSON.stringify(catalogs)};\n`, 'utf8');
console.log(`Built ${Object.keys(catalogs).length} runtime locale catalogs.`);
