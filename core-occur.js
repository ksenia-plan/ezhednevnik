// Раскладка задач по дням: какие задачи стоят на конкретную дату.
// Учитывает тип задачи, правило повторения, условие по признакам дня, лимит «N раз в неделю»,
// переносы отдельных повторений, пропуски и выполнение.
import { state } from './core-store.js';
import { matchesRule, nextAfterDue } from './core-recur.js';
import { evalCond } from './core-cond.js';
import { addDays, weekStart, toMin, fromMin, today, D } from './core-dates.js';
import { flagsOf } from './core-flags.js';
import { nextBirthday } from './birthdays-model.js';

let dayCache = new Map(), weekCache = new Map();
export function resetOccurCache() { rotCache.clear(); flagDayCache.clear(); dayCache = new Map(); weekCache = new Map(); afterCache.clear(); }

/** Подходит ли день задаче без учёта лимита в неделю. */
function baseMatch(t, ds) {
  if (t.archived) return false;
  if ((t.kind === 'once' || t.kind === 'event') && t.ctx && !t.date && t.ctx !== 'work') return !t.done && ds === planDate(t); // «на ближайшую дачу»
  if (t.kind === 'once' || t.kind === 'event') return t.date === ds;
  if (t.kind === 'span') return ds >= t.date && ds <= (t.end || t.date);
  if (t.kind !== 'repeat') return false;
  if (t.rule?.freq === 'after') return ds === afterDay(t);
  if (!matchesRule(t, ds)) return false;
  return evalCond(t.cond, ds);
}

/** «Через N после выполнения»: первый подходящий по условию день не раньше срока;
 *  если срок прошёл и не сделано — висит на сегодняшнем дне, пока не отметишь. */
const afterCache = new Map();
export function afterDay(t) {
  if (afterCache.has(t.id)) return afterCache.get(t.id);
  // срок считается от последнего визита или от уже существующей записи (в том числе будущей)
  const dones = Object.keys(t.doneOn || {}).filter(k => t.doneOn[k]);
  // если есть записи в календаре — считаем от них (перенос/удаление записи сразу меняет расчёт); иначе — от последнего визита
  const la = lastAppt(t);
  const last = [la || t.lastDone, ...dones].filter(Boolean).sort().pop() || null;
  let d = nextAfterDue({ ...t, doneOn: {}, lastDone: last }); const td = today();
  if (d < td) d = td;
  let r = null;
  for (let i = 0; i < 60; i++) { if (evalCond(t.cond, d)) { r = d; break; } d = addDays(d, 1); }
  afterCache.set(t.id, r);
  return r;
}

/** Жёстко занятое время дня: разовые дела и записи со временем, работа и другие фиксированные дела.
 *  Не учитываются: гибкие (flex), «не занимает время» (info) и задачи с лимитом «N в неделю» — их раскладываем сами. */
/** В день сдачи крови работа (с дорогой) начинается после донации — приезжаю позже, конец дня тот же. */
function donorAdjust(u, ds, s, d) {
  if (!u.block || !flagsOf(ds).has('donor')) return [s, d];
  const ap = state.tasks.find(x => x.kind === 'once' && x.date === ds && /кров|донор/i.test(x.title) && !x.booking && x.time);
  if (!ap) return [s, d];
  const from = toMin(ap.time) + (+ap.dur || 60), end = s + d;
  return from > s && from < end ? [from, end - from] : [s, d];
}
function fixedBusy(ds, except) {
  const iv = [];
  for (const u of state.tasks) {
    if (u === except || u.archived || u.info || u.flex || u.done) continue;
    if (u.kind === 'repeat' && +u.rule?.perWeek) {
      // для гибких задач с лимитом (уборка) уже разложенный фитнес — тоже занятое время
      if (except && except.flex) { const tm = weekPicks(u, weekStart(ds)).get(ds); if (tm) { const s = toMin(tm); iv.push([s, s + durFor(u, ds)]); } }
      continue;
    }
    const mv = u.moves || {}, sk = u.skip || {};
    const add = (orig) => { const tm = (u.moveTimes || {})[orig] || timeFor(u, ds); if (tm) { const [s, d] = donorAdjust(u, ds, toMin(tm), durFor(u, ds)); iv.push([s, s + d, !!u.block]); } };
    if (baseMatch(u, ds) && !mv[ds] && !sk[ds]) add(ds);
    for (const o in mv) if (mv[o] === ds && !sk[o]) add(o);
  }
  return iv;
}
/** Найти время для задачи в этот день: предпочтительное или ближайшее свободное (позже до 1,5 ч, раньше до 1 ч).
 *  Между делами оставляем 15 минут на дорогу. Возвращает {start, shift} или null, если места нет. */
