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
// -------- 4.1 حفظ بيانات مجلد في التخزين المؤقت --------
async function cacheFolderDataLegacy(pathKey, data) {
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

// -------- 4.2 استرجاع بيانات مجلد من التخزين المؤقت (معدل) --------
async function getCachedFolderData(pathKey) {
    try {
        // ====== 1. محاولة من localStorage أولاً (أسرع وأكثر استقراراً) ======
        const localData = localStorage.getItem(`study_cache_${pathKey}`);
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                // التحقق من صحة البيانات
                if (parsed && typeof parsed === 'object') {
                    console.log('✅ تم استرجاع البيانات من localStorage:', pathKey);
                    // تحديث IndexedDB في الخلفية (بدون انتظار)
                    try {
                        await saveCacheToIDB(`folder_${pathKey}`, parsed);
                    } catch (e) {
                        // تجاهل أخطاء IndexedDB
                    }
                    return parsed;
                }
            } catch (e) {
                console.warn('بيانات localStorage غير صالحة:', e);
            }
        }
        
        // ====== 2. إذا لم يوجد في localStorage، حاول من IndexedDB ======
        try {
            const idbData = await getCacheFromIDB(`folder_${pathKey}`);
            if (idbData) {
                console.log('✅ تم استرجاع البيانات من IndexedDB:', pathKey);
                // حفظ في localStorage للسرعة المستقبلية
                localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(idbData));
                return idbData;
            }
        } catch (idbErr) {
            console.warn('فشل استرجاع من IndexedDB:', idbErr);
        }
        
        // ====== 3. إذا لم توجد بيانات في أي مكان ======
        console.log('⚠️ لا توجد بيانات مخزنة للمسار:', pathKey);
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
// ========================================================================
// 8. التنقل والمجلدات
// ========================================================================
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

// ====== دالة التنقل الأساسية (الصحيحة) ======
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
    // حفظ المسار
    saveCurrentPath();
    saveBrowseState();
}

function goBack() {
    if (currentStudyPath.length > 0) {
        currentStudyPath.pop();
        updateBreadcrumb();
        updateButtons();
        loadCurrentFolder();
        saveCurrentPath();
        saveBrowseState();
    }
}

function goHome() {
    window.location.href = 'index.html';
}

// ============================================================
// 💾 دوال حفظ واسترجاع الحالة
// ============================================================

// حفظ المسار الحالي
// ============================================================
// 💾 دوال حفظ واسترجاع الحالة
// ============================================================

// حفظ المسار الحالي
function saveCurrentPath() {
    try {
        localStorage.setItem('study_current_path', JSON.stringify(currentStudyPath));
    } catch (e) {
        console.warn('فشل حفظ المسار:', e);
    }
}

// استرجاع المسار المحفوظ
function loadSavedPath() {
    try {
        const saved = localStorage.getItem('study_current_path');
        if (saved) {
            const path = JSON.parse(saved);
            if (Array.isArray(path)) {
                return path;
            }
        }
    } catch (e) {
        console.warn('فشل استرجاع المسار:', e);
    }
    return [];
}

// حفظ حالة التصفح الكاملة
function saveBrowseState() {
    try {
        const state = {
            path: currentStudyPath,
            timestamp: Date.now(),
            url: window.location.href,
            scrollY: window.scrollY
        };
        localStorage.setItem('study_browse_state', JSON.stringify(state));
    } catch (e) {
        console.warn('فشل حفظ حالة التصفح:', e);
    }
}

// استرجاع حالة التصفح
function loadBrowseState() {
    try {
        const saved = localStorage.getItem('study_browse_state');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('فشل استرجاع حالة التصفح:', e);
    }
    return null;
}

// تحديث شريط الحالة (نسخة واحدة فقط - هذه هي الصحيحة)
function updateStatusBar(message) {
    const statusText = document.getElementById('connectionText');
    const dot = document.getElementById('connectionDot');
    if (statusText) {
        statusText.textContent = message || (isOnline ? '🌐 متصل' : '📡 غير متصل');
    }
    if (dot) {
        dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
    }
}

// ========================================================================
// 9. تحديث واجهة المستخدم
// ========================================================================

// -------- 9.1 تحديث شريط التنقل --------


// -------- 9.4 تحديث مؤشر التخزين --------


// حفظ حالة التصفح الكاملة


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
// ============================================================
// 📂 تحميل المجلد الحالي - نسخة محسّنة للأوفلاين
// ============================================================

async function loadCurrentFolderLegacy() {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="empty-state-advanced"><span class="empty-icon">⏳</span><h3>جاري التحميل...</h3></div>';

    const pathKey = getPathKey(currentStudyPath);
    let data = null;
    let isFromCache = false;

    // ====== 1. محاولة من localStorage أولاً (أسرع) ======
    try {
        const localData = localStorage.getItem(`study_cache_${pathKey}`);
        if (localData) {
            data = JSON.parse(localData);
            isFromCache = true;
            console.log('✅ تم تحميل البيانات من localStorage:', pathKey);
        }
    } catch (e) {
        console.warn('فشل تحميل من localStorage:', e);
    }

    // ====== 2. إذا لم يوجد في localStorage، حاول من IndexedDB ======
    if (!data) {
        try {
            const idbData = await getCacheFromIDB(`folder_${pathKey}`);
            if (idbData) {
                data = idbData;
                isFromCache = true;
                console.log('✅ تم تحميل البيانات من IndexedDB:', pathKey);
                // حفظ في localStorage للسرعة المستقبلية
                localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(data));
            }
        } catch (e) {
            console.warn('فشل تحميل من IndexedDB:', e);
        }
    }

    // ====== 3. إذا كان هناك بيانات من الكاش، اعرضها فوراً ======
    if (data && data.posts) {
        globalPostsData = data;
        renderFolderContent(data);
        updateItemCount(data);
        updateStatusBar(isOnline ? '🌐 متصل' : '📦 أوفلاين - من الكاش');
        
        // حفظ المسار
        saveCurrentPath();
        saveBrowseState();

        // ====== 4. تحديث البيانات في الخلفية (إذا كان متصلاً) ======
        if (isOnline && studyDb) {
            console.log('🔄 تحديث البيانات في الخلفية...');
            refreshFolderInBackground(pathKey);
        }
        return;
    }

    // ====== 5. إذا لم توجد بيانات في الكاش ======
    if (!isOnline) {
        grid.innerHTML = `
            <div class="empty-state-advanced">
                <span class="empty-icon">📡</span>
                <h3>أنت غير متصل بالإنترنت</h3>
                <p>لم يتم تحميل هذا المجلد مسبقاً. يرجى الاتصال بالإنترنت لتحميل المحتوى.</p>
                <button class="btn-action btn-primary" style="margin-top:12px;" onclick="loadCurrentFolder()">🔄 المحاولة مجدداً</button>
            </div>`;
        updateStatusBar('📡 غير متصل - لا يوجد كاش');
        return;
    }

    // ====== 6. تحميل من Firebase (إذا كان متصلاً) ======
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    if (progressContainer) {
        progressContainer.style.display = 'block';
        progressContainer.style.background = 'rgba(255,255,255,0.05)';
        progressContainer.style.borderRadius = '4px';
        progressContainer.style.height = '4px';
        progressContainer.style.overflow = 'hidden';
        progressContainer.style.marginTop = '4px';
    }
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.style.height = '100%';
        progressBar.style.background = 'var(--gold-grad)';
        progressBar.style.borderRadius = '4px';
        progressBar.style.transition = 'width 0.4s ease';
    }

    try {
        if (progressBar) progressBar.style.width = '20%';
        
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        data = snapshot.val() || { folders: [], posts: [] };
        
        if (progressBar) progressBar.style.width = '60%';
        
        // حفظ في localStorage و IndexedDB
        try {
            localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(data));
            await saveCacheToIDB(`folder_${pathKey}`, data);
            console.log('✅ تم حفظ البيانات في الكاش:', pathKey);
        } catch (cacheErr) {
            console.warn('فشل حفظ في الكاش:', cacheErr);
        }
        
        globalPostsData = data;
        
        if (progressBar) progressBar.style.width = '100%';
        setTimeout(() => {
            if (progressContainer) {
                progressContainer.style.display = 'none';
                progressContainer.style.background = 'transparent';
            }
            if (progressBar) progressBar.style.width = '0%';
        }, 500);
        
        renderFolderContent(data);
        updateItemCount(data);
        updateStatusBar('🌐 متصل - محدث من السيرفر');
        
        // حفظ المسار
        saveCurrentPath();
        saveBrowseState();
        return;

    } catch (err) {
        console.error('❌ خطأ في تحميل المجلد من السيرفر:', err);
        
        // محاولة استخدام أي بيانات موجودة في الكاش حتى لو كانت قديمة
        const emergencyCache = localStorage.getItem(`study_cache_${pathKey}`);
        if (emergencyCache) {
            try {
                const emergencyData = JSON.parse(emergencyCache);
                globalPostsData = emergencyData;
                renderFolderContent(emergencyData);
                updateItemCount(emergencyData);
                updateStatusBar('⚠️ بيانات مؤقتة - خطأ في التحديث');
                grid.innerHTML = ''; // نضيف هذا عشان ما تظهر رسالة الخطأ فوق المحتوى
                return;
            } catch (e) {}
        }
        
        grid.innerHTML = `
            <div class="empty-state-advanced">
                <span class="empty-icon">❌</span>
                <h3>حدث خطأ في التحميل</h3>
                <p>${err.message || 'يرجى المحاولة مرة أخرى'}</p>
                <button class="btn-action btn-primary" style="margin-top:12px;" onclick="loadCurrentFolder()">🔄 إعادة المحاولة</button>
            </div>`;
        if (progressContainer) progressContainer.style.display = 'none';
        updateStatusBar('❌ خطأ في التحميل');
    }
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
function renderLegacyFolderContent(data) {
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
        const isStudyFolder = typeof folder === 'object' && folder.type === 'study';
        
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
                <span class="folder-icon-large">${isStudyFolder ? '📚' : (hasSubFolders ? '📂' : '📁')}</span>
                <div class="folder-name">${escapeHtml(folderName)}</div>
                ${folderDescription ? `<div class="folder-desc">${escapeHtml(folderDescription)}</div>` : ''}
                <div class="folder-meta">${isStudyFolder ? '📚 15 محاضرة' : (hasSubFolders ? '📂 يحتوي على مجلدات' : '📁 مجلد')}</div>
            </div>
        `;
    });

    // -------- عرض المنشورات --------
        const reversedPosts = [...posts].reverse();
    for (let i = 0; i < reversedPosts.length; i++) {
        const post = reversedPosts[i];
        const originalIndex = posts.length - 1 - i;
        const postId = post.id || `post_${originalIndex}`;

        // دعم المصفوفة الجديدة للملفات، أو التراجع للنسخة القديمة للتوافقية
        let filesList = [];
        if (post.files && Array.isArray(post.files)) {
            filesList = post.files;
        } else if (post.hasFile || post.fileData || post.fileUrl) {
            filesList = [{
                fileUrl: post.fileUrl || post.fileData,
                fileName: post.fileName || post.title || 'مستند مرفق',
                fileType: post.fileType,
                fileSize: post.fileSize
            }];
        }

        const timeFormatted = post.timestamp ? new Date(post.timestamp).toLocaleString('ar-YE', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '';

        // ====== أزرار الإدارة فقط ======
        const postAdminActions = isAdmin ? `
            <div class="post-card-admin-actions">
                <button onclick="event.stopPropagation(); openEditPostModal(${originalIndex})" title="تعديل">✏️</button>
                <button onclick="event.stopPropagation(); confirmDeletePost(${originalIndex})" title="حذف">🗑️</button>
            </div>
        ` : '';

        // ====== توليد كود الـ HTML لكل الملفات المرفقة في هذا المنشور ======
        let filesHtml = '';
        filesList.forEach((fileObj, fileIndex) => {
            const mediaKey = `${pathKey}_${postId}_file_${fileIndex}`;
            const rawFileName = fileObj.fileName || 'مستند مرفق';
            const fileParsed = splitFileNameAndExt(rawFileName);
            const displayName = fileParsed.name.replace(/_/g, ' ');
            const ext = fileParsed.ext ? fileParsed.ext.trim() : '';
            const isHtml = ext.toLowerCase() === '.html' || ext.toLowerCase() === '.htm' || fileObj.fileType === 'text/html';
            const fileSizeStr = fileObj.fileSize ? formatFileSize(fileObj.fileSize) : '';

            filesHtml += `
                <div class="multi-file-item" style="margin-top: 10px; padding: 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;">
                    <!-- اسم الملف والامتداد -->
                    <div class="file-name-container">
                        <div class="file-name-line">📎 ${escapeHtml(displayName)}</div>
                        ${ext ? `<div class="file-ext-badge" style="${isHtml ? 'background: rgba(234, 88, 12, 0.2); color: #fb923c; border: 1px solid rgba(234, 88, 12, 0.3);' : ''}">${escapeHtml(ext)}</div>` : ''}
                    </div>

                    ${fileSizeStr ? `<div style="color: #38bdf8; font-size: 11px; font-weight: 600; margin-top: 4px;">💽 ${fileSizeStr}</div>` : ''}
                    
                    <!-- أزرار الإجراءات الخاصة بهذا الملف -->
                    <div class="post-square-actions" id="actions-${mediaKey}" style="margin-top: 8px;">
                        <button onclick="event.stopPropagation(); openStudyPreviewMulti('${pathKey}', ${originalIndex}, ${fileIndex})" class="doc-btn doc-btn-view">👁️ معاينة</button>
                        <button onclick="event.stopPropagation(); saveStudyFileOfflineMulti('${pathKey}', ${originalIndex}, ${fileIndex})" class="doc-btn doc-btn-download" id="btnDl-${mediaKey}">💾 حفظ</button>
                    </div>
                    
                    <!-- شريط التقدم -->
                    <div class="download-progress-box" id="pbox-${mediaKey}">
                        <div class="progress-track">
                            <div class="progress-fill" id="pbar-${mediaKey}" style="width:0%;"></div>
                        </div>
                        <div class="progress-info">
                            <span id="ptext-${mediaKey}">0%</span>
                            <span id="psize-${mediaKey}"></span>
                        </div>
                    </div>
                    
                    <!-- شارة التخزين المحلي -->
                    <div class="offline-badge" id="offlineCheck-${mediaKey}">✅ محلياً</div>
                </div>
            `;
        });

        // ====== البطاقة كاملة ======
        htmlContent += `
            <div class="post-card-advanced" id="postCard-${postId}">
                ${postAdminActions}
                
                <!-- الأيقونة -->
                <img src="document.png" class="folder-icon-big" alt="منشور">
                
                <!-- العنوان -->
                <div class="folder-name1">${escapeHtml(post.title || 'بدون عنوان')}</div>
                
                <!-- النص -->
                ${(post.text || post.description) ? `
                    <div class="post-details-text">${escapeHtml(post.text || post.description)}</div>
                ` : ''}
                
                <!-- قائمة الملفات المتعددة -->
                ${filesHtml}
                
                <!-- معلومات المنشور العامة -->
                <div class="post-meta-info" style="margin-top: 12px;">
                    <div>👤 ${escapeHtml(post.user || 'أدمين')}</div>
                    ${timeFormatted ? `<div>🕒 ${timeFormatted}</div>` : ''}
                </div>
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
                            btnDl.className = 'doc-btn doc-btn-saved';
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

            const newWindow = window.open(blobUrl, '_self');
            if (!newWindow) {
                window.location.href = blobUrl;
            }
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

        window.location.href = targetUrl;
    }).catch(err => {
        console.warn('Error retrieving from IDB:', err);
        let targetUrl = post ? (post.fileUrl || post.fileData) : null;
        if (targetUrl) {
            window.location.href = targetUrl;
        } else {
            alert('❌ تعذر فتح الملف.');
        }
    });
}

