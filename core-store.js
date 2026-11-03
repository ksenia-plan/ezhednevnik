// Хранилище. Все данные живут в памяти (объект state) и сохраняются в IndexedDB телефона.
// Если IndexedDB недоступна (редкие браузеры, приватный режим) — запасной вариант localStorage.
// Сервера нет: данные никуда не отправляются. Перенос между устройствами — копией (exportAll/importAll).
import { today } from './core-dates.js?v=2.6.3';
import { DEFAULT_FLAG_TYPES } from './core-flags.js?v=2.6.3';
import { DEFAULT_OCCASIONS } from './holidays-model.js?v=2.6.3';
import { seedTasks, extraTasks, DAUGHTER_WK_COND, ZONES, BEAUTY_RE } from './core-seed.js?v=2.6.3';

const DB_NAME = 'ezhednevnik';
const KEY = 'state-v2';
export const SCHEMA = 2;

export const state = {
  tasks: [],          // задачи всех типов (см. tasks/model.js)
  birthdays: [],      // {id, name, date:'YYYY-MM-DD', noYear, who, warn:[7,1]}
  flagTypes: [],      // справочник признаков дня
  flagMarks: [],      // отмеченные дни и периоды {id, flag, from, to, note}
  cycleStarts: [],    // даты начала цикла
  settings: {},       // режим, график мужа, тема
  meta: {}            // служебное: отклонённые подсказки, прогресс вкладок, дата последней копии
};

export const DEFAULT_SETTINGS = {
  theme: 'auto',
  dayStart: '05:00', dayEnd: '21:00', dayStartOff: '07:00', dayEndOff: '23:00',
  work: { start: '08:30', end: '17:00', commute: 60 },
  husband: { anchor: '2026-10-29', cycle: 'Д,Д,В,Н,Н,СН,В,В', day: '08:00-20:00', night: '20:00-08:00' },
  cycle: { len: 28, days: 5 },
  backupEveryDays: 7
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
async function idbGet(k) {
  const db = await openDB();
  return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
async function idbSet(k, v) {
  const db = await openDB();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

function snapshot() {
  return JSON.parse(JSON.stringify({ schema: SCHEMA, ...state }));
}
function apply(v) {
  state.tasks = v.tasks || [];
  state.birthdays = v.birthdays || [];
  state.flagTypes = v.flagTypes && v.flagTypes.length ? mergeFlagTypes(v.flagTypes) : JSON.parse(JSON.stringify(DEFAULT_FLAG_TYPES));
  state.flagMarks = v.flagMarks || [];
  state.cycleStarts = v.cycleStarts || [];
  state.settings = deep(DEFAULT_SETTINGS, v.settings || {});
  state.meta = v.meta || {};
}
// Автоматические признаки всегда берутся из кода (их нельзя удалить), ручные — из данных пользователя.
function mergeFlagTypes(list) {
  const auto = DEFAULT_FLAG_TYPES.filter(f => f.auto);
  const manual = list.filter(f => !f.auto);
  return [...auto.map(a => ({ ...a, ...(list.find(x => x.id === a.id) ? { color: list.find(x => x.id === a.id).color } : {}) })), ...manual];
}
function deep(d, o) {
  const r = {};
  for (const k in d) r[k] = d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) ? deep(d[k], o[k] || {}) : (o[k] === undefined || o[k] === null ? d[k] : o[k]);
  for (const k in o) if (!(k in r)) r[k] = o[k];
  return r;
}

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
let saveTimer = null;
/** Вызывается после любого изменения state: перерисовка сразу, запись на диск — чуть позже пачкой. */
export function commit() {
  listeners.forEach(fn => fn());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
}
async function persist() {
  const v = snapshot();
  try { await idbSet(KEY, v); } catch (e) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e2) { } }
}

export async function load() {
  let v = null;
  try { v = await idbGet(KEY); } catch (e) { }
  if (!v) { try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { } }
  if (v) { apply(v); if (upgrade()) await persist(); return { fresh: false }; }
  apply({});
  state.tasks = seedTasks();
  state.meta.startedAt = today();
  upgrade();
  await persist();
  return { fresh: true };
}

