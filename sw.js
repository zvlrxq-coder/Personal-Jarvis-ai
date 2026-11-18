self.addEventListener('fetch', (event) => {
  // This empty fetch handler fulfills Android's PWA install requirement
  event.respondWith(fetch(event.request));
});
