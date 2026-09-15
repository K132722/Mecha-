// ==========================================================================
// 1. البيانات الأساسية للأعضاء وإعدادات Firebase
// ==========================================================================
const MEMBERS = {
    "774132722": { name: "أبو جراح الخولاني", role: "admin" },
    "774339391": { name: "أحمد الأصبحي", role: "member" },
    "774882442": { name: "أحمد أنعم", role: "member" },
    "776677398": { name: "أيمن العودي", role: "member" },
    "779865375": { name: "حمزة غراب", role: "member" },
    "772261443": { name: "إلياس العصيمي", role: "member" },
    "773611986": { name: "أحمد الحجي", role: "member" },
    "777598384": { name: "سليم الوافي", role: "member" }
};

const ADMIN_PHONE = "+967774132722";
const firebaseConfig = {
    apiKey: "AIzaSyBL_cR0OwbQ3KPYemGY0Q8aliIlXmQkBrU",
    authDomain: "khaled-12ab5.firebaseapp.com",
    databaseURL: "https://khaled-12ab5-default-rtdb.firebaseio.com",
    projectId: "khaled-12ab5",
    storageBucket: "khaled-12ab5.firebasestorage.app",
    messagingSenderId: "75339042920",
    appId: "1:75339042920:web:2f58ca848a8328afc06bdd"
};

let db = null;
if (typeof firebase !== 'undefined' && firebase.database) {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
    } catch (error) {
        console.warn('⚠️ تعذر تهيئة Firebase، سيعمل التطبيق بالكاش المحلي:', error);
    }
} else {
    console.warn('📡 مكتبة Firebase غير متاحة، تم تفعيل وضع الأوفلاين.');
}

let currentUser = null;
let currentMember = null;
let hiddenRandomNumber = null;
let notificationsData = [];
let unreadCount = 0;
let isFirstLoad = true; // لمنع تكرار التحقق
let presenceHeartbeat = null;
let bannerLiveListener = null;
let lastLiveBannerId = null;
let dailyBanners = [];
let currentBannerIndex = 0;
let bannerRotationTimer = null;
let bannerDayKey = '';
let bannerTouchStartY = null;
let editingBannerId = null;
let notificationLiveListener = null;
const USAGE_POLICY_VERSION = '1';
const USAGE_POLICY_SEEN_PREFIX = 'usage_policy_seen_v';
const ACCOUNT_STATUS_CACHE_PREFIX = 'account_status_';

// توليد أو جلب معرف الجهاز الفريد
function getDeviceId() {
    let devId = localStorage.getItem('app_device_id');
    if (!devId) {
        devId = 'dev_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('app_device_id', devId);
    }
    return devId;
}

function accountStatusCacheKey(phone) {
    return `${ACCOUNT_STATUS_CACHE_PREFIX}${String(phone || '').replace(/[^\dA-Za-z_-]/g, '_')}`;
}

function readCachedAccountStatus(phone) {
    try {
        const value = localStorage.getItem(accountStatusCacheKey(phone));
        return value ? JSON.parse(value) : null;
    } catch (error) {
        return null;
    }
}

function saveCachedAccountStatus(phone, status) {
    try {
        localStorage.setItem(accountStatusCacheKey(phone), JSON.stringify(status || { status: 'active' }));
    } catch (error) {}
}

function normalizeAccountStatus(statusValue, bannedValue) {
    const status = statusValue && typeof statusValue === 'object' ? { ...statusValue } : {};
    const banned = bannedValue && typeof bannedValue === 'object' ? bannedValue : null;
    if (banned && (banned.active !== false || banned.status === 'banned')) {
        return {
            ...status,
            status: 'banned',
            banned: true,
            bannedAt: banned.bannedAt || status.bannedAt || null,
            reason: banned.reason || status.reason || 'مخالفة سياسة الاستخدام'
        };
    }
    return {
        status: status.status || 'active',
        canUserAddContent: status.canUserAddContent !== false,
        warningCount: Number(status.warningCount || 0),
        contentRestrictedUntil: Number(status.contentRestrictedUntil || 0),
        suspendedUntil: Number(status.suspendedUntil || 0),
        reason: status.reason || ''
    };
}

function accountStatusIsBlocked(status) {
    if (!status) return false;
    if (status.status === 'banned' || status.banned === true) return true;
    return status.status === 'suspended' && (!status.suspendedUntil || status.suspendedUntil > Date.now());
}

function accountStatusMessage(status) {
    if (status?.status === 'banned' || status?.banned) {
        return `⛔ تم توقيف حسابك نهائياً. السبب: ${status.reason || 'مخالفة سياسة الاستخدام'}`;
    }
    if (status?.status === 'suspended') {
        const until = status.suspendedUntil
            ? new Date(status.suspendedUntil).toLocaleString('ar-YE')
            : 'حتى إشعار آخر';
        return `🔴 تم تجميد حسابك مؤقتاً حتى ${until}. السبب: ${status.reason || 'مخالفة سياسة الاستخدام'}`;
    }
    return '';
}

function isAdminAccount(user = currentUser) {
    const phone = String(user?.phone || '');
    return user?.role === 'admin' ||
        phone === ADMIN_PHONE ||
        phone === ADMIN_PHONE.replace('+967', '');
}

function currentPresenceRef() {
    if (!db || !currentUser?.phone || !currentUser?.deviceId) return null;
    return db.ref(`users/${currentUser.phone}/devices/${currentUser.deviceId}/presence`);
}

function updatePresence(isOnline = true) {
    const ref = currentPresenceRef();
    if (!ref) return;
    const now = Date.now();
    const payload = {
        online: Boolean(isOnline),
        lastSeenAt: now,
        lastSeen: new Date(now).toLocaleString('ar-YE')
    };
    ref.update(payload).catch(() => {});
    db.ref(`users/${currentUser.phone}/devices/${currentUser.deviceId}`).update(payload).catch(() => {});
}

function startPresenceTracking() {
    const ref = currentPresenceRef();
    if (!ref || !navigator.onLine) return;
    ref.onDisconnect().update({
        online: false,
        lastSeenAt: Date.now(),
        lastSeen: new Date().toLocaleString('ar-YE')
    }).catch(() => {});
    updatePresence(true);
    clearInterval(presenceHeartbeat);
    presenceHeartbeat = setInterval(() => {
        if (navigator.onLine) updatePresence(true);
    }, 30000);
}

function stopPresenceTracking() {
    clearInterval(presenceHeartbeat);
    presenceHeartbeat = null;
    updatePresence(false);
}

function listenToLiveBanner() {
    if (!db || !currentUser) return;
    const dayKey = getBannerDayKey();
    if (bannerLiveListener && bannerDayKey === dayKey) return;
    if (bannerLiveListener) {
        bannerLiveListener.off();
        bannerLiveListener = null;
    }
    bannerDayKey = dayKey;
    bannerLiveListener = db.ref(`daily_banners/${dayKey}`);
    bannerLiveListener.on('value', snapshot => {
        const value = snapshot.val() || {};
        setDailyBanners(Object.values(value).map(normalizeBanner).filter(Boolean), true);
    });
}

function startPersonalNotificationListener() {
    if (!db || !currentUser?.phone || notificationLiveListener) return;
    const path = isAdminAccount() ? 'admin_notifications' : `user_notifications/${currentUser.phone}`;
    const ref = db.ref(path).limitToLast(50);
    const listener = snapshot => {
        const value = snapshot.val();
        if (!value) return;
        const notification = { ...value, id: value.id || snapshot.key };
        if (notificationsData.some(item => item.id === notification.id || (item.message === notification.message && item.timestamp === notification.timestamp))) return;
        notificationsData.unshift(notification);
        notificationsData = notificationsData.slice(0, 100);
        localStorage.setItem(notificationsStorageKey(), JSON.stringify(notificationsData));
        updateNotificationBadge();
        if (document.getElementById('notificationsModal')?.style.display === 'flex') {
            renderNotificationsList();
        }
    };
    ref.on('child_added', listener);
    notificationLiveListener = { ref, listener };
}

