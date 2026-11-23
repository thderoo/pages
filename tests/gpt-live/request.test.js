import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, buildSignalingBody } from '../../site/gpt-live/live-core.js';

test('corps par défaut : forme vérifiée, sans veille', () => {
  const body = buildSignalingBody(defaultSettings(), 'SDP');
  assert.deepEqual(body, {
    session: {
      model: 'gpt-live-1.1',
      audio: { output: { voice: 'Quartz' } },
      delegation: { type: 'responses', responses: { model: 'gpt-5.6-luna' } },
    },
    transport: { type: 'webrtc', sdp: 'SDP' },
  });
  assert.ok(!('wake_policy' in body.session));
  assert.ok(!('idle_timeout_s' in body.session));
});

test('instructions de session reprises par la délégation si les siennes sont vides', () => {
  const body = buildSignalingBody({ ...defaultSettings(), instructions: 'Persona' }, 'S');
  assert.equal(body.session.instructions, 'Persona');
  assert.equal(body.session.delegation.responses.instructions, 'Persona');
});

test('instructions de délégation à part', () => {
  const s = { ...defaultSettings(), instructions: 'A', delegation: { model: 'gpt-6-luna', instructions: 'B' }, voice: 'Cinder', model: 'gpt-live-1' };
  const body = buildSignalingBody(s, 'S');
  assert.equal(body.session.model, 'gpt-live-1.1'); // modèle fixe, même si les réglages en portent un autre
  assert.equal(body.session.audio.output.voice, 'Cinder');
  assert.deepEqual(body.session.delegation, { type: 'responses', responses: { model: 'gpt-6-luna', instructions: 'B' } });
});

test('mode veille (§12)', () => {
  const on = (standby) => buildSignalingBody({ ...defaultSettings(), standby }, 'S').session;
  assert.deepEqual(on({ enabled: true, vadThreshold: null, idleTimeoutS: 20 }).wake_policy, { type: 'speech' });
  assert.equal(on({ enabled: true, vadThreshold: null, idleTimeoutS: 20 }).idle_timeout_s, 20);
  const s = on({ enabled: true, vadThreshold: 0.7, idleTimeoutS: 10 });
  assert.deepEqual(s.wake_policy, { type: 'speech', vad_threshold: 0.7 });
  assert.equal(s.idle_timeout_s, 10);
  const off = on({ enabled: false, vadThreshold: 0.7, idleTimeoutS: 10 });
  assert.ok(!('wake_policy' in off) && !('idle_timeout_s' in off));
});
