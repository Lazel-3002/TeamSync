#!/usr/bin/env node
/*
 * Checks reviewable TeamSync locale catalogues. A translation may only be
 * released when every structured and legacy UI key has an explicit value.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const catalogDir = path.join(root, 'resources', 'localization', 'catalogs');

function evaluateBlock(startMarker, endMarker, replacement) {
  const start = renderer.indexOf(startMarker);
  const end = renderer.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Could not find ${startMarker}`);
  const sandbox = {};
  vm.runInNewContext(renderer.slice(start, end).replace(startMarker, replacement), sandbox);
  return sandbox;
}

const i18n = evaluateBlock('const I18N', 'const LEGACY_TEXT_EN', 'globalThis.I18N').I18N;
const legacy = evaluateBlock('const LEGACY_TEXT_EN', 'const LEGACY_TEXT_TR', 'globalThis.LEGACY_TEXT_EN').LEGACY_TEXT_EN;
const requiredStructured = Object.keys(i18n.en).sort();
const requiredLegacy = Object.keys(legacy).sort();
const EXPECTED_LOCALES = ['tr', 'en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'ar', 'kk', 'tk', 'mn', 'zh-CN', 'ja'];

if (process.argv.includes('--initialize')) {
  fs.mkdirSync(catalogDir, { recursive: true });
  for (const locale of EXPECTED_LOCALES) {
    const file = path.join(catalogDir, `${locale}.json`);
    if (fs.existsSync(file)) continue;
    const isTurkish = locale === 'tr';
    const isEnglish = locale === 'en';
    const structured = isTurkish ? i18n.tr : isEnglish ? i18n.en : Object.fromEntries(requiredStructured.map(key => [key, '']));
    const legacyTerms = isTurkish
      ? Object.fromEntries(requiredLegacy.map(key => [key, key]))
      : isEnglish ? legacy : Object.fromEntries(requiredLegacy.map(key => [key, '']));
    fs.writeFileSync(file, JSON.stringify({
      locale,
      status: isTurkish || isEnglish ? 'review-required' : 'draft',
      structured,
      legacy: legacyTerms
    }, null, 2) + '\n', 'utf8');
  }
}

if (process.argv.includes('--sync-existing')) {
  for (const locale of EXPECTED_LOCALES.filter(code => !['tr', 'en'].includes(code))) {
    const file = path.join(catalogDir, `${locale}.json`);
    const rendererLocale = locale === 'pt-BR' ? 'pt' : locale;
    if (!fs.existsSync(file) || !i18n[rendererLocale]) continue;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of requiredStructured) {
      if (i18n[rendererLocale][key] && i18n[rendererLocale][key] !== i18n.en[key]) catalog.structured[key] = i18n[rendererLocale][key];
    }
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  }
}

if (process.argv.includes('--sync-source')) {
  for (const locale of ['tr', 'en']) {
    const file = path.join(catalogDir, `${locale}.json`);
    if (!fs.existsSync(file)) continue;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(catalog.structured, i18n[locale]);
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  }
  for (const locale of EXPECTED_LOCALES.filter(code => !['tr', 'en'].includes(code))) {
    const file = path.join(catalogDir, `${locale}.json`);
    if (!fs.existsSync(file)) continue;
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of requiredStructured) if (!(key in catalog.structured)) catalog.structured[key] = '';
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  }
}

function missingKeys(required, actual) {
  return required.filter(key => typeof actual[key] !== 'string' || !actual[key].trim());
}

const files = fs.existsSync(catalogDir)
  ? fs.readdirSync(catalogDir).filter(file => file.endsWith('.json')).sort()
  : [];
const report = files.map(file => {
  const catalog = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
  const structured = catalog.structured || {};
  const legacyTerms = catalog.legacy || {};
  const structuredMissing = missingKeys(requiredStructured, structured);
  const legacyMissing = missingKeys(requiredLegacy, legacyTerms);
  return {
    locale: catalog.locale || path.basename(file, '.json'),
    status: catalog.status || 'draft',
    structured: { total: requiredStructured.length, translated: requiredStructured.length - structuredMissing.length, missing: structuredMissing },
    legacy: { total: requiredLegacy.length, translated: requiredLegacy.length - legacyMissing.length, missing: legacyMissing },
    complete: structuredMissing.length === 0 && legacyMissing.length === 0
  };
});

for (const locale of EXPECTED_LOCALES) {
  if (!report.some(entry => entry.locale === locale)) {
    report.push({ locale, status: 'missing-catalog', structured: { total: requiredStructured.length, translated: 0, missing: requiredStructured }, legacy: { total: requiredLegacy.length, translated: 0, missing: requiredLegacy }, complete: false });
  }
}

console.log(JSON.stringify({ required: { structured: requiredStructured.length, legacy: requiredLegacy.length }, locales: report }, null, 2));
if (report.some(locale => !locale.complete)) process.exitCode = 2;
