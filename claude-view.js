// «Для Claude»: обмен данными с чатом Claude через копирование текста. Без сервера и без ключей.
// Claude присылает в чате блок JSON с операциями → ты вставляешь его сюда → предпросмотр → «Применить».
// В обратную сторону: «Скопировать для Claude» выгружает расписание текстом, ты вставляешь его в чат.
// Приложение само никуда не обращается: всё происходит только по твоему нажатию.
import { state, commit, uid } from './core-store.js?v=2.6.3';
import { esc, on, toast, copyText } from './ui.js?v=2.6.3';
import { CATS } from './core-seed.js?v=2.6.3';
import { KINDS, newTask } from './tasks-model.js?v=2.6.3';
import { describeRule } from './core-recur.js?v=2.6.3';
import { describeCond } from './core-cond.js?v=2.6.3';
import { fmtDay, today } from './core-dates.js?v=2.6.3';

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
let pending = null;

const EXAMPLE = `{
  "ezhednevnik": 1,
  "ops": [
    {"op": "addTask", "task": {"title": "Бассейн", "kind": "repeat", "cat": "health",
      "date": "2026-11-02", "time": "19:00", "dur": 60,
      "rule": {"freq": "weekly", "byWd": [3]},
      "cond": {"op": "and", "items": [{"flag": "h_works"}, {"flag": "vac_me", "not": true}]}}},
    {"op": "addTask", "task": {"title": "Отчёт по инициативам", "cat": "work", "date": "2026-11-06", "important": true, "urgent": true}},
    {"op": "addBirthday", "name": "Маша", "date": "1985-03-14", "warn": [7, 1]},
    {"op": "markFlag", "flag": "vac_me", "from": "2026-12-28", "to": "2027-01-10", "note": "отпуск"},
    {"op": "addEnglish", "text": "Опиши свою неделю вслух: 8 предложений в Past Simple"},
    {"op": "updateTask", "match": {"title": "Спорт"}, "patch": {"time": "18:30"}},
    {"op": "deleteTask", "match": {"title": "Старая задача"}}
  ]
}`;

/** Проверка и нормализация задачи из внешнего текста. Лишние поля отбрасываются. */
function cleanTask(x, base = {}) {
  if (!x || typeof x !== 'object') throw new Error('задача — не объект');
  const t = { ...base };
  if (x.title !== undefined) { if (typeof x.title !== 'string' || !x.title.trim()) throw new Error('пустое название'); t.title = x.title.trim().slice(0, 200); }
  if (x.kind !== undefined) { if (!KINDS[x.kind]) throw new Error('тип: ' + x.kind); t.kind = x.kind; }
  if (x.cat !== undefined) t.cat = CATS.some(c => c.id === x.cat) ? x.cat : 'personal';
  for (const k of ['date', 'end', 'until']) if (x[k] !== undefined) { if (x[k] && !DATE.test(x[k])) throw new Error(`${k}: формат ГГГГ-ММ-ДД`); t[k] = x[k] || ''; }
  for (const k of ['time', 'timeOff']) if (x[k] !== undefined) { if (x[k] && !TIME.test(x[k])) throw new Error(`${k}: формат ЧЧ:ММ`); t[k] = x[k] || ''; }
  if (x.dur !== undefined) t.dur = Math.min(900, Math.max(5, +x.dur || 30));
  if (x.remind !== undefined) t.remind = Math.min(60, Math.max(0, +x.remind || 0));
  for (const k of ['important', 'urgent', 'flex', 'info']) if (x[k] !== undefined) t[k] = !!x[k];
  if (x.note !== undefined) t.note = String(x.note).slice(0, 500);
  if (x.rule !== undefined) {
    const r = x.rule, ok = ['daily', 'weekly', 'monthly', 'yearly', 'days', 'after'];
    if (!r || !ok.includes(r.freq)) throw new Error('rule.freq: ' + (r && r.freq));
    t.rule = { freq: r.freq, interval: Math.max(1, +r.interval || 1) };
    if (Array.isArray(r.byWd)) t.rule.byWd = r.byWd.map(Number).filter(n => n >= 0 && n <= 6);
    if (['even', 'odd'].includes(r.parity)) t.rule.parity = r.parity;
    if (r.monthMode === 'nth') { t.rule.monthMode = 'nth'; t.rule.nth = [1, 2, 3, 4, -1].includes(+r.nth) ? +r.nth : 1; t.rule.nthWd = Math.min(6, Math.max(0, +r.nthWd || 0)); }
    if (r.monthDay) t.rule.monthDay = Math.min(31, Math.max(1, +r.monthDay));
    if (r.perWeek) t.rule.perWeek = Math.min(7, Math.max(0, +r.perWeek));
    if (r.unit === 'months') t.rule.unit = 'months';
    if (!t.kind) t.kind = 'repeat';
  }
  if (x.cond !== undefined) t.cond = cleanCond(x.cond, 0);
  return t;
}
function cleanCond(c, depth) {
  if (!c) return null;
  if (depth > 3 || !Array.isArray(c.items)) throw new Error('cond: нужен список items');
  return { op: c.op === 'or' ? 'or' : 'and', items: c.items.map(it => it.items ? cleanCond(it, depth + 1) : (() => { if (!state.flagTypes.some(f => f.id === it.flag)) throw new Error('нет признака ' + it.flag); return { flag: it.flag, ...(it.not ? { not: true } : {}) }; })()) };
}
function findTask(op) {
  if (op.id) return state.tasks.find(t => t.id === op.id);
  if (op.match?.title) { const m = state.tasks.filter(t => t.title.toLowerCase() === String(op.match.title).toLowerCase()); if (m.length > 1) throw new Error(`«${op.match.title}» — несколько задач, нужен id`); return m[0]; }
  return null;
}
function flagId(f) { const x = state.flagTypes.find(t => t.id === f || t.name.toLowerCase() === String(f).toLowerCase()); if (!x || x.auto) throw new Error('признак: ' + f); return x.id; }

