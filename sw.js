const CACHE_NAME = 'mecha-pwa-v27'; // تحسين كاش الأوفلاين ودعم الملفات ذات query string
const STATIC_ASSETS = [
    './',
    './index.html',
    './study-materials.html',
    './styles.css',
    './app.js',
    './study-materials.js',
    './firebase-messaging-sw.js',
    './manifest.json',
    './document.png',
    './logo.png'
];

// 1. تثبيت وتخزين الملفات الأساسية محلياً
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // تخزين كل ملف على حدة بدلاً من addAll
            for (const asset of STATIC_ASSETS) {
                try {
                    await cache.add(asset);
                    console.log(`✅ تم تخزين: ${asset}`);
                } catch (err) {
                    console.error(`❌ فشل تخزين: ${asset}`, err);
                }
            }
            // تأكيد تخزين study-materials.js
            try {
                await cache.add('./study-materials.js');
                console.log('✅ تم تأكيد تخزين study-materials.js');
            } catch (err) {
                console.error('❌ فشل تخزين study-materials.js:', err);
            }
        })
    );
});

// 2. تنظيف الإصدارات القديمة من الكاش
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

// 3. إدارة استرجاع الملفات (Fetch Strategy)
self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // أ) الاستثناءات
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

    // ب) طلبات الانتقال بين الصفحات (HTML Navigation)
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request).catch(() => {
                return caches.match(e.request).then((cachedPage) => {
                    return cachedPage ||
                        caches.match(e.request, { ignoreSearch: true }) ||
                        caches.match('./study-materials.html', { ignoreSearch: true }) ||
                        caches.match('./index.html', { ignoreSearch: true });
                });
            })
        );
        return;
    }

    // ج) الأصول الثابتة - Cache First مع fallback للـ network
    e.respondWith(
        caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            // إذا لم يكن في الكاش، حاول التحميل من الشبكة واحفظه للاستخدام القادم
            return fetch(e.request).then((response) => {
                // خزن النسخة الجديدة في الكاش
                if (response && response.status === 200) {
                    const clonedResponse = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, clonedResponse);
                    });
                }
                return response;
            });
        })
    );
});
