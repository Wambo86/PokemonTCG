#!/usr/bin/env node
// Baut data/cards.json (Kartendatenbank aus PokemonTCG/pokemon-tcg-data, deutsche Pokémon-Namen aus PokeAPI)
// und data/prices.json (öffentliche Cardmarket-Preisdatei für Pokémon, Spiel-ID 6).
// Aufruf: node scripts/build-data.mjs
// Optional: POKE_CACHE=<Ordner> liest/schreibt heruntergeladene Rohdateien dort (zum lokalen Testen).
// Schlägt eine Quelle fehl, bleibt die vorhandene Datei unverändert.
//
// Cardmarket-Produkte tragen keine Kartennummer, nur „Name [Attacke | Attacke]“ und eine Erweiterungs-ID.
// Die Zuordnung läuft deshalb in zwei Schritten:
//   1. Jede Cardmarket-Erweiterung wird dem Set zugeordnet, mit dem sie die meisten Karten (Name + Attacken) teilt.
//      Gibt es mehrere Kandidaten (z. B. japanische Ausgabe), gewinnt die, deren Produkte um das Erscheinungsdatum angelegt wurden.
//   2. Innerhalb von Set und Erweiterung werden gleich lautende Karten und Produkte der Reihe nach gepaart
//      (Kartennummer ↔ Produkt-ID). Bleibt es mehrdeutig, bekommt die Karte alle passenden Produkte als „Versionen“.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data');
const CACHE = process.env.POKE_CACHE || '';

const RAW = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const SETS_URL = `${RAW}/sets/en.json`;
const cardsUrl = (id) => `${RAW}/cards/en/${id}.json`;
const SPECIES_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv';
const CM_PRODUCTS = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';
const CM_PRICES = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';

