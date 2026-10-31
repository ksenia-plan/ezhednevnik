// Задачи: создание, изменение, отметки выполнения, переносы, разбор текста.
//
// task = {
//   id, title, kind: 'once'|'repeat'|'span'|'event', cat,
//   date, end (для периода), until (для повтора), time, timeOff (время в мои выходные), dur,
//   rule (см. core/recur.js), cond (см. core/cond.js),
//   important, urgent, done, doneOn:{дата:true}, skip:{дата:true}, moves:{исходная:новая}, moveTimes:{исходная:'HH:MM'},
//   remind (за сколько дней напомнить), note, info (не занимает время), block (занятое время, без отметки),
//   flex (сдвигать в свободное окно), booking (напоминание записаться), tab, archived
// }
import { state, commit, uid, undoSnapshot } from './core-store.js';
import { saveUndo } from './ui.js';
const snap = () => saveUndo(undoSnapshot()); // для кнопки «Отменить» в подсказке
import { today, addDays, wd, pad } from './core-dates.js';

export const KINDS = { once: 'Разовая', repeat: 'Повторяется', span: 'Период', event: 'Событие' };

export function newTask(p = {}) {
  return { id: uid(), title: '', kind: 'once', cat: 'personal', date: today(), time: '', dur: 30, important: false, urgent: false, createdAt: Date.now(), ...p };
}
export function addTask(t) { state.tasks.push(t); commit(); return t; }
export function updateTask(id, patch) { const t = state.tasks.find(x => x.id === id); if (t) Object.assign(t, patch); commit(); return t; }
export function deleteTask(id) { snap(); state.tasks = state.tasks.filter(x => x.id !== id); commit(); }
export const getTask = id => state.tasks.find(x => x.id === id);

/** Отметить выполнение конкретного пункта (для повторов — только этот день). */
export function setDone(t, orig, done) {
  snap();
  if (t.kind === 'repeat') {
    t.doneOn = { ...(t.doneOn || {}) };
    if (t.rule?.freq === 'after') { const k = done ? today() : orig; if (done) t.doneOn[k] = true; else { delete t.doneOn[orig]; delete t.doneOn[today()]; } }
    else if (done) t.doneOn[orig] = true; else delete t.doneOn[orig];
  } else { t.done = done; t.doneAt = done ? Date.now() : null; }
  commit();
}

/** Перенести пункт на другой день (и, при желании, время). Для разовой задачи меняется сама дата. */
export function moveItem(t, orig, toDate, toTime) {
  snap();
  if (t.kind === 'repeat') {
    t.moves = { ...(t.moves || {}) }; t.moveTimes = { ...(t.moveTimes || {}) };
    if (toDate === orig && !toTime) { delete t.moves[orig]; delete t.moveTimes[orig]; }
    else { if (toDate !== orig) t.moves[orig] = toDate; else delete t.moves[orig]; if (toTime) t.moveTimes[orig] = toTime; }
  } else { t.date = toDate; if (toTime !== undefined && toTime !== null) t.time = toTime; }
  commit();
}
export function skipItem(t, orig) { snap(); t.skip = { ...(t.skip || {}), [orig]: true }; commit(); }

/* ---------- разбор текста: «завтра в 10 созвон 1 ч», «каждый вторник английский», «важно срочно отчёт к пятнице» ---------- */
const KW = {
  work: /работ|совещ|встреч|отч[её]т|тз\b|презент|концепц|подрядч|проект|инициатив|созвон|письм|руковод|служебк|договор/i,
  family: /сын|доч|муж|школ|хокке|дет|семь|родител|мам|пап|кружок|секци|дач|танц|подар/i,
  health: /врач|спорт|трениров|бег|сон|вес|зал|анализ|прогулк|йог|витамин|бассейн|фитнес/i,
  english: /англ|english|слов[ао]|speaking|лексик|граммат/i,
  money: /оплат|счёт|счет|квитанц|налог|кредит|перевод/i,
  home: /убор|стирк|готов|ремонт|купить|магазин/i
};
export function guessCat(t) { for (const k in KW) if (KW[k].test(t)) return k; return 'personal'; }

const WDN = [['воскресень', 0], ['понедельн', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6]];

