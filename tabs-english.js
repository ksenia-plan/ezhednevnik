// Вкладка «Английский»: задание на день, отметка, история и серия дней подряд.
// Задания можно пополнять из чата с Claude через вкладку «Для Claude» (операция addEnglish).
import { state, commit } from './core-store.js';
import { esc, on, toast } from './ui.js';
import { today, addDays, diffDays, fmtDay } from './core-dates.js';

export const id = 'english';
export const name = 'Английский';
export const icon = '<path d="M4 5h9M8.5 5v2c0 4-2 7-4.5 8"/><path d="M6 10c1.5 2 4 3.5 6 4"/><path d="M13 20l4-9 4 9M14.5 17h5"/>';

const yts = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
const BANK = [
  'Опиши свой вчерашний день вслух: 10 предложений в Past Simple (I woke up at five…). Запиши на диктофон, послушай и найди 2 ошибки.',
  'Shadowing 15 минут: видео уровня A2 с субтитрами, повторяй фразы за диктором сразу после него.',
  'Тема «Работа»: meeting, deadline, report, improve, process, task, colleague, schedule, result, solution. С каждым словом — предложение вслух о своей работе.',
  'Small talk: ответь вслух на 5 вопросов по 3–4 предложения: What do you do? What do you like about your job? What did you do last weekend? What are your plans? What do you do in your free time?',
  'Present Perfect: 8 предложений о неделе — что уже сделала и что ещё нет (I have already…, I haven’t … yet).',
  'Расскажи о семье: 10 предложений про мужа и детей, их увлечения и ваш выходной.',
  'Мини-выступление «My job» на 1 минуту. Запиши два раза подряд и сравни, стало ли увереннее.',
  'Вопросы: составь 10 вопросов разных типов (Do you…? Where…? How often…? Have you ever…?), задай их себе вслух и ответь.',
  'Планы: 8 предложений о планах на месяц — с going to и will.',
  'Подкаст для начинающих 10 минут: выпиши 5 полезных фраз и повтори каждую вслух 3 раза.',
  'Опиши любое фото из телефона вслух 1 минуту: There is / There are, on the left, in the middle, behind.',
  'Диалог в кафе: заказать кофе, спросить цену, попросить счёт. Проговори обе роли вслух дважды.',
  'Сравнения: 8 предложений с bigger / more interesting / the best — города, сезоны, виды спорта.',
  'Прочитай короткий рассказ уровня A2 и перескажи вслух своими словами за 2 минуты.'
];
const bank = () => [...BANK, ...(state.meta.englishBank || [])];
const log = () => (state.meta.english ||= {});

export function assignmentFor(ds) {
  const l = log(); if (l[ds]?.text) return l[ds];
  const b = bank(); return { text: b[Math.abs(diffDays('2026-01-05', ds)) % b.length], done: false };
}
function streak() { let n = 0, d = today(); if (!log()[d]?.done) d = addDays(d, -1); while (log()[d]?.done) { n++; d = addDays(d, -1); } return n; }
/** Синхронизация с ежедневной задачей «Английский» в календаре. */
function syncTask(ds, done) {
  const t = state.tasks.find(x => x.tab === 'english' && x.kind === 'repeat');
  if (t) { t.doneOn = { ...(t.doneOn || {}) }; if (done) t.doneOn[ds] = true; else delete t.doneOn[ds]; }
}

export function render() {
  const t = today(), a = assignmentFor(t);
  const hist = [...Array(14)].map((_, i) => addDays(t, -i - 1)).filter(d => log()[d]);
  return `<h1>Английский</h1>
  <div class="card"><div class="row between"><h2>Задание на сегодня · 20 минут</h2><span class="pill" style="--c:var(--accent)">серия: ${streak()} дн.</span></div>
    <div style="font-size:16px">${esc(a.text)}</div>
    <div class="row"><button class="btn" data-act="enDone">${a.done ? 'Вернуть' : 'Сделала'}</button><button class="btn ghost" data-act="enNext">Другое задание</button></div>
    <div class="chips"><a class="chip" href="${yts('English A2 listening practice shadowing')}" target="_blank" rel="noopener">▶ Слушать и повторять</a><a class="chip" href="${yts('English podcast for beginners A2')}" target="_blank" rel="noopener">▶ Подкасты A2</a></div></div>
  <section><h2>История</h2>${hist.length ? `<div class="list">${hist.map(d => `<div class="it ${log()[d].done ? '' : 'done'}"><div class="tm">${esc(fmtDay(d))}</div><div class="grow"><div class="t">${log()[d].done ? '✓ ' : '— '}${esc(log()[d].text.slice(0, 90))}…</div></div><span></span></div>`).join('')}</div>` : '<div class="empty">Здесь появятся выполненные задания.</div>'}</section>
  <div class="note">Уровень A2, цель — свободно говорить. Новые задания можно добавить через вкладку «Для Claude»: попроси меня в чате, я пришлю блок для вставки.</div>`;
}

on('enDone', () => { const t = today(), a = assignmentFor(t); log()[t] = { text: a.text, done: !a.done }; syncTask(t, !a.done); commit(); if (!a.done) toast('Засчитано'); });
on('enNext', () => { const t = today(), b = bank(), cur = assignmentFor(t).text; log()[t] = { text: b[(b.indexOf(cur) + 1) % b.length], done: false }; commit(); });
