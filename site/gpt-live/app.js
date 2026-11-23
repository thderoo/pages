// app.js : affichage et branchement de la page de test gpt-live.
// Toute la logique (réglages, presets, session, historique, événements) est
// dans live-core.js ; ce fichier ne fait que lire le DOM et l'y relier.
import {
  VOICES, DEFAULT_DELEGATION_MODEL, DELEGATION_MODEL_SUGGESTIONS, DEFAULT_VOICE,
  loadSettings, saveSettings, addPreset, replacePreset, removePreset, applyPreset, isPresetModified,
  getApiKey, setApiKey, openLiveSession,
  createConversation, saveConversation, listConversations, getConversation, deleteConversation, clearConversations,
  createLiveState, applyServerEvent, finishConversation,
} from './live-core.js';

// --- storage (repli en mémoire si localStorage est refusé) --------------

function pickStorage() {
  try {
    const s = window.localStorage;
    s.getItem('gpt-live-test:probe');
    return s;
  } catch (e) {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
}
const storage = pickStorage();

// --- raccourcis DOM -------------------------------------------------------

const $ = (id) => document.getElementById(id);
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const el = {
  history: $('history'), newConv: $('new-conv'), clearAll: $('clear-all'),
  state: $('state'), stateText: $('state-text'), thread: $('thread'),
  callBtn: $('call-btn'), meterWrap: $('meter-wrap'), meterFill: $('meter-fill'), barNote: $('bar-note'),
  deleteConv: $('delete-conv'), remote: $('remote'),
  apiKey: $('api-key'), preset: $('preset'), manage: $('manage'), voice: $('voice'), instructions: $('instructions'),
  savePreset: $('save-preset'), newPreset: $('new-preset'), modified: $('modified'),
  delegModel: $('deleg-model'), delegSuggestions: $('deleg-suggestions'), delegInstructions: $('deleg-instructions'),
  standby: $('standby'), vad: $('vad'), idle: $('idle'),
  presets: $('presets'), pList: $('p-list'), pName: $('p-name'), pVoice: $('p-voice'), pText: $('p-text'),
  pNew: $('p-new'), pUse: $('p-use'), pSave: $('p-save'), pDup: $('p-dup'), pDel: $('p-del'),
};

// --- formats --------------------------------------------------------------

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const p2 = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const hms = (ms) => { const d = new Date(ms); return `${hm(ms)}:${p2(d.getSeconds())}`; };
const clip = (t, n) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);

