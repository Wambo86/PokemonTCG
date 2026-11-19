'use strict';
/* Kartentresor – Pokémon: Karten scannen, Sammlung, Cardmarket-Preise, Preis-Alarm.
   Daten: data/cards.json + data/prices.json (siehe scripts/build-pokemon-data.mjs).
   Die Sammlung liegt nur auf diesem Gerät (localStorage) und lässt sich als Datei sichern. */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v) => (v == null || Number.isNaN(v) ? '–' : v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const pct = (v) => `${v > 0 ? '+' : ''}${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: v !== 0 && Math.abs(v) < 0.1 ? 1 : 0 })} %`;
const signedEur = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${eur(Math.abs(v))}`;
const dateDE = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : 'unbekannt');
const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'];
const TYPE_DE = { Grass: 'Pflanze', Fire: 'Feuer', Water: 'Wasser', Lightning: 'Elektro', Psychic: 'Psycho', Fighting: 'Kampf', Darkness: 'Finsternis', Metal: 'Metall', Fairy: 'Fee', Dragon: 'Drache', Colorless: 'Farblos' };
const SUPER_DE = { P: 'Pokémon', T: 'Trainer', E: 'Energie' };

/* ---------- Daten ---------- */
const DB = { sets: [], cards: [], byKey: new Map(), byNT: new Map(), bySetNum: new Map(), byCode: new Map(), updated: '' };
const PR = { p: {}, updated: '' };
// Kartennummern vergleichbar machen: „025“ → „25“, „TG05“ → „TG5“, „SWSH001“ → „SWSH1“
const numKey = (n) => String(n).toUpperCase().replace(/^([A-Z]*)0*(\d)/, '$1$2');

async function loadData() {
  const [c, p] = await Promise.all([
    fetch('data/cards.json').then((r) => { if (!r.ok) throw new Error('cards'); return r.json(); }),
    fetch('data/prices.json').then((r) => (r.ok ? r.json() : { p: {}, updated: '' })).catch(() => ({ p: {}, updated: '' })),
  ]);
  DB.sets = c.sets; DB.cards = c.cards; DB.updated = c.updated;
  DB.sets.forEach((s, i) => {
    s.idx = i; s.count = 0;
    if (s.code && !/^PR-/.test(s.code)) (DB.byCode.get(s.code) || DB.byCode.set(s.code, []).get(s.code)).push(s);
  });
  for (const card of DB.cards) {
    const set = DB.sets[card.s];
    card.set = set; set.count++;
    card.nk = numKey(card.n);
    card.hay = `${card.name} ${card.de || ''} ${card.n} ${set.name} ${set.code} ${card.sub || ''} ${card.a || ''}`.toLowerCase();
    DB.byKey.set(card.k, card);
    DB.bySetNum.set(`${set.id}|${card.nk}`, card);
    if (set.total) {
      const k = `${card.nk}/${set.total}`;
      (DB.byNT.get(k) || DB.byNT.set(k, []).get(k)).push(card);
    }
  }
  PR.p = p.p || {}; PR.updated = p.updated || '';
}

const img = (card) => (card.img === 'x' ? `https://images.scrydex.com/pokemon/${card.k}/small` : card.img || `https://images.pokemontcg.io/${card.set.id}/${card.n}.png`);
const imgLarge = (card) => { const u = img(card); return u.endsWith('/small') ? u.replace(/\/small$/, '/large') : u.replace(/\.png$/, '_hires.png'); };
const displayName = (card) => (store.lang === 'de' && card.de ? card.de : card.name);
const altName = (card) => (store.lang === 'de' ? (card.de ? card.name : '') : card.de || '');
const numLabel = (card) => (card.set.total && /^\d+$/.test(card.n) ? `${card.n.padStart(3, '0')}/${String(card.set.total).padStart(3, '0')}` : card.n);

/* ---------- Speicher ---------- */
const STORE_KEY = 'pokemon.kartentresor.v1';
const EMPTY = () => ({
  items: {},     // Karten-ID → { n: normal, rh: Reverse Holo, buy: Einkaufspreis je Stück, at: hinzugefügt }
  pick: {},      // Karten-ID → gewählte Cardmarket-Produkt-ID
  base: {},      // Karten-ID → { p, t } Merkpreis für den Sammlungs-Alarm
  alarms: {},    // Karten-ID → { above, below } Preisgrenzen
  watch: {},     // Karten-ID → 1 (Beobachtungs-/Wunschliste)
  rule: { pct: 50, dir: 'both' },
  notify: false, notifiedFor: '',
  snap: null, prev: null, // Werte beim aktuellen und beim vorherigen Preisstand
  hist: [],      // [{ d, v, n }] Sammlungswert je Preisstand
  fast: false, lockSet: '', view: 'grid', lang: 'de',
});
let store = EMPTY();
function normalizeStore(raw) {
  const s = EMPTY();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(s)) if (raw[k] !== undefined && typeof raw[k] === typeof s[k] || (s[k] === null && raw[k] && typeof raw[k] === 'object')) s[k] = raw[k];
  if (!Array.isArray(s.hist)) s.hist = [];
  if (!s.rule || typeof s.rule !== 'object') s.rule = { pct: 50, dir: 'both' };
  return s;
}
function loadStore() {
  try { store = normalizeStore(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch { /* leerer Start */ }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch { toast('Speichern fehlgeschlagen – Speicher des Geräts ist voll oder gesperrt.'); }
}
const item = (k) => store.items[k];
const qty = (k) => (store.items[k] ? (store.items[k].n || 0) + (store.items[k].rh || 0) : 0);
function setQty(k, field, n) {
  const it = store.items[k] || { n: 0, rh: 0, buy: null, at: Date.now() };
  it[field] = Math.max(0, n);
  if (!it.n && !it.rh) { delete store.items[k]; delete store.base[k]; }
  else {
    store.items[k] = it;
    // Merkpreis für den Sammlungs-Alarm beim ersten Exemplar festhalten
    if (!store.base[k]) { const v = valueOf(DB.byKey.get(k)); if (v > 0) store.base[k] = { p: v, t: PR.updated || new Date().toISOString() }; }
  }
  saveStore();
}

/* ---------- Preise ---------- */
// Zeile: [idProduct, ab, Trend, Ø30, Ø7, Ø1, Reverse-Trend, Reverse-ab, Reverse-Ø30]
function priceOf(card) {
  if (!card) return null;
  const list = (PR.p[card.k] || []).filter((r) => r.length > 1);
  if (!list.length) return PR.p[card.k]?.length ? { id: PR.p[card.k][0][0], none: true, versions: [] } : null;
  const pickId = store.pick[card.k];
  const r = list.find((x) => x[0] === pickId) || list[0];
  const value = r[2] ?? r[3] ?? r[4] ?? r[1] ?? null;
  const rValue = r[6] ?? r[8] ?? r[7] ?? null;
  const ref = r[3] ?? null; // Ø 30 Tage als Vergleich
  return { id: r[0], low: r[1] ?? null, trend: r[2] ?? null, avg30: r[3] ?? null, avg7: r[4] ?? null, avg1: r[5] ?? null,
    rTrend: r[6] ?? null, rLow: r[7] ?? null, rAvg30: r[8] ?? null, value, rValue,
    move: value != null && ref ? (value - ref) / ref : null, picked: r[0] === pickId, versions: list };
}
const valueOf = (card) => priceOf(card)?.value ?? 0;
// Wert eines Sammlungseintrags: normale Exemplare zum Trend, Reverse Holos zum Reverse-Trend (falls vorhanden)
function itemValue(card) {
  const it = item(card.k); if (!it) return 0;
  const p = priceOf(card); if (!p) return 0;
  return (it.n || 0) * (p.value || 0) + (it.rh || 0) * (p.rValue ?? p.value ?? 0);
}
const cmProduct = (id) => `https://www.cardmarket.com/de/Pokemon/Products?idProduct=${id}`;
const cmSearch = (card) => `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`;

function collection() { return Object.keys(store.items).map((k) => DB.byKey.get(k)).filter(Boolean); }
function totals() {
  const all = collection();
  let n = 0, worth = 0, paid = 0, paidWorth = 0;
  for (const c of all) {
    const it = item(c.k), q = (it.n || 0) + (it.rh || 0), v = itemValue(c);
    n += q; worth += v;
    if (it.buy != null) { paid += it.buy * q; paidWorth += v; }
  }
  return { all, n, worth, paid, paidWorth };
}

// Verlauf: Werte je Preisstand merken, damit „seit letztem Stand“ und die Wertkurve funktionieren
function trackSnapshots() {
  if (!PR.updated) return;
  const vals = {};
  for (const k of new Set([...Object.keys(store.items), ...Object.keys(store.watch), ...Object.keys(store.alarms)])) {
    const c = DB.byKey.get(k); const v = c && valueOf(c); if (v) vals[k] = v;
  }
  if (!store.snap || store.snap.d !== PR.updated) { if (store.snap) store.prev = store.snap; store.snap = { d: PR.updated, v: vals }; }
  else Object.assign(store.snap.v, vals);
  const t = totals(), day = PR.updated.slice(0, 10);
  const last = store.hist[store.hist.length - 1];
  if (last && last.d === day) { last.v = Math.round(t.worth * 100) / 100; last.n = t.n; }
  else if (t.n) store.hist.push({ d: day, v: Math.round(t.worth * 100) / 100, n: t.n });
  if (store.hist.length > 400) store.hist = store.hist.slice(-400);
  saveStore();
}
const prevValue = (k) => store.prev?.v?.[k] ?? null;
function changeSincePrev(card) {
  const before = prevValue(card.k), now = valueOf(card);
  return before && now ? { abs: now - before, rel: (now - before) / before } : null;
}

/* ---------- Preis-Alarm ---------- */
function ensureBaselines() {
  let changed = false;
  for (const k of Object.keys(store.items)) {
    if (store.base[k]) continue;
    const v = valueOf(DB.byKey.get(k));
    if (v > 0) { store.base[k] = { p: v, t: PR.updated || new Date().toISOString() }; changed = true; }
  }
  if (changed) saveStore();
}
function priceAlerts() {
  const out = [];
  for (const [k, a] of Object.entries(store.alarms)) {
    const card = DB.byKey.get(k); if (!card) continue;
    const v = valueOf(card); if (!v) continue;
    if (a.above != null && v >= a.above) out.push({ card, kind: 'above', limit: a.above, to: v, text: `über ${eur(a.above)}` });
    if (a.below != null && v <= a.below) out.push({ card, kind: 'below', limit: a.below, to: v, text: `unter ${eur(a.below)}` });
  }
  const r = store.rule;
  if (r.pct > 0) {
    for (const k of Object.keys(store.items)) {
      const card = DB.byKey.get(k), b = store.base[k];
      if (!card || !b?.p) continue;
      const v = valueOf(card); if (!v) continue;
      const ch = (v - b.p) / b.p;
      if ((ch >= r.pct / 100 && r.dir !== 'down') || (ch <= -r.pct / 100 && r.dir !== 'up' && r.pct < 100)) {
        out.push({ card, kind: 'rule', from: b.p, to: v, ch, text: `${pct(ch)} seit ${dateDE(b.t)}` });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.ch ?? 1) - Math.abs(a.ch ?? 1) || b.to - a.to);
}
function ackAlert(k, kind) {
  const card = DB.byKey.get(k); if (!card) return;
  if (kind === 'rule') store.base[k] = { p: valueOf(card), t: PR.updated || new Date().toISOString() };
  else if (store.alarms[k]) {
    delete store.alarms[k][kind];
    if (store.alarms[k].above == null && store.alarms[k].below == null) delete store.alarms[k];
  }
  saveStore();
}
async function enableNotifications() {
  if (store.notify) { store.notify = false; saveStore(); toast('Gerätemeldungen aus.'); rerender(); return; }
  if (!('Notification' in window)) { toast('Dieses Gerät zeigt hier keine Benachrichtigungen an. Installiere die App am Home-Bildschirm.'); return; }
  let perm = Notification.permission;
  if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
  store.notify = perm === 'granted';
  saveStore();
  toast(store.notify ? 'Gerätemeldungen an.' : 'Benachrichtigungen wurden nicht erlaubt.');
  if (store.notify) maybeNotify(true);
  rerender();
}
// Gerätemeldung, sobald beim aktuellen Preisstand Alarme ausgelöst sind – höchstens einmal je Preisstand.
function maybeNotify(force) {
  if (!store.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const alerts = priceAlerts();
  if (!alerts.length || (!force && store.notifiedFor === PR.updated)) return;
  store.notifiedFor = PR.updated; saveStore();
  const top = alerts[0];
  const body = alerts.length === 1 ? `${displayName(top.card)} (${top.card.set.name}): ${eur(top.to)} – ${top.text}` : `${alerts.length} Preis-Alarme, u. a. ${displayName(top.card)}: ${eur(top.to)}`;
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'preis-alarm' };
  const plain = () => { try { new Notification('Preis-Alarm', opts); } catch { /* ignorieren */ } };
  if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((reg) => (reg?.showNotification ? reg.showNotification('Preis-Alarm', opts) : plain())).catch(plain);
  else plain();
}

/* ---------- Bausteine ---------- */
function art(card, eager) {
  return `<div class="art"><img src="${esc(img(card))}" alt="${esc(card.name)}" ${eager ? '' : 'loading="lazy"'} decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:${esc(JSON.stringify(card.name + ' ' + card.n))}}))"></div>`;
}
const dots = (card) => `<span class="dots">${(card.ty || []).map((i) => `<i class="dot ${TYPES[i]}" title="${TYPE_DE[TYPES[i]]}"></i>`).join('')}</span>`;
const chgHtml = (rel) => (rel == null || !Number.isFinite(rel) || Math.abs(rel) < 0.005 ? '' : `<span class="chg ${rel > 0 ? 'up' : 'down'}">${rel > 0 ? '▲' : '▼'} ${pct(rel)}</span>`);
function tile(card, { badge, missing = false, act = 'open', sub } = {}) {
  const p = priceOf(card);
  const flags = [];
  if (item(card.k)?.rh) flags.push('<span class="flag">RH</span>');
  if (store.alarms[card.k]) flags.push('<span class="flag bell">🔔</span>');
  return `<button class="tile${missing ? ' missing' : ''}" data-act="${act}" data-k="${esc(card.k)}">
    ${art(card)}${badge != null ? `<span class="qty">${badge}</span>` : ''}${flags.length ? `<span class="flags">${flags.join('')}</span>` : ''}
    <span class="nm2">${esc(displayName(card))}</span>
    <span class="meta"><span>${esc(sub ?? `${card.set.code || card.set.id} ${card.n}`)}</span><span class="p">${p && !p.none ? eur(p.value) : ''}</span></span>
  </button>`;
}
function row(card, { right } = {}) {
  const p = priceOf(card);
  const it = item(card.k);
  return `<button class="lrow" data-act="open" data-k="${esc(card.k)}">${art(card)}
    <span class="nm"><b>${esc(displayName(card))}</b><span>${esc(card.set.name)} · ${esc(numLabel(card))}${card.r ? ` · ${esc(card.r)}` : ''}</span>
    ${it ? `<span>${it.n ? `${it.n}× normal` : ''}${it.n && it.rh ? ' · ' : ''}${it.rh ? `${it.rh}× Reverse` : ''}</span>` : ''}</span>
    <span class="val">${right ?? `<b>${p && !p.none ? eur(it ? itemValue(card) : p.value) : '–'}</b>${chgHtml(changeSincePrev(card)?.rel)}`}</span></button>`;
}
let toastTimer, toastUndo = null;
function toast(msg, undo) {
  const el = $('#toast');
  toastUndo = undo || null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="toast-undo">Rückgängig</button>' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toastUndo = null; }, undo ? 5000 : 2800);
}
function matches(card, q) {
  if (!q) return true;
  const ws = q.toLowerCase().split(/\s+/).filter(Boolean);
  return ws.every((w) => card.hay.includes(w) || (/^\d+$/.test(w) && card.nk === numKey(w)));
}
const RARITY_ORDER = ['Common', 'Uncommon', 'Rare'];
function sortCards(list, mode) {
  const by = {
    value: (a, b) => (item(b.k) ? itemValue(b) : valueOf(b)) - (item(a.k) ? itemValue(a) : valueOf(a)),
    price: (a, b) => valueOf(b) - valueOf(a),
    name: (a, b) => displayName(a).localeCompare(displayName(b), 'de') || a.k.localeCompare(b.k),
    set: (a, b) => b.set.date.localeCompare(a.set.date) || a.set.id.localeCompare(b.set.id) || (parseInt(a.nk.replace(/^\D+/, ''), 10) || 0) - (parseInt(b.nk.replace(/^\D+/, ''), 10) || 0) || a.n.localeCompare(b.n),
    num: (a, b) => (parseInt(a.nk.replace(/^\D+/, ''), 10) || 0) - (parseInt(b.nk.replace(/^\D+/, ''), 10) || 0) || a.n.localeCompare(b.n),
    new: (a, b) => (item(b.k)?.at || 0) - (item(a.k)?.at || 0),
    move: (a, b) => (changeSincePrev(b)?.rel ?? -1e9) - (changeSincePrev(a)?.rel ?? -1e9),
    qty: (a, b) => qty(b.k) - qty(a.k),
    rarity: (a, b) => RARITY_ORDER.indexOf(a.r) - RARITY_ORDER.indexOf(b.r) || valueOf(b) - valueOf(a),
  };
  return list.sort(by[mode] || by.set);
}
function setOptions(sel, { onlyOwned = false } = {}) {
  const owned = new Set(collection().map((c) => c.set.id));
  let series = '';
  let out = '';
  for (const s of [...DB.sets].sort((a, b) => b.date.localeCompare(a.date))) {
    if (onlyOwned && !owned.has(s.id)) continue;
    if (s.series !== series) { if (series) out += '</optgroup>'; series = s.series; out += `<optgroup label="${esc(series)}">`; }
    out += `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.code ? ` (${esc(s.code)})` : ''}</option>`;
  }
  return out + (series ? '</optgroup>' : '');
}

/* ---------- Router ---------- */
const view = $('#view');
const ui = {
  sammlung: { q: '', sort: 'value', set: '', limit: 120 },
  suche: { q: '', set: '', type: '', sort: 'set', limit: 60 },
  set: { filter: 'all' },
};
function route() {
  const hash = location.hash.replace('#', '') || (Object.keys(store.items).length ? 'sammlung' : 'scan');
  const [name, arg] = hash.startsWith('set-') ? ['set', hash.slice(4)] : [hash, null];
  if (name !== 'scan') Scanner.stop();
  document.querySelectorAll('.tabs a').forEach((a) => {
    const on = a.dataset.tab === name || (name === 'set' && a.dataset.tab === 'suche') || (name === 'sets' && a.dataset.tab === 'sammlung');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#top-actions').innerHTML = '';
  ({ scan: viewScan, sammlung: viewSammlung, alarme: viewAlarme, suche: viewSuche, set: viewSet, sets: viewSets }[name] || viewSammlung)(arg);
  window.scrollTo(0, 0);
}
const rerender = () => { const y = window.scrollY; route(); window.scrollTo(0, y); };

/* ---------- Sammlung ---------- */
function chartSvg(hist) {
  const pts = hist.slice(-90);
  if (pts.length < 2) return '<p class="hint" style="margin-top:6px">Die Wertkurve entsteht, sobald die App an mehreren Tagen geöffnet wurde (Preise werden täglich aktualisiert).</p>';
  const W = 300, H = 100, vs = pts.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xy = pts.map((p, i) => [i / (pts.length - 1) * W, H - 6 - (p.v - lo) / span * (H - 18)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Wertverlauf von ${eur(vs[0])} auf ${eur(vs[vs.length - 1])}">
    <path class="ar" d="${line}L${W},${H}L0,${H}Z"/><path class="ln" d="${line}"/></svg>
    <div class="chart-head"><span class="hint">${dateDE(pts[0].d)}</span><span class="hint">${dateDE(pts[pts.length - 1].d)}</span></div>
    <p class="hint" style="margin:2px 0 0">Tief ${eur(lo)} · Hoch ${eur(hi)}</p>`;
}
function viewSammlung() {
  $('#title').textContent = 'Sammlung';
  $('#top-actions').innerHTML = '<a class="btn small" href="#sets">Sets</a>';
  const t = totals();
  if (!t.all.length) {
    view.innerHTML = `<div class="empty"><strong>Noch keine Karten gespeichert</strong>Scanne deine erste Karte – die App liest die Nummer unten auf der Karte (z. B. 025/165) und zeigt dir sofort den Cardmarket-Preis.<br><a class="btn primary" href="#scan">Karte scannen</a></div>${backupBox()}`;
    return;
  }
  // Veränderung seit letztem Preisstand
  let before = 0, nowCmp = 0;
  for (const c of t.all) { const pv = prevValue(c.k); if (pv) { before += pv * qty(c.k); nowCmp += valueOf(c) * qty(c.k); } }
  const delta = before ? nowCmp - before : null;
  const moves = t.all.map((c) => ({ c, ch: changeSincePrev(c) })).filter((x) => x.ch && Math.abs(x.ch.abs) >= 0.05);
  const ups = moves.filter((x) => x.ch.abs > 0).sort((a, b) => b.ch.abs * qty(b.c.k) - a.ch.abs * qty(a.c.k)).slice(0, 4);
  const downs = moves.filter((x) => x.ch.abs < 0).sort((a, b) => a.ch.abs * qty(a.c.k) - b.ch.abs * qty(b.c.k)).slice(0, 4);
  const alerts = priceAlerts();
  const s = ui.sammlung;
  view.innerHTML = `
    ${alerts.length ? `<a class="btn primary" href="#alarme">🔔 ${alerts.length} Preis-Alarm${alerts.length > 1 ? 'e' : ''} ausgelöst</a>` : ''}
    <div class="hero">
      <span class="hint">Cardmarket-Wert deiner Sammlung</span>
      <b>${eur(t.worth)}</b>
      <span>${delta == null ? '<span class="hint">Veränderung erscheint ab dem nächsten Preisstand</span>' : `<span class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${signedEur(delta)}${before ? ` (${pct(delta / before)})` : ''}</span> <span class="hint">seit ${dateDE(store.prev.d)}</span>`}</span>
      <span class="hint">${t.n} Karten · ${t.all.length} verschiedene · ${new Set(t.all.map((c) => c.set)).size} Sets</span>
    </div>
    ${t.paid ? `<div class="stats two">
      <div class="stat"><b>${eur(t.paid)}</b><span>bezahlt (Karten mit Einkaufspreis)</span></div>
      <div class="stat"><b class="${t.paidWorth - t.paid >= 0 ? 'up' : 'down'}">${signedEur(t.paidWorth - t.paid)}</b><span>Gewinn/Verlust (${pct((t.paidWorth - t.paid) / t.paid)})</span></div></div>` : ''}
    <div class="chart"><div class="chart-head"><b>Wertverlauf</b><span class="hint">Preise vom ${dateDE(PR.updated)}</span></div>${chartSvg(store.hist)}</div>
    ${ups.length || downs.length ? `<div class="movers">
      <div><h3>Gestiegen</h3>${ups.map((x) => `<button class="mv" data-act="open" data-k="${esc(x.c.k)}"><span>${esc(displayName(x.c))}</span><span class="up">${signedEur(x.ch.abs)}</span></button>`).join('') || '<p class="hint">–</p>'}</div>
      <div><h3>Gefallen</h3>${downs.map((x) => `<button class="mv" data-act="open" data-k="${esc(x.c.k)}"><span>${esc(displayName(x.c))}</span><span class="down">${signedEur(x.ch.abs)}</span></button>`).join('') || '<p class="hint">–</p>'}</div>
    </div>` : ''}
    <div class="row">
      <input class="field grow" id="col-q" type="search" placeholder="Name (auch deutsch), Set oder Nummer" value="${esc(s.q)}" autocomplete="off">
    </div>
    <div class="row">
      <select class="field grow" id="col-set" aria-label="Set"><option value="">Alle Sets</option>${setOptions(s.set, { onlyOwned: true })}</select>
      <select class="field" id="col-sort" style="width:auto" aria-label="Sortierung">
        <option value="value">Wert</option><option value="move">Veränderung</option><option value="new">Zuletzt hinzugefügt</option><option value="name">Name</option><option value="set">Set &amp; Nummer</option><option value="qty">Anzahl</option>
      </select>
      <span class="seg" role="group" aria-label="Ansicht"><button data-act="view" data-v="grid" aria-pressed="${store.view === 'grid'}">Raster</button><button data-act="view" data-v="list" aria-pressed="${store.view === 'list'}">Liste</button></span>
    </div>
    <p class="hint" id="col-count"></p>
    <div id="col-out"></div>
    <button class="btn" id="col-more" hidden>Mehr anzeigen</button>
    ${backupBox()}`;
  $('#col-sort').value = s.sort;
  const draw = () => {
    const list = sortCards(t.all.filter((c) => (!s.set || c.set.id === s.set) && matches(c, s.q)), s.sort);
    const sum = list.reduce((a, c) => a + itemValue(c), 0);
    $('#col-count').textContent = `${list.length} ${list.length === 1 ? 'Karte' : 'Karten'} · ${eur(sum)}`;
    const shown = list.slice(0, s.limit);
    $('#col-out').innerHTML = !list.length ? '<p class="hint">Keine Karte passt zu dieser Suche.</p>'
      : store.view === 'list' ? `<div class="list">${shown.map((c) => row(c)).join('')}</div>`
        : `<div class="grid">${shown.map((c) => tile(c, { badge: `×${qty(c.k)}` })).join('')}</div>`;
    $('#col-more').hidden = list.length <= s.limit;
  };
  draw();
  $('#col-q').oninput = (e) => { s.q = e.target.value; s.limit = 120; draw(); };
  $('#col-set').onchange = (e) => { s.set = e.target.value; s.limit = 120; draw(); };
  $('#col-sort').onchange = (e) => { s.sort = e.target.value; draw(); };
  $('#col-more').onclick = () => { s.limit += 240; draw(); };
}
function backupBox() {
  return `<details class="box"><summary>Sicherung, Export &amp; Einstellungen</summary><div class="body">
    <p class="hint">Deine Sammlung liegt nur auf diesem Gerät. Sichere sie als Datei, bevor du das Gerät wechselst oder Browserdaten löschst.</p>
    <div class="row"><button class="btn small" data-act="export">Sicherung speichern</button>
      <label class="btn small">Sicherung laden<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      <button class="btn small" data-act="export-csv">Als Tabelle (CSV)</button></div>
    <div class="row"><span class="hint grow">Kartennamen anzeigen</span>
      <span class="seg" role="group" aria-label="Sprache der Kartennamen"><button data-act="lang" data-v="de" aria-pressed="${store.lang === 'de'}">Deutsch</button><button data-act="lang" data-v="en" aria-pressed="${store.lang === 'en'}">Englisch</button></span></div>
    <p class="hint">${DB.cards.length.toLocaleString('de-DE')} Karten aus ${DB.sets.length} Sets · Cardmarket-Preise vom ${dateDE(PR.updated)} (täglich aktualisiert). Deutsche Namen gibt es für Pokémon; Trainer- und Energiekarten heißen wie auf Englisch.</p>
    <p class="hint">Preise: Cardmarket-Preistrend (alle Sprachen, Zustand Near Mint und besser). Reverse-Holo-Exemplare werden mit dem Reverse-Holo-Trend bewertet. Die Zuordnung Karte ↔ Cardmarket-Produkt erfolgt automatisch – prüfe teure Karten über den Link zu Cardmarket.</p>
  </div></details>`;
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'kartentresor-pokemon', version: 1, exported: new Date().toISOString(), ...store }, null, 1)], { type: 'application/json' });
  download(blob, `kartentresor-sicherung-${new Date().toISOString().slice(0, 10)}.json`);
}
function exportCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const num = (v) => (v == null ? '' : String(v).replace('.', ','));
  const lines = [['Name', 'Name (DE)', 'Set', 'Set-Code', 'Nummer', 'Seltenheit', 'Anzahl normal', 'Anzahl Reverse Holo', 'Trend (€)', 'Reverse-Trend (€)', 'Wert gesamt (€)', 'Einkauf je Stück (€)', 'Cardmarket'].map(q).join(';')];
  for (const c of sortCards(collection(), 'set')) {
    const it = item(c.k), p = priceOf(c);
    lines.push([c.name, c.de || '', c.set.name, c.set.code, numLabel(c), c.r || '', it.n || 0, it.rh || 0, num(p?.value), num(p?.rValue), num(Math.round(itemValue(c) * 100) / 100), num(it.buy), p ? cmProduct(p.id) : ''].map((v, i) => (i >= 6 && i <= 11 ? v : q(v))).join(';'));
  }
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `kartentresor-${new Date().toISOString().slice(0, 10)}.csv`);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.items !== 'object') throw new Error();
    store = normalizeStore(data);
    saveStore(); toast('Sicherung geladen.'); rerender();
  } catch { toast('Diese Datei ist keine gültige Sicherung.'); }
}

/* ---------- Set-Übersicht & Set-Checkliste ---------- */
function setProgress(set) {
  let have = 0, missingCost = 0, worth = 0;
  for (const c of DB.cards) {
    if (c.set !== set) continue;
    if (qty(c.k)) { have++; worth += itemValue(c); } else missingCost += valueOf(c);
  }
  return { have, total: set.count, missingCost, worth };
}
function viewSets() {
  $('#title').textContent = 'Meine Sets';
  $('#top-actions').innerHTML = '<a class="btn small" href="#sammlung">Zurück</a>';
  const owned = new Set(collection().map((c) => c.set));
  const list = [...owned].map((s) => ({ s, p: setProgress(s) })).sort((a, b) => b.p.have / b.p.total - a.p.have / a.p.total);
  view.innerHTML = list.length ? `<p class="hint">Fortschritt je Set (jede Kartennummer zählt einmal, egal ob normal oder Reverse Holo). Tippe ein Set für die Checkliste.</p>
    <div class="setlist">${list.map(({ s, p }) => {
      const pc = Math.round(p.have / p.total * 100), done = p.have === p.total;
      return `<a class="setrow" style="text-decoration:none" href="#set-${esc(s.id)}">
        <div class="setrow-top">${s.sym ? `<img class="symbol" src="${esc(s.sym)}" alt="" loading="lazy">` : ''}<b>${esc(s.name)}</b><span class="nm">${esc(s.series)}</span><span class="n">${p.have} / ${p.total}${done ? ' ✓' : ''}</span></div>
        <div class="bar"><i style="width:${pc}%" class="${done ? 'done' : ''}"></i></div>
        <p class="hint" style="margin:6px 0 0">Wert ${eur(p.worth)}${done ? '' : ` · fehlende ca. ${eur(p.missingCost)}`}</p></a>`;
    }).join('')}</div>` : '<div class="empty"><strong>Noch keine Sets</strong>Sobald du Karten speicherst, erscheint hier dein Fortschritt je Set.</div>';
}
function viewSet(id) {
  const set = DB.sets.find((s) => s.id === id);
  if (!set) { location.hash = 'suche'; return; }
  $('#title').textContent = set.name;
  $('#top-actions').innerHTML = '<button class="btn small" data-act="back">Zurück</button>';
  const p = setProgress(set), f = ui.set;
  const cards = sortCards(DB.cards.filter((c) => c.set === set), 'num');
  const pc = Math.round(p.have / p.total * 100);
  view.innerHTML = `
    <div class="setrow static"><div class="setrow-top">${set.sym ? `<img class="symbol" src="${esc(set.sym)}" alt="">` : ''}<b>${esc(set.code || set.id)}</b><span class="nm">${esc(set.series)} · ${dateDE(set.date)}</span><span class="n">${p.have} / ${p.total} · ${pc}%</span></div>
      <div class="bar"><i style="width:${pc}%" class="${p.have === p.total ? 'done' : ''}"></i></div>
      <p class="hint" style="margin:6px 0 0">Dein Wert ${eur(p.worth)} · fehlende Karten ca. ${eur(p.missingCost)}</p></div>
    <div class="row" style="justify-content:space-between">
      <span class="seg" role="group" aria-label="Filter">${[['all', 'Alle'], ['have', 'Vorhanden'], ['miss', 'Fehlend']].map(([v, l]) => `<button data-act="set-filter" data-v="${v}" aria-pressed="${f.filter === v}">${l}</button>`).join('')}</span>
      <button class="btn small" data-act="lock-set" data-set="${esc(set.id)}">Dieses Set scannen</button>
    </div>
    <div class="grid">${cards.filter((c) => f.filter === 'all' || (f.filter === 'have') === !!qty(c.k)).map((c) => tile(c, { badge: qty(c.k) ? `×${qty(c.k)}` : null, missing: !qty(c.k), sub: numLabel(c) })).join('') || '<p class="hint">Keine Karten.</p>'}</div>`;
}

/* ---------- Alle Karten ---------- */
function viewSuche() {
  $('#title').textContent = 'Alle Karten';
  const s = ui.suche;
  view.innerHTML = `
    <input class="field" id="all-q" type="search" placeholder="z. B. Glurak, Pikachu ex, MEW 25 oder 025/165" value="${esc(s.q)}" autocomplete="off">
    <div class="row">
      <select class="field grow" id="all-set" aria-label="Set"><option value="">Alle Sets</option>${setOptions(s.set)}</select>
      <select class="field" id="all-type" style="width:auto" aria-label="Kartentyp"><option value="">Alle Typen</option><option value="P">Pokémon</option><option value="T">Trainer</option><option value="E">Energie</option></select>
      <select class="field" id="all-sort" style="width:auto" aria-label="Sortierung"><option value="set">Neueste Sets</option><option value="price">Preis</option><option value="name">Name</option></select>
    </div>
    <div class="row" style="justify-content:space-between"><p class="hint" id="all-count" style="margin:0"></p><span id="all-setlink"></span></div>
    <div class="grid" id="all-grid"></div>
    <button class="btn" id="all-more" hidden>Mehr anzeigen</button>`;
  $('#all-type').value = s.type; $('#all-sort').value = s.sort;
  const draw = () => {
    let list;
    const scan = s.q.trim() && /\d/.test(s.q) ? parseScanText(s.q, '') : null;
    if (scan && scan.cards.length) list = scan.cards.filter((c) => (!s.set || c.set.id === s.set) && (!s.type || c.t === s.type));
    else list = DB.cards.filter((c) => (!s.set || c.set.id === s.set) && (!s.type || c.t === s.type) && matches(c, s.q));
    list = s.set && s.sort === 'set' ? sortCards(list, 'num') : sortCards(list, s.sort);
    $('#all-count').textContent = `${list.length.toLocaleString('de-DE')} Karten`;
    $('#all-setlink').innerHTML = s.set ? `<a class="btn small" href="#set-${esc(s.set)}">Set-Checkliste</a>` : '';
    $('#all-grid').innerHTML = list.slice(0, s.limit).map((c) => tile(c, { badge: qty(c.k) ? `×${qty(c.k)}` : null })).join('') || '<p class="hint">Nichts gefunden.</p>';
    $('#all-more').hidden = list.length <= s.limit;
  };
  draw();
  let deb;
  $('#all-q').oninput = (e) => { s.q = e.target.value; s.limit = 60; clearTimeout(deb); deb = setTimeout(draw, 120); };
  $('#all-set').onchange = (e) => { s.set = e.target.value; s.limit = 60; draw(); };
  $('#all-type').onchange = (e) => { s.type = e.target.value; s.limit = 60; draw(); };
  $('#all-sort').onchange = (e) => { s.sort = e.target.value; draw(); };
  $('#all-more').onclick = () => { s.limit += 120; draw(); };
}

/* ---------- Preis-Alarm-Ansicht ---------- */
function viewAlarme() {
  $('#title').textContent = 'Preis-Alarm';
  const alerts = priceAlerts();
  const r = store.rule;
  const watched = [...new Set([...Object.keys(store.alarms), ...Object.keys(store.watch)])].map((k) => DB.byKey.get(k)).filter(Boolean);
  const notifSupported = 'Notification' in window;
  view.innerHTML = `
    ${alerts.length ? `<div class="alarm">
      <div class="alarm-head"><b>Ausgelöst (${alerts.length})</b><button class="btn small" data-act="alert-ack-all">Alle erledigt</button></div>
      ${alerts.map((a) => `<div class="alarm-row">
        <button class="open" data-act="open" data-k="${esc(a.card.k)}">${art(a.card)}
          <span class="nm"><b>${esc(displayName(a.card))}</b><span>${esc(a.card.set.name)} · jetzt <b class="${a.kind === 'below' || a.ch < 0 ? 'down' : 'up'}">${eur(a.to)}</b> · ${esc(a.text)}${a.kind === 'rule' ? ` (vorher ${eur(a.from)})` : ''}</span></span></button>
        <button class="btn small" data-act="alert-ack" data-k="${esc(a.card.k)}" data-kind="${a.kind}">Erledigt</button>
      </div>`).join('')}
    </div>` : '<div class="empty" style="padding:20px 8px"><strong>Kein Alarm ausgelöst</strong>Sobald eine Grenze erreicht ist, erscheint die Karte hier.</div>'}

    <div class="rule">
      <b>Sammlung überwachen</b>
      <p class="hint">Meldet Karten aus deiner Sammlung, deren Cardmarket-Wert sich seit dem Hinzufügen (bzw. seit „Erledigt“) stark verändert hat.</p>
      <div class="row">
        <select class="field" id="rule-pct" style="width:auto" aria-label="Schwelle">
          ${[[0, 'aus'], [20, '± 20 %'], [30, '± 30 %'], [50, '± 50 %'], [100, '+ 100 % (verdoppelt)'], [200, '+ 200 %']].map(([v, l]) => `<option value="${v}" ${r.pct === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select class="field" id="rule-dir" style="width:auto" aria-label="Richtung">
          <option value="both" ${r.dir === 'both' ? 'selected' : ''}>steigt oder fällt</option><option value="up" ${r.dir === 'up' ? 'selected' : ''}>nur steigend</option><option value="down" ${r.dir === 'down' ? 'selected' : ''}>nur fallend</option>
        </select>
      </div>
    </div>

    <div class="rule">
      <div class="row" style="justify-content:space-between"><b>Gerätemeldungen</b>
        <button class="btn small ${store.notify ? 'primary' : ''}" data-act="notify-toggle">${store.notify ? 'An' : 'Aus'}</button></div>
      <p class="hint">${notifSupported ? '' : 'Dieser Browser kann hier keine Meldungen zeigen. '}Preise werden einmal täglich aktualisiert. Beim Öffnen der App wird geprüft, ob ein Alarm ausgelöst wurde – dann kommt eine Meldung. Auf dem iPhone dafür die App über „Teilen → Zum Home-Bildschirm“ installieren.</p>
    </div>

    <p class="section-title">Beobachtet &amp; Preisgrenzen (${watched.length})</p>
    ${watched.length ? `<div class="list">${sortCards(watched, 'name').map((c) => {
      const a = store.alarms[c.k] || {}, v = valueOf(c);
      const lim = [a.above != null ? `≥ ${eur(a.above)}` : '', a.below != null ? `≤ ${eur(a.below)}` : ''].filter(Boolean).join(' · ');
      return row(c, { right: `<b>${v ? eur(v) : '–'}</b><span class="hint">${lim || 'ohne Grenze'}${qty(c.k) ? '' : ' · <span class="tag">Wunsch</span>'}</span>` });
    }).join('')}</div>` : '<p class="hint">Öffne eine Karte und setze unter „Preis-Alarm“ eine Grenze, z. B. „melden wenn unter 20 €“ für Karten, die du kaufen möchtest – oder „über 100 €“ für Karten, die du verkaufen willst.</p>'}`;
  $('#rule-pct').onchange = (e) => { store.rule.pct = +e.target.value; saveStore(); rerender(); };
  $('#rule-dir').onchange = (e) => { store.rule.dir = e.target.value; saveStore(); rerender(); };
}

/* ---------- Kartendetails ---------- */
const sheet = $('#sheet');
let sheetKey = null;
function openCard(k) {
  const card = DB.byKey.get(k);
  if (!card) return;
  sheetKey = k;
  const p = priceOf(card);
  const it = item(k) || { n: 0, rh: 0, buy: null };
  const a = store.alarms[k] || {};
  const ch = changeSincePrev(card);
  const stat = (label, val) => (val != null && val !== '' ? `<dt>${label}</dt><dd>${val}</dd>` : '');
  const prices = p && !p.none ? [['Trend', p.trend], ['ab', p.low], ['Ø 30 Tage', p.avg30], ['Ø 7 Tage', p.avg7], ['Ø 1 Tag', p.avg1], ['Reverse-Trend', p.rTrend], ['Reverse ab', p.rLow]].filter(([, v]) => v != null) : [];
  const others = DB.cards.filter((c) => c !== card && c.dex && c.dex === card.dex && c.name === card.name).slice(0, 30);
  sheet.innerHTML = `
    <div class="sheet-bar"><h2>${esc(displayName(card))}</h2><button class="btn small" data-act="close-sheet">Schließen</button></div>
    <div class="sheet-inner">
      <div class="detail-top"><button data-act="zoom" style="border:0;background:none;padding:0">${art(card, true)}</button>
        <div class="info">
          <dl class="kv">
            ${altName(card) ? stat(store.lang === 'de' ? 'Englisch' : 'Deutsch', esc(altName(card))) : ''}
            ${stat('Set', `${card.set.sym ? `<img class="symbol" src="${esc(card.set.sym)}" alt="">` : ''}${esc(card.set.name)}`)}
            ${stat('Nummer', `${esc(numLabel(card))}${card.set.code ? ` · ${esc(card.set.code)}` : ''}`)}
            ${stat('Seltenheit', esc(card.r))}
            ${stat('Typ', `${dots(card)} ${esc(SUPER_DE[card.t])}${card.sub ? ` · ${esc(card.sub)}` : ''}`)}
            ${stat('KP', esc(card.hp))}${stat('Illustration', esc(card.a))}${stat('Erschienen', dateDE(card.set.date))}
          </dl>
          ${card.mv ? `<ul class="moves">${card.mv.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>

      <p class="section-title">In meiner Sammlung</p>
      <div class="qty-grid">
        <div class="own-row"><span><b>Normal</b></span>
          <span class="stepper"><button data-act="qty" data-f="n" data-d="-1" aria-label="Eine weniger" ${it.n ? '' : 'disabled'}>−</button><output>${it.n || 0}</output><button data-act="qty" data-f="n" data-d="1" aria-label="Eine mehr">+</button></span></div>
        <div class="own-row"><span><b>Reverse Holo</b>${p?.rValue ? `<br><span class="hint">${eur(p.rValue)}</span>` : ''}</span>
          <span class="stepper"><button data-act="qty" data-f="rh" data-d="-1" aria-label="Eine weniger" ${it.rh ? '' : 'disabled'}>−</button><output>${it.rh || 0}</output><button data-act="qty" data-f="rh" data-d="1" aria-label="Eine mehr">+</button></span></div>
        ${qty(k) ? `<div class="own-row"><span><b>Einkaufspreis</b><br><span class="hint">je Stück, optional</span></span>
          <span class="money"><input class="field" id="buy" inputmode="decimal" placeholder="0,00" value="${it.buy != null ? String(it.buy).replace('.', ',') : ''}"> €</span></div>` : ''}
      </div>

      <p class="section-title">Cardmarket</p>
      ${p && !p.none ? `<div class="cm">
        <div class="cm-main"><b>${eur(p.value)}</b><span>Preistrend ${chgHtml(p.move)} <span class="hint">ggü. Ø 30 Tage</span></span></div>
        ${ch ? `<p class="hint">Seit ${dateDE(store.prev.d)}: <b class="${ch.abs > 0 ? 'up' : 'down'}">${signedEur(ch.abs)} (${pct(ch.rel)})</b></p>` : ''}
        <div class="pricegrid">${prices.map(([l, v]) => `<div><span>${l}</span><b>${eur(v)}</b></div>`).join('')}</div>
        ${p.versions.length > 1 ? `<p class="hint">Cardmarket führt ${p.versions.length} Versionen dieser Karte (z. B. 1. Edition, Stempel, Promo)${p.picked ? '' : ' – angezeigt wird Version 1'}. Wähle deine:</p>
        <ul class="cm-versions">${p.versions.map((v, i) => `<li><label><input type="radio" name="cmv" value="${v[0]}" ${v[0] === p.id ? 'checked' : ''}> Version ${i + 1}</label><span class="lo">ab ${eur(v[1])}</span><span class="tr">${eur(v[2] ?? v[3] ?? v[1])}</span><a href="${cmProduct(v[0])}" target="_blank" rel="noopener">ansehen</a></li>`).join('')}</ul>` : ''}
        <a class="btn primary" href="${cmProduct(p.id)}" target="_blank" rel="noopener">Auf Cardmarket ansehen ↗</a>
        <a class="link" href="${cmSearch(card)}" target="_blank" rel="noopener">Falsche Karte? Auf Cardmarket suchen ↗</a>
      </div>` : `<div class="cm"><p class="hint">Für diese Karte liegt ${p?.none ? 'zurzeit' : ''} kein Cardmarket-Preis vor.</p>
        ${p?.id ? `<a class="link" href="${cmProduct(p.id)}" target="_blank" rel="noopener">Produkt auf Cardmarket ↗</a>` : ''}
        <a class="link" href="${cmSearch(card)}" target="_blank" rel="noopener">Auf Cardmarket suchen ↗</a></div>`}

      <p class="section-title">Preis-Alarm</p>
      <div class="cm">
        <div class="alarmform">
          <label for="al-above">Melden, wenn über</label><span class="money"><input class="field" id="al-above" inputmode="decimal" placeholder="z. B. ${p?.value ? String(Math.ceil(p.value * 1.3)) : '50'}" value="${a.above != null ? String(a.above).replace('.', ',') : ''}"> €</span>
          <label for="al-below">Melden, wenn unter</label><span class="money"><input class="field" id="al-below" inputmode="decimal" placeholder="z. B. ${p?.value ? String(Math.floor(p.value * 0.8)) : '10'}" value="${a.below != null ? String(a.below).replace('.', ',') : ''}"> €</span>
        </div>
        <div class="row"><button class="btn small primary" data-act="alarm-save">Grenzen speichern</button>
          ${a.above != null || a.below != null ? '<button class="btn small" data-act="alarm-clear">Grenzen löschen</button>' : ''}
          <button class="btn small ${store.watch[k] ? 'primary' : ''}" data-act="watch">${store.watch[k] ? 'Beobachtet ✓' : 'Beobachten'}</button></div>
        <p class="hint">Ohne Besitz landet die Karte als „Wunsch“ in der Preis-Alarm-Liste – praktisch, um auf einen guten Kaufpreis zu warten.</p>
      </div>

      ${others.length ? `<p class="section-title">Weitere Drucke von ${esc(displayName(card))} (${others.length})</p>
        <div class="variants">${others.map((c) => `<button data-act="open" data-k="${esc(c.k)}">${art(c)}<small>${qty(c.k) ? `×${qty(c.k)} · ` : ''}${esc(c.set.code || c.set.name)} ${esc(c.n)}</small></button>`).join('')}</div>` : ''}
    </div>`;
  const buy = $('#buy', sheet);
  if (buy) buy.onchange = () => {
    const v = parseMoney(buy.value);
    const cur = store.items[k]; if (!cur) return;
    cur.buy = v; saveStore(); toast(v == null ? 'Einkaufspreis entfernt.' : `Einkaufspreis ${eur(v)} gespeichert.`);
  };
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
const parseMoney = (s) => { const t = String(s).trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'); if (!t) return null; const v = Number(t); return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; };
sheet.addEventListener('change', (e) => {
  if (e.target.name === 'cmv' && sheetKey) {
    store.pick[sheetKey] = Number(e.target.value);
    // Merkpreis an die gewählte Version anpassen, sonst löst der Alarm sofort aus
    if (store.base[sheetKey]) store.base[sheetKey] = { p: valueOf(DB.byKey.get(sheetKey)), t: PR.updated };
    saveStore(); openCard(sheetKey);
  }
});
sheet.addEventListener('close', () => { sheetKey = null; rerender(); });

/* ---------- Scanner ---------- */
// OCR-Verwechsler in Ziffernfeldern zurückübersetzen
const DIGIT_FIX = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', S: '5', B: '8', Z: '2', G: '6' };
const fixDigits = (s) => s.replace(/[OQDUILTSBZG]/g, (c) => DIGIT_FIX[c]);
const PROMO_SETS = [[/\bSVP\s?(?:EN|DE)?\s?([0-9OQDILSBZ]{1,3})\b/g, 'svp', ''], [/\bSWSH\s?([0-9OQDILSBZ]{2,3})\b/g, 'swshp', 'SWSH'], [/\bSM\s?([0-9OQDILSBZ]{2,3})\b/g, 'smp', 'SM'], [/\bXY\s?([0-9OQDILSBZ]{2,3})\b/g, 'xyp', 'XY'], [/\bBW\s?([0-9OQDILSBZ]{2,3})\b/g, 'bwp', 'BW']];
/** Liest Kartennummern aus OCR- oder Eingabetext. Liefert passende Karten und eine Signatur (für die Abstimmung über mehrere Bilder). */
function parseScanText(text, lockSetId) {
  const t = ` ${String(text).toUpperCase().replace(/[—–_~]/g, '-').replace(/[\\|]/g, '/')} `;
  const found = []; // { sig, cards }
  const lock = lockSetId ? DB.sets.find((s) => s.id === lockSetId) : null;
  const push = (sig, cards) => { if (cards.length) found.push({ sig, cards }); };
  let m;
  // 1) Galerie-Nummern: TG05/TG30, GG12/GG70, SV045/SV122, RC12/RC32
  const reGal = /\b(TG|GG|SV|RC)\s?([0-9OQDILSBZ]{1,3})\s?\/\s?(?:TG|GG|SV|RC)?\s?([0-9OQDILSBZ]{2,3})/g;
  while ((m = reGal.exec(t))) {
    const nk = numKey(m[1] + fixDigits(m[2])), tot = parseInt(fixDigits(m[3]), 10);
    push(`${nk}/${tot}`, lock ? [DB.bySetNum.get(`${lock.id}|${nk}`)].filter(Boolean) : DB.byNT.get(`${nk}/${tot}`) || []);
  }
  // 2) Normale Nummer: 025/165, 4/102
  // Die Texterkennung verschluckt oft Leerzeichen („MEWEN025/165“) – davor darf also alles außer einer Ziffer stehen.
  const reNum = /(?:^|[^0-9])([0-9OQDILSBZ]{1,3})\s?\/\s?([0-9OQDILSBZ]{2,3})(?![0-9])/g;
  while ((m = reNum.exec(t))) {
    const a = fixDigits(m[1]), b = fixDigits(m[2]);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) continue;
    const nk = numKey(a), tot = parseInt(b, 10);
    if (lock) push(`${lock.id}|${nk}`, [DB.bySetNum.get(`${lock.id}|${nk}`)].filter(Boolean));
    else push(`${nk}/${tot}`, DB.byNT.get(`${nk}/${tot}`) || []);
    reNum.lastIndex = m.index + 1;
  }
  // 2b) Schrägstrich nicht erkannt: „025165“ bzw. „4102“ – nur wenn die Gesamtzahl dreistellig ist und es das Set gibt
  if (!found.length) {
    const reNoSlash = /(?:^|[^0-9])(\d{1,3})([1-9]\d{2})(?![0-9])/g;
    while ((m = reNoSlash.exec(t))) {
      const nk = numKey(m[1]), tot = parseInt(m[2], 10);
      if (lock ? lock.total === tot : DB.byNT.has(`${nk}/${tot}`)) push(lock ? `${lock.id}|${nk}` : `${nk}/${tot}`, lock ? [DB.bySetNum.get(`${lock.id}|${nk}`)].filter(Boolean) : DB.byNT.get(`${nk}/${tot}`));
    }
  }
  // 3) Promos: SVP 085, SWSH123, SM210 …
  for (const [re, setId, pre] of PROMO_SETS) {
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      const nk = numKey(pre + fixDigits(m[1]));
      push(`${setId}|${nk}`, [DB.bySetNum.get(`${setId}|${nk}`)].filter(Boolean));
    }
  }
  // 4) Eingabe „MEW 25“ / „PAL 123“: Set-Kürzel + Nummer
  const reCode = /\b([A-Z0-9]{2,5})\s+(?:EN\s+|DE\s+)?([0-9]{1,3})\b(?!\s?\/)/g;
  while ((m = reCode.exec(t))) {
    for (const s of DB.byCode.get(m[1]) || []) push(`${s.id}|${numKey(m[2])}`, [DB.bySetNum.get(`${s.id}|${numKey(m[2])}`)].filter(Boolean));
  }
  // 5) Nur Nummer mit gesperrtem Set (Nummer ohne lesbare Gesamtzahl)
  if (lock && !found.length) {
    const reBare = /(?:^|[^0-9A-Z/])([0-9]{1,3})(?:\s?\/|$|\s)/g;
    while ((m = reBare.exec(t))) push(`${lock.id}|${numKey(m[1])}`, [DB.bySetNum.get(`${lock.id}|${numKey(m[1])}`)].filter(Boolean));
  }
  if (!found.length) return { sig: '', cards: [] };
  // Set-Kürzel auf der Karte (z. B. „MEW“, ab Karmesin & Purpur aufgedruckt) grenzt mehrdeutige Treffer ein
  const codes = new Set([...DB.byCode.keys()].filter((c) => c.length >= 3 && t.includes(c)));
  const best = found[0];
  let cards = [...new Set(best.cards)];
  if (cards.length > 1 && codes.size) {
    const narrowed = cards.filter((c) => codes.has(c.set.code));
    if (narrowed.length) cards = narrowed;
  }
  return { sig: best.sig, cards: sortCards(cards, 'set') };
}

const Scanner = {
  stream: null, workerPromise: null, timer: null, busy: false, round: 0, recent: [], liveLast: null,
  current: null, // { sig, cards }
  sel: null, fastLog: [], fastSeen: {},

  async getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const w = await Tesseract.createWorker('eng', 1, {
          workerPath: 'vendor/tesseract/worker.min.js', corePath: 'vendor/tesseract/', langPath: 'vendor/tesseract/lang',
          workerBlobURL: false, gzip: true,
        });
        await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/', tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
        return w;
      })();
      this.workerPromise.catch(() => { this.workerPromise = null; });
    }
    return this.workerPromise;
  },

  /** Bereich ausschneiden, vergrößern, in kontrastreiches Graustufenbild wandeln (optional Schwarz-Weiß nach Otsu). */
  prep(src, sx, sy, sw, sh, outW, mode, thr) {
    const cv = document.createElement('canvas');
    cv.width = outW; cv.height = Math.max(8, Math.round(outW * sh / sw));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
    const g = new Uint8ClampedArray(d.length / 4);
    let lo = 255, hi = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const r = d[i], gr = d[i + 1], b = d[i + 2];
      const v = mode === 'max' ? Math.max(r, gr, b) : mode === 'min' ? Math.min(r, gr, b) : r * 0.3 + gr * 0.59 + b * 0.11;
      g[j] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const span = Math.max(1, hi - lo);
    for (let j = 0; j < g.length; j++) g[j] = (g[j] - lo) * 255 / span;
    let t = -1;
    if (thr) {
      const hist = new Uint32Array(256);
      for (let j = 0; j < g.length; j++) hist[g[j]]++;
      let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
      let sb = 0, wb = 0, best = 0;
      for (let i = 0; i < 256; i++) {
        wb += hist[i]; if (!wb) continue;
        const wf = g.length - wb; if (!wf) break;
        sb += i * hist[i];
        const diff = sb / wb - (sum - sb) / wf, score = wb * wf * diff * diff;
        if (score > best) { best = score; t = i; }
      }
    }
    // Weiße Schrift auf dunklem Grund (z. B. Full-Art-Karten) umkehren, damit die Schrift dunkel ist
    let mean = 0; for (let j = 0; j < g.length; j++) mean += g[j]; mean /= g.length;
    const inv = mean < 110;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let v = t < 0 ? g[j] : (g[j] > t ? 255 : 0);
      if (inv) v = 255 - v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(im, 0, 0);
    return cv;
  },
  VARIANTS: [['luma', false], ['min', true], ['max', false], ['luma', true]],

  async read(src, region, variant) {
    const worker = await this.getWorker();
    const [x, y, w, h, outW] = region;
    const { data } = await worker.recognize(this.prep(src, x, y, w, h, outW, ...this.VARIANTS[variant % this.VARIANTS.length]));
    return parseScanText(data.text, store.lockSet);
  },

  /** Foto: Bereiche nacheinander, je Bereich stimmen die Bildvarianten ab (2 gleiche Lesungen genügen). */
  async recognize(src, regions) {
    const votes = new Map();
    for (const region of regions) {
      for (let v = 0; v < this.VARIANTS.length; v++) {
        const r = await this.read(src, region, v);
        if (!r.sig) continue;
        const e = votes.get(r.sig) || { n: 0, r };
        e.n++; votes.set(r.sig, e);
        if (e.n >= 2) return r;
      }
    }
    return null;
  },

  async start() {
    const video = $('#scan-video');
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) { this.status('Dieses Gerät gibt die Kamera hier nicht frei. Nutze „Foto aufnehmen“.'); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (err) {
      this.status(err.name === 'NotAllowedError' ? 'Kamerazugriff wurde abgelehnt. Erlaube ihn in den Browser-Einstellungen oder nutze „Foto aufnehmen“.' : 'Kamera konnte nicht gestartet werden. Nutze „Foto aufnehmen“.');
      return;
    }
    if (!$('#scan-video')) { this.stop(); return; }
    video.srcObject = this.stream;
    await video.play().catch(() => {});
    $('#scan-idle').hidden = true; $('#scan-guide').hidden = false; $('#scan-stop').hidden = false;
    this.status('Texterkennung wird geladen …');
    try { await this.getWorker(); } catch { this.status('Texterkennung konnte nicht geladen werden. Prüfe die Internetverbindung.'); return; }
    this.status('Karte in den Rahmen halten – die Nummer (z. B. 025/165) steht unten.');
    this.recent = [];
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 450);
  },
  stop() {
    clearInterval(this.timer); this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const idle = $('#scan-idle');
    if (idle) { idle.hidden = false; $('#scan-guide').hidden = true; $('#scan-stop').hidden = true; }
  },
  async tick() {
    const video = $('#scan-video'), guide = $('#scan-guide');
    if (this.busy || !video || !this.stream || video.readyState < 2 || document.hidden) return;
    this.busy = true;
    try {
      // Rahmen (Bildschirm) → Videopixel; das Video füllt die Fläche per object-fit: cover
      const vr = video.getBoundingClientRect(), gr = guide.getBoundingClientRect();
      const scale = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight);
      const offX = (video.videoWidth * scale - vr.width) / 2, offY = (video.videoHeight * scale - vr.height) / 2;
      const gx = (gr.left - vr.left + offX) / scale, gy = (gr.top - vr.top + offY) / scale, gw = gr.width / scale, gh = gr.height / scale;
      // Nummernzeile: unterste ~11 % der Karte, ganze Breite (je nach Kartenära links oder rechts)
      const r = await this.read(video, [gx, gy + gh * 0.875, gw, gh * 0.125, 1400], this.round++);
      const hit = r.sig && this.recent.some((x) => x.sig === r.sig);
      this.recent.push(r); if (this.recent.length > 3) this.recent.shift();
      if (hit && !(r.sig === this.liveLast && this.current?.sig !== r.sig)) { this.liveLast = r.sig; this.hit(r); }
    } catch { /* nächster Durchlauf */ } finally { this.busy = false; }
  },
  async photo(file) {
    this.status('Foto wird ausgewertet …');
    try {
      const bmp = await createImageBitmap(file);
      const W = bmp.width, H = bmp.height;
      const r = await this.recognize(bmp, [
        [0, H * 0.88, W, H * 0.12, 1400],          // Karte füllt das Foto: nur die Nummernzeile
        [0, H * 0.8, W, H * 0.2, 1600],
        [0, H * 0.55, W, H * 0.45, 1800],          // Karte mit Rand fotografiert
      ]);
      if (r) { this.liveLast = r.sig; this.hit(r); } else this.status('Keine Kartennummer erkannt. Fotografiere die Karte näher und gerade oder gib die Nummer ein.');
    } catch { this.status('Das Foto konnte nicht gelesen werden.'); }
  },

  hit(r) {
    if (this.current?.sig !== r.sig) {
      this.current = r;
      this.sel = r.cards.length === 1 ? r.cards[0].k : (r.cards.find((c) => qty(c.k))?.k || null);
      navigator.vibrate?.(40);
    }
    if (store.fast && r.cards.length === 1) { this.fastAdd(r.cards[0]); return; }
    const label = r.sig.startsWith('name:') ? `„${r.sig.slice(5)}“` : `Nr. ${r.sig.replace(/^[^|]*\|/, '')}`;
    this.status(r.cards.length === 1 ? `${displayName(r.cards[0])} erkannt` : `${r.cards.length} Karten passen zu ${label} – wähle deine`, true);
    this.drawResult();
  },
  // Schnell-Scan: dieselbe Karte zählt erst wieder, wenn sie ~3,5 s nicht mehr gesehen wurde.
  fastAdd(card) {
    const now = Date.now(), prev = this.fastSeen[card.k] || 0;
    this.fastSeen[card.k] = now;
    if (now - prev < 3500) { this.status(`${displayName(card)} erfasst – nächste Karte hinhalten`, true); return; }
    setQty(card.k, 'n', (item(card.k)?.n || 0) + 1);
    this.fastLog.unshift({ k: card.k, at: now });
    if (this.fastLog.length > 60) this.fastLog.pop();
    navigator.vibrate?.(30);
    this.status(`${displayName(card)} +1 · ${eur(valueOf(card))}`, true);
    this.drawResult();
    this.drawFastLog();
  },
  undoFast() {
    const last = this.fastLog.shift();
    if (!last) return;
    setQty(last.k, 'n', Math.max(0, (item(last.k)?.n || 0) - 1));
    this.fastSeen[last.k] = 0;
    this.drawFastLog();
    toast('Letzte Karte zurückgenommen.');
  },
  drawFastLog() {
    const box = $('#scan-fastlog');
    if (!box) return;
    if (!store.fast) { box.hidden = true; return; }
    box.hidden = false;
    const n = this.fastLog.length;
    const sum = this.fastLog.reduce((s, e) => s + valueOf(DB.byKey.get(e.k)), 0);
    box.innerHTML = `
      <div class="fastlog-head"><b>Schnell-Scan</b><span class="hint">${n ? `${n} Karten · ${eur(sum)}` : 'bereit – Karten nacheinander hinhalten'}</span>${n ? '<button class="btn small" data-act="scan-undo">Rückgängig</button>' : ''}</div>
      ${n ? '<p class="hint">Jede eindeutig erkannte Karte zählt als „normal“ +1. Ist eine Nummer mehrdeutig, erscheint die Auswahl unten. Reverse Holos kannst du in der Karte anpassen.</p>' : ''}
      ${this.fastLog.slice(0, 15).map((e) => { const c = DB.byKey.get(e.k); return c ? `<button class="fastlog-row open" data-act="open" data-k="${esc(c.k)}">${art(c)}<span class="nm"><b>${esc(displayName(c))}</b><span>${esc(c.set.name)} · ${esc(numLabel(c))} · ${eur(valueOf(c))} · jetzt ${qty(c.k)}×</span></span></button>` : ''; }).join('')}`;
  },
  status(msg, hit) { const el = $('#scan-status'); if (el) { el.textContent = msg; el.classList.toggle('hit', !!hit); } },

  drawResult() {
    const box = $('#scan-result');
    if (!box) return;
    const r = this.current;
    if (!r || (store.fast && r.cards.length === 1)) { box.hidden = true; return; }
    const card = DB.byKey.get(this.sel);
    const p = priceOf(card);
    const it = card ? item(card.k) : null;
    box.hidden = false;
    box.innerHTML = `
      ${r.cards.length > 1 ? `<p class="hint">${r.cards.length} Karten haben diese Nummer – tippe deine an (Tipp: oben ein Set festlegen, dann ist die Nummer eindeutig):</p>
        <div class="cands">${r.cards.map((c) => `<button data-act="scan-sel" data-k="${esc(c.k)}" aria-pressed="${c.k === this.sel}">${art(c)}<small>${esc(c.set.name)}</small><small>${esc(numLabel(c))} · ${eur(valueOf(c))}</small></button>`).join('')}</div>` : ''}
      ${card ? `<div class="result-head">${art(card, true)}
        <div class="info"><h2>${esc(displayName(card))}</h2>
          <p class="sub">${altName(card) ? `${esc(altName(card))} · ` : ''}${esc(card.set.name)}</p>
          <p class="sub">${dots(card)} ${esc(numLabel(card))}${card.r ? ` · ${esc(card.r)}` : ''}</p>
          <p class="price">${p && !p.none ? `${eur(p.value)} <span class="hint">Cardmarket-Trend</span> ${chgHtml(p.move)}` : '<span class="hint">kein Cardmarket-Preis</span>'}</p>
          ${p?.rValue ? `<p class="sub">Reverse Holo: ${eur(p.rValue)}</p>` : ''}
        </div></div>
      <div class="row"><button class="btn primary grow" data-act="scan-add" data-f="n">+1 normal</button><button class="btn grow" data-act="scan-add" data-f="rh">+1 Reverse Holo</button></div>
      <div class="row" style="justify-content:space-between"><span class="hint">In der Sammlung: <b>${it ? `${it.n || 0}× normal, ${it.rh || 0}× Reverse` : 'noch nicht'}</b></span>
        <span class="row">${p?.id ? `<a class="btn small" href="${cmProduct(p.id)}" target="_blank" rel="noopener">Cardmarket ↗</a>` : ''}<button class="btn small" data-act="open" data-k="${esc(card.k)}">Details</button></span></div>` : ''}`;
  },
};

function viewScan() {
  $('#title').textContent = 'Scannen';
  const lock = DB.sets.find((s) => s.id === store.lockSet);
  view.innerHTML = `
    <div class="scanner">
      <video id="scan-video" playsinline muted autoplay></video>
      <div class="guide poke" id="scan-guide" hidden></div>
      <div class="idle" id="scan-idle"><p>Die App liest die Kartennummer unten auf der Karte (z. B. „MEW 025/165“) und zeigt dir den Cardmarket-Preis.</p><button class="btn primary" data-act="scan-start">Kamera starten</button></div>
    </div>
    <div class="lockbar"><span>Set</span>
      <select class="field grow" id="scan-lock" aria-label="Set festlegen"><option value="">alle Sets (automatisch erkennen)</option>${setOptions(store.lockSet)}</select></div>
    ${lock ? '' : '<p class="hint" style="margin-top:-6px">Tipp: Scannst du viele Karten aus einem Set, lege es hier fest – dann reicht die Nummer und es gibt keine Rückfragen.</p>'}
    <label class="chk fast"><input type="checkbox" id="scan-fast" ${store.fast ? 'checked' : ''}> Schnell-Scan: jede erkannte Karte automatisch +1</label>
    <p class="scan-status" id="scan-status"></p>
    <div class="result" id="scan-result" hidden></div>
    <div class="fastlog" id="scan-fastlog" hidden></div>
    <div class="row">
      <label class="btn grow">Foto aufnehmen<input type="file" id="scan-file" accept="image/*" capture="environment" hidden></label>
      <button class="btn" id="scan-stop" data-act="scan-stop" hidden>Kamera aus</button>
    </div>
    <form class="row" id="scan-manual">
      <input class="field grow" id="scan-num" placeholder="Nummer oder Name, z. B. 025/165, MEW 25, Glurak" autocomplete="off" spellcheck="false">
      <button class="btn" type="submit">Suchen</button>
    </form>`;
  Scanner.drawResult();
  Scanner.drawFastLog();
  $('#scan-lock').onchange = (e) => { store.lockSet = e.target.value; saveStore(); Scanner.current = null; Scanner.recent = []; rerender(); };
  $('#scan-fast').onchange = (e) => { store.fast = e.target.checked; saveStore(); Scanner.drawResult(); Scanner.drawFastLog(); Scanner.status(store.fast ? 'Schnell-Scan an – Karten nacheinander hinhalten.' : ''); };
  $('#scan-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) Scanner.photo(f); };
  $('#scan-manual').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('#scan-num').value.trim();
    if (!raw) return;
    const r = parseScanText(raw, store.lockSet);
    if (r.cards.length) { Scanner.liveLast = null; Scanner.current = null; Scanner.hit(r); $('#scan-num').value = ''; return; }
    // Kein Nummernformat: nach Namen suchen (im festgelegten Set zuerst)
    const byName = DB.cards.filter((c) => (!store.lockSet || c.set.id === store.lockSet) && matches(c, raw));
    if (byName.length && byName.length <= 60) { Scanner.current = null; Scanner.hit({ sig: `name:${raw}`, cards: sortCards(byName, 'set') }); $('#scan-num').value = ''; }
    else if (byName.length) { ui.suche.q = raw; ui.suche.set = store.lockSet; location.hash = 'suche'; }
    else Scanner.status(`„${raw}“ wurde nicht gefunden.`);
  };
}

/* ---------- Aktionen ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, k } = el.dataset;
  switch (act) {
    case 'open': openCard(k); break;
    case 'close-sheet': sheet.close(); break;
    case 'zoom': {
      const card = DB.byKey.get(sheetKey); if (!card) break;
      const z = document.createElement('button');
      z.className = 'zoom'; z.setAttribute('aria-label', 'Großansicht schließen');
      z.innerHTML = `<img src="${esc(imgLarge(card))}" alt="${esc(card.name)}">`;
      z.onclick = () => z.remove();
      sheet.append(z);
      break;
    }
    case 'qty': {
      const f = el.dataset.f, d = +el.dataset.d, before = item(sheetKey)?.[f] || 0;
      const key = sheetKey, snapshot = store.items[key] ? { ...store.items[key] } : null;
      setQty(key, f, before + d);
      openCard(key);
      if (!qty(key) && snapshot) toast('Aus der Sammlung entfernt.', () => { store.items[key] = snapshot; saveStore(); if (sheetKey === key) openCard(key); else rerender(); });
      break;
    }
    case 'watch': if (store.watch[sheetKey]) delete store.watch[sheetKey]; else store.watch[sheetKey] = 1; saveStore(); openCard(sheetKey); break;
    case 'alarm-save': {
      const above = parseMoney($('#al-above').value), below = parseMoney($('#al-below').value);
      if (above == null && below == null) { delete store.alarms[sheetKey]; toast('Keine Grenze eingetragen.'); }
      else { store.alarms[sheetKey] = { above, below }; toast('Preis-Alarm gespeichert.'); }
      saveStore(); trackSnapshots(); openCard(sheetKey); break;
    }
    case 'alarm-clear': delete store.alarms[sheetKey]; saveStore(); openCard(sheetKey); toast('Grenzen gelöscht.'); break;
    case 'export': exportBackup(); break;
    case 'export-csv': exportCsv(); break;
    case 'lang': store.lang = el.dataset.v; saveStore(); rerender(); break;
    case 'view': store.view = el.dataset.v; saveStore(); rerender(); break;
    case 'notify-toggle': enableNotifications(); break;
    case 'alert-ack': ackAlert(k, el.dataset.kind); rerender(); break;
    case 'alert-ack-all': for (const a of priceAlerts()) ackAlert(a.card.k, a.kind); rerender(); break;
    case 'set-filter': ui.set.filter = el.dataset.v; rerender(); break;
    case 'lock-set': store.lockSet = el.dataset.set; saveStore(); Scanner.current = null; location.hash = 'scan'; break;
    case 'back': history.length > 1 ? history.back() : (location.hash = 'suche'); break;
    case 'toast-undo': if (toastUndo) { const f = toastUndo; toastUndo = null; $('#toast').hidden = true; f(); } break;
    case 'scan-start': Scanner.start(); break;
    case 'scan-stop': Scanner.stop(); Scanner.status(''); break;
    case 'scan-undo': Scanner.undoFast(); break;
    case 'scan-sel': Scanner.sel = k; Scanner.drawResult(); break;
    case 'scan-add': {
      const card = DB.byKey.get(Scanner.sel), f = el.dataset.f;
      if (card) {
        setQty(card.k, f, (item(card.k)?.[f] || 0) + 1);
        Scanner.drawResult();
        toast(`${displayName(card)} – jetzt ${qty(card.k)}× in der Sammlung`, () => { setQty(card.k, f, Math.max(0, (item(card.k)?.[f] || 0) - 1)); Scanner.drawResult(); });
      }
      break;
    }
  }
});
document.addEventListener('change', (e) => { if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]); });
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) Scanner.stop(); });
window.addEventListener('hashchange', route);

/* ---------- Start ---------- */
(async function init() {
  loadStore();
  try { await loadData(); }
  catch { view.innerHTML = '<p class="empty"><strong>Kartendatenbank nicht erreichbar</strong>Prüfe die Internetverbindung und lade die Seite neu.</p>'; return; }
  ensureBaselines();
  trackSnapshots();
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  maybeNotify(false);
})();
