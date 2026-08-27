// ==========================================================================
// 1. إعدادات Firebase والأعضاء الأساسيين (بدون رموز)
// ==========================================================================
const ADMIN_PHONE = "774132722";
const ADMIN_NAME = "أبو جراح الخولاني";

// قائمة الأعضاء الأساسيين (اسم + رقم هاتف فقط)
const BASE_MEMBERS = {
    "774132722": { name: "أبو جراح الخولاني", role: "admin" },
    "774339391": { name: "أحمد الأصبحي", role: "member" },
    "774882442": { name: "أحمد أنعم", role: "member" },
    "776677398": { name: "أيمن العودي", role: "member" },
    "779865375": { name: "حمزة غراب", role: "member" },
    "772261443": { name: "إلياس العصيمي", role: "member" },
    "773611986": { name: "أحمد الحجي", role: "member" },
    "777598384": { name: "سليم الوافي", role: "member" }
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

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let pendingApprovalData = null;
let currentPhoneForVerification = null;
let verificationCode = null;

// توليد أو جلب معرف الجهاز الفريد
function getDeviceId() {
    let devId = localStorage.getItem('app_device_id');
    if (!devId) {
        devId = 'DEV_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('app_device_id', devId);
    }
    return devId;
}

// ==========================================================================
// 2. تهيئة الأعضاء الأساسيين في Firebase (مرة واحدة)
// ==========================================================================
function initializeBaseMembers() {
    Object.entries(BASE_MEMBERS).forEach(([phone, data]) => {
        db.ref(`users/${phone}`).once('value').then(snapshot => {
            if (!snapshot.exists()) {
                db.ref(`users/${phone}`).set({
                    name: data.name,
                    role: data.role,
                    registeredAt: new Date().toLocaleString('ar-YE'),
                    isBaseMember: true
                });
            }
        });
    });
}

// استدعاء التهيئة
initializeBaseMembers();

// ==========================================================================
// 3. نظام تسجيل الدخول
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    
    // التحقق من الجلسة المحفوظة
    const savedUserSession = localStorage.getItem('mecha_user_session');
    if (savedUserSession) {
        currentUser = JSON.parse(savedUserSession);
        checkDevicePermission(currentUser.phone);
    } else {
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('appContent').style.display = 'none';
        showStep(1);
    }
    
    // مراقبة طلبات الموافقة الجديدة (للمشرف فقط)
    db.ref('pending_approvals').on('child_added', (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        const user = getCurrentUser();
        if (user && user.phone === ADMIN_PHONE) {
            showApprovalToast(data);
        }
    });
});

// عرض الخطوة المطلوبة
function showStep(step) {
    document.getElementById('step1').style.display = step === 1 ? 'block' : 'none';
    document.getElementById('step2').style.display = step === 2 ? 'block' : 'none';
    document.getElementById('phoneStatus').textContent = '';
    document.getElementById('verifyStatus').textContent = '';
}

// ==========================================================================
// 4. الخطوة 1: التحقق من رقم الهاتف
// ==========================================================================
document.getElementById('btnCheckPhone').addEventListener('click', () => {
    const phone = document.getElementById('phoneInput').value.trim();
    const statusEl = document.getElementById('phoneStatus');

    if (!phone) {
        statusEl.textContent = '⚠️ يرجى إدخال رقم الهاتف';
        statusEl.style.color = 'var(--error-color)';
        return;
    }

    if (phone.length < 9 || phone.length > 10) {
        statusEl.textContent = '⚠️ رقم الهاتف يجب أن يكون 9-10 أرقام';
        statusEl.style.color = 'var(--error-color)';
        return;
    }

    // التحقق من وجود المستخدم في Firebase
    db.ref(`users/${phone}`).once('value').then(snapshot => {
        const userData = snapshot.val();
        
        if (userData) {
            // المستخدم موجود
            currentPhoneForVerification = phone;
            
            // إذا كان المشرف - دخول مباشر (بدون رمز)
            if (phone === ADMIN_PHONE) {
                loginUser(phone);
                return;
            }
            
            // التحقق من الجهاز
            checkDevicePermission(phone);
        } else {
            // مستخدم جديد - يطلب رمز التحقق
            currentPhoneForVerification = phone;
            showStep(2);
            statusEl.textContent = '✅ رقم غير مسجل، يرجى إرسال طلب للمشرف';
            statusEl.style.color = 'var(--gold-secondary)';
            
            // تشغيل زر إرسال واتساب تلقائياً مع رسالة مناسبة
            document.getElementById('btnSendWhatsApp').click();
        }
    }).catch(() => {
        // في حال عدم الاتصال - التحقق من localStorage
        const storedUser = localStorage.getItem(`user_${phone}`);
        if (storedUser) {
            currentPhoneForVerification = phone;
            checkDevicePermission(phone);
        } else {
            statusEl.textContent = '⚠️ يرجى الاتصال بالإنترنت للتحقق من المستخدم';
            statusEl.style.color = 'var(--error-color)';
        }
    });
});

