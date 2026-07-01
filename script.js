// =================================================================
// LOGIKA JAVASCRIPT - MonkeyGuard Dashboard
// =================================================================

// -------------------------------------------------------------
// A. JS HELPER & GLOBAL STATE (Penyimpan Data Utama Aplikasi)
// -------------------------------------------------------------
const $ = id => document.getElementById(id);
const $$ = cl => document.querySelectorAll(cl);

let currentTab = 'dashboard';
let isDarkMode = false;
let logsData = [];
let detectionChart = null;
let isDemoMode = true;

let hourlyData = Array(24).fill(0);
let notifCleared = false; // Status apakah notifikasi sudah dibersihkan manual oleh user

let fbConfig = { apiKey: '', databaseURL: '', projectId: '' };
// chatId = Chat ID Kepala Tani (penerima utama, aktif sekarang)
// taniMembers = daftar Chat ID Anggota Tani (RUANG PENGEMBANGAN — lihat sendTelegramAlert)
let teleConfig = { token: '', chatId: '', taniMembers: [] };
let dbRef = null;

// -------------------------------------------------------------
// B. SISTEM LOGIN & LOGOUT
// -------------------------------------------------------------
function checkAuthStatus() {
    const loggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
    $('login-overlay').classList.toggle('hidden', loggedIn);
}

// -------------------------------------------------------------
// Kredensial login default — dipakai sebagai FALLBACK jika Firebase
// belum dikonfigurasi atau node 'admin_auth' belum dibuat di database.
// Setelah Firebase aktif, ganti kredensial lewat Firebase Console pada
// path: monkeyguard/admin_auth/{ username, password }
// -------------------------------------------------------------
const DEFAULT_AUTH = { username: 'admin', password: 'admin123' };

async function handleLogin(e) {
    e.preventDefault();
    const usernameInput = $('login-username').value.trim();
    const passwordInput = $('login-password').value.trim();
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.innerText = "Memeriksa...";

    let validUser = DEFAULT_AUTH.username;
    let validPass = DEFAULT_AUTH.password;

    // Coba ambil kredensial dari Firebase jika sudah terkonfigurasi
    try {
        if (!isDemoMode && fbConfig.apiKey && fbConfig.databaseURL) {
            if (firebase.apps.length === 0) firebase.initializeApp(fbConfig);
            const snap = await firebase.database().ref('monkeyguard/admin_auth').once('value');
            const authData = snap.val();
            if (authData && authData.username && authData.password) {
                validUser = authData.username;
                validPass = authData.password;
            }
        }
    } catch (err) {
        console.warn("Gagal mengambil kredensial dari Firebase, menggunakan default:", err.message);
    }

    submitBtn.disabled = false;
    submitBtn.innerText = "Masuk Ke Dashboard";

    if (usernameInput === validUser && passwordInput === validPass) {
        sessionStorage.setItem('isLoggedIn', 'true');
        showToast("Selamat datang kembali, Admin!", "success");
        checkAuthStatus();
    } else {
        showToast("Username atau password salah!", "error");
    }
}

function handleLogout() {
    sessionStorage.removeItem('isLoggedIn');
    showToast("Keluar berhasil.", "info");
    $('login-overlay').classList.remove('hidden');
    $('login-username').value = $('login-password').value = '';
}

// -------------------------------------------------------------
// C. TEMA & TAMPILAN (Mode Gelap / Terang)
// -------------------------------------------------------------
function initTheme() {
    const savedTheme = localStorage.theme;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDarkMode(savedTheme === 'dark' || (!savedTheme && systemPrefersDark));
}

function toggleDarkMode() {
    setDarkMode(!isDarkMode);
}

function setDarkMode(dark) {
    isDarkMode = dark;
    document.documentElement.classList.toggle('dark', dark);
    localStorage.theme = dark ? 'dark' : 'light';
    $('theme-text').innerText = dark ? "Gelap" : "Terang";
    $('theme-icon-light').classList.toggle('hidden', dark);
    $('theme-icon-dark').classList.toggle('hidden', !dark);
    if (detectionChart) updateChartTheme();
}

// -------------------------------------------------------------
// D. NAVIGASI TABS & SIDEBAR
// -------------------------------------------------------------
function toggleSidebar() {
    const open = !$('sidebar').classList.contains('-translate-x-full');
    $('sidebar').classList.toggle('-translate-x-full', open);
    $('sidebar-overlay').classList.toggle('hidden', open);
}

