const CACHE_NAME = 'mecha-pwa-v30';
const STATIC_ASSETS = [
    './',
    './index.html',
    './study-materials.html',
    './styles.css',
    './app.js',
    './firebase-messaging-sw.js',
    './study-materials.js',
    './document.png',
    './manifest.json',
    './logo.png'
];

// ========================================================================
// 1. التثبيت - تخزين الملفات الأساسية
// ========================================================================
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
        })
    );
});

// ========================================================================
// 2. التفعيل - تنظيف الإصدارات القديمة
// ========================================================================
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// ========================================================================
// 3. استراتيجية الـ Fetch الذكية
// ========================================================================
self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // استثناءات - لا نتدخل في هذه الطلبات
    if (
        e.request.method !== 'GET' ||
        url.includes('firebaseio.com') ||
        url.includes('googleapis.com') ||
        url.includes('replit') ||
        url.includes('onrender.com') ||
        url.includes('telegram.org') ||
        url.includes('/files/') ||
        url.includes('/download/') ||
        url.includes('/view/')
    ) {
        return;
    }

    // طلبات التنقل (الصفحات)
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request).catch(() => {
                return caches.match(e.request).then((cachedPage) => {
                    return cachedPage || caches.match('./study-materials.html') || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // الأصول الثابتة - استراتيجية Stale-While-Revalidate
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            const fetchPromise = fetch(e.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const clonedResponse = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, clonedResponse);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // إذا فشلت الشبكة، نرجع الـ cached response إذا كان موجوداً
                return cachedResponse;
            });

            // إذا كان لدينا نسخة مخزنة، نرجعها فوراً ونحدث في الخلفية
            if (cachedResponse) {
                return cachedResponse;
            }

            // إذا لم تكن هناك نسخة مخزنة، ننتظر الشبكة
            return fetchPromise;
        })
    );
});

// ========================================================================
// 4. استقبال رسائل من الصفحة (Keep-Alive)
// ========================================================================
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'KEEP_ALIVE_PING') {
        if (event.source) {
            event.source.postMessage({
                type: 'KEEP_ALIVE_PONG',
                timestamp: Date.now()
            });
        }
    }
});