function slotFor(t, ds) {
  const pref = toMin(timeFor(t, ds)); if (pref === null) return { start: null, shift: 0 };
  const st = state.settings, off = flagsOf(ds).has('my_off');
  const lo = toMin(off ? st.dayStartOff : st.dayStart) ?? 300, hi = toMin(off ? st.dayEndOff : st.dayEnd) ?? 1260;
  const d = durFor(t, ds), gap = 15, busy = fixedBusy(ds, t);
  // работа уже включает дорогу — после неё можно сразу
  const free = x => x >= lo && x + d <= hi && busy.every(([a, z, blk]) => x + d + gap <= a || x >= z + (blk ? 0 : gap));
  for (const k of [0, 15, -15, 30, -30, 45, 60, -45, -60, 75, 90]) if (free(pref + k)) return { start: pref + k, shift: Math.abs(k) };
  return null;
}

/** Для задач с лимитом «не больше N в неделю» — выбранные дни недели: только те, где есть свободное время,
 *  сначала дни без сдвига времени, дни разносятся не подряд. Возвращает Map(дата → время). */
function weekPicks(t, mon) {
  if (t.group) return groupPicks(t.group, mon).get(t.id) || new Map();
  const key = t.id + mon;
  if (weekCache.has(key)) return weekCache.get(key);
  const max = +t.rule.perWeek;
  const cand = [];
  for (let i = 0; i < 7; i++) { const ds = addDays(mon, i); if (!baseMatch(t, ds)) continue; const sl = slotFor(t, ds); if (sl) cand.push({ ds, i, ...sl }); }
  const good = cand.filter(c => c.shift <= 30), rest = cand.filter(c => c.shift > 30);
  const take = [];
  // rule.spread === false — можно два дня подряд; иначе стараемся разносить через день
  if (t.rule.spread === false) { for (const c of [...good, ...rest]) { if (take.length >= max) break; take.push(c); } }
  else {
    for (const c of good) { if (take.length >= max) break; if (take.every(x => Math.abs(x.i - c.i) >= 2)) take.push(c); }
    for (const c of [...good, ...rest]) { if (take.length >= Math.min(2, max)) break; if (!take.includes(c)) take.push(c); }
  }
  const map = new Map(take.map(x => [x.ds, x.start === null ? null : fromMin(x.start)]));
  weekCache.set(key, map);
  return map;
}

/** Группа дел «N раз в неделю», которые считаются вместе (спорт: фитнес + падел).
 *  Общий лимит — наибольший perWeek в группе; сначала дела с узкими условиями (падел), один спорт в день. */
function groupPicks(g, mon) {
  const key = 'g:' + g + mon;
  if (weekCache.has(key)) return weekCache.get(key);
  const ts = state.tasks.filter(x => x.group === g && x.kind === 'repeat' && !x.archived && +x.rule?.perWeek);
  const max = Math.max(...ts.map(x => +x.rule.perWeek)), used = new Set(), res = new Map(ts.map(x => [x.id, new Map()]));
  const cands = x => { const c = []; for (let i = 0; i < 7; i++) { const ds = addDays(mon, i); if (!baseMatch(x, ds)) continue; const sl = slotFor(x, ds); if (sl) c.push({ ds, ...sl }); } return c; };
  const all = ts.map(x => ({ x, c: cands(x) })).sort((a, b) => a.c.length - b.c.length || +a.x.rule.perWeek - +b.x.rule.perWeek);
  let total = 0;
  for (const { x, c } of all) {
    let n = 0;
    for (const k of [...c.filter(k => k.shift <= 30), ...c.filter(k => k.shift > 30)]) {
      if (total >= max || n >= +x.rule.perWeek) break;
      if (used.has(k.ds)) continue;
      used.add(k.ds); res.get(x.id).set(k.ds, k.start === null ? null : fromMin(k.start)); n++; total++;
    }
  }
  weekCache.set(key, res);
  return res;
}

