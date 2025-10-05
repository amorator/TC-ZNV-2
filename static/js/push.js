(function(){
	'use strict';

	function urlBase64ToUint8Array(base64String) {
		const padding = '='.repeat((4 - base64String.length % 4) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	async function getVapidPublicKey() {
		const resp = await fetch('/push/vapid_public', { credentials: 'same-origin' });
		const data = await resp.json();
		if (!resp.ok || data.status !== 'success') throw new Error(data.message || 'VAPID key error');
		return data.publicKey;
	}

	async function registerSW() {
		if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
		const reg = await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;
		return reg;
	}

	async function subscribe(reg) {
		try {
			const publicKey = await getVapidPublicKey();
			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey)
			});
			await fetch('/push/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify(sub)
			});
			if (window.showToast) showToast('Уведомления включены', 'success');
		} catch (e) {
			if (window.showToast) showToast('Не удалось включить уведомления', 'error');
		}
	}

	async function init() {
		try {
			const reg = await registerSW();
			if (!reg) return;
			const existing = await reg.pushManager.getSubscription();
			if (!existing) {
				await subscribe(reg);
			}
		} catch(e) {}
	}

	// Expose controlled initializer
	window.pushInit = init;
})();



