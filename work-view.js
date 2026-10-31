// Планы по типу дня: Работа · Дача · Отпуск · Отпуск мужа · Больничный.
// В каждом — матрица «важно/срочно» с перетаскиванием между квадрантами и на день, подзадачи «за N дней до».
// Дело без даты в «Даче» само встаёт на ближайший день дачи (то же для отпуска и больничного).
// Для работы — ещё «Встречи»: запись голосом, расшифровка, мемо и задачи из встречи.
// Голос — Web Speech API браузера (распознаёт сервер Google или Яндекса, нужен интернет). Claude из приложения не вызывается.
import { state, commit, uid } from './core-store.js';
import { esc, on, toast, enableDrag, openSheet, closeSheet, copyText } from './ui.js';
import { today, addDays, fmtDay, WDS, D, durTxt } from './core-dates.js';
import { parseText, addTask, updateTask, getTask, setDone, moveItem, deleteTask, newTask } from './tasks-model.js';
import { QUADS, quadOf, openEditor } from './tasks-editor.js';
import { itemSheet } from './calendar-view.js';
import { nextFlagDay, planDate } from './core-occur.js';

export const CTX = [
  { id: 'work', name: 'Работа', icon: '💼', cat: 'work', hint: 'рабочие дела, встречи и мемо' },
  { id: 'dacha', name: 'Дача', icon: '🏡', cat: 'home', hint: 'дело без даты встанет на ближайшую дачу' },
  { id: 'vac_me', name: 'Отпуск', icon: '🏖', cat: 'personal', hint: 'на ближайший день отпуска' },
  { id: 'vac_h', name: 'Отпуск мужа', icon: '🧳', cat: 'family', hint: 'на ближайший день отпуска мужа' },
  { id: 'sick', name: 'Больничный', icon: '🤒', cat: 'health', hint: 'на ближайший день больничного' }
];
const ui = { ctx: 'work', view: 'matrix', q: 'all', status: 'open' };
export const setCtx = id => { ui.ctx = id; };
const ctxOf = id => CTX.find(c => c.id === id) || CTX[0];

const ctxTasks = () => state.tasks.filter(t => !t.archived && t.kind === 'once' && (ui.ctx === 'work' ? (t.ctx === 'work' || (!t.ctx && t.cat === 'work')) : t.ctx === ui.ctx));
function filtered() {
  return ctxTasks().filter(t => (ui.status === 'all' || (ui.status === 'open' ? !t.done : t.done)) && (ui.q === 'all' || quadOf(t).id === ui.q))
    .sort((a, b) => (planDate(a) || '9999').localeCompare(planDate(b) || '9999') || (a.time || '').localeCompare(b.time || ''));
}
export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

const whenTxt = t => { const d = planDate(t); if (!d) return t.ctx && t.ctx !== 'work' ? 'дня пока нет в календаре' : 'без даты'; return (t.date ? '' : 'ближайший: ') + fmtDay(d) + (t.time ? ', ' + t.time : ''); };
const subsTxt = t => t.subs && t.subs.length ? ` · ✓ ${t.subs.filter(s => s.done).length}/${t.subs.length}` : '';

