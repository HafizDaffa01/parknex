// CONFIG MQTT
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const TOPIC_TO_ESP = 'ESP32mqttTest01/web/to/esp';
const TOPIC_FROM_ESP = 'ESP32mqttTest01/esp/to/web';



let client;
let clientId = 'ESP32-DASHBOARD-' + Math.random().toString(16).substr(2, 8);

// UI State
let currentUIDs = [];
let maxUIDs = 3; // Default limit, will be updated by ESP32
let parkingState = new Array(10).fill(0);
let fireAlertShowing = false;
let alarmActive = false; // Track if alarm is currently active
let lastAlarmState = false; // Track previous alarm state to prevent spam
let isAddingMode = false;
let gateCloseTimer = null;

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
};



// Quotes for Loading Screen (Expanded for variety)
const quotes = [
    "Technology is best when it brings people together. - Matt Mullenweg",
    "The advance of technology is based on making it fit in so that you don't really even notice it, so it's part of everyday life. - Bill Gates",
    "It's not that we use technology, we live technology. - Godfrey Reggio",
    "Innovation is the outcome of a habit, not a random act. - Sukant Ratnakar",
    "The future belongs to those who allow themselves to be inspired.",
    "Smart cities are the key to a sustainable future.",
    "Automation is good, so long as you know exactly where to put the machine. - Eliyahu Goldratt",
    "Any sufficiently advanced technology is indistinguishable from magic. - Arthur C. Clarke",
    "The only way to discover the limits of the possible is to go beyond them into the impossible. - Arthur C. Clarke",
    "Logic will get you from A to B. Imagination will take you everywhere. - Albert Einstein",
    "The best way to predict the future is to invent it. - Alan Kay",
    "Technology like art is a soaring exercise of the human imagination. - Daniel Bell",
    "Simplicity is the ultimate sophistication. - Leonardo da Vinci",
    "Code is poetry.",
    "First, solve the problem. Then, write the code. - John Johnson",
    "Experience is the name everyone gives to their mistakes. - Oscar Wilde",
    "Java is to JavaScript what car is to Carpet. - Chris Heilmann",
    "Knowledge is power. - Francis Bacon",
    "Computers are fast; developers keep them slow. - Anonymous",
    "Hardware is easy to protect: lock it in a room... Software is another matter.",
    "Talk is cheap. Show me the code. - Linus Torvalds",
    "When something is important enough, you do it even if the odds are against you. - Elon Musk",
    "I do not think that the wireless wave I have discovered will have any practical application. - Heinrich Hertz (wrongly)",
    "We are stuck with technology when what we really want is just stuff that works. - Douglas Adams",
    "Data is a precious thing and will last longer than the systems themselves. - Tim Berners-Lee",
    "Software is eating the world. - Marc Andreessen",
    "Connectivity is a human right. - Mark Zuckerberg",
    "The Internet is becoming the town square for the global village of tomorrow. - Bill Gates",
    "IoT: The internet of things, or the internet of threats?",
    "Make it work, make it right, make it fast. - Kent Beck",
    "If it works, don't touch it. - Someone Wise",
    "My code works, I have no idea why. - Every Programmer",
    "There are 10 types of people in the world: those who understand binary, and those who don't.",
    "A computer is like air conditioning - it becomes useless when you open windows. - Linus Torvalds",
    "Debuggers don't remove bugs. They only show them in slow motion.",
    "Algorithm: Word used by programmers when they don't want to explain what they did."
];

let quoteInterval;

function showRandomQuote() {
    const quoteEl = document.getElementById('loading-quote');
    if (quoteEl) {
        // Ensure we don't pick the exact same one twice in a row if possible
        let newQuote = quotes[Math.floor(Math.random() * quotes.length)];
        while (quoteEl.innerText.includes(newQuote) && quotes.length > 1) {
            newQuote = quotes[Math.floor(Math.random() * quotes.length)];
        }
        quoteEl.innerText = `"${newQuote}"`;
    }
}

// ... existing tab logic ...

