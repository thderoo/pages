// live-core.js : logique pure de la page de test gpt-live (aucun affichage).
//
// Contenu : réglages (défauts, normalisation, persistance), corps de la
// requête de signalisation WebRTC, ouverture/fermeture de la session,
// historique des conversations, traitement des événements serveur, clé API.
// Tout ce qui touche au navigateur (storage, fetch, RTCPeerConnection,
// getUserMedia) est injectable. Aucun minuteur : l'heure arrive en argument.
//
// Formes vérifiées : docs/openai-gpt-live-1.md du dépôt global-workspace
// (§4, §5, §8, §12) et projects/gpt-live-1/index.html.

export const LIVE_SESSIONS_URL = 'https://api.openai.com/v1/live/sessions';

// --- constantes ---------------------------------------------------------

// Seul gpt-live-1.1 est géré (décision du 2026-11-23) : pas de réglage de modèle.
export const MODEL = 'gpt-live-1.1';

// 21 voix du guide officiel « Managing GPT-Live sessions » (live-conversations),
// relevées le 2026-11-23 : 17 naturelles + 4 générées (Quartz, Beacon, Delta, Cinder).
export const VOICES = [
  'Quartz', 'Ripple', 'Vesper', 'Willow', 'Stone', 'Gleam', 'Meridian',
  'Bossa', 'Tempo', 'Beacon', 'Delta', 'Cinder',
  'Nuri', 'Juni', 'Flitz', 'Brise', 'Sillage', 'Nira', 'Harema', 'Shida', 'Noeul',
];
export const DEFAULT_VOICE = 'Quartz';

// Preset par défaut : voix + consigne courte d'assistant vocal.
export const DEFAULT_PRESET = {
  name: 'Neutre',
  text: 'Tu es un assistant vocal concis. Réponds en français, en phrases courtes, sans liste ni mise en forme.',
  voice: DEFAULT_VOICE,
};

// Seul `gpt-5.6-luna` est vérifié par appel réel ; les deux autres sont les
// suggestions de la page de délégation d'OpenAI.
export const DEFAULT_DELEGATION_MODEL = 'gpt-5.6-luna';
export const DELEGATION_MODEL_SUGGESTIONS = ['gpt-6-luna', 'gpt-6-sol'];

export const IDLE_TIMEOUT_MIN = 5;
export const IDLE_TIMEOUT_MAX = 60;
export const DEFAULT_IDLE_TIMEOUT_S = 30;

export const BUBBLE_CLOSE_MS = 1500;

export const SETTINGS_KEY = 'gpt-live-test:settings';
export const HISTORY_KEY = 'gpt-live-test:history';
export const API_KEY_KEY = 'gpt-live-test:api-key';

// --- réglages -----------------------------------------------------------

function str(v, fallback = '') {
  return typeof v === 'string' ? v : fallback;
}

function normalizeVoice(v) {
  const found = VOICES.find((x) => typeof v === 'string' && x.toLowerCase() === v.trim().toLowerCase());
  return found || DEFAULT_VOICE;
}

// Un preset = { name, text, voice }. Sans voix (ancien format) : voix par défaut.
// Pas de liste (réglages neufs) : le preset par défaut ; une liste vide reste vide.
function normalizePresets(raw) {
  if (!Array.isArray(raw)) return [{ ...DEFAULT_PRESET }];
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const name = str(p.name).trim();
    if (!name || seen.has(name) || typeof p.text !== 'string') continue;
    seen.add(name);
    out.push({ name, text: p.text, voice: normalizeVoice(p.voice) });
  }
  return out;
}