function showFileInPreview(blobUrl, mimeType, post) {
    if (blobUrl) {
        window.location.href = blobUrl;
    }
}

// ========================================================================
// 5. تحميل الملف وحفظه للعمل أوفلاين مع نسبة تحميل حقيقية
// ========================================================================



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
        alert('⚠️ يرجى تعبئة العنوان أو النص أو إرفاق ملف واحد على الأقل!');
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
    if (statusText) statusText.textContent = '⏳ جاري تجهيز الملفات...';

    let uploadedFiles = [];

    if (hasFiles) {
        const filesArray = Array.from(fileInput.files);
        const totalFiles = filesArray.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = filesArray[i];

            if (file.size > 25 * 1024 * 1024) {
                if (overlay) overlay.classList.remove('active');
                alert(`⚠️ الملف "${file.name}" أكبر من 25 ميجابايت، يرجى اختيار ملف أصغر.`);
                return;
            }

            try {
                if (statusText) statusText.textContent = `📤 جاري رفع الملف (${i + 1}/${totalFiles}): ${file.name}`;
                
                const result = await uploadFileToStorage(file, title || file.name, (percent) => {
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                });

                // معالجة نوع الـ HTML والأنواع الأخرى بدقة
                let detectedType = file.type;
                if (!detectedType || detectedType === '') {
                    if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
                        detectedType = 'text/html';
                    } else {
                        detectedType = 'application/octet-stream';
                    }
                }

                uploadedFiles.push({
                    fileUrl: result.permanentLink,
                    filePath: result.fileId,
                    fileName: file.name,
                    fileType: detectedType,
                    fileSize: file.size,
                    telegramFileId: result.telegramFileId || '',
                    telegramFileUniqueId: result.telegramFileUniqueId || '',
                    fileBlob: file // للاحتفاظ به محلياً
                });

            } catch (err) {
                console.error('Upload error:', err);
                if (overlay) overlay.classList.remove('active');
                alert(`❌ حدث خطأ أثناء رفع الملف "${file.name}": ${err.message}`);
                return;
            }
        }
    }

    try {
        if (statusText) statusText.textContent = '💾 جاري حفظ البيانات...';
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '100%';

        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        if (!data.posts) data.posts = [];

        const user = getStudyUser();
        const postId = `post_${Date.now()}`;

        const newPost = {
            id: postId,
            title: title,
            text: text,
            files: uploadedFiles, // تخزين مصفوفة الملفات هنا
            hasFile: uploadedFiles.length > 0,
            user: user ? user.name : 'مستخدم',
            timestamp: Date.now()
        };

        // لا نرسل كائنات File المؤقتة إلى Firebase؛ نستخدمها فقط للحفظ المحلي
        const persistedPost = {
            ...newPost,
            files: uploadedFiles.map(({ fileBlob, ...fileData }) => fileData)
        };
        data.posts.push(persistedPost);
        const postIndex = data.posts.length - 1;

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        // حفظ كل ملف محلياً في IndexedDB مع فهرس فريد لكل ملف داخل المنشور
        for (let i = 0; i < uploadedFiles.length; i++) {
            const f = uploadedFiles[i];
            if (f.fileBlob) {
                const mediaKey = `${pathKey}_${postId}_file_${i}`;
                await saveMediaToIDB(mediaKey, f.fileBlob, f.fileType, f.fileName);
            }
        }
        updateStorageIndicator();

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

        alert('✅ تم نشر المنشور ورفع الملفات بنجاح!');

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
    if (!isNotificationsPanelOpen && document.getElementById('groupChatPanel')?.classList.contains('open')) {
        closeGroupChatPanel();
    }
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
            'lecture_file_added': '📖',
            'assignment_created': '📌',
            'assignment_completed': '✅',
            'assignment_urgent': '🚨',
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
            
            if (notif.assignmentId && notif.lectureIndex !== undefined) {
                onClickAction = `navigateToAssignment(${studySafeJs(notif.path)}, ${Number(notif.lectureIndex)}, ${studySafeJs(notif.assignmentId)})`;
                buttonText = '📌 عرض التكليف';
            } else if (notif.postIndex !== undefined && notif.postIndex !== null) {
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
function openSystemDiagnosticsModal() {
    const modal = document.getElementById('diagnosticsModal');
    if (modal) {
        modal.style.display = 'flex';
        runSystemDiagnostics();
    }
}

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
// ============================================================
// 🚀 تهيئة التطبيق - نسخة محسّنة للأوفلاين مع حفظ الحالة
// ============================================================

async function initStudyApp() {
    console.log('🚀 بدء تهيئة التطبيق المتطور...');
    
    // ====== 1. تهيئة Firebase ======
    initFirebase();

    // ====== 2. تحديث حالة المستخدم ======
    const user = getStudyUser();
    if (user) {
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) {
            userDisplay.textContent = `👤 ${user.name || 'مستخدم'}`;
        }
    }

    // ====== 3. استرجاع المسار المحفوظ (الأهم للأوفلاين) ======
    const savedPath = loadSavedPath();
    if (savedPath && savedPath.length > 0) {
        currentStudyPath = savedPath;
        console.log('📂 تم استرجاع المسار المحفوظ:', currentStudyPath);
    } else {
        console.log('📂 لا يوجد مسار محفوظ، سيتم البدء من الجذر');
    }

    // ====== 4. بناء الواجهة الأساسية ======
    updateBreadcrumb();
    updateButtons();
    handleUrlParams();
    
    // ====== 5. تحميل المجلد الحالي (مع دعم الأوفلاين) ======
    await loadCurrentFolder();
    await updateStorageIndicator();

    // ====== 6. تحديث شريط الحالة ======
    updateStatusBar(isOnline ? '🌐 متصل' : '📡 غير متصل (أوفلاين)');

    // ====== 7. بدء مراقبة الاتصال ======
    initConnectionMonitoring();

    // ====== 8. بدء الاستماع للإشعارات (إذا كان متصلاً) ======
    if (isOnline && studyDb) {
        startNotificationListener();
    }

    // ====== 9. تهيئة الإشعارات ======
    loadNotificationsFromStorage();
    setTimeout(async () => {
        const permission = await requestNotificationPermission();
        if (permission) {
            await initFCM();
        }
    }, 2000);

    // ====== 10. بدء Keep-Alive والتحديث الدوري ======
    startRenderKeepAlive();
    startPeriodicCacheUpdate();

    // ====== 11. حفظ الحالة بشكل دوري (كل 30 ثانية) ======
    setInterval(() => {
        saveCurrentPath();
        saveBrowseState();
        console.log('💾 تم حفظ حالة التصفح تلقائياً');
    }, 30000);

    // ====== 12. حفظ الحالة عند إغلاق الصفحة ======
    window.addEventListener('beforeunload', () => {
        saveCurrentPath();
        saveBrowseState();
        console.log('💾 تم حفظ الحالة قبل الخروج');
    });

    // ====== 13. اختصارات لوحة المفاتيح ======
    document.addEventListener('keydown', (e) => {
        // Ctrl+K أو Cmd+K للبحث
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
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
            clearSearch();
        }
    });

    // ====== 14. إغلاق النوافذ عند النقر على الخلفية ======
    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay-advanced')) {
            e.target.classList.remove('active');
        }
    });

    // ====== 15. عرض معلومات التشغيل ======
    console.log('✅ تم تشغيل التطبيق المتطور بنجاح');
    console.log(`📊 الحالة: ${isOnline ? 'متصل' : 'غير متصل (أوفلاين)'}`);
    console.log(`📂 المسار الحالي: ${currentStudyPath.join(' › ') || 'الجذر'}`);
    console.log(`👤 المستخدم: ${user ? user.name : 'زائر'}`);
    console.log(`💾 التخزين: جاري حساب المساحة...`);
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

/* ========================================================================
   📚 طبقة المواد الدراسية الجديدة
   - كاش تفاضلي: لا تُكتب البيانات محلياً إلا عند وجود فرق فعلي.
   - مجلد المادة ينشئ 15 محاضرة ثابتة، وكل محاضرة تحتوي ملفات وتكاليف.
   ======================================================================== */
const STUDY_CACHE_VERSION = 2;
let currentLectureIndex = null;
let currentAssignmentContext = null;
let currentCompletionContext = null;
let assignmentCountdownTimer = null;

function studyArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
}

function studyStripTransient(value) {
    if (Array.isArray(value)) return value.map(studyStripTransient);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).forEach(key => {
        if (key !== 'fileBlob' && key !== 'blob') {
            result[key] = studyStripTransient(value[key]);
        }
    });
    return result;
}

function studySerialize(value) {
    return JSON.stringify(studyStripTransient(value));
}

function studySame(a, b) {
    return studySerialize(a) === studySerialize(b);
}

function studyReadLocal(pathKey) {
    try {
        const value = localStorage.getItem(`study_cache_${pathKey}`);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.warn('تعذر قراءة كاش المواد:', error);
        return null;
    }
}

function studyFolderNameForPath(pathArray) {
    return pathArray.length ? pathArray[pathArray.length - 1] : 'المواد الدراسية';
}

function getFolderDescriptor(pathArray) {
    if (!pathArray.length) return null;
    const parentPath = pathArray.slice(0, -1);
    const parentData = studyReadLocal(getPathKey(parentPath));
    return studyArray(parentData?.folders).find(folder => {
        const name = typeof folder === 'object' ? folder.name : folder;
        return name === pathArray[pathArray.length - 1];
    }) || null;
}

function isStudyFolderData(data, pathArray = currentStudyPath) {
    return data?.folderType === 'study' ||
        data?.type === 'study' ||
        (typeof getFolderDescriptor(pathArray) === 'object' && getFolderDescriptor(pathArray)?.type === 'study');
}

function getLectureTitle(number) {
    const weeks = [
        'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
        'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
        'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الأخير'
    ];
    return `المحاضرة رقم ${number} - الأسبوع ${weeks[number - 1] || number}`;
}

function createLecturePost(number) {
    return {
        id: `lecture_${number}`,
        lectureNumber: number,
        contentType: 'lecture',
        title: getLectureTitle(number),
        text: '',
        files: [],
        assignments: [],
        timestamp: 0,
        user: 'النظام'
    };
}

function ensureLecturePosts(data, folderName = '') {
    const result = data && typeof data === 'object' ? data : {};
    result.folders = studyArray(result.folders);
    result.posts = studyArray(result.posts);
    const lectureMap = new Map();
    result.posts.forEach(post => {
        if (post && Number(post.lectureNumber) >= 1 && Number(post.lectureNumber) <= 15) {
            lectureMap.set(Number(post.lectureNumber), post);
        }
    });

    let changed = false;
    if (lectureMap.size < 15) {
        const generated = [];
        for (let number = 1; number <= 15; number += 1) {
            if (lectureMap.has(number)) {
                generated.push(lectureMap.get(number));
            } else {
                generated.push(createLecturePost(number));
                changed = true;
            }
        }
        const otherPosts = result.posts.filter(post => !post || !post.lectureNumber);
        result.posts = generated.concat(otherPosts);
    } else {
        const ordered = Array.from(lectureMap.values()).sort((a, b) => Number(a.lectureNumber) - Number(b.lectureNumber));
        const otherPosts = result.posts.filter(post => !post || !post.lectureNumber);
        const nextPosts = ordered.concat(otherPosts);
        if (!studySame(nextPosts, result.posts)) {
            result.posts = nextPosts;
            changed = true;
        }
    }
    result.folderType = 'study';
    result.folderName = result.folderName || folderName;
    result.cacheVersion = STUDY_CACHE_VERSION;
    return { data: result, changed };
}

function mergeStudyFolderData(cached, serverData, pathArray = currentStudyPath) {
    const server = serverData && typeof serverData === 'object'
        ? studyStripTransient(serverData)
        : { folders: [], posts: [] };
    const local = cached && typeof cached === 'object' ? cached : null;
    const merged = {
        ...server,
        folders: studyArray(server.folders),
        posts: studyArray(server.posts)
    };

    // Firebase is authoritative for normal records. Local records are only
    // used to retain generated lectures when an older server tree is opened.
    if (isStudyFolderData(server, pathArray) || isStudyFolderData(local, pathArray)) {
        const localLectures = new Map(studyArray(local?.posts).map(post => [Number(post?.lectureNumber), post]));
        const serverLectures = new Map(merged.posts.map(post => [Number(post?.lectureNumber), post]));
        for (let number = 1; number <= 15; number += 1) {
            if (!serverLectures.has(number) && localLectures.has(number)) {
                merged.posts.push(localLectures.get(number));
            }
        }
        const ensured = ensureLecturePosts(merged, studyFolderNameForPath(pathArray));
        return ensured.data;
    }
    return merged;
}

