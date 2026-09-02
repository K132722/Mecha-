// ========================================================================
// 📚 STUDY MATERIALS - نظام المواد الدراسية المتطور V2 (مصحح)
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
let isFirstLoad = true;
let pendingUpdates = [];

// ========================================================================
// 2. إعدادات السيرفر
// ========================================================================
const TELEGRAM_SERVER_URL = "https://drive-shared-backend2.onrender.com";
const VAPID_KEY = 'BLiXP9SU05ttQ0-BLyJXQZ3DHwTwgc3t0U4Ld7yE4ZA2USu3LWdJWDXCRKYQwJPaz6yvOZKSrwYO6pSJKvK4mFs';

// ========================================================================
// 3. نظام التخزين المحلي الذكي (IndexedDB + localStorage)
// ========================================================================

function openIDB() {
    return new Promise((resolve, reject) => {
        if (idbInstance) {
            resolve(idbInstance);
            return;
        }
        const req = indexedDB.open('StudyMaterialsDB_V2', 5);
        req.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains('media')) {
                idb.createObjectStore('media', { keyPath: 'key' });
            }
            if (!idb.objectStoreNames.contains('cache')) {
                idb.createObjectStore('cache', { keyPath: 'key' });
            }
            if (!idb.objectStoreNames.contains('submissions')) {
                idb.createObjectStore('submissions', { keyPath: 'key' });
            }
            if (!idb.objectStoreNames.contains('assignments')) {
                idb.createObjectStore('assignments', { keyPath: 'key' });
            }
        };
        req.onsuccess = () => {
            idbInstance = req.result;
            resolve(idbInstance);
        };
        req.onerror = () => reject(req.error);
    });
}

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

// ========================================================================
// 4. نظام التخزين المؤقت الذكي
// ========================================================================

async function cacheFolderData(pathKey, data) {
    try {
        localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(data));
        await saveCacheToIDB(`folder_${pathKey}`, data);
        return true;
    } catch (err) {
        console.warn('Failed to cache folder data:', err);
        return false;
    }
}

async function getCachedFolderData(pathKey) {
    try {
        const localData = localStorage.getItem(`study_cache_${pathKey}`);
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                if (parsed && typeof parsed === 'object') {
                    return parsed;
                }
            } catch (e) {}
        }
        
        const idbData = await getCacheFromIDB(`folder_${pathKey}`);
        if (idbData) {
            localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(idbData));
            return idbData;
        }
        
        return null;
    } catch (err) {
        console.warn('Failed to get cached folder data:', err);
        return null;
    }
}

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

async function incrementalUpdate(pathKey, serverData) {
    try {
        let localData = await getCachedFolderData(pathKey);
        if (!localData) {
            localData = { folders: [], posts: [] };
        }

        const localPostIds = new Set();
        const localFolderNames = new Set();
        
        if (localData.posts) {
            localData.posts.forEach(p => {
                if (p.id) localPostIds.add(p.id);
            });
        }
        if (localData.folders) {
            localData.folders.forEach(f => {
                const name = typeof f === 'object' ? f.name : f;
                localFolderNames.add(name);
            });
        }

        let newPosts = [];
        let newFolders = [];
        let updated = false;

        if (serverData.posts) {
            serverData.posts.forEach(post => {
                if (!post.id || !localPostIds.has(post.id)) {
                    newPosts.push(post);
                    updated = true;
                }
            });
        }

        if (serverData.folders) {
            serverData.folders.forEach(folder => {
                const name = typeof folder === 'object' ? folder.name : folder;
                if (!localFolderNames.has(name)) {
                    newFolders.push(folder);
                    updated = true;
                }
            });
        }

        if (updated) {
            if (newPosts.length > 0) {
                if (!localData.posts) localData.posts = [];
                localData.posts = [...localData.posts, ...newPosts];
            }
            if (newFolders.length > 0) {
                if (!localData.folders) localData.folders = [];
                localData.folders = [...localData.folders, ...newFolders];
            }
            
            await cacheFolderData(pathKey, localData);
            globalPostsData = localData;
            
            renderFolderContent(localData);
            updateItemCount(localData);
            
            showToast(`📢 تم إضافة ${newPosts.length} منشور جديد و ${newFolders.length} مجلد جديد`);
            
            return true;
        } else {
            return false;
        }
    } catch (err) {
        console.warn('Incremental update failed:', err);
        return false;
    }
}

// ========================================================================
// 5. تهيئة Firebase والمستخدم
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
// 6. رفع الملفات إلى سيرفر تلجرام
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

// ========================================================================
// 7. التنقل والمجلدات
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

function getFolderType(pathArray) {
    const pathKey = getPathKey(pathArray);
    try {
        const cached = localStorage.getItem(`study_cache_${pathKey}`);
        if (cached) {
            const data = JSON.parse(cached);
            return data.folderType || 'normal';
        }
    } catch (e) {}
    return 'normal';
}