function normalizeVad(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function normalizeIdleTimeout(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return DEFAULT_IDLE_TIMEOUT_S;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_IDLE_TIMEOUT_S;
  return Math.min(IDLE_TIMEOUT_MAX, Math.max(IDLE_TIMEOUT_MIN, Math.round(n)));
}

export function defaultSettings() {
  return {
    voice: DEFAULT_PRESET.voice,
    instructions: DEFAULT_PRESET.text,
    preset: DEFAULT_PRESET.name,
    presets: [{ ...DEFAULT_PRESET }],
    delegation: { model: DEFAULT_DELEGATION_MODEL, instructions: '' },
    standby: { enabled: false, vadThreshold: null, idleTimeoutS: DEFAULT_IDLE_TIMEOUT_S },
  };
}

// Jamais d'exception : toute valeur invalide devient le défaut. Les champs
// inconnus (une clé API égarée, par exemple) sont écartés.
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = r.delegation && typeof r.delegation === 'object' ? r.delegation : {};
  const s = r.standby && typeof r.standby === 'object' ? r.standby : {};
  const delegationModel = str(d.model).trim();
  const presets = normalizePresets(r.presets);
  // Preset sélectionné : doit exister ; sans réglages enregistrés, c'est « Neutre ».
  const preset = typeof r.preset === 'string' && presets.some((p) => p.name === r.preset)
    ? r.preset
    : (r.preset === undefined && !Array.isArray(r.presets) ? DEFAULT_PRESET.name : '');
  return {
    voice: normalizeVoice(r.voice),
    instructions: typeof r.instructions === 'string' ? r.instructions : DEFAULT_PRESET.text,
    preset,
    presets,
    delegation: {
      model: delegationModel || DEFAULT_DELEGATION_MODEL,
      instructions: str(d.instructions),
    },
    standby: {
      enabled: s.enabled === true,
      vadThreshold: normalizeVad(s.vadThreshold),
      idleTimeoutS: normalizeIdleTimeout(s.idleTimeoutS),
    },
  };
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSettings(storage) {
  return normalizeSettings(readJson(storage, SETTINGS_KEY));
}

// Normalise puis écrit ; rend les réglages normalisés.
export function saveSettings(storage, settings) {
  const s = normalizeSettings(settings);
  writeJson(storage, SETTINGS_KEY, s);
  return s;
}

// Presets : fonctions pures, elles rendent de nouveaux réglages (à passer à
// saveSettings pour la persistance). Le preset sélectionné est `settings.preset`
// (nom, '' si aucun) ; la voix et les instructions courantes sont `voice` et
// `instructions`.

// Ajoute le preset ; si le nom existe déjà, ne change rien (voir replacePreset).
export function addPreset(settings, name, text, voice) {
  const s = normalizeSettings(settings);
  const n = str(name).trim();
  if (!n || typeof text !== 'string' || s.presets.some((p) => p.name === n)) return s;
  return { ...s, presets: [...s.presets, { name: n, text, voice: normalizeVoice(voice) }] };
}

// Remplace le texte (et le nom si newName est donné, la voix si voice est donnée)
// du preset `name`. Le preset sélectionné suit son changement de nom.
export function replacePreset(settings, name, text, newName, voice) {
  const s = normalizeSettings(settings);
  const target = s.presets.find((p) => p.name === name);
  if (!target || typeof text !== 'string') return s;
  const n = newName === undefined ? name : str(newName).trim();
  if (!n || (n !== name && s.presets.some((p) => p.name === n))) return s;
  const v = voice === undefined ? target.voice : normalizeVoice(voice);
  return {
    ...s,
    preset: s.preset === name ? n : s.preset,
    presets: s.presets.map((p) => (p === target ? { name: n, text, voice: v } : p)),
  };
}

// Supprime le preset ; s'il était sélectionné, plus aucun ne l'est.
export function removePreset(settings, name) {
  const s = normalizeSettings(settings);
  return { ...s, preset: s.preset === name ? '' : s.preset, presets: s.presets.filter((p) => p.name !== name) };
}

// Sélectionne le preset : règle la voix ET les instructions courantes.
export function applyPreset(settings, name) {
  const s = normalizeSettings(settings);
  const p = s.presets.find((x) => x.name === name);
  return p ? { ...s, preset: p.name, voice: p.voice, instructions: p.text } : s;
}

// Vrai si un preset est sélectionné et que la voix ou les instructions
// courantes en diffèrent (modifié, pas encore enregistré).
export function isPresetModified(settings) {
  const s = normalizeSettings(settings);
  const p = s.presets.find((x) => x.name === s.preset);
  return !!p && (p.voice !== s.voice || p.text !== s.instructions);
}

// --- corps de la requête de signalisation -------------------------------

// POST LIVE_SESSIONS_URL. Mêmes clés que `session.start` en WebSocket (§4/§8).
// Instructions de délégation vides : reprendre celles de la session.
// Mode veille (§12) : `wake_policy` et `idle_timeout_s` sous `session`,
// absents quand il est désactivé.
export function buildSignalingBody(settings, sdp) {
  const s = normalizeSettings(settings);
  const delegationInstructions = s.delegation.instructions.trim() ? s.delegation.instructions : s.instructions;
  const responses = { model: s.delegation.model };
  if (delegationInstructions) responses.instructions = delegationInstructions;
  const session = { model: MODEL };
  if (s.instructions) session.instructions = s.instructions;
  session.audio = { output: { voice: s.voice } };
  session.delegation = { type: 'responses', responses };
  if (s.standby.enabled) {
    const wake = { type: 'speech' };
    if (s.standby.vadThreshold !== null) wake.vad_threshold = s.standby.vadThreshold;
    session.wake_policy = wake;
    session.idle_timeout_s = s.standby.idleTimeoutS;
  }
  return { session, transport: { type: 'webrtc', sdp } };
}

// --- connexion ----------------------------------------------------------

export class LiveHttpError extends Error {
  constructor(status, detail) {
    super(`OpenAI ${status} : ${detail}`);
    this.name = 'LiveHttpError';
    this.status = status;
    this.detail = detail;
  }
}

function abortError() {
  return Object.assign(new Error('Connexion annulée'), { name: 'AbortError' });
}

async function errorDetail(resp) {
  let text = '';
  try { text = await resp.text(); } catch (e) { text = ''; }
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.error && parsed.error.message) return String(parsed.error.message);
  } catch (e) { /* pas du JSON */ }
  return text || 'erreur inconnue';
}

