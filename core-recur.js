// Движок повторений. Правило — обычный объект, его собирает конструктор в редакторе задачи.
//
// rule = {
//   freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'days' | 'after',
//   interval: N,               // каждый N-й день/неделю/месяц/год
//   byWd: [1,3,5],             // weekly: дни недели (0 — вс)
//   parity: 'any'|'even'|'odd',// weekly: только чётные/нечётные недели (ISO)
//   monthMode: 'day'|'nth',    // monthly: по числу или «N-й день недели месяца»
//   monthDay: 12,              // monthly/day: число (если в месяце меньше дней — последний день)
//   nth: 2, nthWd: 2,          // monthly/nth: второй вторник; nth = -1 — последний
//   perWeek: 0,                // ограничение «не больше N раз в неделю», дни разносятся равномерно
// }
// 'days'  — каждые N дней от даты начала;
// 'after' — через N дней после последнего выполнения (процедуры, врачи).
import { D, addDays, diffDays, isoWeek, weekStart, daysInMonth, addMonths, wd } from './core-dates.js';
import { isWorkday } from './core-prodcal.js';

export function matchesRule(task, ds) {
  const r = task.rule || {}, start = task.date;
  if (!start || ds < start) return false;
  if (task.until && ds > task.until) return false;
  const n = Math.max(1, +r.interval || 1);
  const d = D(ds), s = D(start);
  switch (r.freq) {
    case 'daily': return diffDays(start, ds) % n === 0;
    case 'days': return diffDays(start, ds) % n === 0;
    case 'weekly': {
      const days = r.byWd && r.byWd.length ? r.byWd : [s.getDay()];
      if (!days.includes(d.getDay())) return false;
      if (r.parity === 'even' && isoWeek(ds) % 2 !== 0) return false;
      if (r.parity === 'odd' && isoWeek(ds) % 2 !== 1) return false;
      return (diffDays(weekStart(start), weekStart(ds)) / 7) % n === 0;
    }
    case 'monthly': {
      const months = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
      if (months % n !== 0) return false;
      if (r.monthMode === 'nth') return isNthWeekday(ds, +r.nth || 1, r.nthWd ?? s.getDay());
      const want = Math.min(+r.monthDay || s.getDate(), daysInMonth(d.getFullYear(), d.getMonth() + 1));
      return d.getDate() === want;
    }
    case 'yearly': {
      if ((d.getFullYear() - s.getFullYear()) % n !== 0) return false;
      if (d.getMonth() !== s.getMonth()) return false;
      return d.getDate() === Math.min(s.getDate(), daysInMonth(d.getFullYear(), d.getMonth() + 1));
    }
    case 'after': return ds === nextAfterDue(task);
    default: return ds === start;
  }
}

/** «Второй вторник», «последняя пятница» месяца. */
export function isNthWeekday(ds, nth, weekday) {
  const d = D(ds);
  if (d.getDay() !== +weekday) return false;
  if (nth > 0) return Math.ceil(d.getDate() / 7) === nth;
  return d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth() + 1);
}

/** Для правила «через N дней после выполнения» — дата следующего раза. */
export function nextAfterDue(task) {
  const n = Math.max(1, +task.rule?.interval || 1);
  const unit = task.rule?.unit || 'days';
  const dones = Object.keys(task.doneOn || {}).filter(k => task.doneOn[k]).sort();
  const last = dones.length ? dones[dones.length - 1] : (task.lastDone || null);
  if (!last) return task.date;
  let due = unit === 'months' ? addMonths(last, n) : addDays(last, n);
  // «напомнить в первый рабочий понедельник» (сдача крови)
  if (task.rule?.snap === 'workMonday') { for (let i = 0; i < 60; i++) { if (wd(due) === 1 && isWorkday(due)) break; due = addDays(due, 1); } }
  return due;
}

/** Человекочитаемое описание правила для карточки задачи. */
export function describeRule(task) {
  const r = task.rule || {}, n = Math.max(1, +r.interval || 1);
  const WDS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const NTH = { 1: 'первый', 2: 'второй', 3: 'третий', 4: 'четвёртый', '-1': 'последний' };
  const WDG = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
  let t = '';
  switch (r.freq) {
    case 'daily': t = n === 1 ? 'каждый день' : `раз в ${n} дн.`; break;
    case 'days': t = `каждые ${n} дн.`; break;
    case 'weekly': {
      const days = (r.byWd && r.byWd.length ? r.byWd : [wd(task.date)]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => WDS[x]).join(', ');
      t = (r.byWd && r.byWd.length === 7) ? (+r.perWeek ? 'в подходящие дни' : 'каждый день') : (n === 1 ? 'еженедельно' : `раз в ${n} нед.`) + ': ' + days;
      if (r.parity === 'even') t += ' (чётные недели)'; if (r.parity === 'odd') t += ' (нечётные недели)';
      break;
    }
    case 'monthly':
      t = (n === 1 ? 'ежемесячно' : `раз в ${n} мес.`) + (r.monthMode === 'nth' ? `: ${NTH[r.nth] || r.nth} ${WDG[r.nthWd]}` : `: ${r.monthDay || D(task.date).getDate()}-го`);
      break;
    case 'yearly': t = n === 1 ? 'ежегодно' : `раз в ${n} г.`; break;
    case 'after': t = `через ${n} ${r.unit === 'months' ? 'мес.' : 'дн.'} после выполнения`; break;
    default: t = '';
  }
  if (+r.perWeek) t += `, не больше ${r.perWeek} в неделю`;
  return t;
}