// البديل التفاضلي للدالة القديمة: يمنع إعادة كتابة الكاش إذا لم يصل أي جديد.
async function cacheFolderData(pathKey, data) {
    const cleanData = studyStripTransient(data || { folders: [], posts: [] });
    const localData = studyReadLocal(pathKey);
    if (localData && studySame(localData, cleanData)) {
        return false;
    }
    try {
        localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(cleanData));
    } catch (error) {
        console.warn('تعذر حفظ كاش المواد في localStorage:', error);
    }
    await saveCacheToIDB(`folder_${pathKey}`, cleanData);
    return true;
}

// لا يتم حفظ مسار التصفح. كل جلسة تبدأ من الجذر كما طلب المستخدم.
function saveCurrentPath() {}
function saveBrowseState() {}
function loadSavedPath() { return []; }
function loadBrowseState() { return null; }

async function getStudyCachedData(pathKey) {
    const localData = studyReadLocal(pathKey);
    if (localData) return localData;
    const idbData = await getCacheFromIDB(`folder_${pathKey}`);
    if (idbData) {
        try {
            localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(idbData));
        } catch (error) {}
        return idbData;
    }
    return null;
}

async function fetchAndMergeStudyFolder(pathKey) {
    if (!studyDb || !isOnline) return null;
    const pathArray = pathKey === 'root' ? [] : pathKey.split('/').slice(1);
    const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
    const serverData = snapshot.val() || { folders: [], posts: [] };
    const cached = await getStudyCachedData(pathKey);
    const merged = mergeStudyFolderData(cached, serverData, pathArray);
    const changed = await cacheFolderData(pathKey, merged);
    return { data: merged, changed };
}

async function loadCurrentFolderBase() {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;
    const pathKey = getPathKey(currentStudyPath);
    let data = await getStudyCachedData(pathKey);

    if (data) {
        if (isStudyFolderData(data)) {
            const ensured = ensureLecturePosts(data, studyFolderNameForPath(currentStudyPath));
            data = ensured.data;
            if (ensured.changed) await cacheFolderData(pathKey, data);
        }
        globalPostsData = data;
        renderFolderContent(data);
        updateItemCount(data);
        updateStatusBar(isOnline ? '🌐 متصل · عرض سريع من الكاش' : '📦 أوفلاين · من الكاش');
        if (isOnline && studyDb) refreshFolderInBackground(pathKey);
        checkUrgentAssignments();
        return;
    }

    if (!isOnline || !studyDb) {
        grid.innerHTML = `
            <div class="empty-state-advanced">
                <span class="empty-icon">📡</span>
                <h3>لا توجد نسخة محلية لهذا المجلد</h3>
                <p>اتصل بالإنترنت ثم اضغط «تحديث» لتحميل المواد أول مرة.</p>
            </div>`;
        updateStatusBar('📡 غير متصل · لا يوجد كاش');
        return;
    }

    grid.innerHTML = '<div class="empty-state-advanced"><span class="empty-icon">⏳</span><h3>جاري تحميل المواد...</h3></div>';
    try {
        const result = await fetchAndMergeStudyFolder(pathKey);
        data = result?.data || { folders: [], posts: [] };
        globalPostsData = data;
        renderFolderContent(data);
        updateItemCount(data);
        updateStatusBar('🌐 تم التحميل وحُفظت نسخة محلية');
        checkUrgentAssignments();
    } catch (error) {
        console.error('فشل تحميل مواد المجلد:', error);
        grid.innerHTML = `
            <div class="empty-state-advanced">
                <span class="empty-icon">❌</span>
                <h3>تعذر تحميل المجلد</h3>
                <p>${escapeHtml(error.message || 'حاول مرة أخرى')}</p>
            </div>`;
    }
}

async function refreshFolderInBackground(pathKey) {
    try {
        const result = await fetchAndMergeStudyFolder(pathKey);
        if (!result || !result.changed) return;
        if (getPathKey(currentStudyPath) === pathKey) {
            globalPostsData = result.data;
            renderFolderContent(result.data);
            updateItemCount(result.data);
            checkUrgentAssignments();
        }
    } catch (error) {
        console.warn('تعذر جلب التغييرات الجديدة:', error);
    }
}

function renderFolderContent(data) {
    if (isStudyFolderData(data)) {
        renderStudyFolderContent(data);
        return;
    }
    renderLegacyFolderContent(data);
}

function studySafeJs(value) {
    const text = String(value ?? '');
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

function studyDomKey(value) {
    return encodeURIComponent(String(value ?? '')).replace(/%/g, '_');
}

function studyDate(timestamp) {
    if (!timestamp) return 'غير محدد';
    return new Date(timestamp).toLocaleString('ar-YE', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// فحص التكليفات العاجلة في المجلد الحالي وكل المواد التي سبق فتحها أوفلاين.
function checkUrgentAssignments() {
    const user = getStudyUser();
    const userId = user?.phone || user?.id || studyUserLabel(user);
    const now = Date.now();
    const sources = new Map();
    if (isStudyFolderData(globalPostsData)) {
        sources.set(getPathKey(currentStudyPath), globalPostsData);
    }
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith('study_cache_')) continue;
            const pathKey = key.slice('study_cache_'.length);
            const data = studyReadLocal(pathKey);
            if (isStudyFolderData(data, pathKey === 'root' ? [] : pathKey.split('/').slice(1))) {
                sources.set(pathKey, data);
            }
        }
    } catch (error) {}

    sources.forEach((data, pathKey) => {
        studyArray(data.posts).forEach((post, lectureIndex) => {
            studyArray(post?.assignments).forEach(assignment => {
                const remaining = Number(assignment.deadlineAt || 0) - now;
                const completed = studyArray(assignment.completions)
                    .some(item => String(item.userId || item.user || '') === String(userId));
                if (completed || remaining <= 0 || remaining > 3 * 24 * 60 * 60 * 1000) return;
                const key = `study_urgent_${assignment.id}`;
                const lastNotice = Number(localStorage.getItem(key) || 0);
                if (now - lastNotice < 12 * 60 * 60 * 1000) return;
                try { localStorage.setItem(key, String(now)); } catch (error) {}
                addNotification({
                    type: 'assignment_urgent',
                    title: '🚨 تكليف طارئ',
                    message: `تبقى ${assignmentRemaining(assignment.deadlineAt).label.replace('متبقي ', '')} على تسليم "${assignment.title || 'التكليف'}"`,
                    path: pathKey,
                    lectureIndex,
                    assignmentId: assignment.id,
                    timestamp: now
                });
            });
        });
    });
}

/* ========================================================================
   🚀 تحسينات الأوفلاين والبحث والعودة من معاينة الملفات
   ======================================================================== */
const STUDY_PREVIEW_RETURN_KEY = 'study_preview_return';
let studySearchResults = [];

function rememberStudyPreviewReturn(file) {
    try {
        if (typeof sessionStorage === 'undefined') return;
        sessionStorage.setItem(STUDY_PREVIEW_RETURN_KEY, JSON.stringify({
            path: [...currentStudyPath],
            scrollY: window.scrollY || 0,
            mediaKey: file?.mediaKey || '',
            createdAt: Date.now()
        }));
    } catch (error) {}
}

function consumeStudyPreviewReturn() {
    try {
        if (typeof sessionStorage === 'undefined') return null;
        const value = sessionStorage.getItem(STUDY_PREVIEW_RETURN_KEY);
        sessionStorage.removeItem(STUDY_PREVIEW_RETURN_KEY);
        if (!value) return null;
        const state = JSON.parse(value);
        if (!Array.isArray(state.path) || Date.now() - Number(state.createdAt || 0) > 15 * 60 * 1000) {
            return null;
        }
        return state;
    } catch (error) {
        return null;
    }
}

function restoreStudyPreviewReturn(state) {
    if (!state) return;
    setTimeout(() => {
        let target = null;
        if (state.mediaKey) {
            target = Array.from(document.querySelectorAll('[data-study-media-key]'))
                .find(element => element.dataset.studyMediaKey === state.mediaKey);
            target = target?.closest('.lecture-file-card') || target;
        }
        if (target?.scrollIntoView) {
            target.scrollIntoView({ behavior: 'auto', block: 'center' });
            target.style.boxShadow = '0 0 28px rgba(212,175,55,.28)';
            setTimeout(() => { target.style.boxShadow = ''; }, 1800);
        } else if (typeof window.scrollTo === 'function') {
            window.scrollTo(0, Number(state.scrollY || 0));
        }
    }, 350);
}

async function openStudyFileObjectPreview(file) {
    if (!file) {
        alert('❌ تعذر العثور على الملف.');
        return;
    }
    const local = await getMediaFromIDB(file.mediaKey || '');
    const blob = local?.blob || file.fileBlob;
    rememberStudyPreviewReturn(file);
    if (blob instanceof Blob) {
        window.location.href = URL.createObjectURL(new Blob([blob], { type: studyFileType(file) }));
        return;
    }
    const url = studyFileUrl(file);
    if (!url) {
        alert('❌ لا يوجد رابط معاينة لهذا الملف.');
        return;
    }
    window.location.href = url;
}

function openStudyPreview(pathKey, index) {
    const post = getStudyPost(globalPostsData, index);
    const file = post?.files?.[0] || post;
    if (file) {
        file.mediaKey = `${pathKey}_${post?.id || `post_${index}`}_file_0`;
    }
    openStudyFileObjectPreview(file);
}

async function listStudyCachedFolders() {
    const folders = new Map();
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith('study_cache_')) continue;
            const pathKey = key.slice('study_cache_'.length);
            const data = studyReadLocal(pathKey);
            if (data) folders.set(pathKey, data);
        }
    } catch (error) {}

    try {
        const idb = await openIDB();
        const transaction = idb.transaction('cache', 'readonly');
        const request = transaction.objectStore('cache').getAll();
        const entries = await new Promise(resolve => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });
        entries.forEach(entry => {
            if (entry?.key?.startsWith('folder_')) {
                folders.set(entry.key.slice('folder_'.length), entry.data);
            }
        });
    } catch (error) {}
    return folders;
}

async function warmStudyTree(data, pathKey = 'root', pathArray = [], visited = new Set(), depth = 0) {
    if (!isOnline || !studyDb || !data || depth > 8 || visited.has(pathKey)) return;
    visited.add(pathKey);
    const children = studyArray(data.folders);

    for (const folder of children) {
        const folderName = typeof folder === 'object' ? folder.name : folder;
        if (!folderName) continue;
        const childPath = `${pathKey}/${folderName}`;
        const childArrayPath = [...pathArray, folderName];
        let childData = await getStudyCachedData(childPath);

        if (!childData) {
            try {
                const snapshot = await studyDb.ref(`study_materials/${childPath}`).once('value');
                childData = mergeStudyFolderData(null, snapshot.val() || {
                    folders: [], posts: [], folderType: folder.type || 'normal',
                    folderName, folderDescription: folder.description || ''
                }, childArrayPath);
                await cacheFolderData(childPath, childData);
            } catch (error) {
                console.warn('تعذر تجهيز كاش المجلد:', childPath, error);
            }
        }

        if (childData) {
            await warmStudyTree(childData, childPath, childArrayPath, visited, depth + 1);
        }
    }
}

function normalizeStudySearchText(value) {
    return String(value ?? '')
        .toLocaleLowerCase('ar-YE')
        .normalize('NFKC')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .trim();
}

function studySearchObjectText(value, key = '') {
    if (value === null || value === undefined) return '';
    const ignored = ['fileblob', 'blob', 'filedata', 'fileurl', 'url', 'telegramfileid', 'telegramfileuniqueid'];
    if (ignored.includes(String(key).toLowerCase())) return '';
    if (Array.isArray(value)) return value.map(item => studySearchObjectText(item, key)).join(' ');
    if (typeof value === 'object') {
        return Object.entries(value)
            .map(([childKey, childValue]) => studySearchObjectText(childValue, childKey))
            .join(' ');
    }
    return typeof value === 'string' ? value : '';
}

function addStudySearchResult(results, result) {
    const identity = `${result.type}|${result.path}|${result.postIndex ?? ''}|${result.itemId ?? ''}|${result.fileIndex ?? ''}`;
    if (results.some(item => item.identity === identity)) return;
    results.push({ ...result, identity });
}