function matches(t, ds) {
  if (!baseMatch(t, ds)) return false;
  if (t.kind === 'repeat' && +t.rule?.perWeek) return weekPicks(t, weekStart(ds)).has(ds);
  return true;
}

/** Длительность на день: в мои выходные может быть своя (durOff), например спорт — 2,5 ч. */
export function durFor(t, ds) { return (t.durOff && flagsOf(ds).has('my_off') ? +t.durOff : +t.dur) || 30; }
/** Время задачи на день: в мои выходные может быть своё время. */
export function timeFor(t, ds) {
  if (t.timeOff && flagsOf(ds).has('my_off')) return t.timeOff;
  return t.time || '';
}

/**
 * Все пункты на день: [{task, ds, orig, time, dur, done, moved, bday}]
 * orig — исходная дата повторения (для переносов и отметок).
 */
export function itemsOn(ds) {
  if (dayCache.has(ds)) return dayCache.get(ds);
  const out = [];
  for (const t of state.tasks) {
    const moves = t.moves || {};
    const movedHere = Object.keys(moves).filter(o => moves[o] === ds && !(t.skip || {})[o]);
    // если ты сама перенесла дело на этот день — автоматический повтор того же дела здесь не ставим
    if (matches(t, ds) && !moves[ds] && !(t.skip || {})[ds] && !(movedHere.length && t.kind === 'repeat')) out.push(mk(t, ds, ds));
    for (const orig of movedHere) out.push(mk(t, orig, ds, true));
  }
  // время с дочкой включает прогулку: отдельную прогулку в этот день не ставим, но напоминаем пройтись
  for (const i of out.filter(x => x.task && x.task.absorbs && !x.done)) {
    const k = out.findIndex(x => x.task && x.task.kind === 'repeat' && x.task.title === i.task.absorbs && !x.moved);
    if (k >= 0) { out.splice(k, 1); i.withWalk = true; }
  }
  // подзадачи: «купить краску за 2 дня до дачи» — отдельной строкой в свой день
  for (const t of state.tasks) {
    if (!t.subs || !t.subs.length || t.archived || t.done) continue;
    const base = planDate(t); if (!base) continue;
    for (const sb of t.subs) { const sd = addDays(base, -(+sb.before || 0)); if (sd === ds || (!sb.done && sd < today() && ds === today())) out.push({ task: t, sub: sb, ds, orig: 'sub:' + sb.id, time: '', dur: 0, done: !!sb.done }); }
  }
  for (const b of state.birthdays) if (nextBirthday(b, ds).ds === ds) out.push({ bday: b, ds, orig: ds, time: '', dur: 0, done: !!(b.greeted || {})[ds.slice(0, 4)] });
  placeFlex(out, ds);
  out.sort((a, b) => (toMin(a.time) ?? -1) - (toMin(b.time) ?? -1));
  dayCache.set(ds, out);
  return out;
}
/**
 * Раскладка времени дня без наложений. Приоритет (кто главнее, тот стоит на месте):
 *   1) поставленное вручную: разовые дела и записи со временем, работа, всё, что ты сама перенесла (день или время) — не трогаем;
 *   2) дела с лимитом «N в неделю» (фитнес, уборка) — их дни уже выбраны с учётом занятого времени;
 *   3) обычные повторы (зарядка, английский) — сдвигаются до 2 часов в ближайшее свободное время;
 *   4) гибкие дела (прогулка, чтение, счета) — в любое свободное время дня.
 * Если места не нашлось — дело уходит в «Без времени» с пометкой. «Не занимает моё время» (дети) не участвует.
 * Если наложились два дела первого уровня — оба помечаются конфликтом.
 */
