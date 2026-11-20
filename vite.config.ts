import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __LAB__: mode === 'development' || mode === 'lab' },
  plugins: mode === 'lab' ? [] : [{
    name: 'offline-shell',
    async writeBundle({ dir = 'dist' }) {
      const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name !== 'sw.js')
        .map(entry => join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll('\\', '/'))
        .sort()
      const html = await readFile(join(dir, 'index.html'), 'utf8')
      const hash = createHash('sha256').update('offline-shell-v3')
      for (const file of files) hash.update(await readFile(join(dir, file)))
      const version = 'treasure-' + hash.digest('hex').slice(0, 16)
      await writeFile(join(dir, 'sw.js'), `
const cache = ${JSON.stringify(version)};
const base = self.registration.scope;
const index = new URL('index.html', base).href;
const html = ${JSON.stringify(html)};
const files = ${JSON.stringify(files.filter(file => file !== 'index.html'))}
  .map(file => new Request(new URL(file, base), { cache: 'reload' }));
self.addEventListener('install', event => event.waitUntil((async () => {
  const store = await caches.open(cache);
  await store.addAll(files);
  await store.put(index, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('treasure-') && key !== cache).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(base)) return;
  const request = new URL(event.request.url);
  if (request.pathname.startsWith(new URL('lab/', base).pathname)) return;
  const url = event.request.mode === 'navigate' ? index : request.href;
  event.respondWith(caches.open(cache).then(store => store.match(url)).then(response => response || fetch(event.request)));
});
`)
    },
  }],
}))
