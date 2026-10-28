const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('scripts : aucun catalogue ne bloque le parsing ni ne précède l’initialisation du compte', () => {
  for (const file of ['index.html', 'netflix.html', 'prime-video.html', 'paramount.html', 'disney.html', 'marvel.html', 'compte.html', 'titre.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"([^>]*)>/g)];
    const catalogue = scripts.findIndex(match => match[1] === 'catalogue-data.js');
    const account = scripts.findIndex(match => match[1] === 'account.js');
    const firebase = scripts.findIndex(match => match[1] === 'firebase-auth.js');
    const loading = scripts.findIndex(match => match[1] === 'catalogue-loading.js');
    assert.ok(account >= 0 && firebase > account && catalogue > firebase && loading > firebase && loading < catalogue, file);
    assert.ok(scripts.every(match => /\bdefer\b/.test(match[2])), file + ' : tous les scripts classiques restent ordonnés et différés');
  }
});
