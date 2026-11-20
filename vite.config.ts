import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __LAB__: mode === 'development' || mode === 'lab' },
  plugins: [{
    name: 'offline-shell',
    async writeBundle({ dir = 'dist' }) {
      const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name !== 'sw.js')
        .map(entry => join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll('\\', '/'))
        .sort()
      const hash = createHash('sha256')
      for (const file of files) hash.update(await readFile(join(dir, file)))
      const version = 'treasure-' + hash.digest('hex').slice(0, 16)
      await writeFile(join(dir, 'sw.js'), `
const cache = ${JSON.stringify(version)};
const base = self.registration.scope;
const files = ${JSON.stringify(files)}.map(file => new URL(file, base).href);
self.addEventListener('install', event => event.waitUntil(caches.open(cache).then(store => store.addAll(files))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('treasure-') && key !== cache).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(base)) return;
  const url = event.request.mode === 'navigate' ? new URL('index.html', base).href : event.request.url;
  event.respondWith(caches.open(cache).then(store => store.match(url)).then(response => response || fetch(event.request)));
});
`)
    },
  }],
}))