function placeFlex(out, ds) {
  const st = state.settings, off = flagsOf(ds).has('my_off');
  const lo = toMin(off ? st.dayStartOff : st.dayStart) ?? 300, hi = toMin(off ? st.dayEndOff : st.dayEnd) ?? 1260;
  const timed = out.filter(i => i.task && i.time && !i.task.info && !i.done);
  const level = i => {
    const t = i.task;
    if (t.kind !== 'repeat' || t.block || (t.moveTimes || {})[i.orig] || i.moved) return 1;
    if (+t.rule?.perWeek) return 2;
    return t.flex ? 4 : 3;
  };
  const placed = [];
  const free = (x, d) => x >= lo && x + d <= hi && placed.every(p => x + d <= p.s || x >= p.e);
  // первый уровень: стоят на месте; наложения между ними — конфликт
  for (const i of timed.filter(i => level(i) === 1).sort((a, b) => toMin(a.time) - toMin(b.time))) {
    const s = toMin(i.time), e = s + i.dur;
    for (const p of placed) if (s < p.e && p.s < e) { i.conflict = p.i.task.title; p.i.conflict = p.i.conflict || i.task.title; }
    placed.push({ s, e, i });
  }
  for (const lv of [2, 3, 4]) {
    const items = timed.filter(i => level(i) === lv).sort((a, b) => toMin(a.time) - toMin(b.time));
    for (const i of items) {
      const pref = toMin(i.time), d = i.dur, lim = lv === 4 ? hi - lo : 120;
      let at = null;
      for (let k = 0; k <= lim; k += 5) { if (free(pref + k, d)) { at = pref + k; break; } if (k && free(pref - k, d)) { at = pref - k; break; } }
      if (at === null) { i.time = ''; i.noSlot = true; continue; }
      if (at !== pref) { i.time = fromMin(at); i.shifted = true; }
      placed.push({ s: at, e: at + d, i });
    }
  }
}
function mk(t, orig, ds, moved = false) {
  const picked = t.kind === 'repeat' && +t.rule?.perWeek && !moved ? weekPicks(t, weekStart(ds)).get(ds) : null;
  const time = (t.moveTimes || {})[orig] || picked || timeFor(t, ds);
  const done = t.kind === 'repeat' ? !!(t.doneOn || {})[orig] : !!t.done;
  const manual = t.kind !== 'repeat' || !!t.block || !!(t.moveTimes || {})[orig] || moved;
  if (t.block && time) { const [a, d] = donorAdjust(t, ds, toMin(time), +t.dur || 30); return { task: t, ds, orig, time: fromMin(a), dur: d, done, moved, manual, late: a !== toMin(time) }; }
  return { task: t, ds, orig, time, dur: durFor(t, ds), done, moved, manual };
}

/** Невыполненные разовые задачи с прошедшей датой. */
export function overdue() {
  const t = today();
  return state.tasks.filter(x => !x.archived && (x.kind === 'once') && x.date && x.date < t && !x.done && !(x.moves || {})[x.date]);
}

/** Задачи без даты (рабочие, «когда-нибудь»). */
export const undated = () => state.tasks.filter(x => !x.archived && x.kind === 'once' && !x.date && !x.done);

/** Занятые интервалы дня (в минутах) — для поиска свободных окон. */
export function busy(ds) {
  return itemsOn(ds).filter(i => i.task && i.time && !i.done && !i.task.info).map(i => [toMin(i.time), toMin(i.time) + i.dur]);
}

/** Свободные окна дня не короче minLen минут, в пределах подъём–отбой. */
export function freeGaps(ds, minLen = 30) {
  const st = state.settings, off = flagsOf(ds).has('my_off');
  let s = toMin(off ? st.dayStartOff : st.dayStart) ?? 300, e = toMin(off ? st.dayEndOff : st.dayEnd) ?? 1260;
  if (ds < today()) return [];
  if (ds === today()) { const n = new Date(); s = Math.max(s, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 5) * 5); }
  const b = busy(ds).sort((x, y) => x[0] - y[0]);
  const gaps = []; let cur = s;
  for (const [a, z] of b) { if (Math.min(a, e) - cur >= minLen) gaps.push([cur, Math.min(a, e)]); cur = Math.max(cur, z); }
  if (e - cur >= minLen) gaps.push([cur, e]);
  return gaps;
}

/** Ближайшие окна нужной длины, начиная с даты. */
export function slotsAhead(dur, n = 4, from = today()) {
  const out = [];
  for (let i = 0; i < 14 && out.length < n; i++) { const ds = addDays(from, i); for (const g of freeGaps(ds, dur)) { out.push({ ds, start: g[0] }); if (out.length >= n) break; } }
  return out;
}
export { D };

