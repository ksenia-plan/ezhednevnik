// Перенос данных из прежней версии ежедневника (той же ссылки на Netlify или файла копии).
// Старая версия хранила всё одним объектом: {tasks, settings{appts, birthdays, dacha, cycle, kids…}}.
import { state, commit, uid } from './core-store.js';
import { today, addDays } from './core-dates.js';

const OLD_KEYS = ['planner-cache-v1', 'smart-planner-v1'];
export function findOldData() {
  for (const k of OLD_KEYS) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v && (v.tasks?.length || v.settings)) return v; } catch (e) { } }
  return null;
}

const PROC_TITLE = { manicure: 'маникюр', pedicure: 'педикюр', brows: 'брови', haircut: 'стрижка', spa: 'СПА', blood: 'сдача крови', gyn: 'гинеколог', dent: 'стоматолог', neuro: 'невролог' };
const PROC_NAME = { manicure: 'Маникюр', pedicure: 'Педикюр', brows: 'Брови', haircut: 'Стрижка', spa: 'СПА', blood: 'Сдача крови', gyn: 'Гинеколог', dent: 'Стоматолог', neuro: 'Невролог' };
const AREA = { work: 'work', family: 'family', health: 'health', english: 'english', business: 'study', personal: 'personal' };

/** Возвращает отчёт о том, что перенесено. */
export function migrateOld(v) {
  const s = v.settings || {}, rep = { tasks: 0, appts: 0, birthdays: 0, dacha: 0, cycle: 0, lastDone: 0 };
  const seen = new Set(state.tasks.map(t => t.title + '|' + t.date + '|' + (t.time || '')));
  const push = t => { const k = t.title + '|' + t.date + '|' + (t.time || ''); if (seen.has(k)) return false; seen.add(k); state.tasks.push(t); return true; };
  for (const o of v.tasks || []) {
    if (!o.title) continue;
    if (push({ id: uid(), title: o.title, kind: 'once', cat: AREA[o.area] || 'personal', date: o.date || '', time: o.time || '', dur: +o.duration || 30, important: !!o.important, urgent: !!o.urgent, done: !!o.done, note: o.note || '', createdAt: o.createdAt || Date.now() })) rep.tasks++;
  }
  // записи на процедуры → разовые события + дата для «записаться через N»
  const lastBy = {};
  for (const a of s.appts || []) {
    const items = a.items || [], who = a.who || 'me', ds = (a.dt || '').slice(0, 10), tm = (a.dt || '').slice(11, 16);
    if (!ds) continue;
    const title = items.map(k => PROC_NAME[k] || k).join(' + ') + (who === 'dau' ? ' — дочь' : '');
    if (push({ id: uid(), title, kind: 'once', cat: 'care', date: ds, time: tm, dur: 60 * items.length, note: a.note || '', createdAt: Date.now() })) rep.appts++;
    for (const k of items) { const key = k + (who === 'dau' ? ':dau' : ''); if (!lastBy[key] || ds > lastBy[key]) lastBy[key] = ds; }
  }
  for (const [k, d] of Object.entries(s.lastVisit || {})) { const key = k.replace(':me', ''); if (d && (!lastBy[key] || d > lastBy[key])) lastBy[key] = d; }
  for (const [key, d] of Object.entries(lastBy)) {
    const [k, w] = key.split(':'); const title = 'Записаться: ' + PROC_TITLE[k] + (w === 'dau' ? ' — дочь' : '');
    const t = state.tasks.find(x => x.booking && x.title === title);
    if (t) { t.lastDone = d; t.doneOn = {}; rep.lastDone++; }
  }
  for (const b of s.birthdays || []) {
    if (!b.name || !b.date || state.birthdays.some(x => x.name === b.name && x.date === b.date)) continue;
    state.birthdays.push({ id: uid(), name: b.name, date: b.date, who: b.who || '', noYear: !!b.noYear, warn: [7, 1] }); rep.birthdays++;
  }
  for (const [d, on] of Object.entries(s.dacha?.days || {})) if (on && !state.flagMarks.some(m => m.flag === 'dacha' && m.from === d)) { state.flagMarks.push({ id: uid(), flag: 'dacha', from: d, to: d }); rep.dacha++; }
  // дачный список дел → повторяющиеся дела «только в дни с признаком Дача»
  for (const title of s.dacha?.tasks || []) if (!state.tasks.some(t => t.title === title && t.cond?.items?.[0]?.flag === 'dacha'))
    state.tasks.push({ id: uid(), title, kind: 'repeat', cat: 'home', date: today(), dur: 30, rule: { freq: 'daily' }, cond: { op: 'and', items: [{ flag: 'dacha' }] }, createdAt: Date.now() });
  for (const d of s.cycle?.starts || []) if (!state.cycleStarts.includes(d)) { state.cycleStarts.push(d); rep.cycle++; }
  if (s.cycle) state.settings.cycle = { len: +s.cycle.len || 28, days: +s.cycle.days || 5 };
  for (const k of ['dayStart', 'dayEnd', 'dayStartOff', 'dayEndOff']) if (s[k]) state.settings[k] = s[k];
  if (s.husband?.cycle) state.settings.husband = { ...state.settings.husband, ...s.husband };
  if (s.meterLog) state.meta.meterLog = s.meterLog;
  if (s.notes) state.meta.notes = s.notes;
  state.meta.migratedAt = today();
  commit();
  return rep;
}