function collectStudySearchResults(data, pathKey, pathArray, query, results) {
    if (!data) return;
    const normalizedQuery = normalizeStudySearchText(query);
    const folderTitle = pathArray[pathArray.length - 1];
    if (pathArray.length > 0) {
        const folderText = normalizeStudySearchText([
            folderTitle, data.folderDescription, data.description
        ].join(' '));
        if (folderText.includes(normalizedQuery)) {
            addStudySearchResult(results, {
                type: 'folder',
                title: folderTitle,
                description: data.folderDescription || data.description || '',
                matchText: 'مطابقة في اسم أو وصف المجلد',
                path: pathKey,
                pathDisplay: `المواد الدراسية › ${pathArray.join(' › ')}`
            });
        }
    }

    studyArray(data.folders).forEach(folder => {
        const name = typeof folder === 'object' ? folder.name || '' : String(folder || '');
        const description = typeof folder === 'object' ? folder.description || '' : '';
        const folderText = normalizeStudySearchText(`${name} ${description}`);
        if (folderText.includes(normalizedQuery)) {
            const childPathArray = [...pathArray, name];
            addStudySearchResult(results, {
                type: 'folder',
                title: name,
                description,
                matchText: 'مطابقة في اسم أو وصف المجلد',
                path: getPathKey(childPathArray),
                pathDisplay: `المواد الدراسية › ${childPathArray.join(' › ')}`
            });
        }
    });

    studyArray(data.posts).forEach((post, postIndex) => {
        if (!post) return;
        const postText = normalizeStudySearchText(studySearchObjectText(post));
        const postTitle = post.title || getLectureTitle(Number(post.lectureNumber || postIndex + 1));
        const displayPath = `المواد الدراسية › ${pathArray.join(' › ') || 'الجذر'}`;
        if (postText.includes(normalizedQuery)) {
            addStudySearchResult(results, {
                type: post.contentType === 'lecture' ? 'lecture' : 'post',
                title: postTitle,
                description: post.text || post.description || '',
                matchText: 'مطابقة داخل عنوان أو وصف أو مستخدم أو ملف أو تكليف',
                path: pathKey,
                postIndex,
                lectureNumber: post.lectureNumber,
                pathDisplay: `${displayPath} › ${postTitle}`
            });
        }

        studyArray(post.files).forEach((file, fileIndex) => {
            if (!normalizeStudySearchText(studySearchObjectText(file)).includes(normalizedQuery)) return;
            addStudySearchResult(results, {
                type: 'file',
                title: file.entryTitle || studyFileName(file),
                description: file.entryDescription || `${studyFileName(file)} · ${studyFileType(file)}`,
                matchText: 'مطابقة داخل بيانات الملف',
                path: pathKey,
                postIndex,
                lectureNumber: post.lectureNumber,
                fileIndex,
                pathDisplay: `${displayPath} › ${postTitle} › ${studyFileName(file)}`
            });
        });

        studyArray(post.assignments).forEach((assignment, assignmentIndex) => {
            const assignmentText = normalizeStudySearchText(studySearchObjectText(assignment));
            if (assignmentText.includes(normalizedQuery)) {
                addStudySearchResult(results, {
                    type: 'assignment',
                    title: assignment.title || 'تكليف',
                    description: assignment.details || '',
                    matchText: 'مطابقة داخل التكليف أو متطلباته أو الإنجازات',
                    path: pathKey,
                    postIndex,
                    lectureNumber: post.lectureNumber,
                    itemId: assignment.id || assignmentIndex,
                    pathDisplay: `${displayPath} › ${assignment.title || 'تكليف'}`
                });
            }
            studyArray(assignment.files).forEach((file, fileIndex) => {
                if (!normalizeStudySearchText(studySearchObjectText(file)).includes(normalizedQuery)) return;
                addStudySearchResult(results, {
                    type: 'file',
                    title: file.entryTitle || studyFileName(file),
                    description: file.entryDescription || `${studyFileName(file)} · متطلبات تكليف`,
                    matchText: 'مطابقة داخل ملف متطلبات التكليف',
                    path: pathKey,
                    postIndex,
                    lectureNumber: post.lectureNumber,
                    itemId: assignment.id || assignmentIndex,
                    fileIndex,
                    pathDisplay: `${displayPath} › ${assignment.title || 'تكليف'} › ${studyFileName(file)}`
                });
            });
        });

        studyArray(post.assignments).forEach(assignment => {
            studyArray(assignment.completions).forEach(completion => {
                if (!normalizeStudySearchText(studySearchObjectText(completion)).includes(normalizedQuery)) return;
                addStudySearchResult(results, {
                    type: 'completion',
                    title: `إنجاز ${completion.userName || completion.user || 'مستخدم'}`,
                    description: `التكليف: ${assignment.title || 'تكليف'}`,
                    matchText: 'مطابقة داخل اسم المنجز أو ملف الإنجاز',
                    path: pathKey,
                    postIndex,
                    lectureNumber: post.lectureNumber,
                    itemId: assignment.id,
                    pathDisplay: `${displayPath} › ${assignment.title || 'تكليف'} › الإنجازات`
                });
            });
        });
    });
}

async function searchAllContentGlobally(query) {
    const normalizedQuery = normalizeStudySearchText(query);
    if (!normalizedQuery) return [];
    const cachedFolders = await listStudyCachedFolders();

    if (!cachedFolders.size && isOnline && studyDb) {
        try {
            const result = await fetchAndMergeStudyFolder('root');
            if (result?.data) cachedFolders.set('root', result.data);
        } catch (error) {}
    }

    const results = [];
    for (const [pathKey, data] of cachedFolders.entries()) {
        const pathArray = pathKey === 'root' ? [] : pathKey.split('/').slice(1);
        collectStudySearchResults(data, pathKey, pathArray, normalizedQuery, results);
    }
    return results.sort((a, b) => {
        const rank = { folder: 0, lecture: 1, post: 2, assignment: 3, file: 4, completion: 5 };
        return (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
    }).slice(0, 100);
}

function searchResultLabel(type) {
    return {
        folder: 'مجلد',
        lecture: 'محاضرة',
        post: 'منشور',
        assignment: 'تكليف',
        file: 'ملف',
        completion: 'إنجاز'
    }[type] || 'نتيجة';
}

async function handleSearch(query) {
    const searchClear = document.getElementById('searchClear');
    const resultsContainer = document.getElementById('searchResults');
    clearTimeout(searchTimeout);
    const cleanQuery = String(query || '').trim();
    if (searchClear) searchClear.classList.toggle('visible', cleanQuery.length > 0);
    if (cleanQuery.length < 2) {
        resultsContainer?.classList.remove('active');
        return;
    }

    searchTimeout = setTimeout(async () => {
        const results = await searchAllContentGlobally(cleanQuery);
        studySearchResults = results;
        if (!resultsContainer) return;
        if (!results.length) {
            resultsContainer.innerHTML = `<div class="search-no-results">🔍 لا توجد نتائج مطابقة لـ "${escapeHtml(cleanQuery)}"</div>`;
            resultsContainer.classList.add('active');
            return;
        }
        resultsContainer.innerHTML = results.map((result, index) => `
            <div class="search-result-item" onclick="openStudySearchResult(${index})">
                <span class="result-icon">${result.type === 'folder' ? '📁' : result.type === 'file' ? '📎' : '📝'}</span>
                <div class="result-info">
                    <div class="result-title">${escapeHtml(result.title)}</div>
                    ${result.description ? `<div class="result-description">${escapeHtml(result.description)}</div>` : ''}
                    <div class="result-match">${escapeHtml(result.matchText || '')}</div>
                    <div class="result-path">📍 ${escapeHtml(result.pathDisplay || '')}</div>
                </div>
                <span class="result-badge">${searchResultLabel(result.type)}</span>
            </div>
        `).join('');
        resultsContainer.classList.add('active');
    }, 90);
}

function openStudySearchResult(index) {
    const result = studySearchResults[index];
    if (!result) return;
    clearSearch();
    navigateTo(result.path);
    if (result.type === 'folder') return;
    setTimeout(() => {
        let target = null;
        if (Number(result.lectureNumber) >= 1 && Number(result.lectureNumber) <= 15) {
            target = document.getElementById(`lectureCard-${Number(result.lectureNumber)}`);
        } else if (result.postIndex !== undefined) {
            const post = getStudyPost(globalPostsData, result.postIndex);
            target = document.getElementById(`postCard-${post?.id || `post_${result.postIndex}`}`);
        }
        if (target?.scrollIntoView) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.boxShadow = '0 0 35px rgba(212,175,55,.3)';
            setTimeout(() => { target.style.boxShadow = ''; }, 2200);
        }
    }, 500);
}

async function loadCurrentFolder() {
    await loadCurrentFolderBase();
    if (isOnline && studyDb) {
        const pathKey = getPathKey(currentStudyPath);
        void warmStudyTree(globalPostsData, pathKey, [...currentStudyPath]);
    }
}

async function initStudyApp() {
    console.log('🚀 بدء تهيئة منظومة المواد الدراسية مع الأوفلاين...');
    const previewReturn = consumeStudyPreviewReturn();
    initFirebase();
    try {
        localStorage.removeItem('study_current_path');
        localStorage.removeItem('study_browse_state');
    } catch (error) {}

    currentStudyPath = previewReturn?.path || [];
    globalPostsData = { folders: [], posts: [] };
    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay) userDisplay.textContent = `👤 ${studyUserLabel(getStudyUser())}`;
    updateBreadcrumb();
    updateButtons();
    loadNotificationsFromStorage();
    await loadCurrentFolder();
    await updateStorageIndicator();
    updateStatusBar(isOnline ? '🌐 متصل · الكاش جاهز' : '📦 أوفلاين · البيانات المحلية');
    initConnectionMonitoring();
    if (isOnline && studyDb) startNotificationListener();
    setTimeout(async () => {
        if (await requestNotificationPermission()) await initFCM();
    }, 2000);
    startRenderKeepAlive();
    startPeriodicCacheUpdate();
    assignmentCountdownTimer = setInterval(() => {
        updateAssignmentCountdowns();
        checkUrgentAssignments();
    }, 1000);
    handleUrlParams();
    restoreStudyPreviewReturn(previewReturn);
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            document.getElementById('searchInput')?.focus();
        }
        if (event.key === 'Escape') {
            ['createFolderModal', 'editFolderModal', 'createPostModal', 'editPostModal',
                'lectureFileModal', 'assignmentModal', 'completionModal'].forEach(closeModal);
            document.getElementById('uploadProgressOverlay')?.classList.remove('active');
            clearSearch();
        }
    });
    document.addEventListener('click', event => {
        if (event.target?.classList?.contains('modal-overlay-advanced')) {
            event.target.classList.remove('active');
        }
    });
}

function studyUserLabel(user) {
    return user?.name || user?.username || user?.phone || 'مستخدم';
}

function studyFileType(file) {
    return file?.fileType || file?.type || 'نوع غير محدد';
}

function studyFileName(file) {
    return file?.fileName || file?.name || 'ملف مرفق';
}

function studyFileUrl(file) {
    let url = file?.fileUrl || file?.fileData || file?.url || '';
    if (url && file?.telegramFileId) {
        try {
            const parsed = new URL(url);
            parsed.searchParams.set('fileId', file.telegramFileId);
            parsed.searchParams.set('name', studyFileName(file));
            parsed.searchParams.set('mime', studyFileType(file));
            url = parsed.toString();
        } catch (error) {}
    }
    return url;
}

function studyFileActionMarkup(pathKey, mediaKey, file, previewCall, saveCall) {
    const domKey = studyDomKey(mediaKey);
    return `
        <div class="lecture-file-card">
            <div class="lecture-file-title">📎 ${escapeHtml(file?.entryTitle || studyFileName(file))}</div>
            ${file?.entryDescription ? `<div class="lecture-file-meta">${escapeHtml(file.entryDescription)}</div>` : ''}
            <div class="lecture-file-meta">
                ${escapeHtml(studyFileType(file))} · ${formatFileSize(file?.fileSize || file?.size || 0) || 'الحجم غير معروف'}
                ${file?.user ? ` · 👤 ${escapeHtml(file.user)}` : ''}
                ${file?.timestamp ? ` · 🕒 ${escapeHtml(studyDate(file.timestamp))}` : ''}
            </div>
            <div class="lecture-file-actions">
                <button class="doc-btn doc-btn-view" onclick="event.stopPropagation();${previewCall}">👁️ معاينة</button>
                <button class="doc-btn doc-btn-download" id="btnDl-${domKey}" data-study-media-key="${escapeHtml(mediaKey)}" onclick="event.stopPropagation();${saveCall}">💾 حفظ محلي</button>
            </div>
            <div class="download-progress-box" id="pbox-${domKey}">
                <div class="progress-track"><div class="progress-fill" id="pbar-${domKey}" style="width:0%;"></div></div>
                <div class="progress-info"><span id="ptext-${domKey}">0%</span><span id="psize-${domKey}"></span></div>
            </div>
            <div class="offline-badge" id="offlineCheck-${domKey}">✅ محفوظ محلياً</div>
        </div>
    `;
}

function renderStudyFileList(pathKey, lectureIndex, files, group, itemId) {
    const filesArray = studyArray(files);
    if (!filesArray.length) return '<div class="lecture-empty">لا توجد إدراجات حتى الآن.</div>';
    return filesArray.map((file, fileIndex) => {
        const ownerKey = group === 'lecture'
            ? (itemId || lectureIndex)
            : group === 'completion'
                ? `${itemId.assignmentId}_${itemId.completionId}`
                : `${lectureIndex}_${itemId}`;
        const mediaKey = `${pathKey}_${ownerKey}_${group}_${fileIndex}`;
        let previewCall;
        let saveCall;
        if (group === 'lecture') {
            previewCall = `openStudyPreviewMulti(${studySafeJs(pathKey)}, ${lectureIndex}, ${fileIndex})`;
            saveCall = `saveStudyFileOfflineMulti(${studySafeJs(pathKey)}, ${lectureIndex}, ${fileIndex})`;
        } else if (group === 'assignment') {
            previewCall = `openAssignmentFilePreview(${studySafeJs(pathKey)}, ${lectureIndex}, ${studySafeJs(itemId)}, ${fileIndex})`;
            saveCall = `saveAssignmentFileOffline(${studySafeJs(pathKey)}, ${lectureIndex}, ${studySafeJs(itemId)}, ${fileIndex})`;
        } else {
            previewCall = `openCompletionFilePreview(${studySafeJs(pathKey)}, ${lectureIndex}, ${studySafeJs(itemId.assignmentId)}, ${studySafeJs(itemId.completionId)}, ${fileIndex})`;
            saveCall = `saveCompletionFileOffline(${studySafeJs(pathKey)}, ${lectureIndex}, ${studySafeJs(itemId.assignmentId)}, ${studySafeJs(itemId.completionId)}, ${fileIndex})`;
        }
        return studyFileActionMarkup(pathKey, mediaKey, file, previewCall, saveCall);
    }).join('');
}

