import { isAppt } from './core-seed.js';
// Записи на процедуры и к врачам: когда подходит срок, приложение предлагает окна для новой записи.
// Своя запись (разовое дело со временем) никогда не двигается. Окна ищутся по правилам процедуры.
import { state } from './core-store.js';
import { evalCond } from './core-cond.js';
import { flagsOf, husbandShift } from './core-flags.js';
import { addDays, addMonths, today, toMin, fromMin, diffDays } from './core-dates.js';
import { freeForManual, afterDay, lastAppt } from './core-occur.js';

// Правила для окон записи: условие дня, длительность, удобное время в будни и выходные.
const H_WORKS = { op: 'and', items: [{ flag: 'h_works' }, { flag: 'dacha', not: true }, { flag: 'dacha_eve', not: true }] };
const MP_WDS = [2, 4, 6, 0]; // маникюр и педикюр — вторник, четверг, суббота, воскресенье
const RULES = [
  { re: /маникюр/i, dur: 120, cond: H_WORKS, wds: MP_WDS, wk: '18:30', off: '11:00', why: 'вт, чт, сб, вс, когда муж на смене; в будни в 18:30' },
  { re: /педикюр/i, dur: 120, tol: 7, cond: H_WORKS, wds: MP_WDS, wk: '18:30', off: '11:00', why: 'вт, чт, сб, вс, когда муж на смене; в будни в 18:30; раз в 5–7 недель' },
  { re: /брови/i, dur: 60, cond: { op: 'and', items: [{ flag: 'my_work' }, { flag: 'h_off' }, { flag: 'dacha_eve', not: true }] }, wk: '18:30', off: null, why: 'в мой рабочий день, когда муж выходной, в 18:30' },
  { re: /стрижк/i, dur: 60, cond: H_WORKS, wk: '18:30', off: '11:00', why: 'когда муж на смене' },
  { re: /спа/i, dur: 120, cond: { op: 'and', items: [{ flag: 'dacha', not: true }, { flag: 'dacha_eve', not: true }] }, wk: '18:30', off: '11:00', why: 'не в дни дачи' },
  { re: /кров/i, dur: 120, ignoreWork: true, cond: { op: 'and', items: [{ flag: 'my_work' }, { flag: 'dacha_eve', not: true }] }, wk: '09:00', off: null, why: 'утром в рабочий день, на работу — после сдачи' },
  { re: /гинеколог|стоматолог|невролог|врач/i, dur: 60, cond: { op: 'and', items: [{ flag: 'dacha', not: true }, { flag: 'dacha_eve', not: true }] }, wk: '18:30', off: '10:00', why: 'не в дни дачи' }
];
export const ruleFor = t => RULES.find(r => r.re.test(t.title)) || { dur: 60, cond: null, wk: '18:30', off: '11:00', why: '' };

/** Маникюр и педикюр: если сроки близко (до 10 дней), предлагаем один визит «Маникюр + педикюр» на 4 часа,
 *  только в мой выходной, когда муж на смене. */
const COMBO = { title: 'Маникюр + педикюр', dur: 240, wds: MP_WDS, cond: { op: 'and', items: [{ flag: 'my_off' }, ...H_WORKS.items] }, wk: null, off: '10:00', why: 'маникюр и педикюр вместе (4 ч) — в мой выходной (сб, вс, или праздник во вт/чт), когда муж на смене' };
export function comboFor(t) {
  if (!/маникюр|педикюр/i.test(t.title) || /доч/i.test(t.title)) return null;
  const other = state.tasks.find(x => x.booking && x !== t && /маникюр|педикюр/i.test(x.title) && !/доч/i.test(x.title));
  if (!other) return null;
  const a = afterDay(t), b = afterDay(other);
  if (!a || !b || Math.abs(diffDays(a, b)) > 10) return null;
  return { other, due: a < b ? a : b };
}

/** Окна для новой записи: n вариантов начиная за 5 дней до срока (но не раньше завтра).
 *  Для маникюра/педикюра — только сама процедура; если в этот день можно сделать обе (4 ч), у окна есть combo. */