/**
 * Куда можно перенести дело: дни, где выполняется его условие (не дача, не цикл и т.п.),
 * где этого дела ещё нет и есть свободное время рядом с привычным. Возвращает [{ds, time}].
 */
export function moveOptions(t, orig, n = 6, from = today()) {
  const out = [];
  for (let i = 0; i < 28 && out.length < n; i++) {
    const ds = addDays(from, i), d = durFor(t, ds);
    if (ds === orig) continue;
    if (t.kind === 'repeat' && (t.rule?.freq === 'after' ? (t.cond && !evalCond(t.cond, ds)) : !baseMatch(t, ds))) continue; // правило (дни недели) и условия дела
    if (itemsOn(ds).some(it => it.task === t)) continue;
    const pref = toMin(timeFor(t, ds)) ?? toMin(t.time);
    const gaps = freeGaps(ds, d); if (!gaps.length) continue;
    let best = null;
    for (const [a, z] of gaps) {
      const s = pref === null ? a : Math.min(Math.max(pref, a), z - d);
      const dist = pref === null ? 0 : Math.abs(s - pref);
      if (!best || dist < best.dist) best = { s, dist };
    }
    if (pref !== null && best.dist > 180) continue; // слишком далеко от привычного времени
    out.push({ ds, time: fromMin(Math.round(best.s / 5) * 5) });
  }
  return out;
}
/** Почему дело не подходит на этот день (для предупреждения при ручном переносе). */
export function whyNot(t, ds) {
  if (t.kind === 'repeat' && t.cond && !evalCond(t.cond, ds)) return 'в этот день по условиям дело не ставится (например, дача, цикл или смена мужа)';
  if (itemsOn(ds).some(it => it.task === t)) return 'в этот день это дело уже стоит';
  return '';
}

/** Последняя запись на эту процедуру (разовое дело в «Уход и врачи»), включая будущие.
 *  «Записаться: маникюр» находит «Маникюр + Педикюр»; записи дочери считаются отдельно. */
export function lastAppt(t) {
  if (!t.booking) return null;
  const name = t.title.replace(/^Записаться:\s*/i, '').toLowerCase();
  const key = name.split(/[\s—–-]+/)[0].slice(0, 6), dau = /доч/.test(name);
  let best = null;
  for (const x of state.tasks) {
    if (x.kind !== 'once' || !(x.cat === 'care' || x.cat === 'beauty') || !x.date || x.booking) continue;
    const tl = x.title.toLowerCase();
    if (!tl.includes(key) || /доч/.test(tl) !== dau) continue;
    if (!best || x.date > best) best = x.date;
  }
  return best;
}

/** Свободные окна для новой ручной записи: гибкие дела и дела «N в неделю» не мешают — они сами подвинутся.
 *  ignoreBlock — не считать работу занятой (сдача крови утром — на работу после неё). */
