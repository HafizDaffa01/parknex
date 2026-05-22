// CONFIG MQTT
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const TOPIC_TO_ESP = 'ESP32mqttTest01/web/to/esp';
const TOPIC_FROM_ESP = 'ESP32mqttTest01/esp/to/web';

let client;
let clientId = 'ESP32-DASHBOARD-' + Math.random().toString(16).substring(2, 8);

// UI State
let currentUIDs = [];
let maxUIDs = 3; // Default limit, will be updated by ESP32
let registeredUsers = []; // New: from ESP32
let isAdminLoggedIn = false;

let parkingState = new Array(10).fill(0);
let fireAlertShowing = false;
let alarmActive = false; // Track if alarm is currently active
let lastAlarmState = false; // Track previous alarm state to prevent spam
let isAddingMode = false;
let gateCloseTimer = null;

// History & Parking State
let parkedUsers = JSON.parse(localStorage.getItem('parkaxis_parked_users')) || {};
let parkingHistory = JSON.parse(localStorage.getItem('parkaxis_history')) || [];
let pendingEntryUID = null;
let pendingExitSlots = {}; // slotIndex -> uid who just left the slot

// DOM Cache for performance
const dom = {
    tempVal: document.getElementById('temp-val'),
    tempStatus: document.getElementById('temp-status-text'),
    tempCard: document.getElementById('temp-card'),
    humVal: document.getElementById('hum-val'),
    humStatus: document.getElementById('hum-status-text'),
    humCard: document.getElementById('hum-card'),
    ldrVal: document.getElementById('ldr-val'),
    ldrBar: document.getElementById('ldr-bar'),
    ldrCard: document.getElementById('ldr-card'),
    fireStatus: document.getElementById('fire-status'),
    fireIndicator: document.getElementById('fire-indicator'),
    fireStatusText: document.getElementById('fire-status-text'),
    mqttIndicator: document.getElementById('mqtt-indicator'),
    mqttStatus: document.getElementById('mqtt-status'),
    rfidList: document.getElementById('rfid-list'),
    curCnt: document.getElementById('current-uids-count'),
    maxCnt: document.getElementById('max-uids-count'),
    realTime: document.getElementById('real-time'),
    gateBox: document.getElementById('gate-icon-box'),
    gateIcon: document.getElementById('gate-icon'),
    gateText: document.getElementById('gate-text'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingStatus: document.getElementById('loading-status'),
    statFree: document.getElementById('stat-free'),
    statOcc: document.getElementById('stat-occ'),
    statPct: document.getElementById('stat-pct'),
    systemBadge: document.getElementById('system-badge'),
    systemStatusText: document.getElementById('system-status-text'),
    systemIndicator: document.getElementById('system-indicator'),
};

// Quotes for Loading Screen
const quotes = [
    "Technology is best when it brings people together. - Matt Mullenweg",
    "The advance of technology is based on making it fit in so that you don't really even notice it. - Bill Gates",
    "It's not that we use technology, we live technology. - Godfrey Reggio",
    "Innovation is the outcome of a habit, not a random act. - Sukant Ratnakar",
    "The future belongs to those who allow themselves to be inspired.",
    "Smart cities are the key to a sustainable future.",
    "Automation is good, so long as you know exactly where to put the machine. - Eliyahu Goldratt",
    "Any sufficiently advanced technology is indistinguishable from magic. - Arthur C. Clarke",
    "Logic will get you from A to B. Imagination will take you everywhere. - Albert Einstein",
    "The best way to predict the future is to invent it. - Alan Kay",
    "Simplicity is the ultimate sophistication. - Leonardo da Vinci",
    "Code is poetry.",
    "First, solve the problem. Then, write the code. - John Johnson",
    "Experience is the name everyone gives to their mistakes. - Oscar Wilde",
    "Talk is cheap. Show me the code. - Linus Torvalds",
    "Data is a precious thing and will last longer than the systems themselves. - Tim Berners-Lee",
    "Software is eating the world. - Marc Andreessen",
    "Algorithm: Word used by programmers when they don't want to explain what they did."
];

let quoteInterval;

function showRandomQuote() {
    const quoteEl = document.getElementById('loading-quote');
    if (quoteEl) {
        let newQuote = quotes[Math.floor(Math.random() * quotes.length)];
        while (quoteEl.innerText.includes(newQuote) && quotes.length > 1) {
            newQuote = quotes[Math.floor(Math.random() * quotes.length)];
        }
        quoteEl.innerText = `"${newQuote}"`;
    }
}

function showLoadingScreen(statusText) {
    const el = document.getElementById('loading-overlay');
    if (el) {
        if (statusText) updateLoadingStatus(statusText);
        showRandomQuote();
        el.classList.remove('hidden');

        const app = document.querySelector('.app-container');
        if (app) app.classList.add('data-locked');

        if (quoteInterval) clearInterval(quoteInterval);
        quoteInterval = setInterval(showRandomQuote, 3000);
    }
}

function hideLoadingScreen() {
    const loaderLogo = document.querySelector('.loader-logo');
    const spinner = document.getElementById('loading-spinner');
    const el = document.getElementById('loading-overlay');
    const app = document.querySelector('.app-container');

    if (app) app.classList.remove('data-locked');

    if (loaderLogo) {
        if (spinner) spinner.style.display = 'none';
        loaderLogo.classList.add('logo-intro-zoom');

        setTimeout(() => {
            if (el) el.classList.add('hidden');
            if (quoteInterval) clearInterval(quoteInterval);
            if (spinner) spinner.style.display = 'block';
            loaderLogo.classList.remove('logo-intro-zoom');
        }, 800);
    } else {
        if (el) el.classList.add('hidden');
        if (quoteInterval) clearInterval(quoteInterval);
    }
}

function switchTab(tabId, navElement) {
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    navElement.classList.add('active');

    let slug = tabId === 'tab-env' ? 'env' : (tabId === 'tab-history' ? 'history' : (tabId === 'tab-users' ? 'users' : 'parking'));
    const newUrl = `${window.location.pathname}?tab=${slug}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    if (tabId === 'tab-history') {
        renderHistoryTab();
    }
}

function init() {
    // Check Admin Session
    if (localStorage.getItem('parkaxis_admin_session') === 'active') {
        isAdminLoggedIn = true;
        document.getElementById('login-overlay-admin').classList.add('hidden');
    }

    renderParking();
    connectMQTT();
    updateClock();
    setInterval(updateClock, 1000);

    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'env') {
        switchTab('tab-env', document.getElementById('nav-env'));
    } else if (tab === 'history') {
        switchTab('tab-history', document.getElementById('nav-history'));
    } else if (tab === 'users') {
        switchTab('tab-users', document.getElementById('nav-users'));
    } else {
        switchTab('tab-parking', document.getElementById('nav-parking'));
    }
    
    // Initial Render for History
    renderHistoryTab();
    setInterval(updateDurations, 1000); // Live duration update
    
    // Auto-hide loading screen after a short delay if requested by user
    // (User said: "ga perlu nunggu data masuk")
    setTimeout(() => {
        if (!hasData && client && client.connected) {
            hideLoadingScreen();
        }
    }, 4000);
}

function updateClock() {
    const now = new Date();
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    if (dom.realTime) dom.realTime.innerText = now.toLocaleTimeString('en-US', options);
    updateLastSeenDisplay();
}

let lastMessageTime = Date.now();
function updateLastSeenDisplay() {
    const el = document.getElementById('last-seen');
    const espInd = document.getElementById('esp-indicator');
    const espStat = document.getElementById('esp-status');
    if (!el) return;

    const diff = Math.floor((Date.now() - lastMessageTime) / 1000);
    const isOnline = diff < 15;

    if (espInd) espInd.className = `indicator ${isOnline ? 'online' : 'offline'}`;
    if (espStat) espStat.innerText = `ESP32: ${isOnline ? 'Online' : 'Offline'}`;

    if (diff < 5) {
        el.innerText = 'Last Seen: Just Now';
        el.style.color = 'var(--success)';
    } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        el.innerText = `Last Seen: ${m > 0 ? m + 'm ' : ''}${s}s ago`;
        el.style.color = diff > 15 ? 'var(--danger)' : 'var(--white2)';
    }
}

function renderParking() {
    const rowTop = document.getElementById('row-top');
    const rowBottom = document.getElementById('row-bottom');

    if (rowTop && rowBottom && rowTop.children.length === 0 && rowBottom.children.length === 0) {
        const order = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9];
        for (let j = 0; j < 10; j++) {
            const i = order[j];
            const slot = document.createElement('div');
            slot.id = 'slot-' + i;
            slot.className = 'slot free';
            slot.innerHTML = `
                <div class="slot-name">SLOT ${i + 1}</div>
                <i class="fa-solid fa-car slot-icon"></i>
                <div class="slot-status">Available</div>
            `;
            if (j < 5) rowTop.appendChild(slot);
            else rowBottom.appendChild(slot);
        }
    }

    let occupiedCount = 0;
    for (let i = 0; i < 10; i++) {
        const slot = document.getElementById('slot-' + i);
        if (!slot) continue;

        const isOccupied = parkingState[i] === 1;
        const wasOccupied = slot.classList.contains('occupied');
        
        if (isOccupied) occupiedCount++;
        
        if (wasOccupied !== isOccupied) {
            slot.classList.add('slot-pop');
            setTimeout(() => slot.classList.remove('slot-pop'), 400);
        }
        
        slot.className = `slot ${isOccupied ? 'occupied' : 'free'}`;
        slot.querySelector('.slot-status').innerText = isOccupied ? 'Occupied' : 'Free';
    }

    // Update Stat Bar
    const freeCount = 10 - occupiedCount;
    const pct = (occupiedCount / 10) * 100;
    if (dom.statFree) dom.statFree.innerText = freeCount;
    if (dom.statOcc) dom.statOcc.innerText = occupiedCount;
    if (dom.statPct) dom.statPct.innerText = pct.toFixed(0) + '%';
}

let connectionTimeout;
let hasData = false;
let dataTimeout;
let dataWatchdog;

function connectMQTT() {
    showLoadingScreen();
    updateLoadingStatus('Connecting to HiveMQ Broker...');

    if (client) {
        client.end(true);
        client.removeAllListeners();
    }

    client = mqtt.connect(MQTT_BROKER, {
        keepalive: 60,
        clientId: clientId,
        reconnectPeriod: 2000,
        connectTimeout: 30 * 1000,
    });

    client.on('connect', () => {
        console.log('MQTT Connected');
        updateLoadingStatus('Connected! Subscribing...');

        if (dom.mqttIndicator) dom.mqttIndicator.className = 'indicator online';
        if (dom.mqttStatus) dom.mqttStatus.innerText = 'Connected';

        client.subscribe(TOPIC_FROM_ESP, (err) => {
            if (!err) {
                updateLoadingStatus('Connected! Waiting for Data...');
                updateSystemStatus('waiting');
                if (dataTimeout) clearTimeout(dataTimeout);
                dataTimeout = setTimeout(() => {
                    if (!hasData) {
                        // Instead of critical error, just show waiting status in badge
                        updateSystemStatus('no-data');
                        hideLoadingScreen(); 
                    }
                }, 10000);
            }
        });
    });

    client.on('error', (err) => {
        console.error('MQTT Error:', err);
        updateLoadingStatus('Connection Error: ' + err.message);
    });

    client.on('reconnect', () => {
        hasData = false;
        // showLoadingScreen('Reconnecting to Broker...'); // Don't block UI on reconnect
        if (dom.mqttIndicator) dom.mqttIndicator.className = 'indicator warning';
        if (dom.mqttStatus) dom.mqttStatus.innerText = 'Reconnecting';
        updateSystemStatus('reconnecting');
    });

    client.on('offline', () => {
        hasData = false;
        if (dom.mqttIndicator) dom.mqttIndicator.className = 'indicator offline';
        if (dom.mqttStatus) dom.mqttStatus.innerText = 'Offline';
        updateFireStatus(false, false);
        updateSystemStatus('offline');
    });

    client.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'sensor') {
                if (!hasData) {
                    hasData = true;
                    updateLoadingStatus('Data Received! Starting...');
                    setTimeout(() => hideLoadingScreen(), 500);
                    if (dataTimeout) clearTimeout(dataTimeout);
                    updateSystemStatus('online');
                }

                if (dataWatchdog) clearTimeout(dataWatchdog);
                dataWatchdog = setTimeout(() => {
                    hasData = false;
                    if (dom.mqttIndicator) dom.mqttIndicator.className = 'indicator offline';
                    if (dom.mqttStatus) dom.mqttStatus.innerText = 'Disconnected (No Data)';
                    updateFireStatus(false, false);
                    updateSystemStatus('no-data');
                    if (client && client.connected) client.reconnect();
                }, 15000);

                updateSensors(data);
                lastMessageTime = Date.now();
                updateLastSeenDisplay();

                // Handle users from ESP32
                if (data.users && Array.isArray(data.users)) {
                    registeredUsers = data.users;
                    renderUserManagement();
                }
            }
        } catch (e) {
            console.error('JSON Parse Error', e);
        }
    });
}

function updateFireStatus(isFire, hasData = true) {
    const indicator = dom.fireIndicator;
    const statusText = dom.fireStatusText;

    if (!hasData) {
        if (indicator) {
            indicator.className = 'indicator offline';
            indicator.style.background = '';
            indicator.style.boxShadow = '';
        }
        if (statusText) statusText.innerText = 'No Data';
        return;
    }

    if (isFire) {
        if (indicator) {
            indicator.className = 'indicator online';
            indicator.style.background = 'var(--danger)';
            indicator.style.boxShadow = '0 0 15px var(--danger)';
            indicator.classList.add('pulse-alert');
        }
        if (statusText) {
            statusText.innerText = 'FIRE DETECTED!';
            statusText.style.color = 'var(--danger)';
            statusText.style.fontWeight = '700';
        }
    } else {
        if (indicator) {
            indicator.className = 'indicator online';
            indicator.style.background = 'var(--success)';
            indicator.style.boxShadow = '0 0 10px var(--success)';
            indicator.classList.remove('pulse-alert');
        }
        if (statusText) {
            statusText.innerText = 'System Safe';
            statusText.style.color = '';
            statusText.style.fontWeight = '400';
        }
    }
}

let lastScannedUID = null;
let scanCooldown = false;

function handleRFIDScan(uid) {
    if (!uid) return;
    if (currentUIDs.includes(uid)) {
        if (!scanCooldown) {
            sendGateCmd('OPEN');
            if (gateCloseTimer) clearTimeout(gateCloseTimer);
            gateCloseTimer = setTimeout(() => sendGateCmd('CLOSE'), 5000);
            Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                icon: 'success', title: 'Access Granted', text: `Role: User (${uid})`,
                background: '#1e293b', color: '#fff'
            });
            lastScannedUID = uid;
            scanCooldown = true;
            setTimeout(() => { scanCooldown = false; }, 3000);

            // Entry / Exit Logic
            handleSystemTap(uid);
        }
        return;
    }

    if (scanCooldown && lastScannedUID === uid) return;
    lastScannedUID = uid;
    scanCooldown = true;
    setTimeout(() => { scanCooldown = false; }, 3000);

    if (isAddingMode) {
        if (currentUIDs.length >= maxUIDs) {
            Swal.fire({ icon: 'error', title: 'List Penuh', text: 'List UID sudah penuh.', background: '#1e293b', color: '#fff' });
            return;
        }
        isAddingMode = false;
        Swal.fire({
            title: 'New Card Detected!',
            html: `<div style="font-size: 20px; font-weight: 700; color: var(--gold); margin: 10px 0;">${uid}</div>Tambahkan ke sistem?`,
            icon: 'question', showCancelButton: true,
            confirmButtonColor: 'var(--success)', cancelButtonColor: 'var(--text-muted)',
            confirmButtonText: 'Ya, Tambahkan', cancelButtonText: 'Tidak',
            background: '#1e293b', color: '#fff', allowOutsideClick: false
        }).then((res) => { if (res.isConfirmed) addUID(uid); });
    } else {
        sendGateCmd('CLOSE');
        Swal.fire({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
            icon: 'error', title: 'Access Denied', text: `Unknown Card: ${uid}`,
            background: '#1e293b', color: '#fff'
        });
    }
}

function updateSensors(data) {
    if (data.t != null) {
        const t = Number(data.t);
        if (dom.tempVal) dom.tempVal.innerText = t.toFixed(1) + '°C';
        if (dom.tempCard) {
            if (t >= 32) dom.tempCard.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
            else if (t >= 24) dom.tempCard.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            else dom.tempCard.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
            if (dom.tempStatus) dom.tempStatus.innerText = t >= 32 ? "HOT WARNING" : (t >= 24 ? "Normal" : "Cool");
        }
    }

    if (data.h != null) {
        const h = Number(data.h);
        if (dom.humVal) dom.humVal.innerText = h.toFixed(1) + '%';
        if (dom.humCard) {
            if (h < 40) dom.humCard.style.background = 'linear-gradient(135deg, #d97706, #b45309)';
            else if (h > 70) dom.humCard.style.background = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
            else dom.humCard.style.background = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
            if (dom.humStatus) dom.humStatus.innerText = h < 40 ? "Dry" : (h > 70 ? "Humid" : "Comfortable");
        }
    }

    if (data.ldr != null) {
        const raw = Number(data.ldr);
        const lux = Math.floor((raw / 4095) * 1000);
        const percent = Math.min((raw / 4095) * 100, 100);
        if (dom.ldrVal) dom.ldrVal.innerText = lux + ' Lux';
        if (dom.ldrBar) dom.ldrBar.style.width = percent + '%';
        if (dom.ldrCard) {
            dom.ldrCard.style.background = lux < 200 ? 'linear-gradient(135deg, #475569, #1e293b)' : 'linear-gradient(135deg, #f59e0b, #d97706)';
        }
    }

    if (dom.fireStatus) {
        if (data.bz) { dom.fireStatus.innerText = 'FIRE DETECTED'; dom.fireStatus.className = 'badge badge-alert'; }
        else { dom.fireStatus.innerText = 'No Fire'; dom.fireStatus.className = 'badge badge-safe'; }
    }

    if (data.bz !== undefined) {
        updateFireStatus(data.bz); // Sync the visual indicator
        if (data.bz) {
            alarmActive = true;
            showTurnOffAlarmButton();
            if (!lastAlarmState && !fireAlertShowing) {
                if (gateCloseTimer) { clearTimeout(gateCloseTimer); gateCloseTimer = null; }
                showFireAlert("Kebakaran terdeteksi! Segera evakuasi.");
            }
            lastAlarmState = true;
        } else {
            alarmActive = false;
            hideTurnOffAlarmButton();
            fireAlertShowing = false;
            lastAlarmState = false;
        }
    }

    if (data.p && Array.isArray(data.p)) {
        if (JSON.stringify(parkingState) !== JSON.stringify(data.p)) {
            const oldState = [...parkingState];
            parkingState = data.p;
            
            // Detect changes in sensors
            for (let i = 0; i < 10; i++) {
                if (oldState[i] === 0 && parkingState[i] === 1) {
                    // SENSOR CHANGE: 0 -> 1 (Car Parked)
                    handleCarParked(i);
                } else if (oldState[i] === 1 && parkingState[i] === 0) {
                    // SENSOR CHANGE: 1 -> 0 (Car Left Slot)
                    handleCarLeftSlot(i);
                }
            }
            renderParking();
        }
    }

    if (data.rfid_uid && Array.isArray(data.rfid_uid)) {
        const rfidListEl = document.getElementById('rfid-list');
        const isLoading = rfidListEl && rfidListEl.innerText.includes('Loading');
        
        if (JSON.stringify(currentUIDs) !== JSON.stringify(data.rfid_uid) || isLoading) {
            currentUIDs = data.rfid_uid;
            renderRFIDList();
        }
    }

    if (data.max_uids != null && maxUIDs !== data.max_uids) {
        maxUIDs = data.max_uids;
        if (dom.maxCnt) dom.maxCnt.innerText = maxUIDs;
    }

    if (data.scanned && data.scanned !== "") handleRFIDScan(data.scanned);
}

function renderRFIDList() {
    if (dom.curCnt) dom.curCnt.innerText = currentUIDs.length;
    if (dom.maxCnt) dom.maxCnt.innerText = maxUIDs;
    const list = document.getElementById('rfid-list');
    if (!list) return;
    if (currentUIDs.length === 0) {
        list.innerHTML = `<div style="text-align:center;color:var(--white3);opacity:0.6;">Belum ada UID terdaftar</div>`;
        return;
    }
    list.innerHTML = '';
    currentUIDs.forEach(uid => {
        const item = document.createElement('div');
        item.className = 'rfid-item';
        item.innerHTML = `
            <span class="rfid-uid">${uid}</span>
            <button class="btn-del" onclick="delUID('${uid}')"><i class="fa-solid fa-trash"></i></button>
        `;
        list.appendChild(item);
    });
}

function renderUserManagement() {
    const tbody = document.getElementById('user-mgmt-table');
    if (!tbody) return;

    if (registeredUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--white3);padding:30px;">No users registered</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    registeredUsers.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="font-weight:600;">${user.n}</div></td>
            <td><div style="font-family:var(--font-mono);">${user.p}</div></td>
            <td>${user.t}</td>
            <td><div style="font-family:var(--font-mono);">${user.u || '-'}</div></td>
            <td>
                <button class="btn-del" onclick="deleteUser('${user.n}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function registerUser(n, p, t, u) {
    if (!n || !p || !t) return;
    client.publish(TOPIC_TO_ESP, JSON.stringify({
        reg_user: { n, p, t, u: u || '' }
    }));
}

function deleteUser(name) {
    Swal.fire({
        title: 'Hapus User?',
        text: `User ${name} akan dihapus permanen.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Ya, Hapus',
        background: '#1e293b', color: '#fff'
    }).then((res) => {
        if (res.isConfirmed) {
            client.publish(TOPIC_TO_ESP, JSON.stringify({ del_user: name }));
        }
    });
}

