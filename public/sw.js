// SanFerGo — service worker (v1.4.91, detalle 2: Web Push del chat).
// Solo muestra la notificación del mensaje que manda el servidor
// (título "SanFerGo", cuerpo "{nombre}: {texto}" o "{nombre}: Te envió
// una foto", tag por solicitud). Al tocarla abre la app (o la trae al
// frente). No hay lógica de negocio aquí: todo sale de /api/chat/send.
// LÍMITE HONESTO: en iPhone Safari el push web solo llega si el usuario
// agregó el sitio a la pantalla de inicio y dio permiso; en Safari
// normal (sin agregar) no llega nada — ver DEPLOY.md.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  const title = d.title || 'SanFerGo';
  const body = d.body || 'Tienes un mensaje nuevo.';
  const options = {
    body,
    tag: d.tag || 'sanfergo-chat',
    icon: '/icon.png',
    badge: '/icon.png',
    data: d.data || {}
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('/');
    })
  );
});