function assignmentRemaining(deadlineAt, now = Date.now()) {
    const remaining = Number(deadlineAt || 0) - now;
    if (!deadlineAt) return { remaining: 0, state: 'warning', label: 'موعد التسليم غير محدد' };
    if (remaining <= 0) return { remaining, state: 'expired', label: 'انتهى موعد التسليم' };
    const minutes = Math.floor(remaining / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    let label = '';
    if (days > 30) {
        label = `متبقي ${Math.floor(days / 30)} شهر و${days % 30} يوم`;
    } else if (days >= 7) {
        label = `متبقي ${Math.floor(days / 7)} أسبوع و${days % 7} يوم`;
    } else if (days > 0) {
        label = `متبقي ${days} يوم و${hours} ساعة`;
    } else if (hours > 0) {
        label = `متبقي ${hours} ساعة و${mins} دقيقة`;
    } else {
        label = `متبقي ${Math.max(1, mins)} دقيقة`;
    }
    const state = remaining <= 24 * 60 * 60 * 1000
        ? 'danger'
        : remaining <= 3 * 24 * 60 * 60 * 1000 ? 'warning' : 'safe';
    return { remaining, state, label };
}

function renderStudyAssignment(pathKey, lectureIndex, assignment) {
    const assignmentId = assignment.id || `assignment_${assignment.createdAt || Date.now()}`;
    const domId = studyDomKey(`${pathKey}_${lectureIndex}_${assignmentId}`);
    const deadline = assignmentRemaining(assignment.deadlineAt);
    const user = getStudyUser();
    const userId = user?.phone || user?.id || studyUserLabel(user);
    const completions = studyArray(assignment.completions);
    const completed = completions.some(item => String(item.userId || item.user || '') === String(userId));
    const files = renderStudyFileList(pathKey, lectureIndex, assignment.files, 'assignment', assignmentId);
    const completionHtml = completions.length ? `
        <div class="completion-list">
            <div class="completion-list-title">✅ تم الإنجاز بواسطة (${completions.length})</div>
            ${completions.map(item => `
                <div class="completion-item">
                    • ${escapeHtml(item.userName || item.user || 'مستخدم')} · ${escapeHtml(studyDate(item.timestamp))}
                    ${studyArray(item.files).length
                        ? renderStudyFileList(pathKey, lectureIndex, item.files, 'completion', {
                            assignmentId,
                            completionId: item.id
                        })
                        : ' · بدون ملف مرفق'}
                </div>
            `).join('')}
        </div>
    ` : '<div class="completion-list"><div class="completion-item">لم يسجل أحد الإنجاز بعد.</div></div>';
    return `
        <div class="assignment-card ${deadline.state}" id="assignmentCard-${domId}" data-deadline="${Number(assignment.deadlineAt || 0)}" data-assignment-card="${domId}">
            <div class="assignment-title">📌 ${escapeHtml(assignment.title || 'تكليف بدون عنوان')}</div>
            ${assignment.details ? `<div class="assignment-meta">${escapeHtml(assignment.details)}</div>` : ''}
            <div class="assignment-meta">
                👤 ${escapeHtml(assignment.userName || assignment.user || 'مستخدم')} · 🕒 ${escapeHtml(studyDate(assignment.createdAt || assignment.timestamp))}
                · ⏰ التسليم: ${escapeHtml(studyDate(assignment.deadlineAt))}
            </div>
            <span class="assignment-deadline ${deadline.state}" data-countdown="${domId}">${escapeHtml(deadline.label)}</span>
            <div class="assignment-files">${files}</div>
            <div class="assignment-actions">
                ${completed
                    ? '<span class="completed-tag">✅ أنجزت هذا التكليف</span>'
                    : `<button class="mini-add-btn" onclick="completeAssignment(${studySafeJs(pathKey)}, ${lectureIndex}, ${studySafeJs(assignmentId)})">✅ الإشارة إلى الإنجاز</button>`}
                <button class="mini-add-btn" onclick="openCompletionModal(${studySafeJs(pathKey)}, ${lectureIndex}, ${studySafeJs(assignmentId)})">📎 إدراج إنجاز</button>
            </div>
            ${completionHtml}
        </div>
    `;
}

function renderStudyFolderContent(data) {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;
    const pathKey = getPathKey(currentStudyPath);
    const posts = studyArray(data.posts)
        .filter(post => Number(post?.lectureNumber) >= 1 && Number(post?.lectureNumber) <= 15)
        .sort((a, b) => Number(a.lectureNumber) - Number(b.lectureNumber));
    const userCanAdd = canUserAddContent();
    const descriptor = getFolderDescriptor(currentStudyPath);
    const description = data.folderDescription || descriptor?.description || '';

    grid.innerHTML = `
        <div class="study-folder-view">
            <div class="study-folder-intro">
                <div>
                    <h3>📚 خطة المحاضرات</h3>
                    <p>${escapeHtml(description || '15 محاضرة مرتبة من الأسبوع الأول إلى الأسبوع الأخير')}</p>
                </div>
                <span class="folder-count-badge">15 محاضرة</span>
            </div>
            ${posts.map((post, index) => {
                const lectureNumber = Number(post.lectureNumber);
                const originalIndex = data.posts.indexOf(post);
                const files = renderStudyFileList(pathKey, originalIndex, post.files, 'lecture', post.id || lectureNumber);
                const assignments = studyArray(post.assignments);
                return `
                    <article class="lecture-card collapsed" id="lectureCard-${lectureNumber}" data-lecture-card="${lectureNumber}">
                        <div class="lecture-header" onclick="toggleLectureCard(event, ${lectureNumber})" role="button" aria-controls="lectureContent-${lectureNumber}" aria-expanded="false">
                            <div class="lecture-heading">
                                <span class="lecture-toggle-icon" aria-hidden="true">⌄</span>
                                <div>
                                <div class="lecture-title">${escapeHtml(post.title || getLectureTitle(lectureNumber))}</div>
                                <div class="lecture-week">الأسبوع ${lectureNumber === 15 ? 'الأخير' : lectureNumber}</div>
                                </div>
                            </div>
                            <div class="lecture-header-actions">
                                <button class="lecture-comments-btn" onclick="event.stopPropagation();openLectureComments(${studySafeJs(pathKey)}, ${originalIndex}, ${studySafeJs(post.id || lectureNumber)}, ${studySafeJs(post.title || getLectureTitle(lectureNumber))}, ${lectureNumber})">💬 التعليقات</button>
                                ${userCanAdd ? `<button class="mini-add-btn" onclick="event.stopPropagation();openLectureFileModal(${originalIndex})">➕ إدراج ملفات</button>` : ''}
                            </div>
                        </div>
                        <div class="lecture-scroll" id="lectureContent-${lectureNumber}" hidden>
                            <section class="lecture-section">
                                <div class="lecture-section-title">
                                    <span>📖 ملفات المحاضرة</span>
                                    ${userCanAdd ? `<button class="mini-add-btn" onclick="openLectureFileModal(${originalIndex})">إضافة</button>` : ''}
                                </div>
                                ${files}
                            </section>
                            <section class="lecture-section">
                                <div class="lecture-section-title">
                                    <span>📌 التكاليف</span>
                                    ${userCanAdd ? `<button class="mini-add-btn" onclick="openAssignmentModal(${originalIndex})">➕ إعلان تكليف</button>` : ''}
                                </div>
                                ${assignments.length
                                    ? assignments.map(assignment => renderStudyAssignment(pathKey, originalIndex, assignment)).join('')
                                    : '<div class="lecture-empty">لا توجد تكاليف لهذه المحاضرة.</div>'}
                            </section>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;

    document.querySelectorAll('[data-media-key]').forEach(() => {});
    setTimeout(markVisibleStudyFilesSaved, 0);
    updateAssignmentCountdowns();
}

function studyOverlay(show, title = 'جاري رفع الملفات...') {
    const overlay = document.getElementById('uploadProgressOverlay');
    const titleEl = document.getElementById('uploadTitle');
    const statusEl = document.getElementById('uploadStatusText');
    const bar = document.getElementById('uploadProgressBar');
    const percent = document.getElementById('uploadProgressText');
    if (overlay) overlay.classList.toggle('active', show);
    if (titleEl) titleEl.textContent = title;
    if (bar) bar.style.width = '0%';
    if (percent) percent.textContent = '0%';
    if (statusEl) statusEl.textContent = show ? '⏳ جاري تجهيز الملفات...' : '';
}

async function uploadStudyFiles(input, title) {
    const files = input?.files ? Array.from(input.files) : [];
    if (!files.length) return [];
    const uploaded = [];
    studyOverlay(true, 'جاري رفع ملفات المادة...');
    try {
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            if (file.size > 25 * 1024 * 1024) {
                throw new Error(`الملف "${file.name}" أكبر من 25 ميجابايت`);
            }
            const status = document.getElementById('uploadStatusText');
            if (status) status.textContent = `📤 رفع الملف ${index + 1} من ${files.length}: ${file.name}`;
            const result = await uploadFileToStorage(file, title || file.name, percent => {
                const bar = document.getElementById('uploadProgressBar');
                const text = document.getElementById('uploadProgressText');
                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${percent}%`;
            });
            uploaded.push({
                id: `file_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
                fileUrl: result.permanentLink,
                filePath: result.fileId,
                fileName: file.name,
                fileType: file.type || 'application/octet-stream',
                fileSize: file.size,
                telegramFileId: result.telegramFileId || '',
                telegramFileUniqueId: result.telegramFileUniqueId || '',
                fileBlob: file
            });
        }
        const status = document.getElementById('uploadStatusText');
        if (status) status.textContent = '✅ اكتمل رفع الملفات';
        return uploaded;
    } finally {
        setTimeout(() => studyOverlay(false), 500);
    }
}

async function persistStudyFolder(pathKey, data) {
    if (!studyDb || !isOnline) throw new Error('يتطلب حفظ التغييرات اتصالاً بالإنترنت');
    const cleanData = studyStripTransient(data);
    await studyDb.ref(`study_materials/${pathKey}`).set(cleanData);
    await cacheFolderData(pathKey, data);
    globalPostsData = data;
    return data;
}

function getStudyPost(data, index) {
    const posts = studyArray(data?.posts);
    return posts[index] || null;
}

function getStudyAssignment(data, lectureIndex, assignmentId) {
    const post = getStudyPost(data, lectureIndex);
    return studyArray(post?.assignments).find(item => String(item.id) === String(assignmentId)) || null;
}

function getStudyCompletion(data, lectureIndex, assignmentId, completionId) {
    const assignment = getStudyAssignment(data, lectureIndex, assignmentId);
    return studyArray(assignment?.completions).find(item => String(item.id) === String(completionId)) || null;
}

async function markVisibleStudyFilesSaved() {
    const buttons = document.querySelectorAll('[data-study-media-key]');
    await Promise.all(Array.from(buttons).map(async button => {
        const mediaKey = button.dataset.studyMediaKey;
        if (!mediaKey || !(await checkIsSaved(mediaKey))) return;
        button.textContent = '✅ محفوظ';
        button.className = 'doc-btn doc-btn-saved';
        button.onclick = null;
        const badge = document.getElementById(`offlineCheck-${studyDomKey(mediaKey)}`);
        if (badge) badge.classList.add('visible');
    }));
}