export function render() {
  const c = ctxOf(ui.ctx), list = filtered(), nd = ui.ctx !== 'work' ? nextFlagDay(ui.ctx) : null;
  const qi = t => `<div class="qi ${t.done ? 'done' : ''}" data-drag="${t.id}" data-act="pItem" data-id="${t.id}">${esc(t.title)}<span class="hint"> · ${esc(whenTxt(t))}${subsTxt(t)}</span></div>`;
  return `<h1>Планы</h1>
  <div class="chips ctx">${CTX.map(x => `<button class="chip" data-act="pCtx" data-v="${x.id}" aria-pressed="${ui.ctx === x.id}">${x.icon} ${x.name} <small>${state.tasks.filter(t => !t.archived && !t.done && t.kind === 'once' && (x.id === 'work' ? (t.ctx === 'work' || (!t.ctx && t.cat === 'work')) : t.ctx === x.id)).length}</small></button>`).join('')}</div>
  <span class="hint">${c.icon} ${c.hint}${ui.ctx !== 'work' ? ` · ${nd ? 'ближайший день: <b>' + esc(fmtDay(nd)) + '</b>' : 'таких дней в календаре пока нет — отметь их в «Признаки дня»'}` : ''}</span>
  <div class="card"><textarea id="w-in" class="inp" rows="2" placeholder="${ui.ctx === 'dacha' ? 'Покрасить стены; важно поправить забор' : 'Что нужно сделать: «важно завтра в 10 созвон по ТЗ 1 ч; срочно отчёт к пятнице»'}"></textarea>
    <div class="row between"><div class="row">${speechSupported() ? '<button class="btn ghost" data-act="wMic" id="w-mic" aria-label="Сказать голосом">🎤</button>' : ''}<button class="btn" data-act="wAdd">Добавить в «${esc(c.name)}»</button></div></div>
    <span class="hint">Несколько дел — через точку с запятой. «важно», «срочно» — сразу в нужный квадрант. Подзадачи — нажми на дело.</span></div>
  <div class="row between"><div class="seg" role="group" aria-label="Вид"><button data-act="wView" data-v="matrix" aria-pressed="${ui.view === 'matrix'}">Матрица</button><button data-act="wView" data-v="list" aria-pressed="${ui.view === 'list'}">Список</button></div>
    <div class="seg" role="group" aria-label="Статус">${[['open', 'Открытые'], ['done', 'Сделано'], ['all', 'Все']].map(([k, n]) => `<button data-act="wStatus" data-v="${k}" aria-pressed="${ui.status === k}">${n}</button>`).join('')}</div></div>
  ${ui.ctx === 'work' ? `<section><h2>Перетащи дело на день</h2><div class="strip">${[...Array(7)].map((_, i) => { const ds = addDays(today(), i); return `<div class="sd" data-drop="day:${ds}">${i === 0 ? 'Сег.' : i === 1 ? 'Завт.' : WDS[D(ds).getDay()]}<br><b>${D(ds).getDate()}</b></div>`; }).join('')}</div></section>` : ''}
  ${ui.view === 'matrix'
      ? `<div class="matrix">${QUADS.map(q => { const it = list.filter(t => quadOf(t).id === q.id); return `<div class="quad" style="--c:${q.c}" data-drop="q:${q.id}"><h3>${q.name}<span class="hint">${it.length}</span></h3><div class="ax">${q.ax}</div>${it.map(qi).join('') || '<span class="hint">перетащи сюда</span>'}</div>`; }).join('')}</div>`
      : (list.length ? `<div class="list">${list.map(t => `<div class="it ${t.done ? 'done' : ''}"><input type="checkbox" class="check" data-act="wDone" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Сделано"><div class="bd" style="--c:${quadOf(t).c}" data-act="pItem" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="m">${esc(quadOf(t).name)} · ${esc(whenTxt(t))} · ${durTxt(+t.dur || 30)}${subsTxt(t)}</div></div><span></span></div>`).join('')}</div>` : '<div class="empty">Пока пусто. Добавь первое дело выше.</div>')}
  ${ui.ctx === 'work' ? meetingsHtml() : ''}`;
}

on('pCtx', d => { ui.ctx = d.v; window.app.render(); });
on('wView', d => { ui.view = d.v; window.app.render(); });
on('wStatus', d => { ui.status = d.v; window.app.render(); });
on('wQ', d => { ui.q = d.v; window.app.render(); });
on('wAdd', () => {
  const el = document.getElementById('w-in'); const text = el.value.trim(); if (!text) { el.focus(); return; }
  const c = ctxOf(ui.ctx);
  el.value = ''; // очистить до сохранения: иначе перерисовка вернёт старый текст
  const items = parseText(text, { cat: c.cat });
  items.forEach(t => {
    if (t.kind !== 'once') t.kind = 'once';
    t.ctx = c.id; t.cat = c.cat;
    // в «Даче» и других: если дату не назвали — без даты, встанет на ближайший такой день
    if (c.id !== 'work' && !/(сегодня|завтра|послезавтра|\d{1,2}[.\/]\d{1,2}|понедельн|вторн|сред|четверг|пятниц|суббот|воскресен)/i.test(text)) { t.date = ''; t.time = ''; }
    addTask(t);
  });
  toast(items.length === 1 ? `Добавлено: ${items[0].title} → ${quadOf(items[0]).name}${items[0].date ? ', ' + fmtDay(items[0].date) : ''}. Поменять — нажми на дело` : `Добавлено дел: ${items.length}`);
});
on('wDone', (d, el) => { const t = getTask(d.id); if (t.date) setDone(t, t.date, el.checked); else { t.done = el.checked; commit(); } });
on('pItem', (d, el) => { if (el.dataset.justDragged) return; planSheet(d.id); });
on('wItem', (d, el) => { if (el.dataset.justDragged) return; planSheet(d.id); });