// ==========================================================================
// 5. التحقق من صلاحية الجهاز
// ==========================================================================
function checkDevicePermission(phone) {
    // إذا كان المشرف - دخول مباشر
    if (phone === ADMIN_PHONE) {
        loginUser(phone);
        return;
    }

    const deviceId = getDeviceId();
    
    // جلب الأجهزة المسجلة لهذا المستخدم
    db.ref(`users_devices/${phone}`).once('value').then(snapshot => {
        const devices = snapshot.val() || {};
        const deviceKeys = Object.keys(devices);
        
        // إذا كان الجهاز مسجلاً مسبقاً - دخول مباشر
        if (devices[deviceId]) {
            logDeviceAccess(phone, deviceId, 'existing');
            loginUser(phone);
            return;
        }

        // إذا كان هناك أجهزة مسجلة أخرى - طلب موافقة
        if (deviceKeys.length > 0) {
            // جلب اسم المستخدم
            db.ref(`users/${phone}/name`).once('value').then(nameSnap => {
                const userName = nameSnap.val() || phone;
                // عرض رسالة للمستخدم
                document.getElementById('phoneStatus').textContent = 
                    `⚠️ هذا الحساب مسجل من قبل على جهاز آخر. جاري إرسال طلب موافقة للمشرف...`;
                document.getElementById('phoneStatus').style.color = 'var(--gold-secondary)';
                requestDeviceApproval(phone, deviceId, userName);
            });
            return;
        }

        // أول جهاز لهذا المستخدم - تسجيل مباشر
        registerNewDevice(phone, deviceId);
        loginUser(phone);
    }).catch(() => {
        // في حال عدم الاتصال - التحقق من localStorage
        const storedDevices = localStorage.getItem(`devices_${phone}`);
        if (storedDevices) {
            const devices = JSON.parse(storedDevices);
            if (devices[deviceId]) {
                loginUser(phone);
                return;
            }
        }
        // طلب موافقة في وضع عدم الاتصال
        document.getElementById('phoneStatus').textContent = 
            '⚠️ لا يوجد اتصال بالإنترنت، يرجى الاتصال للتحقق من الجهاز';
        document.getElementById('phoneStatus').style.color = 'var(--error-color)';
    });
}

// ==========================================================================
// 6. الخطوة 2: نظام المصادقة عبر واتساب
// ==========================================================================
document.getElementById('btnSendWhatsApp').addEventListener('click', () => {
    const phone = currentPhoneForVerification;
    if (!phone) {
        alert('⚠️ يرجى إدخال رقم الهاتف أولاً');
        return;
    }

    // جلب اسم المستخدم
    db.ref(`users/${phone}/name`).once('value').then(nameSnap => {
        const userName = nameSnap.val() || 'مستخدم جديد';
        
        // إنشاء رمز تحقق عشوائي
        verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // تشفير الرمز مع رقم الهاتف
        const plainText = `${phone}\n${verificationCode}\nطلب رمز دخول للمنظومة`;
        const encryptedData = btoa(unescape(encodeURIComponent(plainText)));
        
        // فتح محادثة واتساب مع المشرف
        const whatsappUrl = `https://wa.me/967${ADMIN_PHONE}?text=${encodeURIComponent(
            `🔐 طلب رمز دخول للمنظومة الهندسية\n\n` +
            `📱 رقم الهاتف: ${phone}\n` +
            `👤 اسم المستخدم: ${userName}\n` +
            `🖥️ معرف الجهاز: ${getDeviceId()}\n\n` +
            `🔑 رمز التحقق المشفر:\n${encryptedData}\n\n` +
            `📌 الرمز الصحيح هو: ${verificationCode}\n` +
            `⚠️ يرجى إرسال هذا الرمز للمستخدم لإكمال تسجيل الدخول`
        )}`;
        
        window.open(whatsappUrl, '_blank');
        
        document.getElementById('verifyStatus').textContent = 
            '📤 تم إرسال الطلب إلى المشرف عبر واتساب';
        document.getElementById('verifyStatus').style.color = 'var(--gold-secondary)';
    });
});

