// Стартовый набор: категории задач и шаблоны регулярных дел.
// Всё это обычные задачи — их можно менять и удалять в приложении.
import { today, addDays } from './core-dates.js?v=2.6.3';

export const CATS = [
  { id: 'personal', name: 'Личное', color: '#6B7785' },
  { id: 'work', name: 'Работа', color: '#2C64C6' },
  { id: 'family', name: 'Семья', color: '#C2477A' },
  { id: 'health', name: 'Здоровье', color: '#2E8B57' },
  { id: 'padel', name: 'Падел', color: '#2F7FD0' },
  { id: 'care', name: 'Врачи и здоровье', color: '#B0518F' },
  { id: 'beauty', name: 'Красота', color: '#D0458C' },
  { id: 'shop', name: 'Покупки', color: '#7A5C2E' },
  { id: 'home', name: 'Дом', color: '#8A6A3B' },
  { id: 'money', name: 'Счета', color: '#B26A00' },
  { id: 'english', name: 'Английский', color: '#B98110' },
  { id: 'study', name: 'Учёба', color: '#7A4CC2' }
];
/** Записи к мастерам и врачам: «Уход и врачи» и «Красота». */
export const isAppt = x => x.cat === 'care' || x.cat === 'beauty';
export const BEAUTY_RE = /маникюр|педикюр|брови|стрижк|(^|[^\p{L}])спа([^\p{L}]|$)|косметолог|массаж|окрашив|ресниц/iu;
export const cat = id => CATS.find(c => c.id === id) || CATS[0];

const id = p => p + '-' + Math.random().toString(36).slice(2, 9);
const ALL = [0, 1, 2, 3, 4, 5, 6];
const rep = (o) => ({ kind: 'repeat', dur: 30, createdAt: Date.now(), ...o, id: id('t') });

// Условие фитнеса: (рабочий день И муж выходной или «с ночи») ИЛИ (мой выходной И муж на смене); не в цикл и не на даче.
export const FITNESS_COND = {
  op: 'and', items: [
    { op: 'or', items: [{ op: 'and', items: [{ flag: 'my_work' }, { op: 'or', items: [{ flag: 'h_off' }, { flag: 'h_after' }] }] }, { op: 'and', items: [{ flag: 'my_off' }, { flag: 'h_works' }] }] },
    { flag: 'cycle', not: true }, { flag: 'dacha', not: true }, { flag: 'vac_me', not: true }, { flag: 'trip', not: true }, { flag: 'sick', not: true }, { flag: 'donor', not: true }
  ]
};

// Время с дочкой: муж на смене, не на даче; в будни — после работы, в воскресенье — днём.
export const DAUGHTER_COND = { op: 'and', items: [{ flag: 'h_works' }, { flag: 'dacha', not: true }, { flag: 'vac_me', not: true }, { flag: 'trip', not: true }, { flag: 'dacha_eve', not: true }, { flag: 'sick', not: true }, { op: 'or', items: [{ flag: 'vac_me', not: true }, { flag: 'kids_hol' }, { flag: 'wknd' }] }] };
// будни: сразу после работы, когда муж на смене (не во вторник — танцы)
export const DAUGHTER_WK_COND = { op: 'and', items: [{ flag: 'h_works' }, { flag: 'dacha', not: true }, { flag: 'vac_me', not: true }, { flag: 'trip', not: true }, { flag: 'dacha_eve', not: true }, { flag: 'sick', not: true }] };
export const PADEL_COND = { op: 'and', items: [{ flag: 'my_off' }, { flag: 'h_works' }, { flag: 'dacha', not: true }, { flag: 'vac_me', not: true }, { flag: 'trip', not: true }, { flag: 'sick', not: true }] };
export const extraTasks = t => [
  rep({ title: 'Время с дочкой', absorbs: 'Прогулка', cat: 'family', date: t, time: '18:15', timeOff: '11:00', dur: 120, durOff: 210, labelWk: 'будни', labelOff: 'выходной', colorWk: '#C2477A', colorOff: '#8E44AD', rule: { freq: 'weekly', byWd: [0, 1, 3, 4, 5], perWeek: 2, spread: true }, cond: DAUGHTER_COND, fav: true, note: 'Будни — сразу после работы, 2 ч (не во вторник — танцы). Воскресенье — 3,5 ч. В субботу у дочери школа и танцы.' }),
];

export const ZONES = ['Спальня', 'Детские', 'Общие места', 'Глажка'];