async function openOnlineUsersModal() {
    const modal = document.getElementById('onlineUsersModal');
    const list = document.getElementById('onlineUsersList');
    if (!modal || !list) return;
    modal.style.display = 'flex';
    list.innerHTML = '<p class="empty-banner">جاري تحميل حالة الاتصال...</p>';
    if (!db || !navigator.onLine) {
        list.innerHTML = '<p class="empty-banner">تحتاج هذه القائمة إلى اتصال بالإنترنت.</p>';
        return;
    }
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        const rows = [];
        Object.entries(MEMBERS).forEach(([phone, member]) => {
            const devices = users[phone]?.devices || {};
            Object.entries(devices).forEach(([deviceId, device]) => {
                if (device?.online === true || (device?.lastSeenAt && Date.now() - Number(device.lastSeenAt) < 90000)) {
                    rows.push({ phone, member, deviceId, device });
                }
            });
        });
        if (!rows.length) {
            list.innerHTML = '<p class="empty-banner">لا يوجد مستخدمون متصلون حالياً.</p>';
            return;
        }
        list.innerHTML = rows.map(row => `
            <div class="online-user-row">
                <span class="online-avatar">●</span>
                <div>
                    <strong>${row.member.name}</strong>
                    <small>الجهاز ${row.deviceId} · آخر نشاط ${row.device.lastSeen || row.device.lastActive || 'الآن'}</small>
                </div>
                <span class="online-now">متصل</span>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = '<p class="empty-banner">تعذر تحميل قائمة المتصلين حالياً.</p>';
    }
}

async function fetchAccountStatus(phone) {
    const cached = readCachedAccountStatus(phone);
    if (!db || !navigator.onLine || !phone) {
        return cached || { status: 'active', canUserAddContent: true, warningCount: 0 };
    }

    try {
        const [statusSnapshot, bannedSnapshot] = await Promise.all([
            db.ref(`users/${phone}/accountStatus`).once('value'),
            db.ref(`banned_users/${phone}`).once('value')
        ]);
        const normalized = normalizeAccountStatus(statusSnapshot.val(), bannedSnapshot.val());
        saveCachedAccountStatus(phone, normalized);
        return normalized;
    } catch (error) {
        return cached || { status: 'active', canUserAddContent: true, warningCount: 0 };
    }
}

function enforceAccountRestriction(status) {
    const message = accountStatusMessage(status);
    if (!message) return;
    localStorage.removeItem('mecha_user_session');
    localStorage.removeItem('mecha_logged_in');
    currentUser = null;
    currentMember = null;
    showLoginScreen();
    const loginMsg = document.getElementById('loginMsg');
    if (loginMsg) {
        loginMsg.innerHTML = message;
        loginMsg.style.color = '#ff4757';
    }
}

function usagePolicySeenKey(phone) {
    return `${USAGE_POLICY_SEEN_PREFIX}${USAGE_POLICY_VERSION}_${String(phone || 'guest')}`;
}

function openUsagePolicyModal(markAsSeen = true) {
    if (markAsSeen && currentUser?.phone) {
        try {
            localStorage.setItem(usagePolicySeenKey(currentUser.phone), String(Date.now()));
        } catch (error) {}
    }
    openModal('usagePolicyModal');
}

function showUsagePolicyOnFirstVisit() {
    if (!currentUser?.phone) return;
    try {
        if (!localStorage.getItem(usagePolicySeenKey(currentUser.phone))) {
            setTimeout(() => openUsagePolicyModal(true), 450);
        }
    } catch (error) {}
}

// ==========================================================================
// 2. بدء التطبيق - التحقق من الجلسة فوراً
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupEvents();

    // أولاً: إخفاء شاشة الدخول افتراضياً
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContent').style.display = 'none';

    // التحقق من وجود جلسة محفوظة
    const savedUserSession = localStorage.getItem('mecha_user_session');

    if (savedUserSession) {
        try {
            currentUser = JSON.parse(savedUserSession);
            // التحقق من صحة بيانات الجلسة
            if (currentUser && currentUser.phone && currentUser.name) {
                console.log('✅ جلسة موجودة للمستخدم:', currentUser.name);
                // تشغيل التطبيق مباشرة (بدون التحقق من السيرفر لتسريع العملية)
                launchAppDirectly();

                // في الخلفية، تحقق من صحة الجلسة مع السيرفر (اختياري)
                if (navigator.onLine) {
                    verifyDeviceSessionInBackground(currentUser);
                }
                return;
            }
        } catch (e) {
            console.log('❌ خطأ في قراءة الجلسة:', e);
            localStorage.removeItem('mecha_user_session');
        }
    }

    // لا توجد جلسة صالحة -> عرض شاشة الدخول
    console.log('🔐 لا توجد جلسة صالحة، عرض شاشة الدخول');
    showLoginScreen();
});

// ==========================================================================
// 3. عرض شاشة الدخول
// ==========================================================================
function showLoginScreen() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('appContent').style.display = 'none';
    document.getElementById('stepPhone').style.display = 'block';
    document.getElementById('stepRequestCode').style.display = 'none';
    document.getElementById('loginMsg').innerHTML = '';
    document.getElementById('loginMsg2').innerHTML = '';
    document.getElementById('phoneInput').value = '';
    document.getElementById('codeInput').value = '';
}

// ==========================================================================
// 4. التحقق من رقم الهاتف
// ==========================================================================
document.getElementById('btnCheckPhone').addEventListener('click', () => {
    const phone = document.getElementById('phoneInput').value.trim();
    const msgEl = document.getElementById('loginMsg');

    if (!phone) {
        msgEl.innerHTML = '⚠️ يرجى إدخال رقم الهاتف!';
        msgEl.style.color = '#ff4757';
        return;
    }

    const member = MEMBERS[phone];
    if (!member) {
        msgEl.innerHTML = '❌ رقم الهاتف غير مسجل في المنظومة!';
        msgEl.style.color = '#ff4757';
        return;
    }

    // حفظ العضو وتوليد الرقم العشوائي
    currentMember = { phone, ...member };
    hiddenRandomNumber = Math.floor(10000 + Math.random() * 90000).toString();
    localStorage.setItem('temp_auth_code', hiddenRandomNumber);

    // عرض اسم المستخدم
    document.getElementById('verifiedUserName').innerHTML = `👤 المهندس <strong style="color:var(--gold-secondary);">${member.name}</strong>`;

    // توليد وعرض الرمز المشفر
    generateAndDisplayEncodedCode();

    // الانتقال للخطوة الثانية
    document.getElementById('stepPhone').style.display = 'none';
    document.getElementById('stepRequestCode').style.display = 'block';
    msgEl.innerHTML = '';
});

// ==========================================================================
// 5. توليد وعرض الرمز المشفر
// ==========================================================================
function generateAndDisplayEncodedCode() {
    if (!currentMember || !hiddenRandomNumber) {
        return;
    }

    const requestText = `${hiddenRandomNumber}\nمرحبا أريد منحي الإذن ورمز الدخول للتطبيق`;
    const encodedText = btoa(unescape(encodeURIComponent(requestText)));

    const displayInput = document.getElementById('encodedCodeDisplay');
    if (displayInput) {
        displayInput.value = encodedText;
        displayInput.style.color = '#4fc3f7';
    }

    return encodedText;
}

// ==========================================================================
// 6. نسخ الرمز المشفر
// ==========================================================================
document.getElementById('btnCopyEncoded').addEventListener('click', async () => {
    const displayInput = document.getElementById('encodedCodeDisplay');

    if (!displayInput || !displayInput.value || displayInput.value === 'جاري التوليد...') {
        alert('⚠️ يرجى التحقق من رقم الهاتف أولاً');
        return;
    }

    try {
        await navigator.clipboard.writeText(displayInput.value);
        const btn = document.getElementById('btnCopyEncoded');
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ تم النسخ';
        btn.style.background = '#2ed573';
        btn.style.borderColor = '#2ed573';
        btn.style.color = '#fff';

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
        }, 2500);
    } catch {
        displayInput.select();
        document.execCommand('copy');
        alert('✅ تم نسخ الرمز بنجاح!');
    }
});

// ==========================================================================
// 7. طلب التحقق عبر واتساب
// ==========================================================================
document.getElementById('btnRequestCode').addEventListener('click', () => {
    if (!currentMember || !hiddenRandomNumber) {
        alert('⚠️ يرجى التحقق من رقم الهاتف أولاً.');
        return;
    }

    const encodedText = document.getElementById('encodedCodeDisplay').value;
    if (!encodedText || encodedText === 'جاري التوليد...') {
        alert('⚠️ حدث خطأ في توليد الرمز');
        return;
    }

    const waLink = `https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(encodedText)}`;
    window.open(waLink, '_blank');

    document.getElementById('loginMsg2').innerHTML = '📱 تم فتح واتساب، أرسل الرمز المشفر للمشرف وانتظر الرد.';
    document.getElementById('loginMsg2').style.color = 'var(--gold-secondary)';
});

// ==========================================================================
// 8. التحقق من رمز الدخول
// ==========================================================================
document.getElementById('btnVerifyCode').addEventListener('click', () => {
    const enteredCode = document.getElementById('codeInput').value.trim();
    const msgEl = document.getElementById('loginMsg2');

    if (!enteredCode) {
        msgEl.innerHTML = '⚠️ يرجى إدخال رمز التحقق!';
        msgEl.style.color = '#ff4757';
        return;
    }

    if (!hiddenRandomNumber) {
        msgEl.innerHTML = '⚠️ يرجى طلب رمز التحقق أولاً!';
        msgEl.style.color = '#ff4757';
        return;
    }

    const correctCode = (parseInt(hiddenRandomNumber) * 3).toString();

    if (enteredCode === correctCode) {
        msgEl.innerHTML = '✅ رمز صحيح، جاري التحقق من الجهاز...';
        msgEl.style.color = '#2ed573';

        const deviceId = getDeviceId();
        handleDeviceRegistration(currentMember.phone, deviceId);
    } else {
        msgEl.innerHTML = '❌ رمز التحقق غير صحيح!';
        msgEl.style.color = '#ff4757';
    }
});

// ==========================================================================
// 9. إدارة تسجيل الأجهزة
// ==========================================================================
async function handleDeviceRegistration(phone, deviceId) {
    try {
        const accountStatus = await fetchAccountStatus(phone);
        if (accountStatusIsBlocked(accountStatus)) {
            enforceAccountRestriction(accountStatus);
            return;
        }
        if (!db || !navigator.onLine) {
            completeLogin(phone, deviceId);
            return;
        }
        const snap = await db.ref(`users/${phone}/devices`).once('value');
        const devices = snap.val() || {};

        if (devices[deviceId]) {
            completeLogin(phone, deviceId);
            return;
        }

        const deviceKeys = Object.keys(devices);

        if (deviceKeys.length === 0) {
            await db.ref(`users/${phone}/devices/${deviceId}`).set({
                registeredAt: new Date().toLocaleString('ar-YE'),
                lastActive: new Date().toLocaleString('ar-YE'),
                status: 'active'
            });
            logUserActivity(phone, deviceId, 'first_login');
            completeLogin(phone, deviceId);
        } else {
            requestDeviceApproval(phone, deviceId);
        }
    } catch (e) {
        console.error('خطأ في التحقق من الجهاز:', e);
        // في حالة عدم وجود اتصال، نسمح بالدخول
        completeLogin(phone, deviceId);
    }
}

function requestDeviceApproval(phone, deviceId) {
    const member = MEMBERS[phone];
    const deviceInfo = {
        phone: phone,
        memberName: member.name,
        deviceId: deviceId,
        userAgent: navigator.userAgent.slice(0, 50),
        timestamp: new Date().toLocaleString('ar-YE'),
        status: 'pending'
    };

    db.ref(`pending_approvals/${phone}`).set(deviceInfo);

    sendAdminNotification({
        type: 'device_approval',
        title: '🔐 طلب جهاز جديد',
        message: `المهندس ${member.name} يطلب الموافقة على جهاز جديد`,
        data: deviceInfo
    });

    const msgEl = document.getElementById('loginMsg2');
    msgEl.innerHTML = '⏳ تم إرسال طلبك للمشرف، يرجى الانتظار للموافقة...';
    msgEl.style.color = 'var(--gold-secondary)';

    listenForApproval(phone, deviceId);
}

function listenForApproval(phone, deviceId) {
    const approvalRef = db.ref(`pending_approvals/${phone}`);

    approvalRef.on('value', (snap) => {
        const data = snap.val();
        if (!data) return;

        if (data.status === 'approved') {
            approvalRef.off();
            db.ref(`users/${phone}/devices/${deviceId}`).set({
                registeredAt: data.timestamp || new Date().toLocaleString('ar-YE'),
                lastActive: new Date().toLocaleString('ar-YE'),
                status: 'active'
            });
            approvalRef.remove();

            document.getElementById('loginMsg2').innerHTML = '✅ تمت الموافقة على جهازك، جاري الدخول...';
            document.getElementById('loginMsg2').style.color = '#2ed573';

            setTimeout(() => {
                completeLogin(phone, deviceId);
            }, 1000);

        } else if (data.status === 'rejected') {
            approvalRef.off();
            document.getElementById('loginMsg2').innerHTML = '❌ تم رفض الجهاز من قبل المشرف.';
            document.getElementById('loginMsg2').style.color = '#ff4757';
        }
    });
}

// ==========================================================================
// 10. إكمال عملية الدخول - حفظ الجلسة بشكل دائم
// ==========================================================================
function completeLogin(phone, deviceId) {
    const member = MEMBERS[phone];

    currentUser = {
        phone: phone,
        name: member.name,
        role: member.role,
        deviceId: deviceId,
        loginTime: new Date().toLocaleString('ar-YE'),
        isLoggedIn: true // علامة إضافية للتأكيد
    };

    // حفظ الجلسة في localStorage بشكل دائم
    localStorage.setItem('mecha_user_session', JSON.stringify(currentUser));
    localStorage.setItem('mecha_logged_in', 'true'); // علامة إضافية

    // تحديث نشاط الجهاز
    if (navigator.onLine && db) {
        db.ref(`users/${phone}/devices/${deviceId}`).update({
            lastActive: new Date().toLocaleString('ar-YE')
        });
        logUserActivity(phone, deviceId, 'login');
    }

    // تشغيل التطبيق مباشرة
    launchAppDirectly();
}

// ==========================================================================
// 11. التحقق من الجلسة في الخلفية (اختياري، غير مانع للدخول)
// ==========================================================================
async function verifyDeviceSessionInBackground(user) {
    try {
        const accountStatus = await fetchAccountStatus(user.phone);
        if (accountStatusIsBlocked(accountStatus)) {
            console.log('⚠️ الحساب موقوف، تسجيل الخروج...');
            enforceAccountRestriction(accountStatus);
            return;
        }
        if (!db) return;
        const snap = await db.ref(`users/${user.phone}/devices/${user.deviceId}`).once('value');
        const deviceData = snap.val();

        if (!deviceData ||
            (deviceData.status === 'suspended' && (!deviceData.suspendedUntil || Number(deviceData.suspendedUntil) > Date.now())) ||
            deviceData.status === 'banned') {
            // إذا تم تعليق الجهاز، نقوم بتسجيل الخروج
            console.log('⚠️ الجهاز تم تعليقه، تسجيل الخروج...');
            localStorage.removeItem('mecha_user_session');
            localStorage.removeItem('mecha_logged_in');
            showLoginScreen();
            return;
        }

        // تحديث وقت النشاط
        db.ref(`users/${user.phone}/devices/${user.deviceId}`).update({
            lastActive: new Date().toLocaleString('ar-YE')
        });

        logUserActivity(user.phone, user.deviceId, 'session_restore');

    } catch (e) {
        console.log('⚠️ تعذر التحقق من الجلسة في الخلفية:', e);
        // لا نقوم بأي إجراء، المستخدم ما زال داخل التطبيق
    }
}

// ==========================================================================
// 12. تشغيل الواجهة الرئيسية - تظهر دائماً بدون شاشة دخول
// ==========================================================================
function launchAppDirectly() {
    // إخفاء شاشة الدخول بشكل قاطع
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContent').style.display = 'flex';

    const isAdmin = (currentUser.role === 'admin' || currentUser.phone === ADMIN_PHONE);

    // تحديث معلومات المستخدم في الترويسة
    document.getElementById('userNameDisplay').innerText = `مرحباً المهندس ${currentUser.name}`;
    document.getElementById('userRoleDisplay').innerText = isAdmin ? 'مدير النظام' : 'عضو معتمد';
    document.getElementById('deviceIdDisplay').innerText = `📱 المعرف: ${currentUser.deviceId || 'غير معروف'}`;

    // جميع الأعضاء يستطيعون نشر منشور واحد يومياً، بينما تبقى صلاحيات الإدارة كما هي.
    const bannerAddBtn = document.getElementById('btnAdminAddBanner');
    if (bannerAddBtn) bannerAddBtn.style.display = 'inline-flex';

    const usersDataCard = document.getElementById('btnUsersData');
    if (usersDataCard) {
        usersDataCard.style.display = isAdmin ? 'flex' : 'none';
    }

    const studyBtn = document.getElementById('btnStudyMaterials');
    if (studyBtn) {
        studyBtn.style.display = 'flex';
    }

    const cachedAccountStatus = readCachedAccountStatus(currentUser.phone);
    if (accountStatusIsBlocked(cachedAccountStatus)) {
        enforceAccountRestriction(cachedAccountStatus);
        return;
    }

    // تحديث حالة الشبكة
    updateNetworkStatus();

    // تحميل البيانات
    loadBannerLocallyOrOnline(false);
    loadNotifications();
    showUsagePolicyOnFirstVisit();

    if (isAdmin) {
        loadPendingApprovals();
    }
    startPresenceTracking();
    listenToLiveBanner();
    startPersonalNotificationListener();
}

// ==========================================================================
// 13. تسجيل نشاط المستخدمين
// ==========================================================================
function logUserActivity(phone, deviceId, action) {
    const member = MEMBERS[phone];
    const activityLog = {
        phone: phone,
        memberName: member ? member.name : 'غير معروف',
        deviceId: deviceId,
        action: action,
        timestamp: new Date().toLocaleString('ar-YE'),
        userAgent: navigator.userAgent.slice(0, 50)
    };

    if (navigator.onLine && db) {
        db.ref(`activity_logs/${phone}/${Date.now()}`).set(activityLog);
    }

    if (!isAdminAccount({ phone })) {
        let actionText = '';
        switch(action) {
            case 'first_login': actionText = '🔓 دخل لأول مرة'; break;
            case 'login': actionText = '🔓 قام بتسجيل الدخول'; break;
            case 'session_restore': actionText = '🔄 استعاد الجلسة'; break;
            default: actionText = '📱 نشاط جديد';
        }

        sendAdminNotification({
            type: 'user_activity',
            title: `👤 ${actionText}`,
            message: `المهندس ${member ? member.name : 'غير معروف'}`,
            data: activityLog
        });
    }
}

// ==========================================================================
// 14. إرسال إشعارات للمشرف
// ==========================================================================
function sendAdminNotification(notif) {
    const adminNotif = {
        ...notif,
        read: false,
        timestamp: new Date().toLocaleString('ar-YE')
    };

    if (navigator.onLine && db) {
        db.ref(`admin_notifications/${Date.now()}`).set(adminNotif);
    }

    if (isAdminAccount()) {
        notificationsData.unshift(adminNotif);
        updateNotificationBadge();
    }
}

// ==========================================================================
// 15. إدارة الإشعارات
// ==========================================================================
function notificationsStorageKey() {
    return currentUser?.phone ? `cached_notifications_${currentUser.phone}` : 'cached_notifications';
}

async function loadNotifications() {
    const storageKey = notificationsStorageKey();
    const savedNotifications = localStorage.getItem(storageKey) || (
        currentUser?.phone ? localStorage.getItem('cached_notifications') : null
    );
    if (savedNotifications) {
        try {
            notificationsData = JSON.parse(savedNotifications);
            updateNotificationBadge();
        } catch (e) {}
    }

    if (navigator.onLine && db && currentUser?.phone) {
        try {
            const notificationPath = isAdminAccount()
                ? 'admin_notifications'
                : `user_notifications/${currentUser.phone}`;
            const snap = await db.ref(notificationPath).orderByChild('timestamp').limitToLast(50).once('value');
            const data = snap.val();
            if (data) {
                notificationsData = Object.values(data).reverse();
                localStorage.setItem(storageKey, JSON.stringify(notificationsData));
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

// ==========================================================================
// 16. تحميل طلبات الموافقة المعلقة (للمشرف)
// ==========================================================================
function loadPendingApprovals() {
    if (!isAdminAccount() || !db || !navigator.onLine) return;

    db.ref('pending_approvals').on('value', (snap) => {
        const data = snap.val();
        if (!data) return;

        const pendingCount = Object.keys(data).filter(key => data[key].status === 'pending').length;
        if (pendingCount > 0) {
            showApprovalNotification(pendingCount);
        }
    });
}

function showApprovalNotification(count) {
    const notifDiv = document.createElement('div');
    notifDiv.className = 'notification-toast';
    notifDiv.style.cssText = `
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

    notifDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="flex:1;">
                <div style="color:var(--gold-secondary); font-weight:700; font-size:14px;">🔐 طلبات موافقة معلقة</div>
                <div style="color:var(--text-muted); font-size:12px; margin-top:4px;">لديك ${count} طلب(طلبات) موافقة على أجهزة جديدة</div>
                <button onclick="openModal('usersDataModal'); this.parentElement.parentElement.parentElement.remove();" style="
                    background: var(--gold-grad);
                    color: #060d18;
                    border: none;
                    padding: 6px 14px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 700;
                    margin-top: 8px;
                ">👀 عرض الطلبات</button>
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

    document.body.appendChild(notifDiv);

    setTimeout(() => {
        if (notifDiv.parentElement) {
            notifDiv.style.animation = 'slideDown 0.5s ease';
            setTimeout(() => notifDiv.remove(), 500);
        }
    }, 30000);
}

