// ========================================================================
// 1. تهيئة Firebase للمواد الدراسية (للتخزين المنظم والبيانات فقط)
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

function initFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.warn('Firebase SDK not available online, switching to offline cache mode.');
            return false;
        }
        if (!firebase.apps || !firebase.apps.length) {
            firebase.initializeApp(STUDY_FIREBASE_CONFIG);
        }
        studyDb = firebase.database();
        return true;
    } catch (err) {
        console.warn('Firebase initialization skipped (offline mode active):', err);
        return false;
    }
}

// ========================================================================
// 1.1 رفع الملفات عبر سيرفر تلجرام
// ========================================================================
const TELEGRAM_SERVER_URL = "https://drive-shared-backend2.onrender.com";

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
            headers: {
                'Accept': 'application/json'
            }
        });

        if (response.ok) {
            console.log(`✅ تم حذف الملف من سيرفر تلجرام: ${fileId}`);
            return true;
        } else {
            console.warn(`⚠️ فشل حذف الملف من سيرفر تلجرام: ${fileId}`);
            return false;
        }
    } catch (error) {
        console.warn('فشل حذف الملف من سيرفر تلجرام:', error);
        return false;
    }
}

// ========================================================================
// 1.2 دالة رفع الملفات الموحدة مع نسبة التحميل
// ========================================================================
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
// 2. إعدادات المستخدم والصلاحيات
// ========================================================================
let currentStudyUser = null;
let currentStudyPath = [];
let globalPostsData = { posts: [], folders: [] };
let editingPostIndex = null;
let editingFolderName = null;
let editingFolderPath = '';
let searchTimeout = null;

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

function canUserAddContent() {
    const user = getStudyUser();
    if (!user) return false;
    return true;
}

function isStudyAdmin() {
    const user = getStudyUser();
    return user && (user.role === 'admin' || user.phone === '774132722');
}

// ========================================================================
// 3. IndexedDB لتخزين الملفات محلياً
// ========================================================================
let idbInstance = null;

