// ========================================================================
// 📚 STUDY MATERIALS - النسخة المتطورة
// نظام إدارة المواد الدراسية مع تخزين محلي ذكي وإشعارات متقدمة
// ========================================================================

// ========================================================================
// 1. تهيئة Firebase
// ========================================================================
const STUDY_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCGUTMbiVWspimLsTk9JQ9eExm-XuhkXKY",
    authDomain: "pwa-app-a8e58.firebaseapp.com",
    databaseURL: "https://pwa-app-a8e58-default-rtdb.firebaseio.com",
    projectId: "pwa-app-a8e58",
    storageBucket: "pwa-app-a8e58.firebasestorage.app",
    messagingSenderId: "76116553973",
    appId: "1:76116553973:web:f0b3deed1ab37bb82d15bc"
};

let studyDb = null;
let isOnline = navigator.onLine;
let currentStudyPath = [];
let globalPostsData = { posts: [], folders: [] };
let editingPostIndex = null;
let editingFolderName = null;
let editingFolderPath = '';
let searchTimeout = null;
let notificationsData = [];
let isNotificationsPanelOpen = false;
let fcmMessaging = null;
let fcmToken = null;
let fcmInitialized = false;
let idbInstance = null;

// ========================================================================
// 2. إعدادات السيرفر
// ========================================================================
const TELEGRAM_SERVER_URL = "https://drive-shared-backend2.onrender.com";
const VAPID_KEY = 'BLiXP9SU05ttQ0-BLyJXQZ3DHwTwgc3t0U4Ld7yE4ZA2USu3LWdJWDXCRKYQwJPaz6yvOZKSrwYO6pSJKvK4mFs';

// ========================================================================
// 3. نظام التخزين المحلي الذكي (IndexedDB + localStorage)
// ========================================================================

// -------- 3.1 فتح IndexedDB --------
function openIDB() {
    return new Promise((resolve, reject) => {
        if (idbInstance) {
            resolve(idbInstance);
            return;
        }
        const req = indexedDB.open('StudyMaterialsDB', 4);
        req.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains('media')) {
                idb.createObjectStore('media', { keyPath: 'key' });
            }
            if (!idb.objectStoreNames.contains('cache')) {
                idb.createObjectStore('cache', { keyPath: 'key' });
            }
            if (idb.objectStoreNames.contains('media_old')) {
                idb.deleteObjectStore('media_old');
            }
        };
        req.onsuccess = () => {
            idbInstance = req.result;
            resolve(idbInstance);
        };
        req.onerror = () => reject(req.error);
    });
}

// -------- 3.2 حفظ ملف في IndexedDB --------
async function saveMediaToIDB(key, blob, mimeType, fileName) {
    try {
        const idb = await openIDB();
        const tx = idb.transaction('media', 'readwrite');
        return new Promise((resolve, reject) => {
            const store = tx.objectStore('media');
            const data = {
                key: key,
                blob: blob,
                mimeType: mimeType || blob.type || 'application/octet-stream',
                fileName: fileName || 'file',
                size: blob.size,
                savedAt: Date.now()
            };
            const req = store.put(data);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error('Error saving to IDB:', err);
        return false;
    }
}

// -------- 3.3 استرجاع ملف من IndexedDB --------
async function getMediaFromIDB(key) {
    try {
        const idb = await openIDB();
        const tx = idb.transaction('media', 'readonly');
        return new Promise((resolve) => {
            const req = tx.objectStore('media').get(key);
            req.onsuccess = () => {
                const result = req.result;
                if (result && result.blob) {
                    resolve({
                        blob: result.blob,
                        mimeType: result.mimeType || result.blob.type || 'application/octet-stream',
                        fileName: result.fileName || 'file',
                        size: result.size
                    });
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        });
    } catch (err) {
        console.error('Error getting from IDB:', err);
        return null;
    }
}

// -------- 3.4 حذف ملف من IndexedDB --------
async function deleteMediaFromIDB(key) {
    try {
        const idb = await openIDB();
        const tx = idb.transaction('media', 'readwrite');
        return new Promise((resolve, reject) => {
            const req = tx.objectStore('media').delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error('Error deleting from IDB:', err);
        return false;
    }
}

// -------- 3.5 التحقق من وجود ملف محلياً --------
async function checkIsSaved(key) {
    const data = await getMediaFromIDB(key);
    return data !== null;
}

// -------- 3.6 حفظ بيانات JSON في IndexedDB (للكاش) --------
async function saveCacheToIDB(key, data) {
    try {
        const idb = await openIDB();
        const tx = idb.transaction('cache', 'readwrite');
        return new Promise((resolve, reject) => {
            const store = tx.objectStore('cache');
            const entry = {
                key: key,
                data: data,
                savedAt: Date.now()
            };
            const req = store.put(entry);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error('Error saving cache to IDB:', err);
        return false;
    }
}

// -------- 3.7 استرجاع كاش من IndexedDB --------
async function getCacheFromIDB(key) {
    try {
        const idb = await openIDB();
        const tx = idb.transaction('cache', 'readonly');
        return new Promise((resolve) => {
            const req = tx.objectStore('cache').get(key);
            req.onsuccess = () => {
                const result = req.result;
                if (result && result.data) {
                    resolve(result.data);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        });
    } catch (err) {
        console.error('Error getting cache from IDB:', err);
        return null;
    }
}

// -------- 3.8 حذف كاش من IndexedDB --------
async function deleteCacheFromIDB(key) {
    try {
        const idb = await openIDB();
        const tx = idb.transaction('cache', 'readwrite');
        return new Promise((resolve, reject) => {
            const req = tx.objectStore('cache').delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error('Error deleting cache from IDB:', err);
        return false;
    }
}

// -------- 3.9 تنظيف التخزين المؤقت بالكامل --------
async function clearAppOfflineCache() {
    if (!confirm("⚠️ هل أنت متأكد من تنظيف التخزين المؤقت؟\nسيتم حذف جميع الملفات المحفوظة محلياً، ويمكنك إعادة تنزيلها لاحقاً.")) {
        return;
    }

    try {
        // حذف كاش المتصفح
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        // حذف IndexedDB
        if (idbInstance) {
            idbInstance.close();
            idbInstance = null;
        }

        if (window.indexedDB) {
            const req = indexedDB.deleteDatabase("StudyMaterialsDB");
            req.onsuccess = async () => {
                console.log("✅ تم حذف قاعدة البيانات المحلية");
                // حذف localStorage المؤقت
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('study_cache_') || key.startsWith('study_notifications'))) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
                
                // إعادة تحميل الصفحة
                alert("✅ تم تنظيف التخزين المؤقت بنجاح! سيتم إعادة تحميل الصفحة.");
                window.location.reload();
            };
            req.onerror = () => {
                alert("❌ تعذر حذف الذاكرة، حاول إعادة تشغيل التطبيق.");
            };
        }

    } catch (error) {
        console.error("خطأ أثناء تنظيف الذاكرة:", error);
        alert("❌ حدث خطأ أثناء تنظيف التخزين المؤقت.");
    }
}

// -------- 3.10 حساب حجم التخزين المستخدم --------
async function getIndexedDBSize() {
    return new Promise((resolve) => {
        if (!window.indexedDB) {
            resolve(0);
            return;
        }

        let totalSize = 0;
        const databases = ['StudyMaterialsDB'];
        let completed = 0;
        
        databases.forEach(dbName => {
            try {
                const request = indexedDB.open(dbName);
                let db = null;
                
                request.onsuccess = function(event) {
                    db = event.target.result;
                    const storeNames = db.objectStoreNames;
                    let storeCompleted = 0;
                    
                    if (storeNames.length === 0) {
                        db.close();
                        completed++;
                        if (completed === databases.length) {
                            resolve(totalSize);
                        }
                        return;
                    }
                    
                    for (let i = 0; i < storeNames.length; i++) {
                        const storeName = storeNames[i];
                        try {
                            const transaction = db.transaction(storeName, 'readonly');
                            const store = transaction.objectStore(storeName);
                            const countRequest = store.count();
                            
                            countRequest.onsuccess = function() {
                                const count = countRequest.result;
                                if (count === 0) {
                                    storeCompleted++;
                                    if (storeCompleted === storeNames.length) {
                                        db.close();
                                        completed++;
                                        if (completed === databases.length) {
                                            resolve(totalSize);
                                        }
                                    }
                                    return;
                                }
                                
                                const getAllRequest = store.getAll();
                                getAllRequest.onsuccess = function() {
                                    const items = getAllRequest.result;
                                    let storeSize = 0;
                                    
                                    items.forEach(item => {
                                        if (item.blob) {
                                            storeSize += item.blob.size || 0;
                                        }
                                        const jsonStr = JSON.stringify(item);
                                        storeSize += new Blob([jsonStr]).size;
                                    });
                                    
                                    totalSize += storeSize;
                                    storeCompleted++;
                                    
                                    if (storeCompleted === storeNames.length) {
                                        db.close();
                                        completed++;
                                        if (completed === databases.length) {
                                            resolve(totalSize);
                                        }
                                    }
                                };
                                
                                getAllRequest.onerror = function() {
                                    storeCompleted++;
                                    if (storeCompleted === storeNames.length) {
                                        db.close();
                                        completed++;
                                        if (completed === databases.length) {
                                            resolve(totalSize);
                                        }
                                    }
                                };
                            };
                        } catch (e) {
                            storeCompleted++;
                            if (storeCompleted === storeNames.length) {
                                db.close();
                                completed++;
                                if (completed === databases.length) {
                                    resolve(totalSize);
                                }
                            }
                        }
                    }
                };
                
                request.onerror = function() {
                    completed++;
                    if (completed === databases.length) {
                        resolve(totalSize);
                    }
                };
            } catch (e) {
                completed++;
                if (completed === databases.length) {
                    resolve(totalSize);
                }
            }
        });
        
        setTimeout(() => {
            resolve(totalSize);
        }, 5000);
    });
}

// ========================================================================
// 4. نظام التخزين المؤقت للمجلدات (ذاكرة مؤقتة ذكية)
// ========================================================================

// -------- 4.1 حفظ بيانات مجلد في التخزين المؤقت --------
async function cacheFolderData(pathKey, data) {
    try {
        // حفظ في localStorage كنسخة احتياطية سريعة
        localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(data));
        // حفظ في IndexedDB للاستدامة
        await saveCacheToIDB(`folder_${pathKey}`, data);
        return true;
    } catch (err) {
        console.warn('Failed to cache folder data:', err);
        return false;
    }
}

// -------- 4.2 استرجاع بيانات مجلد من التخزين المؤقت --------
async function getCachedFolderData(pathKey) {
    try {
        // محاولة من IndexedDB أولاً
        const idbData = await getCacheFromIDB(`folder_${pathKey}`);
        if (idbData) {
            // تحديث localStorage للنسخة الاحتياطية
            localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(idbData));
            return idbData;
        }
        
        // محاولة من localStorage
        const localData = localStorage.getItem(`study_cache_${pathKey}`);
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                // حفظ في IndexedDB للمستقبل
                await saveCacheToIDB(`folder_${pathKey}`, parsed);
                return parsed;
            } catch (e) {
                return null;
            }
        }
        
        return null;
    } catch (err) {
        console.warn('Failed to get cached folder data:', err);
        return null;
    }
}

// -------- 4.3 حذف بيانات مجلد من التخزين المؤقت --------
async function clearCachedFolderData(pathKey) {
    try {
        localStorage.removeItem(`study_cache_${pathKey}`);
        await deleteCacheFromIDB(`folder_${pathKey}`);
        return true;
    } catch (err) {
        console.warn('Failed to clear cached folder data:', err);
        return false;
    }
}

// ========================================================================
// 5. تهيئة Firebase
// ========================================================================
function initFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.warn('⚠️ Firebase SDK غير متاح');
            return false;
        }
        if (!firebase.apps || !firebase.apps.length) {
            firebase.initializeApp(STUDY_FIREBASE_CONFIG);
        }
        studyDb = firebase.database();
        return true;
    } catch (err) {
        console.warn('⚠️ Firebase initialization failed:', err);
        return false;
    }
}

// ========================================================================
// 6. المستخدم والصلاحيات
// ========================================================================
function getStudyUser() {
    try {
        const session = localStorage.getItem('mecha_user_session');
        if (session) {
            return JSON.parse(session);
        }
        return null;
    } catch (e) {
        return null;
    }
}

function isStudyAdmin() {
    const user = getStudyUser();
    return user && (user.role === 'admin' || user.phone === '774132722');
}

function canUserAddContent() {
    const user = getStudyUser();
    return !!user;
}

// ========================================================================
// 7. رفع الملفات إلى سيرفر تلجرام
// ========================================================================
async function uploadToTelegramServer(fileObject, title = '', onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', fileObject);
        if (title) formData.append('title', title);

        const xhr = new XMLHttpRequest();
        const uploadEndpoint = `${TELEGRAM_SERVER_URL}/api/upload-to-telegram`;

        xhr.open('POST', uploadEndpoint, true);
        xhr.withCredentials = false;
        xhr.setRequestHeader('Accept', 'application/json');

        xhr.upload.onprogress = function(event) {
            if (event.lengthComputable && onProgress) {
                const percentComplete = Math.round((event.loaded / event.total) * 100);
                onProgress(percentComplete);
            }
        };

        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const permanentLink = data.permanentLink || `${TELEGRAM_SERVER_URL}/files/${data.filename}`;
                    resolve({
                        url: permanentLink,
                        fileId: data.fileId || data.filename,
                        permanentLink: permanentLink,
                        telegramFileId: data.telegramFileId || '',
                        telegramFileUniqueId: data.telegramFileUniqueId || '',
                        filename: data.filename || fileObject.name
                    });
                } catch (e) {
                    reject(new Error('خطأ في تحليل استجابة السيرفر'));
                }
            } else {
                reject(new Error(`خطأ سيرفر: ${xhr.status} ${xhr.statusText}`));
            }
        };

        xhr.onerror = function() {
            reject(new Error('فشل الاتصال بالسيرفر. تأكد من اتصال الإنترنت.'));
        };

        xhr.ontimeout = function() {
            reject(new Error('انتهى وقت الاتصال بالسيرفر'));
        };

        xhr.timeout = 120000;
        xhr.send(formData);
    });
}