export function seedTasks() {
  const t = today();
  const after = (title, days, unit, offset, extra = {}) => rep({ title: 'Записаться: ' + title, cat: BEAUTY_RE.test(title) ? 'beauty' : 'care', date: addDays(t, offset), rule: { freq: 'after', interval: days, unit }, booking: true, ...extra });
  return [
    rep({ title: 'Работа с дорогой', cat: 'work', date: t, time: '07:30', dur: 630, block: true, rule: { freq: 'weekly', byWd: [1, 2, 3, 4, 5] }, cond: { op: 'and', items: [{ flag: 'my_work' }] } }),
    rep({ title: 'Зарядка', cat: 'health', date: t, time: '05:15', timeOff: '07:15', dur: 20, rule: { freq: 'daily' }, cond: { op: 'and', items: [{ flag: 'sick', not: true }] }, note: 'Комплексы — во вкладке «Английский и зарядка»' }),
    rep({ title: 'Английский', cat: 'english', date: t, time: '06:00', timeOff: '08:00', dur: 20, rule: { freq: 'daily' }, tab: 'english' }),
    rep({ title: 'Прогулка', flex: true, cat: 'health', date: t, time: '18:15', timeOff: '12:00', dur: 30, rule: { freq: 'daily' } }),
    rep({ title: 'Чтение книги', flex: true, cat: 'personal', date: t, time: '20:30', timeOff: '22:30', dur: 30, rule: { freq: 'daily' } }),
    rep({ title: 'Спорт', group: 'sport', cat: 'health', date: t, time: '18:15', timeOff: '09:00', dur: 90, durOff: 150, labelWk: 'фитнес', labelOff: 'выходной', colorWk: '#2E8B57', colorOff: '#2F7FD0', fav: true, note: 'Будни — фитнес 1,5 ч; выходные — падел или фитнес 2,5 ч.', rule: { freq: 'weekly', byWd: ALL, perWeek: 3, spread: false }, cond: FITNESS_COND }),
    rep({ title: 'Уборка', flex: true, cat: 'home', date: t, time: '19:00', timeOff: '11:00', dur: 30, rotate: ZONES, rotFrom: t, note: 'По очереди: спальня → детские → общие места → глажка.', rule: { freq: 'weekly', byWd: ALL, perWeek: 3 }, cond: { op: 'and', items: [{ flag: 'dacha', not: true }, { flag: 'vac_me', not: true }, { flag: 'trip', not: true }, { flag: 'donor', not: true }] } }),
    rep({ title: 'Оплатить счета', flex: true, cat: 'money', date: t, time: '19:00', timeOff: '10:00', dur: 20, rule: { freq: 'monthly', monthMode: 'day', monthDay: 12 }, note: 'Крайний срок по закону — 15-е' }),
    rep({ title: 'Передать показания счётчиков', flex: true, cat: 'money', date: t, time: '19:00', timeOff: '10:00', dur: 15, rule: { freq: 'monthly', monthMode: 'day', monthDay: 20 }, remind: 3, note: 'Окно приёма — с 20 по 25 число' }),
    rep({ title: 'Сын: репетитор по математике', cat: 'family', date: t, time: '17:30', dur: 60, info: true, rule: { freq: 'weekly', byWd: [1] } }),
    rep({ title: 'Сын: репетитор по математике', cat: 'family', date: t, time: '14:30', dur: 60, info: true, rule: { freq: 'weekly', byWd: [6] } }),
    rep({ title: 'Дочь: танцы', cat: 'family', date: t, dur: 60, info: true, rule: { freq: 'weekly', byWd: [2, 6] } }),
    rep({ title: 'Сын: хоккей', cat: 'family', date: t, dur: 90, info: true, rule: { freq: 'weekly', byWd: [0, 2, 3, 4, 5, 6] } }),
    after('маникюр', 21, 'days', 1, { cond: { op: 'and', items: [{ flag: 'h_works' }] } }),
    after('педикюр', 42, 'days', 2),
    after('брови', 21, 'days', 3),
    after('стрижка', 3, 'months', 4),
    after('СПА', 45, 'days', 5),
    after('сдача крови', 2, 'months', 6, { rule: { freq: 'after', interval: 2, unit: 'months', snap: 'workMonday' } }),
    after('гинеколог', 6, 'months', 8), after('стоматолог', 6, 'months', 10), after('невролог', 6, 'months', 12),
    ...extraTasks(t),
    after('гинеколог — дочь', 6, 'months', 14), after('стоматолог — дочь', 6, 'months', 16), after('невролог — дочь', 6, 'months', 18)
  ];
}