/** Разобрать текст в список проверенных операций с описанием для предпросмотра. */
export function parseOps(text) {
  const s = text.trim(), start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0) throw new Error('В тексте нет блока { … }');
  const v = JSON.parse(s.slice(start, end + 1));
  if (!Array.isArray(v.ops)) throw new Error('Нет списка ops');
  return v.ops.slice(0, 200).map((op, i) => {
    try {
      switch (op.op) {
        case 'addTask': { const t = cleanTask(op.task, newTask()); if (!t.title) throw new Error('нет названия'); return { op, run: () => state.tasks.push({ ...t, id: uid() }), txt: `Новая задача: ${t.title}${t.date ? ' · ' + fmtDay(t.date) : ''}${t.time ? ' ' + t.time : ''}${t.kind === 'repeat' ? ' · ' + describeRule(t) : ''}${t.cond ? ' · если ' + describeCond(t.cond) : ''}` }; }
        case 'updateTask': { const t = findTask(op); if (!t) throw new Error('задача не найдена'); const p = cleanTask(op.patch || {}); return { op, run: () => Object.assign(t, p), txt: `Изменить «${t.title}»: ${Object.keys(p).join(', ')}` }; }
        case 'deleteTask': { const t = findTask(op); if (!t) throw new Error('задача не найдена'); return { op, run: () => { state.tasks = state.tasks.filter(x => x !== t); }, txt: `Удалить задачу «${t.title}»` }; }
        case 'addBirthday': { if (!op.name || !DATE.test(op.date || '')) throw new Error('нужны name и date'); const b = { id: uid(), name: String(op.name).slice(0, 60), date: op.date, who: String(op.who || '').slice(0, 60), noYear: !!op.noYear, warn: Array.isArray(op.warn) ? op.warn.map(Number).filter(n => n >= 0 && n <= 60) : [7, 1] }; return { op, run: () => state.birthdays.push(b), txt: `День рождения: ${b.name}, ${b.date.slice(8)}.${b.date.slice(5, 7)}` }; }
        case 'markFlag': { const f = flagId(op.flag); if (!DATE.test(op.from || '')) throw new Error('нужна дата from'); const to = DATE.test(op.to || '') ? op.to : op.from; return { op, run: () => state.flagMarks.push({ id: uid(), flag: f, from: op.from, to, note: String(op.note || '').slice(0, 100) }), txt: `Отметить «${state.flagTypes.find(x => x.id === f).name}»: ${op.from}${to !== op.from ? ' — ' + to : ''}` }; }
        case 'addFlagType': { if (!op.name) throw new Error('нужно name'); return { op, run: () => state.flagTypes.push({ id: 'f_' + uid().slice(0, 8), name: String(op.name).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(op.color || '') ? op.color : '#5B7FD6' }), txt: `Новый признак дня: ${op.name}` }; }
        case 'addEnglish': { if (!op.text) throw new Error('нужно text'); return { op, run: () => { state.meta.englishBank = [...(state.meta.englishBank || []), String(op.text).slice(0, 500)]; }, txt: `Задание по английскому: ${String(op.text).slice(0, 80)}` }; }
        default: throw new Error('неизвестная операция ' + op.op);
      }
    } catch (e) { return { op, err: `№${i + 1}: ${e.message}` }; }
  });
}