function openIDB() {
    return new Promise((resolve, reject) => {
        if (idbInstance) {
            resolve(idbInstance);
            return;
        }
        const req = indexedDB.open('StudyMaterialsDB', 3);
        req.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains('media')) {
                idb.createObjectStore('media', { keyPath: 'key' });
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

async function checkIsSaved(key) {
    const data = await getMediaFromIDB(key);
    return data !== null;
}

// ========================================================================
// 4. معاينة الملفات
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

function updateDownloadUI(mediaKey, percent, loadedSizeStr, totalSizeStr) {
    const pbox = document.getElementById(`pbox-${mediaKey}`);
    const pbar = document.getElementById(`pbar-${mediaKey}`);
    const ptext = document.getElementById(`ptext-${mediaKey}`);
    const psize = document.getElementById(`psize-${mediaKey}`);

    if (pbox) pbox.style.display = 'block';
    if (pbar) pbar.style.width = `${Math.min(100, Math.round(percent))}%`;
    if (ptext) ptext.textContent = `${Math.min(100, Math.round(percent))}%`;
    if (psize) psize.textContent = totalSizeStr ? `${loadedSizeStr} / ${totalSizeStr}` : loadedSizeStr;

    if (percent >= 100) {
        setTimeout(() => {
            if (pbox) pbox.style.display = 'none';
            const btnDl = document.getElementById(`btnDl-${mediaKey}`);
            const checkEl = document.getElementById(`offlineCheck-${mediaKey}`);
            if (btnDl) btnDl.style.display = 'none';
            if (checkEl) checkEl.style.display = 'block';
        }, 600);
    }
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const sizes = ['بايت', 'ك.ب', 'م.ب', 'ج.ب'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

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
        alert("⚠️ لا يوجد رابط ملف صريح للحفظ.");
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
        
        let saved = false;
        if (typeof saveMediaToIDB === 'function') {
            saved = await saveMediaToIDB(mediaKey, blob, mimeType, fileName);
        } else if (typeof saveToIndexedDB === 'function') {
            saved = await saveToIndexedDB(mediaKey, blob);
        }

        if (saved) {
            updateDownloadUI(mediaKey, 100, formatFileSize(receivedBytes), totalSizeFormatted);
        } else {
            alert('❌ فشل حفظ الملف في الذاكرة المحلية.');
            const pbox = document.getElementById(`pbox-${mediaKey}`);
            if (pbox) pbox.style.display = 'none';
        }

    } catch (error) {
        console.error("خطأ أثناء تنزيل الملف أوفلاين:", error);
        alert(`❌ تعذر حفظ الملف: ${error.message}`);
        const pbox = document.getElementById(`pbox-${mediaKey}`);
        if (pbox) pbox.style.display = 'none';
    }
}

// ========================================================================
// 6. إدارة المسار (Breadcrumb) والتنقل
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
        crumb.className = 'crumb';
        crumb.textContent = currentStudyPath[i];
        crumb.dataset.path = currentPath + '/' + currentStudyPath[i];
        crumb.onclick = () => navigateTo(crumb.dataset.path);
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
// 7. تحديث الأزرار حسب المسار والصلاحية
// ========================================================================
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

// ========================================================================
// 8. تحميل محتويات المجلد الحالي
// ========================================================================
async function loadCurrentFolder() {
    const grid = document.getElementById('foldersGrid');
    const postsContainer = document.getElementById('postsContainer');

    if (!grid) return;

    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span><p>جاري التحميل...</p></div>';
    if (postsContainer) postsContainer.style.display = 'none';

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;

    try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
            const data = JSON.parse(cached);
            globalPostsData = data;
            renderFolderContent(data);
            return;
        }
    } catch (e) {
        console.error('Error reading cache:', e);
    }

    if (!navigator.onLine) {
        grid.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px; text-align: center;">
                <span class="empty-icon" style="font-size: 40px; display: block; margin-bottom: 10px;">📡</span>
                <p style="font-weight: 600; margin-bottom: 5px;">أنت تعمل بدون اتصال بالإنترنت</p>
                <p style="font-size: 13px; opacity: 0.7;">لم يتم حفظ محتويات هذا المجلد محلياً مسبقاً.</p>
            </div>`;
        
        if (postsContainer) postsContainer.style.display = 'none';
        return;
    }

    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');

    try {
        if (progressContainer) progressContainer.classList.add('active');
        if (progressBar) progressBar.style.width = '30%';

        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };
        globalPostsData = data;

        if (progressBar) progressBar.style.width = '70%';
        localStorage.setItem(localKey, JSON.stringify(data));
        if (progressBar) progressBar.style.width = '100%';

        setTimeout(() => {
            if (progressContainer) progressContainer.classList.remove('active');
            if (progressBar) progressBar.style.width = '0%';
        }, 500);

        renderFolderContent(data);
    } catch (err) {
        console.error('خطأ في تحميل بيانات المجلد:', err);
        grid.innerHTML = '<div class="empty-state"><span class="empty-icon">❌</span><p>حدث خطأ أثناء تحميل البيانات.</p></div>';
        if (progressContainer) progressContainer.classList.remove('active');
    }
}

// ========================================================================
// 9. عرض المحتوى
// ========================================================================
function splitFileNameAndExt(fileName) {
    if (!fileName) return { name: '', ext: '' };
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return { name: fileName, ext: '' };
    return {
        name: fileName.substring(0, lastDot),
        ext: fileName.substring(lastDot)
    };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function checkHasSubFolders(pathKey) {
    const localKey = `study_cache_${pathKey}`;
    try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
            const data = JSON.parse(cached);
            return data.folders && data.folders.length > 0;
        }
    } catch (e) {}
    return false;
}

function renderFolderContent(data) {
    const grid = document.getElementById('foldersGrid');
    const postsContainer = document.getElementById('postsContainer');

    if (!grid) return;

    const folders = data.folders || [];
    const posts = data.posts || [];
    const isAdmin = isStudyAdmin();
    const isRoot = currentStudyPath.length === 0;
    const isLeaf = folders.length === 0;
    const pathKey = getPathKey(currentStudyPath);
    const canAdd = canUserAddContent();

    const btnAddPost = document.getElementById('btnAddPost');
    if (btnAddPost) btnAddPost.style.display = (!isRoot && isLeaf && canAdd) ? 'inline-flex' : 'none';

    if (folders.length === 0 && posts.length === 0) {
        grid.innerHTML = `<div class="empty-state">
            <span class="empty-icon">📭</span>
            <p>هذا المجلد فارغ.</p>
        </div>`;
        if (postsContainer) postsContainer.style.display = 'none';
        return;
    }

    let htmlContent = '';

    // 1. عرض المجلدات
    folders.forEach(folder => {
        let folderName = typeof folder === 'object' ? folder.name : folder;
        let folderDescription = typeof folder === 'object' ? folder.description : '';
        const folderPathKey = getPathKey([...currentStudyPath, folderName]);
        const hasSubFolders = checkHasSubFolders(folderPathKey);

        const folderAdminActions = isAdmin ? `
            <div class="folder-actions-overlay">
                <button onclick="event.stopPropagation(); openEditFolderModal('${escapeHtml(folderName)}')" title="تعديل">✏️</button>
                <button class="btn-delete-folder" onclick="event.stopPropagation(); confirmDeleteFolder('${escapeHtml(folderName)}')" title="حذف">🗑️</button>
            </div>
        ` : '';

        htmlContent += `
            <div class="folder-card" onclick="navigateTo('${folderPathKey}')">
                ${folderAdminActions}
                <span class="folder-icon-big">${hasSubFolders ? '📂' : '📁'}</span>
                <div class="folder-name">${escapeHtml(folderName)}</div>
                ${folderDescription ? `<div style="font-size: 11px; color: #64748b;">${escapeHtml(folderDescription)}</div>` : ''}
                <div class="folder-count">${hasSubFolders ? 'يحتوي على مجلدات' : 'مجلد'}</div>
            </div>
        `;
    });

    // 2. عرض المنشورات
    if (posts.length > 0) {
        const reversedPosts = [...posts].reverse();

        for (let i = 0; i < reversedPosts.length; i++) {
            const post = reversedPosts[i];
            const originalIndex = posts.length - 1 - i;
            const hasFile = post.hasFile || post.fileData || post.fileUrl;
            
            const postId = post.id || `post_${originalIndex}`;
            const mediaKey = `${pathKey}_${postId}`;

            const rawFileName = post.fileName || post.title || 'مستند مرفق';
            const fileParsed = splitFileNameAndExt(rawFileName);

            let rawSize = post.fileSize || post.size || post.file_size || post.bytes;
            if (!rawSize && post.fileData) {
                rawSize = Math.round((post.fileData.length * 3) / 4);
            }
            const fileSizeStr = rawSize ? formatFileSize(rawSize) : '';

            const rawTime = post.timestamp || post.createdAt || post.date || post.time || post.created_at;
            let timeFormatted = '';

            if (rawTime) {
                const timeNum = typeof rawTime === 'object' && rawTime.seconds ? rawTime.seconds * 1000 : rawTime;
                const parsedDate = new Date(timeNum);
                
                if (!isNaN(parsedDate.getTime())) {
                    timeFormatted = parsedDate.toLocaleDateString('ar-YE', { 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                }
            }

            const postAdminActions = isAdmin ? `
                <div class="post-card-admin-actions">
                    <button onclick="event.stopPropagation(); openEditPostModal(${originalIndex})" title="تعديل">✏️</button>
                    <button onclick="event.stopPropagation(); confirmDeletePost(${originalIndex})" title="حذف">🗑️</button>
                </div>
            ` : '';

            htmlContent += `
    <div class="folder-card post-square-card" id="postCard-${mediaKey}">
        ${postAdminActions}
        <img src="document.png" class="folder-icon-big" alt="منشور" style="width: 50px; height: 50px; transform: scale(2); object-fit: contain;">
        <div class="folder-name1">${escapeHtml(post.title || 'بدون عنوان')}</div>
        ${(post.text || post.description) ? `
            <div class="post-details-text" style="color: #fbbf24 !important; font-size: 10px !important; line-height: 1.3; text-align: center; margin: 4px 0;">${escapeHtml(post.text || post.description)}</div>
        ` : ''}
        ${hasFile ? (() => {
            const fullName = fileParsed.name || '';
            const ext = fileParsed.ext ? fileParsed.ext.trim() : '';
            
            const MAX_LENGTH = 42; 
            let displayName = fullName.replace(/_/g, ' '); 
            
            if (displayName.length > MAX_LENGTH) {
                displayName = displayName.substring(0, MAX_LENGTH) + '...';
            }

            return `
            <div class="file-name-container" title="${escapeHtml(rawFileName)}">
                <div class="file-name-line">📎 ${escapeHtml(displayName)}</div>
                ${ext ? `<div class="file-ext-badge">${escapeHtml(ext)}</div>` : ''}
            </div>`;
        })() : ''}

        <div class="post-meta-info" style="display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: #94a3b8; margin: 6px 0;">
            <div>👤 ${escapeHtml(post.user || 'أدمين')}</div>
            ${timeFormatted ? `<div>🕒 ${timeFormatted}</div>` : ''}
            ${fileSizeStr ? `<div style="color: #38bdf8; font-weight: 600;">💽 ${fileSizeStr}</div>` : ''}
        </div>

        ${hasFile ? `
            <div class="post-square-actions" id="actions-${mediaKey}" style="display: flex; gap: 6px; justify-content: center; width: 100%; margin-top: 6px;">
                <button onclick="event.stopPropagation(); openStudyPreview('${pathKey}', ${originalIndex})" class="doc-btn doc-btn-view" style="background: #fff; color: #0f172a; border: none; border-radius: 20px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">👁️ معاينة</button>
                <button onclick="event.stopPropagation(); saveStudyFileOffline('${pathKey}', ${originalIndex})" class="doc-btn doc-btn-download" id="btnDl-${mediaKey}" style="background: #2563eb; color: #fff; border: none; border-radius: 20px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">💾 حفظ</button>
            </div>

            <div class="download-progress-box" id="pbox-${mediaKey}" style="display:none; width:100%; margin-top:8px;">
                <div style="background:rgba(255,255,255,0.1); border-radius:4px; height:6px; overflow:hidden;">
                    <div class="download-progress-bar" id="pbar-${mediaKey}" style="width:0%; background:#2563eb; height:100%; transition:width 0.2s;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:10px; color:#94a3b8; margin-top:4px;">
                    <span id="ptext-${mediaKey}">0%</span>
                    <span id="psize-${mediaKey}">0 م.ب</span>
                </div>
            </div>

            <div id="offlineCheck-${mediaKey}" style="display:none; color:#10b981; font-size:10px; font-weight:700; margin-top:4px;">
                ✅ محلياً
            </div>
        ` : ''}
    </div>
            `;
        }
    }

    grid.innerHTML = htmlContent;
    if (postsContainer) postsContainer.style.display = 'none';

    setTimeout(async () => {
        if (posts.length > 0) {
            const reversedPosts = [...posts].reverse();
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
                        if (checkEl) checkEl.style.display = 'block';
                        if (btnDl) btnDl.style.display = 'none';
                    }
                }
            }
        }
    }, 100);
}

// ========================================================================
// 10. إنشاء مجلد جديد
// ========================================================================
function openCreateFolderModal() {
    if (!isStudyAdmin()) {
        alert('⚠️ هذه الخاصية متاحة فقط لمدير النظام.');
        return;
    }
    const nameInput = document.getElementById('newFolderName');
    const descInput = document.getElementById('newFolderDescription');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    const modal = document.getElementById('createFolderModal');
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
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

    if (!navigator.onLine) {
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
        localStorage.setItem(localKey, JSON.stringify(data));

        closeModal('createFolderModal');
        loadCurrentFolder();

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
        showNotificationInHome(notification);

        // إرسال إشعار FCM
        await sendFCMNotificationToAll(
            '📁 مجلد جديد',
            `${user?.name || 'المدير'} أضاف مجلد جديد: "${folderName}"`,
            {
                path: pathKey,
                type: 'folder_created',
                folderName: folderName
            }
        );

        alert('✅ تم إنشاء المجلد بنجاح!');

    } catch (err) {
        console.error('خطأ في إنشاء المجلد:', err);
        alert(`❌ حدث خطأ أثناء إنشاء المجلد: ${err.message}`);
    }
}

// ========================================================================
// 11. تعديل وحذف المجلد
// ========================================================================
function openEditFolderModal(folderName) {
    if (!isStudyAdmin()) return;
    
    editingFolderName = folderName;
    editingFolderPath = getPathKey(currentStudyPath);

    const nameInput = document.getElementById('editFolderName');
    const descInput = document.getElementById('editFolderDescription');
    
    const localKey = `study_cache_${editingFolderPath}`;
    try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
            const data = JSON.parse(cached);
            const folder = data.folders ? data.folders.find(f => {
                const fName = typeof f === 'object' ? f.name : f;
                return fName && fName.toString().trim() === folderName.toString().trim();
            }) : null;

            if (folder && typeof folder === 'object') {
                if (nameInput) nameInput.value = folder.name || folderName;
                if (descInput) descInput.value = folder.description || '';
            } else {
                if (nameInput) nameInput.value = folderName;
                if (descInput) descInput.value = '';
            }
        } else {
            if (nameInput) nameInput.value = folderName;
            if (descInput) descInput.value = '';
        }
    } catch (e) {
        if (nameInput) nameInput.value = folderName;
        if (descInput) descInput.value = '';
    }
    
    const modal = document.getElementById('editFolderModal');
    if (modal) modal.classList.add('active');
}

async function confirmEditFolder() {
    const nameInput = document.getElementById('editFolderName');
    const descInput = document.getElementById('editFolderDescription');
    const newName = nameInput ? nameInput.value.trim() : '';
    const newDescription = descInput ? descInput.value.trim() : '';

    if (!newName) {
        alert('⚠️ يرجى إدخال الاسم الجديد.');
        return;
    }

    if (!navigator.onLine) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لتعديل المجلد.');
        return;
    }

    const basePath = editingFolderPath || getPathKey(currentStudyPath);
    const localKey = `study_cache_${basePath}`;

    try {
        const snapshot = await studyDb.ref(`study_materials/${basePath}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        if (!data.folders) data.folders = [];

        const targetOldName = (typeof editingFolderName === 'object' ? editingFolderName.name : editingFolderName) || '';

        const index = data.folders.findIndex(f => {
            if (!f) return false;
            const currentName = typeof f === 'object' ? f.name : f;
            return currentName && currentName.toString().trim() === targetOldName.toString().trim();
        });

        if (index === -1) {
            alert('⚠️ تعذر تحديد موقع المجلد في المسار الحالي.');
            closeModal('editFolderModal');
            return;
        }

        const oldFolder = data.folders[index];
        const oldName = typeof oldFolder === 'object' ? oldFolder.name : oldFolder;
        const oldDesc = typeof oldFolder === 'object' ? (oldFolder.description || '') : '';

        if (newName === oldName && newDescription === oldDesc) {
            closeModal('editFolderModal');
            return;
        }

        if (newName !== oldName) {
            const oldFullPath = `${basePath}/${oldName}`;
            const newFullPath = `${basePath}/${newName}`;

            const oldRef = studyDb.ref(`study_materials/${oldFullPath}`);
            const newRef = studyDb.ref(`study_materials/${newFullPath}`);

            const oldSnap = await oldRef.once('value');
            const treeData = oldSnap.val();

            if (treeData !== null) {
                await newRef.set(treeData);
                await oldRef.remove();
            }

            const oldLocalKey = `study_cache_${oldFullPath}`;
            const newLocalKey = `study_cache_${newFullPath}`;
            const oldCache = localStorage.getItem(oldLocalKey);
            if (oldCache) {
                localStorage.setItem(newLocalKey, oldCache);
                localStorage.removeItem(oldLocalKey);
            }
        }

        if (typeof oldFolder === 'object') {
            oldFolder.name = newName;
            oldFolder.description = newDescription;
        } else {
            data.folders[index] = { name: newName, description: newDescription };
        }

        await studyDb.ref(`study_materials/${basePath}`).update({
            folders: data.folders
        });

        localStorage.setItem(localKey, JSON.stringify(data));

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
            oldSubPath: `${basePath}/${oldName}`,
            newSubPath: `${basePath}/${newName}`,
            timestamp: Date.now(),
            read: false,
            forceUpdate: true
        };
        await studyDb.ref('notifications').push(notification);
        showNotificationInHome(notification);

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

    if (!navigator.onLine) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لحذف المجلد.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;
    const targetFolderKey = `${pathKey}/${folderName}`;

    try {
        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const data = snapshot.val() || { folders: [], posts: [] };

        const index = data.folders.findIndex(f => {
            if (typeof f === 'object') return f.name === folderName;
            return f === folderName;
        });

        if (index !== -1) {
            data.folders.splice(index, 1);
            await studyDb.ref(`study_materials/${pathKey}`).set(data);
            await studyDb.ref(`study_materials/${targetFolderKey}`).remove();

            localStorage.setItem(localKey, JSON.stringify(data));
            localStorage.removeItem(`study_cache_${targetFolderKey}`);

            loadCurrentFolder();

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
            showNotificationInHome(notification);

            alert('✅ تم حذف المجلد بنجاح!');
        }
    } catch (err) {
        console.error('خطأ في حذف المجلد:', err);
        alert(`❌ حدث خطأ أثناء حذف المجلد: ${err.message}`);
    }
}

// ========================================================================
// 12. إنشاء منشور جديد
// ========================================================================
function openCreatePostModal() {
    if (currentStudyPath.length === 0) {
        alert('⚠️ لا يمكن إدراج منشور في المجلد الجذر. يرجى الدخول إلى مجلد فرعي أولاً.');
        return;
    }

    if (!isLeafFolder(currentStudyPath)) {
        alert('⚠️ لا يمكن إدراج منشور في هذا المجلد لأنه يحتوي على مجلدات فرعية.\nيرجى الدخول إلى مجلد نهائي أولاً.');
        return;
    }

    const titleInput = document.getElementById('newPostTitle');
    const textInput = document.getElementById('newPostText');
    const fileInput = document.getElementById('newPostFile');

    if (titleInput) titleInput.value = '';
    if (textInput) textInput.value = '';
    if (fileInput) fileInput.value = '';

    const modal = document.getElementById('createPostModal');
    if (modal) modal.classList.add('active');
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

    if (!navigator.onLine) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لنشر منشور جديد.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;

    const uploadOverlay = document.getElementById('uploadProgressOverlay');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const uploadProgressText = document.getElementById('uploadProgressText');
    const uploadStatusText = document.getElementById('uploadStatusText');

    if (uploadOverlay) uploadOverlay.style.display = 'flex';
    if (uploadProgressBar) uploadProgressBar.style.width = '0%';
    if (uploadProgressText) uploadProgressText.textContent = '0%';
    if (uploadStatusText) uploadStatusText.textContent = '⏳ جاري رفع الملف...';

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
            if (uploadOverlay) uploadOverlay.style.display = 'none';
            if (fileInput) fileInput.value = '';
            alert('⚠️ حجم الملف كبير، يرجى اختيار ملف أقل من 25 ميجابايت.');
            return;
        }

        try {
            fileName = file.name;
            fileType = file.type;
            fileBlob = file;

            const result = await uploadFileToStorage(file, title || fileName, (percent) => {
                if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;
                if (uploadProgressText) uploadProgressText.textContent = `${percent}%`;
                if (uploadStatusText) uploadStatusText.textContent = `📤 جاري رفع الملف... ${percent}%`;
            });

            fileUrl = result.permanentLink;
            filePath = result.fileId;
            telegramFileId = result.telegramFileId || '';
            telegramFileUniqueId = result.telegramFileUniqueId || '';

            if (uploadProgressBar) uploadProgressBar.style.width = '100%';
            if (uploadProgressText) uploadProgressText.textContent = '100%';
            if (uploadStatusText) uploadStatusText.textContent = '✅ تم رفع الملف بنجاح!';

        } catch (err) {
            console.error('خطأ الرفع السحابي:', err);
            if (uploadOverlay) uploadOverlay.style.display = 'none';
            if (fileInput) fileInput.value = '';
            alert(`❌ حدث خطأ أثناء رفع الملف إلى سيرفر تلجرام: ${err.message}`);
            return;
        }
    }

    try {
        if (uploadStatusText) uploadStatusText.textContent = '💾 جاري حفظ البيانات...';

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
            timestamp: Date.now(),
            createdAt: new Date().toISOString()
        };

        data.posts.push(newPost);
        const postIndex = data.posts.length - 1;

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        localStorage.setItem(localKey, JSON.stringify(data));

        if (fileBlob) {
            try {
                const mediaKey = `${pathKey}_${postIndex}`;
                await saveMediaToIDB(mediaKey, fileBlob, fileType, fileName);
            } catch (idbErr) {
                console.warn('تعذر الحفظ في IndexedDB:', idbErr);
            }
        }

        if (uploadStatusText) uploadStatusText.textContent = '✅ تم النشر بنجاح!';

        setTimeout(() => {
            if (uploadOverlay) uploadOverlay.style.display = 'none';
            if (uploadProgressBar) uploadProgressBar.style.width = '0%';
            if (uploadProgressText) uploadProgressText.textContent = '0%';
        }, 1000);

        if (titleInput) titleInput.value = '';
        if (textInput) textInput.value = '';
        if (fileInput) fileInput.value = '';

        closeModal('createPostModal');
        loadCurrentFolder();

        const notification = {
            type: 'post_created',
            title: '📝 منشور جديد',
            message: `قام ${user ? user.name : 'مستخدم'} بإدراج منشور جديد${title ? ` بعنوان "${title}"` : ''} في المسار: ${getPathDisplay(currentStudyPath)}`,
            path: pathKey,
            postIndex: postIndex,
            timestamp: Date.now(),
            read: false
        };
        await studyDb.ref('notifications').push(notification);
        showNotificationInHome(notification);

        // إرسال إشعار FCM
        await sendFCMNotificationToAll(
            '📝 منشور جديد',
            `${user?.name || 'مستخدم'} نشر منشور جديد: "${title || 'بدون عنوان'}"`,
            {
                path: pathKey,
                type: 'post_created',
                postIndex: postIndex
            }
        );

        alert('✅ تم نشر المنشور بنجاح!');

    } catch (err) {
        console.error('خطأ في نشر المنشور:', err);
        alert(`❌ حدث خطأ أثناء نشر المنشور: ${err.message}`);
        if (uploadOverlay) uploadOverlay.style.display = 'none';
    }
}