async function saveStudyFileObjectOffline(file, mediaKey) {
    if (!file) {
        alert('⚠️ لا يوجد ملف للحفظ.');
        return;
    }
    if (await checkIsSaved(mediaKey)) {
        alert('✅ هذا الملف محفوظ مسبقاً محلياً.');
        return;
    }
    const domKey = studyDomKey(mediaKey);
    try {
        const response = await fetch(studyFileUrl(file), { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const total = Number(response.headers.get('content-length')) || file.fileSize || 0;
        const reader = response.body?.getReader();
        const chunks = [];
        let received = 0;
        if (reader) {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                chunks.push(chunk.value);
                received += chunk.value.length;
                updateDownloadUI(mediaKey, total ? received / total * 100 : 50, formatFileSize(received), formatFileSize(total));
            }
        } else {
            chunks.push(new Uint8Array(await response.arrayBuffer()));
            received = chunks[0].length;
        }
        const blob = file.fileBlob instanceof Blob
            ? file.fileBlob
            : new Blob(chunks, { type: studyFileType(file) });
        if (!await saveMediaToIDB(mediaKey, blob, studyFileType(file), studyFileName(file))) {
            throw new Error('تعذر الكتابة في الذاكرة المحلية');
        }
        updateDownloadUI(mediaKey, 100, formatFileSize(received || blob.size), formatFileSize(total || blob.size));
        await updateStorageIndicator();
    } catch (error) {
        console.error('فشل حفظ ملف المادة:', error);
        const box = document.getElementById(`pbox-${domKey}`);
        if (box) box.style.display = 'none';
        alert(`❌ تعذر حفظ الملف: ${error.message}`);
    }
}

function updateDownloadUI(mediaKey, percent, loadedStr, totalStr) {
    const domKey = studyDomKey(mediaKey);
    const pbox = document.getElementById(`pbox-${domKey}`) || document.getElementById(`pbox-${mediaKey}`);
    const pbar = document.getElementById(`pbar-${domKey}`) || document.getElementById(`pbar-${mediaKey}`);
    const ptext = document.getElementById(`ptext-${domKey}`) || document.getElementById(`ptext-${mediaKey}`);
    const psize = document.getElementById(`psize-${domKey}`) || document.getElementById(`psize-${mediaKey}`);
    if (pbox) pbox.style.display = 'block';
    if (pbar) pbar.style.width = `${Math.min(100, Math.round(percent))}%`;
    if (ptext) ptext.textContent = `${Math.min(100, Math.round(percent))}%`;
    if (psize) psize.textContent = totalStr ? `${loadedStr} / ${totalStr}` : loadedStr;
    if (percent >= 100) {
        setTimeout(() => {
            if (pbox) pbox.style.display = 'none';
            const button = document.getElementById(`btnDl-${domKey}`) || document.getElementById(`btnDl-${mediaKey}`);
            const badge = document.getElementById(`offlineCheck-${domKey}`) || document.getElementById(`offlineCheck-${mediaKey}`);
            if (button) {
                button.textContent = '✅ محفوظ';
                button.className = 'doc-btn doc-btn-saved';
                button.onclick = null;
            }
            if (badge) badge.classList.add('visible');
        }, 500);
    }
}

function findStudyFile(pathKey, lectureIndex, group, itemId, fileIndex) {
    const data = globalPostsData || {};
    const post = getStudyPost(data, lectureIndex);
    if (!post) return null;
    if (group === 'lecture') return studyArray(post.files)[fileIndex] || null;
    const assignment = getStudyAssignment(data, lectureIndex, itemId);
    if (!assignment) return null;
    if (group === 'assignment') return studyArray(assignment.files)[fileIndex] || null;
    const completion = getStudyCompletion(data, lectureIndex, itemId.assignmentId, itemId.completionId);
    return completion ? studyArray(completion.files)[fileIndex] || null : null;
}

async function openStudyFileObjectPreview(file) {
    if (!file) {
        alert('❌ تعذر العثور على الملف.');
        return;
    }
    const local = await getMediaFromIDB(file.mediaKey || '');
    const blob = local?.blob || file.fileBlob;
    rememberStudyPreviewReturn(file);
    if (blob instanceof Blob) {
        window.location.href = URL.createObjectURL(new Blob([blob], { type: studyFileType(file) }));
        return;
    }
    const url = studyFileUrl(file);
    if (!url) {
        alert('❌ لا يوجد رابط معاينة لهذا الملف.');
        return;
    }
    window.location.href = url;
}

function openStudyPreviewMulti(pathKey, postIndex, fileIndex) {
    const post = getStudyPost(globalPostsData, postIndex);
    const file = studyArray(post?.files)[fileIndex];
    const group = post?.contentType === 'lecture' ? 'lecture' : 'file';
    if (file) file.mediaKey = `${pathKey}_${post?.id || postIndex}_${group}_${fileIndex}`;
    openStudyFileObjectPreview(file);
}

function saveStudyFileOfflineMulti(pathKey, postIndex, fileIndex) {
    const post = getStudyPost(globalPostsData, postIndex);
    const file = studyArray(post?.files)[fileIndex];
    if (!file) return alert('❌ تعذر العثور على الملف.');
    const group = post?.contentType === 'lecture' ? 'lecture' : 'file';
    const mediaKey = `${pathKey}_${post?.id || postIndex}_${group}_${fileIndex}`;
    saveStudyFileObjectOffline(file, mediaKey);
}

function openAssignmentFilePreview(pathKey, lectureIndex, assignmentId, fileIndex) {
    const file = findStudyFile(pathKey, lectureIndex, 'assignment', assignmentId, fileIndex);
    if (file) file.mediaKey = `${pathKey}_${lectureIndex}_${assignmentId}_assignment_${fileIndex}`;
    openStudyFileObjectPreview(file);
}

function saveAssignmentFileOffline(pathKey, lectureIndex, assignmentId, fileIndex) {
    const file = findStudyFile(pathKey, lectureIndex, 'assignment', assignmentId, fileIndex);
    if (!file) return alert('❌ تعذر العثور على الملف.');
    saveStudyFileObjectOffline(file, `${pathKey}_${lectureIndex}_${assignmentId}_assignment_${fileIndex}`);
}

function openCompletionFilePreview(pathKey, lectureIndex, assignmentId, completionId, fileIndex) {
    const file = findStudyFile(pathKey, lectureIndex, 'completion', { assignmentId, completionId }, fileIndex);
    if (file) file.mediaKey = `${pathKey}_${lectureIndex}_${assignmentId}_${completionId}_completion_${fileIndex}`;
    openStudyFileObjectPreview(file);
}

function saveCompletionFileOffline(pathKey, lectureIndex, assignmentId, completionId, fileIndex) {
    const file = findStudyFile(pathKey, lectureIndex, 'completion', { assignmentId, completionId }, fileIndex);
    if (!file) return alert('❌ تعذر العثور على الملف.');
    saveStudyFileObjectOffline(file, `${pathKey}_${lectureIndex}_${assignmentId}_${completionId}_completion_${fileIndex}`);
}

function openCreateFolderModal() {
    if (!isStudyAdmin()) {
        alert('⚠️ هذه الخاصية متاحة فقط لمدير النظام.');
        return;
    }
    document.getElementById('newFolderName').value = '';
    document.getElementById('newFolderDescription').value = '';
    const type = document.getElementById('newFolderType');
    if (type) type.value = 'normal';
    document.getElementById('createFolderModal').classList.add('active');
}

async function confirmCreateFolder() {
    if (!isStudyAdmin()) return;
    const name = document.getElementById('newFolderName')?.value.trim();
    const description = document.getElementById('newFolderDescription')?.value.trim() || '';
    const folderType = document.getElementById('newFolderType')?.value || 'normal';
    if (!name) {
        alert('⚠️ يرجى إدخال اسم المجلد.');
        return;
    }
    if (!isOnline || !studyDb) {
        alert('⚠️ يتطلب إنشاء المجلد اتصالاً بالإنترنت.');
        return;
    }
    const pathKey = getPathKey(currentStudyPath);
    try {
        const result = await fetchAndMergeStudyFolder(pathKey);
        const data = result?.data || { folders: [], posts: [] };
        data.folders = studyArray(data.folders);
        if (data.folders.some(folder => (typeof folder === 'object' ? folder.name : folder) === name)) {
            alert('⚠️ يوجد مجلد بهذا الاسم بالفعل.');
            return;
        }
        const descriptor = { name, description, type: folderType };
        data.folders.push(descriptor);
        await persistStudyFolder(pathKey, data);

        const childPath = `${pathKey}/${name}`;
        let childData = { folders: [], posts: [], folderType, folderName: name, folderDescription: description };
        if (folderType === 'study') {
            childData = ensureLecturePosts(childData, name).data;
        }
        await studyDb.ref(`study_materials/${childPath}`).set(studyStripTransient(childData));
        await cacheFolderData(childPath, childData);
        closeModal('createFolderModal');
        await loadCurrentFolder();
        await addStudyServerNotification({
            type: 'folder_created',
            title: folderType === 'study' ? '📚 مادة دراسية جديدة' : '📁 مجلد جديد',
            message: `تم إنشاء ${folderType === 'study' ? 'مادة دراسية تحتوي على 15 محاضرة' : 'مجلد'}: ${name}`,
            path: pathKey,
            folderName: name
        });
        alert(folderType === 'study'
            ? '✅ تم إنشاء مجلد المادة وإضافة 15 محاضرة تلقائياً.'
            : '✅ تم إنشاء المجلد بنجاح.');
    } catch (error) {
        console.error('خطأ في إنشاء المجلد:', error);
        alert(`❌ تعذر إنشاء المجلد: ${error.message}`);
    }
}

function openLectureFileModal(lectureIndex) {
    if (!canUserAddContent()) {
        alert('⚠️ يجب تسجيل الدخول لإدراج ملف.');
        return;
    }
    currentLectureIndex = lectureIndex;
    document.getElementById('lectureFileTitle').value = '';
    document.getElementById('lectureFileDescription').value = '';
    document.getElementById('lectureFiles').value = '';
    document.getElementById('lectureFileModal').classList.add('active');
}

async function confirmLectureFiles() {
    const input = document.getElementById('lectureFiles');
    if (currentLectureIndex === null || !input?.files?.length) {
        alert('⚠️ اختر ملفاً واحداً على الأقل.');
        return;
    }
    if (!isOnline || !studyDb) {
        alert('⚠️ يتطلب إدراج الملفات اتصالاً بالإنترنت.');
        return;
    }
    const pathKey = getPathKey(currentStudyPath);
    const title = document.getElementById('lectureFileTitle')?.value.trim() || '';
    const description = document.getElementById('lectureFileDescription')?.value.trim() || '';
    try {
        const uploaded = await uploadStudyFiles(input, title);
        const data = (await getStudyCachedData(pathKey)) || globalPostsData || {};
        const ensured = ensureLecturePosts(data, studyFolderNameForPath(currentStudyPath));
        const post = getStudyPost(ensured.data, currentLectureIndex);
        if (!post) throw new Error('تعذر تحديد المحاضرة');
        post.files = studyArray(post.files);
        uploaded.forEach(file => {
            file.entryTitle = title;
            file.entryDescription = description;
            file.user = studyUserLabel(getStudyUser());
            file.timestamp = Date.now();
            post.files.push(file);
        });
        await persistStudyFolder(pathKey, ensured.data);
        await saveUploadedFilesLocally(uploaded, pathKey, post.id || currentLectureIndex, 'lecture', post.files.length - uploaded.length);
        closeModal('lectureFileModal');
        currentLectureIndex = null;
        await loadCurrentFolder();
        await addStudyServerNotification({
            type: 'lecture_file_added',
            title: '📖 إدراج جديد في المحاضرات',
            message: `تم إدراج ملف جديد في ${post.title || 'محاضرة'}`,
            path: pathKey
        });
    } catch (error) {
        console.error('خطأ في إدراج ملفات المحاضرة:', error);
        alert(`❌ تعذر إدراج الملفات: ${error.message}`);
    }
}

async function saveUploadedFilesLocally(files, pathKey, ownerId, group, startIndex = 0) {
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (file.fileBlob instanceof Blob) {
            const mediaKey = `${pathKey}_${ownerId}_${group}_${startIndex + index}`;
            await saveMediaToIDB(mediaKey, file.fileBlob, studyFileType(file), studyFileName(file));
        }
    }
    await updateStorageIndicator();
}

function openAssignmentModal(lectureIndex) {
    if (!canUserAddContent()) {
        alert('⚠️ يجب تسجيل الدخول لإضافة تكليف.');
        return;
    }
    currentLectureIndex = lectureIndex;
    document.getElementById('assignmentTitle').value = '';
    document.getElementById('assignmentDetails').value = '';
    document.getElementById('assignmentFiles').value = '';
    document.getElementById('assignmentDuration').value = '1w';
    toggleCustomDeadline();
    document.getElementById('assignmentModal').classList.add('active');
}

function toggleCustomDeadline() {
    const custom = document.getElementById('customDeadlineFields');
    const select = document.getElementById('assignmentDuration');
    if (custom) custom.hidden = select?.value !== 'custom';
}

function getAssignmentDurationMs() {
    const preset = document.getElementById('assignmentDuration')?.value || '1w';
    if (preset === '1d') return 24 * 60 * 60 * 1000;
    if (preset === '2d') return 2 * 24 * 60 * 60 * 1000;
    if (preset === '1w') return 7 * 24 * 60 * 60 * 1000;
    const value = Math.max(1, Number(document.getElementById('customDeadlineValue')?.value || 1));
    const unit = document.getElementById('customDeadlineUnit')?.value || 'days';
    const unitMs = {
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        weeks: 7 * 24 * 60 * 60 * 1000,
        months: 30 * 24 * 60 * 60 * 1000
    };
    return value * (unitMs[unit] || unitMs.days);
}