// تأكيد رمز التحقق وتسجيل الدخول
document.getElementById('btnVerifyCode').addEventListener('click', () => {
    const userInput = document.getElementById('verifyCodeInput').value.trim();
    const statusEl = document.getElementById('verifyStatus');

    if (!verificationCode) {
        statusEl.textContent = '⚠️ يرجى الضغط على "إرسال طلب التحقق" أولاً';
        statusEl.style.color = 'var(--error-color)';
        return;
    }

    if (!userInput) {
        statusEl.textContent = '⚠️ يرجى إدخال رمز التحقق';
        statusEl.style.color = 'var(--error-color)';
        return;
    }

    if (userInput === verificationCode) {
        // رمز صحيح - تسجيل المستخدم الجديد أو السماح بالدخول
        const phone = currentPhoneForVerification;
        
        // التحقق من وجود المستخدم في Firebase
        db.ref(`users/${phone}`).once('value').then(snapshot => {
            if (!snapshot.exists()) {
                // مستخدم جديد - تسجيله
                const userName = prompt('👤 يرجى إدخال اسمك الكامل:');
                if (userName && userName.trim()) {
                    db.ref(`users/${phone}`).set({
                        name: userName.trim(),
                        registeredAt: new Date().toLocaleString('ar-YE'),
                        role: 'member',
                        isBaseMember: false
                    });
                } else {
                    statusEl.textContent = '⚠️ يرجى إدخال اسم صحيح';
                    statusEl.style.color = 'var(--error-color)';
                    return;
                }
            }
            
            // تسجيل الجهاز والدخول
            registerNewDevice(phone, getDeviceId());
            loginUser(phone);
        });
    } else {
        statusEl.textContent = '❌ رمز التحقق غير صحيح!';
        statusEl.style.color = 'var(--error-color)';
    }
});

// ==========================================================================
// 7. تسجيل الأجهزة
// ==========================================================================
function registerNewDevice(phone, deviceId) {
    const deviceInfo = {
        deviceId: deviceId,
        registeredAt: new Date().toLocaleString('ar-YE'),
        userAgent: navigator.userAgent.slice(0, 50),
        lastLogin: new Date().toLocaleString('ar-YE')
    };

    // حفظ في Firebase
    db.ref(`users_devices/${phone}/${deviceId}`).set(deviceInfo);
    
    // حفظ في localStorage كنسخة احتياطية
    const stored = localStorage.getItem(`devices_${phone}`) || '{}';
    const devices = JSON.parse(stored);
    devices[deviceId] = deviceInfo;
    localStorage.setItem(`devices_${phone}`, JSON.stringify(devices));
}

function logDeviceAccess(phone, deviceId, type) {
    const accessLog = {
        deviceId: deviceId,
        accessTime: new Date().toLocaleString('ar-YE'),
        type: type,
        userAgent: navigator.userAgent.slice(0, 50)
    };

    db.ref(`access_logs/${phone}`).push(accessLog);
    
    // جلب اسم المستخدم للإشعار
    db.ref(`users/${phone}/name`).once('value').then(nameSnap => {
        const userName = nameSnap.val() || phone;
        
        // إشعار للمشرف
        sendAdminNotification({
            title: '🔄 تسجيل دخول متكرر',
            message: `المهندس ${userName} قام بتسجيل الدخول من جهازه المسجل (${deviceId}) للمرة الثانية`,
            path: 'users',
            timestamp: new Date().toLocaleString('ar-YE')
        });
    });
}