export function bookingOptions(t, n = 4) {
  const r = ruleFor(t), due = afterDay(t) || today();
  let from = diffDays(today(), due) > 10 ? addDays(due, -10) : addDays(today(), 1); // окна — от 10 дней до срока
  const out = [], other = otherMP(t);
  for (let i = 0; i < 60 && out.length < n; i++) {
    const w = fitOn(r, addDays(from, i), new Set()); if (!w) continue;
    const prev = lastAppt(t) || t.lastDone || null;
    out.push({ ...w, title: apptTitle(t), ids: [t.id], combo: comboOn(other, t, w.ds), prev, norm: prev ? step(t, prev) : null, tol: r.tol || 0 });
  }
  return out;
}
/** Вторая процедура (маникюр ↔ педикюр), если это одна из них. */
function otherMP(t) {
  if (!/маникюр|педикюр/i.test(t.title) || /доч/i.test(t.title)) return null;
  const want = /маникюр/i.test(t.title) ? /педикюр/i : /маникюр/i;
  return state.tasks.find(x => x.booking && want.test(x.title) && !/доч/i.test(x.title)) || null;
}
/** Можно ли в день ds сделать обе процедуры: вторая скоро по сроку (±14 дней) и 4 часа помещаются по правилам. */
function comboOn(other, t, ds, otherDue) {
  if (!other) return null;
  const od = otherDue || afterDay(other); if (!od || Math.abs(diffDays(od, ds)) > 14) return null;
  // тот же день, иначе ближайший подходящий (до 7 дней в любую сторону, не раньше завтра)
  for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7]) {
    const d = addDays(ds, k); if (d <= today()) continue;
    const c = fitOn(COMBO, d, new Set()); if (c) return { ...c, title: COMBO.title, ids: [t.id, other.id] };
  }
  return null;
}
/** Название записи по задаче «Записаться: …». */
export const apptTitle = t => { const s = t.title.replace(/^Записаться:\s*/i, ''); return s[0].toUpperCase() + s.slice(1); };

/** Муж действительно на смене в это время: дневная — с 8:00 до 20:00, ночная — с 20:00 (по графику в настройках).
 *  Поэтому в день ночной смены вечерняя запись в 18:30 не подходит — муж ещё дома. */
function husbandAwayAt(ds, min) {
  const h = state.settings.husband, sh = husbandShift(ds);
  const rg = s => { const m = /(\d{1,2}):?(\d{2})?\s*[-–—]\s*(\d{1,2}):?(\d{2})?/.exec(s || ''); return m ? [(+m[1]) * 60 + (+m[2] || 0), (+m[3]) * 60 + (+m[4] || 0)] : null; };
  if (sh === 'Д') { const [a, z] = rg(h.day) || [480, 1200]; return min >= a && min < z; }
  if (sh === 'Н') { const [a] = rg(h.night) || [1200]; return min >= a; }
  return false;
}

/** Одно окно по правилу r не раньше (срок − 10 дней) и не раньше завтра; taken — уже занятые планом дни. */
function fitOn(r, ds, taken) {
  const off = flagsOf(ds).has('my_off');
  if (taken.has(ds) || (r.cond && !evalCond(r.cond, ds))) return null;
  if (r.wds && !r.wds.includes(new Date(ds + 'T12:00').getDay())) return null;
  const pref = toMin(off ? r.off : r.wk); if (pref === null) return null;
  if (state.tasks.some(x => x.kind === 'once' && isAppt(x) && x.date === ds)) return null;
  const g = freeForManual(ds, r.dur, !!r.ignoreWork).find(([a, z]) => pref >= a - 60 && pref <= z - r.dur + 60);
  if (!g) return null;
  const s = Math.min(Math.max(pref, g[0]), g[1] - r.dur);
  if (r.cond && JSON.stringify(r.cond).includes('h_works') && !husbandAwayAt(ds, s)) return null;
  return { ds, time: fromMin(Math.round(s / 5) * 5), dur: r.dur };
}
/** Первое окно по правилу r: начиная за 2 дня до срока (не раньше завтра), до span дней. */
function windowFor(r, due, taken, span = 25) {
  const t1 = addDays(today(), 1);
  if (r.tol) { // допуск ± tol дней: сначала ближайшие к сроку дни внутри диапазона, потом — позже
    const offs = [0]; for (let k = 1; k <= r.tol; k++) offs.push(-k, k);
    for (let k = r.tol + 1; k < span; k++) offs.push(k);
    for (const k of offs) { const d = addDays(due, k); if (d < t1) continue; const w = fitOn(r, d, taken); if (w) return w; }
    return null;
  }
  const from = addDays(due, -2) > t1 ? addDays(due, -2) : t1;
  for (let i = 0; i < span; i++) { const w = fitOn(r, addDays(from, i), taken); if (w) return w; }
  return null;
}
const step = (t, from) => (t.rule?.unit === 'months' ? addMonths(from, +t.rule.interval || 1) : addDays(from, +t.rule?.interval || 21));
const baseRule = t => RULES.find(r => r.re.test(t.title)) || { dur: 60, cond: null, wk: '18:30', off: '11:00' };