async function deleteFromTelegramServer(fileId) {
    if (!fileId) return false;
    try {
        const deleteEndpoint = `${TELEGRAM_SERVER_URL}/api/files/${encodeURIComponent(fileId)}`;
        const response = await fetch(deleteEndpoint, {
            method: 'DELETE',
            headers: { 'Accept': 'application/json' }
        });
        return response.ok;
    } catch (error) {
        console.warn('Failed to delete from server:', error);
        return false;
    }
}

async function uploadFileToStorage(file, title = '', onProgress) {
    try {
        const result = await uploadToTelegramServer(file, title, onProgress);
        return {
            url: result.permanentLink,
            path: result.fileId,
            fileId: result.fileId,
            permanentLink: result.permanentLink,
            telegramFileId: result.telegramFileId,
            telegramFileUniqueId: result.telegramFileUniqueId,
            filename: result.filename
        };
    } catch (err) {
        console.error('Upload error:', err);
        throw err;
    }
}

async function deleteFileFromStorage(fileId) {
    return await deleteFromTelegramServer(fileId);
}

// ========================================================================
// 8. التنقل والمجلدات
// ========================================================================
function getPathKey(pathArray) {
    return 'root' + (pathArray.length > 0 ? '/' + pathArray.join('/') : '');
}

function getPathDisplay(pathArray) {
    if (pathArray.length === 0) return 'المواد الدراسية';
    return pathArray.join(' › ');
}

function isLeafFolder(pathArray) {
    const pathKey = getPathKey(pathArray);
    const localKey = `study_cache_${pathKey}`;
    try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
            const data = JSON.parse(cached);
            return !data.folders || data.folders.length === 0;
        }
    } catch (e) {}
    return false;
}

function navigateTo(path) {
    if (path === 'root') {
        currentStudyPath = [];
    } else {
        const parts = path.split('/').filter(p => p !== 'root' && p !== '');
        currentStudyPath = parts;
    }
    updateBreadcrumb();
    updateButtons();
    loadCurrentFolder();
    // إغلاق نتائج البحث
    clearSearch();
}

function goBack() {
    if (currentStudyPath.length > 0) {
        currentStudyPath.pop();
        updateBreadcrumb();
        updateButtons();
        loadCurrentFolder();
    }
}

function goHome() {
    window.location.href = 'index.html';
}

// ========================================================================
// 9. تحديث واجهة المستخدم
// ========================================================================

// -------- 9.1 تحديث شريط التنقل --------
function updateBreadcrumb() {
    const bar = document.getElementById('breadcrumbBar');
    if (!bar) return;
    bar.innerHTML = '';

    const rootSpan = document.createElement('span');
    rootSpan.className = 'crumb';
    rootSpan.textContent = '🏠 المواد الدراسية';
    rootSpan.dataset.path = 'root';
    rootSpan.onclick = () => navigateTo('root');
    bar.appendChild(rootSpan);

    let currentPath = '';
    for (let i = 0; i < currentStudyPath.length; i++) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = ' › ';
        bar.appendChild(sep);

        const crumb = document.createElement('span');
        crumb.className = 'crumb' + (i === currentStudyPath.length - 1 ? ' current' : '');
        crumb.textContent = currentStudyPath[i];
        crumb.dataset.path = currentPath + '/' + currentStudyPath[i];
        if (i < currentStudyPath.length - 1) {
            crumb.onclick = () => navigateTo(crumb.dataset.path);
        }
        bar.appendChild(crumb);

        currentPath += '/' + currentStudyPath[i];
    }

    const title = document.getElementById('currentFolderTitle');
    if (title) {
        if (currentStudyPath.length === 0) {
            title.textContent = 'المواد الدراسية';
        } else {
            title.textContent = currentStudyPath[currentStudyPath.length - 1];
        }
    }
}

// -------- 9.2 تحديث الأزرار --------
function updateButtons() {
    const isAdmin = isStudyAdmin();
    const isRoot = currentStudyPath.length === 0;
    const isLeaf = isLeafFolder(currentStudyPath);
    const canAdd = canUserAddContent();

    const btnBack = document.getElementById('btnBack');
    const btnAddFolder = document.getElementById('btnAddFolder');
    const btnAddPost = document.getElementById('btnAddPost');

    if (btnBack) btnBack.style.display = currentStudyPath.length > 0 ? 'inline-flex' : 'none';
    if (btnAddFolder) btnAddFolder.style.display = isAdmin ? 'inline-flex' : 'none';
    if (btnAddPost) btnAddPost.style.display = (!isRoot && isLeaf && canAdd) ? 'inline-flex' : 'none';
}

// -------- 9.3 تحديث شريط الحالة --------
function updateStatusBar() {
    const dot = document.getElementById('connectionDot');
    const text = document.getElementById('connectionText');
    const userDisplay = document.getElementById('userDisplay');
    
    if (isOnline) {
        if (dot) { dot.className = 'status-dot online'; }
        if (text) text.textContent = 'متصل';
    } else {
        if (dot) { dot.className = 'status-dot offline'; }
        if (text) text.textContent = 'غير متصل (أوفلاين)';
    }
    
    const user = getStudyUser();
    if (userDisplay) {
        userDisplay.textContent = user ? `👤 ${user.name || 'مستخدم'}` : '👤 زائر';
    }
}

// -------- 9.4 تحديث عداد العناصر --------
function updateItemCount(data) {
    const countEl = document.getElementById('itemCount');
    if (!countEl) return;
    const total = (data.folders?.length || 0) + (data.posts?.length || 0);
    countEl.textContent = total;
}

// -------- 9.5 تحديث مؤشر التخزين --------
async function updateStorageIndicator() {
    try {
        const size = await getIndexedDBSize();
        const quota = 5 * 1024 * 1024 * 1024; // 5 GB
        const percent = Math.min(100, (size / quota) * 100);
        
        const fill = document.getElementById('storageFill');
        const percentEl = document.getElementById('storagePercent');
        
        if (fill) fill.style.width = `${percent}%`;
        if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    } catch (e) {
        console.warn('Failed to update storage indicator:', e);
    }
}

// ========================================================================
// 10. تحميل وعرض المحتوى
// ========================================================================

// -------- 10.1 تحميل المجلد الحالي --------
async function loadCurrentFolder() {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="empty-state-advanced"><span class="empty-icon">⏳</span><h3>جاري التحميل...</h3></div>';

    const pathKey = getPathKey(currentStudyPath);
    let data = null;

    // محاولة من التخزين المؤقت أولاً
    const cached = await getCachedFolderData(pathKey);
    if (cached) {
        data = cached;
        globalPostsData = data;
        renderFolderContent(data);
        updateItemCount(data);
        // إذا كان هناك اتصال، قم بتحديث البيانات في الخلفية
        if (isOnline) {
            refreshFolderInBackground(pathKey);
        }
        return;
    }

    // إذا لم يكن هناك كاش، حاول من السيرفر
    if (isOnline && studyDb) {
        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = '30%';

        try {
            const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
            data = snapshot.val() || { folders: [], posts: [] };
            
            if (progressBar) progressBar.style.width = '70%';
            
            // حفظ في التخزين المؤقت
            await cacheFolderData(pathKey, data);
            globalPostsData = data;
            
            if (progressBar) progressBar.style.width = '100%';
            setTimeout(() => {
                if (progressContainer) progressContainer.style.display = 'none';
                if (progressBar) progressBar.style.width = '0%';
            }, 500);
            
            renderFolderContent(data);
            updateItemCount(data);
            return;
        } catch (err) {
            console.error('Error loading folder from server:', err);
        }
    }

    // إذا فشل كل شيء
    grid.innerHTML = `
        <div class="empty-state-advanced">
            <span class="empty-icon">📡</span>
            <h3>${isOnline ? 'حدث خطأ في التحميل' : 'أنت غير متصل بالإنترنت'}</h3>
            <p>${isOnline ? 'يرجى المحاولة مرة أخرى' : 'تم حفظ بعض البيانات محلياً، يرجى الاتصال بالإنترنت للمزامنة'}</p>
            ${!isOnline ? '<button class="btn-action btn-primary" style="margin-top:12px;" onclick="loadCurrentFolder()">🔄 المحاولة مجدداً</button>' : ''}
        </div>`;
}

// -------- 10.2 تحديث المجلد في الخلفية --------
async function refreshFolderInBackground(pathKey) {
    try {
        if (!studyDb) return;
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };
        await cacheFolderData(pathKey, data);
        // تحديث العرض إذا كنا في نفس المجلد
        if (getPathKey(currentStudyPath) === pathKey) {
            globalPostsData = data;
            renderFolderContent(data);
            updateItemCount(data);
        }
    } catch (err) {
        console.warn('Background refresh failed:', err);
    }
}