async function get(url, cacheName, asText = false) {
  if (CACHE && cacheName) {
    try { const t = await readFile(path.join(CACHE, cacheName), 'utf8'); return asText ? t : JSON.parse(t); } catch { /* nicht im Cache */ }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'kartentresor-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = asText ? text : JSON.parse(text);
      if (CACHE && cacheName) await writeFile(path.join(CACHE, cacheName), text).catch(() => {});
      return data;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cardNameKey = (s) => norm(String(s).replace(/δ/g, '').replace(/☆/g, ' star ').replace(/◇/g, ' prism star '));
const prodNameKey = (s) => norm(String(s).replace(/\bLv\.?\s?\d+\b/gi, '').replace(/δ|Delta Species/gi, ''));
const numSort = (a, b) => (parseInt(a.replace(/^\D+/, ''), 10) || 0) - (parseInt(b.replace(/^\D+/, ''), 10) || 0) || a.localeCompare(b);
const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'];

/* ---------- Karten ---------- */
async function loadCards() {
  const sets = await get(SETS_URL, 'sets.json');
  if (!Array.isArray(sets) || sets.length < 100) throw new Error('Set-Liste wirkt unvollständig');
  const lists = await pool(sets, 6, (s) => get(cardsUrl(s.id), `cards_${s.id}.json`));
  const cards = [];
  sets.forEach((s, i) => { for (const c of lists[i]) cards.push({ ...c, set: s }); });
  return { sets, cards };
}

async function germanNames() {
  const csv = await get(SPECIES_URL, 'pokemon_species_names.csv', true);
  const en = new Map(), de = new Map();
  for (const line of csv.split('\n').slice(1)) {
    const [id, lang, name] = line.split(',');
    if (lang === '9') en.set(+id, name); else if (lang === '6') de.set(+id, name);
  }
  return { en, de };
}

function imgCode(c) {
  const u = c.images?.small || '';
  if (u === `https://images.pokemontcg.io/${c.set.id}/${c.number}.png`) return '';
  if (u === `https://images.scrydex.com/pokemon/${c.id}/small`) return 'x';
  return u;
}

function buildCardsJson(sets, cards, names) {
  const setIdx = new Map(sets.map((s, i) => [s.id, i]));
  const outSets = sets.map((s) => ({
    id: s.id, name: s.name, series: s.series, total: s.printedTotal ?? s.total ?? null, all: s.total ?? null,
    code: s.ptcgoCode || '', date: (s.releaseDate || '').replace(/\//g, '-'),
    sym: s.images?.symbol || '',
  }));
  const outCards = cards.map((c) => {
    // Deutscher Name: englischen Artnamen durch den deutschen ersetzen („Charizard ex“ → „Glurak ex“)
    let de = '';
    for (const dex of c.nationalPokedexNumbers || []) {
      const e = names.en.get(dex), d = names.de.get(dex);
      if (e && d && e !== d && c.name.includes(e)) de = (de || c.name).replace(e, d);
    }
    const o = { k: c.id, s: setIdx.get(c.set.id), n: c.number, name: c.name };
    if (de) o.de = de;
    if (c.rarity) o.r = c.rarity;
    o.t = c.supertype === 'Pokémon' ? 'P' : c.supertype === 'Trainer' ? 'T' : 'E';
    if (c.subtypes?.length) o.sub = c.subtypes.join(', ');
    if (c.types?.length) o.ty = c.types.map((t) => TYPES.indexOf(t)).filter((x) => x >= 0);
    if (c.hp) o.hp = c.hp;
    if (c.artist) o.a = c.artist;
    if (c.regulationMark) o.rm = c.regulationMark;
    if (c.nationalPokedexNumbers?.length) o.dex = c.nationalPokedexNumbers[0];
    const moves = [...(c.abilities || []).map((x) => x.name), ...(c.attacks || []).map((x) => `${x.name}${x.damage ? ` ${x.damage}` : ''}`)];
    if (moves.length) o.mv = moves;
    const img = imgCode(c);
    if (img) o.img = img;
    return o;
  });
  if (outCards.length < 15000) throw new Error(`nur ${outCards.length} Karten – Quelle wirkt unvollständig`);
  return { updated: new Date().toISOString(), sets: outSets, cards: outCards };
}

/* ---------- Cardmarket-Zuordnung ---------- */
function matchProducts(sets, cards, products) {
  const byMove = new Map(), plain = new Map();
  for (const c of cards) {
    c._name = cardNameKey(c.name);
    c._mv = [...(c.abilities || []), ...(c.attacks || [])].map((a) => norm(a.name)).filter(Boolean);
    if (c._mv.length) for (const m of new Set(c._mv)) (byMove.get(m) || byMove.set(m, []).get(m)).push(c);
    else (plain.get(c._name) || plain.set(c._name, []).get(c._name)).push(c);
  }
  const candidates = (p) => {
    const m = p.name.match(/^(.*)\[([^[\]]*)\]\s*$/);
    const name = prodNameKey(m ? m[1] : p.name);
    const toks = new Set(m ? m[2].split('|').map(norm) : []);
    const out = new Set();
    for (const t of toks) for (const c of byMove.get(t) || []) {
      if (c._mv.every((x) => toks.has(x)) && (name === c._name || (c._name.length >= 4 && name.startsWith(c._name)))) out.add(c);
    }
    for (const c of plain.get(name) || []) out.add(c);
    return [...out];
  };

  const setSize = new Map();
  for (const c of cards) setSize.set(c.set.id, (setSize.get(c.set.id) || 0) + 1);
  const byExp = new Map();
  for (const p of products) {
    p._c = candidates(p);
    if (p._c.length) (byExp.get(p.idExpansion) || byExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
  }
  // Je Set: in Frage kommende Erweiterungen bewerten
  const pairs = new Map(); // setId -> [{e, n, med}]
  for (const [e, ps] of byExp) {
    const cnt = new Map(); // setId -> Set(Karten-IDs), die die Erweiterung abdeckt
    for (const p of ps) for (const c of p._c) (cnt.get(c.set.id) || cnt.set(c.set.id, new Set()).get(c.set.id)).add(c.id);
    const dates = ps.map((p) => p.dateAdded).filter((d) => d && !d.startsWith('0000')).sort();
    const med = dates.length ? Date.parse(dates[dates.length >> 1].slice(0, 10)) : NaN;
    for (const [s, ids] of cnt) (pairs.get(s) || pairs.set(s, []).get(s)).push({ e, n: ids.size, ep: ps.length, med });
  }
  const DAY = 864e5;
  const result = new Map(); // card id -> [idProduct...]
  for (const s of sets) {
    const size = setSize.get(s.id) || 0;
    const rel = Date.parse(s.releaseDate.replace(/\//g, '-'));
    const cands = (pairs.get(s.id) || []).filter((x) => x.n >= Math.max(2, size * 0.3));
    if (!cands.length) continue;
    // Englische Ausgaben legt Cardmarket kurz vor dem Erscheinen an; japanische Vorab-Sets liegen meist Monate davor.
    const inWin = cands.filter((x) => x.med >= rel - 30 * DAY && x.med <= rel + 60 * DAY);
    const pickFrom = inWin.length ? inWin : cands;
    const score = (x) => x.n / Math.max(x.ep, size);
    const best = pickFrom.sort((a, b) => score(b) - score(a) || b.n - a.n || a.e - b.e)[0];
    // Produkte der gewählten Erweiterung, die auf Karten dieses Sets passen, nach Kartengruppen bündeln
    const groups = new Map();
    for (const p of byExp.get(best.e)) {
      const cs = p._c.filter((c) => c.set.id === s.id);
      if (!cs.length) continue;
      const key = cs.map((c) => c.id).sort().join(',');
      (groups.get(key) || groups.set(key, { cs, ps: [] }).get(key)).ps.push(p);
    }
    for (const { cs, ps } of groups.values()) {
      cs.sort((a, b) => numSort(a.number, b.number));
      ps.sort((a, b) => a.idProduct - b.idProduct);
      const add = (c, id) => { const l = result.get(c.id) || result.set(c.id, []).get(c.id); if (!l.includes(id)) l.push(id); };
      if (cs.length === ps.length) cs.forEach((c, i) => add(c, ps[i].idProduct));
      else if (cs.length === 1) ps.forEach((p) => add(cs[0], p.idProduct)); // z. B. 1. Edition / Unlimitiert
      else if (ps.length > cs.length) {
        // Mehr Produkte als Karten: der Reihe nach paaren, Überzählige als weitere Versionen an alle hängen
        cs.forEach((c, i) => add(c, ps[i].idProduct));
        for (const p of ps.slice(cs.length)) for (const c of cs) add(c, p.idProduct);
      } else ps.forEach((p, i) => add(cs[i], p.idProduct)); // weniger Produkte als Karten: Rest bleibt ohne Preis
    }
  }
  return result;
}

async function buildPrices(sets, cards) {
  const [prod, guide] = await Promise.all([get(CM_PRODUCTS, 'products_singles_6.json'), get(CM_PRICES, 'price_guide_6.json')]);
  const byId = new Map(guide.priceGuides.map((g) => [g.idProduct, g]));
  const assigned = matchProducts(sets, cards, prod.products);
  const r2 = (v) => (v == null || v === 0 ? null : Math.round(v * 100) / 100);
  const p = {};
  let n = 0;
  for (const [cardId, ids] of assigned) {
    const rows = [];
    for (const id of ids) {
      const g = byId.get(id);
      if (!g) { rows.push([id]); continue; }
      // [idProduct, ab, Trend, Ø30, Ø7, Ø1, Reverse-Trend, Reverse-ab, Reverse-Ø30]
      const row = [id, r2(g.low), r2(g.trend), r2(g.avg30), r2(g.avg7), r2(g.avg1), r2(g['trend-holo']), r2(g['low-holo']), r2(g['avg30-holo'])];
      while (row.length > 1 && row[row.length - 1] == null) row.pop();
      rows.push(row);
    }
    if (rows.some((r) => r.length > 1)) n++;
    p[cardId] = rows;
  }
  if (n < 10000) throw new Error(`nur ${n} Karten mit Preis – Zuordnung wirkt unvollständig`);
  return { updated: guide.createdAt, p };
}

await mkdir(OUT, { recursive: true });
if (CACHE) await mkdir(CACHE, { recursive: true });
let failed = false;
let base;
try {
  base = await loadCards();
  const names = await germanNames().catch((err) => { console.error(`Deutsche Namen nicht verfügbar: ${err.message}`); return { en: new Map(), de: new Map() }; });
  const data = buildCardsJson(base.sets, base.cards, names);
  await writeFile(path.join(OUT, 'cards.json'), JSON.stringify(data));
  console.log(`cards.json: ok (${data.cards.length} Karten, ${data.sets.length} Sets, ${data.cards.filter((c) => c.de).length} mit deutschem Namen)`);
} catch (err) {
  failed = true;
  console.error(`cards.json: FEHLER – ${err.message} (alte Datei bleibt bestehen)`);
}
if (base) {
  try {
    const data = await buildPrices(base.sets, base.cards);
    await writeFile(path.join(OUT, 'prices.json'), JSON.stringify(data));
    console.log(`prices.json: ok (${Object.keys(data.p).length} Karten mit Cardmarket-Produkt, Stand ${data.updated})`);
  } catch (err) {
    failed = true;
    console.error(`prices.json: FEHLER – ${err.message} (alte Datei bleibt bestehen)`);
  }
} else failed = true;
process.exit(failed ? 1 : 0);