function isSubjectFolder(pathArray) {
    return getFolderType(pathArray) === 'subject';
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
    clearSearch();
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

function saveCurrentPath() {
    try {
        localStorage.setItem('study_current_path', JSON.stringify(currentStudyPath));
    } catch (e) {
        console.warn('فشل حفظ المسار:', e);
    }
}

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
// 8. تحديث واجهة المستخدم
// ========================================================================

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

function updateItemCount(data) {
    const countEl = document.getElementById('itemCount');
    if (!countEl) return;
    const total = (data.folders?.length || 0) + (data.posts?.length || 0);
    countEl.textContent = total;
}

async function updateStorageIndicator() {
    try {
        const size = await getIndexedDBSize();
        const quota = 5 * 1024 * 1024 * 1024;
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
// 9. تحميل وعرض المحتوى
// ========================================================================

async function loadCurrentFolder() {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="empty-state-advanced"><span class="empty-icon">⏳</span><h3>جاري التحميل...</h3></div>';

    const pathKey = getPathKey(currentStudyPath);
    let data = null;

    try {
        const localData = localStorage.getItem(`study_cache_${pathKey}`);
        if (localData) {
            data = JSON.parse(localData);
            console.log('✅ تم تحميل البيانات من localStorage:', pathKey);
        }
    } catch (e) {
        console.warn('فشل تحميل من localStorage:', e);
    }

    if (!data) {
        try {
            const idbData = await getCacheFromIDB(`folder_${pathKey}`);
            if (idbData) {
                data = idbData;
                console.log('✅ تم تحميل البيانات من IndexedDB:', pathKey);
                localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(data));
            }
        } catch (e) {
            console.warn('فشل تحميل من IndexedDB:', e);
        }
    }

    if (data && data.posts) {
        globalPostsData = data;
        renderFolderContent(data);
        updateItemCount(data);
        updateStatusBar(isOnline ? '🌐 متصل' : '📦 أوفلاين - من الكاش');
        
        saveCurrentPath();
        saveBrowseState();

        if (isOnline && studyDb) {
            console.log('🔄 جلب التحديثات الجديدة فقط...');
            try {
                const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
                const serverData = snapshot.val() || { folders: [], posts: [] };
                await incrementalUpdate(pathKey, serverData);
            } catch (err) {
                console.warn('فشل التحديث التدريجي:', err);
            }
        }
        return;
    }

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

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        data = snapshot.val() || { folders: [], posts: [] };
        
        await cacheFolderData(pathKey, data);
        globalPostsData = data;
        
        renderFolderContent(data);
        updateItemCount(data);
        updateStatusBar('🌐 متصل - محدث من السيرفر');
        
        saveCurrentPath();
        saveBrowseState();
        return;

    } catch (err) {
        console.error('❌ خطأ في تحميل المجلد من السيرفر:', err);
        
        const emergencyCache = localStorage.getItem(`study_cache_${pathKey}`);
        if (emergencyCache) {
            try {
                const emergencyData = JSON.parse(emergencyCache);
                globalPostsData = emergencyData;
                renderFolderContent(emergencyData);
                updateItemCount(emergencyData);
                updateStatusBar('⚠️ بيانات مؤقتة - خطأ في التحديث');
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
        updateStatusBar('❌ خطأ في التحميل');
    }
}

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
    const isSubject = isSubjectFolder(currentStudyPath);

    const btnAddPost = document.getElementById('btnAddPost');
    if (btnAddPost) btnAddPost.style.display = (!isRoot && isLeaf && canAdd) ? 'inline-flex' : 'none';

    if (folders.length === 0 && posts.length === 0 && !isSubject) {
        grid.innerHTML = `
            <div class="empty-state-advanced">
                <span class="empty-icon">📭</span>
                <h3>هذا المجلد فارغ</h3>
                <p>${isAdmin ? 'يمكنك إضافة مجلدات أو منشورات جديدة' : 'لا يوجد محتوى في هذا المجلد حالياً'}</p>
            </div>`;
        return;
    }

    let htmlContent = '';

    // عرض المجلدات
    folders.forEach(folder => {
        let folderName = typeof folder === 'object' ? folder.name : folder;
        let folderDescription = typeof folder === 'object' ? folder.description : '';
        let folderType = typeof folder === 'object' ? folder.type || 'normal' : 'normal';
        const folderPathKey = getPathKey([...currentStudyPath, folderName]);
        
        let hasSubFolders = false;
        try {
            const cached = localStorage.getItem(`study_cache_${folderPathKey}`);
            if (cached) {
                const subData = JSON.parse(cached);
                hasSubFolders = subData.folders && subData.folders.length > 0;
            }
        } catch (e) {}

        const folderIcon = folderType === 'subject' ? '📚' : (hasSubFolders ? '📂' : '📁');
        const folderTypeLabel = folderType === 'subject' ? '📚 مادة دراسية' : '📁 مجلد';

        const folderAdminActions = isAdmin ? `
            <div class="folder-actions-overlay">
                <button onclick="event.stopPropagation(); openEditFolderModal('${escapeHtml(folderName)}')" title="تعديل">✏️</button>
                <button class="btn-delete-folder" onclick="event.stopPropagation(); confirmDeleteFolder('${escapeHtml(folderName)}')" title="حذف">🗑️</button>
            </div>
        ` : '';

        htmlContent += `
            <div class="folder-card-advanced" onclick="navigateTo('${folderPathKey}')">
                ${folderAdminActions}
                <span class="folder-icon-large">${folderIcon}</span>
                <div class="folder-name">${escapeHtml(folderName)}</div>
                ${folderDescription ? `<div class="folder-desc">${escapeHtml(folderDescription)}</div>` : ''}
                <div class="folder-meta">${folderTypeLabel}</div>
            </div>
        `;
    });

    // عرض المنشورات للمجلدات العادية
    if (!isSubject) {
        const reversedPosts = [...posts].reverse();
        for (let i = 0; i < reversedPosts.length; i++) {
            const post = reversedPosts[i];
            const originalIndex = posts.length - 1 - i;
            const postId = post.id || `post_${originalIndex}`;

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

            const postAdminActions = isAdmin ? `
                <div class="post-card-admin-actions">
                    <button onclick="event.stopPropagation(); openEditPostModal(${originalIndex})" title="تعديل">✏️</button>
                    <button onclick="event.stopPropagation(); confirmDeletePost(${originalIndex})" title="حذف">🗑️</button>
                </div>
            ` : '';

            let filesHtml = '';
            filesList.forEach((fileObj, fileIndex) => {
                const mediaKey = `${pathKey}_${postId}_file_${fileIndex}`;
                const rawFileName = fileObj.fileName || 'مستند مرفق';
                const fileParsed = splitFileNameAndExt(rawFileName);
                const displayName = fileParsed.name.replace(/_/g, ' ');
                const ext = fileParsed.ext ? fileParsed.ext.trim() : '';
                const fileSizeStr = fileObj.fileSize ? formatFileSize(fileObj.fileSize) : '';

                filesHtml += `
                    <div class="multi-file-item">
                        <div class="file-name-container">
                            <div class="file-name-line">📎 ${escapeHtml(displayName)}</div>
                            ${ext ? `<div class="file-ext-badge">${escapeHtml(ext)}</div>` : ''}
                            ${fileSizeStr ? `<div class="file-size-text">${fileSizeStr}</div>` : ''}
                        </div>
                        <div class="post-square-actions" id="actions-${mediaKey}">
                            <button onclick="event.stopPropagation(); openStudyPreviewMulti('${pathKey}', ${originalIndex}, ${fileIndex})" class="doc-btn doc-btn-view">👁️ معاينة</button>
                            <button onclick="event.stopPropagation(); saveStudyFileOfflineMulti('${pathKey}', ${originalIndex}, ${fileIndex})" class="doc-btn doc-btn-download" id="btnDl-${mediaKey}">💾 حفظ</button>
                        </div>
                        <div class="download-progress-box" id="pbox-${mediaKey}">
                            <div class="progress-track">
                                <div class="progress-fill" id="pbar-${mediaKey}" style="width:0%;"></div>
                            </div>
                            <div class="progress-info">
                                <span id="ptext-${mediaKey}">0%</span>
                                <span id="psize-${mediaKey}"></span>
                            </div>
                        </div>
                        <div class="offline-badge" id="offlineCheck-${mediaKey}">✅ محفوظ محلياً</div>
                    </div>
                `;
            });

            htmlContent += `
                <div class="post-card-advanced" id="postCard-${postId}">
                    ${postAdminActions}
                    <img src="document.png" class="folder-icon-big" alt="منشور">
                    <div class="folder-name1">${escapeHtml(post.title || 'بدون عنوان')}</div>
                    ${(post.text || post.description) ? `<div class="post-details-text">${escapeHtml(post.text || post.description)}</div>` : ''}
                    ${filesHtml}
                    <div class="post-meta-info">
                        <div>👤 ${escapeHtml(post.user || 'أدمين')}</div>
                        ${timeFormatted ? `<div>🕒 ${timeFormatted}</div>` : ''}
                    </div>
                </div>
            `;
        }
    }

    // عرض المحاضرات للمجلدات الدراسية - كل محاضرة في سطر منفصل
    // عرض المحاضرات للمجلدات الدراسية - كل محاضرة في سطر منفصل
else {
    // الحصول على بيانات المحاضرات من البيانات أو إنشاؤها إذا لم توجد
    let lectures = data.lectures || [];
    
    // إذا كانت المحاضرات فارغة، أنشئ 15 محاضرة افتراضية
    if (lectures.length === 0) {
        lectures = [];
        for (let i = 1; i <= 15; i++) {
            lectures.push({
                id: i,
                week: i,
                title: `المحاضرة رقم ${i}`,
                createdAt: Date.now()
            });
        }
        // حفظ المحاضرات في البيانات
        data.lectures = lectures;
        // حفظ في الكاش
        localStorage.setItem(`study_cache_${pathKey}`, JSON.stringify(data));
        saveCacheToIDB(`folder_${pathKey}`, data);
    }

    // ترتيب المحاضرات حسب رقمها
    lectures.sort((a, b) => (a.id || a) - (b.id || b));

    // ====== كل محاضرة في عنصر منفصل ======
    lectures.forEach((lecture, idx) => {
        const lectureId = typeof lecture === 'object' ? lecture.id : lecture;
        const weekNum = typeof lecture === 'object' ? lecture.week : lecture;
        const lectureTitle = typeof lecture === 'object' ? lecture.title || `المحاضرة رقم ${weekNum}` : `المحاضرة رقم ${weekNum}`;
        
        // جلب المنشورات والتكاليف الخاصة بهذه المحاضرة
        const postsData = data.posts ? data.posts.filter(p => p.lectureId === lectureId) : [];
        const assignmentsData = data.assignments ? data.assignments.filter(a => a.lectureId === lectureId) : [];
        const completedAssignments = data.completedAssignments ? data.completedAssignments.filter(c => c.lectureId === lectureId) : [];

        // ====== بناء بطاقة المحاضرة - كل بطاقة في عنصر مستقل ======
        htmlContent += `
            <div class="lecture-card" id="lecture-${lectureId}">
                <div class="lecture-header" onclick="toggleLecture(${lectureId})">
                    <span class="lecture-number">📚 ${escapeHtml(lectureTitle)}</span>
                    <span class="lecture-week">الأسبوع ${weekNum}</span>
                    <span class="lecture-toggle">▼</span>
                </div>
                <div class="lecture-body" id="lectureBody-${lectureId}" style="display:${lectureId === 1 ? 'block' : 'none'};">
        `;

        // -------- قسم محتوى المحاضرة --------
        htmlContent += `
            <div class="lecture-section">
                <div class="section-header">
                    <span>📝 محتوى المحاضرة</span>
                    ${isAdmin ? `<button class="btn-add-content" onclick="addPostToLecture(${lectureId})">➕ إضافة</button>` : ''}
                </div>
                <div class="lecture-posts" id="lecturePosts-${lectureId}">
        `;

        if (postsData.length === 0) {
            htmlContent += `<div class="empty-lecture-content">لا يوجد محتوى للمحاضرة بعد</div>`;
        } else {
            postsData.forEach((post, idx2) => {
                const postTime = post.timestamp ? new Date(post.timestamp).toLocaleString('ar-YE', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '';

                let filesHtml = '';
                if (post.files && post.files.length > 0) {
                    post.files.forEach((fileObj, fileIdx) => {
                        const mediaKey = `${pathKey}_${post.id}_file_${fileIdx}`;
                        const rawFileName = fileObj.fileName || 'مستند مرفق';
                        const fileParsed = splitFileNameAndExt(rawFileName);
                        const displayName = fileParsed.name.replace(/_/g, ' ');
                        const ext = fileParsed.ext ? fileParsed.ext.trim() : '';
                        const fileSizeStr = fileObj.fileSize ? formatFileSize(fileObj.fileSize) : '';

                        filesHtml += `
                            <div class="post-item" id="post-${post.id}">
                                <div class="post-author">👤 ${escapeHtml(post.user || 'أدمين')}</div>
                                <div class="post-time">🕒 ${postTime}</div>
                                ${post.title ? `<div class="post-title">${escapeHtml(post.title)}</div>` : ''}
                                ${post.text ? `<div class="post-text">${escapeHtml(post.text)}</div>` : ''}
                                <div class="post-file-info">
                                    <span class="file-name">📎 ${escapeHtml(displayName)}</span>
                                    ${ext ? `<span class="file-ext">${escapeHtml(ext)}</span>` : ''}
                                    ${fileSizeStr ? `<span class="file-size">${fileSizeStr}</span>` : ''}
                                </div>
                                <div class="post-actions">
                                    <button onclick="openStudyPreviewMulti('${pathKey}', ${post.originalIndex || idx2}, ${fileIdx})" class="doc-btn doc-btn-view">👁️ معاينة</button>
                                    <button onclick="saveStudyFileOfflineMulti('${pathKey}', ${post.originalIndex || idx2}, ${fileIdx})" class="doc-btn doc-btn-download" id="btnDl-${mediaKey}">💾 حفظ</button>
                                </div>
                                <div class="download-progress-box" id="pbox-${mediaKey}">
                                    <div class="progress-track">
                                        <div class="progress-fill" id="pbar-${mediaKey}" style="width:0%;"></div>
                                    </div>
                                    <div class="progress-info">
                                        <span id="ptext-${mediaKey}">0%</span>
                                        <span id="psize-${mediaKey}"></span>
                                    </div>
                                </div>
                                <div class="offline-badge" id="offlineCheck-${mediaKey}">✅ محفوظ محلياً</div>
                                ${isAdmin ? `<button class="btn-delete-post" onclick="deletePostFromLecture(${lectureId}, '${post.id}')">🗑️</button>` : ''}
                            </div>
                        `;
                    });
                }

                htmlContent += filesHtml;
            });
        }

        htmlContent += `
                </div>
            </div>
        `;

        // -------- قسم التكاليف --------
        htmlContent += `
            <div class="lecture-section">
                <div class="section-header">
                    <span>📋 التكاليف</span>
                    ${isAdmin ? `<button class="btn-add-content" onclick="openAssignmentModal(${lectureId})">➕ إضافة تكليف</button>` : ''}
                </div>
                <div class="lecture-assignments" id="lectureAssignments-${lectureId}">
        `;

        if (assignmentsData.length === 0) {
            htmlContent += `<div class="empty-lecture-content">لا توجد تكاليف حالياً</div>`;
        } else {
            assignmentsData.forEach((assignment, idx2) => {
                const remainingTime = getRemainingTime(assignment.dueDate);
                const statusClass = getStatusClass(remainingTime);
                const timeLeftStr = formatRemainingTime(remainingTime);
                const assignTime = assignment.createdAt ? new Date(assignment.createdAt).toLocaleString('ar-YE', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '';

                const isCompleted = completedAssignments.some(c => c.assignmentId === assignment.id);
                const completers = completedAssignments.filter(c => c.assignmentId === assignment.id);

                htmlContent += `
                    <div class="assignment-card ${statusClass}" id="assignment-${assignment.id}">
                        <div class="assignment-header">
                            <span class="assignment-title">📋 ${escapeHtml(assignment.title || 'تكليف')}</span>
                            <span class="assignment-due">⏰ ${timeLeftStr}</span>
                        </div>
                        ${assignment.text ? `<div class="assignment-text">${escapeHtml(assignment.text)}</div>` : ''}
                        ${assignment.files && assignment.files.length > 0 ? `
                            <div class="assignment-files">
                                ${assignment.files.map((f, fi) => {
                                    const fParsed = splitFileNameAndExt(f.fileName || 'ملف');
                                    return `
                                        <div class="assignment-file-item">
                                            <span>📎 ${escapeHtml(fParsed.name)}</span>
                                            ${fParsed.ext ? `<span class="file-ext">${escapeHtml(fParsed.ext)}</span>` : ''}
                                            <div class="assignment-actions">
                                                <button onclick="openAssignmentFile('${pathKey}', '${assignment.id}', ${fi})" class="doc-btn doc-btn-view">👁️ معاينة</button>
                                                <button onclick="saveAssignmentFile('${pathKey}', '${assignment.id}', ${fi})" class="doc-btn doc-btn-download">💾 حفظ</button>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                        <div class="assignment-meta">
                            <span>👤 ${escapeHtml(assignment.createdBy || 'أدمين')}</span>
                            <span>🕒 ${assignTime}</span>
                        </div>
                        ${!isCompleted ? `
                            <div class="assignment-actions-row">
                                <button class="btn-complete" onclick="completeAssignment('${pathKey}', ${lectureId}, '${assignment.id}')">✅ إكمال التكليف</button>
                            </div>
                        ` : `
                            <div class="assignment-completed">
                                ✅ تم الإنجاز بواسطة: ${completers.map(c => escapeHtml(c.userName || 'مستخدم')).join('، ')}
                            </div>
                        `}
                        ${isAdmin ? `<button class="btn-delete-assignment" onclick="deleteAssignment(${lectureId}, '${assignment.id}')">🗑️</button>` : ''}
                    </div>
                `;
            });
        }

        htmlContent += `
                </div>
            </div>
        `;

        // -------- قسم التكاليف المنجزة --------
        htmlContent += `
            <div class="lecture-section">
                <div class="section-header">
                    <span>✅ التكاليف المنجزة</span>
                </div>
                <div class="lecture-completed" id="lectureCompleted-${lectureId}">
        `;

        if (completedAssignments.length === 0) {
            htmlContent += `<div class="empty-lecture-content">لا توجد تكاليف منجزة بعد</div>`;
        } else {
            completedAssignments.forEach((comp, idx2) => {
                const compTime = comp.completedAt ? new Date(comp.completedAt).toLocaleString('ar-YE', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '';

                let compFilesHtml = '';
                if (comp.files && comp.files.length > 0) {
                    comp.files.forEach((f, fi) => {
                        const fParsed = splitFileNameAndExt(f.fileName || 'ملف');
                        compFilesHtml += `
                            <div class="completed-file-item">
                                <span>📎 ${escapeHtml(fParsed.name)}${fParsed.ext ? ` (${escapeHtml(fParsed.ext)})` : ''}</span>
                                <div class="completed-actions">
                                    <button onclick="openCompletedFile('${pathKey}', '${comp.id}', ${fi})" class="doc-btn doc-btn-view">👁️ معاينة</button>
                                    <button onclick="saveCompletedFile('${pathKey}', '${comp.id}', ${fi})" class="doc-btn doc-btn-download">💾 حفظ</button>
                                </div>
                            </div>
                        `;
                    });
                }

                htmlContent += `
                    <div class="completed-item">
                        <div class="completed-header">
                            <span>✅ ${escapeHtml(comp.title || 'تكليف منجز')}</span>
                            <span class="completed-by">👤 ${escapeHtml(comp.userName || 'مستخدم')}</span>
                        </div>
                        ${comp.text ? `<div class="completed-text">${escapeHtml(comp.text)}</div>` : ''}
                        ${compFilesHtml}
                        <div class="completed-time">🕒 ${compTime}</div>
                    </div>
                `;
            });
        }

        htmlContent += `
                </div>
            </div>
        `;

        // ====== إغلاق بطاقة المحاضرة ======
        htmlContent += `
                </div>
            </div>
        `;
    });
}

    grid.innerHTML = htmlContent;

    // التحقق من الملفات المحفوظة
    setTimeout(async () => {
        const postsData = isSubject ? [] : posts;
        if (postsData.length > 0) {
            const reversedPosts = [...postsData].reverse();
            for (let i = 0; i < reversedPosts.length; i++) {
                const post = reversedPosts[i];
                const originalIndex = postsData.length - 1 - i;
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

// ========================================================================
// 10. دوال مساعدة
// ========================================================================

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

function getRemainingTime(dueDate) {
    const now = Date.now();
    return dueDate - now;
}

function getStatusClass(remaining) {
    if (remaining > 3 * 24 * 60 * 60 * 1000) return 'status-green';
    if (remaining > 24 * 60 * 60 * 1000) return 'status-yellow';
    return 'status-red';
}

function formatRemainingTime(remaining) {
    if (remaining <= 0) return '⏰ انتهى الوقت';
    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    
    if (days > 0) return `⏰ متبقي ${days} يوم${days > 1 ? 'اً' : ''} و ${hours} ساعة`;
    if (hours > 0) return `⏰ متبقي ${hours} ساعة و ${minutes} دقيقة`;
    return `⏰ متبقي ${minutes} دقيقة`;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'success' ? 'rgba(74, 222, 128, 0.95)' : type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(17, 24, 39, 0.95)'};
        color: #fff;
        padding: 12px 24px;
        border-radius: 12px;
        font-family: 'Tajawal', sans-serif;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        z-index: 99999;
        max-width: 90%;
        text-align: center;
        border: 1px solid rgba(255,255,255,0.1);
        animation: slideUpToast 0.4s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    if (!document.getElementById('toastStyles')) {
        const style = document.createElement('style');
        style.id = 'toastStyles';
        style.textContent = `
            @keyframes slideUpToast {
                from { opacity: 0; transform: translateX(-50%) translateY(30px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.4s ease';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ========================================================================
// 11. دوال المحاضرات والتكاليف
// ========================================================================

function toggleLecture(lectureId) {
    const body = document.getElementById(`lectureBody-${lectureId}`);
    const toggle = document.querySelector(`#lecture-${lectureId} .lecture-toggle`);
    if (body) {
        if (body.style.display === 'none') {
            body.style.display = 'block';
            if (toggle) toggle.textContent = '▼';
        } else {
            body.style.display = 'none';
            if (toggle) toggle.textContent = '▶';
        }
    }
}

function addPostToLecture(lectureId) {
    document.getElementById('newPostLectureId').value = lectureId;
    document.getElementById('newPostTitle').value = '';
    document.getElementById('newPostText').value = '';
    document.getElementById('newPostFile').value = '';
    document.getElementById('createPostModal').classList.add('active');
}

function openAssignmentModal(lectureId) {
    document.getElementById('assignmentLectureId').value = lectureId;
    document.getElementById('assignmentTitle').value = '';
    document.getElementById('assignmentText').value = '';
    document.getElementById('assignmentDeadlineType').value = 'week';
    document.getElementById('assignmentCustomDays').value = '';
    document.getElementById('assignmentFile').value = '';
    document.getElementById('createAssignmentModal').classList.add('active');
}

// ========================================================================
// 12. إنشاء منشور
// ========================================================================

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
    const lectureIdInput = document.getElementById('newPostLectureId');

    const title = titleInput ? titleInput.value.trim() : '';
    const text = textInput ? textInput.value.trim() : '';
    const lectureId = lectureIdInput ? parseInt(lectureIdInput.value) : null;
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
                    fileBlob: file
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
            files: uploadedFiles,
            hasFile: uploadedFiles.length > 0,
            user: user ? user.name : 'مستخدم',
            timestamp: Date.now()
        };

        // إذا كان هناك رقم محاضرة، أضفه
        if (lectureId) {
            newPost.lectureId = lectureId;
        }

        data.posts.push(newPost);
        const postIndex = data.posts.length - 1;

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

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

// ========================================================================
// 13. إنشاء تكليف
// ========================================================================

async function confirmCreateAssignment() {
    const lectureId = parseInt(document.getElementById('assignmentLectureId').value);
    const title = document.getElementById('assignmentTitle').value.trim();
    const text = document.getElementById('assignmentText').value.trim();
    const deadlineType = document.getElementById('assignmentDeadlineType').value;
    const customDays = parseInt(document.getElementById('assignmentCustomDays').value) || 0;
    const fileInput = document.getElementById('assignmentFile');

    if (!title && !text && (!fileInput || fileInput.files.length === 0)) {
        alert('⚠️ يرجى إدخال عنوان أو تفاصيل التكليف أو إرفاق ملف');
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لإضافة تكليف');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    let uploadedFiles = [];

    if (fileInput && fileInput.files.length > 0) {
        const overlay = document.getElementById('uploadProgressOverlay');
        const progressBar = document.getElementById('uploadProgressBar');
        const progressText = document.getElementById('uploadProgressText');
        const statusText = document.getElementById('uploadStatusText');

        if (overlay) overlay.classList.add('active');
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        if (statusText) statusText.textContent = '📤 جاري رفع الملفات...';

        const filesArray = Array.from(fileInput.files);
        for (let i = 0; i < filesArray.length; i++) {
            const file = filesArray[i];
            if (file.size > 25 * 1024 * 1024) {
                if (overlay) overlay.classList.remove('active');
                alert(`⚠️ الملف "${file.name}" أكبر من 25 ميجابايت`);
                return;
            }

            try {
                const result = await uploadFileToStorage(file, title || file.name, (percent) => {
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                });

                uploadedFiles.push({
                    fileUrl: result.permanentLink,
                    filePath: result.fileId,
                    fileName: file.name,
                    fileType: file.type || 'application/octet-stream',
                    fileSize: file.size,
                    telegramFileId: result.telegramFileId || '',
                    telegramFileUniqueId: result.telegramFileUniqueId || ''
                });
            } catch (err) {
                if (overlay) overlay.classList.remove('active');
                alert(`❌ خطأ في رفع الملف: ${err.message}`);
                return;
            }
        }

        if (overlay) overlay.classList.remove('active');
    }

    let dueDate = Date.now();
    if (deadlineType === 'day') {
        dueDate += 24 * 60 * 60 * 1000;
    } else if (deadlineType === 'two_days') {
        dueDate += 2 * 24 * 60 * 60 * 1000;
    } else if (deadlineType === 'week') {
        dueDate += 7 * 24 * 60 * 60 * 1000;
    } else if (deadlineType === 'two_weeks') {
        dueDate += 14 * 24 * 60 * 60 * 1000;
    } else if (deadlineType === 'month') {
        dueDate += 30 * 24 * 60 * 60 * 1000;
    } else if (deadlineType === 'custom' && customDays > 0) {
        dueDate += customDays * 24 * 60 * 60 * 1000;
    }

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [], assignments: [], lectures: [] };

        if (!data.assignments) data.assignments = [];
        if (!data.lectures) data.lectures = [];

        const user = getStudyUser();
        const assignmentId = `assign_${Date.now()}`;

        const newAssignment = {
            id: assignmentId,
            lectureId: lectureId,
            title: title,
            text: text,
            files: uploadedFiles,
            dueDate: dueDate,
            createdAt: Date.now(),
            createdBy: user ? user.name : 'أدمين',
            completed: false,
            completers: []
        };

        data.assignments.push(newAssignment);

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        closeModal('createAssignmentModal');
        await loadCurrentFolder();

        const notification = {
            type: 'assignment_created',
            title: '📋 تكليف جديد',
            message: `تم إضافة تكليف جديد في المحاضرة ${lectureId}: "${title || 'بدون عنوان'}"`,
            path: pathKey,
            lectureId: lectureId,
            assignmentId: assignmentId,
            timestamp: Date.now(),
            read: false
        };
        await studyDb.ref('notifications').push(notification);
        addNotification(notification);

        scheduleAssignmentReminder(assignmentId, dueDate, pathKey, lectureId, title);

        alert('✅ تم إضافة التكليف بنجاح!');

    } catch (err) {
        console.error('خطأ في إضافة التكليف:', err);
        alert(`❌ حدث خطأ: ${err.message}`);
    }
}

// ========================================================================
// 14. إكمال تكليف
// ========================================================================

async function completeAssignment(pathKey, lectureId, assignmentId) {
    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لإكمال التكليف');
        return;
    }

    const user = getStudyUser();
    const userName = user ? user.name : 'مستخدم';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay-advanced active';
    modal.innerHTML = `
        <div class="modal-box-advanced">
            <div class="modal-title">✅ إكمال التكليف</div>
            <input type="text" id="completedTitle" placeholder="عنوان التكليف المنجز (اختياري)" style="margin-bottom:10px;">
            <textarea id="completedText" placeholder="تفاصيل التكليف المنجز (اختياري)" style="min-height:60px;margin-bottom:10px;"></textarea>
            <div class="file-upload-area">
                <label>📎 إرفاق ملف التكليف المنجز:</label>
                <input type="file" id="completedFile" accept="image/*,application/pdf,.doc,.docx,.txt" multiple>
            </div>
            <div class="modal-actions-advanced">
                <button class="btn-modal btn-confirm" onclick="submitCompletedAssignment('${pathKey}', ${lectureId}, '${assignmentId}')">نشر الإنجاز</button>
                <button class="btn-modal btn-cancel" onclick="this.closest('.modal-overlay-advanced').classList.remove('active')">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    window._completedAssignmentData = {
        pathKey: pathKey,
        lectureId: lectureId,
        assignmentId: assignmentId,
        userName: userName
    };
}

async function submitCompletedAssignment(pathKey, lectureId, assignmentId) {
    const titleInput = document.getElementById('completedTitle');
    const textInput = document.getElementById('completedText');
    const fileInput = document.getElementById('completedFile');

    const title = titleInput ? titleInput.value.trim() : '';
    const text = textInput ? textInput.value.trim() : '';

    if (!title && !text && (!fileInput || fileInput.files.length === 0)) {
        alert('⚠️ يرجى إضافة تفاصيل أو ملف للتكليف المنجز');
        return;
    }

    const data = window._completedAssignmentData || {};
    const userName = data.userName || 'مستخدم';

    let uploadedFiles = [];

    if (fileInput && fileInput.files.length > 0) {
        const overlay = document.getElementById('uploadProgressOverlay');
        const progressBar = document.getElementById('uploadProgressBar');
        const progressText = document.getElementById('uploadProgressText');
        const statusText = document.getElementById('uploadStatusText');

        if (overlay) overlay.classList.add('active');
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        if (statusText) statusText.textContent = '📤 جاري رفع الملفات...';

        const filesArray = Array.from(fileInput.files);
        for (let i = 0; i < filesArray.length; i++) {
            const file = filesArray[i];
            if (file.size > 25 * 1024 * 1024) {
                if (overlay) overlay.classList.remove('active');
                alert(`⚠️ الملف "${file.name}" أكبر من 25 ميجابايت`);
                return;
            }

            try {
                const result = await uploadFileToStorage(file, title || file.name, (percent) => {
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = `${percent}%`;
                });

                uploadedFiles.push({
                    fileUrl: result.permanentLink,
                    filePath: result.fileId,
                    fileName: file.name,
                    fileType: file.type || 'application/octet-stream',
                    fileSize: file.size,
                    telegramFileId: result.telegramFileId || '',
                    telegramFileUniqueId: result.telegramFileUniqueId || ''
                });
            } catch (err) {
                if (overlay) overlay.classList.remove('active');
                alert(`❌ خطأ في رفع الملف: ${err.message}`);
                return;
            }
        }

        if (overlay) overlay.classList.remove('active');
    }

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [], assignments: [], completedAssignments: [] };

        if (!data.completedAssignments) data.completedAssignments = [];

        const completedId = `completed_${Date.now()}`;

        const newCompleted = {
            id: completedId,
            lectureId: lectureId,
            assignmentId: assignmentId,
            title: title || 'تكليف منجز',
            text: text || '',
            files: uploadedFiles,
            userName: userName,
            completedAt: Date.now()
        };

        data.completedAssignments.push(newCompleted);

        if (data.assignments) {
            const assignIndex = data.assignments.findIndex(a => a.id === assignmentId);
            if (assignIndex !== -1) {
                if (!data.assignments[assignIndex].completers) {
                    data.assignments[assignIndex].completers = [];
                }
                data.assignments[assignIndex].completers.push({
                    userName: userName,
                    completedAt: Date.now(),
                    completedId: completedId
                });
            }
        }

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        const modal = document.querySelector('.modal-overlay-advanced.active');
        if (modal) modal.classList.remove('active');

        await loadCurrentFolder();

        alert('✅ تم إكمال التكليف بنجاح!');

    } catch (err) {
        console.error('خطأ في إكمال التكليف:', err);
        alert(`❌ حدث خطأ: ${err.message}`);
    }
}

// ========================================================================
// 15. حذف تكليف ومنشور من محاضرة
// ========================================================================

async function deleteAssignment(lectureId, assignmentId) {
    if (!isStudyAdmin()) return;
    if (!confirm('⚠️ هل أنت متأكد من حذف هذا التكليف؟')) return;

    const pathKey = getPathKey(currentStudyPath);

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || {};

        if (data.assignments) {
            data.assignments = data.assignments.filter(a => a.id !== assignmentId);
        }

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        await loadCurrentFolder();
        alert('✅ تم حذف التكليف بنجاح');

    } catch (err) {
        console.error('خطأ في حذف التكليف:', err);
        alert(`❌ حدث خطأ: ${err.message}`);
    }
}

async function deletePostFromLecture(lectureId, postId) {
    if (!isStudyAdmin()) return;
    if (!confirm('⚠️ هل أنت متأكد من حذف هذا المنشور؟')) return;

    const pathKey = getPathKey(currentStudyPath);

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || {};

        if (data.posts) {
            data.posts = data.posts.filter(p => p.id !== postId);
        }

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        await loadCurrentFolder();
        alert('✅ تم حذف المنشور بنجاح');

    } catch (err) {
        console.error('خطأ في حذف المنشور:', err);
        alert(`❌ حدث خطأ: ${err.message}`);
    }
}

// ========================================================================
// 16. جدولة تذكير للتكليف
// ========================================================================

function scheduleAssignmentReminder(assignmentId, dueDate, pathKey, lectureId, title) {
    const now = Date.now();
    const timeToDue = dueDate - now;
    const oneDay = 24 * 60 * 60 * 1000;
    const threeDays = 3 * oneDay;
    const oneWeek = 7 * oneDay;

    if (timeToDue > oneWeek) {
        const reminderTime = timeToDue - oneWeek;
        setTimeout(() => {
            sendAssignmentReminder(assignmentId, pathKey, lectureId, title, 'أسبوع');
        }, reminderTime);
    }

    if (timeToDue > threeDays) {
        const reminderTime = timeToDue - threeDays;
        setTimeout(() => {
            sendAssignmentReminder(assignmentId, pathKey, lectureId, title, '3 أيام');
        }, reminderTime);
    }

    if (timeToDue > oneDay) {
        const reminderTime = timeToDue - oneDay;
        setTimeout(() => {
            sendAssignmentReminder(assignmentId, pathKey, lectureId, title, 'يوم');
        }, reminderTime);
    }
}

async function sendAssignmentReminder(assignmentId, pathKey, lectureId, title, timeLeft) {
    const notification = {
        type: 'assignment_reminder',
        title: '⏰ تذكير بتكليف',
        message: `تنبيه: متبقي ${timeLeft} على تسليم التكليف "${title || 'بدون عنوان'}" في المحاضرة ${lectureId}`,
        path: pathKey,
        lectureId: lectureId,
        assignmentId: assignmentId,
        timestamp: Date.now(),
        read: false,
        urgent: timeLeft === 'يوم'
    };
    await studyDb.ref('notifications').push(notification);
    addNotification(notification);
    
    if (timeLeft === 'يوم') {
        await sendFCMNotificationToAll(
            '🚨 تكليف عاجل',
            `متبقي يوم واحد فقط لتسليم التكليف "${title || 'بدون عنوان'}" في المحاضرة ${lectureId}`,
            { path: pathKey, type: 'urgent_assignment', assignmentId: assignmentId, lectureId: lectureId }
        );
    }
}

// ========================================================================
// 17. دوال الملفات المتعددة والمعاينة
// ========================================================================

async function openStudyPreviewMulti(pathKey, postIndex, fileIndex) {
    let post = null;
    const pathKeyFull = getPathKey(currentStudyPath);

    if (globalPostsData && globalPostsData.posts && globalPostsData.posts[postIndex]) {
        post = globalPostsData.posts[postIndex];
    }

    if (!post) {
        alert('❌ تعذر العثور على المنشور');
        return;
    }

    const fileObj = post.files && post.files[fileIndex];
    if (!fileObj) {
        alert('❌ تعذر العثور على الملف');
        return;
    }

    const postId = post.id || `post_${postIndex}`;
    const mediaKey = `${pathKeyFull}_${postId}_file_${fileIndex}`;

    getMediaFromIDB(mediaKey).then(localData => {
        if (localData && localData.blob) {
            const mimeType = fileObj.fileType || localData.blob.type || 'application/pdf';
            const typedBlob = new Blob([localData.blob], { type: mimeType });
            const blobUrl = URL.createObjectURL(typedBlob);

            const newWindow = window.open(blobUrl, '_self');
            if (!newWindow) {
                window.location.href = blobUrl;
            }
            return;
        }

        let targetUrl = fileObj.fileUrl || fileObj.permanentLink;
        if (!targetUrl) {
            alert('❌ تعذر العثور على رابط الملف');
            return;
        }

        window.location.href = targetUrl;
    }).catch(err => {
        console.warn('Error retrieving from IDB:', err);
        let targetUrl = fileObj.fileUrl || fileObj.permanentLink;
        if (targetUrl) {
            window.location.href = targetUrl;
        } else {
            alert('❌ تعذر فتح الملف');
        }
    });
}

async function saveStudyFileOfflineMulti(pathKey, postIndex, fileIndex) {
    let post = null;
    const pathKeyFull = getPathKey(currentStudyPath);

    if (globalPostsData && globalPostsData.posts && globalPostsData.posts[postIndex]) {
        post = globalPostsData.posts[postIndex];
    }

    if (!post) {
        alert('❌ تعذر العثور على المنشور');
        return;
    }

    const fileObj = post.files && post.files[fileIndex];
    if (!fileObj) {
        alert('❌ تعذر العثور على الملف');
        return;
    }

    const postId = post.id || `post_${postIndex}`;
    const mediaKey = `${pathKeyFull}_${postId}_file_${fileIndex}`;

    const alreadySaved = await checkIsSaved(mediaKey);
    if (alreadySaved) {
        alert('✅ هذا الملف محفوظ مسبقاً محلياً!');
        return;
    }

    let fileUrl = fileObj.fileUrl || fileObj.permanentLink;
    if (!fileUrl) {
        alert('⚠️ لا يوجد رابط ملف للحفظ');
        return;
    }

    try {
        updateDownloadUI(mediaKey, 0, '0 ك.ب', formatFileSize(fileObj.fileSize || 0));

        const response = await fetch(fileUrl, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : (fileObj.fileSize || 0);
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

        const mimeType = fileObj.fileType || 'application/octet-stream';
        const fileName = fileObj.fileName || 'file';
        const blob = new Blob(chunks, { type: mimeType });
        
        const saved = await saveMediaToIDB(mediaKey, blob, mimeType, fileName);

        if (saved) {
            updateDownloadUI(mediaKey, 100, formatFileSize(receivedBytes), totalSizeFormatted);
            updateStorageIndicator();
            
            // تحديث زر الحفظ وشارة الحفظ
            const btnDl = document.getElementById(`btnDl-${mediaKey}`);
            const checkEl = document.getElementById(`offlineCheck-${mediaKey}`);
            if (btnDl) {
                btnDl.textContent = '✅ محفوظ';
                btnDl.className = 'doc-btn doc-btn-saved';
                btnDl.onclick = null;
            }
            if (checkEl) checkEl.classList.add('visible');
            
            showToast('✅ تم حفظ الملف محلياً بنجاح', 'success');
        } else {
            alert('❌ فشل حفظ الملف في الذاكرة المحلية');
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

function updateDownloadUI(mediaKey, percent, loadedStr, totalStr) {
    const pbox = document.getElementById(`pbox-${mediaKey}`);
    const pbar = document.getElementById(`pbar-${mediaKey}`);
    const ptext = document.getElementById(`ptext-${mediaKey}`);
    const psize = document.getElementById(`psize-${mediaKey}`);

    if (pbox) {
        pbox.style.display = 'block';
        pbox.style.background = 'rgba(255,255,255,0.02)';
        pbox.style.borderRadius = '6px';
        pbox.style.padding = '4px 8px';
    }
    if (pbar) pbar.style.width = `${Math.min(100, Math.round(percent))}%`;
    if (ptext) ptext.textContent = `${Math.min(100, Math.round(percent))}%`;
    if (psize) psize.textContent = totalStr ? `${loadedStr} / ${totalStr}` : loadedStr;

    if (percent >= 100) {
        setTimeout(() => {
            if (pbox) {
                pbox.style.display = 'none';
                pbox.style.background = 'transparent';
                pbox.style.padding = '0';
            }
        }, 600);
    }
}

async function checkIsSaved(key) {
    const data = await getMediaFromIDB(key);
    return data !== null;
}

// ========================================================================
// 18. دوال الملفات في التكاليف
// ========================================================================

async function openAssignmentFile(pathKey, assignmentId, fileIndex) {
    const pathKeyFull = getPathKey(currentStudyPath);
    
    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKeyFull}`).once('value');
        const data = snapshot.val() || {};
        const assignments = data.assignments || [];
        const assignment = assignments.find(a => a.id === assignmentId);
        
        if (!assignment || !assignment.files || !assignment.files[fileIndex]) {
            alert('❌ تعذر العثور على الملف');
            return;
        }

        const fileObj = assignment.files[fileIndex];
        const mediaKey = `${pathKeyFull}_${assignmentId}_file_${fileIndex}`;

        getMediaFromIDB(mediaKey).then(localData => {
            if (localData && localData.blob) {
                const mimeType = fileObj.fileType || localData.blob.type || 'application/pdf';
                const typedBlob = new Blob([localData.blob], { type: mimeType });
                const blobUrl = URL.createObjectURL(typedBlob);
                window.location.href = blobUrl;
                return;
            }

            let targetUrl = fileObj.fileUrl || fileObj.permanentLink;
            if (targetUrl) {
                window.location.href = targetUrl;
            } else {
                alert('❌ تعذر العثور على رابط الملف');
            }
        }).catch(err => {
            console.warn('Error:', err);
            let targetUrl = fileObj.fileUrl || fileObj.permanentLink;
            if (targetUrl) window.location.href = targetUrl;
        });
    } catch (err) {
        console.error('خطأ:', err);
        alert('❌ حدث خطأ في فتح الملف');
    }
}

async function saveAssignmentFile(pathKey, assignmentId, fileIndex) {
    const pathKeyFull = getPathKey(currentStudyPath);
    
    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKeyFull}`).once('value');
        const data = snapshot.val() || {};
        const assignments = data.assignments || [];
        const assignment = assignments.find(a => a.id === assignmentId);
        
        if (!assignment || !assignment.files || !assignment.files[fileIndex]) {
            alert('❌ تعذر العثور على الملف');
            return;
        }

        const fileObj = assignment.files[fileIndex];
        const mediaKey = `${pathKeyFull}_${assignmentId}_file_${fileIndex}`;

        const alreadySaved = await checkIsSaved(mediaKey);
        if (alreadySaved) {
            alert('✅ هذا الملف محفوظ مسبقاً محلياً!');
            return;
        }

        let fileUrl = fileObj.fileUrl || fileObj.permanentLink;
        if (!fileUrl) {
            alert('⚠️ لا يوجد رابط ملف للحفظ');
            return;
        }

        const response = await fetch(fileUrl, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const blob = await response.blob();
        const saved = await saveMediaToIDB(mediaKey, blob, fileObj.fileType || 'application/octet-stream', fileObj.fileName || 'file');

        if (saved) {
            showToast('✅ تم حفظ الملف محلياً', 'success');
            updateStorageIndicator();
        } else {
            alert('❌ فشل حفظ الملف');
        }
    } catch (err) {
        console.error('خطأ:', err);
        alert(`❌ حدث خطأ: ${err.message}`);
    }
}

async function openCompletedFile(pathKey, completedId, fileIndex) {
    const pathKeyFull = getPathKey(currentStudyPath);
    
    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKeyFull}`).once('value');
        const data = snapshot.val() || {};
        const completedAssignments = data.completedAssignments || [];
        const completed = completedAssignments.find(c => c.id === completedId);
        
        if (!completed || !completed.files || !completed.files[fileIndex]) {
            alert('❌ تعذر العثور على الملف');
            return;
        }

        const fileObj = completed.files[fileIndex];
        const mediaKey = `${pathKeyFull}_${completedId}_file_${fileIndex}`;

        getMediaFromIDB(mediaKey).then(localData => {
            if (localData && localData.blob) {
                const mimeType = fileObj.fileType || localData.blob.type || 'application/pdf';
                const typedBlob = new Blob([localData.blob], { type: mimeType });
                const blobUrl = URL.createObjectURL(typedBlob);
                window.location.href = blobUrl;
                return;
            }

            let targetUrl = fileObj.fileUrl || fileObj.permanentLink;
            if (targetUrl) {
                window.location.href = targetUrl;
            } else {
                alert('❌ تعذر العثور على رابط الملف');
            }
        }).catch(err => {
            console.warn('Error:', err);
            let targetUrl = fileObj.fileUrl || fileObj.permanentLink;
            if (targetUrl) window.location.href = targetUrl;
        });
    } catch (err) {
        console.error('خطأ:', err);
        alert('❌ حدث خطأ في فتح الملف');
    }
}

async function saveCompletedFile(pathKey, completedId, fileIndex) {
    const pathKeyFull = getPathKey(currentStudyPath);
    
    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKeyFull}`).once('value');
        const data = snapshot.val() || {};
        const completedAssignments = data.completedAssignments || [];
        const completed = completedAssignments.find(c => c.id === completedId);
        
        if (!completed || !completed.files || !completed.files[fileIndex]) {
            alert('❌ تعذر العثور على الملف');
            return;
        }

        const fileObj = completed.files[fileIndex];
        const mediaKey = `${pathKeyFull}_${completedId}_file_${fileIndex}`;

        const alreadySaved = await checkIsSaved(mediaKey);
        if (alreadySaved) {
            alert('✅ هذا الملف محفوظ مسبقاً محلياً!');
            return;
        }

        let fileUrl = fileObj.fileUrl || fileObj.permanentLink;
        if (!fileUrl) {
            alert('⚠️ لا يوجد رابط ملف للحفظ');
            return;
        }

        const response = await fetch(fileUrl, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const blob = await response.blob();
        const saved = await saveMediaToIDB(mediaKey, blob, fileObj.fileType || 'application/octet-stream', fileObj.fileName || 'file');

        if (saved) {
            showToast('✅ تم حفظ الملف محلياً', 'success');
            updateStorageIndicator();
        } else {
            alert('❌ فشل حفظ الملف');
        }
    } catch (err) {
        console.error('خطأ:', err);
        alert(`❌ حدث خطأ: ${err.message}`);
    }
}

// ========================================================================
// 19. إدارة المجلدات
// ========================================================================

function openCreateFolderModal() {
    if (!isStudyAdmin()) {
        alert('⚠️ هذه الخاصية متاحة فقط لمدير النظام.');
        return;
    }
    document.getElementById('newFolderName').value = '';
    document.getElementById('newFolderDescription').value = '';
    document.getElementById('newFolderType').value = 'normal';
    document.getElementById('createFolderModal').classList.add('active');
}

async function confirmCreateFolder() {
    const nameInput = document.getElementById('newFolderName');
    const descInput = document.getElementById('newFolderDescription');
    const typeInput = document.getElementById('newFolderType');
    const folderName = nameInput ? nameInput.value.trim() : '';
    const folderDescription = descInput ? descInput.value.trim() : '';
    const folderType = typeInput ? typeInput.value : 'normal';

    if (!folderName) {
        alert('⚠️ يرجى إدخال اسم المجلد.');
        return;
    }

    if (!isOnline) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لإضافة مجلد جديد.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);

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
            description: folderDescription,
            type: folderType
        });

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        await cacheFolderData(pathKey, data);
        globalPostsData = data;

        // إذا كان مجلد مادة دراسية، أنشئ المحاضرات تلقائياً
        if (folderType === 'subject') {
            const subjectPathKey = getPathKey([...currentStudyPath, folderName]);
            const subjectData = {
                folders: [],
                posts: [],
                lectures: [],
                assignments: [],
                completedAssignments: [],
                folderType: 'subject'
            };

            // إنشاء 15 محاضرة افتراضية
            for (let i = 1; i <= 15; i++) {
                subjectData.lectures.push({
                    id: i,
                    week: i,
                    title: `المحاضرة رقم ${i}`,
                    createdAt: Date.now()
                });
            }

            await studyDb.ref(`study_materials/${subjectPathKey}`).set(subjectData);
            await cacheFolderData(subjectPathKey, subjectData);
            
            // تحديث البيانات المحلية للمجلد الأب
            await cacheFolderData(pathKey, data);
            globalPostsData = data;
        }

        closeModal('createFolderModal');
        await loadCurrentFolder();

        const user = getStudyUser();
        const notification = {
            type: 'folder_created',
            title: '📁 مجلد جديد',
            message: `قام ${user ? user.name : 'المدير'} بإنشاء مجلد جديد "${folderName}" (${folderType === 'subject' ? 'مادة دراسية' : 'عادي'})`,
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

function openEditFolderModal(folderName) {
    if (!isStudyAdmin()) return;
    
    editingFolderName = folderName;
    editingFolderPath = getPathKey(currentStudyPath);

    document.getElementById('editFolderName').value = folderName;
    document.getElementById('editFolderDescription').value = '';
    document.getElementById('editFolderType').value = 'normal';
    
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
                document.getElementById('editFolderType').value = folder.type || 'normal';
            }
        }
    } catch (e) {}
    
    document.getElementById('editFolderModal').classList.add('active');
}

async function confirmEditFolder() {
    if (!isStudyAdmin()) return;

    const nameInput = document.getElementById('editFolderName');
    const descInput = document.getElementById('editFolderDescription');
    const typeInput = document.getElementById('editFolderType');
    const newName = nameInput ? nameInput.value.trim() : '';
    const newDescription = descInput ? descInput.value.trim() : '';
    const newType = typeInput ? typeInput.value : 'normal';

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

        if (typeof oldFolder === 'object') {
            oldFolder.name = newName;
            oldFolder.description = newDescription;
            oldFolder.type = newType;
        } else {
            data.folders[index] = { name: newName, description: newDescription, type: newType };
        }

        if (newName !== oldName) {
            const oldFullPath = `${basePath}/${oldName}`;
            const newFullPath = `${basePath}/${newName}`;

            const oldSnap = await studyDb.ref(`study_materials/${oldFullPath}`).once('value');
            const treeData = oldSnap.val();

            if (treeData !== null) {
                if (treeData && typeof treeData === 'object') {
                    treeData.folderType = newType;
                }
                await studyDb.ref(`study_materials/${newFullPath}`).set(treeData);
                await studyDb.ref(`study_materials/${oldFullPath}`).remove();
            }

            const oldLocalKey = `study_cache_${oldFullPath}`;
            const newLocalKey = `study_cache_${newFullPath}`;
            const oldCache = localStorage.getItem(oldLocalKey);
            if (oldCache) {
                const cacheData = JSON.parse(oldCache);
                cacheData.folderType = newType;
                localStorage.setItem(newLocalKey, JSON.stringify(cacheData));
                localStorage.removeItem(oldLocalKey);
                await saveCacheToIDB(`folder_${newFullPath}`, cacheData);
                await deleteCacheFromIDB(`folder_${oldFullPath}`);
            }
        }

        await studyDb.ref(`study_materials/${basePath}`).set(data);
        await cacheFolderData(basePath, data);

        closeModal('editFolderModal');
        updateBreadcrumb();
        await loadCurrentFolder();

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
// 20. تعديل منشور
// ========================================================================

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
// 21. البحث
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
            const icon = result.type === 'folder' ? '📁' : (result.type === 'assignment' ? '📋' : '📝');
            const badge = result.type === 'folder' ? 'مجلد' : (result.type === 'assignment' ? 'تكليف' : 'منشور');
            const title = result.title || 'بدون عنوان';
            let onClickAction = `navigateToResult('${result.path}', '${result.type}', ${result.index || 'null'}, '${result.lectureId || ''}', '${result.assignmentId || ''}')`;
            
            html += `
                <div class="search-result-item" onclick="${onClickAction}">
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
            const order = { folder: 0, assignment: 1, post: 2 };
            return (order[a.type] || 3) - (order[b.type] || 3);
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
    const assignments = data.assignments || [];

    folders.forEach(folder => {
        let folderName = folder;
        let folderDescription = '';
        let folderType = 'normal';
        if (typeof folder === 'object' && folder !== null) {
            folderName = folder.name || '';
            folderDescription = folder.description || '';
            folderType = folder.type || 'normal';
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
                parentPath: pathKey,
                folderType: folderType
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

    assignments.forEach((assignment, index) => {
        const titleMatch = assignment.title && assignment.title.toLowerCase().includes(query);
        const textMatch = assignment.text && assignment.text.toLowerCase().includes(query);
        const userMatch = assignment.createdBy && assignment.createdBy.toLowerCase().includes(query);

        if (titleMatch || textMatch || userMatch) {
            const title = assignment.title || 'تكليف بدون عنوان';
            let matchText = '';
            let description = '';

            if (titleMatch) {
                matchText = `العنوان: "${assignment.title}"`;
            } else if (textMatch) {
                const textPreview = assignment.text.length > 50 ? assignment.text.substring(0, 50) + '...' : assignment.text;
                matchText = `النص: "${textPreview}"`;
            } else if (userMatch) {
                matchText = `المستخدم: "${assignment.createdBy}"`;
            }

            if (assignment.text) {
                description = assignment.text.length > 100 ? assignment.text.substring(0, 100) + '...' : assignment.text;
            }

            const displayPath = pathArray.length > 0 ? 'المواد الدراسية › ' + pathArray.join(' › ') : 'المواد الدراسية';
            const lectureId = assignment.lectureId || '';

            results.push({
                type: 'assignment',
                title: title,
                description: description,
                matchText: matchText,
                index: index,
                path: pathKey,
                pathDisplay: `${displayPath} › تكليف: ${title}`,
                parentPath: pathKey,
                lectureId: lectureId,
                assignmentId: assignment.id
            });
        }
    });
}

function navigateToResult(path, type, index, lectureId, assignmentId) {
    clearSearch();

    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) resultsContainer.classList.remove('active');

    navigateTo(path);
    
    setTimeout(() => {
        if (type === 'post' && index !== null && index !== undefined) {
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
        } else if (type === 'assignment' && lectureId) {
            const lectureBody = document.getElementById(`lectureBody-${lectureId}`);
            if (lectureBody) {
                lectureBody.style.display = 'block';
                const toggle = document.querySelector(`#lecture-${lectureId} .lecture-toggle`);
                if (toggle) toggle.textContent = '▼';
                setTimeout(() => {
                    const assignmentEl = document.getElementById(`assignment-${assignmentId}`);
                    if (assignmentEl) {
                        assignmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        assignmentEl.style.borderColor = 'var(--gold-primary)';
                        assignmentEl.style.boxShadow = '0 0 40px rgba(212, 175, 55, 0.2)';
                        setTimeout(() => {
                            assignmentEl.style.borderColor = '';
                            assignmentEl.style.boxShadow = '';
                        }, 3000);
                    }
                }, 300);
            }
        }
    }, 500);
}

// ========================================================================
// 22. نظام الإشعارات المتقدم
// ========================================================================

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

function saveNotificationsToStorage() {
    try {
        localStorage.setItem('study_notifications', JSON.stringify(notificationsData));
    } catch (e) {
        console.warn('Failed to save notifications:', e);
    }
    updateNotificationBadge();
}

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

function addNotification(notification) {
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
    
    showBrowserNotification(notification);
}

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
                folderName: notification.folderName,
                lectureId: notification.lectureId,
                assignmentId: notification.assignmentId
            }
        });
        
        notif.onclick = function() {
            window.focus();
            if (this.data && this.data.path) {
                navigateTo(this.data.path);
                setTimeout(() => {
                    if (this.data.lectureId) {
                        const lectureBody = document.getElementById(`lectureBody-${this.data.lectureId}`);
                        if (lectureBody) {
                            lectureBody.style.display = 'block';
                            const toggle = document.querySelector(`#lecture-${this.data.lectureId} .lecture-toggle`);
                            if (toggle) toggle.textContent = '▼';
                        }
                        if (this.data.assignmentId) {
                            const assignmentEl = document.getElementById(`assignment-${this.data.assignmentId}`);
                            if (assignmentEl) {
                                setTimeout(() => {
                                    assignmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 300);
                            }
                        }
                    } else if (this.data.postIndex !== undefined) {
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
            'assignment_created': '📋',
            'assignment_reminder': '⏰',
            'notification': '🔔',
            'system': '⚙️',
            'urgent_assignment': '🚨'
        };
        const icon = iconMap[notif.type] || '🔔';
        
        const timeStr = notif.timestamp ? new Date(notif.timestamp).toLocaleString('ar-YE', {
            hour: '2-digit',
            minute: '2-digit',
            day: 'numeric',
            month: 'short'
        }) : 'منذ قليل';
        
        const isUrgent = notif.urgent === true;
        const urgentClass = isUrgent ? 'urgent-notif' : '';
        
        let actionButton = '';
        if (notif.path) {
            let onClickAction = `navigateTo('${notif.path}')`;
            let buttonText = '📂 الانتقال';
            
            if (notif.lectureId && notif.assignmentId) {
                onClickAction = `navigateToAssignment('${notif.path}', ${notif.lectureId}, '${notif.assignmentId}')`;
                buttonText = '📋 عرض التكليف';
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
            <div class="notif-item-advanced ${isUnread ? 'unread' : ''} ${urgentClass}">
                <div class="notif-row">
                    <span class="notif-icon">${icon}</span>
                    <div class="notif-body">
                        <div class="notif-title-row">
                            <span class="notif-title">${escapeHtml(notif.title || 'تحديث')}</span>
                            ${isUnread ? `<span class="unread-dot"></span>` : ''}
                            ${isUrgent ? `<span class="urgent-badge">🚨 عاجل</span>` : ''}
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

function navigateToAssignment(path, lectureId, assignmentId) {
    navigateTo(path);
    setTimeout(() => {
        const lectureBody = document.getElementById(`lectureBody-${lectureId}`);
        if (lectureBody) {
            lectureBody.style.display = 'block';
            const toggle = document.querySelector(`#lecture-${lectureId} .lecture-toggle`);
            if (toggle) toggle.textContent = '▼';
        }
        setTimeout(() => {
            const assignmentEl = document.getElementById(`assignment-${assignmentId}`);
            if (assignmentEl) {
                assignmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                assignmentEl.style.borderColor = 'var(--gold-primary)';
                assignmentEl.style.boxShadow = '0 0 40px rgba(212, 175, 55, 0.2)';
                setTimeout(() => {
                    assignmentEl.style.borderColor = '';
                    assignmentEl.style.boxShadow = '';
                }, 3000);
            }
        }, 300);
    }, 500);
}

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

function clearAllNotifications() {
    if (!confirm('⚠️ هل أنت متأكد من مسح جميع الإشعارات؟')) return;
    notificationsData = [];
    saveNotificationsToStorage();
    updateNotificationBadge();
    renderNotificationsList();
}

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
// 23. Firebase Cloud Messaging (FCM)
// ========================================================================

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
        const lectureId = data.lectureId !== undefined ? parseInt(data.lectureId) : undefined;
        const assignmentId = data.assignmentId || '';
        const urgent = data.urgent === 'true';
        
        addNotification({
            title: title,
            message: body,
            type: type,
            path: path,
            postIndex: postIndex,
            folderName: folderName,
            lectureId: lectureId,
            assignmentId: assignmentId,
            urgent: urgent,
            timestamp: Date.now()
        });
        
        if (navigator.vibrate) {
            navigator.vibrate(urgent ? 500 : 200);
        }
        
    } catch (error) {
        console.warn('خطأ في معالجة إشعار FCM:', error);
    }
}

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
// 24. الاستماع للإشعارات من Firebase Database
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

        const oldData = localStorage.getItem(`study_cache_${oldPathKey}`);
        if (oldData) {
            localStorage.setItem(`study_cache_${newPathKey}`, oldData);
            localStorage.removeItem(`study_cache_${oldPathKey}`);
        }
        
        getCacheFromIDB(`folder_${oldPathKey}`).then(data => {
            if (data) {
                saveCacheToIDB(`folder_${newPathKey}`, data);
                deleteCacheFromIDB(`folder_${oldPathKey}`);
            }
        });

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
// 25. نظام التشخيص
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
// 26. Keep-Alive ومراقبة الاتصال
// ========================================================================

function initConnectionMonitoring() {
    window.addEventListener('online', () => {
        isOnline = true;
        updateStatusBar();
        loadCurrentFolder();
        startNotificationListener();
        initFCM();
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateStatusBar();
    });
    
    updateStatusBar();
}

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

function startPeriodicCacheUpdate() {
    setInterval(async () => {
        if (isOnline && studyDb) {
            const pathKey = getPathKey(currentStudyPath);
            try {
                const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
                const serverData = snapshot.val() || { folders: [], posts: [] };
                await incrementalUpdate(pathKey, serverData);
            } catch (e) {
                console.warn('Periodic cache update failed:', e);
            }
        }
    }, 5 * 60 * 1000);
}

// ========================================================================
// 27. دوال النوافذ المنبثقة العامة
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
// 28. تحديث البيانات من السيرفر
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

        const updated = await incrementalUpdate(pathKey, serverData);

        if (!updated) {
            showToast('✅ لا توجد تحديثات جديدة', 'info');
        }

        updateStatusBar('🌐 متصل - محدث من السيرفر');

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
// 29. معالجة معاملات URL
// ========================================================================

function handleUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const pathParam = urlParams.get('path');
    if (pathParam && pathParam !== 'root') {
        setTimeout(() => navigateTo(pathParam), 300);
    }
    if (urlParams.get('openNotifications') === 'true') {
        setTimeout(() => toggleNotificationsPanel(), 600);
    }
    const lectureParam = urlParams.get('lecture');
    if (lectureParam) {
        setTimeout(() => {
            const lectureBody = document.getElementById(`lectureBody-${lectureParam}`);
            if (lectureBody) {
                lectureBody.style.display = 'block';
                const toggle = document.querySelector(`#lecture-${lectureParam} .lecture-toggle`);
                if (toggle) toggle.textContent = '▼';
                lectureBody.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 800);
    }
}

// ========================================================================
// 30. حساب حجم التخزين
// ========================================================================

async function getIndexedDBSize() {
    return new Promise((resolve) => {
        if (!window.indexedDB) {
            resolve(0);
            return;
        }

        let totalSize = 0;
        const databases = ['StudyMaterialsDB_V2'];
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
// 31. تنظيف التخزين المؤقت
// ========================================================================

async function clearAppOfflineCache() {
    if (!confirm("⚠️ هل أنت متأكد من تنظيف التخزين المؤقت؟\nسيتم حذف جميع الملفات المحفوظة محلياً، ويمكنك إعادة تنزيلها لاحقاً.")) {
        return;
    }

    try {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        if (idbInstance) {
            idbInstance.close();
            idbInstance = null;
        }

        if (window.indexedDB) {
            const req = indexedDB.deleteDatabase("StudyMaterialsDB_V2");
            req.onsuccess = async () => {
                console.log("✅ تم حذف قاعدة البيانات المحلية");
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('study_cache_') || key.startsWith('study_notifications'))) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
                
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

// ========================================================================
// 32. تهيئة التطبيق
// ========================================================================

async function initStudyApp() {
    console.log('🚀 بدء تهيئة التطبيق المتطور V2...');
    
    initFirebase();

    const user = getStudyUser();
    if (user) {
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) {
            userDisplay.textContent = `👤 ${user.name || 'مستخدم'}`;
        }
    }

    const savedPath = loadSavedPath();
    if (savedPath && savedPath.length > 0) {
        currentStudyPath = savedPath;
        console.log('📂 تم استرجاع المسار المحفوظ:', currentStudyPath);
    }

    updateBreadcrumb();
    updateButtons();
    handleUrlParams();
    
    await loadCurrentFolder();
    await updateStorageIndicator();

    updateStatusBar(isOnline ? '🌐 متصل' : '📡 غير متصل (أوفلاين)');

    initConnectionMonitoring();

    if (isOnline && studyDb) {
        startNotificationListener();
    }

    loadNotificationsFromStorage();
    setTimeout(async () => {
        const permission = await requestNotificationPermission();
        if (permission) {
            await initFCM();
        }
    }, 2000);

    startRenderKeepAlive();
    startPeriodicCacheUpdate();

    setInterval(() => {
        saveCurrentPath();
        saveBrowseState();
    }, 30000);

    window.addEventListener('beforeunload', () => {
        saveCurrentPath();
        saveBrowseState();
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
        if (e.key === 'Escape') {
            closeModal('createFolderModal');
            closeModal('editFolderModal');
            closeModal('createPostModal');
            closeModal('editPostModal');
            closeModal('createAssignmentModal');
            closeFilePreview();
            const overlay = document.getElementById('uploadProgressOverlay');
            if (overlay) overlay.classList.remove('active');
            clearSearch();
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay-advanced')) {
            e.target.classList.remove('active');
        }
    });

    // تفعيل خيار "مخصص" في اختيار مدة التكليف
    document.getElementById('assignmentDeadlineType')?.addEventListener('change', function() {
        const customDays = document.getElementById('assignmentCustomDays');
        if (this.value === 'custom') {
            customDays.style.display = 'block';
        } else {
            customDays.style.display = 'none';
        }
    });

    console.log('✅ تم تشغيل التطبيق المتطور V2 بنجاح');
    console.log(`📊 الحالة: ${isOnline ? 'متصل' : 'غير متصل (أوفلاين)'}`);
    console.log(`📂 المسار الحالي: ${currentStudyPath.join(' › ') || 'الجذر'}`);
    console.log(`👤 المستخدم: ${user ? user.name : 'زائر'}`);
}

// ========================================================================
// 33. تشغيل التطبيق
// ========================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudyApp);
} else {
    initStudyApp();
}

console.log('✅ نظام المواد الدراسية المتطور V2 جاهز!');