// В JS \b не работает с кириллицей, поэтому границы слов задаём через \p{L} (флаг u).
const W = (body, flags = 'iu') => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, flags);

export function parseText(text, defaults = {}) {
  return text.split(/[;\n]+/).map(x => x.trim()).filter(Boolean).map(src => {
    const s = src.toLowerCase();
    const t = newTask({ ...defaults });
    t.date = defaults.date ?? today();
    if (W('важно|важное|важная').test(s)) t.important = true;
    if (W('срочно|срочное|срочная').test(s)) t.urgent = true;
    const days = WDN.filter(([w]) => s.includes(w)).map(([, n]) => n);
    if (W('каждый день|ежедневно').test(s)) { t.kind = 'repeat'; t.rule = { freq: 'daily' }; }
    else if (W('по будням').test(s)) { t.kind = 'repeat'; t.rule = { freq: 'weekly', byWd: [1, 2, 3, 4, 5] }; }
    else if (days.length && /кажд\p{L}*\s+(понедельн|вторник|сред|четверг|пятниц|суббот|воскресен)|по\s+(понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\p{L}*ам/iu.test(s)) { t.kind = 'repeat'; t.rule = { freq: 'weekly', byWd: days }; }
    else { const m = s.match(/кажд\p{L}*\s+(\d{1,2})[- ]?(?:е|го)?\s+числ/iu); if (m) { t.kind = 'repeat'; t.rule = { freq: 'monthly', monthMode: 'day', monthDay: +m[1] }; } }
    const ev = s.match(/раз в (\d+) недел/iu); if (ev && t.rule?.freq === 'weekly') t.rule.interval = +ev[1];
    if (t.kind !== 'repeat') {
      if (W('послезавтра').test(s)) t.date = addDays(today(), 2);
      else if (W('завтра').test(s)) t.date = addDays(today(), 1);
      else if (W('сегодня|вечером|утром').test(s)) t.date = today();
      else if (days.length) { const diff = (days[0] - wd(today()) + 7) % 7 || 7; t.date = addDays(today(), diff); }
      const dm = s.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
      if (dm) { const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : today().slice(0, 4); let ds = `${y}-${pad(+dm[2])}-${pad(+dm[1])}`; if (!dm[3] && ds < today()) ds = `${+y + 1}-${pad(+dm[2])}-${pad(+dm[1])}`; t.date = ds; }
      if (W('без даты|когда-нибудь').test(s)) t.date = '';
    } else t.date = today();
    const tm = s.match(/(?<!\p{L})(?:в|к)\s*(\d{1,2})(?::(\d{2}))?(?![\d.:]|\s*(?:мин|ч(?!\p{L})|час))/iu);
    if (tm && +tm[1] < 24) t.time = pad(+tm[1]) + ':' + (tm[2] || '00');
    const dur = s.match(/(\d+(?:[.,]\d)?)\s*(мин\p{L}*|ч(?!\p{L})|час\p{L}*)/iu);
    if (dur) { const v = +dur[1].replace(',', '.'); t.dur = Math.round(dur[2].startsWith('мин') ? v : v * 60); }
    t.cat = defaults.cat || guessCat(s);
    // заголовок без служебных слов
    const strip = [
      'важно|важное|важная|срочно|срочное|срочная|сегодня|завтра|послезавтра|ежедневно|каждый день|по будням|без даты|когда-нибудь|утром|вечером',
      '(?:в|во|по)\\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)', '(?:к|до)\\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\\p{L}*',
      'кажд\\p{L}*\\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)',
      'по\\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\\p{L}*(?:\\s+и\\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\\p{L}*)*',
      'кажд\\p{L}*\\s+\\d{1,2}[- ]?(?:е|го)?\\s+числ\\p{L}*', 'раз в \\d+ недел\\p{L}*',
      '(?:в|к)\\s*\\d{1,2}(?::\\d{2})?', '\\d+(?:[.,]\\d)?\\s*(?:мин\\p{L}*|ч|час\\p{L}*)', '\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?'
    ];
    let title = src; for (const p of strip) title = title.replace(W(p, 'giu'), ' ');
    title = title.replace(/\s{2,}/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '');
    t.title = title ? title[0].toUpperCase() + title.slice(1) : src;
    return t;
  });
}