/** Карточка дела из планировщика: квадрант, дата (своя или «ближайший день»), подзадачи «за N дней до». */
export function planSheet(id) {
  const t = getTask(id); if (!t) return;
  const auto = t.ctx && t.ctx !== 'work';
  const subRow = s => `<div class="sub-row ${s.done ? 'done' : ''}"><input type="checkbox" class="check" data-s="done" data-sid="${s.id}" ${s.done ? 'checked' : ''} aria-label="Сделано"><span class="grow">${esc(s.title)}</span><span class="hint">${s.before ? 'за ' + s.before + ' дн.' : 'в тот же день'} · ${esc(fmtDay(addDays(planDate(t) || today(), -(+s.before || 0))))}</span><button class="x" data-s="del" data-sid="${s.id}" aria-label="Удалить">×</button></div>`;
  const sh = openSheet(`<h3>${esc(t.title)}</h3><span class="hint">${esc(ctxOf(t.ctx || 'work').icon + ' ' + ctxOf(t.ctx || 'work').name)} · ${esc(whenTxt(t))}</span>
    <h2>Квадрант</h2><div class="chips sm">${QUADS.map(q => `<button class="chip" data-s="q" data-v="${q.id}" aria-pressed="${quadOf(t).id === q.id}" style="border-color:${q.c}">${q.name}</button>`).join('')}</div>
    <h2>Когда</h2><div class="fields"><label class="field">Дата${auto ? ' (пусто — ближайший день)' : ''}<input type="date" id="pl-d" value="${esc(t.date || '')}"></label><label class="field">Время<input type="time" id="pl-t" value="${esc(t.time || '')}"></label><label class="field">Минут<input type="number" id="pl-dur" min="5" step="5" value="${+t.dur || 30}"></label></div>
    <h2>Подзадачи</h2><div class="subs">${(t.subs || []).map(subRow).join('') || '<span class="hint">Например: «купить краску» за 2 дня до.</span>'}</div>
    <div class="fields"><label class="field grow">Подзадача<input id="pl-st" placeholder="Купить краску"></label><label class="field">За дней до<input type="number" id="pl-sb" min="0" max="60" value="2"></label></div>
    <button class="btn ghost small" data-s="add">+ Добавить подзадачу</button>
    <div class="actions"><button class="btn ghost danger" data-s="delTask">Удалить</button><span class="row"><button class="btn ghost" data-s="done">${t.done ? 'Вернуть в работу' : '✓ Сделано'}</button><button class="btn" data-s="save">Сохранить</button></span></div>`, 'Дело');
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const k = b.dataset.s;
    if (k === 'q') { const q = QUADS.find(x => x.id === b.dataset.v); t.important = q.imp; t.urgent = q.urg; commit(); sh.querySelectorAll('[data-s="q"]').forEach(x => x.setAttribute('aria-pressed', x === b)); return; }
    if (k === 'add') { const ti = document.getElementById('pl-st').value.trim(); if (!ti) return document.getElementById('pl-st').focus(); t.subs = [...(t.subs || []), { id: uid(), title: ti, before: Math.max(0, +document.getElementById('pl-sb').value || 0), done: false }]; commit(); closeSheet(); planSheet(t.id); toast('Подзадача добавлена'); return; }
    if (k === 'del') { t.subs = (t.subs || []).filter(s => s.id !== b.dataset.sid); commit(); closeSheet(); planSheet(t.id); return; }
    if (k === 'done' && b.dataset.sid) { const s = t.subs.find(x => x.id === b.dataset.sid); s.done = b.checked; commit(); return; }
    if (k === 'done') { t.done = !t.done; commit(); closeSheet(); toast(t.done ? 'Сделано' : 'Вернула в работу'); return; }
    if (k === 'delTask') { if (b.dataset.sure) { deleteTask(t.id); closeSheet(); toast('Удалено'); } else { b.dataset.sure = 1; b.textContent = 'Точно удалить?'; } return; }
    if (k === 'save') { t.date = document.getElementById('pl-d').value; t.time = document.getElementById('pl-t').value; t.dur = Math.max(5, +document.getElementById('pl-dur').value || 30); commit(); closeSheet(); toast('Сохранено'); }
  });
}