// ==========================================================================
// 17. عرض بيانات الأعضاء ومراقبة الأجهزة
// ==========================================================================
async function loadUsersDevicesData() {
    const listEl = document.getElementById('usersDevicesList');
    listEl.innerHTML = 'جاري تحليل الأجهزة والنشاط...';

    if (!navigator.onLine || !db) {
        listEl.innerHTML = '⚠️ يتطلب اتصال بالإنترنت لجلب بيانات الأجهزة الحديثة.';
        return;
    }

    try {
        const usersSnap = await db.ref('users').once('value');
        const usersData = usersSnap.val() || {};

        const pendingSnap = await db.ref('pending_approvals').once('value');
        const pendingData = pendingSnap.val() || {};
        const bannedSnap = await db.ref('banned_users').once('value');
        const bannedData = bannedSnap.val() || {};

        let html = '';

        const pendingRequests = Object.entries(pendingData).filter(([key, val]) => val.status === 'pending');
        if (pendingRequests.length > 0) {
            html += `
                <div style="background:rgba(255,165,0,0.1); border:1px solid #ffa500; padding:16px; border-radius:12px; margin-bottom:16px;">
                    <h4 style="color:#ffa500; margin:0 0 12px 0;">⏳ طلبات موافقة معلقة (${pendingRequests.length})</h4>
            `;

            pendingRequests.forEach(([key, val]) => {
                html += `
                    <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <b style="color:var(--gold-secondary);">👤 المهندس ${val.memberName}</b>
                                <div style="font-size:11px; color:var(--text-dim);">📱 المعرف: ${val.deviceId}</div>
                                <div style="font-size:10px; color:var(--text-dim);">⏰ ${val.timestamp}</div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button onclick="approveDevice('${key}', '${val.phone}', '${val.deviceId}')" style="
                                    background:#2ed573;
                                    color:#fff;
                                    border:none;
                                    padding:4px 12px;
                                    border-radius:6px;
                                    cursor:pointer;
                                    font-size:11px;
                                ">✅ موافقة</button>
                                <button onclick="rejectDevice('${key}', '${val.phone}')" style="
                                    background:#ff4757;
                                    color:#fff;
                                    border:none;
                                    padding:4px 12px;
                                    border-radius:6px;
                                    cursor:pointer;
                                    font-size:11px;
                                ">❌ رفض</button>
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
        }

        html += `<h4 style="color:var(--gold-secondary); margin:16px 0 12px 0;">👥 الأعضاء المسجلين</h4>`;

        Object.entries(MEMBERS).forEach(([phone, member]) => {
            const userDevices = usersData[phone]?.devices || {};
            const deviceKeys = Object.keys(userDevices);
            const deviceCount = deviceKeys.length;
            const accountStatus = normalizeAccountStatus(usersData[phone]?.accountStatus, bannedData[phone]);
            const statusIsBanned = accountStatus.status === 'banned' || accountStatus.banned;
            const statusIsSuspended = accountStatus.status === 'suspended' && accountStatus.suspendedUntil > Date.now();
            const statusIsRestricted = accountStatus.canUserAddContent === false && accountStatus.contentRestrictedUntil > Date.now();
            const statusLabel = statusIsBanned
                ? '⛔ محظور نهائياً'
                : statusIsSuspended
                    ? `🔴 موقوف حتى ${new Date(accountStatus.suspendedUntil).toLocaleDateString('ar-YE')}`
                    : statusIsRestricted
                        ? `🟠 رفع الملفات مقيّد حتى ${new Date(accountStatus.contentRestrictedUntil).toLocaleDateString('ar-YE')}`
                        : '🟢 نشط';

            let warning = '';
            if (deviceCount > 1) {
                warning = `
                    <div style="background:rgba(255,71,87,0.15); border:1px solid #ff4757; padding:8px; border-radius:8px; margin-top:6px; font-size:11px; color:#ff4757;">
                        ⚠️ تنبيه أمني: هذا العضو مسجل من (${deviceCount}) أجهزة مختلفة!
                    </div>
                `;
            }

            let devicesList = '';
            if (deviceCount > 0) {
                devicesList = `
                    <div style="font-size:10px; color:var(--text-dim); margin-top:6px;">
                        <div style="font-weight:600; color:var(--text-muted);">الأجهزة:</div>
                        ${deviceKeys.map(did => {
                            const device = userDevices[did] || {};
                            const blocked = device.status === 'suspended' || device.status === 'banned';
                            return `
                            <div style="padding:4px; border-bottom:1px solid rgba(255,255,255,0.05);">
                                <div style="display:flex;justify-content:space-between;gap:6px;">
                                    <span>📱 ${did}</span>
                                    <span style="color:${device.online ? '#2ed573' : '#7a8a9a'};">${device.online ? '🟢 متصل' : '⚪ غير متصل'} · ${device.status || 'نشط'}</span>
                                </div>
                                <div style="display:flex;align-items:center;gap:5px;margin-top:4px;">
                                    <span style="flex:1;color:var(--text-dim);">آخر اتصال: ${device.lastSeen || device.lastActive || 'غير معروف'}</span>
                                    ${blocked
                                        ? `<button onclick="restoreDeviceAccess('${phone}','${did}')" style="background:rgba(74,222,128,.12);color:#4ade80;border:1px solid rgba(74,222,128,.25);padding:4px 7px;border-radius:6px;cursor:pointer;font-size:9px;">🔓 إعادة السماح</button>`
                                        : `<button onclick="suspendDevice('${phone}','${did}')" style="background:rgba(255,107,122,.12);color:#ff8794;border:1px solid rgba(255,107,122,.25);padding:4px 7px;border-radius:6px;cursor:pointer;font-size:9px;">⏸️ مؤقت</button>
                                           <button onclick="banDevice('${phone}','${did}')" style="background:rgba(255,71,87,.12);color:#ff6b7a;border:1px solid rgba(255,71,87,.25);padding:4px 7px;border-radius:6px;cursor:pointer;font-size:9px;">⛔ نهائي</button>`}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                `;
            }

            html += `
                <div style="background:rgba(255,255,255,0.03); padding:12px; margin-bottom:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b style="color:var(--text-light);">👤 المهندس ${member.name}</b>
                        <span style="font-size:11px; color:var(--gold-secondary);">${member.role === 'admin' ? '👑 مدير' : 'عضو'}</span>
                    </div>
                    <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">📱 رقم الهاتف: ${phone}</div>
                    <div style="font-size:11px; color:var(--text-dim);">💻 عدد الأجهزة المسجلة: ${deviceCount}</div>
                    <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; margin-top:8px; padding:7px 9px; border-radius:8px; background:rgba(255,255,255,0.035);">
                        <span style="font-size:11px; color:${statusIsBanned || statusIsSuspended ? '#ff6b7a' : statusIsRestricted ? '#ffa500' : '#2ed573'};">${statusLabel}</span>
                        <span style="font-size:10px; color:var(--text-dim);">الإنذارات: ${accountStatus.warningCount || 0}</span>
                    </div>
                    ${devicesList}
                    ${warning}
                    ${currentUser?.phone === ADMIN_PHONE ? `
                        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:10px;">
                            <button onclick="issueMemberWarning('${phone}')" style="background:rgba(255,165,0,.14); color:#ffc04d; border:1px solid rgba(255,165,0,.3); padding:6px 9px; border-radius:7px; cursor:pointer; font-size:10px;">⚠️ إنذار</button>
                            ${statusIsSuspended
                                ? `<button onclick="restoreMemberAccess('${phone}')" style="background:rgba(74,222,128,.12); color:#4ade80; border:1px solid rgba(74,222,128,.25); padding:6px 9px; border-radius:7px; cursor:pointer; font-size:10px;">✅ رفع الإيقاف</button>`
                                : `<button onclick="suspendMember('${phone}')" style="background:rgba(255,107,122,.12); color:#ff8794; border:1px solid rgba(255,107,122,.25); padding:6px 9px; border-radius:7px; cursor:pointer; font-size:10px;">⏸️ إيقاف</button>`}
                            ${statusIsBanned
                                ? `<button onclick="restoreMemberAccess('${phone}')" style="background:rgba(74,222,128,.12); color:#4ade80; border:1px solid rgba(74,222,128,.25); padding:6px 9px; border-radius:7px; cursor:pointer; font-size:10px;">🔓 إلغاء الحظر</button>`
                                : `<button onclick="banMember('${phone}')" style="background:rgba(255,71,87,.14); color:#ff6b7a; border:1px solid rgba(255,71,87,.3); padding:6px 9px; border-radius:7px; cursor:pointer; font-size:10px;">⛔ حظر نهائي</button>`}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        listEl.innerHTML = html;
    } catch (e) {
        console.error('خطأ في تحميل بيانات الأعضاء:', e);
        listEl.innerHTML = '❌ تعذر جلب البيانات من السيرفر.';
    }
}

function isAdminOperator() {
    return !!currentUser && (currentUser.phone === ADMIN_PHONE || currentUser.role === 'admin');
}

function moderationActionReady() {
    if (!isAdminOperator()) {
        alert('⚠️ هذه الصلاحية متاحة لمدير النظام فقط.');
        return false;
    }
    if (!db || !navigator.onLine) {
        alert('⚠️ يلزم الاتصال بالإنترنت لتنفيذ إجراء إداري.');
        return false;
    }
    return true;
}

async function sendMemberModerationNotification(phone, title, message, data = {}) {
    if (!db) return;
    const payload = {
        title,
        message,
        type: 'moderation',
        timestamp: Date.now(),
        read: false,
        recipientPhone: String(phone),
        data: { ...data }
    };
    await db.ref(`user_notifications/${phone}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}`).set(payload);
}

async function issueMemberWarning(phone) {
    if (!moderationActionReady()) return;
    const member = MEMBERS[phone];
    const reason = prompt(`اكتب سبب إنذار ${member?.name || phone}:`, 'مخالفة سياسة النشر');
    if (!reason?.trim()) return;

    try {
        const statusSnapshot = await db.ref(`users/${phone}/accountStatus`).once('value');
        const currentStatus = normalizeAccountStatus(statusSnapshot.val(), null);
        const warningCount = Number(currentStatus.warningCount || 0) + 1;
        const now = Date.now();
        const nextStatus = {
            ...currentStatus,
            warningCount,
            lastWarningAt: now,
            lastWarningReason: reason.trim(),
            updatedAt: now,
            updatedBy: ADMIN_PHONE
        };
        let title = '🟡 إنذار رسمي';
        let message = `تم تسجيل الإنذار رقم ${warningCount}: ${reason.trim()}`;

        if (warningCount === 2) {
            nextStatus.canUserAddContent = false;
            nextStatus.contentRestrictedUntil = now + (3 * 24 * 60 * 60 * 1000);
            message += ' — تم تقييد رفع الملفات والمنشورات لمدة 3 أيام.';
            title = '🟠 إنذار ثانٍ وتقييد الصلاحيات';
        } else if (warningCount === 3) {
            nextStatus.status = 'suspended';
            nextStatus.suspendedUntil = now + (7 * 24 * 60 * 60 * 1000);
            nextStatus.reason = reason.trim();
            message += ' — تم تجميد الحساب لمدة 7 أيام.';
            title = '🔴 إنذار ثالث وتجميد مؤقت';
        } else if (warningCount >= 4) {
            nextStatus.status = 'banned';
            nextStatus.banned = true;
            nextStatus.reason = reason.trim();
            nextStatus.bannedAt = now;
            nextStatus.canUserAddContent = false;
            message += ' — تم توقيف الحساب نهائياً وحظر الرقم والأجهزة.';
            title = '⛔ حظر نهائي';
        }

        const warningId = `warning_${now}`;
        const updates = {
            [`users/${phone}/accountStatus`]: nextStatus,
            [`users/${phone}/warnings/${warningId}`]: {
                id: warningId,
                number: warningCount,
                reason: reason.trim(),
                issuedAt: now,
                issuedBy: ADMIN_PHONE,
                action: title
            }
        };
        if (warningCount >= 4) {
            updates[`banned_users/${phone}`] = {
                phone,
                memberName: member?.name || phone,
                deviceIds: Object.keys((await db.ref(`users/${phone}/devices`).once('value')).val() || {}),
                status: 'banned',
                active: true,
                bannedAt: now,
                reason: reason.trim(),
                issuedBy: ADMIN_PHONE
            };
        }
        await db.ref().update(updates);
        saveCachedAccountStatus(phone, nextStatus);
        await sendMemberModerationNotification(phone, title, message, { warningNumber: warningCount, reason: reason.trim() });
        alert(`✅ تم تسجيل الإنذار رقم ${warningCount} وإرسال الإشعار للمستخدم.`);
        loadUsersDevicesData();
    } catch (error) {
        console.error('تعذر تسجيل إنذار العضو:', error);
        alert('❌ تعذر تنفيذ الإنذار، حاول مرة أخرى.');
    }
}

async function suspendMember(phone) {
    if (!moderationActionReady()) return;
    const member = MEMBERS[phone];
    const daysText = prompt(`مدة إيقاف ${member?.name || phone} بالأيام:`, '7');
    const days = Number(daysText);
    if (!Number.isFinite(days) || days <= 0) return;
    const reason = prompt('سبب الإيقاف:', 'مخالفة سياسة الاستخدام');
    if (!reason?.trim()) return;
    const suspendedUntil = Date.now() + (days * 24 * 60 * 60 * 1000);
    const nextStatus = {
        ...normalizeAccountStatus((await db.ref(`users/${phone}/accountStatus`).once('value')).val(), null),
        status: 'suspended',
        suspendedUntil,
        reason: reason.trim(),
        updatedAt: Date.now(),
        updatedBy: ADMIN_PHONE
    };
    try {
        await db.ref(`users/${phone}/accountStatus`).set(nextStatus);
        saveCachedAccountStatus(phone, nextStatus);
        await sendMemberModerationNotification(phone, '🔴 تم إيقاف الحساب مؤقتاً', `تم إيقاف حسابك لمدة ${days} يوماً. السبب: ${reason.trim()}`, { suspendedUntil, reason: reason.trim() });
        alert('✅ تم إيقاف المستخدم وإرسال الإشعار.');
        loadUsersDevicesData();
    } catch (error) {
        console.error('تعذر إيقاف العضو:', error);
        alert('❌ تعذر تنفيذ الإيقاف.');
    }
}

async function banMember(phone) {
    if (!moderationActionReady()) return;
    const member = MEMBERS[phone];
    if (!confirm(`هل أنت متأكد من حظر ${member?.name || phone} نهائياً؟`)) return;
    const reason = prompt('سبب الحظر النهائي:', 'تكرار مخالفة سياسة الاستخدام');
    if (!reason?.trim()) return;
    const now = Date.now();
    const nextStatus = {
        ...normalizeAccountStatus((await db.ref(`users/${phone}/accountStatus`).once('value')).val(), null),
        status: 'banned',
        banned: true,
        canUserAddContent: false,
        bannedAt: now,
        reason: reason.trim(),
        updatedAt: now,
        updatedBy: ADMIN_PHONE
    };
    try {
        const devices = (await db.ref(`users/${phone}/devices`).once('value')).val() || {};
        await db.ref().update({
            [`users/${phone}/accountStatus`]: nextStatus,
            [`banned_users/${phone}`]: {
                phone,
                memberName: member?.name || phone,
                deviceIds: Object.keys(devices),
                status: 'banned',
                active: true,
                bannedAt: now,
                reason: reason.trim(),
                issuedBy: ADMIN_PHONE
            }
        });
        saveCachedAccountStatus(phone, nextStatus);
        await sendMemberModerationNotification(phone, '⛔ تم حظر الحساب نهائياً', `تم توقيف حسابك نهائياً. السبب: ${reason.trim()}`, { reason: reason.trim() });
        alert('✅ تم حظر المستخدم وإرسال الإشعار.');
        loadUsersDevicesData();
    } catch (error) {
        console.error('تعذر حظر العضو:', error);
        alert('❌ تعذر تنفيذ الحظر.');
    }
}

async function restoreMemberAccess(phone) {
    if (!moderationActionReady()) return;
    const member = MEMBERS[phone];
    if (!confirm(`هل تريد إعادة تفعيل حساب ${member?.name || phone} وإلغاء الحظر أو الإيقاف؟`)) return;
    const currentStatus = normalizeAccountStatus((await db.ref(`users/${phone}/accountStatus`).once('value')).val(), null);
    const nextStatus = {
        ...currentStatus,
        status: 'active',
        banned: false,
        canUserAddContent: true,
        contentRestrictedUntil: 0,
        suspendedUntil: 0,
        restoredAt: Date.now(),
        restoredBy: ADMIN_PHONE
    };
    try {
        await db.ref().update({
            [`users/${phone}/accountStatus`]: nextStatus,
            [`banned_users/${phone}`]: null
        });
        saveCachedAccountStatus(phone, nextStatus);
        await sendMemberModerationNotification(phone, '✅ تمت إعادة تفعيل الحساب', 'تم إلغاء الإيقاف أو الحظر عن حسابك، ويمكنك استخدام التطبيق مجدداً.', {});
        alert('✅ تمت إعادة تفعيل المستخدم.');
        loadUsersDevicesData();
    } catch (error) {
        console.error('تعذر إعادة تفعيل العضو:', error);
        alert('❌ تعذر إعادة التفعيل.');
    }
}

async function suspendDevice(phone, deviceId) {
    if (!moderationActionReady()) return;
    const days = Number(prompt('مدة إيقاف الجهاز بالأيام:', '7'));
    if (!Number.isFinite(days) || days <= 0) return;
    const reason = prompt('سبب إيقاف الجهاز:', 'مخالفة سياسة الاستخدام');
    if (!reason?.trim()) return;
    try {
        const suspendedUntil = Date.now() + days * 24 * 60 * 60 * 1000;
        await db.ref(`users/${phone}/devices/${deviceId}`).update({
            status: 'suspended',
            suspendedUntil,
            reason: reason.trim(),
            online: false,
            updatedAt: Date.now(),
            updatedBy: ADMIN_PHONE
        });
        await sendMemberModerationNotification(phone, '🔴 تم إيقاف جهاز', `تم إيقاف الجهاز ${deviceId} لمدة ${days} يوماً. السبب: ${reason.trim()}`, { deviceId, suspendedUntil });
        alert('✅ تم إيقاف الجهاز وإرسال إشعار خاص للمستخدم.');
        loadUsersDevicesData();
    } catch (error) {
        alert('❌ تعذر إيقاف الجهاز.');
    }
}

async function banDevice(phone, deviceId) {
    if (!moderationActionReady()) return;
    const reason = prompt('سبب الحظر النهائي للجهاز:', 'مخالفة أمنية');
    if (!reason?.trim() || !confirm('هل تريد حظر هذا الجهاز نهائياً؟')) return;
    try {
        await db.ref(`users/${phone}/devices/${deviceId}`).update({
            status: 'banned',
            banned: true,
            bannedAt: Date.now(),
            reason: reason.trim(),
            online: false,
            updatedBy: ADMIN_PHONE
        });
        await sendMemberModerationNotification(phone, '⛔ تم حظر جهاز نهائياً', `تم حظر الجهاز ${deviceId} نهائياً. السبب: ${reason.trim()}`, { deviceId });
        alert('✅ تم حظر الجهاز وإرسال إشعار خاص للمستخدم.');
        loadUsersDevicesData();
    } catch (error) {
        alert('❌ تعذر حظر الجهاز.');
    }
}

async function restoreDeviceAccess(phone, deviceId) {
    if (!moderationActionReady()) return;
    if (!confirm('هل تريد إعادة السماح لهذا الجهاز؟')) return;
    try {
        await db.ref(`users/${phone}/devices/${deviceId}`).update({
            status: 'active',
            banned: false,
            suspendedUntil: 0,
            reason: '',
            restoredAt: Date.now(),
            restoredBy: ADMIN_PHONE
        });
        await sendMemberModerationNotification(phone, '✅ تمت إعادة السماح بالجهاز', `تمت إعادة السماح للجهاز ${deviceId} ويمكن استخدام التطبيق مجدداً.`, { deviceId });
        alert('✅ تمت إعادة تفعيل الجهاز.');
        loadUsersDevicesData();
    } catch (error) {
        alert('❌ تعذر إعادة تفعيل الجهاز.');
    }
}

// ==========================================================================
// 18. وظائف الموافقة على الأجهزة (للمشرف)
// ==========================================================================
function approveDevice(pendingKey, phone, deviceId) {
    if (!confirm(`هل أنت متأكد من الموافقة على هذا الجهاز للمهندس ${MEMBERS[phone]?.name || phone}؟`)) return;
    if (!db || !navigator.onLine) {
        alert('⚠️ يلزم الاتصال بالإنترنت لتنفيذ الإجراء.');
        return;
    }

    db.ref(`pending_approvals/${pendingKey}`).update({ status: 'approved' });
    db.ref(`users/${phone}/devices/${deviceId}`).set({
        registeredAt: new Date().toLocaleString('ar-YE'),
        lastActive: new Date().toLocaleString('ar-YE'),
        status: 'active'
    });

    setTimeout(() => {
        db.ref(`pending_approvals/${pendingKey}`).remove();
        loadUsersDevicesData();
    }, 500);
}

function rejectDevice(pendingKey, phone) {
    if (!confirm(`هل أنت متأكد من رفض هذا الجهاز للمهندس ${MEMBERS[phone]?.name || phone}؟`)) return;
    if (!db || !navigator.onLine) {
        alert('⚠️ يلزم الاتصال بالإنترنت لتنفيذ الإجراء.');
        return;
    }

    db.ref(`pending_approvals/${pendingKey}`).update({ status: 'rejected' });

    setTimeout(() => {
        db.ref(`pending_approvals/${pendingKey}`).remove();
        loadUsersDevicesData();
    }, 500);
}

// ==========================================================================
// 19. إدارة حاوية الإعلانات
// ==========================================================================
function getBannerDayKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function bannerCacheKey(dayKey = getBannerDayKey()) {
    return `cached_daily_banners_${dayKey}`;
}

function bannerAuthorKey(phone = currentUser?.phone) {
    return String(phone || 'unknown').replace(/[^\dA-Za-z_-]/g, '_');
}

function bannerPath(dayKey, bannerId) {
    return `daily_banners/${dayKey}/${bannerId}`;
}

function normalizeBanner(data) {
    if (!data || typeof data !== 'object') return null;
    const createdAt = Number(data.createdAt || data.updatedAt || Date.now());
    return {
        ...data,
        id: String(data.id || bannerAuthorKey(data.authorPhone)),
        title: String(data.title || ''),
        text: String(data.text || ''),
        link: String(data.link || ''),
        img: String(data.img || ''),
        authorPhone: String(data.authorPhone || ''),
        authorName: String(data.authorName || 'عضو المنظومة'),
        createdAt,
        updatedAt: Number(data.updatedAt || createdAt),
        dateKey: data.dateKey || getBannerDayKey(createdAt),
        timestamp: data.timestamp || new Date(createdAt).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
    };
}

function escapeBannerHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function safeBannerLink(value) {
    const link = String(value || '').trim();
    return /^https?:\/\//i.test(link) ? link : '';
}

function canManageBanner(banner) {
    if (!banner || !currentUser) return false;
    return isAdminAccount() || String(banner.authorPhone) === String(currentUser.phone);
}

function setDailyBanners(items, fromLiveUpdate = false) {
    const nextItems = (items || [])
        .map(normalizeBanner)
        .filter(item => item && item.dateKey === getBannerDayKey())
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

    const currentId = dailyBanners[currentBannerIndex]?.id;
    dailyBanners = nextItems;
    if (currentId) {
        const nextIndex = dailyBanners.findIndex(item => item.id === currentId);
        currentBannerIndex = nextIndex >= 0 ? nextIndex : Math.min(currentBannerIndex, Math.max(dailyBanners.length - 1, 0));
    } else {
        currentBannerIndex = Math.min(currentBannerIndex, Math.max(dailyBanners.length - 1, 0));
    }

    try {
        localStorage.setItem(bannerCacheKey(), JSON.stringify(dailyBanners));
    } catch (error) {}

    renderCurrentBanner(fromLiveUpdate ? 'live' : 'replace');
    startBannerRotation();
}

function renderBannerEmpty(message = 'لا توجد إعلانات منشورة اليوم.') {
    const area = document.getElementById('bannerDisplayArea');
    const date = document.getElementById('bannerDate');
    const counter = document.getElementById('bannerCounter');
    if (date) date.innerText = 'اليوم';
    if (counter) counter.innerText = '0 / 0';
    if (area) area.innerHTML = `<div class="empty-banner">${escapeBannerHtml(message)}</div>`;
    ['btnBannerPrev', 'btnBannerNext'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = true;
    });
}

function renderCurrentBanner(animation = 'replace') {
    const area = document.getElementById('bannerDisplayArea');
    const counter = document.getElementById('bannerCounter');
    const prev = document.getElementById('btnBannerPrev');
    const next = document.getElementById('btnBannerNext');
    if (!area) return;

    if (!dailyBanners.length) {
        renderBannerEmpty();
        return;
    }

    currentBannerIndex = Math.max(0, Math.min(currentBannerIndex, dailyBanners.length - 1));
    const banner = dailyBanners[currentBannerIndex];
    const link = safeBannerLink(banner.link);
    const authorLabel = escapeBannerHtml(banner.authorName);
    const title = escapeBannerHtml(banner.title);
    const text = escapeBannerHtml(banner.text).replace(/\n/g, '<br>');
    const image = banner.img
        ? `<img class="banner-image" src="${escapeBannerHtml(banner.img)}" alt="${title || 'صورة الإعلان'}">`
        : '';
    const editActions = canManageBanner(banner)
        ? `<div class="banner-owner-actions">
                <button type="button" class="banner-action-btn edit" onclick="openBannerEditor('${escapeBannerHtml(banner.id)}')">✎ تعديل</button>
                <button type="button" class="banner-action-btn delete" onclick="deleteBanner('${escapeBannerHtml(banner.id)}')">حذف</button>
           </div>`
        : '';

    area.innerHTML = `
        <article class="banner-slide ${animation === 'next' ? 'slide-from-bottom' : animation === 'prev' ? 'slide-from-top' : animation === 'live' ? 'slide-live' : ''}">
            <div class="banner-meta">
                <span class="banner-author">نشره: <strong>${authorLabel}</strong></span>
                <span class="banner-time">${escapeBannerHtml(banner.timestamp)}</span>
            </div>
            ${title ? `<h4>${title}</h4>` : ''}
            ${text ? `<p>${text}</p>` : ''}
            ${image}
            ${link ? `<a class="banner-link" href="${escapeBannerHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 فتح الرابط المرفق</a>` : ''}
            <div class="banner-footer">${editActions}<span class="banner-day-label">يختفي تلقائياً عند انتهاء اليوم</span></div>
        </article>
    `;

    const date = document.getElementById('bannerDate');
    if (date) date.innerHTML = `${escapeBannerHtml(banner.timestamp)} <span class="live-update-pill">منشور اليوم</span>`;
    if (counter) counter.innerText = `${currentBannerIndex + 1} / ${dailyBanners.length}`;
    if (prev) prev.disabled = dailyBanners.length < 2;
    if (next) next.disabled = dailyBanners.length < 2;
}

function showBannerAt(index, direction = 'next') {
    if (!dailyBanners.length) return;
    currentBannerIndex = (index + dailyBanners.length) % dailyBanners.length;
    renderCurrentBanner(direction);
}

function startBannerRotation() {
    clearInterval(bannerRotationTimer);
    bannerRotationTimer = null;
    if (dailyBanners.length < 2) return;
    bannerRotationTimer = setInterval(() => {
        showBannerAt(currentBannerIndex + 1, 'next');
    }, 5000);
}

async function cleanupExpiredBanners(dayKey = getBannerDayKey()) {
    if (!db || !navigator.onLine) return;
    try {
        const snapshot = await db.ref('daily_banners').once('value');
        const allDays = snapshot.val() || {};
        const updates = {};
        Object.keys(allDays).filter(key => key < dayKey).forEach(key => {
            updates[`daily_banners/${key}`] = null;
        });
        if (Object.keys(updates).length) await db.ref().update(updates);
    } catch (error) {
        // انتهاء الصلاحية لا يمنع المستخدم من رؤية منشورات اليوم إذا تعذر الحذف الشبكي.
    }
}

async function loadBannerLocallyOrOnline(forceFetch = false) {
    const dayKey = getBannerDayKey();
    bannerDayKey = dayKey;
    let localBanners = [];
    try {
        localBanners = JSON.parse(localStorage.getItem(bannerCacheKey(dayKey)) || '[]');
    } catch (error) {}

    if (localBanners.length) setDailyBanners(localBanners);
    else renderBannerEmpty('جاري تحميل إعلانات اليوم...');

    if (!navigator.onLine || !db) {
        if (!localBanners.length) renderBannerEmpty('لا توجد إعلانات محفوظة محلياً لليوم.');
        return;
    }

    cleanupExpiredBanners(dayKey);
    try {
        const snap = await db.ref(`daily_banners/${dayKey}`).once('value');
        const onlineBanners = Object.values(snap.val() || {});
        setDailyBanners(onlineBanners);
        if (forceFetch) alert('✅ تم تحديث إعلانات اليوم بنجاح!');
    } catch (error) {
        if (!localBanners.length) renderBannerEmpty('تعذر تحميل الإعلانات حالياً.');
    }
}

// ==========================================================================
// 20. نشر وتعديل وحذف الإعلانات اليومية
// ==========================================================================
document.getElementById('btnPublishBanner').addEventListener('click', async () => {
    const title = document.getElementById('bannerTitleInput').value.trim();
    const text = document.getElementById('bannerTextInput').value.trim();
    const link = document.getElementById('bannerLinkInput').value.trim();
    const fileInput = document.getElementById('bannerImgInput');

    if (!title && !text && fileInput.files.length === 0) {
        return alert('⚠️ يرجى كتابة نص أو إرفاق صورة للإعلان!');
    }
    if (!currentUser?.phone) return alert('⚠️ يجب تسجيل الدخول أولاً.');
    if (!db || !navigator.onLine) return alert('⚠️ يلزم الاتصال بالإنترنت لنشر الإعلان ومشاركته مع بقية الأعضاء.');

    let imgBase64 = '';
    if (fileInput.files.length > 0) {
        imgBase64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(fileInput.files[0]);
        });
    }

    try {
        const accountStatus = await fetchAccountStatus(currentUser.phone);
        if (!isAdminAccount() && accountStatus.canUserAddContent === false) {
            return alert(accountStatusMessage(accountStatus) || '⚠️ تم تقييد صلاحية النشر لحسابك حالياً.');
        }
        const dayKey = getBannerDayKey();
        const authorId = bannerAuthorKey(currentUser.phone);
        const targetId = editingBannerId || authorId;
        const targetRef = db.ref(bannerPath(dayKey, targetId));
        const currentSnapshot = await targetRef.once('value');
        const currentBanner = normalizeBanner(currentSnapshot.val());

        if (!editingBannerId && currentBanner) {
            return alert('⚠️ لديك إعلان منشور بالفعل اليوم. يمكنك تعديله أو حذفه من نفس اللوحة.');
        }
        if (editingBannerId && currentBanner && !canManageBanner(currentBanner)) {
            return alert('❌ لا يمكنك تعديل إعلان عضو آخر.');
        }
        if (editingBannerId && !currentBanner) {
            return alert('⚠️ الإعلان المطلوب تعديله لم يعد موجوداً.');
        }

        const now = Date.now();
        const newBanner = normalizeBanner({
            id: targetId,
            title,
            text,
            link: safeBannerLink(link),
            img: imgBase64 || currentBanner?.img || '',
            authorPhone: currentBanner?.authorPhone || currentUser.phone,
            authorName: currentBanner?.authorName || currentUser.name,
            createdAt: currentBanner?.createdAt || now,
            updatedAt: now,
            dateKey: dayKey,
            timestamp: new Date(now).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
        });

        await targetRef.set(newBanner);
        const nextItems = dailyBanners.filter(item => item.id !== newBanner.id);
        nextItems.push(newBanner);
        currentBannerIndex = nextItems.findIndex(item => item.id === newBanner.id);
        setDailyBanners(nextItems);

        document.getElementById('bannerTitleInput').value = '';
        document.getElementById('bannerTextInput').value = '';
        document.getElementById('bannerLinkInput').value = '';
        document.getElementById('bannerImgInput').value = '';

        closeModal('addBannerModal');
        editingBannerId = null;
        document.getElementById('bannerModalTitle').innerText = '➕ إدراج إعلان / تعميم اليوم';
        document.getElementById('btnPublishBanner').innerText = 'نشر الإعلان';
        alert(currentBanner ? '✅ تم تعديل إعلانك بنجاح!' : '✅ تم نشر إعلانك اليوم بنجاح!');
    } catch (error) {
        alert('❌ حدث خطأ أثناء حفظ الإعلان، حاول مرة أخرى.');
    }
});

function openBannerEditor(bannerId) {
    const banner = dailyBanners.find(item => item.id === String(bannerId));
    if (!banner || !canManageBanner(banner)) return;
    editingBannerId = banner.id;
    document.getElementById('bannerModalTitle').innerText = '✎ تعديل إعلانك اليوم';
    document.getElementById('btnPublishBanner').innerText = 'حفظ التعديل';
    document.getElementById('bannerTitleInput').value = banner.title || '';
    document.getElementById('bannerTextInput').value = banner.text || '';
    document.getElementById('bannerLinkInput').value = banner.link || '';
    document.getElementById('bannerImgInput').value = '';
    openModal('addBannerModal');
}

async function deleteBanner(bannerId) {
    const banner = dailyBanners.find(item => item.id === String(bannerId));
    if (!banner || !canManageBanner(banner)) return alert('❌ لا يمكنك حذف هذا الإعلان.');
    if (!confirm('هل تريد حذف إعلانك لهذا اليوم؟')) return;
    if (!db || !navigator.onLine) return alert('⚠️ يلزم الاتصال بالإنترنت لحذف الإعلان من اللوحة.');
    try {
        await db.ref(bannerPath(getBannerDayKey(), banner.id)).remove();
        setDailyBanners(dailyBanners.filter(item => item.id !== banner.id));
        alert('✅ تم حذف الإعلان.');
    } catch (error) {
        alert('❌ تعذر حذف الإعلان حالياً.');
    }
}

// ==========================================================================
// 21. فتح نافذة الإشعارات
// ==========================================================================
function openNotificationsModal() {
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
        const icon = notif.type === 'device_approval' ? '🔐' :
                    notif.type === 'user_activity' ? '👤' : '📝';

        html += `
            <div style="
                background: ${isRead ? 'rgba(255,255,255,0.02)' : 'rgba(212,175,55,0.05)'};
                border: 1px solid ${isRead ? 'rgba(255,255,255,0.03)' : 'rgba(212,175,55,0.1)'};
                border-radius: 12px;
                padding: 14px 16px;
                margin-bottom: 10px;
            ">
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
                        ${notif.data ? `<div style="color:var(--text-dim); font-size:10px; margin-top:4px;">📱 ${notif.data.deviceId || ''}</div>` : ''}
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
        localStorage.setItem(notificationsStorageKey(), JSON.stringify(notificationsData));
        updateNotificationBadge();
        renderNotificationsList();
    }
}

function markAllNotificationsRead() {
    notificationsData.forEach(n => n.read = true);
    localStorage.setItem(notificationsStorageKey(), JSON.stringify(notificationsData));
    updateNotificationBadge();
    renderNotificationsList();
}

// ==========================================================================
// 22. الأحداث والتنقلات
// ==========================================================================
function setupEvents() {
    document.getElementById('btnRefreshData').addEventListener('click', () => loadBannerLocallyOrOnline(true));
    document.getElementById('btnAdminAddBanner').addEventListener('click', () => {
        editingBannerId = null;
        document.getElementById('bannerModalTitle').innerText = '➕ إدراج إعلان / تعميم اليوم';
        document.getElementById('btnPublishBanner').innerText = 'نشر الإعلان';
        document.getElementById('bannerTitleInput').value = '';
        document.getElementById('bannerTextInput').value = '';
        document.getElementById('bannerLinkInput').value = '';
        document.getElementById('bannerImgInput').value = '';
        openModal('addBannerModal');
    });
    document.getElementById('btnBannerPrev').addEventListener('click', () => {
        showBannerAt(currentBannerIndex - 1, 'prev');
        startBannerRotation();
    });
    document.getElementById('btnBannerNext').addEventListener('click', () => {
        showBannerAt(currentBannerIndex + 1, 'next');
        startBannerRotation();
    });
    const bannerArea = document.getElementById('bannerDisplayArea');
    if (bannerArea) {
        bannerArea.addEventListener('mouseenter', () => clearInterval(bannerRotationTimer));
        bannerArea.addEventListener('mouseleave', startBannerRotation);
        bannerArea.addEventListener('touchstart', event => {
            bannerTouchStartY = event.touches[0]?.clientY ?? null;
            clearInterval(bannerRotationTimer);
        }, { passive: true });
        bannerArea.addEventListener('touchend', event => {
            if (bannerTouchStartY === null) return;
            const endY = event.changedTouches[0]?.clientY ?? bannerTouchStartY;
            const delta = endY - bannerTouchStartY;
            if (Math.abs(delta) > 35) {
                showBannerAt(currentBannerIndex + (delta < 0 ? 1 : -1), delta < 0 ? 'next' : 'prev');
            }
            bannerTouchStartY = null;
            startBannerRotation();
        }, { passive: true });
    }
    document.getElementById('btnUsagePolicy').addEventListener('click', () => openUsagePolicyModal(false));

    document.getElementById('btnStudyMaterials').addEventListener('click', () => {
        window.location.href = 'study-materials.html';
    });

    document.getElementById('btnNotifCenter').addEventListener('click', () => {
        openNotificationsModal();
        if (navigator.onLine && db) {
            loadNotifications();
        }
    });

    document.getElementById('btnUsersData').addEventListener('click', () => {
        openModal('usersDataModal');
        loadUsersDevicesData();
    });

    document.getElementById('btnLogout').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من تسجيل الخروج؟ ستحتاج لإعادة التحقق.')) {
            if (currentUser && currentUser.phone && currentUser.deviceId && navigator.onLine && db) {
                stopPresenceTracking();
                db.ref(`users/${currentUser.phone}/devices/${currentUser.deviceId}`).update({
                    lastActive: new Date().toLocaleString('ar-YE'),
                    lastSeenAt: Date.now(),
                    lastSeen: new Date().toLocaleString('ar-YE'),
                    online: false,
                    status: 'inactive'
                });
            }
            localStorage.removeItem('mecha_user_session');
            localStorage.removeItem('mecha_logged_in');
            localStorage.removeItem('temp_auth_code');
            currentUser = null;
            showLoginScreen();
        }
    });
}

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