function showLoadingScreen(statusText) {
    const el = document.getElementById('loading-overlay');
    if (el) {
        if (statusText) updateLoadingStatus(statusText);
        showRandomQuote(); // Show initial
        el.classList.remove('hidden');

        // Lock interaction on main container
        const app = document.querySelector('.app-container');
        if (app) app.classList.add('data-locked');

        // Clear existing if any
        if (quoteInterval) clearInterval(quoteInterval);

        // Rotate quotes every 3 seconds for dynamic effect
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
        // Hide spinner first
        if (spinner) spinner.style.display = 'none';

        // Zoom the logo
        loaderLogo.classList.add('logo-intro-zoom');

        // Wait for zoom animation, then hide overlay
        setTimeout(() => {
            if (el) el.classList.add('hidden');
            if (quoteInterval) clearInterval(quoteInterval);
            // Also reset spinner for next time it's shown
            if (spinner) spinner.style.display = 'block';
            loaderLogo.classList.remove('logo-intro-zoom');
        }, 800); // Match animation duration
    } else {
        // Fallback if logo not found
        if (el) el.classList.add('hidden');
        if (quoteInterval) clearInterval(quoteInterval);
    }
}

// Tab Switching Logic
function switchTab(tabId, navElement) {
    // Hide all tabs
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    // Deselect all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabId).classList.add('active');
    // Select nav item
    navElement.classList.add('active');

    // Update URL
    let slug = 'parking';
    if (tabId === 'tab-env') slug = 'env';

    const newUrl = `${window.location.pathname}?tab=${slug}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

function init() {
    renderParking();
    connectMQTT();
    updateClock();
    setInterval(updateClock, 1000);

    // Check URL params for tab
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'env') {
        switchTab('tab-env', document.getElementById('nav-env'));
    } else if (tab === 'parking') {
        switchTab('tab-parking', document.getElementById('nav-parking'));
    }
}

function updateClock() {
    const now = new Date();
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    if (dom.realTime) dom.realTime.innerText = now.toLocaleTimeString('en-US', options);
}

function renderParking() {
    const rowTop = document.getElementById('row-top');
    const rowBottom = document.getElementById('row-bottom');

    if (rowTop.children.length === 0 && rowBottom.children.length === 0) {
        const order = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9]; // tuker 1 & 2

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

            if (j < 6) {
                rowTop.appendChild(slot);
            } else {
                rowBottom.appendChild(slot);
            }
        }
    }


    for (let i = 0; i < 10; i++) {
        const slot = document.getElementById('slot-' + i);
        if (!slot) continue;

        const isOccupied = parkingState[i] === 1;
        slot.className = `slot ${isOccupied ? 'occupied' : 'free'}`;
        slot.querySelector('.slot-status').innerText =
            isOccupied ? 'Occupied' : 'Free';
    }
}


let connectionTimeout;
let hasData = false;
let dataTimeout;
let dataWatchdog; // Timer to detect if data stops coming

function connectMQTT() {
    showLoadingScreen();
    updateLoadingStatus('Connecting to HiveMQ Broker...');

    // If a client already exists, clean up listeners BEFORE creating a new one
    if (client) {
        console.log('Cleaning up existing MQTT client...');
        client.end(true); // Force close
        client.removeAllListeners();
    }

    client = mqtt.connect(MQTT_BROKER, {
        keepalive: 60,
        clientId: clientId,
        reconnectPeriod: 2000, // Try reconnecting every 2s
        connectTimeout: 30 * 1000,
    });

    client.on('connect', () => {
        console.log('MQTT.js Connected');
        updateLoadingStatus('Connected! Subscribing...');

        const mqttInd = document.getElementById('mqtt-indicator');
        const mqttStat = document.getElementById('mqtt-status');
        if (mqttInd) mqttInd.className = 'indicator online';
        if (mqttStat) mqttStat.innerText = 'Connected';

        client.subscribe(TOPIC_FROM_ESP, (err) => {
            if (!err) {
                console.log('Subscribed to:', TOPIC_FROM_ESP);
                updateLoadingStatus('Connected! Waiting for Data...');

                if (dataTimeout) clearTimeout(dataTimeout);
                dataTimeout = setTimeout(() => {
                    if (!hasData) {
                        showCriticalError('NO DATA FROM ESP32', 'Please check your ESP32 WiFi Connection or Power');
                    }
                }, 15000); // 15s to be safe
            }
        });
    });

    client.on('error', (err) => {
        console.error('MQTT Error: ', err);
        updateLoadingStatus('Connection Error: ' + err.message);
        // Don't call client.end() here, let the library handle reconnects
    });

    client.on('reconnect', () => {
        console.log('MQTT Reconnecting...');
        hasData = false; // Force re-initialization logic
        showLoadingScreen('Reconnecting to Broker...');
        const mqttInd = document.getElementById('mqtt-indicator');
        const mqttStat = document.getElementById('mqtt-status');
        if (mqttInd) mqttInd.className = 'indicator offline';
        if (mqttStat) mqttStat.innerText = 'Reconnecting';
    });

    client.on('offline', () => {
        console.warn('MQTT Offline');
        hasData = false;
        showLoadingScreen('Connection Offline...');
        const mqttInd = document.getElementById('mqtt-indicator');
        const mqttStat = document.getElementById('mqtt-status');
        if (mqttInd) mqttInd.className = 'indicator offline';
        if (mqttStat) mqttStat.innerText = 'Offline';
        updateFireStatus(false, false);
    });

    client.on('message', (topic, message) => {
        const payload = message.toString();
        try {
            const data = JSON.parse(payload);

            if (data.type === 'sensor') {
                if (!hasData) {
                    hasData = true;
                    updateLoadingStatus('Data Received! Starting...');
                    setTimeout(() => hideLoadingScreen(), 500);
                    if (dataTimeout) clearTimeout(dataTimeout);
                }

                updateFireStatus(data.bz, true); // Use 'bz' from ESP32

                // Watchdog: If no data for 10 seconds, mark as offline
                if (dataWatchdog) clearTimeout(dataWatchdog);
                dataWatchdog = setTimeout(() => {
                    console.warn("No data received for 10 seconds - ESP32 might be offline");
                    hasData = false;

                    if (dom.mqttIndicator) dom.mqttIndicator.className = 'indicator offline';
                    if (dom.mqttStatus) dom.mqttStatus.innerText = 'Disconnected (No Data)';

                    updateFireStatus(false, false);
                    showLoadingScreen('Waiting for Data from ESP32...');

                    if (client && client.connected) {
                        client.reconnect();
                    }
                }, 10000);

                updateSensors(data);
            }
        } catch (e) {
            console.error('JSON Parse Error', e);
        }
    });
}

function updateFireStatus(isFire, hasData = true) {
    const indicator = document.getElementById('fire-indicator');
    const statusText = document.getElementById('fire-status-text');

    if (!hasData) {
        if (indicator) {
            indicator.className = 'indicator offline';
            indicator.style.background = 'var(--text-muted)';
            indicator.style.boxShadow = 'none';
        }
        if (statusText) statusText.innerText = 'No Data';
        return;
    }

    if (isFire) {
        // Fire detected!
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
        // Safe
        if (indicator) {
            indicator.className = 'indicator online';
            indicator.style.background = 'var(--success)';
            indicator.style.boxShadow = '0 0 10px var(--success)';
            indicator.classList.remove('pulse-alert');
        }
        if (statusText) {
            statusText.innerText = 'System Safe';
            statusText.style.color = 'var(--text-main)';
            statusText.style.fontWeight = '400';
        }
    }
}

let lastScannedUID = null;
let scanCooldown = false;

function handleRFIDScan(uid) {
    if (!uid) return;
    console.log("APP: Handling RFID Scan:", uid, "Mode:", isAddingMode ? "ADDING" : "NORMAL");

    // 1. Check if card is already allowed -> OPEN GATE
    if (currentUIDs.includes(uid)) {
        console.log("APP: Card is authorized.");
        // Prevent spamming open command if needed, but sending it ensures gate opens
        if (!scanCooldown) {
            sendGateCmd('OPEN');

            // Auto close after 5s
            if (gateCloseTimer) clearTimeout(gateCloseTimer);
            gateCloseTimer = setTimeout(() => sendGateCmd('CLOSE'), 5000);
            Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                icon: 'success', title: 'Access Granted', text: `Role: User (${uid})`,
                background: '#1e293b', color: '#fff'
            });

            lastScannedUID = uid;
            scanCooldown = true;
            setTimeout(() => { scanCooldown = false; }, 3000); // 3s cooldown for same card
        }
        return;
    }

    // 2. Data is NOT in list (New Card)

    // Check cooldown
    if (scanCooldown && lastScannedUID === uid) {
        console.log("APP: Scan Cooldown active for this UID");
        return;
    }

    lastScannedUID = uid;
    scanCooldown = true;
    setTimeout(() => { scanCooldown = false; }, 3000);

    // 3. Only show "Add" prompt if in Adding Mode
    if (isAddingMode) {
        if (currentUIDs.length >= maxUIDs) {
            console.log("APP: RFID List Full");
            Swal.fire({
                icon: 'error',
                title: 'List Penuh',
                text: 'list uid sudah penuh, silahkan kurangi atau mengubah configurasi',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }

        console.log("APP: Triggering Add Prompt");
        // isAddingMode = false; // logic moved inside confirm
        // Directly fire new Swal to replace the "Scanning..." one

        // Temporarily unset isAddingMode to prevent double trigger while dialog is open?
        // No, keep it true until user decides, OR set to false now.
        isAddingMode = false;

        Swal.fire({
            title: 'New Card Detected!',
            html: `<div style="font-size: 20px; font-weight: 700; color: var(--primary-light); margin: 10px 0;">${uid}</div>Tambahkan kartu ini ke sistem?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: 'var(--success)',
            cancelButtonColor: 'var(--text-muted)',
            confirmButtonText: 'Ya, Tambahkan',
            cancelButtonText: 'Tidak',
            background: '#1e293b',
            color: '#fff',
            allowOutsideClick: false
        }).then((res) => {
            if (res.isConfirmed) {
                addUID(uid);
            }
        });
    } else {
        // Unauthorized card scanned when NOT in adding mode -> CLOSE GATE
        console.log("APP: Unauthorized card scanned - Closing gate");
        sendGateCmd('CLOSE');

        Swal.fire({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
            icon: 'error', title: 'Access Denied', text: `Unknown Card: ${uid}`,
            background: '#1e293b', color: '#fff'
        });
    }
}

