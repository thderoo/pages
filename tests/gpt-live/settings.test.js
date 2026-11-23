import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './helpers.js';
import {
  VOICES, MODEL, DELEGATION_MODEL_SUGGESTIONS, defaultSettings, normalizeSettings,
  loadSettings, saveSettings, addPreset, replacePreset, removePreset, applyPreset, SETTINGS_KEY,
} from '../../site/gpt-live/live-core.js';

test('défauts', () => {
  const s = defaultSettings();
  assert.ok(!('model' in s));
  assert.equal(MODEL, 'gpt-live-1.1');
  assert.equal(s.voice, 'Quartz');
  assert.equal(s.delegation.model, 'gpt-5.6-luna');
  assert.equal(s.delegation.instructions, '');
  assert.deepEqual(s.standby, { enabled: false, vadThreshold: null, idleTimeoutS: 30 });
  assert.deepEqual(normalizeSettings(undefined), s);
  assert.deepEqual(normalizeSettings(null), s);
  assert.deepEqual(normalizeSettings('x'), s);
  assert.deepEqual(DELEGATION_MODEL_SUGGESTIONS, ['gpt-6-luna', 'gpt-6-sol']);
});

test('21 voix distinctes dont Quartz, Beacon, Delta, Cinder', () => {
  assert.equal(VOICES.length, 21);
  assert.equal(new Set(VOICES).size, 21);
  for (const v of ['Quartz', 'Beacon', 'Delta', 'Cinder', 'Willow', 'Sillage', 'Noeul']) assert.ok(VOICES.includes(v));
});

test('valeurs invalides : défaut, sans exception', () => {
  const s = normalizeSettings({
    model: 'gpt-4', voice: 'Nope', instructions: 42,
    presets: 'x', delegation: { model: 7, instructions: null },
    standby: { enabled: 'yes', vadThreshold: 'abc', idleTimeoutS: 'abc' },
  });
  assert.deepEqual(s, defaultSettings());
});

test('valeurs valides conservées, voix insensible à la casse', () => {
  const s = normalizeSettings({
    voice: 'willow', instructions: 'Salut',
    delegation: { model: 'gpt-6-sol', instructions: 'Détail' },
    standby: { enabled: true, vadThreshold: 0.6, idleTimeoutS: 12 },
  });
  assert.ok(!('model' in s));
  assert.equal(s.voice, 'Willow');
  assert.equal(s.delegation.model, 'gpt-6-sol');
  assert.deepEqual(s.standby, { enabled: true, vadThreshold: 0.6, idleTimeoutS: 12 });
});

test('délai d\'inactivité : entier borné 5-60', () => {
  const t = (v) => normalizeSettings({ standby: { idleTimeoutS: v } }).standby.idleTimeoutS;
  assert.equal(t(5), 5);
  assert.equal(t(60), 60);
  assert.equal(t(1), 5);
  assert.equal(t(500), 60);
  assert.equal(t(20.4), 20);
  assert.equal(t('45'), 45);
  assert.equal(t(undefined), 30);
});

test('vad_threshold optionnel', () => {
  const t = (v) => normalizeSettings({ standby: { vadThreshold: v } }).standby.vadThreshold;
  assert.equal(t(undefined), null);
  assert.equal(t(0.5), 0.5);
  assert.equal(t(5), null);
});

test('persistance : aller-retour, storage vide ou corrompu', () => {
  const st = fakeStorage();
  assert.deepEqual(loadSettings(st), defaultSettings());
  const saved = saveSettings(st, { voice: 'Ripple', instructions: 'abc' });
  assert.deepEqual(loadSettings(st), saved);
  assert.equal(loadSettings(st).voice, 'Ripple');
  assert.deepEqual(loadSettings(fakeStorage({ [SETTINGS_KEY]: '{pas du json' })), defaultSettings());
  const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  assert.deepEqual(loadSettings(throwing), defaultSettings());
  assert.doesNotThrow(() => saveSettings(throwing, {}));
});

test('presets : ajouter, remplacer, supprimer, appliquer, persister', () => {
  const st = fakeStorage();
  let s = defaultSettings();
  s = addPreset(s, 'Pirate', 'Parle comme un pirate');
  s = addPreset(s, 'Poli', 'Sois poli');
  s = addPreset(s, 'Pirate', 'doublon ignoré');
  assert.deepEqual(s.presets, [{ name: 'Pirate', text: 'Parle comme un pirate' }, { name: 'Poli', text: 'Sois poli' }]);
  s = replacePreset(s, 'Pirate', 'Version 2');
  assert.equal(s.presets[0].text, 'Version 2');
  s = replacePreset(s, 'Pirate', 'Version 3', 'Corsaire');
  assert.equal(s.presets[0].name, 'Corsaire');
  assert.equal(replacePreset(s, 'Inconnu', 'x').presets.length, 2);
  s = applyPreset(s, 'Poli');
  assert.equal(s.instructions, 'Sois poli');
  assert.equal(applyPreset(s, 'Inconnu').instructions, 'Sois poli');
  saveSettings(st, s);
  assert.deepEqual(loadSettings(st).presets, s.presets);
  s = removePreset(s, 'Corsaire');
  assert.deepEqual(s.presets, [{ name: 'Poli', text: 'Sois poli' }]);
  assert.equal(addPreset(s, '  ', 'x').presets.length, 1);
});