/**
 * План записей на 3 месяца вперёд от последней записи (или от сегодня, если записей нет).
 * Для маникюра и педикюра — общий план: когда сроки сходятся, один визит «Маникюр + педикюр» (4 ч).
 * Возвращает [{ds, time, dur, title, ids:[задачи «Записаться», которые закрывает запись]}].
 */
export function planFor(t) {
  const taken = new Set(), out = [];
  const isMP = /маникюр|педикюр/i.test(t.title) && !/доч/i.test(t.title);
  if (isMP) {
    const m = state.tasks.find(x => x.booking && /маникюр/i.test(x.title) && !/доч/i.test(x.title));
    const p = state.tasks.find(x => x.booking && /педикюр/i.test(x.title) && !/доч/i.test(x.title));
    let lm = (m && (lastAppt(m) || m.lastDone)) || today(), lp = (p && (lastAppt(p) || p.lastDone)) || today();
    const horizon = addMonths([lm, lp].sort().pop(), 3);
    for (let k = 0; k < 12; k++) {
      const dm = m ? step(m, lm) : null, dp = p ? step(p, lp) : null;
      const both = dm && dp && Math.abs(diffDays(dm, dp)) <= 10;
      const due = both ? [dm, dp].sort()[0] : (dm && (!dp || dm <= dp) ? dm : dp);
      if (!due || due > horizon) break;
      let r = both ? COMBO : (due === dm ? baseRule(m) : baseRule(p));
      let w = windowFor(r, due, taken);
      let combo = both;
      // вместе не получается в разумный срок — маникюр отдельно, педикюр догонит в следующий раз
      if (both && (!w || diffDays(due, w.ds) > 7)) { combo = false; r = baseRule(m); w = windowFor(r, dm, taken); }
      if (!w) break;
      // педикюр отдельно, а маникюр скоро — делаем вместе в этот день, если влезает 4 часа
      if (!combo && !both && due === dp && dm && Math.abs(diffDays(dm, w.ds)) <= 10) { const c = fitOn(COMBO, w.ds, taken); if (c) { w = c; combo = true; } }
      taken.add(w.ds);
      const isM = combo || (both ? true : due === dm);
      const ids = combo ? [m.id, p.id] : [isM ? m.id : p.id];
      out.push({ ...w, title: combo ? 'Маникюр + педикюр' : (isM ? 'Маникюр' : 'Педикюр'), ids });
      if (combo || isM) lm = w.ds; if (combo || !isM) lp = w.ds;
      // сроки совпали, но вместе (4 ч в выходной) не вышло — педикюр отдельным визитом
      if (both && !combo) { const wp = windowFor(baseRule(p), dp, taken); if (wp) { taken.add(wp.ds); out.push({ ...wp, title: 'Педикюр', ids: [p.id] }); lp = wp.ds; } }
    }
    out.sort((a, b) => a.ds < b.ds ? -1 : 1);
    // в карточке — только эта процедура; где можно обе сразу — пометка combo
    const me = /маникюр/i.test(t.title) ? m : p, oth = me === m ? p : m, myRule = baseRule(me);
    return out.filter(w => w.ids.includes(me.id)).map(w => {
      const own = w.ids.length > 1 ? (fitOn(myRule, w.ds, new Set()) || { ds: w.ds, time: w.time, dur: myRule.dur }) : w;
      const near = out.find(x => x.ids.includes(oth?.id) && x.ids.length === 1 && Math.abs(diffDays(x.ds, w.ds)) <= 14);
      const combo = w.ids.length > 1 ? { ds: w.ds, time: w.time, dur: w.dur, title: COMBO.title, ids: w.ids } : (near ? comboOn(oth, me, w.ds, near.ds) : null);
      return { ds: own.ds, time: own.time, dur: own.dur, title: apptTitle(me), ids: [me.id], combo };
    }).map((w, i, arr) => { const prev = i ? arr[i - 1].ds : (lastAppt(me) || me.lastDone || null); return { ...w, prev, norm: prev ? step(me, prev) : null, tol: baseRule(me).tol || 0 }; });
  }
  let last = lastAppt(t) || t.lastDone || today(), real = !!(lastAppt(t) || t.lastDone);
  const horizon = addMonths(last, 3), r = baseRule(t);
  for (let k = 0; k < 12; k++) {
    const due = step(t, last); if (due > horizon) break;
    const w = windowFor(r, due, taken); if (!w) break;
    taken.add(w.ds); out.push({ ...w, title: apptTitle(t), ids: [t.id], prev: real ? last : null, norm: real ? due : null, tol: r.tol || 0 }); last = w.ds; real = true;
  }
  return out;
}

