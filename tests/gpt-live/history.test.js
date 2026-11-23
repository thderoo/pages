import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './helpers.js';
import {
  defaultSettings, createConversation, saveConversation, listConversations, getConversation,
  deleteConversation, clearConversations, setApiKey, getApiKey, saveSettings,
  createLiveState, applyServerEvent, finishConversation, API_KEY_KEY,
} from '../../site/gpt-live/live-core.js';

test('historique : créer, lister (récent d\'abord), lire, supprimer', () => {
  const st = fakeStorage();
  const a = createConversation(st, { settings: defaultSettings(), now: 1000, id: 'a' });
  createConversation(st, { settings: defaultSettings(), now: 3000, id: 'c' });
  createConversation(st, { settings: defaultSettings(), now: 2000, id: 'b' });
  assert.deepEqual(listConversations(st).map((c) => c.id), ['c', 'b', 'a']);
  assert.deepEqual(getConversation(st, 'a'), a);
  assert.equal(a.startedAt, 1000);
  assert.equal(a.endedAt, null);
  assert.deepEqual(a.messages, []);
  assert.equal(getConversation(st, 'zzz'), null);
  deleteConversation(st, 'b');
  assert.deepEqual(listConversations(st).map((c) => c.id), ['c', 'a']);
  clearConversations(st);
  assert.deepEqual(listConversations(st), []);
});

test('identifiants générés distincts, sauvegarde par id', () => {
  const st = fakeStorage();
  const a = createConversation(st, { settings: defaultSettings(), now: 5 });
  const b = createConversation(st, { settings: defaultSettings(), now: 5 });
  assert.notEqual(a.id, b.id);
  saveConversation(st, { ...a, endedAt: 9 });
  assert.equal(listConversations(st).length, 2);
  assert.equal(getConversation(st, a.id).endedAt, 9);
});

test('la clé API n\'est jamais écrite dans l\'historique ni les réglages', () => {
  const st = fakeStorage();
  setApiKey(st, 'sk-secret-123');
  const settings = { ...defaultSettings(), apiKey: 'sk-secret-123', api_key: 'sk-secret-123' };
  saveSettings(st, settings);
  const conv = createConversation(st, { settings, now: 1 });
  assert.ok(!('apiKey' in conv.settings) && !('api_key' in conv.settings));
  const state = applyServerEvent(createLiveState(conv), { type: 'session.input_transcript.delta', delta: 'x' }, 2);
  saveConversation(st, state.conversation);
  for (const [k, v] of Object.entries(st.dump())) {
    if (k === API_KEY_KEY) assert.equal(v, 'sk-secret-123');
    else assert.ok(!v.includes('sk-secret-123'), k);
  }
});

test('clé API : lire, écrire, effacer', () => {
  const st = fakeStorage();
  assert.equal(getApiKey(st), '');
  setApiKey(st, '  sk-1 ');
  assert.equal(getApiKey(st), 'sk-1');
  assert.deepEqual(Object.keys(st.dump()), [API_KEY_KEY]);
  setApiKey(st, '');
  assert.equal(getApiKey(st), '');
  assert.deepEqual(st.dump(), {});
});

const fresh = () => createLiveState({ id: 'x', startedAt: 0, endedAt: null, settings: defaultSettings(), messages: [] });
const you = (delta) => ({ type: 'session.input_transcript.delta', delta });
const them = (delta) => ({ type: 'session.output_transcript.delta', delta });

test('deltas d\'un locuteur regroupés en une bulle', () => {
  let s = fresh();
  s = applyServerEvent(s, you('All'), 1000);
  s = applyServerEvent(s, you('ô ?'), 1400);
  s = applyServerEvent(s, you(' Oui'), 2800);
  assert.deepEqual(s.conversation.messages, [{ speaker: 'you', text: 'Allô ? Oui', at: 1000 }]);
});

test('bulle fermée après 1,5 s sans delta de ce locuteur', () => {
  let s = fresh();
  s = applyServerEvent(s, them('Un'), 1000);
  s = applyServerEvent(s, them('Deux'), 2499);
  s = applyServerEvent(s, them('Trois'), 4000);
  assert.deepEqual(s.conversation.messages.map((m) => m.text), ['UnDeux', 'Trois']);
});

test('l\'autre locuteur qui reprend ferme la bulle courante', () => {
  let s = fresh();
  s = applyServerEvent(s, them('A'), 1000);
  s = applyServerEvent(s, you('B'), 1100);
  s = applyServerEvent(s, them('C'), 1200);
  assert.deepEqual(s.conversation.messages.map((m) => [m.speaker, m.text]), [['them', 'A'], ['you', 'B'], ['them', 'C']]);
});

test('deltas vides ou invalides ignorés, état d\'entrée non muté', () => {
  const s0 = fresh();
  const s1 = applyServerEvent(s0, you(''), 1);
  const s2 = applyServerEvent(s1, { type: 'inconnu' }, 2);
  assert.equal(s2, s0);
  const s3 = applyServerEvent(s0, you('x'), 3);
  assert.deepEqual(s0.conversation.messages, []);
  assert.equal(s3.conversation.messages.length, 1);
});

test('événements système', () => {
  let s = fresh();
  s = applyServerEvent(s, { type: 'session.started' }, 10);
  s = applyServerEvent(s, you('Salut'), 20);
  s = applyServerEvent(s, { type: 'session.paused' }, 30);
  s = applyServerEvent(s, { type: 'session.resumed' }, 40);
  s = applyServerEvent(s, you('Re'), 50);
  s = applyServerEvent(s, { type: 'error', error: { message: 'boum' } }, 60);
  s = applyServerEvent(s, { type: 'session.closed', reason: 'close_requested' }, 70);
  const m = s.conversation.messages;
  assert.deepEqual(m.map((x) => x.speaker), ['system', 'you', 'system', 'system', 'you', 'system', 'system']);
  assert.equal(m[4].text, 'Re'); // la veille a fermé la bulle précédente
  assert.match(m[5].text, /boum/);
  assert.match(m[6].text, /close_requested/);
  assert.equal(s.conversation.endedAt, 70);
});

test('finishConversation pose la fin une seule fois', () => {
  let s = applyServerEvent(fresh(), you('x'), 5);
  s = finishConversation(s, 100);
  assert.equal(s.conversation.endedAt, 100);
  assert.equal(finishConversation(s, 200).conversation.endedAt, 100);
  s = applyServerEvent(s, you('y'), 105);
  assert.equal(s.conversation.messages.length, 2);
});

test('output_audio.delta ferme la bulle you sans rien ajouter', () => {
  let s = applyServerEvent(fresh(), you('Je'), 1000);
  const audio = { type: 'session.output_audio.delta', delta: 'AAAA' };
  s = applyServerEvent(s, audio, 1100);
  assert.equal(s.conversation.messages.length, 1);
  assert.equal(s.open.you, null);
  assert.equal(applyServerEvent(s, audio, 1200), s); // idempotent
  s = applyServerEvent(s, you(' suite'), 1300);
  assert.deepEqual(s.conversation.messages.map((m) => m.text), ['Je', ' suite']);
  // sans bulle you ouverte : aucun effet, pas de bulle them
  const t = applyServerEvent(fresh(), audio, 5);
  assert.deepEqual(t.conversation.messages, []);
  // une bulle them ouverte n'est pas touchée
  let u = applyServerEvent(fresh(), them('Allô'), 10);
  u = applyServerEvent(u, audio, 20);
  u = applyServerEvent(u, them(' ?'), 30);
  assert.deepEqual(u.conversation.messages.map((m) => m.text), ['Allô ?']);
});