// -------- 10.3 عرض المحتوى --------
function renderFolderContent(data) {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    const folders = data.folders || [];
    const posts = data.posts || [];
    const isAdmin = isStudyAdmin();
    const isRoot = currentStudyPath.length === 0;
    const isLeaf = folders.length === 0;
    const pathKey = getPathKey(currentStudyPath);
    const canAdd = canUserAddContent();

    // تحديث أزرار الإضافة
    const btnAddPost = document.getElementById('btnAddPost');
    if (btnAddPost) btnAddPost.style.display = (!isRoot && isLeaf && canAdd) ? 'inline-flex' : 'none';

    if (folders.length === 0 && posts.length === 0) {
        grid.innerHTML = `
            <div class="empty-state-advanced">
                <span class="empty-icon">📭</span>
                <h3>هذا المجلد فارغ</h3>
                <p>${isAdmin ? 'يمكنك إضافة مجلدات أو منشورات جديدة' : 'لا يوجد محتوى في هذا المجلد حالياً'}</p>
            </div>`;
        return;
    }

    let htmlContent = '';

    // -------- عرض المجلدات --------
    folders.forEach(folder => {
        let folderName = typeof folder === 'object' ? folder.name : folder;
        let folderDescription = typeof folder === 'object' ? folder.description : '';
        const folderPathKey = getPathKey([...currentStudyPath, folderName]);
        
        // التحقق من وجود مجلدات فرعية
        let hasSubFolders = false;
        try {
            const cached = localStorage.getItem(`study_cache_${folderPathKey}`);
            if (cached) {
                const subData = JSON.parse(cached);
                hasSubFolders = subData.folders && subData.folders.length > 0;
            }
        } catch (e) {}

        const folderAdminActions = isAdmin ? `
            <div class="folder-actions-overlay">
                <button onclick="event.stopPropagation(); openEditFolderModal('${escapeHtml(folderName)}')" title="تعديل">✏️</button>
                <button class="btn-delete-folder" onclick="event.stopPropagation(); confirmDeleteFolder('${escapeHtml(folderName)}')" title="حذف">🗑️</button>
            </div>
        ` : '';

        htmlContent += `
            <div class="folder-card-advanced" onclick="navigateTo('${folderPathKey}')">
                ${folderAdminActions}
                <span class="folder-icon-large">${hasSubFolders ? '📂' : '📁'}</span>
                <div class="folder-name">${escapeHtml(folderName)}</div>
                ${folderDescription ? `<div class="folder-desc">${escapeHtml(folderDescription)}</div>` : ''}
                <div class="folder-meta">${hasSubFolders ? '📂 يحتوي على مجلدات' : '📁 مجلد'}</div>
            </div>
        `;
    });

    // -------- عرض المنشورات --------
    const reversedPosts = [...posts].reverse();
    for (let i = 0; i < reversedPosts.length; i++) {
        const post = reversedPosts[i];
        const originalIndex = posts.length - 1 - i;
        const hasFile = post.hasFile || post.fileData || post.fileUrl;
        
        const postId = post.id || `post_${originalIndex}`;
        const mediaKey = `${pathKey}_${postId}`;

        const rawFileName = post.fileName || post.title || 'مستند مرفق';
        const fileExt = rawFileName.includes('.') ? rawFileName.split('.').pop() : '';
        const fileSizeStr = post.fileSize ? formatFileSize(post.fileSize) : '';

        const timeFormatted = post.timestamp ? new Date(post.timestamp).toLocaleString('ar-YE', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '';

        const postAdminActions = isAdmin ? `
            <div class="post-admin-actions">
                <button onclick="event.stopPropagation(); openEditPostModal(${originalIndex})" title="تعديل">✏️</button>
                <button class="btn-delete-post" onclick="event.stopPropagation(); confirmDeletePost(${originalIndex})" title="حذف">🗑️</button>
            </div>
        ` : '';

        htmlContent += `
            <div class="post-card-advanced" id="postCard-${mediaKey}">
                ${postAdminActions}
                <span class="post-icon">📄</span>
                <div class="post-title">${escapeHtml(post.title || 'بدون عنوان')}</div>
                ${(post.text || post.description) ? `
                    <div class="post-text">${escapeHtml(post.text || post.description)}</div>
                ` : ''}
                ${hasFile ? `
                    <div class="post-file-info">
                        <span>📎 ${escapeHtml(rawFileName)}</span>
                        ${fileExt ? `<span class="file-ext">${escapeHtml(fileExt)}</span>` : ''}
                        ${fileSizeStr ? `<span>${fileSizeStr}</span>` : ''}
                    </div>
                ` : ''}
                <div class="post-meta">
                    <span>👤 ${escapeHtml(post.user || 'أدمين')}</span>
                    ${timeFormatted ? `<span>🕒 ${timeFormatted}</span>` : ''}
                </div>
                ${hasFile ? `
                    <div class="post-actions" id="actions-${mediaKey}">
                        <button onclick="event.stopPropagation(); openStudyPreview('${pathKey}', ${originalIndex})" class="doc-btn btn-view">👁️ معاينة</button>
                        <button onclick="event.stopPropagation(); saveStudyFileOffline('${pathKey}', ${originalIndex})" class="doc-btn btn-save" id="btnDl-${mediaKey}">💾 حفظ</button>
                    </div>
                    <div class="download-progress-advanced" id="pbox-${mediaKey}">
                        <div class="progress-track"><div class="progress-fill" id="pbar-${mediaKey}" style="width:0%;"></div></div>
                        <div class="progress-info">
                            <span id="ptext-${mediaKey}">0%</span>
                            <span id="psize-${mediaKey}"></span>
                        </div>
                    </div>
                    <div class="offline-badge" id="offlineCheck-${mediaKey}">✅ محلياً</div>
                ` : ''}
            </div>
        `;
    }

    grid.innerHTML = htmlContent;

    // التحقق من الملفات المحفوظة
    setTimeout(async () => {
        if (posts.length > 0) {
            for (let i = 0; i < reversedPosts.length; i++) {
                const post = reversedPosts[i];
                const originalIndex = posts.length - 1 - i;
                if (post.hasFile || post.fileData || post.fileUrl) {
                    const postId = post.id || `post_${originalIndex}`;
                    const mediaKey = `${pathKey}_${postId}`;
                    const isSaved = await checkIsSaved(mediaKey);
                    if (isSaved) {
                        const checkEl = document.getElementById(`offlineCheck-${mediaKey}`);
                        const btnDl = document.getElementById(`btnDl-${mediaKey}`);
                        if (checkEl) checkEl.classList.add('visible');
                        if (btnDl) {
                            btnDl.textContent = '✅ محفوظ';
                            btnDl.className = 'doc-btn btn-saved';
                            btnDl.onclick = null;
                        }
                    }
                }
            }
        }
    }, 200);

    updateItemCount(data);
}

// -------- 10.4 دالات مساعدة --------
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const sizes = ['بايت', 'ك.ب', 'م.ب', 'ج.ب'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function splitFileNameAndExt(fileName) {
    if (!fileName) return { name: '', ext: '' };
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return { name: fileName, ext: '' };
    return { name: fileName.substring(0, lastDot), ext: fileName.substring(lastDot) };
}

// ========================================================================
// 11. معاينة الملفات
// ========================================================================
function openStudyPreview(pathKey, index) {
    let post = null;
    if (globalPostsData && globalPostsData.posts && globalPostsData.posts[index]) {
        post = globalPostsData.posts[index];
    }

    const postId = post && post.id ? post.id : `post_${index}`;
    const mediaKey = `${pathKey}_${postId}`;

    getMediaFromIDB(mediaKey).then(localData => {
        if (localData && localData.blob) {
            const mimeType = post?.fileType || localData.blob.type || 'application/pdf';
            const typedBlob = new Blob([localData.blob], { type: mimeType });
            const blobUrl = URL.createObjectURL(typedBlob);
            window.open(blobUrl, '_blank');
            return;
        }

        let targetUrl = post ? (post.fileUrl || post.fileData) : null;
        if (post && post.telegramFileId && targetUrl) {
            try {
                const urlObj = new URL(targetUrl);
                urlObj.searchParams.set('fileId', post.telegramFileId);
                if (post.fileName) urlObj.searchParams.set('name', post.fileName);
                if (post.fileType) urlObj.searchParams.set('mime', post.fileType);
                targetUrl = urlObj.toString();
            } catch (e) {}
        }

        if (!targetUrl) {
            alert('❌ تعذر العثور على رابط الملف.');
            return;
        }

        window.open(targetUrl, '_blank');
    }).catch(err => {
        console.warn('Error retrieving from IDB:', err);
        let targetUrl = post ? (post.fileUrl || post.fileData) : null;
        if (targetUrl) {
            window.open(targetUrl, '_blank');
        } else {
            alert('❌ تعذر فتح الملف.');
        }
    });
}

// ========================================================================
// 12. حفظ الملفات محلياً (أوفلاين)
// ========================================================================

// -------- 12.1 تحديث واجهة التحميل --------
function updateDownloadUI(mediaKey, percent, loadedStr, totalStr) {
    const pbox = document.getElementById(`pbox-${mediaKey}`);
    const pbar = document.getElementById(`pbar-${mediaKey}`);
    const ptext = document.getElementById(`ptext-${mediaKey}`);
    const psize = document.getElementById(`psize-${mediaKey}`);

    if (pbox) pbox.style.display = 'block';
    if (pbar) pbar.style.width = `${Math.min(100, Math.round(percent))}%`;
    if (ptext) ptext.textContent = `${Math.min(100, Math.round(percent))}%`;
    if (psize) psize.textContent = totalStr ? `${loadedStr} / ${totalStr}` : loadedStr;

    if (percent >= 100) {
        setTimeout(() => {
            if (pbox) pbox.style.display = 'none';
            const btnDl = document.getElementById(`btnDl-${mediaKey}`);
            const checkEl = document.getElementById(`offlineCheck-${mediaKey}`);
            if (btnDl) {
                btnDl.textContent = '✅ محفوظ';
                btnDl.className = 'doc-btn btn-saved';
                btnDl.onclick = null;
            }
            if (checkEl) checkEl.classList.add('visible');
        }, 600);
    }
}

// -------- 12.2 حفظ الملف محلياً --------
async function saveStudyFileOffline(pathKey, postIndex) {
    const folderData = globalPostsData || {};
    const posts = folderData.posts || [];
    const post = posts[postIndex];

    if (!post) {
        alert("❌ تعذر العثور على بيانات المنشور.");
        return;
    }

    const postId = post.id || `post_${postIndex}`;
    const mediaKey = `${pathKey}_${postId}`;
    let fileUrl = post.fileUrl || post.url || post.fileData;

    if (!fileUrl) {
        alert("⚠️ لا يوجد رابط ملف للحفظ.");
        return;
    }

    // التحقق مما إذا كان الملف محفوظاً بالفعل
    const alreadySaved = await checkIsSaved(mediaKey);
    if (alreadySaved) {
        alert("✅ هذا الملف محفوظ مسبقاً محلياً!");
        return;
    }

    if (post.telegramFileId && fileUrl) {
        try {
            const urlObj = new URL(fileUrl);
            urlObj.searchParams.set('fileId', post.telegramFileId);
            if (post.fileName) urlObj.searchParams.set('name', post.fileName);
            if (post.fileType) urlObj.searchParams.set('mime', post.fileType);
            fileUrl = urlObj.toString();
        } catch (e) {}
    }

    try {
        updateDownloadUI(mediaKey, 0, '0 ك.ب', formatFileSize(post.fileSize || 0));

        const response = await fetch(fileUrl, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : (post.fileSize || 0);
        const totalSizeFormatted = formatFileSize(totalBytes);

        const reader = response.body.getReader();
        let receivedBytes = 0;
        let chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedBytes += value.length;

            const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 50;
            const loadedFormatted = formatFileSize(receivedBytes);

            updateDownloadUI(mediaKey, percent, loadedFormatted, totalSizeFormatted);
        }

        const mimeType = post.fileType || 'application/octet-stream';
        const fileName = post.fileName || post.title || 'file';
        const blob = new Blob(chunks, { type: mimeType });
        
        const saved = await saveMediaToIDB(mediaKey, blob, mimeType, fileName);

        if (saved) {
            updateDownloadUI(mediaKey, 100, formatFileSize(receivedBytes), totalSizeFormatted);
            // تحديث مؤشر التخزين
            updateStorageIndicator();
        } else {
            alert('❌ فشل حفظ الملف في الذاكرة المحلية.');
            const pbox = document.getElementById(`pbox-${mediaKey}`);
            if (pbox) pbox.style.display = 'none';
        }

    } catch (error) {
        console.error("خطأ أثناء حفظ الملف:", error);
        alert(`❌ تعذر حفظ الملف: ${error.message}`);
        const pbox = document.getElementById(`pbox-${mediaKey}`);
        if (pbox) pbox.style.display = 'none';
    }
}

// ========================================================================
// 13. إدارة المجلدات (إنشاء، تعديل، حذف)
// ========================================================================

// -------- 13.1 إنشاء مجلد --------
function openCreateFolderModal() {
    if (!isStudyAdmin()) {
        alert('⚠️ هذه الخاصية متاحة فقط لمدير النظام.');
        return;
    }
    document.getElementById('newFolderName').value = '';
    document.getElementById('newFolderDescription').value = '';
    document.getElementById('createFolderModal').classList.add('active');
}

async function confirmCreateFolder() {
    const nameInput = document.getElementById('newFolderName');
    const descInput = document.getElementById('newFolderDescription');
    const folderName = nameInput ? nameInput.value.trim() : '';
    const folderDescription = descInput ? descInput.value.trim() : '';

    if (!folderName) {
        alert('⚠️ يرجى إدخال اسم المجلد.');
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لإضافة مجلد جديد.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        if (!data.folders) data.folders = [];

        const exists = data.folders.some(f => {
            if (typeof f === 'object') return f.name === folderName;
            return f === folderName;
        });

        if (exists) {
            alert('⚠️ يوجد مجلد بهذا الاسم بالفعل.');
            return;
        }

        data.folders.push({
            name: folderName,
            description: folderDescription
        });

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        closeModal('createFolderModal');
        await loadCurrentFolder();

        // إرسال إشعار
        const user = getStudyUser();
        const notification = {
            type: 'folder_created',
            title: '📁 مجلد جديد',
            message: `قام ${user ? user.name : 'المدير'} بإنشاء مجلد جديد "${folderName}"`,
            path: pathKey,
            timestamp: Date.now(),
            read: false
        };
        await studyDb.ref('notifications').push(notification);
        addNotification(notification);
        await sendFCMNotificationToAll(
            '📁 مجلد جديد',
            `${user?.name || 'المدير'} أضاف مجلد جديد: "${folderName}"`,
            { path: pathKey, type: 'folder_created', folderName: folderName }
        );

        alert('✅ تم إنشاء المجلد بنجاح!');

    } catch (err) {
        console.error('خطأ في إنشاء المجلد:', err);
        alert(`❌ حدث خطأ أثناء إنشاء المجلد: ${err.message}`);
    }
}

// -------- 13.2 تعديل مجلد --------
function openEditFolderModal(folderName) {
    if (!isStudyAdmin()) return;
    
    editingFolderName = folderName;
    editingFolderPath = getPathKey(currentStudyPath);

    document.getElementById('editFolderName').value = folderName;
    document.getElementById('editFolderDescription').value = '';
    
    // محاولة جلب الوصف من الكاش
    try {
        const cached = localStorage.getItem(`study_cache_${editingFolderPath}`);
        if (cached) {
            const data = JSON.parse(cached);
            const folder = data.folders?.find(f => {
                const fName = typeof f === 'object' ? f.name : f;
                return fName === folderName;
            });
            if (folder && typeof folder === 'object') {
                document.getElementById('editFolderDescription').value = folder.description || '';
            }
        }
    } catch (e) {}
    
    document.getElementById('editFolderModal').classList.add('active');
}

async function confirmEditFolder() {
    if (!isStudyAdmin()) return;

    const nameInput = document.getElementById('editFolderName');
    const descInput = document.getElementById('editFolderDescription');
    const newName = nameInput ? nameInput.value.trim() : '';
    const newDescription = descInput ? descInput.value.trim() : '';

    if (!newName) {
        alert('⚠️ يرجى إدخال الاسم الجديد.');
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لتعديل المجلد.');
        return;
    }

    const basePath = editingFolderPath || getPathKey(currentStudyPath);
    const targetOldName = editingFolderName || '';

    try {
        const snapshot = await studyDb.ref(`study_materials/${basePath}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        const index = data.folders?.findIndex(f => {
            const currentName = typeof f === 'object' ? f.name : f;
            return currentName === targetOldName;
        });

        if (index === -1 || index === undefined) {
            alert('⚠️ تعذر تحديد موقع المجلد.');
            closeModal('editFolderModal');
            return;
        }

        const oldFolder = data.folders[index];
        const oldName = typeof oldFolder === 'object' ? oldFolder.name : oldFolder;

        if (newName !== oldName) {
            // نقل البيانات إذا تغير الاسم
            const oldFullPath = `${basePath}/${oldName}`;
            const newFullPath = `${basePath}/${newName}`;

            const oldSnap = await studyDb.ref(`study_materials/${oldFullPath}`).once('value');
            const treeData = oldSnap.val();

            if (treeData !== null) {
                await studyDb.ref(`study_materials/${newFullPath}`).set(treeData);
                await studyDb.ref(`study_materials/${oldFullPath}`).remove();
            }

            // تحديث الكاش
            const oldLocalKey = `study_cache_${oldFullPath}`;
            const newLocalKey = `study_cache_${newFullPath}`;
            const oldCache = localStorage.getItem(oldLocalKey);
            if (oldCache) {
                localStorage.setItem(newLocalKey, oldCache);
                localStorage.removeItem(oldLocalKey);
            }
            await deleteCacheFromIDB(`folder_${oldFullPath}`);
            if (oldCache) {
                await saveCacheToIDB(`folder_${newFullPath}`, JSON.parse(oldCache));
            }
        }

        // تحديث بيانات المجلد
        if (typeof oldFolder === 'object') {
            oldFolder.name = newName;
            oldFolder.description = newDescription;
        } else {
            data.folders[index] = { name: newName, description: newDescription };
        }

        await studyDb.ref(`study_materials/${basePath}`).set(data);
        await cacheFolderData(basePath, data);

        closeModal('editFolderModal');
        updateBreadcrumb();
        await loadCurrentFolder();

        // إرسال إشعار
        const user = getStudyUser();
        const notification = {
            type: 'folder_renamed',
            title: '✏️ تغيير اسم مجلد',
            message: `قام ${user ? user.name : 'المدير'} بتغيير اسم مجلد من "${oldName}" إلى "${newName}"`,
            path: basePath,
            oldName: oldName,
            newName: newName,
            timestamp: Date.now(),
            read: false,
            forceUpdate: true
        };
        await studyDb.ref('notifications').push(notification);
        addNotification(notification);

        alert(`✅ تم تعديل المجلد إلى "${newName}" بنجاح!`);

    } catch (err) {
        console.error('خطأ في تعديل المجلد:', err);
        alert(`❌ حدث خطأ أثناء تعديل المجلد: ${err.message}`);
    }
}

// -------- 13.3 حذف مجلد --------
async function confirmDeleteFolder(folderName) {
    if (!isStudyAdmin()) return;

    if (!confirm(`⚠️ هل أنت متأكد من حذف المجلد "${folderName}" بجميع محتوياته؟\nلا يمكن التراجع عن هذا الإجراء!`)) {
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لحذف المجلد.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const targetFolderKey = `${pathKey}/${folderName}`;

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        const index = data.folders?.findIndex(f => {
            if (typeof f === 'object') return f.name === folderName;
            return f === folderName;
        });

        if (index !== -1 && index !== undefined) {
            data.folders.splice(index, 1);
            await studyDb.ref(`study_materials/${pathKey}`).set(data);
            await studyDb.ref(`study_materials/${targetFolderKey}`).remove();

            await clearCachedFolderData(pathKey);
            await clearCachedFolderData(targetFolderKey);

            await loadCurrentFolder();

            // إرسال إشعار
            const user = getStudyUser();
            const notification = {
                type: 'folder_deleted',
                title: '🗑️ حذف مجلد',
                message: `قام ${user ? user.name : 'المدير'} بحذف المجلد "${folderName}"`,
                path: pathKey,
                timestamp: Date.now(),
                read: false
            };
            await studyDb.ref('notifications').push(notification);
            addNotification(notification);

            alert('✅ تم حذف المجلد بنجاح!');
        }
    } catch (err) {
        console.error('خطأ في حذف المجلد:', err);
        alert(`❌ حدث خطأ أثناء حذف المجلد: ${err.message}`);
    }
}

// ========================================================================
// 14. إدارة المنشورات (إنشاء، تعديل، حذف)
// ========================================================================

// -------- 14.1 إنشاء منشور --------
function openCreatePostModal() {
    if (currentStudyPath.length === 0) {
        alert('⚠️ لا يمكن إدراج منشور في المجلد الجذر. يرجى الدخول إلى مجلد فرعي أولاً.');
        return;
    }

    if (!isLeafFolder(currentStudyPath)) {
        alert('⚠️ لا يمكن إدراج منشور في هذا المجلد لأنه يحتوي على مجلدات فرعية.');
        return;
    }

    document.getElementById('newPostTitle').value = '';
    document.getElementById('newPostText').value = '';
    document.getElementById('newPostFile').value = '';
    document.getElementById('createPostModal').classList.add('active');
}

async function confirmCreatePost() {
    const titleInput = document.getElementById('newPostTitle');
    const textInput = document.getElementById('newPostText');
    const fileInput = document.getElementById('newPostFile');

    const title = titleInput ? titleInput.value.trim() : '';
    const text = textInput ? textInput.value.trim() : '';
    const hasFiles = fileInput && fileInput.files && fileInput.files.length > 0;

    if (!title && !text && !hasFiles) {
        alert('⚠️ يرجى تعبئة العنوان أو النص أو إرفاق ملف!');
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لنشر منشور جديد.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);

    // إظهار نافذة التحميل
    const overlay = document.getElementById('uploadProgressOverlay');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressText = document.getElementById('uploadProgressText');
    const statusText = document.getElementById('uploadStatusText');
    if (overlay) overlay.classList.add('active');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
    if (statusText) statusText.textContent = '⏳ جاري رفع الملف...';

    let fileUrl = '';
    let fileName = '';
    let fileType = '';
    let filePath = '';
    let fileBlob = null;
    let telegramFileId = '';
    let telegramFileUniqueId = '';

    if (hasFiles) {
        const file = fileInput.files[0];

        if (file.size > 25 * 1024 * 1024) {
            if (overlay) overlay.classList.remove('active');
            alert('⚠️ حجم الملف كبير، يرجى اختيار ملف أقل من 25 ميجابايت.');
            return;
        }

        try {
            fileName = file.name;
            fileType = file.type;
            fileBlob = file;

            const result = await uploadFileToStorage(file, title || fileName, (percent) => {
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressText) progressText.textContent = `${percent}%`;
                if (statusText) statusText.textContent = `📤 جاري رفع الملف... ${percent}%`;
            });

            fileUrl = result.permanentLink;
            filePath = result.fileId;
            telegramFileId = result.telegramFileId || '';
            telegramFileUniqueId = result.telegramFileUniqueId || '';

            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = '100%';
            if (statusText) statusText.textContent = '✅ تم رفع الملف بنجاح!';

        } catch (err) {
            console.error('Upload error:', err);
            if (overlay) overlay.classList.remove('active');
            alert(`❌ حدث خطأ أثناء رفع الملف: ${err.message}`);
            return;
        }
    }

    try {
        if (statusText) statusText.textContent = '💾 جاري حفظ البيانات...';

        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        if (!data.posts) data.posts = [];

        const user = getStudyUser();
        const file = hasFiles ? fileInput.files[0] : null;

        const newPost = {
            id: `post_${Date.now()}`,
            title: title,
            text: text,
            fileUrl: fileUrl,
            filePath: filePath,
            fileName: fileName,
            fileType: fileType,
            hasFile: !!fileUrl,
            fileSize: file ? file.size : 0,
            telegramFileId: telegramFileId,
            telegramFileUniqueId: telegramFileUniqueId,
            user: user ? user.name : 'مستخدم',
            timestamp: Date.now()
        };

        data.posts.push(newPost);
        const postIndex = data.posts.length - 1;

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        if (fileBlob) {
            const mediaKey = `${pathKey}_${newPost.id}`;
            await saveMediaToIDB(mediaKey, fileBlob, fileType, fileName);
            updateStorageIndicator();
        }

        if (statusText) statusText.textContent = '✅ تم النشر بنجاح!';

        setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
        }, 1000);

        closeModal('createPostModal');
        await loadCurrentFolder();

        // إرسال إشعار
        const notification = {
            type: 'post_created',
            title: '📝 منشور جديد',
            message: `قام ${user ? user.name : 'مستخدم'} بإدراج منشور جديد${title ? ` بعنوان "${title}"` : ''}`,
            path: pathKey,
            postIndex: postIndex,
            timestamp: Date.now(),
            read: false
        };
        await studyDb.ref('notifications').push(notification);
        addNotification(notification);
        await sendFCMNotificationToAll(
            '📝 منشور جديد',
            `${user?.name || 'مستخدم'} نشر منشور جديد: "${title || 'بدون عنوان'}"`,
            { path: pathKey, type: 'post_created', postIndex: postIndex }
        );

        alert('✅ تم نشر المنشور بنجاح!');

    } catch (err) {
        console.error('خطأ في نشر المنشور:', err);
        alert(`❌ حدث خطأ أثناء نشر المنشور: ${err.message}`);
        if (overlay) overlay.classList.remove('active');
    }
}

// -------- 14.2 تعديل منشور --------
function openEditPostModal(index) {
    if (!isStudyAdmin()) return;

    const pathKey = getPathKey(currentStudyPath);
    try {
        const cached = localStorage.getItem(`study_cache_${pathKey}`);
        if (!cached) {
            alert('⚠️ لا توجد بيانات محفوظة.');
            return;
        }
        const data = JSON.parse(cached);
        const post = data.posts && data.posts[index];
        if (!post) {
            alert('⚠️ المنشور غير موجود.');
            return;
        }

        editingPostIndex = index;
        document.getElementById('editPostTitle').value = post.title || '';
        document.getElementById('editPostText').value = post.text || '';
        document.getElementById('editPostFile').value = '';
        document.getElementById('editPostModal').classList.add('active');
    } catch (err) {
        console.error('خطأ في فتح نافذة التعديل:', err);
        alert('حدث خطأ أثناء فتح نافذة التعديل.');
    }
}

async function confirmEditPost() {
    if (!isStudyAdmin() || editingPostIndex === null) return;

    const titleEl = document.getElementById('editPostTitle');
    const textEl = document.getElementById('editPostText');
    const fileInput = document.getElementById('editPostFile');

    const title = titleEl ? titleEl.value.trim() : '';
    const text = textEl ? textEl.value.trim() : '';

    if (!title && !text && (!fileInput || fileInput.files.length === 0)) {
        alert('⚠️ يرجى تعبئة العنوان أو النص أو إرفاق ملف!');
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لتعديل المنشور.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const mediaKey = `${pathKey}_${editingPostIndex}`;

    const overlay = document.getElementById('uploadProgressOverlay');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressText = document.getElementById('uploadProgressText');
    const statusText = document.getElementById('uploadStatusText');

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        if (!data.posts || !data.posts[editingPostIndex]) {
            alert('⚠️ المنشور غير موجود.');
            return;
        }

        const post = data.posts[editingPostIndex];
        const oldTitle = post.title || 'بدون عنوان';
        post.title = title || post.title;
        post.text = text || post.text;

        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            if (file.size > 25 * 1024 * 1024) {
                alert('حجم الملف كبير، يرجى اختيار ملف أقل من 25 ميجابايت.');
                return;
            }

            if (overlay) overlay.classList.add('active');
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
            if (statusText) statusText.textContent = '⏳ جاري رفع الملف...';

            try {
                if (post.filePath) {
                    await deleteFileFromStorage(post.filePath);
                }

                const result = await uploadFileToStorage(file, title || file.name, (percent) => {
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                    if (statusText) statusText.textContent = `📤 جاري رفع الملف... ${percent}%`;
                });

                post.fileUrl = result.permanentLink;
                post.filePath = result.fileId;
                post.fileName = file.name;
                post.fileType = file.type;
                post.hasFile = true;
                post.telegramFileId = result.telegramFileId || '';
                post.telegramFileUniqueId = result.telegramFileUniqueId || '';

                if (progressBar) progressBar.style.width = '100%';
                if (progressText) progressText.textContent = '100%';
                if (statusText) statusText.textContent = '✅ تم رفع الملف بنجاح!';

                await saveMediaToIDB(mediaKey, file, file.type, file.name);
                updateStorageIndicator();

            } catch (err) {
                console.error('Upload error:', err);
                if (overlay) overlay.classList.remove('active');
                alert(`❌ حدث خطأ أثناء رفع الملف الجديد: ${err.message}`);
                return;
            }
        }

        if (statusText) statusText.textContent = '💾 جاري حفظ البيانات...';

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
        }, 500);

        closeModal('editPostModal');
        editingPostIndex = null;
        await loadCurrentFolder();

        const user = getStudyUser();
        const notification = {
            type: 'post_edited',
            title: '✏️ تعديل منشور',
            message: `قام ${user ? user.name : 'المدير'} بتعديل منشور "${oldTitle}"`,
            path: pathKey,
            postIndex: editingPostIndex,
            timestamp: Date.now(),
            read: false,
            forceUpdate: true
        };
        await studyDb.ref('notifications').push(notification);
        addNotification(notification);

        alert('✅ تم تعديل المنشور بنجاح!');

    } catch (err) {
        console.error('خطأ في تعديل المنشور:', err);
        alert(`❌ حدث خطأ أثناء تعديل المنشور: ${err.message}`);
        if (overlay) overlay.classList.remove('active');
    }
}

// -------- 14.3 حذف منشور --------
async function confirmDeletePost(index) {
    if (!isStudyAdmin()) return;

    if (!confirm('⚠️ هل أنت متأكد من حذف هذا المنشور؟\nلا يمكن التراجع عن هذا الإجراء!')) {
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لحذف المنشور.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const mediaKey = `${pathKey}_${index}`;

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        if (!data.posts || !data.posts[index]) {
            alert('⚠️ المنشور غير موجود.');
            return;
        }

        const deletedPost = data.posts[index];
        const postTitle = deletedPost.title || 'بدون عنوان';

        if (deletedPost.filePath) {
            await deleteFileFromStorage(deletedPost.filePath);
        }

        await deleteMediaFromIDB(mediaKey);
        data.posts.splice(index, 1);

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        await loadCurrentFolder();

        const user = getStudyUser();
        const notification = {
            type: 'post_deleted',
            title: '🗑️ حذف منشور',
            message: `قام ${user ? user.name : 'المدير'} بحذف منشور "${postTitle}"`,
            path: pathKey,
            postIndex: index,
            timestamp: Date.now(),
            read: false,
            forceUpdate: true
        };
        await studyDb.ref('notifications').push(notification);
        addNotification(notification);

        alert('✅ تم حذف المنشور بنجاح!');

    } catch (err) {
        console.error('خطأ في حذف المنشور:', err);
        alert(`❌ حدث خطأ أثناء حذف المنشور: ${err.message}`);
    }
}

// ========================================================================
// 15. البحث
// ========================================================================
async function handleSearch(query) {
    const searchClear = document.getElementById('searchClear');
    const resultsContainer = document.getElementById('searchResults');

    clearTimeout(searchTimeout);

    if (!query || query.trim().length < 2) {
        if (resultsContainer) resultsContainer.classList.remove('active');
        if (searchClear) searchClear.classList.remove('visible');
        return;
    }

    if (searchClear) searchClear.classList.add('visible');

    searchTimeout = setTimeout(async () => {
        const searchQuery = query.trim().toLowerCase();
        const results = await searchAllContentGlobally(searchQuery);

        if (!resultsContainer) return;

        if (results.length === 0) {
            resultsContainer.innerHTML = `<div class="search-no-results">🔍 لا توجد نتائج مطابقة لـ "${escapeHtml(searchQuery)}"</div>`;
            resultsContainer.classList.add('active');
            return;
        }

        let html = '';
        results.forEach(result => {
            const icon = result.type === 'folder' ? '📁' : '📝';
            const badge = result.type === 'folder' ? 'مجلد' : 'منشور';
            const title = result.title || 'بدون عنوان';
            html += `
                <div class="search-result-item" onclick="navigateToResult('${result.path}', ${result.type === 'folder' ? 'null' : result.index}, '${result.parentPath || ''}')">
                    <span class="result-icon">${icon}</span>
                    <div class="result-info">
                        <div class="result-title">${escapeHtml(title)}</div>
                        ${result.description ? `<div style="font-size:12px;color:var(--text-muted);">${escapeHtml(result.description)}</div>` : ''}
                        ${result.matchText ? `<div style="font-size:11px;color:var(--gold-primary);margin-top:2px;">${escapeHtml(result.matchText)}</div>` : ''}
                        <div class="result-path">📍 ${escapeHtml(result.pathDisplay || '')}</div>
                    </div>
                    <span class="result-badge">${badge}</span>
                </div>
            `;
        });

        resultsContainer.innerHTML = html;
        resultsContainer.classList.add('active');
    }, 300);
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const resultsContainer = document.getElementById('searchResults');
    const searchClear = document.getElementById('searchClear');

    if (searchInput) searchInput.value = '';
    if (resultsContainer) resultsContainer.classList.remove('active');
    if (searchClear) searchClear.classList.remove('visible');
}

async function searchAllContentGlobally(query) {
    const results = [];
    const rootKey = 'root';

    try {
        // جلب البيانات من الجذر
        const rootData = await getCachedFolderData(rootKey);
        if (!rootData) {
            if (isOnline && studyDb) {
                const snapshot = await studyDb.ref(`study_materials/${rootKey}`).once('value');
                const data = snapshot.val() || { folders: [], posts: [] };
                await cacheFolderData(rootKey, data);
                await searchFolderRecursively(rootKey, [], query, results);
            }
            return results;
        }

        await searchFolderRecursively(rootKey, [], query, results);

        results.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return 0;
        });

        return results;

    } catch (err) {
        console.error('خطأ في البحث الشامل:', err);
        return results;
    }
}

async function searchFolderRecursively(pathKey, pathArray, query, results) {
    const data = await getCachedFolderData(pathKey);
    if (!data) return;

    const folders = data.folders || [];
    const posts = data.posts || [];

    folders.forEach(folder => {
        let folderName = folder;
        let folderDescription = '';
        if (typeof folder === 'object' && folder !== null) {
            folderName = folder.name || '';
            folderDescription = folder.description || '';
        }

        const nameMatch = folderName.toLowerCase().includes(query);
        const descMatch = folderDescription.toLowerCase().includes(query);

        if (nameMatch || descMatch) {
            const folderPath = [...pathArray, folderName];
            let matchText = '';
            if (nameMatch && descMatch) {
                matchText = `الاسم: "${folderName}" والوصف: "${folderDescription}"`;
            } else if (nameMatch) {
                matchText = `الاسم: "${folderName}"`;
            } else if (descMatch) {
                matchText = `الوصف: "${folderDescription}"`;
            }

            results.push({
                type: 'folder',
                title: folderName,
                description: folderDescription,
                matchText: matchText,
                path: getPathKey(folderPath),
                pathDisplay: 'المواد الدراسية › ' + folderPath.join(' › '),
                parentPath: pathKey
            });
        }

        const subPath = [...pathArray, folderName];
        const subPathKey = getPathKey(subPath);
        searchFolderRecursively(subPathKey, subPath, query, results);
    });

    posts.forEach((post, index) => {
        const titleMatch = post.title && post.title.toLowerCase().includes(query);
        const textMatch = post.text && post.text.toLowerCase().includes(query);
        const fileMatch = post.fileName && post.fileName.toLowerCase().includes(query);
        const userMatch = post.user && post.user.toLowerCase().includes(query);

        if (titleMatch || textMatch || fileMatch || userMatch) {
            const title = post.title || 'منشور بدون عنوان';
            let matchText = '';
            let description = '';

            if (titleMatch) {
                matchText = `العنوان: "${post.title}"`;
            } else if (textMatch) {
                const textPreview = post.text.length > 50 ? post.text.substring(0, 50) + '...' : post.text;
                matchText = `النص: "${textPreview}"`;
            } else if (fileMatch) {
                matchText = `اسم الملف: "${post.fileName}"`;
            } else if (userMatch) {
                matchText = `المستخدم: "${post.user}"`;
            }

            if (post.text) {
                description = post.text.length > 100 ? post.text.substring(0, 100) + '...' : post.text;
            } else if (post.fileName) {
                description = `ملف: ${post.fileName}`;
            }

            const displayPath = pathArray.length > 0 ? 'المواد الدراسية › ' + pathArray.join(' › ') : 'المواد الدراسية';

            results.push({
                type: 'post',
                title: title,
                description: description,
                matchText: matchText,
                index: index,
                path: pathKey,
                pathDisplay: `${displayPath} › ${title}`,
                parentPath: pathKey
            });
        }
    });
}

function navigateToResult(path, index, parentPath) {
    clearSearch();

    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) resultsContainer.classList.remove('active');

    if (index !== null && index !== undefined) {
        navigateTo(path);
        setTimeout(() => {
            const mediaKey = `${path}_${index}`;
            const postCard = document.getElementById(`postCard-${mediaKey}`);
            if (postCard) {
                postCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                postCard.style.borderColor = 'var(--gold-primary)';
                postCard.style.boxShadow = '0 0 40px rgba(212, 175, 55, 0.2)';
                setTimeout(() => {
                    postCard.style.borderColor = '';
                    postCard.style.boxShadow = '';
                }, 3000);
            }
        }, 500);
    } else {
        navigateTo(path);
    }
}

// ========================================================================
// 16. نظام الإشعارات المتقدم
// ========================================================================

// -------- 16.1 تحميل الإشعارات من التخزين --------
function loadNotificationsFromStorage() {
    try {
        const stored = localStorage.getItem('study_notifications');
        if (stored) {
            notificationsData = JSON.parse(stored);
        } else {
            notificationsData = [];
        }
    } catch (e) {
        notificationsData = [];
    }
    updateNotificationBadge();
}

// -------- 16.2 حفظ الإشعارات في التخزين --------
function saveNotificationsToStorage() {
    try {
        localStorage.setItem('study_notifications', JSON.stringify(notificationsData));
    } catch (e) {
        console.warn('Failed to save notifications:', e);
    }
    updateNotificationBadge();
}

// -------- 16.3 تحديث شارة الإشعارات --------
function updateNotificationBadge() {
    const unreadCount = notificationsData.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    const countDisplay = document.getElementById('notifCountDisplay');
    
    if (badge) {
        if (unreadCount > 0) {
            badge.classList.add('visible');
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.classList.remove('visible');
        }
    }
    
    if (countDisplay) {
        countDisplay.textContent = unreadCount;
    }
}

// -------- 16.4 إضافة إشعار جديد --------
function addNotification(notification) {
    // التحقق من عدم التكرار
    const isDuplicate = notificationsData.some(n => 
        n.message === notification.message && 
        Math.abs(n.timestamp - notification.timestamp) < 1000
    );
    
    if (isDuplicate) return;
    
    notification.id = notification.id || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    notification.read = false;
    notification.createdAt = Date.now();
    
    notificationsData.unshift(notification);
    
    if (notificationsData.length > 100) {
        notificationsData = notificationsData.slice(0, 100);
    }
    
    saveNotificationsToStorage();
    updateNotificationBadge();
    renderNotificationsList();
    
    // عرض إشعار في المتصفح
    showBrowserNotification(notification);
}

// -------- 16.5 عرض إشعار في المتصفح --------
function showBrowserNotification(notification) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    
    try {
        const notif = new Notification(notification.title || '📢 تحديث جديد', {
            body: notification.message || '',
            icon: '/logo.png',
            tag: notification.id,
            data: {
                path: notification.path,
                type: notification.type,
                postIndex: notification.postIndex,
                folderName: notification.folderName
            }
        });
        
        notif.onclick = function() {
            window.focus();
            if (this.data && this.data.path) {
                navigateTo(this.data.path);
                setTimeout(() => {
                    if (this.data.postIndex !== undefined) {
                        const mediaKey = `${this.data.path}_${this.data.postIndex}`;
                        const card = document.getElementById(`postCard-${mediaKey}`);
                        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 500);
            }
            notif.close();
        };
        
        setTimeout(() => notif.close(), 10000);
    } catch (e) {
        console.warn('Failed to show browser notification:', e);
    }
}

// -------- 16.6 طلب إذن الإشعارات --------
async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    
    try {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    } catch (e) {
        return false;
    }
}

// -------- 16.7 تبديل لوحة الإشعارات --------
function toggleNotificationsPanel() {
    isNotificationsPanelOpen = !isNotificationsPanelOpen;
    const panel = document.getElementById('notificationsPanel');
    const overlay = document.getElementById('notificationsOverlay');
    
    if (panel) {
        panel.classList.toggle('open', isNotificationsPanelOpen);
    }
    if (overlay) {
        overlay.classList.toggle('open', isNotificationsPanelOpen);
    }
    
    if (isNotificationsPanelOpen) {
        renderNotificationsList();
        markAllNotificationsRead();
    }
}

// -------- 16.8 عرض قائمة الإشعارات --------
function renderNotificationsList() {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    
    if (notificationsData.length === 0) {
        container.innerHTML = `
            <div class="notif-empty-advanced">
                <span class="empty-icon">📭</span>
                لا توجد إشعارات
            </div>
        `;
        return;
    }
    
    let html = '';
    notificationsData.forEach((notif) => {
        const isUnread = !notif.read;
        const iconMap = {
            'folder_created': '📁',
            'folder_deleted': '🗑️',
            'folder_renamed': '✏️',
            'post_created': '📝',
            'post_edited': '✏️',
            'post_deleted': '🗑️',
            'notification': '🔔',
            'system': '⚙️'
        };
        const icon = iconMap[notif.type] || '🔔';
        
        const timeStr = notif.timestamp ? new Date(notif.timestamp).toLocaleString('ar-YE', {
            hour: '2-digit',
            minute: '2-digit',
            day: 'numeric',
            month: 'short'
        }) : 'منذ قليل';
        
        let actionButton = '';
        if (notif.path) {
            let onClickAction = `navigateTo('${notif.path}')`;
            let buttonText = '📂 الانتقال';
            
            if (notif.postIndex !== undefined && notif.postIndex !== null) {
                onClickAction = `navigateToAndHighlight('${notif.path}', ${notif.postIndex})`;
                buttonText = '📄 عرض المنشور';
            } else if (notif.folderName) {
                onClickAction = `navigateTo('${notif.path}')`;
                buttonText = '📁 فتح المجلد';
            }
            
            actionButton = `
                <button class="goto-btn" onclick="${onClickAction}; toggleNotificationsPanel();">
                    ${buttonText}
                </button>
            `;
        }
        
        html += `
            <div class="notif-item-advanced ${isUnread ? 'unread' : ''}">
                <div class="notif-row">
                    <span class="notif-icon">${icon}</span>
                    <div class="notif-body">
                        <div class="notif-title-row">
                            <span class="notif-title">${escapeHtml(notif.title || 'تحديث')}</span>
                            ${isUnread ? `<span class="unread-dot"></span>` : ''}
                        </div>
                        <div class="notif-message">${escapeHtml(notif.message || '')}</div>
                        <div class="notif-footer">
                            <span class="notif-time">🕒 ${timeStr}</span>
                            <div class="notif-actions">
                                ${actionButton}
                                ${!isUnread ? `<span class="read-tag">✓ مقروء</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// -------- 16.9 تعليم جميع الإشعارات كمقروءة --------
function markAllNotificationsRead() {
    let hasUnread = false;
    notificationsData.forEach(n => {
        if (!n.read) {
            n.read = true;
            hasUnread = true;
        }
    });
    if (hasUnread) {
        saveNotificationsToStorage();
        updateNotificationBadge();
        renderNotificationsList();
    }
}

// -------- 16.10 مسح جميع الإشعارات --------
function clearAllNotifications() {
    if (!confirm('⚠️ هل أنت متأكد من مسح جميع الإشعارات؟')) return;
    notificationsData = [];
    saveNotificationsToStorage();
    updateNotificationBadge();
    renderNotificationsList();
}

// -------- 16.11 الانتقال إلى منشور معين --------
function navigateToAndHighlight(path, postIndex) {
    navigateTo(path);
    setTimeout(() => {
        const mediaKey = `${path}_${postIndex}`;
        const card = document.getElementById(`postCard-${mediaKey}`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.borderColor = 'var(--gold-primary)';
            card.style.boxShadow = '0 0 40px rgba(212, 175, 55, 0.2)';
            setTimeout(() => {
                card.style.borderColor = '';
                card.style.boxShadow = '';
            }, 3000);
        }
    }, 500);
}

// ========================================================================
// 17. Firebase Cloud Messaging (FCM)
// ========================================================================

// -------- 17.1 تهيئة FCM --------
async function initFCM() {
    try {
        if (typeof firebase === 'undefined' || !firebase.messaging) {
            console.warn('⚠️ Firebase Messaging غير متاح');
            return null;
        }
        
        if (!firebase.apps || !firebase.apps.length) {
            firebase.initializeApp(STUDY_FIREBASE_CONFIG);
        }
        
        fcmMessaging = firebase.messaging();
        
        const permission = await requestNotificationPermission();
        if (!permission) {
            console.warn('⚠️ تم رفض إذن الإشعارات');
            return null;
        }
        
        try {
            fcmToken = await fcmMessaging.getToken({ vapidKey: VAPID_KEY });
            console.log('✅ FCM Token:', fcmToken);
            
            if (studyDb) {
                const user = getStudyUser();
                const phone = user?.phone || 'anonymous';
                await studyDb.ref(`fcm_tokens/${phone}`).set({
                    token: fcmToken,
                    device: navigator.userAgent.includes('iPhone') ? 'ios' : 'web',
                    timestamp: Date.now(),
                    userAgent: navigator.userAgent,
                    userName: user?.name || 'مستخدم'
                });
                console.log('✅ FCM Token saved to database');
            }
            
            // معالجة الإشعارات الأمامية
            fcmMessaging.onMessage((payload) => {
                console.log('📨 Foreground message received:', payload);
                handleFCMNotification(payload);
            });
            
            fcmInitialized = true;
            return fcmToken;
            
        } catch (tokenError) {
            console.warn('⚠️ فشل الحصول على FCM Token:', tokenError);
            return null;
        }
        
    } catch (error) {
        console.warn('⚠️ فشل تهيئة FCM:', error);
        return null;
    }
}

// -------- 17.2 معالجة إشعار FCM --------
function handleFCMNotification(payload) {
    try {
        const notification = payload.notification || {};
        const data = payload.data || {};
        
        const title = notification.title || data.title || '📢 تحديث جديد';
        const body = notification.body || data.body || '';
        const path = data.path || '';
        const type = data.type || 'notification';
        const postIndex = data.postIndex !== undefined ? parseInt(data.postIndex) : undefined;
        const folderName = data.folderName || '';
        
        addNotification({
            title: title,
            message: body,
            type: type,
            path: path,
            postIndex: postIndex,
            folderName: folderName,
            timestamp: Date.now()
        });
        
        if (navigator.vibrate) {
            navigator.vibrate(200);
        }
        
    } catch (error) {
        console.warn('خطأ في معالجة إشعار FCM:', error);
    }
}

// -------- 17.3 إرسال إشعار عبر الخادم --------
async function sendFCMNotificationToAll(title, message, data = {}) {
    if (!isOnline) {
        console.warn('⚠️ أنت غير متصل بالإنترنت');
        return;
    }
    
    if (!studyDb) {
        console.warn('⚠️ قاعدة البيانات غير متاحة');
        return;
    }
    
    try {
        const snapshot = await studyDb.ref('fcm_tokens').once('value');
        const tokens = snapshot.val() || {};
        
        const tokenList = Object.values(tokens)
            .filter(t => t.token)
            .map(t => t.token);
        
        if (tokenList.length === 0) {
            console.log('⚠️ لا يوجد مستخدمين مسجلين للإشعارات');
            return;
        }
        
        const response = await fetch(`${TELEGRAM_SERVER_URL}/api/send-notification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                tokens: tokenList,
                title: title,
                body: message,
                data: data
            })
        });
        
        const result = await response.json();
        console.log('📨 نتيجة إرسال الإشعار:', result);
        
        if (result.success) {
            console.log(`✅ تم إرسال الإشعار إلى ${result.sentCount} مستخدم`);
        }
        
    } catch (error) {
        console.error('خطأ في إرسال الإشعار:', error);
    }
}

