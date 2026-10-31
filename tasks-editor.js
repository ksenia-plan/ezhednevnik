// Редактор задачи: тип, дата/период, время, конструктор повторений, конструктор условий, матрица приоритета.
import { state } from './core-store.js';
import { esc, openSheet, closeSheet, toast } from './ui.js';
import { CATS } from './core-seed.js';
import { KINDS, newTask, addTask, updateTask, deleteTask, getTask } from './tasks-model.js';
import { describeRule } from './core-recur.js';
import { describeCond } from './core-cond.js';
import { WDS, today, D } from './core-dates.js';

export const QUADS = [
  { id: 'q1', name: 'Сделать сейчас', ax: 'важно и срочно', imp: true, urg: true, c: 'var(--danger)' },
  { id: 'q2', name: 'Запланировать', ax: 'важно, не срочно', imp: true, urg: false, c: 'var(--accent)' },
  { id: 'q3', name: 'Срочно — можно поручить', ax: 'срочно, не важно', imp: false, urg: true, c: 'var(--warn)' },
  { id: 'q4', name: 'Когда-нибудь', ax: 'не важно, не срочно', imp: false, urg: false, c: 'var(--muted)' }
];
export const quadOf = t => QUADS.find(q => q.imp === !!t.important && q.urg === !!t.urgent);

let draft = null, isNew = false;
const clone = o => JSON.parse(JSON.stringify(o));

/** Открыть редактор. id — существующая задача; preset — поля для новой. */
export function openEditor(id, preset = {}) {
  const t = id ? getTask(id) : null;
  isNew = !t;
  draft = t ? clone(t) : newTask(preset);
  if (!draft.rule) draft.rule = { freq: 'weekly', byWd: [D(draft.date || today()).getDay()], interval: 1 };
  render();
}