// ==========================================================================
// 8. طلب موافقة جهاز جديد
// ==========================================================================
function requestDeviceApproval(phone, deviceId, userName) {
    // حفظ طلب الموافقة في Firebase
    const approvalRequest = {
        phone: phone,
        deviceId: deviceId,
        userName: userName,
        requestedAt: new Date().toLocaleString('ar-YE'),
        status: 'pending',
        userAgent: navigator.userAgent.slice(0, 50)
    };

    db.ref(`pending_approvals/${phone}`).set(approvalRequest);

    // إشعار للمشرف
    sendAdminNotification({
        title: '⚠️ طلب موافقة جهاز جديد',
        message: `المهندس ${userName} يريد تسجيل جهاز جديد (${deviceId})`,
        path: 'approval',
        timestamp: new Date().toLocaleString('ar-YE')
    });

    // حفظ بيانات الطلب مؤقتاً
    pendingApprovalData = approvalRequest;

    // عرض رسالة للمستخدم
    document.getElementById('phoneStatus').textContent = 
        '📱 تم إرسال طلب موافقة للمشرف. يرجى الانتظار...';
    document.getElementById('phoneStatus').style.color = 'var(--gold-secondary)';
    
    // فتح نافذة الطلب للمشرف إذا كان هو المستخدم الحالي
    if (localStorage.getItem('mecha_user_session')) {
        const current = JSON.parse(localStorage.getItem('mecha_user_session'));
        if (current.phone === ADMIN_PHONE) {
            openApprovalModal(approvalRequest);
        }
    }
}

// ==========================================================================
// 9. الموافقة على جهاز جديد (للمشرف)
// ==========================================================================
function openApprovalModal(data) {
    const modal = document.getElementById('approvalModal');
    const details = document.getElementById('approvalDetails');
    
    details.innerHTML = `
        <div style="background:rgba(212,175,55,0.05); padding:12px; border-radius:12px;">
            <p><strong>👤 المستخدم:</strong> ${data.userName}</p>
            <p><strong>📱 رقم الهاتف:</strong> ${data.phone}</p>
            <p><strong>🖥️ معرف الجهاز:</strong> <code style="background:rgba(0,0,0,0.3); padding:2px 8px; border-radius:4px; font-size:11px;">${data.deviceId}</code></p>
            <p><strong>⏰ وقت الطلب:</strong> ${data.requestedAt}</p>
            <p><strong>🌐 المتصفح:</strong> ${data.userAgent}</p>
        </div>
    `;
    
    modal.style.display = 'flex';
}

// موافقة على جهاز جديد
document.getElementById('btnApproveDevice').addEventListener('click', () => {
    if (!pendingApprovalData) return;
    const phone = pendingApprovalData.phone;
    const deviceId = pendingApprovalData.deviceId;
    
    // تسجيل الجهاز الجديد
    registerNewDevice(phone, deviceId);
    
    // حذف طلب الموافقة
    db.ref(`pending_approvals/${phone}`).remove();
    
    // إشعار للمشرف
    db.ref(`users/${phone}/name`).once('value').then(nameSnap => {
        const userName = nameSnap.val() || phone;
        sendAdminNotification({
            title: '✅ تمت الموافقة على جهاز جديد',
            message: `تمت الموافقة على جهاز المهندس ${userName}`,
            path: 'users',
            timestamp: new Date().toLocaleString('ar-YE')
        });
    });
    
    closeModal('approvalModal');
    alert('✅ تمت الموافقة على الجهاز الجديد');
    pendingApprovalData = null;
});

// رفض جهاز جديد
document.getElementById('btnRejectDevice').addEventListener('click', () => {
    if (!pendingApprovalData) return;
    const phone = pendingApprovalData.phone;
    
    if (!confirm('هل أنت متأكد من رفض هذا الجهاز؟')) return;
    
    db.ref(`pending_approvals/${phone}`).remove();
    closeModal('approvalModal');
    alert('❌ تم رفض الجهاز الجديد');
    pendingApprovalData = null;
});