// ========================================================================
// 18. الاستماع للإشعارات من Firebase Database
// ========================================================================
let notificationListener = null;

function startNotificationListener() {
    if (notificationListener) return;
    if (!isOnline) return;
    if (!studyDb) return;

    try {
        notificationListener = studyDb.ref('notifications').limitToLast(20);
        notificationListener.on('child_added', (snapshot) => {
            const notif = snapshot.val();
            if (notif) {
                addNotification(notif);
                
                if (notif.forceUpdate) {
                    handleForceUpdate(notif);
                }
                
                if (notif.type === 'folder_renamed') {
                    handleFolderRenameNotification(notif);
                }
            }
        });
    } catch (e) {
        console.log('لا يمكن الاستماع للإشعارات حالياً.');
    }
}

function handleForceUpdate(notif) {
    try {
        const pathKey = notif.path;
        clearCachedFolderData(pathKey);
        
        const currentPathKey = getPathKey(currentStudyPath);
        if (currentPathKey === pathKey) {
            loadCurrentFolder();
        }
    } catch (err) {
        console.error('خطأ في التحديث القسري:', err);
    }
}

function handleFolderRenameNotification(notif) {
    try {
        const oldPathKey = notif.oldSubPath || `${notif.path}/${notif.oldName}`;
        const newPathKey = notif.newSubPath || `${notif.path}/${notif.newName}`;

        // نقل الكاش
        const oldData = localStorage.getItem(`study_cache_${oldPathKey}`);
        if (oldData) {
            localStorage.setItem(`study_cache_${newPathKey}`, oldData);
            localStorage.removeItem(`study_cache_${oldPathKey}`);
        }
        
        // تحديث الكاش في IndexedDB
        getCacheFromIDB(`folder_${oldPathKey}`).then(data => {
            if (data) {
                saveCacheToIDB(`folder_${newPathKey}`, data);
                deleteCacheFromIDB(`folder_${oldPathKey}`);
            }
        });

        // تحديث المسار الحالي إذا كان متأثراً
        if (currentStudyPath.length > 0 && currentStudyPath[currentStudyPath.length - 1] === notif.oldName) {
            currentStudyPath[currentStudyPath.length - 1] = notif.newName;
            updateBreadcrumb();
            loadCurrentFolder();
        }
    } catch (err) {
        console.error('خطأ في معالجة إشعار تغيير اسم المجلد:', err);
    }
}

