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

// ====== معالجة الإشعارات الخلفية ======
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);
    
    const notificationTitle = payload.notification?.title || payload.data?.title || '📢 تحديث جديد';
    const notificationBody = payload.notification?.body || payload.data?.body || '';
    const notificationData = payload.data || {};
    
    const notificationOptions = {
        body: notificationBody,
        icon: '/logo.png',
        badge: '/logo.png',
        data: {
            path: notificationData.path || '',
            postIndex: notificationData.postIndex || '',
            type: notificationData.type || 'notification',
            click_action: '/study-materials.html'
        },
        tag: notificationData.path || 'notification',
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open', title: '📂 عرض' },
            { action: 'dismiss', title: 'إغلاق' }
        ]
    };
    
    // عرض الإشعار
    self.registration.showNotification(notificationTitle, notificationOptions);
});

// ====== معالجة النقر على الإشعار ======
self.addEventListener('notificationclick', function(event) {
    console.log('[firebase-messaging-sw.js] Notification click received:', event);
    
    event.notification.close();
    
    const data = event.notification.data || {};
    const path = data.path || '';
    const postIndex = data.postIndex;
    
    // بناء رابط الوجهة
    let urlToOpen = '/study-materials.html';
    const params = new URLSearchParams();
    
    if (path) {
        params.set('path', path);
        params.set('openNotifications', 'true');
        if (postIndex !== undefined && postIndex !== '') {
            params.set('highlight', postIndex);
        }
    }
    
    if (params.toString()) {
        urlToOpen += '?' + params.toString();
    }
    
    // فتح النافذة
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('/study-materials.html') && 'focus' in client) {
                    return client.focus().then(() => {
                        client.navigate(urlToOpen);
                    });
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// ====== استقبال رسائل من الإشعارات ======
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'REQUEST_NOTIFICATION') {
        // الرد على الطلب
        event.ports[0].postMessage({ 
            status: 'ready',
            swVersion: '1.0.0'
        });
    }
});

console.log('[firebase-messaging-sw.js] Service Worker initialized successfully!');