// ========================================================================
// 13. تعديل وحذف المنشورات
// ========================================================================
function openEditPostModal(index) {
    if (!isStudyAdmin()) return;

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;

    try {
        const cached = localStorage.getItem(localKey);
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
        const titleEl = document.getElementById('editPostTitle');
        const textEl = document.getElementById('editPostText');
        const fileEl = document.getElementById('editPostFile');

        if (titleEl) titleEl.value = post.title || '';
        if (textEl) textEl.value = post.text || '';
        if (fileEl) fileEl.value = '';

        const modal = document.getElementById('editPostModal');
        if (modal) modal.classList.add('active');
    } catch (err) {
        console.error('خطأ في فتح نافذة التعديل:', err);
        alert('حدث خطأ أثناء فتح نافذة التعديل.');
    }
}

async function confirmEditPost() {
    if (!isStudyAdmin()) return;
    if (editingPostIndex === null) return;

    const titleEl = document.getElementById('editPostTitle');
    const textEl = document.getElementById('editPostText');
    const fileInput = document.getElementById('editPostFile');

    const title = titleEl ? titleEl.value.trim() : '';
    const text = textEl ? textEl.value.trim() : '';

    if (!title && !text && (!fileInput || fileInput.files.length === 0)) {
        alert('⚠️ يرجى تعبئة العنوان أو النص أو إرفاق ملف!');
        return;
    }

    if (!navigator.onLine) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لتعديل المنشور.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;
    const mediaKey = `${pathKey}_${editingPostIndex}`;

    const uploadOverlay = document.getElementById('uploadProgressOverlay');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const uploadProgressText = document.getElementById('uploadProgressText');
    const uploadStatusText = document.getElementById('uploadStatusText');

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
            try {
                if (post.filePath) {
                    try {
                        await deleteFileFromStorage(post.filePath);
                    } catch (e) {
                        console.warn('فشل حذف الملف القديم:', e);
                    }
                }

                if (uploadOverlay) uploadOverlay.style.display = 'flex';
                if (uploadProgressBar) uploadProgressBar.style.width = '0%';
                if (uploadProgressText) uploadProgressText.textContent = '0%';
                if (uploadStatusText) uploadStatusText.textContent = '⏳ جاري رفع الملف...';

                const result = await uploadFileToStorage(file, title || file.name, (percent) => {
                    if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;
                    if (uploadProgressText) uploadProgressText.textContent = `${percent}%`;
                    if (uploadStatusText) uploadStatusText.textContent = `📤 جاري رفع الملف... ${percent}%`;
                });

                post.fileUrl = result.permanentLink;
                post.filePath = result.fileId;
                post.fileName = file.name;
                post.fileType = file.type;
                post.hasFile = true;
                post.telegramFileId = result.telegramFileId || '';
                post.telegramFileUniqueId = result.telegramFileUniqueId || '';

                if (uploadProgressBar) uploadProgressBar.style.width = '100%';
                if (uploadProgressText) uploadProgressText.textContent = '100%';
                if (uploadStatusText) uploadStatusText.textContent = '✅ تم رفع الملف بنجاح!';

                await saveMediaToIDB(mediaKey, file, file.type, file.name);
            } catch (err) {
                console.error('خطأ في رفع الملف الجديد:', err);
                if (uploadOverlay) uploadOverlay.style.display = 'none';
                alert(`❌ حدث خطأ أثناء رفع الملف الجديد: ${err.message}`);
                return;
            }
        }

        if (uploadStatusText) uploadStatusText.textContent = '💾 جاري حفظ البيانات...';

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        localStorage.setItem(localKey, JSON.stringify(data));

        setTimeout(() => {
            if (uploadOverlay) uploadOverlay.style.display = 'none';
            if (uploadProgressBar) uploadProgressBar.style.width = '0%';
            if (uploadProgressText) uploadProgressText.textContent = '0%';
        }, 500);

        closeModal('editPostModal');
        editingPostIndex = null;
        loadCurrentFolder();

        const user = getStudyUser();
        const notification = {
            type: 'post_edited',
            title: '✏️ تعديل منشور',
            message: `قام ${user ? user.name : 'المدير'} بتعديل منشور "${oldTitle}" في المسار: ${getPathDisplay(currentStudyPath)}`,
            path: pathKey,
            postIndex: editingPostIndex,
            timestamp: Date.now(),
            read: false,
            forceUpdate: true
        };
        await studyDb.ref('notifications').push(notification);
        showNotificationInHome(notification);

        alert('✅ تم تعديل المنشور بنجاح!');

    } catch (err) {
        console.error('خطأ في تعديل المنشور:', err);
        alert(`❌ حدث خطأ أثناء تعديل المنشور: ${err.message}`);
        if (uploadOverlay) uploadOverlay.style.display = 'none';
    }
}