// ==========================================================================
// 10. تسجيل الدخول وتشغيل التطبيق
// ==========================================================================
function loginUser(phone) {
    // جلب اسم المستخدم من Firebase
    db.ref(`users/${phone}/name`).once('value').then(snapshot => {
        const userName = snapshot.val() || phone;
        const userRole = phone === ADMIN_PHONE ? 'admin' : 'member';

        currentUser = {
            phone: phone,
            name: userName,
            role: userRole,
            loginTime: new Date().toLocaleString('ar-YE'),
            deviceId: getDeviceId()
        };

        localStorage.setItem('mecha_user_session', JSON.stringify(currentUser));
        launchAppDirectly();
    }).catch(() => {
        // في حالة عدم الاتصال، استخدم الاسم من الجلسة المحفوظة
        const saved = localStorage.getItem('mecha_user_session');
        if (saved) {
            const user = JSON.parse(saved);
            currentUser = user;
            launchAppDirectly();
        }
    });
}

function launchAppDirectly() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContent').style.display = 'flex';
    
    const isAdmin = (currentUser.role === 'admin' || currentUser.phone === ADMIN_PHONE);
    
    document.getElementById('userNameDisplay').innerText = `مرحباً المهندس ${currentUser.name}`;
    document.getElementById('userRoleDisplay').innerText = isAdmin ? 'مدير النظام' : 'عضو معتمد';

    // إظهار/إخفاء أزرار المشرف
    const adminBtn = document.getElementById('btnAdminAddBanner');
    if (adminBtn) adminBtn.style.display = isAdmin ? 'inline-block' : 'none';

    const usersDataCard = document.getElementById('btnUsersData');
    if (usersDataCard) usersDataCard.style.display = isAdmin ? 'flex' : 'none';

    updateNetworkStatus();
    loadBannerLocallyOrOnline(false);
    loadNotifications();
    
    // إشعار للمشرف بدخول عضو (إذا كان العضو وليس مشرف)
    if (!isAdmin && currentUser.phone !== ADMIN_PHONE) {
        sendAdminNotification({
            title: '👤 تسجيل دخول جديد',
            message: `المهندس ${currentUser.name} قام بتسجيل الدخول إلى التطبيق من الجهاز (${currentUser.deviceId})`,
            path: 'users',
            timestamp: new Date().toLocaleString('ar-YE')
        });
    }
}

// ==========================================================================
// 11. عرض بيانات الأعضاء والأجهزة (للمشرف)
// ==========================================================================
async function loadUsersDevicesData() {
    const listEl = document.getElementById('usersDevicesList');
    listEl.innerHTML = 'جاري تحليل الأجهزة والنشاط...';

    if (!navigator.onLine) {
        listEl.innerHTML = '⚠️ يتطلب اتصال بالإنترنت لجلب بيانات الأجهزة الحديثة.';
        return;
    }

    try {
        // جلب بيانات المستخدمين
        const usersSnap = await db.ref('users').once('value');
        const usersData = usersSnap.val() || {};
        
        // جلب الأجهزة المسجلة
        const devicesSnap = await db.ref('users_devices').once('value');
        const devicesData = devicesSnap.val() || {};
        
        // جلب طلبات الموافقة المعلقة
        const pendingSnap = await db.ref('pending_approvals').once('value');
        const pendingData = pendingSnap.val() || {};

        let html = '';
        
        // عرض المشرف أولاً
        if (usersData[ADMIN_PHONE]) {
            html += generateUserCard(ADMIN_PHONE, usersData[ADMIN_PHONE], devicesData, pendingData);
        }
        
        // عرض بقية الأعضاء
        Object.entries(usersData).forEach(([phone, user]) => {
            if (phone !== ADMIN_PHONE) {
                html += generateUserCard(phone, user, devicesData, pendingData);
            }
        });

        if (!html) {
            html = '<p style="color:var(--text-dim); text-align:center;">لا يوجد أعضاء مسجلين حالياً</p>';
        }

        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '❌ تعذر جلب البيانات من السيرفر.';
        console.error(e);
    }
}

