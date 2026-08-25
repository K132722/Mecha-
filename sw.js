const CACHE_NAME = 'mecha-pwa-v28';
const STATIC_ASSETS = [
    './',
    './index.html',
    './study-materials.html',
    './styles.css',
    './app.js',
    './firebase-messaging-sw.js',
    './study-materials.js',
    './manifest.json',
    './logo.png',
    './document.png'
];

// 1. تثبيت وتخزين الملفات
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            for (const asset of STATIC_ASSETS) {
                try {
                    await cache.add(asset);
                    console.log(`✅ تم تخزين: ${asset}`);
                } catch (err) {
                    console.error(`❌ فشل تخزين: ${asset}`, err);
                }
            }
            console.log('✅ جميع الملفات الأساسية تم تخزينها');
        })
    );
});

// 2. تنظيف الإصدارات القديمة - ✅ بدون self.clients.claim()
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log(`🗑️ حذف الكاش القديم: ${key}`);
                        return caches.delete(key);
                    }
                })
            );
        })
        // ✅ تم حذف .then(() => self.clients.claim())
    );
});

// 3. استراتيجية الاسترجاع
self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    if (
        e.request.method !== 'GET' || 
        url.includes('firebaseio.com') || 
        url.includes('googleapis.com') || 
        url.includes('onrender.com') ||
        url.includes('telegram.org') ||
        url.includes('/files/') ||
        url.includes('/download/') ||
        url.includes('/view/') ||
        url.includes('/api/')
    ) {
        return;
    }

    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, clone);
                    });
                    return response;
                })
                .catch(() => {
                    return caches.match(e.request)
                        .then(cached => cached || caches.match('./study-materials.html'));
                })
        );
        return;
    }

    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(e.request).then((response) => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                if (e.request.mode === 'navigate') {
                    return caches.match('./study-materials.html');
                }
                return new Response('تعذر تحميل الملف', { status: 404 });
            });
        })
    );
});

// ================================================================
// ✅ دعم النبض (Keep-Alive) - أضف هذا في نهاية الملف
// ================================================================

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'KEEP_ALIVE_PING') {
        if (event.ports && event.ports.length > 0) {
            event.ports[0].postMessage({ 
                type: 'KEEP_ALIVE_PONG',
                timestamp: Date.now()
            });
        }
    }
});

console.log('✅ SW Keep-alive support added');