async function confirmDeletePost(index) {
    if (!isStudyAdmin()) return;

    if (!confirm('⚠️ هل أنت متأكد من حذف هذا المنشور؟\nلا يمكن التراجع عن هذا الإجراء!')) {
        return;
    }

    if (!navigator.onLine) {
        alert('⚠️ يتطلب الاتصال بالإنترنت لحذف المنشور.');
        return;
    }

    const pathKey = getPathKey(currentStudyPath);
    const localKey = `study_cache_${pathKey}`;
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
            try {
                await deleteFileFromStorage(deletedPost.filePath);
            } catch (e) {
                console.warn('فشل حذف الملف من السيرفر:', e);
            }
        }

        await deleteMediaFromIDB(mediaKey);
        data.posts.splice(index, 1);

        await studyDb.ref(`study_materials/${pathKey}`).set(data);
        localStorage.setItem(localKey, JSON.stringify(data));

        loadCurrentFolder();

        const user = getStudyUser();
        const notification = {
            type: 'post_deleted',
            title: '🗑️ حذف منشور',
            message: `قام ${user ? user.name : 'المدير'} بحذف منشور "${postTitle}" في المسار: ${getPathDisplay(currentStudyPath)}`,
            path: pathKey,
            postIndex: index,
            timestamp: Date.now(),
            read: false,
            forceUpdate: true
        };
        await studyDb.ref('notifications').push(notification);
        showNotificationInHome(notification);

        alert('✅ تم حذف المنشور بنجاح!');

    } catch (err) {
        console.error('خطأ في حذف المنشور:', err);
        alert(`❌ حدث خطأ أثناء حذف المنشور: ${err.message}`);
    }
}

