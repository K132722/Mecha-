// ==========================================================================
// 1. البيانات الأساسية للأعضاء وإعدادات Firebase
// ==========================================================================
const MEMBERS = {
    "774132722": { name: "أبو جراح الخولاني", code: "132722", role: "admin" },
    "774339391": { name: "أحمد الأصبحي", code: "136172", role: "member" },
    "774882442": { name: "أحمد أنعم", code: "142626", role: "member" },
    "776677398": { name: "أيمن العودي", code: "162838", role: "member" },
    "779865375": { name: "حمزة غراب", code: "153818", role: "member" },
    "772261443": { name: "إلياس العصيمي", code: "161818", role: "member" },
    "773611986": { name: "أحمد الحجي", code: "141717", role: "member" },
    "777598384": { name: "سليم الوافي", code: "151771", role: "member" }
};

const firebaseConfig = {
    apiKey: "AIzaSyBL_cR0OwbQ3KPYemGY0Q8aliIlXmQkBrU",
    authDomain: "khaled-12ab5.firebaseapp.com",
    databaseURL: "https://khaled-12ab5-default-rtdb.firebaseio.com",
    projectId: "khaled-12ab5",
    storageBucket: "khaled-12ab5.firebasestorage.app",
    messagingSenderId: "75339042920",
    appId: "1:75339042920:web:2f58ca848a8328afc06bdd"
};

// تهيئة Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let notificationsData = [];
let unreadCount = 0;

// توليد أو جلب معرف الجهاز الفريد لمنع التسريب
function getDeviceId() {
    let devId = localStorage.getItem('app_device_id');
    if (!devId) {
        devId = 'dev_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('app_device_id', devId);
    }
    return devId;
}

// ==========================================================================
// 2. إدارة الدخول والجلسة الدائمة (أوفلاين وأونلاين)
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    
    // التحقق من الجلسة المحفوظة سابقاً لفتح التطبيق أوفلاين فورا
    const savedUserSession = localStorage.getItem('mecha_user_session');
    
    if (savedUserSession) {
        currentUser = JSON.parse(savedUserSession);
        launchAppDirectly();
    } else {
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('appContent').style.display = 'none';
    }
});

// إجراء عملية تسجيل الدخول لأول مرة فقط
document.getElementById('loginBtn').addEventListener('click', async () => {
    const phone = document.getElementById('phoneInput').value.trim();
    const code = document.getElementById('codeInput').value.trim();
    const member = MEMBERS[phone];

    if (!phone || !code) {
        return alert('⚠️ يرجى إدخال رقم الهاتف ورمز الدخول!');
    }

    if (member && member.code === code) {
        currentUser = { 
            phone: phone, 
            name: member.name, 
            role: member.role,
            loginTime: new Date().toLocaleString('ar-YE')
        };

        // 🟢 حفظ الجلسة محلياً بشكل دائم حتى لا يطلب الدخول مرة أخرى
        localStorage.setItem('mecha_user_session', JSON.stringify(currentUser));
        
        // ربط الجهاز بالسيرفر لمراقبة تعدد الأجهزة والتسريب
        if (navigator.onLine) {
            try {
                const deviceId = getDeviceId();
                await db.ref(`active_devices/${phone}/${deviceId}`).set({
                    lastActive: new Date().toLocaleString('ar-YE'),
                    deviceInfo: navigator.userAgent.slice(0, 30),
                    status: 'online'
                });
            } catch (e) {
                console.log("تعذر مزامنة الجهاز بالسيرفر حالياً، سيتم التشغيل محلياً.");
            }
        }

        launchAppDirectly();
    } else {
        alert('❌ رقم الهاتف أو رمز الدخول غير صحيح!');
    }
});

// تشغيل الواجهة المباشرة
function launchAppDirectly() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContent').style.display = 'flex';
    
    // فحص هل المستخدم هو أبو جراح (مدير النظام)
    const isAdmin = (currentUser.role === 'admin' || currentUser.phone === '774132722');

    // ضبط بيانات الترويسة العليا
    document.getElementById('userNameDisplay').innerText = `مرحباً المهندس ${currentUser.name}`;
    document.getElementById('userRoleDisplay').innerText = isAdmin ? 'مدير النظام' : 'عضو معتمد';

    // 🔒 1. إظهار/إخفاء زر إدراج إعلان (خاص بأبو جراح)
    const adminBtn = document.getElementById('btnAdminAddBanner');
    if (adminBtn) {
        adminBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }

    // 🔒 2. إظهار/إخفاء أيقونة بيانات الأعضاء ومراقبة الأجهزة (مخفية تماماً عن الأعضاء)
    const usersDataCard = document.getElementById('btnUsersData');
    if (usersDataCard) {
        usersDataCard.style.display = isAdmin ? 'flex' : 'none';
    }

    // 🔒 3. إظهار/إخفاء زر المواد الدراسية (يظهر للجميع)
    const studyBtn = document.getElementById('btnStudyMaterials');
    if (studyBtn) {
        studyBtn.style.display = 'flex';
    }

    updateNetworkStatus();

    // عرض الإعلان المحفوظ محلياً أو جلب التحديث
    loadBannerLocallyOrOnline(false);
    
    // تحميل الإشعارات
    loadNotifications();
}