function showAddUserModal() {
    Swal.fire({
        title: 'Tambah User Baru',
        html: `
            <input id="swal-user" class="swal2-input" placeholder="Username">
            <input id="swal-pass" class="swal2-input" placeholder="Password">
            <input id="swal-telp" class="swal2-input" placeholder="No. Telepon">
            <input id="swal-uid"  class="swal2-input" placeholder="RFID UID (opsional)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        background: '#1e293b', color: '#fff',
        preConfirm: () => {
            const n = document.getElementById('swal-user').value.trim();
            const p = document.getElementById('swal-pass').value;
            const t = document.getElementById('swal-telp').value;
            const u = document.getElementById('swal-uid').value.trim();
            
            if (!n || !p || !t) {
                Swal.showValidationMessage('Username, password, dan telepon harus diisi');
                return false;
            }
            if (/\s/.test(n)) {
                Swal.showValidationMessage('Username tidak boleh mengandung spasi');
                return false;
            }
            return { n, p, t, u };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            registerUser(result.value.n, result.value.p, result.value.t, result.value.u);
            Swal.fire({ icon: 'success', title: 'User registered!', timer: 1500, showConfirmButton: false, background: '#1e293b', color: '#fff' });
        }
    });
}

function checkAdminLogin() {
    const token = document.getElementById('admin-token').value;
    const err = document.getElementById('admin-login-err');
    
    if (token === 'admin123') { // Hardcoded admin token
        isAdminLoggedIn = true;
        localStorage.setItem('parkaxis_admin_session', 'active');
        document.getElementById('login-overlay-admin').classList.add('hidden');
        err.style.display = 'none';
        Swal.fire({
            icon: 'success',
            title: 'Welcome Admin',
            timer: 1500,
            showConfirmButton: false,
            background: '#0a0c10', color: '#fff'
        });
    } else {
        err.style.display = 'block';
        setTimeout(() => { err.style.display = 'none'; }, 3000);
    }
}

function sendGateCmd(state) {
    client.publish(TOPIC_TO_ESP, JSON.stringify({ servo: state }));
    if (state === 'OPEN') {
        if (dom.gateBox) dom.gateBox.style.background = 'var(--success)';
        if (dom.gateIcon) dom.gateIcon.className = 'fa-solid fa-unlock';
        if (dom.gateText) dom.gateText.innerText = 'UNLOCKED';
    } else {
        if (dom.gateBox) dom.gateBox.style.background = 'linear-gradient(135deg, var(--gold), var(--gold3))';
        if (dom.gateIcon) dom.gateIcon.className = 'fa-solid fa-lock';
        if (dom.gateText) dom.gateText.innerText = 'LOCKED';
    }
}

function startAddProcess() {
    isAddingMode = true;
    Swal.fire({
        title: 'Scanning Mode', text: 'Scan kartu RFID anda...',
        icon: 'info', showCancelButton: true, cancelButtonText: 'Batal', showConfirmButton: false,
        background: '#1e293b', color: '#fff', allowOutsideClick: false
    }).then((res) => { if (res.dismiss === Swal.DismissReason.cancel) isAddingMode = false; });
}

function addUID(uid) {
    if (!uid) return;
    client.publish(TOPIC_TO_ESP, JSON.stringify({ add_uid: uid }));
    setTimeout(() => {
        if (gateCloseTimer) clearTimeout(gateCloseTimer);
        gateCloseTimer = setTimeout(() => sendGateCmd('CLOSE'), 4500);
    }, 500);
    Swal.fire({ title: 'Berhasil!', icon: 'success', timer: 1500, showConfirmButton: false, background: '#1e293b', color: '#fff' });
}

function delUID(uid) {
    Swal.fire({
        title: 'Hapus UID?', text: "UID " + uid + " akan dihapus.", icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus!', background: '#1e293b', color: '#fff'
    }).then((res) => { if (res.isConfirmed) client.publish(TOPIC_TO_ESP, JSON.stringify({ del_uid: uid })); });
}

function manualAlert() {
    Swal.fire({
        title: 'Broadcast Alert?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'KIRIM!', background: '#1e293b', color: '#fff'
    }).then((res) => { if (res.isConfirmed) client.publish(TOPIC_TO_ESP, JSON.stringify({ manual_emergency: 1 })); });
}

function showFireAlert(message) {
    fireAlertShowing = true;
    Swal.fire({
        title: '⚠️ EMERGENCY!', text: message, icon: 'error',
        background: '#450a0a', color: '#fff', confirmButtonText: 'SAYA MENGERTI',
        confirmButtonColor: '#ef4444', allowOutsideClick: false
    }).then(() => { fireAlertShowing = false; });
}

function showTurnOffAlarmButton() {
    const btn = document.getElementById('turn-off-alarm-btn');
    if (btn) btn.style.display = 'block';
}

function hideTurnOffAlarmButton() {
    const btn = document.getElementById('turn-off-alarm-btn');
    if (btn) btn.style.display = 'none';
}

function turnOffAlarm() {
    Swal.fire({
        title: 'Matikan Alarm?', icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#10b981', cancelButtonColor: '#6b7280',
        confirmButtonText: 'Ya, Matikan', background: '#1e293b', color: '#fff'
    }).then((res) => {
        if (res.isConfirmed) {
            client.publish(TOPIC_TO_ESP, JSON.stringify({ turn_off_alarm: 1 }));
            alarmActive = false;
            hideTurnOffAlarmButton();
        }
    });
}

function updateLoadingStatus(text) {
    const el = document.getElementById('loading-status');
    if (el) el.innerText = text;
}

function showCriticalError(title, msg) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'none';
    const quote = document.getElementById('loading-quote');
    if (quote) quote.style.display = 'none';
    const titleEl = document.getElementById('loading-title');
    if (titleEl) { titleEl.innerText = title; titleEl.style.color = '#ef4444'; }
    const statusEl = document.getElementById('loading-status');
    if (statusEl) { statusEl.innerText = msg; statusEl.style.color = '#f8fafc'; }
    const errBtn = document.getElementById('loading-error-btn');
    if (errBtn) errBtn.style.display = 'block';
}

function changeMaxUIDs() {
    Swal.fire({
        title: 'Atur Batas Maksimal UID', input: 'number', inputValue: maxUIDs, showCancelButton: true,
        confirmButtonText: 'Simpan', background: '#1e293b', color: '#fff',
        inputValidator: (value) => { if (!value || value < 1 || value > 50) return '1-50!'; }
    }).then((result) => {
        if (result.isConfirmed) {
            client.publish(TOPIC_TO_ESP, JSON.stringify({ set_max_uids: parseInt(result.value) }));
        }
    });
}

function sendLCDMsg(text) {
    if (client && client.connected) {
        client.publish(TOPIC_TO_ESP, JSON.stringify({ lcd_msg: text }));
    }
}

function updateSystemStatus(status) {
    const badge = dom.systemBadge;
    const text = dom.systemStatusText;
    const indicator = dom.systemIndicator;
    if (!badge || !text || !indicator) return;

    badge.className = 'system-badge ' + status;
    
    switch(status) {
        case 'online':
            text.innerText = 'SYSTEM ONLINE';
            break;
        case 'waiting':
            text.innerText = 'WAITING DATA';
            break;
        case 'reconnecting':
            text.innerText = 'RECONNECTING';
            break;
        case 'offline':
            text.innerText = 'SYSTEM OFFLINE';
            break;
        case 'no-data':
            text.innerText = 'NO DATA SIGNAL';
            break;
    }
}

// ============================================================
// PARKING LOGIC & HISTORY
// ============================================================

// Lookup registered user by their RFID UID
function getUserByUID(uid) {
    return registeredUsers.find(u => u.u && u.u === uid) || null;
}

// ============================================================
// NEW SENSOR-BASED PARKING LOGIC
// ============================================================

function handleSystemTap(uid) {
    // 1. User Taps
    
    // Check if this user is already parked somewhere
    if (parkedUsers[uid]) {
        // User is parked. Are they trying to EXIT?
        // We check if they have left their slot (sensor changed 1 -> 0)
        let slotIndex = parkedUsers[uid].slotIndex;
        if (parkingState[slotIndex] === 0) {
            // Yes, they left the slot and now they tap at the gate.
            // 6. Servo buka dan berhenti hitung
            processExit(uid);
        } else {
            // They are still in the slot but tapped? 
            // Maybe they just want to open the gate to let someone else in? 
            // Or maybe they haven't moved yet.
            Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                icon: 'warning', title: 'Car Still in Slot', text: `Please move your car from Slot ${slotIndex + 1} first.`,
                background: '#1e293b', color: '#fff'
            });
        }
    } else {
        // User is NOT parked. They are ENTERING.
        pendingEntryUID = uid;
        sendGateCmd('OPEN');
        if (gateCloseTimer) clearTimeout(gateCloseTimer);
        gateCloseTimer = setTimeout(() => sendGateCmd('CLOSE'), 5000);
        
        Swal.fire({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
            icon: 'info', title: 'Proceed to Park', text: `UID: ${uid}. Waiting for sensor...`,
            background: '#1e293b', color: '#fff'
        });
        
        sendLCDMsg(`TAP OK! PARK NOW`);
    }
}

function handleCarParked(slotIndex) {
    // 2. Detek ada perubahan di list 10 sensor sensor (0 -> 1)
    if (pendingEntryUID) {
        // 3. Jika ada perubahan di satu sensor maka akan mulai hitung berapa lama
        const uid = pendingEntryUID;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const fullDateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

        // Lookup username dari UID
        const matchedUser = getUserByUID(uid);
        const username = matchedUser ? matchedUser.n : null;

        parkedUsers[uid] = {
            timestamp: now.getTime(),
            timeStr: timeStr,
            date: fullDateStr,
            slotIndex: slotIndex,
            username: username
        };

        // Add to history log as entry event
        parkingHistory.unshift({
            uid: uid,
            username: username,
            type: 'ENTRY',
            entry: timeStr,
            exit: '-',
            date: fullDateStr,
            duration: 'Parked...',
            slot: slotIndex + 1,
            timestamp: now.getTime()
        });

        const displayName = username ? `${username} (${uid})` : `UID: ${uid}`;
        Swal.fire({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 4000,
            icon: 'success', title: 'Started Parking', text: `${displayName} → Slot ${slotIndex + 1}`,
            background: '#1e293b', color: '#fff'
        });

        sendLCDMsg(`SLOT ${slotIndex+1} OK!`);
        pendingEntryUID = null; // Clear pending
        saveParkingData();
        renderHistoryTab();
    } else {
        console.log(`Car parked in slot ${slotIndex + 1} without RFID tap.`);
    }
}

function handleCarLeftSlot(slotIndex) {
    // 4. Jika ada perubahan sensor yang sama (1 -> 0)
    // Find who was in this slot
    let uidInSlot = null;
    for (const uid in parkedUsers) {
        if (parkedUsers[uid].slotIndex === slotIndex) {
            uidInSlot = uid;
            break;
        }
    }

    if (uidInSlot) {
        Swal.fire({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 5000,
            icon: 'info', title: 'Slot Vacated', text: `UID: ${uidInSlot} left Slot ${slotIndex + 1}. Please tap at gate.`,
            background: '#1e293b', color: '#fff'
        });
        sendLCDMsg(`SLOT ${slotIndex+1} FREE. TAP GATE!`);
    }
}

function processExit(uid) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fullDateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

    const entryTime = new Date(parkedUsers[uid].timestamp);
    const durationMs = now - entryTime;
    const durationText = formatDuration(durationMs);

    // Resolve username: from parkedUsers record or fresh lookup
    const username = parkedUsers[uid].username || (getUserByUID(uid) ? getUserByUID(uid).n : null);

    // 6. Servo buka dan berhenti hitung berapa lama
    sendGateCmd('OPEN');
    if (gateCloseTimer) clearTimeout(gateCloseTimer);
    gateCloseTimer = setTimeout(() => sendGateCmd('CLOSE'), 5000);

    // Add to history
    parkingHistory.unshift({
        uid: uid,
        username: username,
        type: 'EXIT',
        entry: parkedUsers[uid].timeStr,
        exit: timeStr,
        date: fullDateStr,
        duration: durationText,
        slot: parkedUsers[uid].slotIndex + 1,
        timestamp: now.getTime()
    });

    // Remove from parked
    delete parkedUsers[uid];

    const displayName = username ? username : uid;
    Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 5000,
        icon: 'success', title: `Exit: ${displayName}`, text: `Duration: ${durationText}`,
        background: '#1e293b', color: '#fff'
    });

    // Send feedback to LCD
    sendLCDMsg(`OUT: ${durationText}`);
    
    saveParkingData();
    renderHistoryTab();
}

function saveParkingData() {
    localStorage.setItem('parkaxis_parked_users', JSON.stringify(parkedUsers));
    localStorage.setItem('parkaxis_history', JSON.stringify(parkingHistory));
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

function updateDurations() {
    const tab = document.getElementById('tab-history');
    if (!tab || !tab.classList.contains('active')) return;
    renderParkedUsersTable(); 
}

function renderHistoryTab() {
    renderParkedUsersTable();
    renderActivityLogTable();
}

function renderParkedUsersTable() {
    const tbody = document.getElementById('parked-users-table');
    const countEl = document.getElementById('parked-now-count');
    if (!tbody) return;

    const uids = Object.keys(parkedUsers);
    if (countEl) countEl.innerText = `${uids.length} Vehicle${uids.length !== 1 ? 's' : ''}`;

    if (uids.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--white3);padding:30px;">No vehicles currently parked</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    uids.forEach(uid => {
        const data = parkedUsers[uid];
        const duration = formatDuration(new Date() - new Date(data.timestamp));
        const displayId = data.username
            ? `<span style="font-weight:600;color:var(--gold2);">${data.username}</span><br><span class="uid-badge" style="font-size:10px;">${uid}</span>`
            : `<span class="uid-badge">${uid}</span>`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${displayId}</td>
            <td><span class="slot-badge">Slot ${data.slotIndex + 1}</span></td>
            <td>${data.timeStr} <span style="font-size:10px;color:var(--white3)">(${data.date})</span></td>
            <td style="color:var(--gold2);font-weight:600;">${duration}</td>
            <td><button class="btn-force-exit" onclick="forceExit('${uid}')">Force Exit</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderActivityLogTable() {
    const tbody = document.getElementById('parking-history-table');
    if (!tbody) return;

    if (parkingHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--white3);padding:30px;">Activity log is empty</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    parkingHistory.slice(0, 50).forEach(item => {
        const displayId = item.username
            ? `<span style="font-weight:600;color:var(--gold2);">${item.username}</span><br><span class="uid-badge" style="font-size:10px;">${item.uid}</span>`
            : `<span class="uid-badge">${item.uid}</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${displayId}</td>
            <td><span class="slot-badge">Slot ${item.slot || '?'}</span></td>
            <td><span class="type-${item.type.toLowerCase()}">${item.type}</span></td>
            <td>${item.entry}</td>
            <td>${item.exit}</td>
            <td style="color:${item.type === 'EXIT' ? 'var(--gold2)' : 'var(--white3)'}; font-weight:600;">${item.duration}</td>
        `;
        tbody.appendChild(tr);
    });
}

function forceExit(uid) {
    Swal.fire({
        title: 'Force Exit?',
        text: `Keluarkan kendaraan ${uid} secara manual?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--danger)',
        confirmButtonText: 'Ya, Keluarkan',
        background: '#1e293b', color: '#fff'
    }).then((res) => {
        if (res.isConfirmed) {
            processExit(uid);
        }
    });
}

function clearHistory() {
    Swal.fire({
        title: 'Hapus Log?',
        text: "Seluruh riwayat parkir akan dihapus permanen.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Ya, Hapus Semua',
        background: '#1e293b', color: '#fff'
    }).then((res) => {
        if (res.isConfirmed) {
            parkingHistory = [];
            saveParkingData();
            renderActivityLogTable();
            Swal.fire({ icon: 'success', title: 'Cleared!', timer: 1000, showConfirmButton: false, background: '#1e293b', color: '#fff' });
        }
    });
}

document.addEventListener('DOMContentLoaded', init);