// ========================================================================
// 14. معالجة الإشعارات الواردة
// ========================================================================
let notificationListener = null;

function startNotificationListener() {
    if (notificationListener) return;
    if (!navigator.onLine) return;
    if (!studyDb) return;

    try {
        notificationListener = studyDb.ref('notifications').limitToLast(20);
        notificationListener.on('child_added', (snapshot) => {
            const notif = snapshot.val();
            if (notif) {
                showNotificationInHome(notif);

                if (notif.forceUpdate) {
                    handleForceUpdate(notif);
                }

                if (notif.type === 'folder_renamed') {
                    handleFolderRenameNotification(notif);
                }

                if (notif.type === 'post_edited' || notif.type === 'post_deleted') {
                    handlePostUpdateNotification(notif);
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
        const localKey = `study_cache_${pathKey}`;
        localStorage.removeItem(localKey);

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

        const oldLocalKey = `study_cache_${oldPathKey}`;
        const newLocalKey = `study_cache_${newPathKey}`;

        const oldData = localStorage.getItem(oldLocalKey);
        if (oldData) {
            localStorage.setItem(newLocalKey, oldData);
            localStorage.removeItem(oldLocalKey);
        }

        const parentLocalKey = `study_cache_${notif.path}`;
        const parentData = localStorage.getItem(parentLocalKey);
        if (parentData) {
            try {
                const data = JSON.parse(parentData);
                if (data.folders) {
                    const index = data.folders.findIndex(f => {
                        if (typeof f === 'object') return f.name === notif.oldName;
                        return f === notif.oldName;
                    });
                    if (index !== -1) {
                        if (typeof data.folders[index] === 'object') {
                            data.folders[index].name = notif.newName;
                        } else {
                            data.folders[index] = notif.newName;
                        }
                        localStorage.setItem(parentLocalKey, JSON.stringify(data));
                    }
                }
            } catch (e) {}
        }

        if (currentStudyPath.length > 0 && currentStudyPath[currentStudyPath.length - 1] === notif.oldName) {
            currentStudyPath[currentStudyPath.length - 1] = notif.newName;
            updateBreadcrumb();
            loadCurrentFolder();
        }
    } catch (err) {
        console.error('خطأ في معالجة إشعار تغيير اسم المجلد:', err);
    }
}

function handlePostUpdateNotification(notif) {
    try {
        const pathKey = notif.path;
        const localKey = `study_cache_${pathKey}`;
        const currentPathKey = getPathKey(currentStudyPath);

        localStorage.removeItem(localKey);

        if (currentPathKey === pathKey) {
            loadCurrentFolder();
        }
    } catch (err) {
        console.error('خطأ في معالجة إشعار تحديث المنشور:', err);
    }
}

function showNotificationInHome(notif) {
    try {
        if (window.showStudyNotification) {
            window.showStudyNotification(notif);
        }
        if (notif.forceUpdate) {
            showAutoUpdateNotification(`📢 تحديث: ${notif.title}\n${notif.message}`);
        }
        // إضافة الإشعار إلى قائمة الإشعارات المحلية
        if (notif.type && notif.title && notif.message) {
            addNotification({
                title: notif.title,
                message: notif.message,
                type: notif.type,
                path: notif.path,
                postIndex: notif.postIndex,
                folderName: notif.folderName || notif.oldName || notif.newName,
                timestamp: notif.timestamp || Date.now()
            });
        }
    } catch (e) {
        console.log('تعذر عرض الإشعار.');
    }
}

// ========================================================================
// 15. البحث السريع والبحث الشامل
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
                        ${result.description ? `<div style="font-size: 12px; color: var(--text-dim, #64748b);">${escapeHtml(result.description)}</div>` : ''}
                        ${result.matchText ? `<div style="font-size: 11px; color: var(--text-gold, #d4af37); margin-top: 2px;">${escapeHtml(result.matchText)}</div>` : ''}
                        <div class="result-path" style="font-size: 11px; color: var(--text-dim, #64748b); margin-top: 2px;">📍 ${escapeHtml(result.pathDisplay || '')}</div>
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
    const rootLocalKey = `study_cache_${rootKey}`;

    try {
        const rootCached = localStorage.getItem(rootLocalKey);
        if (!rootCached) {
            if (navigator.onLine && studyDb) {
                try {
                    const snapshot = await studyDb.ref(`study_materials/${rootKey}`).once('value');
                    const rootData = snapshot.val() || { folders: [], posts: [] };
                    localStorage.setItem(rootLocalKey, JSON.stringify(rootData));
                } catch (e) {
                    console.warn('تعذر جلب البيانات من السيرفر:', e);
                    return results;
                }
            } else {
                return results;
            }
        }

        await searchFolderRecursively('root', [], query, results);

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
    const localKey = `study_cache_${pathKey}`;
    let data = null;

    try {
        const cached = localStorage.getItem(localKey);
        if (cached) {
            data = JSON.parse(cached);
        } else if (navigator.onLine && studyDb) {
            const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
            data = snapshot.val() || { folders: [], posts: [] };
            localStorage.setItem(localKey, JSON.stringify(data));
        }
    } catch (err) {
        console.warn('تعذر جلب بيانات المجلد:', pathKey, err);
        return;
    }

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
                postCard.style.borderColor = '#d4af37';
                postCard.style.background = 'rgba(212, 175, 55, 0.05)';
                setTimeout(() => {
                    postCard.style.borderColor = '';
                    postCard.style.background = '';
                }, 3000);
            } else {
                loadCurrentFolder();
                setTimeout(() => {
                    const postCardRetry = document.getElementById(`postCard-${mediaKey}`);
                    if (postCardRetry) {
                        postCardRetry.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        postCardRetry.style.borderColor = '#d4af37';
                        postCardRetry.style.background = 'rgba(212, 175, 55, 0.05)';
                        setTimeout(() => {
                            postCardRetry.style.borderColor = '';
                            postCardRetry.style.background = '';
                        }, 3000);
                    }
                }, 500);
            }
        }, 500);
    } else {
        navigateTo(path);
    }
}