// ========================================================================
// 19. نظام التشخيص
// ========================================================================
// ================================================================
// 🩺 نظام التشخيص - إصلاح زر حالة النظام
// ================================================================

// دالة فتح نافذة التشخيص
function openSystemDiagnosticsModal() {
    console.log('📊 جاري فتح نافذة التشخيص...');
    const modal = document.getElementById('diagnosticsModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
        // تشغيل الفحص التلقائي
        setTimeout(() => {
            runSystemDiagnostics();
        }, 300);
    } else {
        console.error('❌ لم يتم العثور على نافذة التشخيص');
        alert('⚠️ حدث خطأ في فتح نافذة التشخيص');
    }
}

// دالة إغلاق نافذة التشخيص
function closeDiagnosticsModal() {
    const modal = document.getElementById('diagnosticsModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

// دالة تشغيل فحص النظام (مطورة)
async function runSystemDiagnostics() {
    console.log('🔍 بدء فحص النظام...');
    
    const statusRender = document.getElementById('diag-render-status');
    const pingRender = document.getElementById('diag-render-ping');
    const statusFirebase = document.getElementById('diag-firebase-status');
    const storageUsed = document.getElementById('diag-storage-used');
    const storagePercent = document.getElementById('diag-storage-percent');
    const storageBar = document.getElementById('diag-storage-bar');
    const storageQuota = document.getElementById('diag-storage-quota');

    // تحديث حالة الفحص
    if (statusRender) {
        statusRender.textContent = '⏳ جاري الفحص...';
        statusRender.className = 'diag-status';
    }
    if (statusFirebase) {
        statusFirebase.textContent = '⏳ جاري الفحص...';
        statusFirebase.className = 'diag-status';
    }
    if (storageUsed) storageUsed.textContent = '⏳ جاري الحساب...';

    // -------- 1. فحص سيرفر Render --------
    try {
        const startTime = performance.now();
        const response = await fetch(`${TELEGRAM_SERVER_URL}/health`, { 
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const ping = Math.round(performance.now() - startTime);
        
        if (response.ok) {
            if (statusRender) {
                statusRender.textContent = '✅ نشط';
                statusRender.className = 'diag-status online';
            }
            if (pingRender) {
                pingRender.textContent = `⏱️ زمن الاستجابة: ${ping}ms`;
                pingRender.style.color = '#4ade80';
            }
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn('⚠️ فشل الاتصال بسيرفر Render:', error);
        if (statusRender) {
            statusRender.textContent = '❌ غير متاح';
            statusRender.className = 'diag-status offline';
        }
        if (pingRender) {
            pingRender.textContent = '🚫 تعذر الاتصال';
            pingRender.style.color = '#ef4444';
        }
    }

    // -------- 2. فحص Firebase --------
    try {
        if (typeof studyDb !== 'undefined' && studyDb) {
            const connectedRef = studyDb.ref('.info/connected');
            connectedRef.once('value', (snap) => {
                const isConnected = snap.val();
                if (isConnected) {
                    if (statusFirebase) {
                        statusFirebase.textContent = '✅ متصل';
                        statusFirebase.className = 'diag-status online';
                    }
                } else {
                    if (statusFirebase) {
                        statusFirebase.textContent = '⚠️ منقطع';
                        statusFirebase.className = 'diag-status warning';
                    }
                }
            });
        } else {
            if (statusFirebase) {
                statusFirebase.textContent = '⚠️ غير مهيأ';
                statusFirebase.className = 'diag-status warning';
            }
        }
    } catch (error) {
        console.warn('⚠️ فشل فحص Firebase:', error);
        if (statusFirebase) {
            statusFirebase.textContent = '❌ خطأ';
            statusFirebase.className = 'diag-status offline';
        }
    }

    // -------- 3. حساب التخزين --------
    try {
        const storageInfo = await calculateStorageUsage();
        if (storageInfo) {
            if (storageUsed) {
                storageUsed.textContent = `${storageInfo.usedMB} MB`;
                storageUsed.style.color = storageInfo.percent > 80 ? '#ef4444' : '#4ade80';
            }
            if (storagePercent) {
                storagePercent.textContent = `${storageInfo.percent}%`;
            }
            if (storageBar) {
                storageBar.style.width = `${Math.min(100, storageInfo.percent)}%`;
                storageBar.style.background = storageInfo.percent > 80 
                    ? 'linear-gradient(90deg, #ef4444, #f59e0b)' 
                    : 'var(--gold-grad)';
            }
            if (storageQuota) {
                storageQuota.textContent = '5.0 GB';
            }
        }
    } catch (error) {
        console.warn('⚠️ فشل حساب التخزين:', error);
        if (storageUsed) {
            storageUsed.textContent = '❌ تعذر الحساب';
            storageUsed.style.color = '#ef4444';
        }
    }

    console.log('✅ تم الانتهاء من فحص النظام');
}

// دالة حساب التخزين المستخدم
async function calculateStorageUsage() {
    try {
        // حساب حجم IndexedDB
        let idbSize = 0;
        if (window.indexedDB) {
            try {
                const db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('StudyMaterialsDB');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                
                if (db.objectStoreNames.contains('media')) {
                    const tx = db.transaction('media', 'readonly');
                    const store = tx.objectStore('media');
                    const allItems = await new Promise((resolve) => {
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve([]);
                    });
                    
                    allItems.forEach(item => {
                        if (item.blob) {
                            idbSize += item.blob.size || 0;
                        }
                        idbSize += new Blob([JSON.stringify(item)]).size;
                    });
                }
                db.close();
            } catch (e) {
                console.warn('⚠️ فشل قراءة IndexedDB:', e);
            }
        }

        // حساب حجم localStorage
        let localStorageSize = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('study_cache_')) {
                const value = localStorage.getItem(key);
                if (value) {
                    localStorageSize += new Blob([value]).size;
                }
            }
        }

        const totalUsed = idbSize + localStorageSize;
        const totalUsedMB = (totalUsed / (1024 * 1024));
        const quota = 5 * 1024 * 1024 * 1024; // 5 GB
        const percent = Number(((totalUsed / quota) * 100).toFixed(1));

        return {
            usedBytes: totalUsed,
            usedMB: totalUsedMB.toFixed(2),
            percent: percent,
            idbSize: idbSize,
            localStorageSize: localStorageSize
        };
    } catch (error) {
        console.error('❌ خطأ في حساب التخزين:', error);
        return null;
    }
}

// دالة تنظيف التخزين المؤقت
async function clearAppOfflineCache() {
    if (!confirm('⚠️ هل أنت متأكد من تنظيف التخزين المؤقت؟\nسيتم حذف جميع الملفات المحفوظة محلياً.')) {
        return;
    }

    try {
        // حذف IndexedDB
        if (window.indexedDB) {
            const req = indexedDB.deleteDatabase('StudyMaterialsDB');
            await new Promise((resolve, reject) => {
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        // حذف localStorage المؤقت
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('study_cache_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        // حذف كاش المتصفح
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        alert('✅ تم تنظيف التخزين المؤقت بنجاح! سيتم إعادة تحميل الصفحة.');
        window.location.reload();
    } catch (error) {
        console.error('❌ خطأ في تنظيف التخزين:', error);
        alert('❌ حدث خطأ أثناء تنظيف التخزين المؤقت.');
    }
}

// جعل الدوال متاحة عالمياً
window.openSystemDiagnosticsModal = openSystemDiagnosticsModal;
window.closeDiagnosticsModal = closeDiagnosticsModal;
window.runSystemDiagnostics = runSystemDiagnostics;
window.calculateStorageUsage = calculateStorageUsage;
window.clearAppOfflineCache = clearAppOfflineCache;

console.log('✅ تم تحميل نظام التشخيص بنجاح!');

async function runSystemDiagnostics() {
    const statusRender = document.getElementById('diag-render-status');
    const pingRender = document.getElementById('diag-render-ping');
    const statusFirebase = document.getElementById('diag-firebase-status');
    const storageUsed = document.getElementById('diag-storage-used');
    const storagePercent = document.getElementById('diag-storage-percent');
    const storageBar = document.getElementById('diag-storage-bar');
    const storageQuota = document.getElementById('diag-storage-quota');

    if (statusRender) statusRender.textContent = '⏳ فحص...';
    if (statusFirebase) statusFirebase.textContent = '⏳ فحص...';
    if (storageUsed) storageUsed.textContent = '⏳ جاري الحساب...';

    // فحص سيرفر Render
    const startTime = performance.now();
    try {
        const res = await fetch(`${TELEGRAM_SERVER_URL}/health`, { method: 'GET' });
        const ping = Math.round(performance.now() - startTime);
        if (res.ok) {
            if (statusRender) {
                statusRender.textContent = 'نشط ✅';
                statusRender.className = 'diag-status online';
            }
            if (pingRender) pingRender.textContent = `زمن الاستجابة: ${ping}ms`;
        } else {
            throw new Error();
        }
    } catch (e) {
        if (statusRender) {
            statusRender.textContent = 'خامل / متوقف ❌';
            statusRender.className = 'diag-status offline';
        }
        if (pingRender) pingRender.textContent = 'تعذر الاتصال بالسيرفر';
    }

    // فحص Firebase
    if (isOnline && studyDb) {
        try {
            const connectedRef = studyDb.ref('.info/connected');
            connectedRef.once('value', (snap) => {
                if (snap.val() === true) {
                    if (statusFirebase) {
                        statusFirebase.textContent = 'متصل ✅';
                        statusFirebase.className = 'diag-status online';
                    }
                } else {
                    if (statusFirebase) {
                        statusFirebase.textContent = 'منقطع ⚠️';
                        statusFirebase.className = 'diag-status warning';
                    }
                }
            });
        } catch (e) {
            if (statusFirebase) {
                statusFirebase.textContent = 'خطأ في الاتصال ❌';
                statusFirebase.className = 'diag-status offline';
            }
        }
    } else if (!isOnline) {
        if (statusFirebase) {
            statusFirebase.textContent = 'أوفلاين 📡';
            statusFirebase.className = 'diag-status warning';
        }
    } else {
        if (statusFirebase) {
            statusFirebase.textContent = 'غير مهيأ ⚠️';
            statusFirebase.className = 'diag-status warning';
        }
    }

    // حساب التخزين المستخدم
    try {
        const idbSize = await getIndexedDBSize();
        let localStorageTotal = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('study_cache_')) {
                const value = localStorage.getItem(key);
                if (value) {
                    localStorageTotal += new Blob([value]).size;
                }
            }
        }
        const totalUsed = idbSize + localStorageTotal;
        const totalUsedMB = (totalUsed / (1024 * 1024)).toFixed(2);
        
        if (storageUsed) {
            storageUsed.textContent = `${totalUsedMB} MB`;
        }

        const quota = 5 * 1024 * 1024 * 1024;
        const percent = ((totalUsed / quota) * 100).toFixed(1);
        if (storagePercent) {
            storagePercent.textContent = `${percent}%`;
        }
        if (storageBar) {
            storageBar.style.width = `${Math.min(100, Math.max(1, percent))}%`;
        }
        if (storageQuota) {
            storageQuota.textContent = '5.0 GB';
        }
    } catch (err) {
        if (storageUsed) {
            storageUsed.textContent = 'تعذر الحساب';
        }
    }
}

// ========================================================================
// 20. Keep-Alive ومراقبة الاتصال
// ========================================================================

// -------- 20.1 مراقبة حالة الاتصال --------
function initConnectionMonitoring() {
    window.addEventListener('online', () => {
        isOnline = true;
        updateStatusBar();
        // محاولة تحديث البيانات
        loadCurrentFolder();
        startNotificationListener();
        initFCM();
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateStatusBar();
    });
    
    // تحديث الحالة الأولية
    updateStatusBar();
}

// -------- 20.2 Keep-Alive للـ Render --------
function startRenderKeepAlive() {
    setInterval(async () => {
        if (isOnline) {
            try {
                await fetch(`${TELEGRAM_SERVER_URL}/health`, { method: 'GET' });
                console.log('✅ Render Keep-Alive Ping');
            } catch (e) {
                console.warn('⚠️ Render Keep-Alive Failed');
            }
        }
    }, 10 * 60 * 1000);
}

// -------- 20.3 تحديث دوري للتخزين المؤقت --------
function startPeriodicCacheUpdate() {
    // تحديث التخزين المؤقت كل 5 دقائق إذا كان متصلاً
    setInterval(async () => {
        if (isOnline && studyDb) {
            const pathKey = getPathKey(currentStudyPath);
            try {
                const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
                const data = snapshot.val() || { folders: [], posts: [] };
                await cacheFolderData(pathKey, data);
                // تحديث العرض إذا لم يتغير المسار
                if (getPathKey(currentStudyPath) === pathKey) {
                    globalPostsData = data;
                    renderFolderContent(data);
                    updateItemCount(data);
                }
                console.log('✅ Periodic cache update completed');
            } catch (e) {
                console.warn('Periodic cache update failed:', e);
            }
        }
    }, 5 * 60 * 1000);
}

// ========================================================================
// 21. دوال النوافذ المنبثقة العامة
// ========================================================================
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

function closeFilePreview() {
    const overlay = document.getElementById('filePreviewOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
    }
}

// ========================================================================
// 22. دالة إرسال إشعار من واجهة المستخدم
// ========================================================================
window.sendNotificationToAll = async function() {
    const title = prompt('📢 أدخل عنوان الإشعار:');
    if (!title) return;
    
    const message = prompt('📝 أدخل نص الإشعار:');
    if (!message) return;
    
    await sendFCMNotificationToAll(title, message, {
        type: 'notification',
        path: getPathKey(currentStudyPath)
    });
    
    alert('✅ تم إرسال الإشعار لجميع المستخدمين!');
};

// ========================================================================
// 23. تحديث البيانات من السيرفر
// ========================================================================
async function refreshData() {
    if (!isOnline) {
        alert('⚠️ أنت غير متصل بالإنترنت. يرجى الاتصال بالإنترنت للتحديث.');
        return;
    }

    const refreshBtn = document.getElementById('btnRefreshData');
    const originalText = refreshBtn ? refreshBtn.innerHTML : '';
    if (refreshBtn) {
        refreshBtn.innerHTML = '⏳ جاري التحديث...';
        refreshBtn.disabled = true;
    }

    try {
        const pathKey = getPathKey(currentStudyPath);
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const serverData = snapshot.val() || { folders: [], posts: [] };

        await cacheFolderData(pathKey, serverData);
        globalPostsData = serverData;
        renderFolderContent(serverData);
        updateItemCount(serverData);

        alert('✅ تم تحديث البيانات بنجاح من السيرفر!');

    } catch (err) {
        console.error('خطأ في تحديث البيانات:', err);
        alert('❌ حدث خطأ أثناء تحديث البيانات. تأكد من اتصال الإنترنت.');
    } finally {
        if (refreshBtn) {
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
        }
    }
}

// ========================================================================
// 24. معالجة معاملات URL
// ========================================================================
function handleUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const pathParam = urlParams.get('path');
    if (pathParam && pathParam !== 'root') {
        setTimeout(() => navigateTo(pathParam), 300);
    }
    // فتح لوحة الإشعارات إذا طلب ذلك
    if (urlParams.get('openNotifications') === 'true') {
        setTimeout(() => toggleNotificationsPanel(), 600);
    }
}

// ========================================================================
// 25. تهيئة التطبيق
// ========================================================================
async function initStudyApp() {
    console.log('🚀 بدء تهيئة التطبيق المتطور...');
    
    // تهيئة Firebase
    initFirebase();

    // تحديث حالة المستخدم
    const user = getStudyUser();
    if (user) {
        document.getElementById('userDisplay').textContent = `👤 ${user.name || 'مستخدم'}`;
    }

    // بناء الواجهة
    updateBreadcrumb();
    updateButtons();
    handleUrlParams();
    await loadCurrentFolder();
    await updateStorageIndicator();

    // بدء مراقبة الاتصال
    initConnectionMonitoring();

    // بدء الاستماع للإشعارات
    if (isOnline && studyDb) {
        startNotificationListener();
    }

    // تهيئة الإشعارات
    loadNotificationsFromStorage();
    setTimeout(async () => {
        const permission = await requestNotificationPermission();
        if (permission) {
            await initFCM();
        }
    }, 2000);

    // بدء Keep-Alive
    startRenderKeepAlive();
    startPeriodicCacheUpdate();

    // اختصارات لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
        // Ctrl+K أو Cmd+K للبحث
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
        // Escape لإغلاق النوافذ
        if (e.key === 'Escape') {
            closeModal('createFolderModal');
            closeModal('editFolderModal');
            closeModal('createPostModal');
            closeModal('editPostModal');
            closeFilePreview();
            const overlay = document.getElementById('uploadProgressOverlay');
            if (overlay) overlay.classList.remove('active');
            // إغلاق نتائج البحث
            clearSearch();
        }
    });

    // إغلاق النوافذ عند النقر على الخلفية
    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay-advanced')) {
            e.target.classList.remove('active');
        }
    });

    console.log('✅ تم تشغيل التطبيق المتطور بنجاح');
}

// ========================================================================
// 26. تشغيل التطبيق
// ========================================================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudyApp);
} else {
    initStudyApp();
}

console.log('✅ نظام المواد الدراسية المتطور جاهز!');
