// firebase-messaging-sw.js - نسخة محسّنة (مثل OneSignal)
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// ====== تهيئة Firebase ======
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

// ====== ✅ تقنية Keep-Alive (مثل OneSignal) ======
let keepAliveInterval = null;
let lastPing = Date.now();

function startKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
    
    keepAliveInterval = setInterval(() => {
        const now = Date.now();
        lastPing = now;
        
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({ 
                    type: 'KEEP_ALIVE_PING',
                    timestamp: now
                });
            });
        });
        
        console.log('💓 Keep-alive ping sent');
    }, 15000);
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    startKeepAlive();
    console.log('✅ Service Worker installed with keep-alive');
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    startKeepAlive();
    console.log('✅ Service Worker activated with keep-alive');
});

// ====== ✅ معالجة الإشعارات الخلفية ======
messaging.onBackgroundMessage((payload) => {
    console.log('📨 Received background message:', payload);
    
    const notificationTitle = payload.notification?.title || payload.data?.title || '📢 تحديث جديد';
    const notificationBody = payload.notification?.body || payload.data?.body || '';
    const notificationData = payload.data || {};
    
    // محاولة عرض الإشعار فوراً
    showNotification(notificationTitle, notificationBody, notificationData);
    
    // محاولة ثانية بعد 2 ثانية
    setTimeout(() => {
        showNotification(notificationTitle, notificationBody, notificationData);
    }, 2000);
});

function showNotification(title, body, data) {
    try {
        const options = {
            body: body || '📢 تحديث جديد في المواد الدراسية',
            icon: '/logo.png',
            badge: '/logo.png',
            data: data || {},
            tag: data?.path || 'notification',
            requireInteraction: true,
            vibrate: [200, 100, 200],
            actions: [
                { action: 'open', title: '📂 فتح التطبيق' },
                { action: 'dismiss', title: 'إغلاق' }
            ],
            priority: 'high',
            urgency: 'high'
        };
        
        self.registration.showNotification(title, options);
        console.log('✅ Notification shown successfully');
        
    } catch (error) {
        console.error('❌ Failed to show notification:', error);
    }
}

// ====== معالجة النقر على الإشعار ======
self.addEventListener('notificationclick', function(event) {
    console.log('🔔 Notification clicked:', event);
    
    event.notification.close();
    
    const data = event.notification.data || {};
    const path = data.path || '';
    const postIndex = data.postIndex;
    
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

console.log('✅ FCM Service Worker initialized (Enhanced)');