/** Выгрузка для Claude: только то, что нужно для планирования. */
export function exportForClaude() {
  const tasks = state.tasks.filter(t => !t.archived && (t.kind !== 'once' || !t.done)).map(t => {
    const o = { id: t.id, title: t.title, kind: t.kind, cat: t.cat };
    for (const k of ['date', 'end', 'until', 'time', 'timeOff', 'dur', 'rule', 'cond', 'important', 'urgent', 'remind', 'note', 'flex', 'info', 'block', 'booking']) if (t[k] !== undefined && t[k] !== '' && t[k] !== false) o[k] = t[k];
    return o;
  });
  return JSON.stringify({ ezhednevnik: 1, today: today(), flags: state.flagTypes.map(f => ({ id: f.id, name: f.name, auto: !!f.auto })), marks: state.flagMarks.filter(m => (m.to || m.from) >= today()), birthdays: state.birthdays.map(b => ({ name: b.name, date: b.date, warn: b.warn })), husbandCycle: state.settings.husband, tasks }, null, 1);
}

export function render() {
  return `<h1>Для Claude</h1>
  <div class="note">Приложение не обращается к Claude и не хранит никаких ключей. Обмен — только текстом и только по твоему нажатию: Claude присылает в чате блок, ты вставляешь его сюда.</div>
  <section><h2>Вставить от Claude</h2><div class="card">
    <textarea id="cl-in" class="inp" rows="6" placeholder="Вставь сюда блок, который прислал Claude"></textarea>
    <div class="row"><button class="btn" data-act="clCheck">Проверить</button></div>
    ${pending ? `<div class="list">${pending.map(p => `<div class="it"><span class="dot" style="--c:${p.err ? 'var(--danger)' : 'var(--ok)'}"></span><div class="grow"><div class="t">${esc(p.err || p.txt)}</div></div><span></span></div>`).join('')}</div>
    <div class="row"><button class="btn" data-act="clApply" ${pending.some(p => !p.err) ? '' : 'disabled'}>Применить (${pending.filter(p => !p.err).length})</button><button class="btn ghost" data-act="clCancel">Отмена</button></div>${pending.some(p => p.err) ? '<span class="hint">Строки с ошибками будут пропущены.</span>' : ''}` : ''}
  </div></section>
  <section><h2>Отправить Claude своё расписание</h2><div class="card"><span class="hint">Скопируй и вставь в чат вместе с просьбой — например, «подбери время для бассейна» или «составь план на неделю». В выгрузке нет пароля и личных заметок о здоровье.</span><button class="btn ghost" data-act="clExport">Скопировать для Claude</button><textarea id="cl-out" class="inp" rows="3" readonly hidden></textarea></div></section>
  <details class="card"><summary>Формат для Claude (описание)</summary>
  <p class="hint">Операции: addTask, updateTask, deleteTask (по id или match.title), addBirthday, markFlag, addFlagType, addEnglish.</p>
  <p class="hint">Типы задач: once, repeat, span, event. Категории: ${CATS.map(c => c.id).join(', ')}.</p>
  <p class="hint">rule.freq: daily, weekly (byWd: 0=вс…6=сб, parity: even|odd, perWeek), monthly (monthDay или monthMode:"nth" + nth: 1–4|-1 + nthWd), yearly, days (каждые N дней), after (через interval days|months после выполнения). interval — каждый N-й.</p>
  <p class="hint">cond: {op:"and"|"or", items:[{flag, not?} | вложенная группа]}. Признаки: ${state.flagTypes.map(f => f.id + ' — ' + esc(f.name)).join('; ')}.</p>
  <pre>${esc(EXAMPLE)}</pre></details>`;
}

on('clCheck', () => {
  const v = document.getElementById('cl-in').value;
  try { pending = parseOps(v); } catch (e) { pending = null; toast('Не получилось прочитать: ' + e.message); return; }
  window.app.render();
});
on('clCancel', () => { pending = null; window.app.render(); });
on('clApply', () => { const ok = pending.filter(p => !p.err); ok.forEach(p => p.run()); pending = null; commit(); toast(`Применено: ${ok.length}`); });
on('clExport', async () => {
  const txt = exportForClaude(), ta = document.getElementById('cl-out');
  ta.hidden = false; ta.value = txt;
  const ok = await copyText(txt, ta); toast(ok ? 'Скопировано — вставь в чат с Claude' : 'Выделила текст — нажми «Копировать»');
});