function generateUserCard(phone, user, devicesData, pendingData) {
    const userDevices = devicesData[phone] || {};
    const deviceKeys = Object.keys(userDevices);
    const deviceCount = deviceKeys.length;
    const userName = user.name || phone;
    const userRole = phone === ADMIN_PHONE ? 'admin' : 'member';
    const isBaseMember = user.isBaseMember || false;
    
    const isPending = pendingData[phone] ? true : false;
    
    let warning = '';
    if (deviceCount > 1) {
        warning = `
            <div class="device-warning-card" style="
                background:rgba(255,71,87,0.15); 
                border:1px solid #ff4757; 
                color:#ff4757; 
                padding:8px; 
                border-radius:8px; 
                margin-top:6px; 
                font-size:11px;
            ">
                ⚠️ هذا العضو مسجل من (${deviceCount}) أجهزة مختلفة!
                <br>
                <span style="font-size:10px; color:var(--text-dim);">
                    ${deviceKeys.map(id => `🖥️ ${id}`).join(' | ')}
                </span>
            </div>
        `;
    }

    let pendingStatus = '';
    if (isPending) {
        pendingStatus = `
            <div style="
                background:rgba(212,175,55,0.15); 
                border:1px solid var(--gold-primary); 
                color:var(--gold-secondary); 
                padding:6px 12px; 
                border-radius:8px; 
                font-size:11px;
                margin-top:6px;
            ">
                ⏳ في انتظار الموافقة على جهاز جديد
            </div>
        `;
    }

    let baseMemberTag = '';
    if (isBaseMember) {
        baseMemberTag = `<span style="font-size:9px; color:var(--gold); background:rgba(212,175,55,0.1); padding:2px 8px; border-radius:10px;">⭐ عضو أساسي</span>`;
    }

    return `
        <div style="
            background:rgba(255,255,255,0.05); 
            padding:12px; 
            margin-bottom:10px; 
            border-radius:12px; 
            border:1px solid rgba(255,255,255,0.1);
        ">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <div>
                    <b>👤 المهندس ${userName}</b>
                    ${baseMemberTag}
                </div>
                <span style="font-size:11px; color:${userRole === 'admin' ? 'var(--gold)' : 'var(--text-dim)'};">
                    ${userRole === 'admin' ? '👑 مدير' : '👤 عضو'}
                </span>
            </div>
            <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">
                📱 رقم الهاتف: ${phone}
            </div>
            <div style="font-size:11px; color:var(--text-dim);">
                🖥️ عدد الأجهزة: ${deviceCount}
            </div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">
                📅 تاريخ التسجيل: ${user.registeredAt || 'غير محدد'}
            </div>
            ${warning}
            ${pendingStatus}
        </div>
    `;
}

// ==========================================================================
// 12. إرسال الإشعارات للمشرف
// ==========================================================================
function sendAdminNotification(notif) {
    // حفظ في Firebase
    db.ref(`admin_notifications/${Date.now()}`).set({
        ...notif,
        read: false,
        id: Date.now()
    });

    // حفظ محلياً
    const saved = localStorage.getItem('admin_notifications');
    let notifications = saved ? JSON.parse(saved) : [];
    notifications.unshift({...notif, read: false, id: Date.now()});
    if (notifications.length > 100) notifications = notifications.slice(0, 100);
    localStorage.setItem('admin_notifications', JSON.stringify(notifications));
    
    // تحديث شارة الإشعارات إذا كان المستخدم مشرفاً
    const user = getCurrentUser();
    if (user && user.phone === ADMIN_PHONE) {
        updateNotificationBadge();
    }
}