async function confirmCreateAssignment() {
    const title = document.getElementById('assignmentTitle')?.value.trim();
    const details = document.getElementById('assignmentDetails')?.value.trim() || '';
    const input = document.getElementById('assignmentFiles');
    if (!title && !details && !input?.files?.length) {
        alert('⚠️ أدخل عنواناً أو تفاصيل أو أرفق ملفاً.');
        return;
    }
    if (currentLectureIndex === null || !isOnline || !studyDb) {
        alert('⚠️ يتطلب نشر التكليف اتصالاً بالإنترنت.');
        return;
    }
    const pathKey = getPathKey(currentStudyPath);
    try {
        const uploaded = input?.files?.length ? await uploadStudyFiles(input, title) : [];
        const data = (await getStudyCachedData(pathKey)) || globalPostsData || {};
        const ensured = ensureLecturePosts(data, studyFolderNameForPath(currentStudyPath));
        const post = getStudyPost(ensured.data, currentLectureIndex);
        if (!post) throw new Error('تعذر تحديد المحاضرة');
        const createdAt = Date.now();
        const assignment = {
            id: `assignment_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
            title: title || 'تكليف جديد',
            details,
            files: uploaded.map(file => ({
                ...file,
                user: studyUserLabel(getStudyUser()),
                timestamp: createdAt
            })),
            userName: studyUserLabel(getStudyUser()),
            createdAt,
            deadlineAt: createdAt + getAssignmentDurationMs(),
            completions: []
        };
        post.assignments = studyArray(post.assignments);
        post.assignments.push(assignment);
        await persistStudyFolder(pathKey, ensured.data);
        await saveUploadedFilesLocally(uploaded, pathKey, `${currentLectureIndex}_${assignment.id}`, 'assignment', 0);
        closeModal('assignmentModal');
        currentLectureIndex = null;
        await loadCurrentFolder();
        await addStudyServerNotification({
            type: 'assignment_created',
            title: '📌 تكليف جديد',
            message: `تم نشر تكليف جديد: ${assignment.title}`,
            path: pathKey
        });
    } catch (error) {
        console.error('خطأ في نشر التكليف:', error);
        alert(`❌ تعذر نشر التكليف: ${error.message}`);
    }
}

function openCompletionModal(pathKey, lectureIndex, assignmentId) {
    const data = globalPostsData || {};
    const assignment = getStudyAssignment(data, lectureIndex, assignmentId);
    if (!assignment) {
        alert('❌ تعذر العثور على التكليف.');
        return;
    }
    const user = getStudyUser();
    const userId = user?.phone || user?.id || studyUserLabel(user);
    if (studyArray(assignment.completions).some(item => String(item.userId || item.user || '') === String(userId))) {
        alert('✅ تم تسجيل إنجازك لهذا التكليف مسبقاً.');
        return;
    }
    currentCompletionContext = { pathKey, lectureIndex, assignmentId };
    document.getElementById('completionFiles').value = '';
    document.getElementById('completionPrompt').textContent =
        `التكليف: ${assignment.title || 'بدون عنوان'} — أرفق التقرير اختيارياً ثم أكد الإنجاز.`;
    document.getElementById('completionModal').classList.add('active');
}

async function completeAssignment(pathKey, lectureIndex, assignmentId) {
    const data = globalPostsData || {};
    const assignment = getStudyAssignment(data, lectureIndex, assignmentId);
    if (!assignment) return;
    const user = getStudyUser();
    if (!user) {
        alert('⚠️ يجب تسجيل الدخول لتسجيل إنجاز التكليف.');
        return;
    }
    const answer = confirm('هل تريد إدراج محتوى التكليف المنجز؟\nاضغط «موافق» لاختيار ملف التقرير، أو «إلغاء» لتسجيل الإنجاز بدون ملف.');
    if (answer) {
        openCompletionModal(pathKey, lectureIndex, assignmentId);
    } else {
        await saveAssignmentCompletion(pathKey, lectureIndex, assignmentId, []);
    }
}

async function confirmAssignmentCompletion() {
    if (!currentCompletionContext) return;
    const input = document.getElementById('completionFiles');
    try {
        const files = input?.files?.length ? await uploadStudyFiles(input, 'إنجاز تكليف') : [];
        await saveAssignmentCompletion(
            currentCompletionContext.pathKey,
            currentCompletionContext.lectureIndex,
            currentCompletionContext.assignmentId,
            files
        );
        closeModal('completionModal');
        currentCompletionContext = null;
    } catch (error) {
        console.error('خطأ في تسجيل إنجاز التكليف:', error);
        alert(`❌ تعذر تسجيل الإنجاز: ${error.message}`);
    }
}

async function saveAssignmentCompletion(pathKey, lectureIndex, assignmentId, uploadedFiles) {
    if (!isOnline || !studyDb) {
        alert('⚠️ يتطلب تسجيل الإنجاز اتصالاً بالإنترنت.');
        return;
    }
    const data = (await getStudyCachedData(pathKey)) || globalPostsData || {};
    const assignment = getStudyAssignment(data, lectureIndex, assignmentId);
    const user = getStudyUser();
    if (!assignment || !user) throw new Error('تعذر تحديد التكليف أو المستخدم');
    const userId = user.phone || user.id || studyUserLabel(user);
    assignment.completions = studyArray(assignment.completions);
    if (assignment.completions.some(item => String(item.userId || item.user || '') === String(userId))) {
        alert('✅ تم تسجيل إنجازك لهذا التكليف مسبقاً.');
        return;
    }
    const completionId = `completion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const completion = {
        id: completionId,
        userId: String(userId),
        userName: studyUserLabel(user),
        timestamp: Date.now(),
        files: uploadedFiles.map(file => ({
            ...file,
            user: studyUserLabel(user),
            timestamp: Date.now()
        }))
    };
    assignment.completions.push(completion);
    await persistStudyFolder(pathKey, data);
    await saveUploadedFilesLocally(
        uploadedFiles,
        pathKey,
        `${lectureIndex}_${assignmentId}_${completionId}`,
        'completion',
        0
    );
    await loadCurrentFolder();
    await addStudyServerNotification({
        type: 'assignment_completed',
        title: '✅ تم إنجاز تكليف',
        message: `أنجز ${completion.userName} التكليف: ${assignment.title || 'بدون عنوان'}`,
        path: pathKey
    });
}

async function addStudyServerNotification(notification) {
    const completeNotification = {
        ...notification,
        timestamp: notification.timestamp || Date.now(),
        read: false
    };
    addNotification(completeNotification);
    if (studyDb && isOnline) {
        try {
            await studyDb.ref('notifications').push(completeNotification);
        } catch (error) {
            console.warn('تعذر مزامنة إشعار المادة:', error);
        }
    }
    if (notification.type === 'assignment_created') {
        sendFCMNotificationToAll(notification.title, notification.message, {
            type: notification.type,
            path: notification.path
        });
    }
}

function updateAssignmentCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach(element => {
        const card = element.closest('[data-assignment-card]');
        const deadlineAt = Number(card?.dataset.deadline || 0);
        const info = assignmentRemaining(deadlineAt);
        element.textContent = info.label;
        element.className = `assignment-deadline ${info.state}`;
        if (card) {
            card.classList.remove('safe', 'warning', 'danger', 'expired');
            card.classList.add(info.state);
        }
    });
}

function checkUrgentAssignments() {
    if (!isStudyFolderData(globalPostsData)) return;
    const user = getStudyUser();
    const userId = user?.phone || user?.id || studyUserLabel(user);
    const now = Date.now();
    studyArray(globalPostsData.posts).forEach((post, lectureIndex) => {
        studyArray(post?.assignments).forEach(assignment => {
            const remaining = Number(assignment.deadlineAt || 0) - now;
            const completed = studyArray(assignment.completions)
                .some(item => String(item.userId || item.user || '') === String(userId));
            if (remaining <= 0 || remaining > 3 * 24 * 60 * 60 * 1000 || completed) return;
            const key = `study_urgent_${assignment.id}`;
            const lastNotice = Number(localStorage.getItem(key) || 0);
            if (now - lastNotice < 12 * 60 * 60 * 1000) return;
            try { localStorage.setItem(key, String(now)); } catch (error) {}
            addNotification({
                type: 'assignment_urgent',
                title: '🚨 تكليف طارئ',
                message: `تبقى ${assignmentRemaining(assignment.deadlineAt).label.replace('متبقي ', '')} على تسليم "${assignment.title || 'التكليف'}"`,
                path: getPathKey(currentStudyPath),
                lectureIndex,
                assignmentId: assignment.id,
                timestamp: now
            });
        });
    });
}

function navigateToAssignment(pathKey, lectureIndex, assignmentId) {
    navigateTo(pathKey);
    setTimeout(() => {
        const card = document.querySelector(`[data-assignment-card="${studyDomKey(`${pathKey}_${lectureIndex}_${assignmentId}`)}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.boxShadow = '0 0 35px rgba(239,68,68,.35)';
            setTimeout(() => { card.style.boxShadow = ''; }, 3000);
        }
    }, 500);
}

function updateButtons() {
    const isRoot = currentStudyPath.length === 0;
    const btnBack = document.getElementById('btnBack');
    const btnAddFolder = document.getElementById('btnAddFolder');
    const btnAddPost = document.getElementById('btnAddPost');
    if (btnBack) btnBack.style.display = isRoot ? 'none' : 'inline-flex';
    if (btnAddFolder) btnAddFolder.style.display = isStudyAdmin() ? 'inline-flex' : 'none';
    const isStudy = isStudyFolderData(globalPostsData);
    if (btnAddPost) {
        btnAddPost.style.display = !isRoot && !isStudy && isLeafFolder(currentStudyPath) && canUserAddContent()
            ? 'inline-flex' : 'none';
    }
}

async function refreshData() {
    if (!isOnline || !studyDb) {
        alert('⚠️ أنت غير متصل بالإنترنت أو أن قاعدة البيانات غير متاحة.');
        return;
    }
    const button = document.getElementById('btnRefreshData');
    const original = button?.innerHTML || '🔄 تحديث';
    if (button) {
        button.disabled = true;
        button.innerHTML = '⏳ جلب الجديد...';
    }
    try {
        const pathKey = getPathKey(currentStudyPath);
        const result = await fetchAndMergeStudyFolder(pathKey);
        if (result?.changed) {
            globalPostsData = result.data;
            renderFolderContent(result.data);
            updateItemCount(result.data);
            checkUrgentAssignments();
            alert('✅ تمت إضافة التغييرات والمنشورات الجديدة فقط.');
        } else {
            alert('✅ لا توجد منشورات أو تغييرات جديدة.');
        }
    } catch (error) {
        console.error('خطأ تحديث مواد الدراسة:', error);
        alert(`❌ تعذر تحديث البيانات: ${error.message}`);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = original;
        }
    }
}

function startPeriodicCacheUpdate() {
    setInterval(async () => {
        if (!isOnline || !studyDb) return;
        const pathKey = getPathKey(currentStudyPath);
        await refreshFolderInBackground(pathKey);
    }, 5 * 60 * 1000);
}

/* ========================================================================
   📚 تفاعل بطاقات المحاضرات وتعليقات المستخدمين والدردشة الجماعية
   ======================================================================== */
let currentLectureCommentsContext = null;
const lectureCommentsListeners = new Map();
let groupChatMessages = [];
let groupChatLectureOptions = [];
let groupChatListener = null;
let groupChatComposerBound = false;

function toggleLectureCard(event, lectureNumber) {
    event?.stopPropagation?.();
    const card = document.getElementById(`lectureCard-${Number(lectureNumber)}`);
    const content = document.getElementById(`lectureContent-${Number(lectureNumber)}`);
    if (!card || !content) return;
    const willOpen = content.hidden;
    content.hidden = !willOpen;
    card.classList.toggle('is-open', willOpen);
    card.classList.toggle('collapsed', !willOpen);
    const header = card.querySelector('.lecture-header');
    const icon = card.querySelector('.lecture-toggle-icon');
    header?.setAttribute('aria-expanded', String(willOpen));
    if (icon) icon.textContent = willOpen ? '⌃' : '⌄';
}

function lectureCommentsStorageKey(pathKey, lectureId) {
    return `study_comments_${encodeURIComponent(`${pathKey}_${lectureId}`)}`;
}

function readLectureCommentsLocal(pathKey, lectureId) {
    try {
        const raw = localStorage.getItem(lectureCommentsStorageKey(pathKey, lectureId));
        const value = raw ? JSON.parse(raw) : [];
        return studyArray(value).filter(comment => comment?.text);
    } catch (error) {
        return [];
    }
}

function saveLectureCommentsLocal(pathKey, lectureId, comments) {
    try {
        localStorage.setItem(
            lectureCommentsStorageKey(pathKey, lectureId),
            JSON.stringify(studyArray(comments).slice(-300))
        );
    } catch (error) {
        console.warn('تعذر حفظ تعليقات المحاضرة محلياً:', error);
    }
}

function lectureCommentsPath(pathKey, lectureId) {
    return `study_material_comments/${pathKey}/${encodeURIComponent(String(lectureId))}`;
}

function mergeLectureComments(localComments, serverComments) {
    const merged = new Map();
    studyArray(localComments).forEach(comment => {
        if (comment?.id) merged.set(String(comment.id), comment);
    });
    studyArray(serverComments).forEach(comment => {
        if (comment?.id) merged.set(String(comment.id), { ...comment, pending: false });
    });
    return [...merged.values()]
        .filter(comment => comment?.text)
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
        .slice(-300);
}

function renderLectureComments(comments) {
    const list = document.getElementById('lectureCommentsList');
    if (!list) return;
    const items = studyArray(comments);
    if (!items.length) {
        list.innerHTML = '<div class="comments-empty">💬 لا توجد تعليقات بعد.<br>كن أول من يشارك رأيه في هذه المحاضرة.</div>';
        return;
    }
    list.innerHTML = items.map(comment => `
        <article class="comment-item">
            <div class="comment-meta">
                <span class="comment-author">👤 ${escapeHtml(comment.userName || comment.user || 'مستخدم')}</span>
                <span class="comment-time">${escapeHtml(studyDate(comment.timestamp))}</span>
            </div>
            <div class="comment-text">${escapeHtml(comment.text)}</div>
            ${comment.pending ? '<span class="comment-pending">⏳ محفوظ محلياً وسيتم نشره عند عودة الاتصال</span>' : ''}
        </article>
    `).join('');
    list.scrollTop = list.scrollHeight;
}

function attachLectureCommentsToCurrentPost(context, comments) {
    if (!context || getPathKey(currentStudyPath) !== context.pathKey) return;
    const post = getStudyPost(globalPostsData, context.lectureIndex);
    if (!post) return;
    post.comments = studyArray(comments);
    void cacheFolderData(context.pathKey, globalPostsData);
}

function listenToLectureComments(context) {
    if (!studyDb || !isOnline) return;
    const key = `${context.pathKey}|${context.lectureId}`;
    if (lectureCommentsListeners.has(key)) return;
    const ref = studyDb.ref(lectureCommentsPath(context.pathKey, context.lectureId));
    const listener = snapshot => {
        const serverComments = Object.entries(snapshot.val() || {}).map(([id, comment]) => ({
            ...comment,
            id
        }));
        const merged = mergeLectureComments(readLectureCommentsLocal(context.pathKey, context.lectureId), serverComments);
        saveLectureCommentsLocal(context.pathKey, context.lectureId, merged);
        attachLectureCommentsToCurrentPost(context, merged);
        if (currentLectureCommentsContext?.listenerKey === key) {
            currentLectureCommentsContext.comments = merged;
            renderLectureComments(merged);
        }
    };
    ref.on('value', listener, error => console.warn('تعذر متابعة تعليقات المحاضرة:', error));
    lectureCommentsListeners.set(key, { ref, listener });
}

async function syncPendingLectureComments(pathKey, lectureId) {
    if (!studyDb || !isOnline) return;
    const comments = readLectureCommentsLocal(pathKey, lectureId);
    const pending = comments.filter(comment => comment.pending);
    if (!pending.length) return;
    const remaining = [...comments];
    for (const comment of pending) {
        try {
            const ref = studyDb.ref(lectureCommentsPath(pathKey, lectureId)).push();
            const serverComment = { ...comment, id: ref.key };
            delete serverComment.pending;
            await ref.set(studyStripTransient(serverComment));
            const index = remaining.findIndex(item => item.id === comment.id);
            if (index >= 0) remaining.splice(index, 1, serverComment);
        } catch (error) {
            console.warn('تعذر مزامنة تعليق مؤجل:', error);
        }
    }
    saveLectureCommentsLocal(pathKey, lectureId, remaining);
    if (currentLectureCommentsContext?.pathKey === pathKey &&
        String(currentLectureCommentsContext.lectureId) === String(lectureId)) {
        currentLectureCommentsContext.comments = remaining;
        renderLectureComments(remaining);
    }
}

function openLectureComments(pathKey, lectureIndex, lectureId, title, lectureNumber) {
    currentLectureCommentsContext = {
        pathKey,
        lectureIndex,
        lectureId,
        lectureNumber,
        title,
        listenerKey: `${pathKey}|${lectureId}`,
        comments: readLectureCommentsLocal(pathKey, lectureId)
    };
    const titleElement = document.getElementById('commentsLectureTitle');
    const input = document.getElementById('newLectureComment');
    if (titleElement) titleElement.textContent = `📚 ${title || `المحاضرة رقم ${lectureNumber}`}`;
    if (input) input.value = '';
    renderLectureComments(currentLectureCommentsContext.comments);
    document.getElementById('lectureCommentsModal')?.classList.add('active');
    listenToLectureComments(currentLectureCommentsContext);
    void syncPendingLectureComments(pathKey, lectureId);
}

function closeLectureComments() {
    document.getElementById('lectureCommentsModal')?.classList.remove('active');
    currentLectureCommentsContext = null;
}

async function addLectureComment() {
    const context = currentLectureCommentsContext;
    const input = document.getElementById('newLectureComment');
    const text = input?.value.trim() || '';
    const user = getStudyUser();
    if (!context) return;
    if (!user) {
        alert('⚠️ يجب تسجيل الدخول حتى يظهر اسمك في التعليق.');
        return;
    }
    if (!text) {
        alert('⚠️ اكتب تعليقاً قبل النشر.');
        input?.focus();
        return;
    }

    const localComment = {
        id: `local_comment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId: String(user.id || user.phone || user.username || 'user'),
        userName: studyUserLabel(user),
        text,
        timestamp: Date.now(),
        pending: !(isOnline && studyDb)
    };
    const next = mergeLectureComments(
        readLectureCommentsLocal(context.pathKey, context.lectureId),
        [localComment]
    );
    saveLectureCommentsLocal(context.pathKey, context.lectureId, next);
    context.comments = next;
    attachLectureCommentsToCurrentPost(context, next);
    renderLectureComments(next);
    if (input) input.value = '';

    if (isOnline && studyDb) {
        try {
            const ref = studyDb.ref(lectureCommentsPath(context.pathKey, context.lectureId)).push();
            const published = { ...localComment, id: ref.key };
            delete published.pending;
            await ref.set(studyStripTransient(published));
            const publishedComments = readLectureCommentsLocal(context.pathKey, context.lectureId)
                .filter(comment => comment.id !== localComment.id);
            publishedComments.push(published);
            const merged = mergeLectureComments(publishedComments, []);
            saveLectureCommentsLocal(context.pathKey, context.lectureId, merged);
            context.comments = merged;
            renderLectureComments(merged);
        } catch (error) {
            console.warn('تعذر نشر التعليق، سيبقى محفوظاً محلياً:', error);
            alert('⚠️ تعذر الاتصال حالياً، تم حفظ التعليق محلياً وسيُنشر عند عودة الاتصال.');
        }
    } else {
        alert('📦 لا يوجد اتصال حالياً، تم حفظ التعليق محلياً.');
    }
}

function groupChatStorageKey() {
    return 'study_group_chat_messages';
}

function cleanGroupChatMessage(message) {
    return {
        id: message.id,
        senderId: String(message.senderId || ''),
        senderName: message.senderName || 'مستخدم',
        text: message.text || '',
        timestamp: Number(message.timestamp || Date.now()),
        pending: Boolean(message.pending),
        lectureRef: message.lectureRef || null,
        files: studyArray(message.files).map(file => {
            const clean = { ...file };
            delete clean.fileBlob;
            delete clean.blob;
            return clean;
        })
    };
}

function readGroupChatLocal() {
    try {
        const raw = localStorage.getItem(groupChatStorageKey());
        return raw ? studyArray(JSON.parse(raw)) : [];
    } catch (error) {
        return [];
    }
}

function saveGroupChatLocal(messages) {
    try {
        localStorage.setItem(
            groupChatStorageKey(),
            JSON.stringify(studyArray(messages).map(cleanGroupChatMessage).slice(-200))
        );
    } catch (error) {
        console.warn('تعذر حفظ الدردشة محلياً:', error);
    }
}

function mergeGroupChatMessages(localMessages, serverMessages) {
    const merged = new Map();
    studyArray(localMessages).forEach(message => {
        if (message?.id) merged.set(String(message.id), message);
    });
    studyArray(serverMessages).forEach(message => {
        if (message?.id) merged.set(String(message.id), { ...message, pending: false });
    });
    return [...merged.values()]
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
        .slice(-200);
}

function renderGroupChatMessages() {
    const container = document.getElementById('groupChatMessages');
    if (!container) return;
    if (!groupChatMessages.length) {
        container.innerHTML = '<div class="chat-empty-state">💬<br>لا توجد رسائل بعد<br><small>ابدأ محادثة مع زملائك</small></div>';
        return;
    }
    const user = getStudyUser();
    const currentUserId = String(user?.id || user?.phone || user?.username || '');
    container.innerHTML = groupChatMessages.map(message => {
        const own = currentUserId && String(message.senderId) === currentUserId;
        const files = studyArray(message.files);
        return `
            <article class="chat-message ${own ? 'own' : ''}">
                <div class="chat-sender">${escapeHtml(message.senderName || 'مستخدم')}</div>
                ${message.text ? `<div class="chat-text">${escapeHtml(message.text)}</div>` : ''}
                ${message.lectureRef ? `
                    <div class="chat-mention-card">
                        <span class="chat-mention-label">📚 ${escapeHtml(message.lectureRef.title || `المحاضرة ${message.lectureRef.lectureNumber || ''}`)}</span>
                        <button class="chat-mention-open" onclick="goToChatLecture(${studySafeJs(message.id)})">فتح المحاضرة ↗</button>
                    </div>` : ''}
                ${files.length ? `
                    <div class="chat-attachments">
                        ${files.map((file, index) => `
                            <button class="chat-attachment" onclick="openGroupChatMedia(${studySafeJs(message.id)}, ${index})">
                                📎 ${escapeHtml(studyFileName(file))}
                            </button>
                        `).join('')}
                    </div>` : ''}
                <span class="chat-time">${escapeHtml(studyDate(message.timestamp))}</span>
                ${message.pending ? '<span class="chat-pending">⏳ محفوظ محلياً</span>' : ''}
            </article>
        `;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function listenToGroupChat() {
    if (!studyDb || !isOnline || groupChatListener) return;
    const ref = studyDb.ref('study_group_chat/messages').limitToLast(200);
    const listener = snapshot => {
        const serverMessages = Object.entries(snapshot.val() || {}).map(([id, message]) => ({
            ...message,
            id
        }));
        groupChatMessages = mergeGroupChatMessages(readGroupChatLocal(), serverMessages);
        saveGroupChatLocal(groupChatMessages);
        renderGroupChatMessages();
        const status = document.getElementById('groupChatStatus');
        if (status) status.textContent = 'متصل · الدردشة مشتركة بين جميع المستخدمين';
    };
    ref.on('value', listener, error => {
        console.warn('تعذر متابعة الدردشة الجماعية:', error);
        const status = document.getElementById('groupChatStatus');
        if (status) status.textContent = 'تعذر الاتصال · عرض الرسائل المحلية';
    });
    groupChatListener = { ref, listener };
}

async function syncPendingGroupChatMessages() {
    if (!studyDb || !isOnline) return;
    const pending = readGroupChatLocal().filter(message => message.pending && !studyArray(message.files).length);
    if (!pending.length) return;
    const current = readGroupChatLocal();
    for (const message of pending) {
        try {
            const ref = studyDb.ref('study_group_chat/messages').push();
            const published = { ...cleanGroupChatMessage(message), id: ref.key };
            delete published.pending;
            await ref.set(published);
            const index = current.findIndex(item => item.id === message.id);
            if (index >= 0) current.splice(index, 1, published);
        } catch (error) {
            console.warn('تعذر مزامنة رسالة دردشة مؤجلة:', error);
        }
    }
    groupChatMessages = mergeGroupChatMessages(current, []);
    saveGroupChatLocal(groupChatMessages);
    renderGroupChatMessages();
}

async function prepareGroupChatLectureOptions() {
    const options = [];
    const seen = new Set();
    const addPosts = (data, pathKey) => {
        studyArray(data?.posts)
            .filter(post => Number(post?.lectureNumber) >= 1 && Number(post?.lectureNumber) <= 15)
            .forEach(post => {
                const identity = `${pathKey}|${post.id || post.lectureNumber}`;
                if (seen.has(identity)) return;
                seen.add(identity);
                options.push({
                    path: pathKey,
                    postId: post.id || post.lectureNumber,
                    lectureNumber: Number(post.lectureNumber),
                    title: post.title || getLectureTitle(Number(post.lectureNumber))
                });
            });
    };

    if (isStudyFolderData(globalPostsData)) {
        addPosts(globalPostsData, getPathKey(currentStudyPath));
    }
    try {
        const cached = await listStudyCachedFolders();
        cached.forEach((data, pathKey) => addPosts(data, pathKey));
    } catch (error) {}

    groupChatLectureOptions = options.sort((a, b) =>
        `${a.path}|${a.lectureNumber}`.localeCompare(`${b.path}|${b.lectureNumber}`, 'ar')
    );
    const select = document.getElementById('chatLectureMention');
    if (!select) return;
    select.innerHTML = '<option value="">بدون إشارة</option>' +
        groupChatLectureOptions.map((option, index) =>
            `<option value="${index}">📚 ${escapeHtml(option.title)} · ${escapeHtml(option.path.replace('root/', ''))}</option>`
        ).join('');
}

function syncChatSelectedFiles() {
    const input = document.getElementById('groupChatFiles');
    const output = document.getElementById('chatSelectedFiles');
    if (!input || !output) return;
    const files = Array.from(input.files || []);
    output.textContent = files.length
        ? `📎 ${files.length} ملف محدد: ${files.map(file => file.name).join('، ')}`
        : '';
}

function bindGroupChatComposer() {
    if (groupChatComposerBound) return;
    groupChatComposerBound = true;
    document.getElementById('groupChatFiles')?.addEventListener('change', syncChatSelectedFiles);
    document.getElementById('groupChatInput')?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendGroupChatMessage();
        }
    });
}

async function openGroupChatPanel() {
    const panel = document.getElementById('groupChatPanel');
    const overlay = document.getElementById('groupChatOverlay');
    if (!panel || !overlay) return;
    if (isNotificationsPanelOpen) toggleNotificationsPanel();
    panel.classList.add('open');
    overlay.classList.add('open');
    groupChatMessages = readGroupChatLocal();
    renderGroupChatMessages();
    bindGroupChatComposer();
    await prepareGroupChatLectureOptions();
    listenToGroupChat();
    await syncPendingGroupChatMessages();
    const status = document.getElementById('groupChatStatus');
    if (status && !isOnline) status.textContent = 'أوفلاين · عرض الرسائل المحفوظة محلياً';
}

function closeGroupChatPanel() {
    document.getElementById('groupChatPanel')?.classList.remove('open');
    document.getElementById('groupChatOverlay')?.classList.remove('open');
}

function toggleGroupChatPanel() {
    const panel = document.getElementById('groupChatPanel');
    if (panel?.classList.contains('open')) {
        closeGroupChatPanel();
    } else {
        void openGroupChatPanel();
    }
}

async function sendGroupChatMessage() {
    const input = document.getElementById('groupChatInput');
    const fileInput = document.getElementById('groupChatFiles');
    const mentionSelect = document.getElementById('chatLectureMention');
    const user = getStudyUser();
    const text = input?.value.trim() || '';
    const selectedFiles = Array.from(fileInput?.files || []);
    if (!user) {
        alert('⚠️ يجب تسجيل الدخول للمشاركة في الدردشة الجماعية.');
        return;
    }
    if (!text && !selectedFiles.length && !mentionSelect?.value) {
        input?.focus();
        return;
    }
    if (selectedFiles.length && (!isOnline || !studyDb)) {
        alert('⚠️ رفع وسائط الدردشة يحتاج اتصالاً بالإنترنت.');
        return;
    }

    const localId = `local_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let uploaded = [];
    if (selectedFiles.length) {
        uploaded = await uploadStudyFiles(fileInput, 'وسائط الدردشة الجماعية');
    }
    const selectedMention = mentionSelect?.value ? groupChatLectureOptions[Number(mentionSelect.value)] : null;
    const message = {
        id: localId,
        senderId: String(user.id || user.phone || user.username || 'user'),
        senderName: studyUserLabel(user),
        text,
        timestamp: Date.now(),
        pending: !(isOnline && studyDb),
        lectureRef: selectedMention ? { ...selectedMention } : null,
        files: uploaded.map((file, index) => ({
            ...file,
            mediaKey: `group-chat_${localId}_${index}`
        }))
    };

    if (!isOnline || !studyDb) {
        groupChatMessages = mergeGroupChatMessages(readGroupChatLocal(), [message]);
        saveGroupChatLocal(groupChatMessages);
        renderGroupChatMessages();
        if (input) input.value = '';
        if (mentionSelect) mentionSelect.value = '';
        if (fileInput) fileInput.value = '';
        syncChatSelectedFiles();
        return;
    }

    try {
        const ref = studyDb.ref('study_group_chat/messages').push();
        const published = {
            ...cleanGroupChatMessage(message),
            id: ref.key,
            pending: false,
            files: message.files.map((file, index) => ({
                ...file,
                mediaKey: `group-chat_${ref.key}_${index}`
            }))
        };
        await ref.set(published);
        uploaded.forEach((file, index) => {
            file.mediaKey = `group-chat_${ref.key}_${index}`;
        });
        await saveUploadedFilesLocally(uploaded, 'group-chat', ref.key, 'chat', 0);
        groupChatMessages = mergeGroupChatMessages(readGroupChatLocal(), [published]);
        saveGroupChatLocal(groupChatMessages);
        renderGroupChatMessages();
        if (input) input.value = '';
        if (mentionSelect) mentionSelect.value = '';
        if (fileInput) fileInput.value = '';
        syncChatSelectedFiles();
    } catch (error) {
        console.error('تعذر نشر رسالة الدردشة:', error);
        alert(`❌ تعذر نشر الرسالة: ${error.message}`);
    }
}

function openGroupChatMedia(messageId, fileIndex) {
    const message = groupChatMessages.find(item => String(item.id) === String(messageId));
    const file = studyArray(message?.files)[fileIndex];
    if (!file) return;
    file.mediaKey = file.mediaKey || `group-chat_${messageId}_${fileIndex}`;
    openStudyFileObjectPreview(file);
}

function goToChatLecture(messageId) {
    const message = groupChatMessages.find(item => String(item.id) === String(messageId));
    const lecture = message?.lectureRef;
    if (!lecture?.path) return;
    closeGroupChatPanel();
    navigateTo(lecture.path);
    setTimeout(() => {
        const card = document.getElementById(`lectureCard-${Number(lecture.lectureNumber)}`);
        if (card) {
            if (!card.classList.contains('is-open')) toggleLectureCard(null, lecture.lectureNumber);
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.boxShadow = '0 0 35px rgba(56,189,248,.45)';
            setTimeout(() => { card.style.boxShadow = ''; }, 2500);
        }
    }, 600);
}

async function initStudyApp() {
    console.log('🚀 بدء تهيئة منظومة المواد الدراسية...');
    const previewReturn = consumeStudyPreviewReturn();
    initFirebase();
    try {
        localStorage.removeItem('study_current_path');
        localStorage.removeItem('study_browse_state');
    } catch (error) {}

    const user = getStudyUser();
    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay) userDisplay.textContent = `👤 ${studyUserLabel(user)}`;
    currentStudyPath = previewReturn?.path || [];
    globalPostsData = { folders: [], posts: [] };
    updateBreadcrumb();
    updateButtons();
    loadNotificationsFromStorage();
    await loadCurrentFolder();
    await updateStorageIndicator();
    updateStatusBar(isOnline ? '🌐 متصل' : '📡 غير متصل (أوفلاين)');
    initConnectionMonitoring();
    if (isOnline && studyDb) startNotificationListener();
    setTimeout(async () => {
        if (await requestNotificationPermission()) await initFCM();
    }, 2000);
    startRenderKeepAlive();
    startPeriodicCacheUpdate();
    assignmentCountdownTimer = setInterval(() => {
        updateAssignmentCountdowns();
        checkUrgentAssignments();
    }, 1000);
    handleUrlParams();
    restoreStudyPreviewReturn(previewReturn);
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            document.getElementById('searchInput')?.focus();
        }
        if (event.key === 'Escape') {
            ['createFolderModal', 'editFolderModal', 'createPostModal', 'editPostModal',
                'lectureFileModal', 'assignmentModal', 'completionModal'].forEach(closeModal);
            document.getElementById('uploadProgressOverlay')?.classList.remove('active');
            clearSearch();
        }
    });
    document.addEventListener('click', event => {
        if (event.target?.classList?.contains('modal-overlay-advanced')) {
            event.target.classList.remove('active');
        }
    });
}