// متابعة حالة الاتصال بالإنترنت
function updateNetworkStatus() {
    const badge = document.getElementById('netStatusBadge');
    if (!badge) return;
    if (navigator.onLine) {
        badge.innerText = '⚡ متصل';
        badge.className = 'net-badge online';
    } else {
        badge.innerText = '📡 أوفلاين (وضع الحفظ المحلي)';
        badge.className = 'net-badge offline';
    }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// ==========================================================================
// 3. إدارة حاوية الإعلانات ومزامنة Firebase والـ LocalStorage
// ==========================================================================
async function loadBannerLocallyOrOnline(forceFetch = false) {
    const localBanner = localStorage.getItem('cached_banner_data');

    // إذا كان يعمل أوفلاين أو فتح التطبيق بدون طلب تحديث يدوياً
    if (!navigator.onLine || (!forceFetch && localBanner)) {
        if (localBanner) {
            renderBanner(JSON.parse(localBanner));
        } else {
            document.getElementById('bannerDisplayArea').innerHTML = '<div class="empty-banner">لا توجد إعلانات محفوظة محلياً.</div>';
        }
        return;
    }

    // جلب التحديث من Firebase عند التصل بالشبكة
    try {
        const snap = await db.ref('current_banner').once('value');
        const onlineBanner = snap.val();

        if (onlineBanner) {
            const currentLocalId = localBanner ? JSON.parse(localBanner).id : null;

            if (forceFetch && currentLocalId === onlineBanner.id) {
                alert('ℹ️ لا توجد إعلانات محدثة جديدة بعد.');
            } else {
                // حذف القديم وتخزين الجديد محلياً
                localStorage.setItem('cached_banner_data', JSON.stringify(onlineBanner));
                renderBanner(onlineBanner);
                if (forceFetch) alert('✅ تم تحديث الإعلان وحفظه محلياً بنجاح!');
            }
        } else {
            document.getElementById('bannerDisplayArea').innerHTML = '<div class="empty-banner">لا توجد إعلانات حالياً.</div>';
        }
    } catch (e) {
        console.error("خطأ في جلب بيانات الإعلان:", e);
        if (localBanner) renderBanner(JSON.parse(localBanner));
    }
}

function renderBanner(data) {
    document.getElementById('bannerDate').innerText = data.timestamp || '';
    let html = `<h4>${data.title || ''}</h4><p>${data.text || ''}</p>`;
    if (data.img) html += `<img src="${data.img}" style="width:100%; border-radius:12px; margin-top:8px;">`;
    if (data.link) html += `<br><a href="${data.link}" target="_blank" style="color:var(--gold); font-weight:bold; display:inline-block; margin-top:6px;">🔗 فتح الرابط المرفق</a>`;
    document.getElementById('bannerDisplayArea').innerHTML = html;
}

// نشر إعلان جديد من قبل أبو جراح
document.getElementById('btnPublishBanner').addEventListener('click', async () => {
    const title = document.getElementById('bannerTitleInput').value.trim();
    const text = document.getElementById('bannerTextInput').value.trim();
    const link = document.getElementById('bannerLinkInput').value.trim();
    const fileInput = document.getElementById('bannerImgInput');

    if (!title && !text && fileInput.files.length === 0) {
        return alert('⚠️ يرجى كتابة نص أو إرفاق صورة للإعلان!');
    }

    let imgBase64 = '';
    if (fileInput.files.length > 0) {
        imgBase64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(fileInput.files[0]);
        });
    }

    const newBanner = {
        id: 'banner_' + Date.now(),
        title, 
        text, 
        link,
        img: imgBase64,
        timestamp: new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
    };

    try {
        // 1. حذف الإعلان القديم واستبداله في Firebase تلقائياً
        await db.ref('current_banner').set(newBanner);

        // 2. تحديث الحاوية المحلية لدى أبو جراح
        localStorage.setItem('cached_banner_data', JSON.stringify(newBanner));
        renderBanner(newBanner);

        // إعادة ضبط الحقول وإغلاق النافذة
        document.getElementById('bannerTitleInput').value = '';
        document.getElementById('bannerTextInput').value = '';
        document.getElementById('bannerLinkInput').value = '';
        document.getElementById('bannerImgInput').value = '';
        
        closeModal('addBannerModal');
        alert('✅ تم حذف الإعلان القديم واستبداله بالإعلان الجديد للجميع بنجاح!');
    } catch (e) {
        alert('❌ حدث خطأ أثناء النشر، تأكد من اتصال النت.');
    }
});