/** Резервная копия целиком — текстом (JSON). */
export function exportAll() { return JSON.stringify({ app: 'ezhednevnik', ...snapshot(), savedAt: new Date().toISOString() }); }
export function importAll(text) {
  const v = JSON.parse(text);
  if (v.app !== 'ezhednevnik' || v.schema !== SCHEMA) throw new Error('Это не копия этой версии ежедневника');
  apply(v); commit();
}

/** Обновления правил для уже сохранённых данных (без потери твоих изменений). */
const SYS_VER = 20;
function upgrade() {
  if ((state.meta.sysVer || 0) >= SYS_VER) return false;
  // 1) выезд на дачу вечером после работы, если завтра дача, а муж выходной
  if (!state.tasks.some(t => t.sys === 'dacha_eve')) {
    const work = state.tasks.find(t => t.block && t.kind === 'repeat');
    const end = work ? (parseInt(work.time) * 60 + +work.time.slice(3) + (+work.dur || 0)) : 18 * 60 + 15;
    const hh = String(Math.floor(end / 60)).padStart(2, '0'), mm = String(end % 60).padStart(2, '0');
    state.tasks.push({ id: 'sys-dacha-eve', sys: 'dacha_eve', title: 'Выезд на дачу', kind: 'repeat', cat: 'family', date: today(), time: `${hh}:${mm}`, dur: 60, block: true, note: 'Дорога на дачу. Прогулка и чтение — уже на даче; фитнес и уборка в этот вечер не ставятся.', rule: { freq: 'daily' }, cond: { op: 'and', items: [{ flag: 'dacha_eve' }] }, createdAt: Date.now() });
  }
  // 2) фитнес и уборка — не в вечер выезда на дачу
  for (const t of state.tasks) if (['Фитнес', 'Уборка'].includes(t.title) && t.cond && !JSON.stringify(t.cond).includes('dacha_eve')) t.cond.items.push({ flag: 'dacha_eve', not: true });
  // 3) фитнес: можно два дня подряд; в будни — когда муж выходной или «с ночи»
  if ((state.meta.sysVer || 0) < 3) for (const t of state.tasks.filter(t => t.title === 'Фитнес' && t.kind === 'repeat')) {
    t.rule = { ...t.rule, spread: false };
    const walk = n => { if (!n || !n.items) return; n.items = n.items.map(it => it.flag === 'h_off' && n.items.some(x => x.flag === 'my_work') ? { op: 'or', items: [{ flag: 'h_off' }, { flag: 'h_after' }] } : it); n.items.forEach(walk); };
    walk(t.cond);
  }
  // 4) записи на маникюр и педикюр: каждая процедура 2 часа, вместе — 4 часа; единые названия. Дату и время не трогаем.
  if ((state.meta.sysVer || 0) < 4) for (const t of state.tasks) {
    if (t.kind !== 'once' || t.booking) continue;
    const s = (t.title || '').toLowerCase(), m = /маникюр/.test(s), p = /педикюр/.test(s);
    if (!m && !p) continue;
    const dau = /доч/.test(s);
    t.title = (m && p ? 'Маникюр + педикюр' : m ? 'Маникюр' : 'Педикюр') + (dau ? ' — дочь' : '');
    t.dur = (m && p) ? 240 : 120;
    if (t.cat !== 'care') t.cat = 'care';
  }
  // 5) восстановить служебные пометки (могли потеряться при переносе) и избранное по умолчанию
  if ((state.meta.sysVer || 0) < 5) for (const t of state.tasks) {
    if (/^Записаться:/i.test(t.title) && t.kind === 'repeat') t.booking = true;
    if (/^(Сын|Дочь):/i.test(t.title) && t.kind === 'repeat') t.info = true;
    if (/^Работа с дорогой$/i.test(t.title) && t.kind === 'repeat') t.block = true;
    if (['Прогулка', 'Чтение книги', 'Оплатить счета', 'Передать показания счётчиков', 'Уборка'].includes(t.title) && t.kind === 'repeat') t.flex = true;
    if (['Фитнес', 'Уборка'].includes(t.title) && t.kind === 'repeat' && t.fav === undefined) t.fav = true;
  }
  // 6) в день сдачи крови — без фитнеса и уборки
  if ((state.meta.sysVer || 0) < 6) for (const t of state.tasks) if (['Фитнес', 'Уборка'].includes(t.title) && t.cond && !JSON.stringify(t.cond).includes('donor')) t.cond.items.push({ flag: 'donor', not: true });
  // 7) фитнес пропал (удалён или потерялся при переносе) — вернуть стандартный
  if ((state.meta.sysVer || 0) < 7 && !state.tasks.some(t => /фитнес|^спорт$/i.test(t.title) && t.kind === 'repeat')) {
    const f = seedTasks().find(t => t.title === 'Спорт'); f.fav = true; f.cond.items.push({ flag: 'dacha_eve', not: true }); state.tasks.push(f);
  }
  for (const t of state.tasks) if (/фитнес/i.test(t.title) && t.kind === 'repeat' && t.archived) delete t.archived;
  // 8) брови — 60 минут
  if ((state.meta.sysVer || 0) < 8) for (const t of state.tasks) if (/брови/i.test(t.title) && !/доч/i.test(t.title)) t.dur = 60;
  // 9) фитнес в выходные — в 9:00
  if ((state.meta.sysVer || 0) < 9) for (const t of state.tasks) if (/фитнес/i.test(t.title) && t.kind === 'repeat') t.timeOff = '09:00';
  // 10) время с дочкой и падел
  if ((state.meta.sysVer || 0) < 10) for (const x of extraTasks(today())) if (!state.tasks.some(t => t.title === x.title)) state.tasks.push(x);
  // 11) фитнес и падел — общий спорт; у падела свой цвет
  if ((state.meta.sysVer || 0) < 11) for (const t of state.tasks) { if (t.kind !== 'repeat') continue; if (/^фитнес$/i.test(t.title)) t.group = 'sport'; if (/^падел$/i.test(t.title)) { t.group = 'sport'; t.cat = 'padel'; } }
  // 12) время с дочкой: в будни сразу после работы (пн, ср, чт, пт), в выходные — только воскресенье; вместе не больше 2 в неделю
  if ((state.meta.sysVer || 0) < 12) for (const t of state.tasks) {
    if (t.kind !== 'repeat') continue;
    if (t.title === 'Время с дочкой') Object.assign(t, { group: 'daughter', rule: { ...t.rule, byWd: [0] }, note: 'Воскресенье, 3–4 часа. В субботу у дочери школа и вечером танцы.' });
    if (t.title === 'Время с дочкой — будни') Object.assign(t, { group: 'daughter', time: '18:15', rule: { ...t.rule, byWd: [1, 3, 4, 5], perWeek: 2, spread: true }, cond: JSON.parse(JSON.stringify(DAUGHTER_WK_COND)), note: 'Сразу после работы, около 2 часов. Вторник — танцы.' });
  }
  // 13) уборка по очереди: спальня / детские / общие места / глажка, до 3 раз в неделю по 30 минут
  if ((state.meta.sysVer || 0) < 13) for (const t of state.tasks) if (t.title === 'Уборка' && t.kind === 'repeat') Object.assign(t, { dur: 30, rotate: [...ZONES], rotFrom: today(), note: 'По очереди: спальня → детские → общие места → глажка.', rule: { ...t.rule, perWeek: 3 } });
  // 14) фитнес и падел — одна серия «Спорт»: будни 1,5 ч, выходные 2,5 ч
  if ((state.meta.sysVer || 0) < 14) {
    const f = state.tasks.find(t => t.kind === 'repeat' && /^фитнес$/i.test(t.title)), p = state.tasks.find(t => t.kind === 'repeat' && /^падел$/i.test(t.title));
    if (f) Object.assign(f, { title: 'Спорт', group: 'sport', cat: 'health', time: '18:15', timeOff: '09:00', dur: 90, durOff: 150, labelWk: 'фитнес', labelOff: 'выходной', colorWk: '#2E8B57', colorOff: '#2F7FD0', fav: true, note: 'Будни — фитнес 1,5 ч; выходные — падел или фитнес 2,5 ч.' });
    if (p) p.archived = true;
  }
  // 15) время с дочкой — одна серия: будни 2 ч после работы, воскресенье 3,5 ч; цвет по буднями/выходным
  if ((state.meta.sysVer || 0) < 15) {
    const d = state.tasks.find(t => t.kind === 'repeat' && t.title === 'Время с дочкой'), w = state.tasks.find(t => t.kind === 'repeat' && t.title === 'Время с дочкой — будни');
    const tpl = extraTasks(today()).find(t => t.title === 'Время с дочкой');
    if (d) { const keep = { id: d.id, moves: d.moves, moveTimes: d.moveTimes, skip: d.skip, doneOn: d.doneOn }; Object.keys(d).forEach(k => delete d[k]); Object.assign(d, tpl, keep); delete d.group; }
    else state.tasks.push(tpl);
    if (w) w.archived = true;
    const sp = state.tasks.find(t => t.kind === 'repeat' && t.title === 'Спорт');
    if (sp && !sp.colorWk) Object.assign(sp, { labelWk: 'фитнес', labelOff: 'выходной', colorWk: '#2E8B57', colorOff: '#2F7FD0' });
  }
  // 16) красота — отдельная категория (не дети, не врачи)
  if ((state.meta.sysVer || 0) < 16) for (const t of state.tasks) if (BEAUTY_RE.test(t.title) && !/врач|гинеколог|стоматолог|невролог/i.test(t.title)) { t.cat = 'beauty'; delete t.info; }
  // 17) с дочкой гуляем вместе — отдельная прогулка в этот день не нужна
  if ((state.meta.sysVer || 0) < 17) for (const t of state.tasks) if (t.kind === 'repeat' && t.title === 'Время с дочкой') t.absorbs = 'Прогулка';
  // 18) время с дочкой в мой отпуск — в субботу и воскресенье можно (в будни дочь в школе)
  if ((state.meta.sysVer || 0) < 18) for (const t of state.tasks) if (t.kind === 'repeat' && t.title === 'Время с дочкой' && t.cond) {
    const walk = n => { if (!n || !n.items) return; for (const it of n.items) { if (it.op === 'or' && it.items.some(x => x.flag === 'vac_me' && x.not) && !it.items.some(x => x.flag === 'wknd')) it.items.push({ flag: 'wknd' }); walk(it); } };
    walk(t.cond);
  }
  // 19) праздники и поводы
  if (!state.meta.occasions) state.meta.occasions = JSON.parse(JSON.stringify(DEFAULT_OCCASIONS));
  // 20) отпуск и поездка — как дача: дела, которые не ставятся на даче (спорт, время с дочкой, уборка…), не ставятся и в эти дни
  if ((state.meta.sysVer || 0) < 20) for (const t of state.tasks) {
    const top = t.cond && t.cond.op === 'and' && t.cond.items;
    if (!top || !top.some(x => x.flag === 'dacha' && x.not)) continue;
    for (const f of ['vac_me', 'trip']) if (!top.some(x => x.flag === f && x.not)) top.push({ flag: f, not: true });
  }
  state.meta.sysVer = SYS_VER;
  return true;
}

/** Снимок для «Отменить»: дела, отметки дней, служебное. */
export function undoSnapshot() { return JSON.stringify({ tasks: state.tasks, flagMarks: state.flagMarks, meta: state.meta, birthdays: state.birthdays }); }
export function restoreSnapshot(json) { const v = JSON.parse(json); state.tasks = v.tasks; state.flagMarks = v.flagMarks; state.meta = v.meta; state.birthdays = v.birthdays; commit(); }
