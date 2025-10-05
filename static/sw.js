self.addEventListener('install', function(event) {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch (e) {
		try { data = { title: 'ZNV', body: event.data.text() }; } catch(_) {}
	}
	const title = data.title || 'ZNV';
	const options = {
		body: data.body || '',
		icon: data.icon || '/static/images/notification-icon.png',
		badge: data.badge || '/static/images/notification-icon.png',
		data: { id: data.id || Date.now(), url: data.url || '/' }
	};
	event.waitUntil((async function(){
		await self.registration.showNotification(title, options);
		try {
			await fetch('/push/delivered', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: options.data.id, title: title, body: options.body || '' })
			});
		} catch(_) {}
	})());
});

self.addEventListener('notificationclick', function(event) {
	event.notification.close();
	const url = (event.notification && event.notification.data && event.notification.data.url) || '/';
	event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
		for (const client of clientList) {
			if ('focus' in client) return client.focus();
		}
		if (clients.openWindow) return clients.openWindow(url);
	}));
});