function dateLabel(ms) {
  const d = new Date(ms);
  const n = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 864e5);
  if (diff === 0) return `Aujourd'hui ${hm(ms)}`;
  if (diff === 1) return `Hier ${hm(ms)}`;
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${hm(ms)}`;
}

function durationMs(conv, now) {
  const last = conv.messages.length ? conv.messages[conv.messages.length - 1].at : conv.startedAt;
  const end = conv.endedAt != null ? conv.endedAt : (live && live.state.conversation.id === conv.id && isActive() ? now : last);
  return Math.max(0, end - conv.startedAt);
}

function summary(conv) {
  const reply = conv.messages.find((m) => m.speaker !== 'system');
  if (reply) return `« ${clip(reply.text, 40)} »`;
  const err = conv.messages.find((m) => m.speaker === 'system' && m.text.startsWith('Erreur'));
  return err ? clip(err.text, 40) : 'sans réplique';
}

// --- état -----------------------------------------------------------------

let settings = loadSettings(storage);
let view = { mode: 'call', pastId: null };
// Appel en cours ou tout juste terminé : { state, handle, status, over, meter, timer }
let live = null;
// Menu Presets : nom du preset en édition
let editing = null;

const isActive = () => !!live && !live.over;

// --- réglages : colonne de droite ----------------------------------------

function buildOptions(select, names) {
  select.replaceChildren(...names.map((n) => h('option', { value: n, text: n })));
}

function fillSettings() {
  el.apiKey.value = getApiKey(storage);
  el.voice.value = settings.voice;
  el.instructions.value = settings.instructions;
  el.delegModel.value = settings.delegation.model;
  el.delegInstructions.value = settings.delegation.instructions;
  el.standby.checked = settings.standby.enabled;
  el.vad.value = settings.standby.vadThreshold === null ? '' : String(settings.standby.vadThreshold);
  el.idle.value = String(settings.standby.idleTimeoutS);
  refreshDerived();
}

function refreshDerived() {
  const opts = settings.presets.map((p) => p.name);
  if (!settings.preset) opts.unshift('');
  el.preset.replaceChildren(...opts.map((n) => h('option', { value: n, text: n || '— aucun —' })));
  el.preset.value = settings.preset;
  el.savePreset.disabled = !settings.preset;
  el.modified.hidden = !isPresetModified(settings);
  el.vad.disabled = !settings.standby.enabled;
  el.idle.disabled = !settings.standby.enabled;
}

function setSettings(next) {
  settings = saveSettings(storage, next);
  refreshDerived();
}

function initSettingsControls() {
  buildOptions(el.voice, VOICES);
  buildOptions(el.pVoice, VOICES);
  const sugg = [DEFAULT_DELEGATION_MODEL, ...DELEGATION_MODEL_SUGGESTIONS];
  el.delegSuggestions.replaceChildren(...sugg.map((m) => h('option', { value: m })));

  el.apiKey.addEventListener('input', () => { setApiKey(storage, el.apiKey.value); renderBar(); });
  el.preset.addEventListener('change', () => {
    if (!el.preset.value) return;
    setSettings(applyPreset(settings, el.preset.value));
    fillSettings();
  });
  el.voice.addEventListener('change', () => setSettings({ ...settings, voice: el.voice.value }));
  el.instructions.addEventListener('input', () => setSettings({ ...settings, instructions: el.instructions.value }));
  el.savePreset.addEventListener('click', () => {
    if (!settings.preset) return;
    setSettings(replacePreset(settings, settings.preset, settings.instructions, undefined, settings.voice));
  });
  el.newPreset.addEventListener('click', () => {
    const asked = window.prompt('Nom du nouveau preset ?');
    const name = asked === null ? '' : asked.trim();
    if (!name) return;
    if (settings.presets.some((p) => p.name === name)) { window.alert('Un preset porte déjà ce nom.'); return; }
    setSettings(applyPreset(addPreset(settings, name, settings.instructions, settings.voice), name));
    fillSettings();
  });
  el.manage.addEventListener('click', openPresets);

  el.delegModel.addEventListener('input', () => setSettings({ ...settings, delegation: { ...settings.delegation, model: el.delegModel.value } }));
  el.delegModel.addEventListener('change', () => { el.delegModel.value = settings.delegation.model; });
  el.delegInstructions.addEventListener('input', () => setSettings({ ...settings, delegation: { ...settings.delegation, instructions: el.delegInstructions.value } }));

  const standby = (patch) => setSettings({ ...settings, standby: { ...settings.standby, ...patch } });
  el.standby.addEventListener('change', () => standby({ enabled: el.standby.checked }));
  el.vad.addEventListener('input', () => standby({ vadThreshold: el.vad.value.trim() === '' ? null : Number(el.vad.value) }));
  el.vad.addEventListener('change', () => { el.vad.value = settings.standby.vadThreshold === null ? '' : String(settings.standby.vadThreshold); });
  el.idle.addEventListener('input', () => standby({ idleTimeoutS: el.idle.value }));
  el.idle.addEventListener('change', () => { el.idle.value = String(settings.standby.idleTimeoutS); });
}

// --- menu Presets ---------------------------------------------------------

function uniqueName(base) {
  let n = base;
  for (let i = 2; settings.presets.some((p) => p.name === n); i += 1) n = base.includes('(copie') ? base.replace(/\)$/, ` ${i})`) : `${base} ${i}`;
  return n;
}

function renderPresets() {
  if (editing && !settings.presets.some((p) => p.name === editing)) editing = null;
  el.pList.replaceChildren(...settings.presets.map((p) => {
    const b = h('button', { type: 'button', class: `card${p.name === editing ? ' on' : ''}` },
      h('b', { text: p.name }),
      h('small', {}, h('span', { class: 'mono', text: p.voice }), ` · « ${clip(p.text, 40)} »`));
    b.addEventListener('click', () => { editing = p.name; renderPresets(); });
    return b;
  }));
  const p = settings.presets.find((x) => x.name === editing);
  el.pName.value = p ? p.name : '';
  el.pVoice.value = p ? p.voice : DEFAULT_VOICE;
  el.pText.value = p ? p.text : '';
  for (const c of [el.pName, el.pVoice, el.pText, el.pUse, el.pSave, el.pDup, el.pDel]) c.disabled = !p;
}

function openPresets() {
  editing = settings.preset || (settings.presets[0] && settings.presets[0].name) || null;
  renderPresets();
  el.presets.hidden = false;
  el.pName.focus();
}

function closePresets() {
  el.presets.hidden = true;
  el.manage.focus();
}

// Enregistre l'édition ; rend false si le nom est vide ou déjà pris.
function savePresetEdit() {
  const name = el.pName.value.trim();
  if (!name) { window.alert('Le preset doit avoir un nom.'); return false; }
  if (name !== editing && settings.presets.some((p) => p.name === name)) { window.alert('Un preset porte déjà ce nom.'); return false; }
  let next = replacePreset(settings, editing, el.pText.value, name, el.pVoice.value);
  if (next.preset === name) next = applyPreset(next, name); // le preset sélectionné est resynchronisé
  editing = name;
  setSettings(next);
  fillSettings();
  renderPresets();
  return true;
}

function initPresetsMenu() {
  for (const c of el.presets.querySelectorAll('[data-close]')) c.addEventListener('click', closePresets);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.presets.hidden) closePresets(); });
  el.pNew.addEventListener('click', () => {
    const name = uniqueName('Nouveau preset');
    setSettings(addPreset(settings, name, '', DEFAULT_VOICE));
    editing = name;
    renderPresets();
    el.pName.focus();
    el.pName.select();
  });
  el.pSave.addEventListener('click', savePresetEdit);
  el.pUse.addEventListener('click', () => {
    if (!savePresetEdit()) return;
    setSettings(applyPreset(settings, editing));
    fillSettings();
    closePresets();
  });
  el.pDup.addEventListener('click', () => {
    const name = uniqueName(`${editing} (copie)`);
    setSettings(addPreset(settings, name, el.pText.value, el.pVoice.value));
    editing = name;
    renderPresets();
  });
  el.pDel.addEventListener('click', () => {
    if (!window.confirm(`Supprimer le preset « ${editing} » ?`)) return;
    const idx = settings.presets.findIndex((p) => p.name === editing);
    setSettings(removePreset(settings, editing));
    const rest = settings.presets;
    editing = rest.length ? rest[Math.min(idx, rest.length - 1)].name : null;
    renderPresets();
  });
}

// --- historique -----------------------------------------------------------

function shownConversation() {
  if (view.mode === 'past') return getConversation(storage, view.pastId);
  return live ? live.state.conversation : null;
}

function renderHistory() {
  const list = listConversations(storage);
  const shown = shownConversation();
  const now = Date.now();
  if (!list.length) {
    el.history.replaceChildren(h('p', { class: 'empty', text: 'Aucune conversation.' }));
  } else {
    el.history.replaceChildren(...list.map((c) => {
      const mins = Math.max(1, Math.round(durationMs(c, now) / 60000));
      const b = h('button', { type: 'button', class: `card${shown && shown.id === c.id ? ' on' : ''}` },
        h('b', { text: dateLabel(c.startedAt) }),
        h('small', {}, h('span', { class: 'mono', text: c.settings.voice }), ` · ${mins} min · ${summary(c)}`));
      b.disabled = isActive();
      b.addEventListener('click', () => { view = { mode: 'past', pastId: c.id }; render(); });
      return b;
    }));
  }
  el.newConv.disabled = isActive();
  el.clearAll.disabled = isActive() || !list.length;
}

// --- fil, en-tête, pied ---------------------------------------------------

function renderThread() {
  const conv = shownConversation();
  if (!conv || !conv.messages.length) {
    const text = view.mode === 'past' ? 'Conversation vide.'
      : isActive() ? 'En attente des premiers échanges…'
      : 'Aucun appel en cours. Démarre pour parler à gpt-live-1.1.';
    el.thread.replaceChildren(h('p', { class: 'placeholder', text }));
    return;
  }
  el.thread.replaceChildren(...conv.messages.map((m) => {
    if (m.speaker === 'system') {
      return h('div', { class: `sys${m.text.startsWith('Erreur') ? ' err' : ''}`, text: `— ${m.text} ${hm(m.at)} —` });
    }
    return h('div', { class: `msg${m.speaker === 'you' ? ' you' : ''}` }, h('span', { text: m.text }), h('time', { text: hms(m.at) }));
  }));
  if (view.mode === 'call') el.thread.scrollTop = el.thread.scrollHeight;
}

function stateLabel() {
  if (view.mode === 'past') return { text: 'Lecture seule', cls: 'past' };
  if (!live) return { text: 'Prêt', cls: 'idle' };
  if (live.status === 'connecting') return { text: 'Connexion…', cls: 'connecting' };
  if (live.status === 'online') {
    const s = Math.max(0, Math.floor((Date.now() - live.state.conversation.startedAt) / 1000));
    return { text: `En ligne · ${p2(Math.floor(s / 60))}:${p2(s % 60)}`, cls: 'online' };
  }
  if (live.status === 'standby') return { text: 'En veille', cls: 'standby' };
  if (live.status === 'error') return { text: 'Erreur', cls: 'error' };
  return { text: 'Terminé', cls: 'idle' };
}

function renderState() {
  const s = stateLabel();
  el.stateText.textContent = s.text;
  el.state.className = `pill mono ${s.cls}`;
}

function renderBar() {
  const past = view.mode === 'past';
  const hasKey = !!getApiKey(storage);
  el.callBtn.hidden = past;
  el.deleteConv.hidden = !past;
  el.meterWrap.hidden = past || (!hasKey && !isActive());
  el.barNote.hidden = !(past || (!hasKey && !isActive()));
  if (past) {
    el.barNote.textContent = 'Lecture seule. « Nouvelle conversation » pour rappeler.';
    return;
  }
  el.callBtn.textContent = isActive() ? 'Raccrocher' : 'Démarrer';
  el.callBtn.classList.toggle('hangup', isActive());
  el.callBtn.disabled = !isActive() && !hasKey;
  el.barNote.textContent = 'Ajoute ta clé API OpenAI dans les réglages pour démarrer.';
}

function render() {
  renderHistory();
  renderThread();
  renderState();
  renderBar();
}

// --- appel ----------------------------------------------------------------

function startMeter(call, stream) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let level = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
      const v = Math.min(1, Math.sqrt(sum / buf.length) * 5);
      level = Math.max(v, level * 0.8);
      el.meterFill.style.width = `${Math.round(level * 100)}%`;
    }, 60);
    call.meter = { ctx, timer };
  } catch (e) { call.meter = null; }
}

function stopMeter(call) {
  if (call.meter) {
    clearInterval(call.meter.timer);
    call.meter.ctx.close().catch(() => {});
    call.meter = null;
  }
  el.meterFill.style.width = '0';
}

function persist(call) {
  saveConversation(storage, call.state.conversation);
}

function onEvent(call, event) {
  if (call.over) return;
  call.state = applyServerEvent(call.state, event, Date.now());
  persist(call);
  if (event.type === 'session.started' && call.status === 'connecting') call.status = 'online';
  else if (event.type === 'session.paused') call.status = 'standby';
  else if (event.type === 'session.resumed') call.status = 'online';
  else if (event.type === 'session.closed') { endCall(call, 'ended'); return; }
  if (live === call) render();
}

function endCall(call, status) {
  if (call.over) return;
  call.over = true;
  call.status = status;
  clearInterval(call.timer);
  if (call.handle) call.handle.close();
  stopMeter(call);
  el.remote.srcObject = null;
  if (call.state.conversation.endedAt == null && status !== 'error') {
    call.state = applyServerEvent(call.state, { type: 'session.closed', reason: 'raccroché' }, Date.now());
  }
  call.state = finishConversation(call.state, Date.now());
  persist(call);
  render();
}

function failCall(call, message) {
  if (call.over) return;
  call.state = applyServerEvent(call.state, { type: 'error', error: { message } }, Date.now());
  endCall(call, 'error');
}

function startCall() {
  const apiKey = getApiKey(storage);
  if (!apiKey || isActive()) return;
  const conversation = createConversation(storage, { settings, now: Date.now() });
  const call = { state: createLiveState(conversation), handle: null, status: 'connecting', over: false, meter: null, timer: null };
  live = call;
  view = { mode: 'call', pastId: null };
  call.timer = setInterval(() => { if (live === call && call.status === 'online') renderState(); }, 1000);
  call.handle = openLiveSession({
    apiKey,
    settings,
    onEvent: (ev) => onEvent(call, ev),
    onLocalStream: (stream) => { if (!call.over) startMeter(call, stream); },
    onRemoteStream: (stream) => { el.remote.srcObject = stream; el.remote.play().catch(() => {}); },
    onConnectionState: (st) => { if (st === 'failed') failCall(call, 'Connexion perdue'); },
  });
  call.handle.ready.then(() => {
    if (!call.over && call.status === 'connecting') { call.status = 'online'; if (live === call) renderState(); }
  }).catch((err) => {
    if (call.over || (err && err.name === 'AbortError')) return;
    failCall(call, err && err.message ? err.message : 'Connexion impossible');
  });
  render();
}

function initCallControls() {
  el.callBtn.addEventListener('click', () => { if (isActive()) endCall(live, 'ended'); else startCall(); });
  el.newConv.addEventListener('click', () => {
    if (isActive()) return;
    view = { mode: 'call', pastId: null };
    live = null;
    render();
  });
  el.clearAll.addEventListener('click', () => {
    if (isActive() || !window.confirm('Supprimer toutes les conversations ?')) return;
    clearConversations(storage);
    view = { mode: 'call', pastId: null };
    live = null;
    render();
  });
  el.deleteConv.addEventListener('click', () => {
    const conv = shownConversation();
    if (!conv || !window.confirm('Supprimer cette conversation ?')) return;
    deleteConversation(storage, conv.id);
    view = { mode: 'call', pastId: null };
    if (live && live.state.conversation.id === conv.id) live = null;
    render();
  });
}

// --- démarrage ------------------------------------------------------------

initSettingsControls();
initPresetsMenu();
initCallControls();
fillSettings();
render();
// Retour par l'historique du navigateur : les champs sont restaurés par le
// navigateur, on les repose depuis le storage.
window.addEventListener('pageshow', (e) => { if (e.persisted) { settings = loadSettings(storage); fillSettings(); } });