// Ouvre une session WebRTC. Rend tout de suite { ready, close, sessionId } :
// `ready` se résout avec { sessionId } une fois la réponse SDP appliquée.
// close() est valable à tout moment, connexion en cours comprise (ready se
// rejette alors avec une erreur `AbortError`). Dépendances injectables :
// fetch, RTCPeerConnection, getUserMedia(constraints) ; callbacks :
// onEvent(événement serveur), onRemoteStream(stream), onLocalStream(stream du
// micro, pour mesurer son niveau), onConnectionState(état).
export function openLiveSession(opts) {
  const o = opts || {};
  const doFetch = o.fetch || ((...a) => globalThis.fetch(...a));
  const PeerConnection = o.RTCPeerConnection || globalThis.RTCPeerConnection;
  const getUserMedia = o.getUserMedia || ((c) => globalThis.navigator.mediaDevices.getUserMedia(c));

  let closed = false;
  let stream = null;
  let pc = null;
  let dc = null;
  let wakeIce = null;

  function cleanup() {
    if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignoré */ } stream = null; }
    if (dc) { try { dc.close(); } catch (e) { /* ignoré */ } dc = null; }
    if (pc) { try { pc.close(); } catch (e) { /* ignoré */ } pc = null; }
    if (wakeIce) wakeIce();
  }

  const check = () => { if (closed) throw abortError(); };

  function waitIceComplete(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        peer.removeEventListener('icegatheringstatechange', onChange);
        wakeIce = null;
        resolve();
      };
      const onChange = () => { if (peer.iceGatheringState === 'complete') done(); };
      wakeIce = done;
      peer.addEventListener('icegatheringstatechange', onChange);
    });
  }

  const handle = {
    sessionId: null,
    close() {
      closed = true;
      cleanup();
    },
  };

  handle.ready = (async () => {
    try {
      const apiKey = typeof o.apiKey === 'string' ? o.apiKey.trim() : '';
      if (!apiKey) throw new Error('Clé API manquante');

      const local = await getUserMedia({ audio: true });
      if (closed) { local.getTracks().forEach((t) => t.stop()); throw abortError(); }
      stream = local;
      if (o.onLocalStream) o.onLocalStream(local);

      pc = new PeerConnection();
      const peer = pc;
      local.getTracks().forEach((track) => peer.addTrack(track, local));
      peer.ontrack = (ev) => {
        if (o.onRemoteStream && ev.streams && ev.streams[0]) o.onRemoteStream(ev.streams[0]);
      };
      if (o.onConnectionState) {
        peer.onconnectionstatechange = () => o.onConnectionState(peer.connectionState);
      }

      dc = peer.createDataChannel('oai-events');
      dc.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (o.onEvent && msg && typeof msg === 'object') o.onEvent(msg);
      });

      const offer = await peer.createOffer();
      check();
      await peer.setLocalDescription(offer);
      check();
      await waitIceComplete(peer);
      check();

      const body = buildSignalingBody(o.settings, peer.localDescription.sdp);
      const resp = await doFetch(LIVE_SESSIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      check();
      if (!resp.ok) throw new LiveHttpError(resp.status, await errorDetail(resp));

      const data = await resp.json();
      check();
      if (!data || !data.transport || !data.transport.sdp) throw new Error('Réponse de signalisation sans SDP');
      await peer.setRemoteDescription({ type: 'answer', sdp: data.transport.sdp });
      check();
      handle.sessionId = (data.session && data.session.id) || null;
      return { sessionId: handle.sessionId };
    } catch (e) {
      closed = true;
      cleanup();
      throw e;
    }
  })();
  handle.ready.catch(() => {}); // le rejet est pour l'appelant ; pas d'« unhandled rejection » si close()

  return handle;
}

// --- clé API ------------------------------------------------------------

export function getApiKey(storage) {
  try { return storage.getItem(API_KEY_KEY) || ''; } catch (e) { return ''; }
}

// Clé vide : supprimée.
export function setApiKey(storage, key) {
  const k = str(key).trim();
  try {
    if (k) storage.setItem(API_KEY_KEY, k);
    else storage.removeItem(API_KEY_KEY);
  } catch (e) { /* storage indisponible */ }
  return k;
}

// --- historique ---------------------------------------------------------