/* ---------- Встречи: запись голосом → расшифровка → мемо и задачи ---------- */
const memos = () => (state.meta.memos = state.meta.memos || []);
function meetingsHtml() {
  const ms = memos().slice(-3).reverse();
  return `<details class="card meet" ${ms.length ? '' : 'open'}><summary><b>🎙 Встречи и мемо</b>${ms.length ? ` <span class="hint">· ${memos().length}</span>` : ''}</summary>
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn" data-act="mNew">🎙 Записать встречу</button><button class="btn ghost" data-act="mPaste">📋 Вставить расшифровку</button></div>
    <span class="hint">Запись идёт в приложении (нужен интернет, распознаёт Google/Яндекс). Или запиши встречу диктофоном Samsung, сделай там расшифровку и вставь текст сюда.</span>
    ${ms.length ? `<div class="list">${ms.map(m => `<div class="it" data-act="mOpen" data-id="${m.id}" style="cursor:pointer"><div class="tm">${esc(fmtDay(m.date))}</div><div class="bd" style="--c:#2C64C6"><div class="t">${esc(m.title)}</div><div class="m">${m.memo ? 'мемо готово' : 'расшифровка · ' + (m.text || '').length + ' знаков'}${m.tasks ? ' · задач: ' + m.tasks : ''}</div></div><span></span></div>`).join('')}</div>` : ''}
    ${memos().length > 3 ? `<button class="btn ghost small" data-act="mAll">Все встречи (${memos().length})</button>` : ''}</details>`;
}
let mrec = null;
function meetingSheet(m) {
  const sh = openSheet(`<h3>Встреча</h3>
    <div class="fields"><label class="field grow">Тема<input id="m-title" value="${esc(m.title)}"></label><label class="field">Дата<input type="date" id="m-date" value="${m.date}"></label></div>
    <label class="field">Расшифровка<textarea id="m-text" class="inp" rows="7" placeholder="Нажми «Запись» или вставь текст расшифровки">${esc(m.text || '')}</textarea></label>
    <div class="row" style="flex-wrap:wrap;gap:8px">${speechSupported() ? `<button class="btn ghost" data-m="rec" id="m-rec">⏺ Запись</button>` : ''}<button class="btn ghost" data-m="memo">📝 Сделать мемо</button><button class="btn ghost" data-m="claude">✨ Мемо через Claude</button></div>
    <label class="field">Мемо<textarea id="m-memo" class="inp" rows="7" placeholder="Появится после «Сделать мемо»; можно править">${esc(m.memo || '')}</textarea></label>
    <div id="m-tasks"></div>
    <div class="actions"><button class="btn ghost danger" data-m="del">Удалить</button><span class="row"><button class="btn ghost" data-m="copy">Копировать мемо</button><button class="btn" data-m="save">Сохранить</button></span></div>`, 'Встреча');
  const save = () => { m.title = document.getElementById('m-title').value.trim() || 'Встреча'; m.date = document.getElementById('m-date').value || today(); m.text = document.getElementById('m-text').value; m.memo = document.getElementById('m-memo').value; if (!memos().includes(m)) memos().push(m); commit(); };
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const k = b.dataset.m, ta = document.getElementById('m-text');
    if (k === 'rec') {
      if (mrec) { mrec.stopAll = true; mrec.stop(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      let base = ta.value ? ta.value.trim() + '\n' : '';
      const start = () => {
        mrec = new SR(); mrec.lang = 'ru-RU'; mrec.continuous = true; mrec.interimResults = true;
        mrec.onresult = ev => { let fin = '', tmp = ''; for (let i = 0; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript + '. '; else tmp += r[0].transcript; } ta.value = base + fin + tmp; ta.dataset.fin = base + fin; };
        mrec.onerror = ev => { if (ev.error === 'not-allowed') { toast('Разреши микрофон в настройках браузера'); mrec.stopAll = true; } };
        // браузер сам останавливает распознавание через минуту-две тишины — перезапускаем, пока не нажмёшь «Стоп»
        mrec.onend = () => { if (mrec && !mrec.stopAll) { base = (ta.dataset.fin || ta.value).trim() + '\n'; try { start(); } catch (err) { mrec = null; } } else { mrec = null; const x = document.getElementById('m-rec'); if (x) x.textContent = '⏺ Запись'; save(); toast('Запись остановлена'); } };
        mrec.start();
      };
      try { start(); b.textContent = '■ Стоп'; toast('Идёт запись встречи…'); } catch (err) { mrec = null; toast('Запись недоступна в этом браузере'); }
      return;
    }
    if (k === 'memo') { const r = makeMemo(ta.value, document.getElementById('m-title').value); document.getElementById('m-memo').value = r.memo; showTasks(r.tasks, m); save(); return; }
    if (k === 'claude') { save(); copyText(claudePrompt(m)); toast('Скопировано. Вставь в чат с Claude, ответ — во вкладку «Для Claude»'); return; }
    if (k === 'copy') { copyText(document.getElementById('m-memo').value || ta.value); toast('Мемо скопировано'); return; }
    if (k === 'del') { if (b.dataset.sure) { state.meta.memos = memos().filter(x => x !== m); commit(); closeSheet(); toast('Встреча удалена'); } else { b.dataset.sure = 1; b.textContent = 'Точно удалить?'; } return; }
    if (k === 'save') { save(); closeSheet(); toast('Встреча сохранена'); }
    if (k === 'addT') { const ti = b.dataset.t; addTask(newTask({ title: ti, cat: 'work', ctx: 'work', date: b.dataset.d || '', important: true })); m.tasks = (m.tasks || 0) + 1; commit(); b.disabled = true; b.textContent = '✓ ' + ti; }
  });
}
function showTasks(list, m) {
  const el = document.getElementById('m-tasks'); if (!el) return;
  el.innerHTML = list.length ? `<h2>Задачи из встречи</h2><div class="chips sm">${list.map(x => `<button class="chip" data-m="addT" data-t="${esc(x.title)}" data-d="${x.date || ''}">+ ${esc(x.title)}${x.date ? ' · ' + esc(fmtDay(x.date)) : ''}</button>`).join('')}</div><span class="hint">Нажми — задача попадёт в «Работу».</span>` : '<span class="hint">Явных поручений в тексте не нашлось.</span>';
}
/** Простое мемо без интернета: участники, договорённости, поручения со сроками — по ключевым словам. */
export function makeMemo(text, title = 'Встреча') {
  const sents = (text || '').replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3);
  const isTask = s => !/^(обсудили|рассмотрели|обсуждали)/i.test(s) && /(нужно|надо|необходимо|сделать|подготовить|отправить|направить|согласовать|проверить|подготовит|сделает|отправит|поручить|прошу|до\s+(\d|понедельник|вторник|сред|четверг|пятниц|конца)|к\s+(понедельник|вторник|сред|четверг|пятниц)|в\s+срок)/i.test(s);
  const isDecision = s => /(решили|договорились|согласовали|утвердили|принято|итог|вывод)/i.test(s);
  const tasks = sents.filter(isTask).slice(0, 12).map(s => {
    const p = parseText(s)[0] || {};
    return { title: s.replace(/^(итак|так|и|ну)\s+/i, '').replace(/[.!?…]+$/, '').slice(0, 120), date: p.date && p.date !== today() ? p.date : '' };
  });
  const dec = sents.filter(isDecision).slice(0, 10);
  const memo = [`МЕМО: ${title || 'Встреча'} — ${fmtDay(today())}`, '',
    'Договорённости:', ...(dec.length ? dec.map(s => '• ' + s) : ['• —']), '',
    'Поручения:', ...(tasks.length ? tasks.map(x => '• ' + x.title + (x.date ? ' — срок ' + fmtDay(x.date) : '')) : ['• —']), '',
    'Кратко:', ...sents.filter(s => !isTask(s) && !isDecision(s)).slice(0, 6).map(s => '• ' + s)].join('\n');
  return { memo, tasks };
}
function claudePrompt(m) {
  return `Сделай деловое мемо встречи «${m.title}» (${m.date}) по расшифровке ниже: цель, участники (если понятно), ключевые обсуждения, решения, поручения (кто, что, срок), открытые вопросы. Коротко, деловым русским языком.
Затем отдельным блоком верни JSON для моего ежедневника: [{"op":"addTask","task":{"title":"...","cat":"work","ctx":"work","date":"YYYY-MM-DD или пусто","important":true,"urgent":false}}] — только для моих поручений.

Расшифровка:
${m.text || ''}`;
}
on('mNew', () => meetingSheet({ id: uid(), title: 'Встреча', date: today(), text: '', memo: '' }));
on('mPaste', () => meetingSheet({ id: uid(), title: 'Встреча', date: today(), text: '', memo: '' }));
on('mOpen', d => { const m = memos().find(x => x.id === d.id); if (m) meetingSheet(m); });
on('mAll', () => {
  const sh = openSheet(`<h3>Все встречи</h3><div class="list">${memos().slice().reverse().map(m => `<div class="it" data-mo="${m.id}" style="cursor:pointer"><div class="tm">${esc(fmtDay(m.date))}</div><div class="bd" style="--c:#2C64C6"><div class="t">${esc(m.title)}</div></div><span></span></div>`).join('')}</div><div class="actions"><button class="btn ghost" data-mo="close">Закрыть</button></div>`, 'Встречи');
  sh.addEventListener('click', e => { const b = e.target.closest('[data-mo]'); if (!b) return; closeSheet(); if (b.dataset.mo !== 'close') { const m = memos().find(x => x.id === b.dataset.mo); if (m) meetingSheet(m); } });
});

