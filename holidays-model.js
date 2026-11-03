// Праздники и поводы: даты каждый год сами, к каждому — список дел и покупок «за N дней до».
import { today, addDays, diffDays } from './core-dates.js?v=2.6.3';

export const DEFAULT_OCCASIONS = [
  { id: 'ny', name: 'Новый год', icon: '🎄', md: '12-31' },
  { id: 'feb23', name: '23 февраля', icon: '🎖', md: '02-23' },
  { id: 'mar8', name: '8 марта', icon: '🌷', md: '03-08' },
  { id: 'sep1', name: '1 сентября', icon: '🎒', md: '09-01' },
  { id: 'teach', name: 'День учителя', icon: '🍎', md: '10-05' },
  { id: 'mom', name: 'День матери', icon: '💐', rule: 'lastSunNov' }
];

/** Ближайшая дата повода начиная с from (если в этом году прошла — в следующем). */
export function occDate(o, from = today()) {
  const at = y => {
    if (o.rule === 'lastSunNov') { const d = new Date(y, 10, 30, 12); while (d.getDay() !== 0) d.setDate(d.getDate() - 1); return `${y}-11-${String(d.getDate()).padStart(2, '0')}`; }
    if (o.date) return o.date; // разовый повод с конкретной датой
    return `${y}-${o.md}`;
  };
  const y = +from.slice(0, 4); let d = at(y);
  if (d < from && !o.date) d = at(y + 1);
  return d;
}
export const occIn = o => diffDays(today(), occDate(o));

/** Шаблон подготовки к Новому году (дела и покупки, «за сколько дней»). */
export const NY_TEMPLATE = [
  { title: 'Составить список подарков и бюджет', before: 45 },
  { title: 'Наряды детям к празднику', before: 21, shop: 'clothes' },
  { title: 'Подарок мужу', before: 14, shop: 'gift' },
  { title: 'Подарок дочери', before: 14, shop: 'gift' },
  { title: 'Подарок сыну', before: 14, shop: 'gift' },
  { title: 'Подарки родителям', before: 14, shop: 'gift' },
  { title: 'Подарки учителям и тренеру', before: 10, shop: 'gift' },
  { title: 'Ёлка, украшения, гирлянды', before: 14, shop: 'other' },
  { title: 'Заказы с маркетплейсов — успеть до праздничной загрузки', before: 18, shop: 'market' },
  { title: 'Продумать новогоднее меню', before: 10 },
  { title: 'Продукты к столу по меню', before: 2, shop: 'food' },
  { title: 'Генеральная уборка', before: 3 },
  { title: 'Поздравления и открытки', before: 1 }
];
