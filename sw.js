// sw.js — cache offline dos Simuladores 3D.
// Estrategia: serve do cache imediatamente quando existe (rapido, funciona sem rede);
// em paralelo busca na rede e atualiza o cache para a proxima visita.
// Sobe CACHE_VERSAO a cada mudanca de asset para invalidar o cache antigo.

const CACHE_VERSAO = 'sim3d-v1';

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './comum/estilo.css',
  './comum/motor.js',
  './comum/hud.js',
  './comum/rng.js',
  './vendor/three.module.js',
  './vendor/addons/controls/OrbitControls.js',
  './cidade/index.html',
  './cidade/cidade.js',
  './lavanderia/index.html',
  './lavanderia/lavanderia.js',
  './foodtruck/index.html',
  './foodtruck/foodtruck.js',
  './icones/icon-192.png',
  './icones/icon-512.png',
  './icones/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE_VERSAO)
      .then((cache) => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE_VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  const url = new URL(ev.request.url);
  if (url.origin !== self.location.origin) return; // nao intercepta terceiros

  ev.respondWith(
    caches.match(ev.request).then((emCache) => {
      const buscaRede = fetch(ev.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copia = resp.clone();
            caches.open(CACHE_VERSAO).then((cache) => cache.put(ev.request, copia));
          }
          return resp;
        })
        .catch(() => emCache); // offline: cai no cache se a rede falhar
      return emCache || buscaRede;
    }),
  );
});
