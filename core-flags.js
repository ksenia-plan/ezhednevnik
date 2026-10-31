// Признаки дня. Это основа условий: «ставить только когда муж на смене», «не в мой отпуск» и т.п.
// Автоматические признаки считаются из производственного календаря, графика мужа и цикла.
// Ручные признаки (отпуск, каникулы, дача…) пользователь ставит на день или период; их список редактируемый.
import { isWorkday, holidayName, SHORT } from './core-prodcal.js';
import { diffDays, addDays } from './core-dates.js';

export const DEFAULT_FLAG_TYPES = [
  { id: 'my_work', name: 'Мой рабочий день', color: '#2C64C6', auto: true },
  { id: 'my_off', name: 'Мой выходной', color: '#0B6E78', auto: true },
  { id: 'holiday', name: 'Праздник', color: '#C2477A', auto: true },
  { id: 'short_day', name: 'Сокращённый день', color: '#B26A00', auto: true },
  { id: 'h_day', name: 'Муж: дневная', color: '#C98A12', auto: true },
  { id: 'h_night', name: 'Муж: в ночь', color: '#4650C8', auto: true },
  { id: 'h_after', name: 'Муж: с ночи', color: '#8A6FB5', auto: true },
  { id: 'h_off', name: 'Муж: выходной', color: '#2E8B57', auto: true },
  { id: 'h_works', name: 'Муж на смене', color: '#C98A12', auto: true },
  { id: 'common_off', name: 'Общий выходной с мужем', color: '#0B6E78', auto: true },
  { id: 'cycle', name: 'Цикл', color: '#C0485A', auto: true },
  { id: 'dacha_eve', name: 'Вечером на дачу', color: '#3D8B6A', auto: true },
  { id: 'wknd', name: 'Суббота или воскресенье', color: '#8A94A0', auto: true },
  { id: 'donor', name: 'Сдача крови — на работу позже', color: '#C0392B', auto: true },
  // ручные — их можно переименовать, удалить, добавить свои
  { id: 'vac_me', name: 'Мой отпуск', color: '#E08A1E' },
  { id: 'vac_h', name: 'Отпуск мужа', color: '#7FA33A' },
  { id: 'kids_hol', name: 'Каникулы у детей', color: '#D9534F' },
  { id: 'dacha', name: 'Дача', color: '#3D8B6A' },
  { id: 'sick', name: 'Больничный', color: '#8B8F94' },
  { id: 'trip', name: 'Поездка', color: '#5B7FD6' }
];

export const SHIFT_NAMES = { 'Д': 'дневная', 'Н': 'в ночь', 'СН': 'с ночи', 'В': 'выходной' };

let ctx = null;          // { state } — подставляется при старте
let cache = new Map();
export function initFlags(state) { ctx = state; }
export function resetFlagCache() { cache = new Map(); }

/** Смена мужа по циклу: 'Д' | 'Н' | 'СН' | 'В'. */
export function husbandShift(ds) {
  const h = ctx.settings.husband;
  const c = String(h.cycle || '').split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(x => SHIFT_NAMES[x]);
  if (!c.length) return 'В';
  const n = diffDays(h.anchor || '2026-10-29', ds);
  return c[((n % c.length) + c.length) % c.length];
}

/** Ручные признаки, отмеченные на этот день. */
function manualFlags(ds) {
  const s = new Set();
  for (const m of ctx.flagMarks) if (ds >= m.from && ds <= (m.to || m.from)) s.add(m.flag);
  return s;
}

/** Информация о цикле на дату (или null). */
export function cycleInfo(ds) {
  const st = [...ctx.cycleStarts].sort();
  if (!st.length) return null;
  const len = cycleLen(), days = Math.min(10, Math.max(2, +ctx.settings.cycle.days || 5));
  let base = null; for (const x of st) if (x <= ds) base = x;
  if (!base) return null;
  const later = st.find(x => x > base); if (later && ds >= later) return null;
  const n = diffDays(base, ds), k = Math.floor(n / len), start = addDays(base, k * len), day = diffDays(start, ds) + 1;
  return { day, period: day <= days, predicted: k > 0, start, len };
}
export function cycleLen() {
  const st = [...ctx.cycleStarts].sort(); const d = [];
  for (let i = 1; i < st.length; i++) { const x = diffDays(st[i - 1], st[i]); if (x >= 20 && x <= 45) d.push(x); }
  if (d.length) { const last = d.slice(-6); return Math.round(last.reduce((a, b) => a + b, 0) / last.length); }
  return Math.min(45, Math.max(20, +ctx.settings.cycle.len || 28));
}

/** Дача в этот день: отмечена вручную или общий выходной с мужем (если ты не сняла отметку). */
export function isDachaDay(ds) {
  if (ctx.flagMarks.some(m => m.flag === 'dacha' && ds >= m.from && ds <= (m.to || m.from))) return true;
  if ((ctx.meta.dachaOff || {})[ds]) return false;
  const meOff = !isWorkday(ds) || ctx.flagMarks.some(m => (m.flag === 'vac_me' || m.flag === 'sick') && ds >= m.from && ds <= (m.to || m.from));
  const hOff = husbandShift(ds) === 'В' || ctx.flagMarks.some(m => m.flag === 'vac_h' && ds >= m.from && ds <= (m.to || m.from));
  return meOff && hOff;
}
/** Дача стоит автоматически (общий выходной), а не отмечена вручную. */
export const dachaIsAuto = ds => isDachaDay(ds) && !ctx.flagMarks.some(m => m.flag === 'dacha' && ds >= m.from && ds <= (m.to || m.from));

/** Все признаки дня (Set id). Результат кэшируется до следующего изменения данных. */
export function flagsOf(ds) {
  if (cache.has(ds)) return cache.get(ds);
  const f = manualFlags(ds);
  // день сдачи крови: работаю, но приезжаю позже; спорт и уборку в этот день не ставим
  if ((ctx.tasks || []).some(t => t.kind === 'once' && t.date === ds && /кров|донор/i.test(t.title) && !t.booking)) f.add('donor');
  const meOff = f.has('vac_me') || f.has('sick');
  f.add(isWorkday(ds) && !meOff ? 'my_work' : 'my_off');
  if (holidayName(ds)) f.add('holiday');
  { const w = new Date(ds + 'T12:00').getDay(); if (w === 0 || w === 6) f.add('wknd'); }
  if (SHORT.has(ds) && f.has('my_work')) f.add('short_day');
  let sh = husbandShift(ds);
  if (f.has('vac_h')) sh = 'В';
  f.add({ 'Д': 'h_day', 'Н': 'h_night', 'СН': 'h_after', 'В': 'h_off' }[sh]);
  if (sh === 'Д' || sh === 'Н') f.add('h_works');
  if (f.has('my_off') && sh === 'В') f.add('common_off');
  if (cycleInfo(ds)?.period) f.add('cycle');
  // дача: общий выходной с мужем — автоматически; вручную можно снять или поставить на любой день
  f.delete('dacha'); if (isDachaDay(ds)) f.add('dacha');
  // вечер перед дачей: я работаю, муж выходной, а завтра дача — после работы едем на дачу
  if (f.has('my_work') && !f.has('dacha') && f.has('h_off') && isDachaDay(addDays(ds, 1))) f.add('dacha_eve');
  cache.set(ds, f);
  return f;
}
export const has = (ds, id) => flagsOf(ds).has(id);
export const flagType = id => ctx.flagTypes.find(f => f.id === id);
