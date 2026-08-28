// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// تهيئة Firebase
firebase.initializeApp({
    apiKey: "AIzaSyCGUTMbiVWspimLsTk9JQ9eExm-XuhkXKY",
    authDomain: "pwa-app-a8e58.firebaseapp.com",
    databaseURL: "https://pwa-app-a8e58-default-rtdb.firebaseio.com",
    projectId: "pwa-app-a8e58",
    storageBucket: "pwa-app-a8e58.firebasestorage.app",
    messagingSenderId: "76116553973",
    appId: "1:76116553973:web:f0b3deed1ab37bb82d15bc"
});

const messaging = firebase.messaging();

// معالجة الإشعارات الخلفية
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);
    
    const notification = payload.notification || {};
    const data = payload.data || {};
    
    const notificationTitle = notification.title || data.title || '📢 تحديث جديد';
    const notificationOptions = {
        body: notification.body || data.body || '',
        icon: '/logo.png',
        badge: '/logo.png',
        data: {
            path: data.path || '',
            type: data.type || 'notification',
            postIndex: data.postIndex,
            folderName: data.folderName || '',
            click_action: data.click_action || ''
        },
        tag: data.id || 'notification',
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions: [
            {
                action: 'open',
                title: '📂 فتح',
                icon: '/logo.png'
            },
            {
                action: 'dismiss',
                title: '✕ إغلاق',
                icon: '/logo.png'
            }
        ]
    };
    
    self.registration.showNotification(notificationTitle, notificationOptions);
});

// معالجة النقر على الإشعار
self.addEventListener('notificationclick', function(event) {
    console.log('[firebase-messaging-sw.js] Notification click received.');
    
    const notification = event.notification;
    notification.close();
    
    const data = notification.data || {};
    const path = data.path || '';
    const postIndex = data.postIndex;
    const type = data.type || '';
    
    // معالجة إجراءات الإشعار
    if (event.action === 'dismiss') {
        return;
    }
    
    const urlToOpen = new URL('/', self.location.origin);
    if (path) {
        urlToOpen.searchParams.set('path', path);
        urlToOpen.searchParams.set('openNotifications', 'true');
        if (postIndex !== undefined && postIndex !== null) {
            urlToOpen.searchParams.set('highlight', postIndex);
        }
    }
    
    // فتح النافذة أو التركيز عليها
    const promiseChain = clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    }).then((windowClients) => {
        for (const client of windowClients) {
            if (client.url === urlToOpen.toString() && 'focus' in client) {
                return client.focus();
            }
        }
        if (clients.openWindow) {
            return clients.openWindow(urlToOpen.toString());
        }
    });
    
    event.waitUntil(promiseChain);
});