export function freeForManual(ds, dur, ignoreBlock = false) {
  const st = state.settings, off = flagsOf(ds).has('my_off');
  let s = toMin(off ? st.dayStartOff : st.dayStart) ?? 300; const e = toMin(off ? st.dayEndOff : st.dayEnd) ?? 1260;
  if (ds < today()) return [];
  const iv = [];
  for (const u of state.tasks) {
    if (u.archived || u.info || u.flex || u.done || (u.kind === 'repeat' && +u.rule?.perWeek)) continue;
    if (ignoreBlock && u.block) continue;
    const mv = u.moves || {}, sk = u.skip || {};
    const add = o => { const tm = (u.moveTimes || {})[o] || timeFor(u, ds); if (tm) { const [a, d] = donorAdjust(u, ds, toMin(tm), durFor(u, ds)); iv.push([a, a + d]); } };
    if (baseMatch(u, ds) && !mv[ds] && !sk[ds]) add(ds);
    for (const o in mv) if (mv[o] === ds && !sk[o]) add(o);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const gaps = []; let cur = s;
  for (const [a, z] of iv) { if (Math.min(a, e) - cur >= dur) gaps.push([cur, Math.min(a, e)]); cur = Math.max(cur, z + 15); }
  if (e - cur >= dur) gaps.push([cur, e]);
  return gaps;
}

/** «Можно выбрать»: дела «N раз в неделю», которые подходят на этот день по условиям,
 *  но лимит недели уже набран другими днями. Возвращает [{task, time, picked:[{ds,time}]}]. */
export function altOn(ds) {
  if (ds < today()) return [];
  const out = [], mon = weekStart(ds);
  for (const t of state.tasks) {
    if (t.kind !== 'repeat' || t.archived || !+t.rule?.perWeek || !baseMatch(t, ds)) continue;
    const picks = weekPicks(t, mon); if (picks.has(ds)) continue;
    if (t.group && state.tasks.some(x => x !== t && x.group === t.group && weekPicks(x, mon).has(ds))) continue; // в этот день уже другой спорт
    if (itemsOn(ds).some(i => i.task === t)) continue; // уже перенесено сюда
    const sl = slotFor(t, ds); if (!sl || sl.start === null) continue;
    const picked = (t.group ? state.tasks.filter(x => x.group === t.group).flatMap(x => [...weekPicks(x, mon)].map(([d, tm]) => [d, tm, x])) : [...picks].map(([d, tm]) => [d, tm, t])).map(([d, tm, x]) => ({ d, tm, x })).filter(p => p.d >= today() && !(p.x.skip || {})[p.d] && !(p.x.moves || {})[p.d]).map(p => ({ ds: p.d, time: p.tm, task: p.x }));
    out.push({ task: t, time: fromMin(sl.start), picked });
  }
  return out;
}

/** Уборка по очереди: зона по порядку запланированных раз, начиная с недели rotFrom. */
const rotCache = new Map();
export function rotZone(t, orig) {
  if (!t.rotate || !t.rotate.length || t.kind !== 'repeat' || !+t.rule?.perWeek) return '';
  // порядок — по фактическим датам (с учётом переносов): зоны идут друг за другом в календаре
  if (!rotCache.has(t.id)) {
    const from = t.rotFrom || t.date || today(), seq = new Map(); let n = 0;
    for (let k = 0; k < 150; k++) { const ds = addDays(from, k); for (const i of itemsOn(ds)) if (i.task === t && !i.sub) seq.set(i.orig, n++); }
    rotCache.set(t.id, seq);
  }
  const n = rotCache.get(t.id).get(orig); if (n === undefined) return '';
  return t.rotate[n % t.rotate.length];
}
/** Название дела в календаре (с зоной уборки). */
const offDay = i => flagsOf(i.ds).has('my_off');
/** Название на день: у серий с разными буднями/выходными — пометка (labelWk / labelOff), у уборки — зона. */
export const itemTitle = i => !i.task ? '' : i.withWalk ? itemTitle({ ...i, withWalk: false }) + ' + прогулка 🚶' : i.sub ? '↳ ' + i.sub.title + ' — для «' + i.task.title + '»' : (i.task.labelWk || i.task.labelOff) ? i.task.title + ' · ' + (offDay(i) ? i.task.labelOff : i.task.labelWk) : i.task.title + (rotZone(i.task, i.orig) ? ': ' + rotZone(i.task, i.orig).toLowerCase() : '');
/** Цвет на день: будни — colorWk, выходные — colorOff (спорт, время с дочкой). */
export const itemColor = (i, base) => i.task && (i.task.colorWk || i.task.colorOff) ? (offDay(i) ? i.task.colorOff : i.task.colorWk) || base : base;

/** Ближайший день с признаком (дача, отпуск, больничный…) начиная с from. */
const flagDayCache = new Map();
export function nextFlagDay(flag, from = today()) {
  const k = flag + from; if (flagDayCache.has(k)) return flagDayCache.get(k);
  let r = null; for (let i = 0; i < 180; i++) { const d = addDays(from, i); if (flagsOf(d).has(flag)) { r = d; break; } }
  flagDayCache.set(k, r); return r;
}
/** Дата дела из планировщика: своя или ближайший день его признака. */
export function planDate(t) {
  if (t.date || !t.ctx || t.ctx === 'work') return t.date || null;
  // ближайший такой день, до которого успеваем сделать подготовку («купить краску за 2 дня»)
  const lead = Math.max(0, ...(t.subs || []).filter(s => !s.done).map(s => +s.before || 0));
  return nextFlagDay(t.ctx, addDays(today(), lead));
}