function readHistory(storage) {
  const raw = readJson(storage, HISTORY_KEY);
  return Array.isArray(raw) ? raw.filter((c) => c && typeof c === 'object' && typeof c.id === 'string') : [];
}

function writeHistory(storage, list) {
  writeJson(storage, HISTORY_KEY, list);
}

let idCounter = 0;
function defaultId(now) {
  idCounter += 1;
  return `c${now.toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Crée et enregistre une conversation. Les réglages sont normalisés : un
// instantané sans clé API (la clé n'est de toute façon pas dans les réglages).
export function createConversation(storage, { settings, now, id } = {}) {
  const t = typeof now === 'number' ? now : Date.now();
  const conv = {
    id: id || defaultId(t),
    startedAt: t,
    endedAt: null,
    settings: normalizeSettings(settings),
    messages: [],
  };
  saveConversation(storage, conv);
  return conv;
}

// Insère ou remplace (par id) une conversation.
export function saveConversation(storage, conversation) {
  const list = readHistory(storage);
  const i = list.findIndex((c) => c.id === conversation.id);
  if (i >= 0) list[i] = conversation;
  else list.push(conversation);
  writeHistory(storage, list);
  return conversation;
}

// Plus récente d'abord (début décroissant).
export function listConversations(storage) {
  return readHistory(storage).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function getConversation(storage, id) {
  return readHistory(storage).find((c) => c.id === id) || null;
}

export function deleteConversation(storage, id) {
  writeHistory(storage, readHistory(storage).filter((c) => c.id !== id));
}

export function clearConversations(storage) {
  try { storage.removeItem(HISTORY_KEY); } catch (e) { /* storage indisponible */ }
}

// --- événements serveur -> conversation ---------------------------------

// État de traitement : la conversation et, pour chaque locuteur, la bulle
// ouverte (index du message et heure de son dernier delta).
export function createLiveState(conversation) {
  return { conversation, open: { you: null, them: null } };
}

function withMessage(state, message, open) {
  return {
    conversation: { ...state.conversation, messages: [...state.conversation.messages, message] },
    open,
  };
}

const CLOSED = { you: null, them: null };

function addDelta(state, speaker, delta, now) {
  if (typeof delta !== 'string' || !delta) return state;
  const other = speaker === 'you' ? 'them' : 'you';
  // La prise de parole de l'un ferme la bulle de l'autre.
  const open = { ...state.open, [other]: null };
  const cur = open[speaker];
  if (cur && now - cur.lastAt < BUBBLE_CLOSE_MS) {
    const messages = state.conversation.messages.map((m, i) => (i === cur.index ? { ...m, text: m.text + delta } : m));
    return {
      conversation: { ...state.conversation, messages },
      open: { ...open, [speaker]: { index: cur.index, lastAt: now } },
    };
  }
  const index = state.conversation.messages.length;
  return withMessage(state, { speaker, text: delta, at: now }, { ...open, [speaker]: { index, lastAt: now } });
}

function addSystem(state, text, now) {
  return withMessage(state, { speaker: 'system', text, at: now }, CLOSED);
}

// Traitement pur : rend un nouvel état, l'état reçu n'est pas modifié.
// Événements traités : session.started, session.input_transcript.delta,
// session.output_transcript.delta, session.paused, session.resumed,
// session.closed, error, plus session.output_audio.delta qui ferme seulement
// la bulle `you` ouverte. Les autres sont ignorés.
export function applyServerEvent(state, event, now) {
  if (!event || typeof event !== 'object') return state;
  switch (event.type) {
    case 'session.started':
      return addSystem(state, 'Session démarrée', now);
    case 'session.input_transcript.delta':
      return addDelta(state, 'you', event.delta, now);
    case 'session.output_transcript.delta':
      return addDelta(state, 'them', event.delta, now);
    case 'session.output_audio.delta':
      // Barge-in (comme la démo) : ferme seulement la bulle `you` ouverte.
      return state.open.you ? { ...state, open: { ...state.open, you: null } } : state;
    case 'session.paused':
      return addSystem(state, 'Session en veille', now);
    case 'session.resumed':
      return addSystem(state, 'Session reprise', now);
    case 'session.closed': {
      const next = addSystem(state, event.reason ? `Session terminée (${event.reason})` : 'Session terminée', now);
      return { ...next, conversation: { ...next.conversation, endedAt: now } };
    }
    case 'error': {
      const msg = event.error && event.error.message ? String(event.error.message) : 'erreur inconnue';
      return addSystem(state, `Erreur : ${msg}`, now);
    }
    default:
      return state;
  }
}

// Marque la fin de la conversation (raccroché côté page, sans `session.closed`).
export function finishConversation(state, now) {
  if (state.conversation.endedAt !== null && state.conversation.endedAt !== undefined) return state;
  return { conversation: { ...state.conversation, endedAt: now }, open: CLOSED };
}