// ==========================================================================
// 4. عرض بيانات الأعضاء ومراقبة الأجهزة النشطة (منع التسريب)
// ==========================================================================
async function loadUsersDevicesData() {
    const listEl = document.getElementById('usersDevicesList');
    listEl.innerHTML = 'جاري تحليل الأجهزة والنشاط...';

    if (!navigator.onLine) {
        listEl.innerHTML = '⚠️ يتطلب اتصال بالإنترنت لجلب بيانات الأجهزة الحديثة.';
        return;
    }

    try {
        const snap = await db.ref('active_devices').once('value');
        const data = snap.val() || {};

        let html = '';
        Object.entries(MEMBERS).forEach(([phone, member]) => {
            const userDevices = data[phone] ? Object.keys(data[phone]) : [];
            const deviceCount = userDevices.length;

            let warning = '';
            if (deviceCount > 1) {
                warning = `<div class="device-warning-card" style="background:rgba(255,71,87,0.2); border:1px solid #ff4757; color:#ff4757; padding:8px; border-radius:8px; margin-top:6px; font-size:11px;">
                    ⚠️ تنبيه أمني: هذا العضو مسجل من (${deviceCount}) أجهزة مختلفة! يرجى التحقق من عدم مشاركة الرمز.
                </div>`;
            }

            html += `
                <div style="background:rgba(255,255,255,0.05); padding:12px; margin-bottom:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b>👤 المهندس ${member.name}</b>
                        <span style="font-size:11px; color:var(--gold);">${member.role === 'admin' ? 'مدير' : 'عضو'}</span>
                    </div>
                    <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">رقم الهاتف: ${phone}</div>
                    <div style="font-size:11px; color:var(--text-dim);">عدد الأجهزة المسجلة: ${deviceCount}</div>
                    ${warning}
                </div>
            `;
        });

        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '❌ تعذر جلب البيانات من السيرفر.';
    }
}

// ==========================================================================
// 5. إدارة الإشعارات
// ==========================================================================
async function loadNotifications() {
    const savedNotifications = localStorage.getItem('cached_notifications');
    if (savedNotifications) {
        try {
            notificationsData = JSON.parse(savedNotifications);
            updateNotificationBadge();
        } catch (e) {}
    }

    if (navigator.onLine) {
        try {
            const snap = await db.ref('notifications').orderByChild('timestamp').limitToLast(50).once('value');
            const data = snap.val();
            if (data) {
                notificationsData = Object.values(data).reverse();
                localStorage.setItem('cached_notifications', JSON.stringify(notificationsData));
                updateNotificationBadge();
            }
        } catch (e) {
            console.log('تعذر جلب الإشعارات من السيرفر.');
        }
    }
}

function updateNotificationBadge() {
    const unread = notificationsData.filter(n => !n.read).length;
    unreadCount = unread;
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (unread > 0) {
            badge.style.display = 'flex';
            badge.innerText = unread > 99 ? '99+' : unread;
        } else {
            badge.style.display = 'none';
        }
    }
}

