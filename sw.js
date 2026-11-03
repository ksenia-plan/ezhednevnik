// Офлайн-режим: все файлы приложения сохраняются в телефоне при первом запуске.
// Сеть с ограничением 3 секунды: если сеть медленная или её нет — берётся сохранённая копия.
const CACHE = 'ezh-2.6.3';
const FILES = ["./", "./index.html", "./styles.css?v=2.6.3", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./app.js?v=2.6.3", "./assistant-evening.js?v=2.6.3", "./assistant-suggest.js?v=2.6.3", "./birthdays-model.js?v=2.6.3", "./birthdays-view.js?v=2.6.3", "./calendar-view.js?v=2.6.3", "./claude-view.js?v=2.6.3", "./core-booking.js?v=2.6.3", "./core-cond.js?v=2.6.3", "./core-dates.js?v=2.6.3", "./core-flags.js?v=2.6.3", "./core-occur.js?v=2.6.3", "./core-prodcal.js?v=2.6.3", "./core-recur.js?v=2.6.3", "./core-seed.js?v=2.6.3", "./core-store.js?v=2.6.3", "./flags-view.js?v=2.6.3", "./holidays-model.js?v=2.6.3", "./holidays-view.js?v=2.6.3", "./settings-migrate.js?v=2.6.3", "./settings-view.js?v=2.6.3", "./shop-view.js?v=2.6.3", "./tabs-english.js?v=2.6.3", "./tabs-exercise.js?v=2.6.3", "./tabs-registry.js?v=2.6.3", "./tasks-editor.js?v=2.6.3", "./tasks-model.js?v=2.6.3", "./ui.js?v=2.6.3", "./work-view.js?v=2.6.3"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || !r.url.startsWith(self.location.origin)) return;
  const key = r.mode === 'navigate' ? './index.html' : r;
  // Защита: если хостинг вместо приложения отдаёт заглушку («сайт приостановлен», лимит и т.п.) —
  // не затираем сохранённую копию и показываем её. Приложение продолжит работать из памяти телефона.
  const net = fetch(r, { cache: 'no-cache' }).then(async res => { // no-cache: GitHub держит файлы в кеше браузера 10 минут — сверяемся с сервером
    if (!res.ok) throw new Error('status ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (r.mode === 'navigate' && !(await res.clone().text()).includes('__appVer')) throw new Error('not app');
    if (/[.]js$/.test(new URL(r.url).pathname) && ct.includes('html')) throw new Error('html instead of js');
    const c = res.clone(); caches.open(CACHE).then(x => x.put(key, c)); return res;
  });
  e.respondWith(caches.match(key).then(c => c ? Promise.race([net.catch(() => c), new Promise(ok => setTimeout(() => ok(c), 3000))]) : net.catch(() => fetch(r))));
});