function flagOptions(sel) {
  const groups = [['Автоматические', state.flagTypes.filter(f => f.auto)], ['Мои признаки', state.flagTypes.filter(f => !f.auto)]];
  return groups.map(([g, list]) => `<optgroup label="${g}">${list.map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>`).join('');
}
function condHtml(c, path) {
  const items = c.items || [];
  return `<div class="cond"><div class="row between"><div class="seg" role="group" aria-label="Связка условий"><button type="button" data-ed="op" data-path="${path}" data-v="and" aria-pressed="${c.op !== 'or'}">Все (И)</button><button type="button" data-ed="op" data-path="${path}" data-v="or" aria-pressed="${c.op === 'or'}">Любое (ИЛИ)</button></div>${path ? `<button type="button" class="x" data-ed="delc" data-path="${path}" aria-label="Удалить группу">×</button>` : ''}</div>
  ${items.map((it, i) => it.items ? condHtml(it, `${path}${path ? '.' : ''}${i}`) : `<div class="cr"><button type="button" class="chip" data-ed="not" data-path="${path}${path ? '.' : ''}${i}" aria-pressed="${!!it.not}">${it.not ? 'НЕ' : 'да'}</button><select class="inp" data-ed="flag" data-path="${path}${path ? '.' : ''}${i}">${flagOptions(it.flag)}</select><button type="button" class="x" data-ed="delc" data-path="${path}${path ? '.' : ''}${i}" aria-label="Удалить условие">×</button></div>`).join('')}
  <div class="row"><button type="button" class="btn ghost small" data-ed="addc" data-path="${path}">+ признак</button>${path.split('.').filter(Boolean).length < 2 ? `<button type="button" class="btn ghost small" data-ed="addg" data-path="${path}">+ группа</button>` : ''}</div></div>`;
}
function ruleHtml() {
  const r = draft.rule, f = r.freq;
  const freqs = [['daily', 'Каждый день'], ['weekly', 'По дням недели'], ['monthly', 'Раз в месяц'], ['yearly', 'Раз в год'], ['days', 'Каждые N дней'], ['after', 'Через N после выполнения']];
  let h = `<div class="fields"><label class="field">Как повторять<select id="ed-freq">${freqs.map(([k, n]) => `<option value="${k}" ${k === f ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
  if (f !== 'after') h += `<label class="field">${f === 'weekly' ? 'Каждую N-ю неделю' : f === 'monthly' ? 'Каждый N-й месяц' : f === 'yearly' ? 'Каждый N-й год' : 'Интервал, дней'}<input id="ed-int" type="number" min="1" max="99" value="${+r.interval || 1}"></label>`;
  else h += `<label class="field">Через<input id="ed-int" type="number" min="1" max="99" value="${+r.interval || 21}"></label><label class="field">Единица<select id="ed-unit"><option value="days" ${r.unit !== 'months' ? 'selected' : ''}>дней</option><option value="months" ${r.unit === 'months' ? 'selected' : ''}>месяцев</option></select></label>`;
  h += '</div>';
  if (f === 'weekly') {
    const by = r.byWd && r.byWd.length ? r.byWd : [D(draft.date || today()).getDay()];
    h += `<div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="chip" data-ed="wd" data-v="${d}" aria-pressed="${by.includes(d)}">${WDS[d]}</button>`).join('')}</div>
    <div class="fields"><label class="field">Недели<select id="ed-par"><option value="any">все</option><option value="even" ${r.parity === 'even' ? 'selected' : ''}>только чётные</option><option value="odd" ${r.parity === 'odd' ? 'selected' : ''}>только нечётные</option></select></label>
    <label class="field">Не больше раз в неделю<select id="ed-pw"><option value="0">без ограничения</option>${[1, 2, 3, 4, 5].map(n => `<option ${+r.perWeek === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>${+r.perWeek ? `<div class="chips"><button type="button" class="chip" data-ed="spread" aria-pressed="${r.spread === false}">Можно два дня подряд</button></div>` : ''}`;
  }
  if (f === 'monthly') {
    const NTH = [[1, 'первый'], [2, 'второй'], [3, 'третий'], [4, 'четвёртый'], [-1, 'последний']];
    h += `<div class="seg" role="group"><button type="button" data-ed="mm" data-v="day" aria-pressed="${r.monthMode !== 'nth'}">По числу</button><button type="button" data-ed="mm" data-v="nth" aria-pressed="${r.monthMode === 'nth'}">По дню недели</button></div>`;
    h += r.monthMode === 'nth'
      ? `<div class="fields"><label class="field">Какой<select id="ed-nth">${NTH.map(([v, n]) => `<option value="${v}" ${+r.nth === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="field">День недели<select id="ed-nwd">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${+(r.nthWd ?? D(draft.date || today()).getDay()) === d ? 'selected' : ''}>${WDS[d]}</option>`).join('')}</select></label></div>`
      : `<div class="fields"><label class="field">Число месяца<input id="ed-md" type="number" min="1" max="31" value="${r.monthDay || D(draft.date || today()).getDate()}"></label></div>`;
  }
  return h + `<div class="hint">${esc(describeRule(draft))}</div>`;
}

function render() {
  const t = draft, k = t.kind;
  const html = `<h3>${isNew ? 'Новая задача' : 'Задача'}</h3>
  <label class="field wide">Название<input id="ed-title" class="inp" value="${esc(t.title)}" placeholder="Что сделать"></label>
  <div class="seg kinds" role="group" aria-label="Тип">${Object.entries(KINDS).map(([id, n]) => `<button type="button" data-ed="kind" data-v="${id}" aria-pressed="${k === id}">${n}</button>`).join('')}</div>
  <div class="fields">
    <label class="field">Категория<select id="ed-cat">${CATS.map(c => `<option value="${c.id}" ${c.id === t.cat ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
    <label class="field">${k === 'repeat' ? 'Начиная с' : k === 'span' ? 'С' : 'Дата'}<input id="ed-date" type="date" value="${esc(t.date || '')}"></label>
    ${k === 'span' ? `<label class="field">По<input id="ed-end" type="date" value="${esc(t.end || t.date || '')}"></label>` : ''}
    ${k === 'repeat' ? `<label class="field">До (необязательно)<input id="ed-until" type="date" value="${esc(t.until || '')}"></label>` : ''}
  </div>
  <div class="fields">
    <label class="field">Время<input id="ed-time" type="time" value="${esc(t.time || '')}"></label>
    <label class="field">В мои выходные<input id="ed-toff" type="time" value="${esc(t.timeOff || '')}"></label>
    <label class="field">Минут<input id="ed-dur" type="number" min="5" max="900" step="5" value="${+t.dur || 30}"></label>
    ${k === 'repeat' ? `<label class="field">Минут в выходные<input id="ed-doff" type="number" min="0" max="900" step="5" value="${+t.durOff || ''}" placeholder="как в будни"></label>` : ''}
  </div>
  ${k === 'repeat' ? `<h2>Повторение</h2>${ruleHtml()}` : ''}
  ${k === 'repeat' ? `<h2>Ставить, только если…</h2><span class="hint">Пусто — ставится всегда. Пример: «не мой отпуск» или «муж на смене».</span>${condHtml(t.cond || { op: 'and', items: [] }, '')}${t.cond && t.cond.items?.length ? `<div class="hint">${esc(describeCond(t.cond))}</div>` : ''}` : ''}
  <h2>Приоритет</h2>
  <div class="q-pick">${QUADS.map(q => `<button type="button" style="--c:${q.c}" data-ed="quad" data-v="${q.id}" aria-pressed="${quadOf(t).id === q.id}">${q.name}<br><span class="hint">${q.ax}</span></button>`).join('')}</div>
  <div class="fields"><label class="field">Напомнить заранее, дней<input id="ed-rem" type="number" min="0" max="60" value="${+t.remind || 0}"></label></div>
  <div class="chips"><button type="button" class="chip" data-ed="flexb" aria-pressed="${!!t.flex}">Сдвигать в свободное окно</button><button type="button" class="chip" data-ed="infob" aria-pressed="${!!t.info}">Не занимает моё время</button></div>
  <label class="field wide">Заметка<textarea id="ed-note" class="inp" rows="2">${esc(t.note || '')}</textarea></label>
  <div class="actions">${isNew ? '<span></span>' : '<button type="button" class="btn danger" data-ed="del">Удалить</button>'}<span class="row"><button type="button" class="btn ghost" data-ed="close">Закрыть</button><button type="button" class="btn" data-ed="save">Сохранить</button></span></div>`;
  const sh = openSheet(html, 'Задача');
  sh.addEventListener('click', onClick); sh.addEventListener('change', onChange);
  if (isNew) setTimeout(() => document.getElementById('ed-title')?.focus(), 50);
}

/** Считать поля формы в черновик (без перерисовки). */
function readFields() {
  const v = id => document.getElementById(id)?.value;
  const t = draft;
  if (v('ed-title') !== undefined) t.title = v('ed-title').trim();
  if (v('ed-cat')) t.cat = v('ed-cat');
  if (v('ed-date') !== undefined) t.date = v('ed-date');
  if (v('ed-end') !== undefined) t.end = v('ed-end');
  if (v('ed-until') !== undefined) t.until = v('ed-until') || '';
  if (v('ed-time') !== undefined) t.time = v('ed-time');
  if (v('ed-toff') !== undefined) t.timeOff = v('ed-toff');
  if (v('ed-dur')) t.dur = Math.max(5, +v('ed-dur') || 30);
  if (v('ed-doff') !== undefined) { if (+v('ed-doff')) t.durOff = +v('ed-doff'); else delete t.durOff; }
  if (v('ed-rem') !== undefined) t.remind = +v('ed-rem') || 0;
  if (v('ed-note') !== undefined) t.note = v('ed-note').trim();
  const r = t.rule;
  if (v('ed-freq')) r.freq = v('ed-freq');
  if (v('ed-int')) r.interval = Math.max(1, +v('ed-int') || 1);
  if (v('ed-unit')) r.unit = v('ed-unit');
  if (v('ed-par')) r.parity = v('ed-par');
  if (v('ed-pw') !== undefined) r.perWeek = +v('ed-pw') || 0;
  if (v('ed-md')) r.monthDay = +v('ed-md');
  if (v('ed-nth')) r.nth = +v('ed-nth');
  if (v('ed-nwd')) r.nthWd = +v('ed-nwd');
  document.querySelectorAll('[data-ed="flag"]').forEach(s => { const it = at(s.dataset.path); if (it) it.flag = s.value; });
}
/** Найти узел условия по пути «0.1». */
function at(path) {
  let n = draft.cond; if (!path) return n;
  for (const i of path.split('.')) { if (!n || !n.items) return null; n = n.items[+i]; }
  return n;
}
function parentOf(path) { const p = path.split('.'); const i = +p.pop(); return [at(p.join('.')), i]; }

function onChange(e) {
  readFields();
  if (['ed-freq'].includes(e.target.id)) { if (draft.rule.freq === 'after' && !draft.rule.interval) draft.rule.interval = 21; render(); }
}
function onClick(e) {
  const b = e.target.closest('[data-ed]'); if (!b) return;
  readFields();
  const a = b.dataset.ed, path = b.dataset.path ?? '';
  if (a === 'close') { closeSheet(); return; }
  if (a === 'kind') { draft.kind = b.dataset.v; if (draft.kind === 'span' && !draft.end) draft.end = draft.date; }
  if (a === 'wd') { const d = +b.dataset.v; const set = new Set(draft.rule.byWd && draft.rule.byWd.length ? draft.rule.byWd : [D(draft.date || today()).getDay()]); set.has(d) ? set.delete(d) : set.add(d); draft.rule.byWd = [...set]; }
  if (a === 'mm') draft.rule.monthMode = b.dataset.v;
  if (a === 'spread') draft.rule.spread = draft.rule.spread === false ? true : false;
  if (a === 'quad') { const q = QUADS.find(x => x.id === b.dataset.v); draft.important = q.imp; draft.urgent = q.urg; }
  if (a === 'flexb') draft.flex = !draft.flex;
  if (a === 'infob') draft.info = !draft.info;
  if (a === 'op') { if (!draft.cond) draft.cond = { op: 'and', items: [] }; at(path).op = b.dataset.v; }
  if (a === 'addc') { if (!draft.cond) draft.cond = { op: 'and', items: [] }; at(path).items.push({ flag: 'h_works' }); }
  if (a === 'addg') { if (!draft.cond) draft.cond = { op: 'and', items: [] }; at(path).items.push({ op: 'or', items: [{ flag: 'my_off' }] }); }
  if (a === 'not') { const it = at(path); it.not = !it.not; }
  if (a === 'delc') { const [p, i] = parentOf(path); p.items.splice(i, 1); }
  if (a === 'del') { if (b.dataset.sure) { deleteTask(draft.id); closeSheet(); toast('Задача удалена'); } else { b.dataset.sure = 1; b.textContent = 'Точно удалить?'; } return; }
  if (a === 'save') { save(); return; }
  render();
}
function save() {
  const t = draft;
  if (!t.title) { toast('Напиши название'); document.getElementById('ed-title')?.focus(); return; }
  if (t.kind === 'span' && t.end && t.end < t.date) { toast('Конец периода раньше начала'); return; }
  if (t.kind === 'repeat' && !t.date) t.date = today();
  if (t.kind !== 'repeat') { delete t.cond; }
  if (t.cond && !t.cond.items?.length) delete t.cond;
  if (isNew) addTask(t); else updateTask(t.id, t);
  closeSheet(); toast(isNew ? 'Задача добавлена' : 'Сохранено');
}