let rec = null;
on('wMic', (d, btn) => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (rec) { rec.stop(); return; }
  try {
    rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = false;
    const el = document.getElementById('w-in'), base = el.value ? el.value.trim() + ' ' : '';
    rec.onresult = e => { let s = ''; for (const r of e.results) s += r[0].transcript; el.value = base + s; };
    rec.onerror = e => { toast(e.error === 'not-allowed' ? 'Разреши доступ к микрофону в настройках браузера' : e.error === 'network' ? 'Нет интернета для распознавания — используй микрофон на клавиатуре' : 'Не получилось распознать'); };
    rec.onend = () => { rec = null; const b = document.getElementById('w-mic'); if (b) b.textContent = '🎤'; };
    rec.start(); btn.textContent = '■'; toast('Говори…');
  } catch (e) { rec = null; toast('Голосовой ввод недоступен'); }
});

/** Перетаскивание: в квадрант — меняет приоритет, на день — переносит. */
export function bindWorkDrag(root) {
  enableDrag(root, (id, target) => {
    if (id.includes('|') || !/^(q|day):/.test(target)) return; // только «Планы»: квадрант или день
    const t = getTask(id); if (!t) return;
    if (target.startsWith('q:')) { const q = QUADS.find(x => x.id === target.slice(2)); updateTask(id, { important: q.imp, urgent: q.urg }); toast('Теперь: ' + q.name); }
    if (target.startsWith('day:')) { const ds = target.slice(4); if (t.date) moveItem(t, t.date, ds); else updateTask(id, { date: ds }); toast('Перенесено на ' + fmtDay(ds)); }
  });
}