function switchTab(tabId) {
    $(`tab-${currentTab}`).classList.add('hidden');
    $(`menu-${currentTab}`).className = "nav-item flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-all-300 text-slate-300 hover:bg-white/5 hover:text-white";

    $(`tab-${tabId}`).classList.remove('hidden');
    $(`menu-${tabId}`).className = "nav-item flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-all-300 bg-white/10 text-white font-medium";

    const titles = {
        dashboard: 'Dashboard Utama',
        logs: 'Catatan Aktivitas Lengkap',
        sensors: 'Simulasi & Status Sensor',
        settings: 'Konfigurasi Integrasi'
    };
    $('page-title').innerText = titles[tabId];
    currentTab = tabId;

    if (window.innerWidth < 1024) toggleSidebar();
}

function toggleNotificationPanel() {
    $('notif-dropdown').classList.toggle('hidden');
}

function showToast(msg, type = 'info') {
    const toast = $('toast-box'), msgEl = $('toast-message');
    msgEl.innerText = msg;

    toast.className = `fixed bottom-5 right-5 z-[999] px-5 py-3 rounded-xl text-white text-xs font-semibold shadow-2xl flex items-center space-x-2 transform transition-all duration-300 ${
        type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-emerald-600' : 'bg-slate-900'
    }`;

    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

// -------------------------------------------------------------
// E. GRAFIK DETEKSI (Chart.js)
// -------------------------------------------------------------
function initChart() {
    const ctx = $('detectionChart').getContext('2d');
    detectionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`),
            datasets: [{
                label: 'Deteksi',
                data: hourlyData,
                borderColor: '#22C55E',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#22C55E'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, color: '#64748B' }, grid: { color: 'rgba(226, 232, 240, 0.8)' } },
                x: { ticks: { color: '#64748B' }, grid: { display: false } }
            }
        }
    });
    updateChartTheme();
}

function updateChartTheme() {
    if (!detectionChart) return;
    const darkClr = isDarkMode ? '#94A3B8' : '#64748B';
    const gridClr = isDarkMode ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.8)';

    detectionChart.options.scales.y.ticks.color = detectionChart.options.scales.x.ticks.color = darkClr;
    detectionChart.options.scales.y.grid.color = gridClr;
    detectionChart.data.datasets[0].borderColor = isDarkMode ? '#22C55E' : '#27AE60';
    detectionChart.data.datasets[0].backgroundColor = isDarkMode ? 'rgba(34, 197, 94, 0.1)' : 'rgba(39, 174, 96, 0.1)';
    detectionChart.update();
}

// -------------------------------------------------------------
// F. STATUS KONEKSI
// -------------------------------------------------------------
function updateConnectionStatusUI(status) {
    const container = $('connection-container');
    const text = $('status-text');
    const icon = $('connection-icon');
    const ping = $('ping-indicator');

    if (status === 'live') {
        container.className = "flex items-center space-x-2 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800/60 shadow-xs transition-all-300";
        text.innerText = "REALTIME LIVE";
        text.className = "text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider";
        icon.className = "fa-solid fa-wifi text-emerald-600 dark:text-emerald-400 text-xs animate-pulse";
        ping.classList.remove('hidden');
    } else if (status === 'demo') {
        container.className = "flex items-center space-x-2 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 rounded-full border border-amber-200 dark:border-amber-800/60 shadow-xs transition-all-300";
        text.innerText = "SIMULASI AKTIF";
        text.className = "text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider";
        icon.className = "fa-solid fa-laptop text-amber-600 dark:text-amber-400 text-xs";
        ping.classList.add('hidden');
    } else if (status === 'connecting') {
        container.className = "flex items-center space-x-2 bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 rounded-full border border-blue-200 dark:border-blue-800/60 shadow-xs transition-all-300";
        text.innerText = "MENYAMBUNG...";
        text.className = "text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider";
        icon.className = "fa-solid fa-spinner text-blue-600 dark:text-blue-400 text-xs animate-spin";
        ping.classList.add('hidden');
    } else if (status === 'unconfigured') {
        container.className = "flex items-center space-x-2 bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 rounded-full border border-rose-200 dark:border-rose-800/60 shadow-xs transition-all-300";
        text.innerText = "CLOUD BELUM DISET";
        text.className = "text-xs font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider";
        icon.className = "fa-solid fa-cloud-slash text-rose-600 dark:text-rose-400 text-xs";
        ping.classList.add('hidden');
    }
}

function toggleDemoMode() {
    isDemoMode = $('demo-mode-toggle').checked;
    if (isDemoMode) {
        if (dbRef) dbRef.off();
        showToast("Mode Simulasi Aktif (Virtual / Offline)", "info");
        setupLocalDummyData();
    } else {
        // Reset PIR & suara ke kondisi aman saat keluar dari Mode Simulasi
        soundRepellerActive = false;
        logsData = [];
        applyRealtimeData({ total_deteksi: 0, pir_sensor: false, play_sound: false, jarak_objek: 0, rssi: null, logs: [] });

        const savedFb = localStorage.getItem('fb_config');
        if (savedFb) {
            fbConfig = JSON.parse(savedFb);
            if (fbConfig.apiKey && fbConfig.databaseURL && fbConfig.projectId) {
                updateConnectionStatusUI('connecting');
                initFirebase();
            } else {
                showToast("Kredensial Firebase tidak lengkap!", "error");
                updateConnectionStatusUI('unconfigured');
            }
        } else {
            showToast("Harap set up Firebase di tab Integrasi!", "error");
            updateConnectionStatusUI('unconfigured');
        }
    }
}

// -------------------------------------------------------------
// G. FIREBASE & LOCAL STORAGE
// -------------------------------------------------------------
function loadSavedCredentials() {
    const savedFb = localStorage.getItem('fb_config');
    const savedTele = localStorage.getItem('tele_config');

    if (savedFb) {
        fbConfig = JSON.parse(savedFb);
        $('fb-apikey').value = fbConfig.apiKey || '';
        $('fb-dburl').value = fbConfig.databaseURL || '';
        $('fb-projectid').value = fbConfig.projectId || '';
    }
    if (savedTele) {
        teleConfig = JSON.parse(savedTele);
        if (!teleConfig.taniMembers) teleConfig.taniMembers = []; // jaga kompatibilitas data lama
        $('tele-token').value = teleConfig.token || '';
        $('tele-chatid').value = teleConfig.chatId || '';
    }
    renderTaniMembers();

    isDemoMode = $('demo-mode-toggle').checked;
    if (isDemoMode) {
        setupLocalDummyData();
    } else if (savedFb && fbConfig.apiKey && fbConfig.databaseURL && fbConfig.projectId) {
        initFirebase();
    } else {
        updateConnectionStatusUI('unconfigured');
    }
}

function initFirebase() {
    if (fbConfig.apiKey && fbConfig.databaseURL && fbConfig.projectId) {
        try {
            if (firebase.apps.length === 0) firebase.initializeApp(fbConfig);
            dbRef = firebase.database().ref('monkeyguard');

            dbRef.on('value', snap => {
                const data = snap.val();
                if (!isDemoMode) applyRealtimeData(data || {});
            }, err => {
                showToast("Firebase Error: " + err.message, "error");
                updateConnectionStatusUI('unconfigured');
            });

            updateConnectionStatusUI('live');
            showToast("Terhubung ke Cloud Realtime!", "success");
        } catch (e) {
            showToast("Gagal memuat Firebase: " + e.message, "error");
            updateConnectionStatusUI('unconfigured');
        }
    }
}

// Status PIR sebelumnya — mencegah suara terpicu berulang untuk deteksi yang sama
let lastPirState = false;

// -------------------------------------------------------------
// DEBOUNCE TELEGRAM — mencegah notifikasi terkirim 2x dalam
// waktu berdekatan akibat sensitivitas sensor PIR yang tinggi.
// Telegram hanya bisa terkirim max 1x per TELEGRAM_COOLDOWN_MS.
// Delay 2 detik sebelum kirim memastikan total_deteksi di Firebase
// sudah diperbarui ESP32 sebelum notifikasi dikirim ke pengguna.
// -------------------------------------------------------------
let lastTelegramSent = 0;
const TELEGRAM_COOLDOWN_MS = 15000; // 15 detik cooldown antar notifikasi (sesuai cooldown ESP32)

// Menerjemahkan nilai RSSI (dBm) menjadi label kualitas sinyal Wi-Fi
function updateRssiUI(rssi) {
    const el = $('stat-rssi');
    if (rssi === undefined || rssi === null) {
        el.innerText = "Tidak Ada Data";
        el.className = "font-bold text-slate-400";
        return;
    }
    const val = Math.round(rssi);
    let label, colorClass;
    if (val >= -60) {
        label = "Sangat Baik"; colorClass = "text-emerald-500";
    } else if (val >= -70) {
        label = "Baik"; colorClass = "text-amber-500";
    } else if (val >= -80) {
        label = "Lemah"; colorClass = "text-orange-500";
    } else {
        label = "Sangat Lemah"; colorClass = "text-red-500";
    }
    el.innerText = `${val} dBm (${label})`;
    el.className = `font-bold ${colorClass}`;
}

function applyRealtimeData(data) {
    // -------------------------------------------------------------
    // OPSI B FIX: Baca dari node "status" (path ESP32 saat ini) ATAU
    // dari root langsung (path ESP32 versi baru). Keduanya didukung
    // agar dashboard tetap jalan apapun versi kode ESP32 yang dipakai.
    // -------------------------------------------------------------
    const pir       = data.status?.pir        ?? data.pir_sensor   ?? false;
    const playSound = data.status?.play_sound  ?? data.play_sound   ?? false;
    const totalDet  = data.status?.total_deteksi ?? data.total_deteksi ?? 0;
    const jarak     = data.status?.jarak_objek ?? data.jarak_objek  ?? 3;

    animateStatChange('stat-total-deteksi', totalDet);
    updatePIRUI(pir);
    updateSpeakerUI(playSound);
    updateRssiUI(data.rssi);

    // Deteksi baru (PIR false -> true) membuka kembali notifikasi yang sempat dibersihkan
    if (pir === true && lastPirState === false) {
        notifCleared = false;
    }

    // AUTO TRIGGER SUARA: hanya jika PIR baru berubah false → true
    // dan BUKAN mode demo (artinya sinyal nyata dari ESP32 via Firebase)
    if (!isDemoMode && pir === true && lastPirState === false) {
        if (!soundRepellerActive) {
            showToast("🚨 Monyet Terdeteksi! Suara pengusir otomatis aktif!", "error");
            triggerSoundRepeller();
        }

        // -------------------------------------------------------------
        // FIX NOTIFIKASI 2X & TOTAL DETEKSI 0:
        // 1. Cek debounce dulu — kalau belum lewat 20 detik, skip
        // 2. Delay 2 detik sebelum kirim — beri waktu ESP32 update
        //    total_deteksi ke Firebase sebelum notifikasi terkirim,
        //    sehingga nilai total_deteksi di pesan Telegram akurat
        // -------------------------------------------------------------
        const now = Date.now();
        if (now - lastTelegramSent > TELEGRAM_COOLDOWN_MS) {
            lastTelegramSent = now;
            setTimeout(() => {
                const det = parseInt($('stat-total-deteksi').innerText) || 0;
                sendTelegramAlert(buildDeteksiMessage({
                    waktu: new Date().toLocaleTimeString('id-ID'),
                    jarak: jarak,
                    speakerOn: true,
                    totalDeteksi: det,
                    sumber: "Realtime (ESP32 via Firebase)"
                }));
            }, 1000); // tunggu 1 detik agar total_deteksi Firebase sempat diperbarui
        }
    }
    // Jika monyet pergi (PIR kembali false), hentikan suara otomatis
    if (!isDemoMode && pir === false && lastPirState === true) {
        if (soundRepellerActive) stopSoundRepeller();
    }
    lastPirState = pir;

    // Selalu update logsData & render, termasuk saat logs kosong/undefined
    logsData = data.logs ? Object.values(data.logs).reverse() : [];
    renderLogs();

    $('sim-pir').checked = pir;
    $('sim-speaker').checked = playSound;
    $('sim-jarak').value = jarak;
    $('jarak-val').innerText = parseFloat(jarak).toFixed(1) + " m";
    $('last-update').innerText = new Date().toLocaleTimeString('id-ID');
}

function setupLocalDummyData() {
    updateConnectionStatusUI('demo');
    hourlyData = [0, 0, 0, 0, 0, 1, 3, 0, 0, 2, 4, 0, 1, 3, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0];
    if (detectionChart) {
        detectionChart.data.datasets[0].data = hourlyData;
        detectionChart.update();
    }
    logsData = [
        { waktu: "09:30:15", pir: false, speaker: true, ket: "Kondisi kebun aman, speaker standby" },
        { waktu: "11:12:45", pir: true,  speaker: true, ket: "Monyet Terdeteksi - Suara Pengusir Aktif" },
        { waktu: "13:05:00", pir: false, speaker: true, ket: "Keadaan normal kembali" },
        { waktu: "15:45:22", pir: true,  speaker: true, ket: "Monyet Terdeteksi - Respon Cepat" }
    ];
    // Saat Mode Simulasi diaktifkan, PIR & Suara otomatis ON agar langsung terlihat aktif
    // (tetap bisa di-toggle manual ON/OFF setelahnya lewat tab Sensors)
    applyRealtimeData({ total_deteksi: 14, pir_sensor: true, play_sound: true, jarak_objek: 3, rssi: -55, logs: logsData });
}

// -------------------------------------------------------------
// H. MANIPULASI UI
// -------------------------------------------------------------
function animateStatChange(id, val) {
    const el = $(id);
    if (parseInt(el.innerText) === val) return;
    el.classList.add('scale-125', 'text-emerald-500');
    setTimeout(() => {
        el.innerText = val;
        el.classList.remove('scale-125', 'text-emerald-500');
    }, 250);
}

function updatePIRUI(detected) {
    $('card-pir').classList.toggle('border-red-500', detected);
    $('card-pir').classList.toggle('bg-red-50/10', detected);
    $('card-pir').classList.toggle('animate-pulse-subtle', detected);
    $('icon-pir-container').className = `icon-stat-box p-4 rounded-2xl ${detected ? 'bg-red-500/20 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`;
    $('stat-pir-status').innerText = detected ? "Monyet Terdeteksi!" : "Siaga";
    $('stat-pir-status').className = detected ? "text-sm font-extrabold text-red-500" : "text-lg font-bold text-slate-500 dark:text-slate-400";
    $('icon-pir').className = detected ? "fa-solid fa-triangle-exclamation text-2xl" : "fa-solid fa-person-walking-dashed-line text-2xl";
}

function updateSpeakerUI(playing) {
    $('stat-speaker').innerText = playing ? "MEMBUNYIKAN" : "SIAGA";
    $('stat-speaker').className = `text-lg font-bold ${playing ? 'text-orange-500' : 'text-emerald-500'}`;
    $('icon-speaker-container').className = `icon-stat-box p-4 rounded-2xl ${playing ? 'bg-orange-500/20 text-orange-500' : 'bg-emerald-500/10 text-emerald-500'}`;
    $('icon-speaker').className = playing ? 'fa-solid fa-volume-high text-2xl animate-pulse' : 'fa-solid fa-volume-high text-2xl';
}

function renderLogs() {
    let rowsHtml = '', alertHtml = '', notifDropdownHtml = '';
    logsData.forEach((log, idx) => {
        const pirBdg = log.pir
            ? `<span class="px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 font-extrabold rounded-md text-[10px]">TERDETEKSI</span>`
            : `<span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-md text-[10px]">Aman</span>`;
        // Disesuaikan: field "pagar" diganti menjadi "speaker" agar konsisten
        // dengan field play_sound pada node status utama (lihat applyRealtimeData)
        const speakerBdg = log.speaker
            ? `<span class="px-2 py-0.5 bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 font-extrabold rounded-md text-[10px]">SUARA ON</span>`
            : `<span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-md text-[10px]">SIAGA</span>`;

        rowsHtml += `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
            <td class="py-4 px-6 font-bold text-slate-400">${idx + 1}</td>
            <td class="py-4 px-6 font-medium">${log.waktu}</td>
            <td class="py-4 px-6">${pirBdg}</td>
            <td class="py-4 px-6">${speakerBdg}</td>
            <td class="py-4 px-6">${log.ket}</td>
        </tr>`;

        if (log.pir) {
            alertHtml += `<div class="p-3 bg-red-500/10 border-l-4 border-red-500 rounded-r-xl flex space-x-3 items-start animate-pulse-subtle">
                <div class="text-red-500 mt-1"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <div class="flex-1">
                    <p class="text-xs font-bold text-slate-800 dark:text-slate-100">MONYET TERDETEKSI</p>
                    <p class="text-[10px] text-slate-500">${log.ket}</p>
                    <span class="text-[9px] bg-orange-500 text-white font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block">${log.speaker ? 'SUARA AKTIF' : 'SIAGA'}</span>
                </div>
                <span class="text-[9px] font-semibold text-slate-400">${log.waktu}</span>
            </div>`;
            notifDropdownHtml += `<div class="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex space-x-2">
                <div class="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0"></div>
                <div>
                    <p class="text-xs font-bold text-slate-700 dark:text-slate-200">Deteksi Baru!</p>
                    <p class="text-[10px] text-slate-400">${log.waktu} - ${log.ket}</p>
                </div>
            </div>`;
        }
    });

    const emptyRow = '<tr><td colspan="5" class="py-6 text-center">Belum ada aktivitas terekam</td></tr>';
    $('log-table-body').innerHTML = $('full-log-table-body').innerHTML = rowsHtml || emptyRow;
    $('alert-list').innerHTML = alertHtml || `<div class="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400">
        <i class="fa-solid fa-circle-check text-2xl text-emerald-500 mb-2"></i>
        <p class="text-xs font-semibold">Kebun Sangat Aman</p>
    </div>`;
    $('notif-list-dropdown').innerHTML = (notifCleared ? '' : notifDropdownHtml) || `<div class="py-6 text-center text-xs text-slate-400">Tidak ada notifikasi baru</div>`;
    $('notif-badge-dot').classList.toggle('hidden', notifCleared || !notifDropdownHtml);
}

// -------------------------------------------------------------
// I. SIMULASI & EVENT HANDLERS
// -------------------------------------------------------------
function updateJarakLabel(val) {
    $('jarak-val').innerText = parseFloat(val).toFixed(1) + " m";
}

// -------------------------------------------------------------
// Saat toggle PIR diubah manual oleh user, otomatis sinkronkan
// toggle Speaker mengikuti status PIR (meniru perilaku asli:
// monyet terdeteksi -> suara otomatis bunyi). Speaker tetap bisa
// di-on/off-kan terpisah setelahnya tanpa mempengaruhi PIR.
// -------------------------------------------------------------
function onPirToggleChange() {
    const pirOn = $('sim-pir').checked;
    $('sim-speaker').checked = pirOn;
    onSimulationChange();
}

function onSimulationChange() {
    const pir = $('sim-pir').checked;
    const speakerOn = $('sim-speaker').checked;
    const jarak = parseFloat($('sim-jarak').value);

    if (!isDemoMode && dbRef) {
        dbRef.update({ pir_sensor: pir, play_sound: speakerOn, jarak_objek: jarak });
        if (pir) {
            const t = new Date().toLocaleTimeString('id-ID');
            // Disesuaikan: field "pagar" -> "speaker"
            dbRef.child('logs').push().set({ waktu: t, pir: true, speaker: speakerOn, ket: "Terdeteksi via Simulasi Cloud" });
            dbRef.child('total_deteksi').transaction(c => (c || 0) + 1);
            const det = (parseInt($('stat-total-deteksi').innerText) || 0) + 1;
            sendTelegramAlert(buildDeteksiMessage({
                waktu: t,
                jarak: jarak,
                speakerOn: speakerOn,
                totalDeteksi: det,
                sumber: "Realtime (ESP32 via Firebase)"
            }));
        }
    } else {
        const t = new Date().toLocaleTimeString('id-ID');
        let det = parseInt($('stat-total-deteksi').innerText);
        if (pir) {
            det += 1;
            // Disesuaikan: field "pagar" -> "speaker"
            logsData.unshift({ waktu: t, pir: true, speaker: speakerOn, ket: "Deteksi Pergerakan Hama — Suara Pengusir Aktif (Simulasi)" });
            hourlyData[new Date().getHours()] += 1;
            if (detectionChart) {
                detectionChart.data.datasets[0].data = hourlyData;
                detectionChart.update();
            }
            sendTelegramAlert(buildDeteksiMessage({
                waktu: t,
                jarak: jarak,
                speakerOn: speakerOn,
                totalDeteksi: det,
                sumber: "Mode Simulasi"
            }));
        }
        applyRealtimeData({ total_deteksi: det, pir_sensor: pir, play_sound: speakerOn, jarak_objek: jarak, logs: logsData });
    }
}

// -------------------------------------------------------------
// PENGUSIR HAMA - Trigger Firebase ke ESP32 + DFPlayer Mini
// Suara TIDAK diputar di browser. Semua suara diputar oleh
// DFPlayer Mini yang terhubung langsung ke ESP32 di lapangan.
// Dashboard hanya mengirim perintah via Firebase.
// -------------------------------------------------------------
let soundRepellerActive = false;
const SOUND_DURATION_MS = 5000; // Durasi suara berbunyi (5 detik) — sesuaikan dengan panjang track DFPlayer

function triggerSoundRepeller() {
    // Push button: jika sedang aktif, abaikan klik berikutnya sampai selesai berbunyi
    if (soundRepellerActive) return;

    soundRepellerActive = true;
    const btn = $('btn-sound-repeller');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-volume-high animate-pulse"></i><span>MEMBUNYIKAN...</span>`;
    btn.classList.add('opacity-70', 'cursor-not-allowed');

    showToast("🔊 Perintah suara dikirim ke ESP32!", "success");

    const t = new Date().toLocaleTimeString('id-ID');
    if (!isDemoMode && dbRef) {
        // Kirim perintah ke Firebase → ESP32 baca → DFPlayer Mini bunyi
        dbRef.update({ play_sound: true });
        // Disesuaikan: field "pagar" -> "speaker"
        dbRef.child('logs').push().set({ waktu: t, pir: false, speaker: true, ket: "Suara pengusir dipicu manual oleh Admin" });
    } else {
        // Mode simulasi: hanya update UI & log, tidak ada suara
        // Disesuaikan: field "pagar" -> "speaker"
        logsData.unshift({ waktu: t, pir: false, speaker: true, ket: "Suara pengusir dipicu manual (Simulasi - tidak ada suara)" });
        applyRealtimeData({
            total_deteksi: parseInt($('stat-total-deteksi').innerText),
            pir_sensor: false,
            play_sound: true,
            jarak_objek: parseFloat($('sim-jarak').value),
            logs: logsData
        });
    }

    // Otomatis reset setelah durasi suara selesai — tidak perlu diklik lagi untuk mematikan
    setTimeout(stopSoundRepeller, SOUND_DURATION_MS);
}

function stopSoundRepeller() {
    soundRepellerActive = false;

    const btn = $('btn-sound-repeller');
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-volume-high"></i><span>PICU SUARA PENGUSIR</span>`;
    btn.classList.remove('opacity-70', 'cursor-not-allowed');

    if (!isDemoMode && dbRef) {
        // Beritahu ESP32 bahwa durasi suara sudah selesai
        dbRef.update({ play_sound: false });
    }

    showToast("🔇 Perintah stop suara dikirim", "info");
}

function clearAllLogs() {
    if (!confirm("Hapus seluruh catatan log aktivitas?")) return;

    logsData = [];
    renderLogs(); // langsung kosongkan tampilan tanpa menunggu Firebase round-trip

    if (!isDemoMode && dbRef) {
        dbRef.child('logs').remove();
        dbRef.update({ total_deteksi: 0 });
    } else {
        applyRealtimeData({ total_deteksi: 0, pir_sensor: false, play_sound: false, jarak_objek: 3, rssi: -55, logs: [] });
    }

    showToast("Log berhasil dibersihkan", "success");
}

function exportLogs() {
    if (logsData.length === 0) return showToast("Log masih kosong!", "error");
    // Disesuaikan: header & isi kolom "Pagar" -> "Speaker", field log.pagar -> log.speaker
    let csv = "data:text/csv;charset=utf-8,No,Waktu,PIR,Speaker,Keterangan\n";
    logsData.forEach((l, i) => csv += `${i + 1},${l.waktu},${l.pir ? 'PIR' : 'AMAN'},${l.speaker ? 'ON' : 'OFF'},"${l.ket}"\n`);

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `monkeyguard_logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV Berhasil diunduh!", "success");
}

function clearNotifications() {
    notifCleared = true;
    $('notif-list-dropdown').innerHTML = `<div class="py-6 text-center text-xs text-slate-400">Tidak ada notifikasi baru</div>`;
    $('notif-badge-dot').classList.add('hidden');
    showToast("Notifikasi dibersihkan", "info");
}

// -------------------------------------------------------------
// J. INTEGRASI KREDENSIAL CLOUD
// -------------------------------------------------------------
function saveFirebaseSettings() {
    fbConfig = { apiKey: $('fb-apikey').value, databaseURL: $('fb-dburl').value, projectId: $('fb-projectid').value };
    localStorage.setItem('fb_config', JSON.stringify(fbConfig));
    showToast("Kredensial Firebase Disimpan!", "success");
    $('demo-mode-toggle').checked = false;
    setTimeout(() => window.location.reload(), 1000);
}

function saveTelegramSettings() {
    teleConfig = {
        token: $('tele-token').value,
        chatId: $('tele-chatid').value,
        taniMembers: teleConfig.taniMembers || [] // daftar anggota tani tetap tersimpan
    };
    localStorage.setItem('tele_config', JSON.stringify(teleConfig));
    showToast("Bot Telegram Terkonfigurasi!", "success");
}

// -------------------------------------------------------------
// RUANG PENGEMBANGAN: Manajemen Anggota Tani
// Daftar Chat ID anggota tani yang ikut menerima notifikasi.
// Saat ini disimpan di localStorage (per-browser). Untuk produksi,
// sebaiknya dipindah ke Firebase node 'telegram_subscribers' agar
// tersimpan terpusat dan bisa diakses dari perangkat manapun.
// -------------------------------------------------------------
function addTaniMember() {
    const input = $('tele-member-input');
    const chatId = input.value.trim();
    if (!chatId) return showToast("Masukkan Chat ID terlebih dahulu", "error");
    if (!teleConfig.taniMembers) teleConfig.taniMembers = [];
    if (teleConfig.taniMembers.includes(chatId)) return showToast("Chat ID sudah terdaftar", "error");

    teleConfig.taniMembers.push(chatId);
    localStorage.setItem('tele_config', JSON.stringify(teleConfig));
    input.value = '';
    renderTaniMembers();
    showToast("Anggota tani ditambahkan", "success");
}

function removeTaniMember(chatId) {
    teleConfig.taniMembers = (teleConfig.taniMembers || []).filter(id => id !== chatId);
    localStorage.setItem('tele_config', JSON.stringify(teleConfig));
    renderTaniMembers();
    showToast("Anggota tani dihapus", "info");
}

function renderTaniMembers() {
    const list = $('tele-member-list');
    const members = teleConfig.taniMembers || [];
    if (members.length === 0) {
        list.innerHTML = `<p class="text-[10px] text-slate-400 text-center py-2">Belum ada anggota tani terdaftar</p>`;
        return;
    }
    list.innerHTML = members.map(id => `
        <div class="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/40 rounded-lg">
            <span class="text-xs font-mono text-slate-600 dark:text-slate-300">${id}</span>
            <button onclick="removeTaniMember('${id}')" class="text-red-400 hover:text-red-600 text-xs"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `).join('');
}

// -------------------------------------------------------------
// Penyusun Pesan Notifikasi Deteksi (format lengkap & informatif)
// Dipakai baik di mode Live (Firebase/ESP32) maupun mode Simulasi,
// supaya format pesan yang diterima anggota tani selalu konsisten.
// -------------------------------------------------------------
function buildDeteksiMessage({ waktu, jarak, speakerOn, totalDeteksi, sumber }) {
    const jarakText = (jarak !== undefined && jarak !== null) ? `${parseFloat(jarak).toFixed(1)} meter` : "Tidak diketahui";
    return `🐒 *PERINGATAN MONYET TERDETEKSI!*

📍 Lokasi: Kebun Desa Tuna Harapan
🕐 Waktu: ${waktu}
📏 Jarak objek: ${jarakText}
🔊 Suara pengusir: ${speakerOn ? 'AKTIF' : 'TIDAK AKTIF'}
📊 Total deteksi hari ini: ${totalDeteksi} kali
${sumber ? `\n_Sumber: ${sumber}_` : ''}`;
}

// -------------------------------------------------------------
// Pengiriman Pesan Telegram (Broadcast)
// Mengirim ke Chat ID Kepala Tani + seluruh Chat ID Anggota Tani.
// Saat ini taniMembers masih bisa kosong (belum dipakai aktif di
// lapangan), jadi otomatis hanya terkirim ke Kepala Tani — perilaku
// ini aman dan tidak mengubah fungsi yang sudah berjalan sekarang.
// -------------------------------------------------------------
function sendTelegramAlert(text) {
    if (!teleConfig.token || !teleConfig.chatId) return;

    // Gabungkan kepala tani + seluruh anggota tani, hilangkan duplikat
    const allRecipients = [teleConfig.chatId, ...(teleConfig.taniMembers || [])];
    const uniqueRecipients = [...new Set(allRecipients)];

    uniqueRecipients.forEach(chatId => {
        fetch(`https://api.telegram.org/bot${teleConfig.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
        }).catch(e => console.error(`Gagal kirim ke ${chatId}:`, e));
    });
}

function sendTestTelegram() {
    if (!teleConfig.token || !teleConfig.chatId) return showToast("Data Telegram Belum Lengkap!", "error");
    showToast("Mengirim pesan uji coba...");
    sendTelegramAlert("🔔 *Koneksi Sukses!*\nSistem peringatan MonkeyGuard telah aktif.");
}


// -------------------------------------------------------------
// K. STARTUP
// -------------------------------------------------------------
window.onload = function () {
    checkAuthStatus();
    initTheme();
    initChart();
    loadSavedCredentials();
};
