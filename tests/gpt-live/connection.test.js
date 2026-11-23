import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, openLiveSession, LiveHttpError, LIVE_SESSIONS_URL } from '../../site/gpt-live/live-core.js';

function makeDoubles({ gather = 'complete', fetchImpl } = {}) {
  const log = { tracksStopped: 0, pcClosed: 0, dcClosed: 0, fetchCalls: [], addedTracks: 0 };
  const track = { stop() { log.tracksStopped += 1; } };
  const stream = { getTracks: () => [track] };
  const listeners = {};
  class FakePC {
    constructor() {
      this.iceGatheringState = gather;
      this.localDescription = null;
      log.pc = this;
    }
    addTrack() { log.addedTracks += 1; }
    createDataChannel(label) {
      log.label = label;
      const l = {};
      log.dc = { addEventListener: (t, f) => { l[t] = f; }, emit: (t, e) => l[t](e), close() { log.dcClosed += 1; } };
      return log.dc;
    }
    async createOffer() { return { type: 'offer', sdp: 'OFFER' }; }
    async setLocalDescription(o) { this.localDescription = { sdp: o.sdp }; }
    async setRemoteDescription(d) { log.remote = d; }
    addEventListener(t, f) { listeners[t] = f; }
    removeEventListener() {}
    close() { log.pcClosed += 1; }
  }
  const fetch = fetchImpl || (async (url, init) => {
    log.fetchCalls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ session: { id: 'live_1' }, transport: { sdp: 'ANSWER' } }), text: async () => '' };
  });
  const wrapped = async (url, init) => { log.fetchCalls.push({ url, init }); return fetch(url, init); };
  return { log, listeners, opts: { fetch: fetchImpl ? wrapped : fetch, RTCPeerConnection: FakePC, getUserMedia: async () => stream } };
}

test('connexion : corps, en-tête Authorization, réponse SDP, data channel', async () => {
  const d = makeDoubles();
  const events = [];
  const remote = [];
  const h = openLiveSession({ ...d.opts, apiKey: ' sk-test ', settings: { ...defaultSettings(), instructions: 'Hi' }, onEvent: (e) => events.push(e), onRemoteStream: (s) => remote.push(s) });
  const r = await h.ready;
  assert.equal(r.sessionId, 'live_1');
  assert.equal(h.sessionId, 'live_1');
  const call = d.log.fetchCalls[0];
  assert.equal(call.url, LIVE_SESSIONS_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(call.init.body);
  assert.equal(body.transport.sdp, 'OFFER');
  assert.equal(body.session.instructions, 'Hi');
  assert.equal(d.log.label, 'oai-events');
  assert.deepEqual(d.log.remote, { type: 'answer', sdp: 'ANSWER' });
  assert.equal(d.log.addedTracks, 1);
  d.log.dc.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  d.log.dc.emit('message', { data: 'pas du json' });
  assert.deepEqual(events, [{ type: 'session.started' }]);
  d.log.pc.ontrack({ streams: ['S'] });
  assert.deepEqual(remote, ['S']);
  h.close();
  h.close();
  assert.equal(d.log.tracksStopped, 1);
  assert.equal(d.log.pcClosed, 1);
  assert.equal(d.log.dcClosed, 1);
});

test('micro : le flux local est transmis au rappel onLocalStream', async () => {
  const d = makeDoubles();
  const local = [];
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings(), onLocalStream: (s) => local.push(s) });
  await h.ready;
  assert.equal(local.length, 1);
  assert.equal(typeof local[0].getTracks, 'function');
  h.close();
});

test('clé absente : refus sans appel réseau', async () => {
  const d = makeDoubles();
  const h = openLiveSession({ ...d.opts, apiKey: '  ', settings: defaultSettings() });
  await assert.rejects(h.ready, /Clé API manquante/);
  assert.equal(d.log.fetchCalls.length, 0);
});

test('erreur HTTP remontée avec son message, ressources libérées', async () => {
  const d = makeDoubles({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Incorrect API key' } }) }) });
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings() });
  await assert.rejects(h.ready, (e) => e instanceof LiveHttpError && e.status === 401 && /Incorrect API key/.test(e.message));
  assert.equal(d.log.tracksStopped, 1);
  assert.equal(d.log.pcClosed, 1);
});

test('erreur HTTP avec corps texte brut', async () => {
  const d = makeDoubles({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }) });
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings() });
  await assert.rejects(h.ready, (e) => e.status === 500 && /boom/.test(e.message));
});

test('fermeture pendant la signalisation', async () => {
  let release;
  const d = makeDoubles({ fetchImpl: () => new Promise((resolve) => { release = resolve; }) });
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings() });
  while (!release) await new Promise((r) => setImmediate(r));
  h.close();
  release({ ok: true, status: 201, json: async () => ({ session: { id: 'x' }, transport: { sdp: 'A' } }), text: async () => '' });
  await assert.rejects(h.ready, (e) => e.name === 'AbortError');
  assert.equal(d.log.remote, undefined);
  assert.equal(d.log.tracksStopped, 1);
  assert.equal(d.log.pcClosed, 1);
});

test('fermeture pendant l\'attente des candidats ICE', async () => {
  const d = makeDoubles({ gather: 'gathering' });
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings() });
  await new Promise((r) => setTimeout(r, 10));
  h.close();
  await assert.rejects(h.ready, (e) => e.name === 'AbortError');
  assert.equal(d.log.fetchCalls.length, 0);
  assert.equal(d.log.pcClosed, 1);
});

test('fermeture pendant l\'ouverture du micro : piste arrêtée', async () => {
  const d = makeDoubles();
  let stopped = 0;
  let release;
  const stream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings(), getUserMedia: () => new Promise((r) => { release = () => r(stream); }) });
  h.close();
  release();
  await assert.rejects(h.ready, (e) => e.name === 'AbortError');
  assert.equal(stopped, 1);
  assert.equal(d.log.pc, undefined);
});

test('ICE terminé après un changement d\'état', async () => {
  const d = makeDoubles({ gather: 'gathering' });
  const h = openLiveSession({ ...d.opts, apiKey: 'k', settings: defaultSettings() });
  await new Promise((r) => setTimeout(r, 10));
  d.log.pc.iceGatheringState = 'complete';
  d.listeners.icegatheringstatechange();
  assert.equal((await h.ready).sessionId, 'live_1');
});