/** Дни, когда можно сделать маникюр и педикюр за один визит (4 ч, мой выходной, муж на смене днём). */
export function comboDays(t) {
  const m = state.tasks.find(x => x.booking && /маникюр/i.test(x.title) && !/доч/i.test(x.title));
  const p = state.tasks.find(x => x.booking && /педикюр/i.test(x.title) && !/доч/i.test(x.title));
  if (!m || !p || /доч/i.test(t.title)) return [];
  const last = [lastAppt(m), lastAppt(p), today()].filter(Boolean).sort().pop(), end = addMonths(last, 3), out = [];
  const st = [addDays(today(), 1), addDays(last, 7)].sort().pop();
  for (let d = st; d <= end && out.length < 12; d = addDays(d, 1)) {
    const c = fitOn(COMBO, d, new Set()); if (c) out.push({ ...c, title: COMBO.title, ids: [m.id, p.id] });
  }
  return out;
}

/** Правило для уже стоящей записи (разовое дело «Уход и врачи»): по нему предлагаем дни для переноса. */
export function apptRule(t) {
  if (t.kind !== 'once' || !isAppt(t) || /доч/i.test(t.title)) return null;
  if (/маникюр/i.test(t.title) && /педикюр/i.test(t.title)) return COMBO;
  return RULES.find(r => r.re.test(t.title)) || null;
}
/** Дни для переноса записи — только по её правилам (не на дачу, нужные дни недели, смена мужа). */
export function apptMoveOptions(t, n = 6) {
  const r = apptRule(t); if (!r) return null;
  const rr = { ...r, dur: +t.dur || r.dur, wk: r.wk ? (t.time || r.wk) : null, off: r.off ? (t.time || r.off) : null };
  const out = [];
  for (let i = 1; i <= 60 && out.length < n; i++) {
    const ds = addDays(today(), i); if (ds === t.date) continue;
    const w = fitOn(rr, ds, new Set()); if (w) out.push(w);
  }
  return out;
}
/** Почему запись не подходит на этот день. */
export function apptWhyNot(t, ds) {
  const r = apptRule(t); if (!r) return '';
  if (flagsOf(ds).has('dacha')) return 'в этот день ты на даче';
  if (r.wds && !r.wds.includes(new Date(ds + 'T12:00').getDay())) return 'в этот день недели эту процедуру не записываем';
  if (r.cond && !evalCond(r.cond, ds)) return 'день не подходит по правилам записи: ' + (r.why || '');
  return '';
}

/** Подсказка об интервале: «через 24 дн. после предыдущей · на 3 дн. позже нормы». */
export function gapHint(prev, norm, ds, tol = 0) {
  if (!prev || !norm || !ds) return '';
  const gap = diffDays(prev, ds), d = diffDays(norm, ds);
  if (tol && Math.abs(d) <= tol) return `через ${gap} дн. (${(gap / 7).toFixed(1).replace('.', ',')} нед.) после предыдущей · в пределах нормы ${Math.round((diffDays(prev, norm) - tol) / 7)}–${Math.round((diffDays(prev, norm) + tol) / 7)} недель`;
  const tail = d === 0 ? 'точно по норме' : d > 0 ? `период увеличен на ${d} дн.` : `период сокращён на ${-d} дн.`;
  return `через ${gap} дн. после предыдущей · ${tail}`;
}

/** Для стоящей записи: предыдущая запись на ту же процедуру и нормативная дата следующей. */
export function apptGap(t, ds) {
  if (t.kind !== 'once' || !isAppt(t)) return '';
  const key = t.title.toLowerCase().split(/[\s—–+-]+/)[0].slice(0, 6), dau = /доч/i.test(t.title);
  const b = state.tasks.find(x => x.booking && x.title.toLowerCase().includes(key) && /доч/i.test(x.title) === dau); if (!b) return '';
  const prev = state.tasks.filter(x => x !== t && x.kind === 'once' && isAppt(x) && x.date && x.date < ds && x.title.toLowerCase().includes(key) && /доч/i.test(x.title) === dau).map(x => x.date).sort().pop() || b.lastDone;
  return prev ? gapHint(prev, step(b, prev), ds, ruleFor(b).tol || 0) : '';
}