function openNotificationsModal() {
    // إنشاء نافذة الإشعارات إذا لم تكن موجودة
    let modal = document.getElementById('notificationsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'notificationsModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="glass-card modal-box large-modal" style="max-width:500px; max-height:80vh; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(212,175,55,0.1); padding-bottom:12px;">
                    <h3 style="color:var(--gold-secondary); font-size:17px; margin:0;">🔔 مركز الإشعارات</h3>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="markAllNotificationsRead()" style="
                            background:rgba(212,175,55,0.1);
                            border:1px solid rgba(212,175,55,0.15);
                            color:var(--text-gold);
                            padding:4px 12px;
                            border-radius:8px;
                            cursor:pointer;
                            font-size:11px;
                        ">تحديد الكل كمقروء</button>
                        <button onclick="closeModal('notificationsModal')" style="
                            background:none;
                            border:none;
                            color:var(--text-dim);
                            font-size:20px;
                            cursor:pointer;
                        ">✕</button>
                    </div>
                </div>
                <div id="notificationsList" style="flex:1; overflow-y:auto; padding:10px 0;">
                    <p style="text-align:center; color:var(--text-dim);">جاري تحميل الإشعارات...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    renderNotificationsList();
}

function renderNotificationsList() {
    const list = document.getElementById('notificationsList');
    if (!list) return;

    if (notificationsData.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-dim);">
                <div style="font-size:48px; margin-bottom:12px;">📭</div>
                <p>لا توجد إشعارات حالياً.</p>
            </div>
        `;
        return;
    }

    let html = '';
    notificationsData.forEach((notif, index) => {
        const isRead = notif.read || false;
        const icon = notif.type === 'folder_created' ? '📁' : '📝';
        const path = notif.path || 'root';
        
        html += `
            <div style="
                background: ${isRead ? 'rgba(255,255,255,0.02)' : 'rgba(212,175,55,0.05)'};
                border: 1px solid ${isRead ? 'rgba(255,255,255,0.03)' : 'rgba(212,175,55,0.1)'};
                border-radius: 12px;
                padding: 14px 16px;
                margin-bottom: 10px;
                transition: all 0.3s ease;
                cursor: pointer;
            " onclick="navigateToNotification('${path}')">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-size:18px;">${icon}</span>
                            <span style="color:var(--gold-secondary); font-weight:600; font-size:14px;">${notif.title}</span>
                            ${!isRead ? `<span style="
                                background:#ff4757;
                                color:#fff;
                                font-size:8px;
                                padding:2px 8px;
                                border-radius:10px;
                                font-weight:700;
                            ">جديد</span>` : ''}
                        </div>
                        <div style="color:var(--text-muted); font-size:12px; margin-top:4px; line-height:1.6;">${notif.message}</div>
                        <div style="color:var(--text-dim); font-size:10px; margin-top:6px;">⏰ ${notif.timestamp}</div>
                    </div>
                    <button onclick="event.stopPropagation(); markNotificationRead(${index})" style="
                        background:none;
                        border:none;
                        color:var(--text-dim);
                        cursor:pointer;
                        font-size:12px;
                        padding:4px;
                    " title="تحديد كمقروء">✓</button>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}

function markNotificationRead(index) {
    if (notificationsData[index]) {
        notificationsData[index].read = true;
        localStorage.setItem('cached_notifications', JSON.stringify(notificationsData));
        updateNotificationBadge();
        renderNotificationsList();
    }
}

function markAllNotificationsRead() {
    notificationsData.forEach(n => n.read = true);
    localStorage.setItem('cached_notifications', JSON.stringify(notificationsData));
    updateNotificationBadge();
    renderNotificationsList();
}

function navigateToNotification(path) {
    closeModal('notificationsModal');
    if (path && path !== 'root') {
        window.location.href = `study-materials.html?path=${encodeURIComponent(path)}`;
    } else {
        window.location.href = 'study-materials.html';
    }
}

// عرض إشعار جديد من نظام المواد الدراسية
window.showStudyNotification = function(notif) {
    // إضافة الإشعار إلى القائمة
    notif.read = false;
    notificationsData.unshift(notif);
    
    // حفظ في localStorage
    try {
        const saved = localStorage.getItem('cached_notifications');
        let existing = saved ? JSON.parse(saved) : [];
        existing.unshift(notif);
        if (existing.length > 100) existing = existing.slice(0, 100);
        localStorage.setItem('cached_notifications', JSON.stringify(existing));
    } catch (e) {}
    
    updateNotificationBadge();

    // عرض الإشعار كمنبثق إذا كنا في الصفحة الرئيسية
    const isHomePage = window.location.pathname.includes('index.html') || 
                       window.location.pathname === '/' || 
                       window.location.pathname === '';
    
    if (!isHomePage) return;

    // إنشاء عنصر الإشعار المنبثق
    const notificationDiv = document.createElement('div');
    notificationDiv.className = 'notification-toast';
    notificationDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        left: 20px;
        max-width: 400px;
        margin: 0 auto;
        background: rgba(12, 25, 45, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid var(--gold-primary);
        border-radius: 16px;
        padding: 16px 20px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        z-index: 9999;
        animation: slideUp 0.5s ease;
        direction: rtl;
    `;

    const isFolder = notif.type === 'folder_created';
    const icon = isFolder ? '📁' : '📝';

    notificationDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="flex:1;">
                <div style="color:var(--gold-secondary); font-weight:700; font-size:14px;">${icon} ${notif.title}</div>
                <div style="color:var(--text-muted); font-size:12px; margin-top:4px; line-height:1.6;">${notif.message}</div>
                <div style="color:var(--text-dim); font-size:10px; margin-top:6px;">⏰ ${notif.timestamp}</div>
                <button onclick="navigateToNotification('${notif.path || 'root'}')" style="
                    background: var(--gold-grad);
                    color: #060d18;
                    border: none;
                    padding: 6px 14px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 700;
                    margin-top: 8px;
                    transition: all 0.3s ease;
                ">🔗 انقر للانتقال</button>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: none;
                border: none;
                color: var(--text-dim);
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
    }, 20000);
};

// ==========================================================================
// 6. الأحداث والتنقلات بالنوافذ
// ==========================================================================
function setupEvents() {
    // زر تحديث البيانات
    document.getElementById('btnRefreshData').addEventListener('click', () => loadBannerLocallyOrOnline(true));
    
    // زر إدراج إعلان
    document.getElementById('btnAdminAddBanner').addEventListener('click', () => openModal('addBannerModal'));
    
    // زر المواد الدراسية - فتح صفحة المواد الدراسية
    document.getElementById('btnStudyMaterials').addEventListener('click', () => {
        window.location.href = 'study-materials.html';
    });

    // زر الإشعارات - فتح نافذة الإشعارات
    document.getElementById('btnNotifCenter').addEventListener('click', () => {
        openNotificationsModal();
        // تحديث الإشعارات من السيرفر
        if (navigator.onLine) {
            loadNotifications();
        }
    });

    // زر عرض بيانات الأعضاء
    document.getElementById('btnUsersData').addEventListener('click', () => {
        openModal('usersDataModal');
        loadUsersDevicesData();
    });

    // زر تسجيل الخروج
    document.getElementById('btnLogout').addEventListener('click', () => {
        if (confirm('هل أنت تأكد من تسجيل الخروج؟ ستحتاج لإدخال الرمز من جديد.')) {
            localStorage.removeItem('mecha_user_session');
            location.reload();
        }
    });
}

function openModal(id) { 
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex'; 
}

function closeModal(id) { 
    const el = document.getElementById(id);
    if (el) el.style.display = 'none'; 
}

// إغلاق النوافذ عند النقر خارجها
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});

// إغلاق النوافذ عند الضغط على ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.style.display = 'none';
        });
    }
});

// ==========================================================================
// 7. دالة مساعدة للتحقق من حالة المدير (مشاركة مع study-materials.js)
// ==========================================================================
function isAdminUser() {
    const user = getCurrentUser();
    return user && (user.role === 'admin' || user.phone === '774132722');
}

function getCurrentUser() {
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

// ==========================================================================
// 8. تحديث واجهة الإشعارات في الترويسة
// ==========================================================================
// إضافة شارة الإشعارات إلى زر الإشعارات
document.addEventListener('DOMContentLoaded', () => {
    // إضافة شارة الإشعارات
    const notifBtn = document.getElementById('btnNotifCenter');
    if (notifBtn) {
        const badge = document.createElement('span');
        badge.id = 'notificationBadge';
        badge.style.cssText = `
            position: absolute;
            top: -4px;
            right: -4px;
            background: #ff4757;
            color: #fff;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 50%;
            min-width: 18px;
            height: 18px;
            display: none;
            align-items: center;
            justify-content: center;
            border: 2px solid #0a192f;
        `;
        notifBtn.style.position = 'relative';
        notifBtn.appendChild(badge);
    }

    // إضافة أنماط الإشعارات
    if (!document.getElementById('notificationStyles')) {
        const style = document.createElement('style');
        style.id = 'notificationStyles';
        style.textContent = `
            @keyframes slideUp {
                from { opacity: 0; transform: translateY(30px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes slideDown {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(30px); }
            }
        `;
        document.head.appendChild(style);
    }
});

// ==========================================================================
// 9. تصدير الدوال المهمة للاستخدام من صفحات أخرى
// ==========================================================================
window.getCurrentUser = getCurrentUser;
window.isAdminUser = isAdminUser;
window.closeModal = closeModal;
window.openModal = openModal;
window.navigateToNotification = navigateToNotification;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.loadNotifications = loadNotifications;