// ========================================================================
// 16. إدارة النوافذ المنبثقة والمعاينة
// ========================================================================
function closeFilePreview() {
    const overlay = document.getElementById('filePreviewOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
    }
    const content = document.getElementById('previewContent');
    if (content) content.innerHTML = '<div class="preview-loading">⏳ جاري تحميل الملف...</div>';
}

// ========================================================================
// 17. معالجة معاملات URL
// ========================================================================
function handleUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const pathParam = urlParams.get('path');
    if (pathParam && pathParam !== 'root') {
        setTimeout(() => navigateTo(pathParam), 100);
    }
}

// ========================================================================
// 18. تحديث البيانات من السيرفر
// ========================================================================
async function refreshData() {
    if (!navigator.onLine) {
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
        const localKey = `study_cache_${pathKey}`;

        const snapshot = await studyDb.ref(`study_materials/${pathKey}`).once('value');
        const serverData = snapshot.val() || { folders: [], posts: [] };

        localStorage.setItem(localKey, JSON.stringify(serverData));
        globalPostsData = serverData;
        renderFolderContent(serverData);

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
// 19. إشعارات التحديث التلقائي
// ========================================================================
function showAutoUpdateNotification(message) {
    const notificationDiv = document.createElement('div');
    notificationDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        left: 20px;
        max-width: 400px;
        margin: 0 auto;
        background: rgba(12, 25, 45, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid #10b981;
        border-radius: 16px;
        padding: 16px 20px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        z-index: 9999;
        animation: slideUp 0.5s ease;
        direction: rtl;
    `;
    notificationDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="flex:1;">
                <div style="color:#10b981; font-weight:700; font-size:14px;">🔄 تحديث تلقائي</div>
                <div style="color:#94a3b8; font-size:12px; margin-top:4px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(message)}</div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: none;
                border: none;
                color: #94a3b8;
                font-size: 16px;
                cursor: pointer;
                padding: 4px 8px;
            ">✕</button>
        </div>
    `;
    document.body.appendChild(notificationDiv);

    setTimeout(() => {
        if (notificationDiv.parentElement) {
            notificationDiv.style.animation = 'slideDown 0.5s ease';
            setTimeout(() => notificationDiv.remove(), 500);
        }
    }, 8000);
}

// ========================================================================
// 20. نظام الإشعارات المتقدم (UI + FCM)
// ========================================================================

// ====== VAPID KEY ======
const VAPID_KEY = 'BLiXP9SU05ttQ0-BLyJXQZ3DHwTwgc3t0U4Ld7yE4ZA2USu3LWdJWDXCRKYQwJPaz6yvOZKSrwYO6pSJKvK4mFs';

// ====== متغيرات الإشعارات ======
let notificationsData = [];
let isNotificationsPanelOpen = false;

// ====== تحميل الإشعارات من التخزين المحلي ======
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

// ====== حفظ الإشعارات في التخزين المحلي ======
function saveNotificationsToStorage() {
    try {
        localStorage.setItem('study_notifications', JSON.stringify(notificationsData));
    } catch (e) {
        console.warn('تعذر حفظ الإشعارات:', e);
    }
    updateNotificationBadge();
}

// ====== تحديث العداد والشارة ======
function updateNotificationBadge() {
    const unreadCount = notificationsData.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    const countDisplay = document.getElementById('notifCountDisplay');
    
    if (badge) {
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }
    
    if (countDisplay) {
        countDisplay.textContent = unreadCount;
    }
}

// ====== إضافة إشعار جديد ======
function addNotification(notification) {
    // التأكد من عدم وجود إشعار مكرر
    const isDuplicate = notificationsData.some(n => 
        n.message === notification.message && 
        n.timestamp === notification.timestamp &&
        n.type === notification.type
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

// ====== عرض إشعار في المتصفح ======
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
        console.warn('تعذر عرض إشعار المتصفح:', e);
    }
}

// ====== طلب إذن الإشعارات ======
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

// ====== عرض/إخفاء نافذة الإشعارات ======
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

// ====== عرض قائمة الإشعارات ======
function renderNotificationsList() {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    
    if (notificationsData.length === 0) {
        container.innerHTML = `
            <div class="notif-empty">
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
            <div class="notif-item ${isUnread ? 'unread' : ''}">
                <div class="notif-row">
                    <span class="notif-icon">${icon}</span>
                    <div class="notif-content">
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

// ====== تعليم جميع الإشعارات كمقروءة ======
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

// ====== مسح جميع الإشعارات ======
function clearAllNotifications() {
    if (!confirm('⚠️ هل أنت متأكد من مسح جميع الإشعارات؟')) return;
    notificationsData = [];
    saveNotificationsToStorage();
    updateNotificationBadge();
    renderNotificationsList();
}

// ====== الانتقال إلى منشور معين وتسليط الضوء عليه ======
function navigateToAndHighlight(path, postIndex) {
    navigateTo(path);
    setTimeout(() => {
        const mediaKey = `${path}_${postIndex}`;
        const card = document.getElementById(`postCard-${mediaKey}`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.borderColor = '#d4af37';
            card.style.boxShadow = '0 0 30px rgba(212, 175, 55, 0.2)';
            card.style.background = 'rgba(212, 175, 55, 0.08)';
            setTimeout(() => {
                card.style.borderColor = '';
                card.style.boxShadow = '';
                card.style.background = '';
            }, 3000);
        }
    }, 500);
}

// ========================================================================
// 21. Firebase Cloud Messaging (FCM)
// ========================================================================

let fcmMessaging = null;
let fcmToken = null;
let fcmInitialized = false;

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

// ====== إرسال إشعار عبر الخادم ======
async function sendFCMNotificationToAll(title, message, data = {}) {
    if (!navigator.onLine) {
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
// 23. نظام تشخيص حالة النظام والموارد (Keep-Alive + Diagnostics)
// ========================================================================

function startRenderKeepAlive() {
    setInterval(async () => {
        if (navigator.onLine) {
            try {
                await fetch(`${TELEGRAM_SERVER_URL}/health`, { method: 'GET' });
                console.log('✅ Render Keep-Alive Ping Successful');
            } catch (e) {
                console.warn('⚠️ Render Keep-Alive Ping Failed');
            }
        }
    }, 10 * 60 * 1000);
}

function openSystemDiagnosticsModal() {
    const modal = document.getElementById('diagnosticsModal');
    if (modal) {
        modal.style.display = 'flex';
        runSystemDiagnostics();
    }
}

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

async function runSystemDiagnostics() {
    const statusRender = document.getElementById('diag-render-status');
    const pingRender = document.getElementById('diag-render-ping');
    const statusFirebase = document.getElementById('diag-firebase-status');
    const storageUsed = document.getElementById('diag-storage-used');
    const storageQuota = document.getElementById('diag-storage-quota');
    const storagePercent = document.getElementById('diag-storage-percent');
    const storageBar = document.getElementById('diag-storage-bar');

    if (statusRender) statusRender.innerHTML = '⏳ فحص...';
    if (statusFirebase) statusFirebase.innerHTML = '⏳ فحص...';
    if (storageUsed) storageUsed.textContent = '⏳ جاري الحساب...';

    // أ. فحص سيرفر Render
    const startTime = performance.now();
    try {
        const res = await fetch(`${TELEGRAM_SERVER_URL}/health`, { method: 'GET' });
        const ping = Math.round(performance.now() - startTime);
        if (res.ok) {
            if (statusRender) {
                statusRender.textContent = 'نشط ✅';
                statusRender.style.color = '#10b981';
            }
            if (pingRender) pingRender.textContent = `زمن الاستجابة: ${ping}ms`;
        } else {
            throw new Error();
        }
    } catch (e) {
        if (statusRender) {
            statusRender.textContent = 'خامل / متوقف ❌';
            statusRender.style.color = '#ef4444';
        }
        if (pingRender) pingRender.textContent = 'تعذر الاتصال بالسيرفر';
    }

    // ب. فحص Firebase Database
    if (navigator.onLine && studyDb) {
        try {
            const connectedRef = studyDb.ref('.info/connected');
            connectedRef.once('value', (snap) => {
                if (snap.val() === true) {
                    if (statusFirebase) {
                        statusFirebase.textContent = 'متصل ✅';
                        statusFirebase.style.color = '#10b981';
                    }
                } else {
                    if (statusFirebase) {
                        statusFirebase.textContent = 'منقطع ⚠️';
                        statusFirebase.style.color = '#f59e0b';
                    }
                }
            });
        } catch (e) {
            if (statusFirebase) {
                statusFirebase.textContent = 'خطأ في الاتصال ❌';
                statusFirebase.style.color = '#ef4444';
            }
        }
    } else if (!navigator.onLine) {
        if (statusFirebase) {
            statusFirebase.textContent = 'أوفلاين 📡';
            statusFirebase.style.color = '#94a3b8';
        }
    } else {
        if (statusFirebase) {
            statusFirebase.textContent = 'غير مهيأ ⚠️';
            statusFirebase.style.color = '#f59e0b';
        }
    }

    // ج. حساب إجمالي التخزين المستخدم
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
            storageUsed.style.color = totalUsed > 0 ? '#f59e0b' : '#94a3b8';
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
            storageUsed.style.color = '#ef4444';
        }
    }
}

// ========================================================================
// 24. تنظيف التخزين المؤقت
// ========================================================================
async function clearAppOfflineCache() {
    if (!confirm("هل أنت تأكد من تنظيف الذاكرة المؤقتة؟\nسيتم حذف الملفات المحفوظة للأوفلاين وتفريغ مساحة الهاتف، ويمكنك إعادة تنزيلها لاحقاً عند الاتصال بالنت.")) {
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
            const req = indexedDB.deleteDatabase("StudyMaterialsDB");
            
            req.onsuccess = async () => {
                console.log("تم حذف قاعدة البيانات المحلية بنجاح");
                if (typeof loadCurrentFolder === 'function') {
                    await loadCurrentFolder();
                }
                if (typeof runSystemDiagnostics === 'function') {
                    runSystemDiagnostics();
                }
                alert("تم تنظيف التخزين المؤقت بنجاح وتحرير مساحة الهاتف! 🎉");
            };

            req.onerror = () => {
                alert("تعذر حذف الذاكرة، حاول إعادة إغلاق التطبيق.");
            };
        }

    } catch (error) {
        console.error("خطأ أثناء تنظيف الذاكرة:", error);
        alert("حدث خطأ أثناء تنظيف الذاكرة المؤقتة.");
    }
}

// ========================================================================
// 25. تهيئة التطبيق
// ========================================================================
// ================================================================
// ✅ طلب إذن الإشعارات
// ================================================================

async function requestNotificationPermission() {
    console.log('🔔 جاري طلب إذن الإشعارات...');
    
    if (!('Notification' in window)) {
        console.warn('⚠️ المتصفح لا يدعم الإشعارات');
        return false;
    }
    
    if (Notification.permission === 'granted') {
        console.log('✅ الإذن ممنوح مسبقاً');
        return true;
    }
    
    if (Notification.permission === 'denied') {
        console.warn('⚠️ الإذن مرفوض من قبل المستخدم');
        return false;
    }
    
    try {
        const permission = await Notification.requestPermission();
        console.log('📨 نتيجة طلب الإذن:', permission);
        return permission === 'granted';
    } catch (error) {
        console.error('❌ خطأ في طلب الإذن:', error);
        return false;
    }
}

// ================================================================
// ✅ Keep-Alive (مثل OneSignal)
// ================================================================

function startPageKeepAlive() {
    if (!('serviceWorker' in navigator)) return;
    
    setInterval(async () => {
        try {
            const registration = await navigator.serviceWorker.ready;
            if (registration.active) {
                registration.active.postMessage({ 
                    type: 'KEEP_ALIVE_PING',
                    timestamp: Date.now()
                });
                console.log('💓 Keep-alive ping sent from page');
            }
        } catch (error) {
            // silent fail
        }
    }, 10000);
}

async function refreshServiceWorker() {
    try {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
        console.log('🔄 Service Worker refreshed');
    } catch (error) {
        console.warn('⚠️ Service Worker refresh failed:', error);
    }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'KEEP_ALIVE_PING') {
            if (event.source) {
                event.source.postMessage({
                    type: 'KEEP_ALIVE_PONG',
                    timestamp: Date.now()
                });
            }
        }
    });
}

// ================================================================
// ✅ تهيئة الإشعارات (ستطلب الإذن تلقائياً)
// ================================================================

function initNotifications() {
    console.log('🔔 بدء تهيئة الإشعارات...');
    
    loadNotificationsFromStorage();
    
    // فتح نافذة الإشعارات إذا طلب ذلك
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openNotifications') === 'true') {
        setTimeout(() => toggleNotificationsPanel(), 500);
    }
    
    setTimeout(async () => {
        try {
            const permission = await requestNotificationPermission();
            if (permission) {
                console.log('✅ إذن الإشعارات ممنوح');
                if (typeof firebase !== 'undefined' && firebase.messaging) {
                    await initFCM();
                }
            } else {
                console.warn('⚠️ لم يتم الحصول على إذن الإشعارات');
            }
        } catch (e) {
            console.warn('⚠️ خطأ في تهيئة الإشعارات:', e);
        }
    }, 2000);
}

// ================================================================
// ✅ تهيئة التطبيق (الرئيسية)
// ================================================================

function initStudyApp() {
    console.log('🚀 بدء تهيئة التطبيق...');
    
    initFirebase();

    let user = getStudyUser();
    if (!user) {
        user = { name: 'زائر (أوفلاين)', role: 'student', phone: '' };
    }

    currentStudyUser = user;
    
    try {
        updateBreadcrumb();
        updateButtons();
        handleUrlParams();
        loadCurrentFolder();
    } catch (e) {
        console.error("خطأ أثناء بناء الواجهة محلياً:", e);
    }

    if (navigator.onLine && studyDb) {
        startNotificationListener();
    }

    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
            e.target.classList.remove('active');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal('createFolderModal');
            closeModal('editFolderModal');
            closeModal('createPostModal');
            closeModal('editPostModal');
            closeFilePreview();
            const uploadOverlay = document.getElementById('uploadProgressOverlay');
            if (uploadOverlay) uploadOverlay.style.display = 'none';
        }
    });

    // ✅ تهيئة الإشعارات (ستطلب الإذن)
    initNotifications();
    
    // ✅ بدء Keep-Alive
    startPageKeepAlive();
    setInterval(refreshServiceWorker, 5 * 60 * 1000);
    startRenderKeepAlive();

    console.log('✅ تم تشغيل واجهة المواد الدراسية بنجاح');
}

// ================================================================
// ✅ تشغيل التطبيق (مرة واحدة فقط)
// ================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudyApp);
} else {
    initStudyApp();
}

console.log('✅ نظام الإشعارات المتقدم جاهز!');