// ==========================================================================
// 13. عرض الإشعارات للمشرف
// ==========================================================================
function showApprovalToast(data) {
    // إنشاء إشعار منبثق للمشرف
    const toast = document.createElement('div');
    toast.style.cssText = `
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
    
    toast.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
                <div style="color:var(--gold-secondary); font-weight:700;">⚠️ طلب موافقة جهاز جديد</div>
                <div style="color:var(--text-muted); font-size:12px; margin-top:4px;">
                    المهندس ${data.userName} يريد تسجيل جهاز جديد
                </div>
                <div style="display:flex; gap:8px; margin-top:10px;">
                    <button onclick="approveDeviceFromToast('${data.phone}')" style="
                        background: var(--gold-grad);
                        color: #060d18;
                        border: none;
                        padding: 6px 16px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 700;
                    ">✅ موافقة</button>
                    <button onclick="rejectDeviceFromToast('${data.phone}')" style="
                        background: var(--danger-color);
                        color: #fff;
                        border: none;
                        padding: 6px 16px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 700;
                    ">❌ رفض</button>
                </div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: none;
                border: none;
                color: var(--text-dim);
                font-size: 16px;
                cursor: pointer;
            ">✕</button>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideDown 0.5s ease';
            setTimeout(() => toast.remove(), 500);
        }
    }, 30000);
}

// دوال الموافقة من الإشعار المنبثق
window.approveDeviceFromToast = function(phone) {
    db.ref(`pending_approvals/${phone}`).once('value').then(snapshot => {
        const data = snapshot.val();
        if (data) {
            pendingApprovalData = data;
            registerNewDevice(phone, data.deviceId);
            db.ref(`pending_approvals/${phone}`).remove();
            
            db.ref(`users/${phone}/name`).once('value').then(nameSnap => {
                const userName = nameSnap.val() || phone;
                sendAdminNotification({
                    title: '✅ تمت الموافقة على جهاز جديد',
                    message: `تمت الموافقة على جهاز المهندس ${userName}`,
                    path: 'users',
                    timestamp: new Date().toLocaleString('ar-YE')
                });
            });
            
            alert('✅ تمت الموافقة على الجهاز الجديد');
            // إزالة جميع الإشعارات المنبثقة
            document.querySelectorAll('[style*="position: fixed"][style*="z-index: 9999"]').forEach(el => el.remove());
        }
    });
};

window.rejectDeviceFromToast = function(phone) {
    if (!confirm('هل أنت متأكد من رفض هذا الجهاز؟')) return;
    db.ref(`pending_approvals/${phone}`).remove();
    alert('❌ تم رفض الجهاز الجديد');
    document.querySelectorAll('[style*="position: fixed"][style*="z-index: 9999"]').forEach(el => el.remove());
};

// ==========================================================================
// 14. إدارة الإشعارات
// ==========================================================================
let notificationsData = [];
let unreadCount = 0;

async function loadNotifications() {
    // تحميل إشعارات المشرف إذا كان المستخدم مشرفاً
    const user = getCurrentUser();
    if (!user || user.phone !== ADMIN_PHONE) return;

    const saved = localStorage.getItem('admin_notifications');
    if (saved) {
        try {
            notificationsData = JSON.parse(saved);
            updateNotificationBadge();
        } catch (e) {}
    }

    if (navigator.onLine) {
        try {
            const snap = await db.ref('admin_notifications').orderByChild('timestamp').limitToLast(50).once('value');
            const data = snap.val();
            if (data) {
                notificationsData = Object.values(data).reverse();
                localStorage.setItem('admin_notifications', JSON.stringify(notificationsData));
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
        badge.style.display = unread > 0 ? 'flex' : 'none';
        badge.innerText = unread > 99 ? '99+' : unread;
    }
}

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
                    <button onclick="closeModal('notificationsModal')" style="
                        background:none;
                        border:none;
                        color:var(--text-dim);
                        font-size:20px;
                        cursor:pointer;
                    ">✕</button>
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
        html += `
            <div style="
                background: ${isRead ? 'rgba(255,255,255,0.02)' : 'rgba(212,175,55,0.05)'};
                border: 1px solid ${isRead ? 'rgba(255,255,255,0.03)' : 'rgba(212,175,55,0.1)'};
                border-radius: 12px;
                padding: 14px 16px;
                margin-bottom: 10px;
            ">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
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
                    <button onclick="markNotificationRead(${index})" style="
                        background:none;
                        border:none;
                        color:var(--text-dim);
                        cursor:pointer;
                        font-size:12px;
                        padding:4px;
                    ">✓</button>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}

function markNotificationRead(index) {
    if (notificationsData[index]) {
        notificationsData[index].read = true;
        localStorage.setItem('admin_notifications', JSON.stringify(notificationsData));
        updateNotificationBadge();
        renderNotificationsList();
    }
}

// ==========================================================================
// 15. دوال الإعلانات
// ==========================================================================
async function loadBannerLocallyOrOnline(forceFetch = false) {
    const localBanner = localStorage.getItem('cached_banner_data');

    if (!navigator.onLine || (!forceFetch && localBanner)) {
        if (localBanner) {
            renderBanner(JSON.parse(localBanner));
        } else {
            document.getElementById('bannerDisplayArea').innerHTML = 
                '<div class="empty-banner">لا توجد إعلانات محفوظة محلياً.</div>';
        }
        return;
    }

    try {
        const snap = await db.ref('current_banner').once('value');
        const onlineBanner = snap.val();

        if (onlineBanner) {
            const currentLocalId = localBanner ? JSON.parse(localBanner).id : null;
            if (forceFetch && currentLocalId === onlineBanner.id) {
                alert('ℹ️ لا توجد إعلانات محدثة جديدة بعد.');
            } else {
                localStorage.setItem('cached_banner_data', JSON.stringify(onlineBanner));
                renderBanner(onlineBanner);
                if (forceFetch) alert('✅ تم تحديث الإعلان وحفظه محلياً بنجاح!');
            }
        } else {
            document.getElementById('bannerDisplayArea').innerHTML = 
                '<div class="empty-banner">لا توجد إعلانات حالياً.</div>';
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

// نشر إعلان جديد (للمشرف)
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
        await db.ref('current_banner').set(newBanner);
        localStorage.setItem('cached_banner_data', JSON.stringify(newBanner));
        renderBanner(newBanner);

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
// 16. دوال حالة الاتصال
// ==========================================================================
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
// 17. الأحداث والتنقلات
// ==========================================================================
function setupEvents() {
    // زر تحديث البيانات
    document.getElementById('btnRefreshData').addEventListener('click', () => {
        loadBannerLocallyOrOnline(true);
    });
    
    // زر إدراج إعلان
    document.getElementById('btnAdminAddBanner').addEventListener('click', () => {
        openModal('addBannerModal');
    });
    
    // زر المواد الدراسية
    document.getElementById('btnStudyMaterials').addEventListener('click', () => {
        window.location.href = 'study-materials.html';
    });

    // زر الإشعارات
    document.getElementById('btnNotifCenter').addEventListener('click', () => {
        openNotificationsModal();
        if (navigator.onLine) loadNotifications();
    });

    // زر عرض بيانات الأعضاء
    document.getElementById('btnUsersData').addEventListener('click', () => {
        openModal('usersDataModal');
        loadUsersDevicesData();
    });

    // زر تسجيل الخروج
    document.getElementById('btnLogout').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
            localStorage.removeItem('mecha_user_session');
            location.reload();
        }
    });
}

// ==========================================================================
// 18. دوال مساعدة
// ==========================================================================
function getCurrentUser() {
    try {
        const session = localStorage.getItem('mecha_user_session');
        if (session) return JSON.parse(session);
        return null;
    } catch (e) {
        return null;
    }
}

function isAdminUser() {
    const user = getCurrentUser();
    return user && (user.role === 'admin' || user.phone === ADMIN_PHONE);
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
// 19. تصدير الدوال للاستخدام من صفحات أخرى
// ==========================================================================
window.getCurrentUser = getCurrentUser;
window.isAdminUser = isAdminUser;
window.closeModal = closeModal;
window.openModal = openModal;
window.loadUsersDevicesData = loadUsersDevicesData;
window.approveDeviceFromToast = approveDeviceFromToast;
window.rejectDeviceFromToast = rejectDeviceFromToast;

console.log('✅ تم تحميل النظام الجديد - بدون رموز دخول');