window.addEventListener('online', () => {
    updateNetworkStatus();
    startPresenceTracking();
    listenToLiveBanner();
    loadBannerLocallyOrOnline(true);
});
window.addEventListener('offline', () => {
    updateNetworkStatus();
    updatePresence(false);
});

setInterval(() => {
    const nextDayKey = getBannerDayKey();
    if (currentUser && bannerDayKey && nextDayKey !== bannerDayKey) {
        dailyBanners = [];
        currentBannerIndex = 0;
        bannerDayKey = nextDayKey;
        if (bannerLiveListener) {
            bannerLiveListener.off();
            bannerLiveListener = null;
        }
        loadBannerLocallyOrOnline(true);
        listenToLiveBanner();
    }
}, 60000);

function openModal(id) { 
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex'; 
}

function closeModal(id) { 
    const el = document.getElementById(id);
    if (el) el.style.display = 'none'; 
}

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.style.display = 'none';
        });
    }
});

// ==========================================================================
// 23. دوال مساعدة
// ==========================================================================
function isAdminUser() {
    const user = getCurrentUser();
    return user && (user.role === 'admin' || user.phone === ADMIN_PHONE);
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
// 24. إضافة شارة الإشعارات
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
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
            .notification-toast {
                animation: slideUp 0.5s ease;
            }
        `;
        document.head.appendChild(style);
    }
});

// ==========================================================================
// 25. تصدير الدوال
// ==========================================================================
window.getCurrentUser = getCurrentUser;
window.isAdminUser = isAdminUser;
window.closeModal = closeModal;
window.openModal = openModal;
window.loadUsersDevicesData = loadUsersDevicesData;
window.approveDevice = approveDevice;
window.rejectDevice = rejectDevice;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.loadNotifications = loadNotifications;
window.suspendDevice = suspendDevice;
window.banDevice = banDevice;
window.restoreDeviceAccess = restoreDeviceAccess;
