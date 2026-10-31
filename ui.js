// Общие элементы интерфейса: экранирование, всплывающие сообщения, лист снизу, обработчики действий, перетаскивание.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Отмена последнего действия: перед изменением запоминаем снимок, тост показывает «Отменить» 6 секунд. */
let undoSnap = null, undoAt = 0, undoApply = null;
export function setUndoApply(fn) { undoApply = fn; }
export function saveUndo(snapshot) { undoSnap = snapshot; undoAt = Date.now(); }
export function toast(msg) {
  const el = document.getElementById('toast');
  const canUndo = undoSnap && Date.now() - undoAt < 1500 && undoApply;
  el.innerHTML = ''; el.append(document.createTextNode(msg));
  if (canUndo) {
    const snap = undoSnap, b = document.createElement('button'); b.className = 'undo'; b.textContent = 'Отменить';
    b.onclick = () => { undoApply(snap); undoSnap = null; el.hidden = true; toast('Отменено'); };
    el.append(b);
  }
  undoSnap = canUndo ? undoSnap : null;
  el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; undoSnap = null; }, canUndo ? 6000 : 2800);
}

/** Лист снизу (модальное окно). html — содержимое; возвращает корневой элемент листа. */
export function openSheet(html, label = '') {
  const sc = document.getElementById('scrim');
  sc.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(label)}">${html}</div>`;
  sc.hidden = false;
  return sc.firstElementChild;
}
export function closeSheet() { const sc = document.getElementById('scrim'); sc.hidden = true; sc.innerHTML = ''; }
export const sheetOpen = () => !document.getElementById('scrim').hidden;

/** Действия по клику: data-act="имя" + data-* параметры. Модули регистрируют свои обработчики. */
const acts = {};
export function on(name, fn) { acts[name] = fn; }
export function dispatch(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return false;
  const fn = acts[el.dataset.act];
  if (!fn) return false;
  e.preventDefault();
  fn(el.dataset, el, e);
  return true;
}

/** Копирование в буфер с запасным вариантом (выделить текст). */
export async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); } return false; }
}

/** Скачать файл. В установленном приложении работает; если браузер запретит — вернёт false. */
export function download(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000); return true;
  } catch (e) { return false; }
}

/**
 * Перетаскивание пальцем и мышью (работает и на телефоне).
 * Элемент с data-drag="id" можно утащить на элемент с data-drop="значение".
 * Удержание 250 мс на телефоне начинает перетаскивание, чтобы не мешать прокрутке.
 */
export function enableDrag(root, onDrop) {
  // Мышь — через pointer-события; палец — через touch-события: долгое нажатие 250 мс, потом тянем.
  // (pointer-события на телефоне браузер отменяет, как только решает, что это прокрутка — поэтому палец отдельно.)
  let st = null;
  const begin = (src, x, y, delay) => { st = { src, id: src.dataset.drag, x, y, active: false, ghost: null, over: null, timer: setTimeout(() => { if (st) start(); }, delay) }; };
  root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    const src = e.target.closest('[data-drag]'); if (!src || e.button > 0) return;
    begin(src, e.clientX, e.clientY, 0);
  });
  root.addEventListener('touchstart', e => {
    const src = e.target.closest('[data-drag]'); if (!src || e.touches.length > 1) return;
    const t = e.touches[0]; begin(src, t.clientX, t.clientY, 250);
  }, { passive: true });
  function start() {
    st.active = true;
    st.ghost = document.createElement('div'); st.ghost.className = 'drag-ghost'; st.ghost.textContent = st.src.dataset.dragLabel || st.src.textContent.trim().slice(0, 60);
    document.body.appendChild(st.ghost); move(st.x, st.y);
    try { navigator.vibrate && navigator.vibrate(15); } catch (e) { }
  }
  function move(x, y) {
    st.ghost.style.left = (x + 12) + 'px'; st.ghost.style.top = (y - 20) + 'px';
    st.ghost.hidden = true; const t = document.elementFromPoint(x, y); st.ghost.hidden = false;
    const over = t && t.closest('[data-drop]');
    if (over !== st.over) { st.over && st.over.classList.remove('drop-over'); over && over.classList.add('drop-over'); st.over = over; }
  }
  const moveTo = (x, y, e) => {
    if (!st) return;
    if (!st.active) { if (Math.hypot(x - st.x, y - st.y) > 8) { clearTimeout(st.timer); st = null; } return; }
    if (e.cancelable) e.preventDefault(); move(x, y);
  };
  window.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') moveTo(e.clientX, e.clientY, e); }, { passive: false });
  window.addEventListener('touchmove', e => { const t = e.touches[0]; if (t) moveTo(t.clientX, t.clientY, e); }, { passive: false });
  const end = () => {
    if (!st) return; clearTimeout(st.timer);
    if (st.active) { st.ghost.remove(); if (st.over) { st.over.classList.remove('drop-over'); onDrop(st.id, st.over.dataset.drop); } st.src.dataset.justDragged = '1'; const s0 = st.src; setTimeout(() => delete s0.dataset.justDragged, 350); }
    st = null;
  };
  window.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') end(); });
  window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
}
