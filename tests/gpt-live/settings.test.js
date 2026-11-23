import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './helpers.js';
import {
  VOICES, MODEL, DELEGATION_MODEL_SUGGESTIONS, defaultSettings, normalizeSettings,
  loadSettings, saveSettings, addPreset, replacePreset, removePreset, applyPreset, isPresetModified,
  DEFAULT_PRESET, SETTINGS_KEY,
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

test('preset par défaut « Neutre » : Quartz, consigne courte en français', () => {
  const s = defaultSettings();
  assert.deepEqual(s.presets, [DEFAULT_PRESET]);
  assert.equal(DEFAULT_PRESET.name, 'Neutre');
  assert.equal(DEFAULT_PRESET.voice, 'Quartz');
  assert.ok(DEFAULT_PRESET.text.length > 20 && DEFAULT_PRESET.text.length < 200);
  assert.equal(s.preset, 'Neutre');
  assert.equal(s.voice, 'Quartz');
  assert.equal(s.instructions, DEFAULT_PRESET.text);
  assert.equal(isPresetModified(s), false);
});

test('anciens presets sans voix : voix par défaut ; un preset devient {name, text, voice}', () => {
  const s = normalizeSettings({ presets: [{ name: 'Vieux', text: 'abc' }, { name: 'Neuf', text: 'd', voice: 'willow' }, { name: 'Faux', text: 'e', voice: 'Nope' }] });
  assert.deepEqual(s.presets, [
    { name: 'Vieux', text: 'abc', voice: 'Quartz' },
    { name: 'Neuf', text: 'd', voice: 'Willow' },
    { name: 'Faux', text: 'e', voice: 'Quartz' },
  ]);
  assert.equal(s.preset, '');
  const empty = normalizeSettings({ presets: [] });
  assert.deepEqual(empty.presets, []);
});

test('preset sélectionné : mémorisé, doit exister', () => {
  const st = fakeStorage();
  let s = addPreset(defaultSettings(), 'Prof', 'Sois patient', 'Willow');
  s = applyPreset(s, 'Prof');
  saveSettings(st, s);
  assert.equal(loadSettings(st).preset, 'Prof');
  assert.equal(normalizeSettings({ preset: 'Inconnu', presets: [{ name: 'A', text: 'x' }] }).preset, '');
});

test('presets : ajouter, remplacer, supprimer, appliquer (voix ET instructions), persister', () => {
  const st = fakeStorage();
  let s = { ...defaultSettings(), presets: [] };
  s = addPreset(s, 'Pirate', 'Parle comme un pirate', 'Vesper');
  s = addPreset(s, 'Poli', 'Sois poli');
  s = addPreset(s, 'Pirate', 'doublon ignoré', 'Ripple');
  assert.deepEqual(s.presets, [
    { name: 'Pirate', text: 'Parle comme un pirate', voice: 'Vesper' },
    { name: 'Poli', text: 'Sois poli', voice: 'Quartz' },
  ]);
  s = replacePreset(s, 'Pirate', 'Version 2');
  assert.equal(s.presets[0].text, 'Version 2');
  assert.equal(s.presets[0].voice, 'Vesper');
  s = replacePreset(s, 'Pirate', 'Version 3', undefined, 'Ripple');
  assert.equal(s.presets[0].voice, 'Ripple');
  s = replacePreset(s, 'Pirate', 'Version 3', 'Corsaire');
  assert.equal(s.presets[0].name, 'Corsaire');
  assert.equal(replacePreset(s, 'Inconnu', 'x').presets.length, 2);
  assert.equal(replacePreset(s, 'Corsaire', 'x', 'Poli').presets[0].name, 'Corsaire');
  s = applyPreset(s, 'Corsaire');
  assert.equal(s.preset, 'Corsaire');
  assert.equal(s.voice, 'Ripple');
  assert.equal(s.instructions, 'Version 3');
  s = replacePreset(s, 'Corsaire', 'Version 4', 'Pirate');
  assert.equal(s.preset, 'Pirate');
  assert.equal(applyPreset(s, 'Inconnu').preset, 'Pirate');
  s = applyPreset(s, 'Poli');
  assert.equal(s.voice, 'Quartz');
  assert.equal(s.instructions, 'Sois poli');
  saveSettings(st, s);
  assert.deepEqual(loadSettings(st).presets, s.presets);
  assert.equal(loadSettings(st).preset, 'Poli');
  s = removePreset(s, 'Pirate');
  assert.equal(s.preset, 'Poli');
  s = removePreset(s, 'Poli');
  assert.equal(s.preset, '');
  assert.deepEqual(s.presets, []);
  assert.equal(addPreset(s, '  ', 'x').presets.length, 0);
});

test('modifié, pas encore enregistré : voix ou instructions différentes du preset', () => {
  let s = applyPreset(addPreset(defaultSettings(), 'Prof', 'Patient', 'Willow'), 'Prof');
  assert.equal(isPresetModified(s), false);
  assert.equal(isPresetModified({ ...s, instructions: 'Autre' }), true);
  assert.equal(isPresetModified({ ...s, voice: 'Ripple' }), true);
  s = replacePreset({ ...s, instructions: 'Autre' }, 'Prof', 'Autre');
  assert.equal(isPresetModified(s), false);
  assert.equal(isPresetModified({ ...s, preset: '' }), false);
});
