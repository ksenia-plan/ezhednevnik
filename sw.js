// Офлайн-режим: все файлы приложения сохраняются в телефоне при первом запуске.
// Сеть с ограничением 3 секунды: если сеть медленная или её нет — берётся сохранённая копия.
const CACHE = 'ezh-2.6.0';
const FILES = ["./", "./index.html", "./styles.css", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./app.js", "./assistant-evening.js", "./assistant-suggest.js", "./birthdays-model.js", "./birthdays-view.js", "./calendar-view.js", "./claude-view.js", "./core-booking.js", "./core-cond.js", "./core-dates.js", "./core-flags.js", "./core-occur.js", "./core-prodcal.js", "./core-recur.js", "./core-seed.js", "./core-store.js", "./flags-view.js", "./holidays-model.js", "./holidays-view.js", "./settings-migrate.js", "./settings-view.js", "./shop-view.js", "./tabs-english.js", "./tabs-exercise.js", "./tabs-registry.js", "./tasks-editor.js", "./tasks-model.js", "./ui.js", "./work-view.js"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || !r.url.startsWith(self.location.origin)) return;
  const key = r.mode === 'navigate' ? './index.html' : r;
  // Защита: если хостинг вместо приложения отдаёт заглушку («сайт приостановлен», лимит и т.п.) —
  // не затираем сохранённую копию и показываем её. Приложение продолжит работать из памяти телефона.
  const net = fetch(r).then(async res => {
    if (!res.ok) throw new Error('status ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (r.mode === 'navigate' && !(await res.clone().text()).includes('__appVer')) throw new Error('not app');
    if (/[.]js$/.test(new URL(r.url).pathname) && ct.includes('html')) throw new Error('html instead of js');
    const c = res.clone(); caches.open(CACHE).then(x => x.put(key, c)); return res;
  });
  e.respondWith(caches.match(key).then(c => c ? Promise.race([net.catch(() => c), new Promise(ok => setTimeout(() => ok(c), 3000))]) : net.catch(() => fetch(r))));
});
