// Работа с датами. Дата дня везде хранится строкой 'YYYY-MM-DD', время — 'HH:MM'.
// Полдень в конструкторе Date защищает от сдвигов при переходе на летнее время.

export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const D = s => new Date(s + 'T12:00');
export const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((D(b) - D(a)) / 864e5);
export const wd = s => D(s).getDay(); // 0 — воскресенье
export const weekStart = s => addDays(s, -((wd(s) + 6) % 7)); // понедельник
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1..12

export function addMonths(s, n) {
  const d = D(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return iso(d);
}

/** Номер недели по ISO 8601 — для правил «чётная/нечётная неделя». */
export function isoWeek(s) {
  const d = D(s); const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const firstThu = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
}

export const toMin = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const WDS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MON1 = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function fmtDay(s) {
  const t = today();
  if (s === t) return 'сегодня';
  if (s === addDays(t, 1)) return 'завтра';
  if (s === addDays(t, -1)) return 'вчера';
  const d = D(s); return `${WDS[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}
export const dayLabel = s => { const d = D(s); return `${WDS[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };
export const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
export const durTxt = m => !m ? '' : m < 60 ? `${m} мин` : (m % 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m / 60} ч`);
