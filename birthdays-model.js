// Дни рождения: дата вводится один раз, ближайшая дата и напоминания считаются автоматически каждый год.
import { today, diffDays } from './core-dates.js?v=2.6.3';

const leap = y => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/** Ближайший день рождения начиная с даты from: {ds, in, age}. 29 февраля в невисокосный год — 28-го. */
export function nextBirthday(b, from = today()) {
  const md = b.date.slice(5);
  let y = +from.slice(0, 4);
  const at = yy => (md === '02-29' && !leap(yy)) ? `${yy}-02-28` : `${yy}-${md}`;
  let ds = at(y);
  if (ds < from) { y++; ds = at(y); }
  return { ds, in: diffDays(from, ds), age: b.noYear ? null : y - (+b.date.slice(0, 4)) };
}

/** Сегодня ли день напоминания: за сколько дней предупреждать — список, по умолчанию [7, 1]. */
export function warnToday(b, ds = today()) {
  const n = nextBirthday(b, ds);
  const warn = b.warn && b.warn.length ? b.warn : [7, 1];
  return n.in === 0 || warn.includes(n.in) ? n : null;
}