function updateSensors(data) {
    // Temperature
    if (data.t != null) {
        const t = Number(data.t);
        if (dom.tempVal) dom.tempVal.innerText = t.toFixed(1) + '°C';

        if (dom.tempCard) {
            if (t >= 32) {
                dom.tempCard.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
                if (dom.tempStatus) dom.tempStatus.innerText = "HOT WARNING";
            } else if (t >= 24) {
                dom.tempCard.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                if (dom.tempStatus) dom.tempStatus.innerText = "Normal Temperature";
            } else {
                dom.tempCard.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
                if (dom.tempStatus) dom.tempStatus.innerText = "Cool / Cold";
            }
        }
    }

    // Humidity
    if (data.h != null) {
        const h = Number(data.h);
        if (dom.humVal) dom.humVal.innerText = h.toFixed(1) + '%';

        if (dom.humCard) {
            if (h < 40) {
                dom.humCard.style.background = 'linear-gradient(135deg, #d97706, #b45309)';
                if (dom.humStatus) dom.humStatus.innerText = "Dry Air";
            } else if (h > 70) {
                dom.humCard.style.background = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
                if (dom.humStatus) dom.humStatus.innerText = "High Humidity";
            } else {
                dom.humCard.style.background = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
                if (dom.humStatus) dom.humStatus.innerText = "Comfortable";
            }
        }
    }

    // Light (Lux)
    if (data.ldr != null) {
        const raw = Number(data.ldr);
        const lux = Math.floor((raw / 4095) * 1000);
        if (dom.ldrVal) dom.ldrVal.innerText = lux + ' Lux';

        const percent = Math.min((raw / 4095) * 100, 100);
        if (dom.ldrBar) dom.ldrBar.style.width = percent + '%';

        if (dom.ldrCard) {
            if (lux < 200) {
                dom.ldrCard.style.background = 'linear-gradient(135deg, #475569, #1e293b)';
            } else {
                dom.ldrCard.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            }
        }
    }

    // Update fire badge based on alarm state (bz)
    if (dom.fireStatus) {
        if (data.bz) {
            dom.fireStatus.innerText = 'FIRE DETECTED';
            dom.fireStatus.className = 'badge badge-alert';
        } else {
            dom.fireStatus.innerText = 'No Fire';
            dom.fireStatus.className = 'badge badge-safe';
        }
    }

    // Track buzzer state from Arduino and show alert
    if (data.bz !== undefined) {
        if (data.bz) {
            alarmActive = true;
            showTurnOffAlarmButton();

            if (!lastAlarmState && !fireAlertShowing) {
                if (gateCloseTimer) {
                    clearTimeout(gateCloseTimer);
                    gateCloseTimer = null;
                }

                let message = "Kebakaran terdeteksi di area parkir. Segera evakuasi area dan hubungi pemadam kebakaran.";
                if (data.fire !== 0) {
                    message = "Kebakaran terdeteksi di area parkir. Gerbang dibuka otomatis. Segera evakuasi area dan hubungi pemadam kebakaran.";
                }
                showFireAlert(message);
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
        // Optimization: Only render if state changed
        if (JSON.stringify(parkingState) !== JSON.stringify(data.p)) {
            parkingState = data.p;
            renderParking();
        }
    }

    if (data.rfid_uid && Array.isArray(data.rfid_uid)) {
        if (JSON.stringify(currentUIDs) !== JSON.stringify(data.rfid_uid)) {
            currentUIDs = data.rfid_uid;
            renderRFIDList();
        }
    }

    if (data.max_uids) {
        if (maxUIDs !== data.max_uids) {
            maxUIDs = data.max_uids;
            if (dom.maxCnt) dom.maxCnt.innerText = maxUIDs;
        }
    }

    // Handle newly scanned card
    if (data.scanned && data.scanned !== "") {
        handleRFIDScan(data.scanned);
    }
}

function renderRFIDList() {
    // Update header count
    const curCnt = document.getElementById('current-uids-count');
    const maxCnt = document.getElementById('max-uids-count');
    if (curCnt) curCnt.innerText = currentUIDs.length;
    if (maxCnt) maxCnt.innerText = maxUIDs;

    const list = document.getElementById('rfid-list');
    if (currentUIDs.length === 0) {
        list.innerHTML = `<div style="text-align:center;color:var(--text-muted);opacity:0.6;">Belum ada UID terdaftar</div>`;
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

function sendGateCmd(state) {
    client.publish(TOPIC_TO_ESP, JSON.stringify({ servo: state }));
    if (state === 'OPEN') {
        if (dom.gateBox) dom.gateBox.style.background = 'var(--success)';
        if (dom.gateIcon) dom.gateIcon.className = 'fa-solid fa-unlock';
        if (dom.gateText) dom.gateText.innerText = 'UNLOCKED';
    } else {
        if (dom.gateBox) dom.gateBox.style.background = 'var(--primary)';
        if (dom.gateIcon) dom.gateIcon.className = 'fa-solid fa-lock';
        if (dom.gateText) dom.gateText.innerText = 'LOCKED';
    }
}

function startAddProcess() {
    console.log("APP: Starting Add Process...");
    isAddingMode = true;
    Swal.fire({
        title: 'Scanning Mode',
        text: 'Silahkan scan kartu RFID anda di sensor untuk menambahkan...',
        icon: 'info',
        showCancelButton: true,
        cancelButtonText: 'Batal',
        showConfirmButton: false,
        background: '#1e293b',
        color: '#fff',
        allowOutsideClick: false
    }).then((res) => {
        // If dismissed by cancel or clicking outside (if allowed)
        if (res.dismiss === Swal.DismissReason.cancel) {
            isAddingMode = false;
        }
    });
}

function addUID(manualUid) {
    if (!manualUid) return;
    client.publish(TOPIC_TO_ESP, JSON.stringify({ add_uid: manualUid }));

    setTimeout(() => {
        if (gateCloseTimer) clearTimeout(gateCloseTimer);
        gateCloseTimer = setTimeout(() => sendGateCmd('CLOSE'), 4500); // ini buka setelah 4.5 detik
    }, 500);

    Swal.fire({ title: 'Berhasil!', text: 'UID berhasil ditambahkan!', icon: 'success', timer: 1500, showConfirmButton: false, background: '#1e293b', color: '#fff' });
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
    }).then((res) => {
        if (res.isConfirmed) {
            // Send manual emergency command to Arduino
            // Alert will show automatically when buzzer_active becomes true
            client.publish(TOPIC_TO_ESP, JSON.stringify({ manual_emergency: 1 }));
        }
    });
}

function showFireAlert(message) {
    fireAlertShowing = true;
    Swal.fire({
        title: '⚠️ EMERGENCY ALERT!',
        text: message,
        icon: 'error',
        background: '#450a0a',
        color: '#fff',
        confirmButtonText: 'SAYA MENGERTI',
        confirmButtonColor: '#ef4444',
        allowOutsideClick: false
    }).then(() => {
        // Just close the dialog, don't do anything else
        fireAlertShowing = false;
    });
}

function showTurnOffAlarmButton() {
    const btn = document.getElementById('turn-off-alarm-btn');
    if (btn) {
        btn.style.display = 'block';
    }
}

function hideTurnOffAlarmButton() {
    const btn = document.getElementById('turn-off-alarm-btn');
    if (btn) {
        btn.style.display = 'none';
    }
}

function turnOffAlarm() {
    Swal.fire({
        title: 'Matikan Alarm?',
        text: 'Alarm akan dimatikan. Pastikan situasi sudah aman!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Ya, Matikan',
        cancelButtonText: 'Batal',
        background: '#1e293b',
        color: '#fff'
    }).then((res) => {
        if (res.isConfirmed) {
            client.publish(TOPIC_TO_ESP, JSON.stringify({ turn_off_alarm: 1 }));
            alarmActive = false;
            hideTurnOffAlarmButton();
            Swal.fire({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                icon: 'success',
                title: 'Alarm Dimatikan',
                text: 'Alarm telah dinonaktifkan',
                background: '#1e293b',
                color: '#fff'
            });
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
    if (titleEl) {
        titleEl.innerText = title;
        titleEl.style.color = '#ef4444';
    }

    const statusEl = document.getElementById('loading-status');
    if (statusEl) {
        statusEl.innerText = msg;
        statusEl.style.color = '#f8fafc';
        statusEl.style.fontWeight = '600';
    }

    const errBtn = document.getElementById('loading-error-btn');
    if (errBtn) errBtn.style.display = 'block';

    // Zoom the logo on error too
    const loaderLogo = document.querySelector('.loader-logo');
    if (loaderLogo) {
        loaderLogo.classList.add('logo-intro-zoom');
    }
}

function changeMaxUIDs() {
    Swal.fire({
        title: 'Atur Batas Maksimal UID',
        text: 'Masukkan jumlah kartu maksimal yang bisa didaftarkan (1-50):',
        input: 'number',
        inputValue: maxUIDs,
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        cancelButtonText: 'Batal',
        background: '#1e293b',
        color: '#fff',
        inputValidator: (value) => {
            if (!value || value < 1 || value > 50) {
                return 'Masukkan angka antara 1 sampai 50!';
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const newLimit = parseInt(result.value);
            client.publish(TOPIC_TO_ESP, JSON.stringify({ set_max_uids: newLimit }));

            Swal.fire({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                icon: 'success',
                title: 'Mengupdate limit...',
                background: '#1e293b',
                color: '#fff'
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', init);
