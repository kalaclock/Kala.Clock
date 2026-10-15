// ==========================================================================
// KALA.CLOCK — JAVASCRIPT CONTROLLER LENGKAP (VERSI TERINTEGRASI API & ADMIN)
// Mengatur Seluruh Alur: Loading Screen -> Login Page -> Countdown Modal -> Main Dashboard
// Fitur:
// 1. Verifikasi Konsumen ke Database MySQL (api/api_login_user.php)
// 2. Pencatatan Log Akses Real-Time oleh Admin
// 3. Koneksi MQTT Real-Time (Paho MQTT WebSockets SSL)
// 4. Jam Analog (3 Jarum) & Jam Digital Sinkron 100%
// 5. Layar Virtual Running Text 4 Mode, Kecerahan, Kecepatan, & Efisiensi
// ==========================================================================

// ==========================================
// 1. GLOBAL VARIABLES & CONFIG
// ==========================================
const mqtt_broker = "broker.emqx.io";      // Alamat broker MQTT publik EMQX
const mqtt_port   = 8084;                  // Port WebSocket aman (WSS / SSL)

let id_jam = localStorage.getItem('kalaclock_id_jam') || 'KC00';
let mqtt_topic = `KalaClock/${id_jam}`;
let mqtt_topic_status = `KalaClock/${id_jam}/status`;
let mqttClient = null;
let timezoneOffset    = 8;                 // Default WITA (UTC+8)
let currentMode       = 4;                 // Default 4: Jam Digital + Teks Bergantian
let currentBrightness = 80;                // Kecerahan awal (0 - 255)
let currentSpeed      = 40;                // Kecepatan running text (ms)

// Variabel untuk mode 4
let mode4ShowClock    = true;
let mode4Timer        = null;

// ==========================================
// 2. AUTO-SAVE & LOAD FUNCTIONS
// ==========================================
function saveCurrentInputs() {
  if (!id_jam) return;
  
  let jadwalList = [];
  document.querySelectorAll('.jadwal-item').forEach(item => {
    const pesan = item.querySelector('.input-pesan')?.value || '';
    if (pesan.trim() !== '') {
      jadwalList.push({
        nama: item.querySelector('.input-nama-jadwal')?.value || '',
        mulai: item.querySelector('.input-mulai')?.value || '',
        selesai: item.querySelector('.input-selesai')?.value || '',
        pesan: pesan
      });
    }
  });

  const stateData = {
    teks: document.getElementById('inputTeks')?.value || '',
    brightness: document.getElementById('inputBrightness')?.value || 80,
    speed: document.getElementById('inputSpeed')?.value || 40,
    mode: currentMode,
    timezone: timezoneOffset,
    jadwal: jadwalList,
    tidur: document.getElementById('valWaktuTidur')?.value || '22:00',
    bangun: document.getElementById('valWaktuBangun')?.value || '04:00',
    kecerahan_malam: document.getElementById('valKecerahanMalam')?.value || 10,
    auto_sleep: document.getElementById('valAutoSleep')?.checked || false
  };

  localStorage.setItem(`kala_clock_state_${id_jam}`, JSON.stringify(stateData));
  saveInputsToDatabase();
}

function saveInputsToDatabase() {
  let activeIdJam = id_jam;
  if (!activeIdJam || activeIdJam.trim() === '') {
    activeIdJam = localStorage.getItem('kalaclock_id_jam');
  }
  if (!activeIdJam || activeIdJam.trim() === '') {
    const elDisplay = document.getElementById('displayIdJam');
    if (elDisplay) activeIdJam = elDisplay.innerText.trim();
  }

  if (!activeIdJam || activeIdJam === '' || activeIdJam === '{KC00}') {
    return;
  }

  const formData = new FormData();
  formData.append('id_jam', activeIdJam);
  formData.append('teks', document.getElementById('inputTeks')?.value || '');
  formData.append('brightness', document.getElementById('inputBrightness')?.value || 80);
  formData.append('speed', document.getElementById('inputSpeed')?.value || 40);
  formData.append('mode', currentMode || 4);

  fetch('api/api_simpan.php', {
    method: 'POST',
    body: formData
  })
  .then(res => res.json())
  .then(data => {
    console.log("Autosave DB Status:", data);
  })
  .catch(err => console.error("Gagal autosave ke database:", err));
}

function loadSavedInputs(id_jam) {
  const saved = localStorage.getItem(`kala_clock_state_${id_jam}`);
  if (!saved) return;

  try {
    const data = JSON.parse(saved);

    if (data.teks !== undefined && document.getElementById('inputTeks')) {
      document.getElementById('inputTeks').value = data.teks;
      updateTickerText(data.teks);
    }
    if (data.brightness !== undefined) setBrightness(data.brightness, true);
    if (data.speed !== undefined) {
      setSpeed(data.speed);
      if (document.getElementById('inputSpeed')) document.getElementById('inputSpeed').value = data.speed;
    }
    if (data.mode !== undefined) setDisplayMode(data.mode);
    if (data.timezone !== undefined) setTimezonePreset(data.timezone);

    if (data.tidur && document.getElementById('valWaktuTidur')) document.getElementById('valWaktuTidur').value = data.tidur;
    if (data.bangun && document.getElementById('valWaktuBangun')) document.getElementById('valWaktuBangun').value = data.bangun;
    if (data.kecerahan_malam && document.getElementById('valKecerahanMalam')) document.getElementById('valKecerahanMalam').value = data.kecerahan_malam;
    if (data.auto_sleep !== undefined && document.getElementById('valAutoSleep')) document.getElementById('valAutoSleep').checked = data.auto_sleep;

    if (data.jadwal && Array.isArray(data.jadwal) && data.jadwal.length > 0) {
      const container = document.getElementById('wadahJadwal');
      if (container) {
        container.innerHTML = '';
        jadwalCount = 0;
        data.jadwal.forEach(j => {
          jadwalCount++;
          const newItem = document.createElement('div');
          newItem.className = 'jadwal-item';
          newItem.style.cssText = "background-color: var(--bg-subcard); padding: 12px; border-radius: var(--radius-btn); border: 1px solid var(--border-subtle); margin-bottom: 8px;";
          newItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <input type="text" value="${j.nama}" class="input-nama-jadwal" style="background: transparent; border: none; color: var(--accent-tan); font-size: 11px; font-weight: 700; outline: none; width: 85px; font-family: 'Plus Jakarta Sans';">
              <div style="display: flex; gap: 4px; align-items: center;">
                <input type="time" class="control-input input-mulai" value="${j.mulai}" style="height: 24px; padding: 0 4px; font-size: 10px; width: 65px; text-align: center;">
                <span style="color: var(--text-muted); font-size: 10px;">-</span>
                <input type="time" class="control-input input-selesai" value="${j.selesai}" style="height: 24px; padding: 0 4px; font-size: 10px; width: 65px; text-align: center;">
                <button onclick="this.parentElement.parentElement.parentElement.remove(); saveCurrentInputs();" style="background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; margin-left: 4px; display: flex; align-items: center; justify-content: center; transition: 0.2s;" title="Hapus;">✕</button>
              </div>
            </div>
            <input type="text" class="control-input input-pesan" placeholder="Ketik pesan jadwal baru..." value="${j.pesan}" style="width: 100%;">
          `;
          container.appendChild(newItem);
        });
      }
    }
  } catch (e) {
    console.error("Gagal membaca saved state:", e);
  }
}

// ==========================================
// 3. SET CLOCK ID & MQTT LOGIC
// ==========================================
function setClockID(newID) {
  if (!newID) return;

  if (mqttClient && mqttClient.isConnected() && id_jam && id_jam !== newID) {
    mqttClient.unsubscribe(mqtt_topic);
  }

  id_jam = newID;
  mqtt_topic = `KalaClock/${id_jam}`;
  mqtt_topic_status = `KalaClock/${id_jam}/status`;

  loadSavedInputs(newID);

  if (mqttClient && mqttClient.isConnected()) {
    mqttClient.subscribe(mqtt_topic);
  }
}

// ==========================================================================
// 4. JAM ANALOG & DIGITAL (SELALU SINKRON)
// ==========================================================================
function updateClocks() {
  const now = new Date();
  
  const utcMillis = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetDate = new Date(utcMillis + (3600000 * timezoneOffset));

  const hours   = targetDate.getHours();
  const minutes = targetDate.getMinutes();
  const seconds = targetDate.getSeconds();

  const secondDeg = seconds * 6;
  const minuteDeg = (minutes * 6) + (seconds * 0.1);
  const hourDeg   = ((hours % 12) * 30) + (minutes * 0.5) + (seconds * (0.5 / 60));

  const needleHour   = document.getElementById("needleHour");
  const needleMinute = document.getElementById("needleMinute");
  const needleSecond = document.getElementById("needleSecond");

  if (needleHour)   needleHour.style.transform   = `translateX(-50%) rotate(${hourDeg}deg)`;
  if (needleMinute) needleMinute.style.transform = `translateX(-50%) rotate(${minuteDeg}deg)`;
  if (needleSecond) needleSecond.style.transform = `translateX(-50%) rotate(${secondDeg}deg)`;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const timeString = `${hh}:${mm}:${ss}`;

  const liveDigitalEl = document.getElementById("digitalClockLive");
  const virtualLedEl  = document.getElementById("virtualClock");
  const rtcBoxEl      = document.getElementById("rtcDigitalClock");

  if (liveDigitalEl) liveDigitalEl.textContent = timeString;
  if (virtualLedEl)  virtualLedEl.textContent  = timeString;
  if (rtcBoxEl)      rtcBoxEl.textContent      = timeString;

  const namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const namaBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dateString = `${namaHari[targetDate.getDay()]}, ${String(targetDate.getDate()).padStart(2, "0")} ${namaBulan[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  
  const virtualDateEl = document.getElementById("virtualDate");
  if (virtualDateEl) virtualDateEl.textContent = dateString;
}

function generateClockTicks() {
  const container = document.getElementById("analogClockFace");
  if (!container) return;

  const existingTicks = container.querySelectorAll(".clock-tick-mark");
  existingTicks.forEach(t => t.remove());

  for (let i = 0; i < 12; i++) {
    const tick = document.createElement("div");
    tick.className = "clock-tick-mark";
    const isMajor = (i % 3 === 0);
    if (isMajor) {
      tick.classList.add("clock-tick-major");
    }
    const angle = i * 30;
    tick.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    container.appendChild(tick);
  }
}

// ==========================================================================
// 5. ALUR LOGIN DENGAN VALIDASI DATABASE KONSUMEN & LOGGING
// ==========================================================================
function initAppFlow() {
  const loginScreen   = document.getElementById("loginScreen");
  const loginForm     = document.getElementById("loginForm");
  const inputUsername = document.getElementById("loginUsername");
  const inputIdJam    = document.getElementById("loginIdJam");
  const checkRemember = document.getElementById("loginRemember");
  const btnLogin      = document.getElementById("btnLogin");
  const errBox        = document.getElementById("loginConsumerError");

  const savedUsername = localStorage.getItem("kalaclock_username");
  const savedIdJam    = localStorage.getItem("kalaclock_id_jam");
  const isRemembered  = localStorage.getItem("kalaclock_remember") === "true";

  if (isRemembered && savedUsername && savedIdJam) {
    if (inputUsername) inputUsername.value = savedUsername;
    if (inputIdJam)    inputIdJam.value    = savedIdJam;
    if (checkRemember) checkRemember.checked = true;
  }

  if (loginScreen) {
    loginScreen.classList.remove("hidden");
  }

  // Tangani Submit Form Login dengan Verifikasi ke Database
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const userVal  = inputUsername.value.trim();
      const idJamVal = inputIdJam.value.trim().toUpperCase();

      if (!userVal) {
        alert("Silakan masukkan Username Anda.");
        inputUsername.focus();
        return;
      }
      if (!idJamVal) {
        alert("Silakan masukkan ID Jam Anda (contoh: KC00).");
        inputIdJam.focus();
        return;
      }

      if (errBox) errBox.style.display = "none";
      if (btnLogin) {
        btnLogin.disabled = true;
        btnLogin.textContent = "Memverifikasi Akun...";
      }

      // Verifikasi ke endpoint PHP api_login_user.php
      const formData = new FormData();
      formData.append("username", userVal);
      formData.append("id_jam", idJamVal);

      fetch("api/api_login_user.php", {
        method: "POST",
        body: formData
      })
      .then(res => res.json())
      .then(resData => {
        if (btnLogin) {
          btnLogin.disabled = false;
          btnLogin.textContent = "Log In";
        }

        if (resData && resData.success) {
          // Akun terdaftar & aktif di database admin!
          setClockID(idJamVal);

          if (checkRemember && checkRemember.checked) {
            localStorage.setItem("kalaclock_username", userVal);
            localStorage.setItem("kalaclock_id_jam", idJamVal);
            localStorage.setItem("kalaclock_remember", "true");
          } else {
            localStorage.removeItem("kalaclock_username");
            localStorage.removeItem("kalaclock_id_jam");
            localStorage.removeItem("kalaclock_remember");
          }

          const displayIdJamEl = document.getElementById("displayIdJam");
          const userGreetingEl = document.getElementById("userGreeting");
          if (displayIdJamEl) displayIdJamEl.textContent = id_jam;
          if (userGreetingEl) userGreetingEl.textContent = userVal;

          setupMQTT();
          showLoginCountdownModal();
        } else {
          // Akun tidak terdaftar atau dinonaktifkan oleh admin
          const msg = resData.message || "Username atau ID Jam tidak ditemukan.";
          if (errBox) {
            errBox.textContent = msg;
            errBox.style.display = "block";
          } else {
            alert(msg);
          }
        }
      })
      .catch(err => {
        if (btnLogin) {
          btnLogin.disabled = false;
          btnLogin.textContent = "Log In";
        }
        console.warn("API Database tidak merespons (mode offline/local file):", err);
        // Fallback jika database belum disetel / offline preview
        if (confirm("Koneksi API database lokal belum aktif. Tetap masuk dengan mode demo offline?")) {
          setClockID(idJamVal);
          const displayIdJamEl = document.getElementById("displayIdJam");
          const userGreetingEl = document.getElementById("userGreeting");
          if (displayIdJamEl) displayIdJamEl.textContent = id_jam;
          if (userGreetingEl) userGreetingEl.textContent = userVal;
          setupMQTT();
          showLoginCountdownModal();
        }
      });
    });
  }
}

function showLoginCountdownModal() {
  const modalOverlay  = document.getElementById("loginSuccessModal");
  const countdownEl   = document.getElementById("loginCountdown");
  const loginScreen   = document.getElementById("loginScreen");
  const mainDashboard = document.getElementById("mainDashboard");

  if (!modalOverlay || !countdownEl) return;

  modalOverlay.classList.add("active");
  let timeLeft = 3;
  countdownEl.textContent = timeLeft;

  const timerInterval = setInterval(() => {
    timeLeft--;
    if (countdownEl) countdownEl.textContent = timeLeft;

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      modalOverlay.classList.remove("active");
      
      if (loginScreen)   loginScreen.classList.add("hidden");
      if (mainDashboard) mainDashboard.classList.remove("hidden");

      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, 1000);
}

function logout() {
  const loginScreen   = document.getElementById("loginScreen");
  const mainDashboard = document.getElementById("mainDashboard");
  if (mainDashboard) mainDashboard.classList.add("hidden");
  if (loginScreen)   loginScreen.classList.remove("hidden");
}

// ==========================================================================
// 6. KONEKSI MQTT REAL-TIME DENGAN PAHO MQTT
// ==========================================================================
function setupMQTT() {
  if (typeof Paho === "undefined" || !Paho.MQTT) {
    console.warn("Paho MQTT library belum termuat dari CDN.");
    return;
  }

  const clientId = `web_${id_jam}_${Math.random().toString(16).substring(2, 8)}`;

  try {
    if (mqttClient && mqttClient.isConnected()) {
      mqttClient.disconnect();
    }

    mqttClient = new Paho.MQTT.Client(mqtt_broker, mqtt_port, clientId);

    mqttClient.onConnectionLost = function (responseObject) {
      console.log("MQTT Terputus:", responseObject.errorMessage);
      updateStatusDot("dotBroker", false);
      updateStatusDot("dotJam", false);
      setTimeout(connectMQTTClient, 4000);
    };

    mqttClient.onMessageArrived = function (message) {
      console.log("Pesan MQTT Diterima:", message.destinationName, message.payloadString);
      
      if (message.destinationName === mqtt_topic_status) {
        try {
          const data = JSON.parse(message.payloadString);
          if (data.status === "online" || (data.id_jam && data.id_jam === `KalaClock/${id_jam}/status`)) {
            updateStatusDot("dotJam", true);
          } else if (data.status === "offline") {
            updateStatusDot("dotJam", false);
          }
        } catch (e) {
          const payload = message.payloadString.trim().toLowerCase();
          if (payload === "online") {
            updateStatusDot("dotJam", true);
          } else if (payload === "offline") {
            updateStatusDot("dotJam", false);
          }
        }
      }
    };

    connectMQTTClient();
  } catch (err) {
    console.error("Gagal inisialisasi Paho MQTT:", err);
  }
}

function connectMQTTClient() {
  if (!mqttClient) return;

  mqttClient.connect({
    useSSL: true,
    timeout: 10,
    keepAliveInterval: 30,
    onSuccess: function () {
      console.log("Berhasil terhubung ke Broker MQTT EMQX:", mqtt_broker);
      updateStatusDot("dotBroker", true);

      mqttClient.subscribe(mqtt_topic_status, {
        onSuccess: function () {
          console.log("Berhasil subscribe ke mqtt_topic_status:", mqtt_topic_status);
        }
      });

      pingJam();
    },
    onFailure: function (err) {
      console.error("Gagal terhubung ke Broker MQTT:", err.errorMessage);
      updateStatusDot("dotBroker", false);
      updateStatusDot("dotJam", false);
      setTimeout(connectMQTTClient, 5000);
    }
  });
}

function pingJam() {
  if (mqttClient && mqttClient.isConnected()) {
    const pingPayload = {
      action: "ping",
      id_jam: id_jam,
      timestamp: Date.now()
    };
    const msg = new Paho.MQTT.Message(JSON.stringify(pingPayload));
    msg.destinationName = mqtt_topic_status;
    mqttClient.send(msg);
  }
}

function updateStatusDot(elementId, isOnline) {
  const dot = document.getElementById(elementId);
  if (!dot) return;
  if (isOnline) {
    dot.classList.add("online");
  } else {
    dot.classList.remove("online");
  }
}

// ==========================================================================
// 7. STATUS DATABASE MYSQL
// ==========================================================================
function cekStatusDatabase() {
  fetch("api/api_status_db.php")
    .then(res => res.json())
    .then(data => {
      if (data && data.status === "online") {
        updateStatusDot("dotDatabase", true);
      } else {
        updateStatusDot("dotDatabase", false);
      }
    })
    .catch(() => {
      updateStatusDot("dotDatabase", false);
    });
}

// ==========================================================================
// 8. PREVIEW RUNNING TEXT, KECERAHAN, & KECEPATAN
// ==========================================================================
function updateTickerText(text) {
  const tickerEl = document.getElementById("virtualTicker");
  if (!tickerEl) return;
  tickerEl.textContent = (text && text.trim().length > 0)
    ? text
    : "Kala.Clock IoT Smart Display";
}

function setSpeed(val) {
  const num = parseInt(val) || 40;
  currentSpeed = num;
  
  const badge = document.getElementById("badgeSpeed");
  if (badge) badge.textContent = `${num} ms`;

  const tickerEl = document.getElementById("virtualTicker");
  if (tickerEl) {
    const duration = Math.max(3, Math.round(24 - (num / 100) * 18));
    tickerEl.style.animationDuration = `${duration}s`;
  }
}

function setBrightness(val, isFromPreset = false) {
  const num = parseInt(val) || 0;
  currentBrightness = num;

  const slider = document.getElementById("inputBrightness");
  const badge  = document.getElementById("badgeBrightness");
  const dimmer = document.getElementById("ledDimmer");

  if (slider && isFromPreset) slider.value = num;
  if (badge)  badge.textContent = num;

  if (dimmer) {
    const darkness = 0.85 - ((num / 255) * 0.75);
    dimmer.style.backgroundColor = `rgba(0, 0, 0, ${darkness})`;
  }

  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.classList.remove("active");
  });
  if (num === 15) {
    const btn = document.getElementById("btnPresetRedup");
    if (btn) btn.classList.add("active");
  } else if (num === 80) {
    const btn = document.getElementById("btnPresetSedang");
    if (btn) btn.classList.add("active");
  } else if (num === 200) {
    const btn = document.getElementById("btnPresetTerang");
    if (btn) btn.classList.add("active");
  }
}

function setBrightnessPreset(val) {
  setBrightness(val, true);
}

function setDisplayMode(mode) {
  currentMode = parseInt(mode);
  const tickerEl   = document.getElementById("virtualTicker");
  const clockBox   = document.querySelector(".led-clock-box");
  const tickerWrap = document.querySelector(".led-ticker-wrap");
  const divider    = document.querySelector(".led-divider");

  document.querySelectorAll(".btn-mode").forEach(btn => {
    if (parseInt(btn.getAttribute("data-mode")) === currentMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  if (mode4Timer) {
    clearInterval(mode4Timer);
    mode4Timer = null;
  }

  if (!tickerEl) return;

  switch (currentMode) {
    case 1:
      if (clockBox)   clockBox.style.display   = "none";
      if (divider)    divider.style.display    = "none";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "tickerScrollLeft";
      tickerEl.style.textAlign = "left";
      tickerEl.style.paddingLeft = "100%";
      break;

    case 2:
      if (clockBox)   clockBox.style.display   = "none";
      if (divider)    divider.style.display    = "none";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "none";
      tickerEl.style.textAlign = "center";
      tickerEl.style.paddingLeft = "0";
      break;

    case 3:
      if (clockBox)   clockBox.style.display   = "none";
      if (divider)    divider.style.display    = "none";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "tickerScrollRight";
      tickerEl.style.textAlign = "right";
      tickerEl.style.paddingLeft = "0";
      break;

    case 4:
    default:
      if (clockBox)   clockBox.style.display   = "flex";
      if (divider)    divider.style.display    = "block";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "tickerScrollLeft";
      tickerEl.style.textAlign = "left";
      tickerEl.style.paddingLeft = "100%";

      mode4ShowClock = true;
      mode4Timer = setInterval(() => {
        mode4ShowClock = !mode4ShowClock;
        if (mode4ShowClock) {
          if (clockBox) clockBox.style.opacity = "1";
          if (divider)  divider.style.opacity  = "1";
        } else {
          if (clockBox) clockBox.style.opacity = "0.3";
          if (divider)  divider.style.opacity  = "0.4";
        }
      }, 5000);
      break;
  }
}

// ==========================================================================
// 9. ZONA WAKTU & KALIBRASI RTC / NTP
// ==========================================================================
function setTimezonePreset(tz) {
  timezoneOffset = parseInt(tz);

  const badgeUtc = document.getElementById("badgeUtc");
  if (badgeUtc) {
    badgeUtc.textContent = timezoneOffset >= 0 ? `+${timezoneOffset}` : `${timezoneOffset}`;
  }

  document.querySelectorAll(".btn-utc").forEach(btn => {
    if (parseInt(btn.getAttribute("data-tz")) === timezoneOffset) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  updateClocks();
  kirimSecaraRealTime(); 
}

function kalibrasiRTC() {
  const now = new Date();
  const utcMillis = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetDate = new Date(utcMillis + (3600000 * timezoneOffset));

  const hh = String(targetDate.getHours()).padStart(2, "0");
  const mm = String(targetDate.getMinutes()).padStart(2, "0");
  const ss = String(targetDate.getSeconds()).padStart(2, "0");
  const timeStr = `${hh}:${mm}:${ss}`;
  const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;

  const payloadRTC = {
    action: "set_time",
    id_jam: id_jam,
    time: timeStr,
    date: dateStr,
    timezone: timezoneOffset,
    timestamp: Date.now()
  };

  if (mqttClient && mqttClient.isConnected()) {
    const msg = new Paho.MQTT.Message(JSON.stringify(payloadRTC));
    msg.destinationName = mqtt_topic;
    mqttClient.send(msg);
  }

  showToastNotification("Kalibrasi RTC Berhasil", `Waktu jam disinkronkan ke ${timeStr} (UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset})`);
}

function kalibrasiNTP() {
  const payloadNTP = {
    action: "ntp_sync",
    id_jam: id_jam,
    timezone: timezoneOffset,
    timestamp: Date.now()
  };

  if (mqttClient && mqttClient.isConnected()) {
    const msg = new Paho.MQTT.Message(JSON.stringify(payloadNTP));
    msg.destinationName = mqtt_topic;
    mqttClient.send(msg);
  }

  showToastNotification("Kalibrasi NTP Dimulai", "Perintah sinkronisasi NTP telah dikirim ke perangkat IoT.");
}

// ==========================================================================
// 10. PENGIRIMAN DATA SECARA REAL TIME
// ==========================================================================
function kirimSecaraRealTime() {
  const inputTeksEl = document.getElementById("inputTeks");
  const teksValue   = inputTeksEl ? inputTeksEl.value : "";

  const payloadObj = {
    action: "update_display",
    id_jam: id_jam,
    teks: teksValue,
    brightness: currentBrightness,
    speed: currentSpeed,
    mode: currentMode,
    timezone: timezoneOffset,
    timestamp: Date.now()
  };

  if (mqttClient && mqttClient.isConnected()) {
    const msg = new Paho.MQTT.Message(JSON.stringify(payloadObj));
    msg.destinationName = mqtt_topic;
    msg.retained = false;
    mqttClient.send(msg);
  }

  const formData = new FormData();
  formData.append("id_jam", id_jam);
  formData.append("teks", payloadObj.teks);
  formData.append("brightness", payloadObj.brightness);
  formData.append("speed", payloadObj.speed);
  formData.append("mode", payloadObj.mode);

  fetch("api/api_simpan.php", {
    method: "POST",
    body: formData
  }).catch(() => {});

  showToastNotification(
    "Notifikasi Perubahan Jam Berhasil",
    "Perubahan jam anda telah berhasil! jam akan menunjukkan pengaturan baru"
  );
}

function showToastNotification(title, message) {
  const toastWrap = document.getElementById("toastChangeNotif");
  const toastTitle = document.getElementById("toastTitle");
  const toastBody = document.getElementById("toastBody");

  if (!toastWrap) return;

  if (toastTitle && title)   toastTitle.textContent = title;
  if (toastBody && message) toastBody.textContent = message;

  toastWrap.classList.add("active");

  setTimeout(() => {
    toastWrap.classList.remove("active");
  }, 3800);
}

// ==========================================
// 11. MANAJEMEN JADWAL & EFISIENSI
// ==========================================
let jadwalCount = 1;

function tambahJadwal() {
  jadwalCount++;
  const container = document.getElementById('wadahJadwal');
  if (!container) return;

  const newItem = document.createElement('div');
  newItem.className = 'jadwal-item';
  newItem.style.cssText = "background-color: var(--bg-subcard); padding: 12px; border-radius: var(--radius-btn); border: 1px solid var(--border-subtle); margin-bottom: 8px;";

  newItem.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <input type="text" value="Jadwal ${jadwalCount}" class="input-nama-jadwal" style="background: transparent; border: none; color: var(--accent-tan); font-size: 11px; font-weight: 700; outline: none; width: 85px; font-family: 'Plus Jakarta Sans';">
      <div style="display: flex; gap: 4px; align-items: center;">
        <input type="time" class="control-input input-mulai" value="12:00" style="height: 24px; padding: 0 4px; font-size: 10px; width: 65px; text-align: center;">
        <span style="color: var(--text-muted); font-size: 10px;">-</span>
        <input type="time" class="control-input input-selesai" value="13:00" style="height: 24px; padding: 0 4px; font-size: 10px; width: 65px; text-align: center;">
        <button onclick="this.parentElement.parentElement.parentElement.remove(); saveCurrentInputs();" style="background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; margin-left: 4px; display: flex; align-items: center; justify-content: center; transition: 0.2s;" title="Hapus;">✕</button>
      </div>
    </div>
    <input type="text" class="control-input input-pesan" placeholder="Ketik pesan jadwal baru..." value="" style="width: 100%;">
  `;

  container.appendChild(newItem);

  newItem.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', saveCurrentInputs);
    input.addEventListener('change', saveCurrentInputs);
  });

  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

function prosesSimpanJadwal() {
  const tidur = document.getElementById('valWaktuTidur')?.value || '22:00';
  const bangun = document.getElementById('valWaktuBangun')?.value || '04:00';
  const kecerahan = document.getElementById('valKecerahanMalam')?.value || 10;
  const autoSleep = document.getElementById('valAutoSleep')?.checked || false;

  let jadwalList = [];
  const jadwalItems = document.querySelectorAll('.jadwal-item');
  jadwalItems.forEach(item => {
    const pesan = item.querySelector('.input-pesan')?.value || '';
    if (pesan.trim() !== '') {
      jadwalList.push({
        nama: item.querySelector('.input-nama-jadwal')?.value || '',
        mulai: item.querySelector('.input-mulai')?.value || '',
        selesai: item.querySelector('.input-selesai')?.value || '',
        pesan: pesan
      });
    }
  });

  const dataKirim = {
    action: "update_jadwal",
    id_jam: id_jam,
    efisiensi: { tidur, bangun, kecerahan_malam: kecerahan, auto_sleep: autoSleep },
    jadwal: jadwalList
  };

  const payloadString = JSON.stringify(dataKirim);

  if (mqttClient && mqttClient.isConnected()) {
    let message = new Paho.MQTT.Message(payloadString);
    message.destinationName = mqtt_topic;
    message.retained = false; 
    mqttClient.send(message);
  }

  showToastNotification(
    "Jadwal & Efisiensi Tersimpan!",
    "Pengaturan jadwal baru telah berhasil dikirim ke perangkat jam IoT."
  );
  saveCurrentInputs();
}

// ==========================================================================
// 12. INISIALISASI HALAMAN
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  generateClockTicks();
  updateClocks();
  setInterval(updateClocks, 1000);
  initAppFlow();

  const inputTeksEl = document.getElementById("inputTeks");
  if (inputTeksEl) {
    inputTeksEl.addEventListener("input", function () {
      updateTickerText(this.value);
    });
  }

  const inputSpeedEl = document.getElementById("inputSpeed");
  if (inputSpeedEl) {
    inputSpeedEl.addEventListener("input", function () {
      setSpeed(this.value);
    });
  }

  const inputBrightnessEl = document.getElementById("inputBrightness");
  if (inputBrightnessEl) {
    inputBrightnessEl.addEventListener("input", function () {
      setBrightness(this.value);
    });
  }

  document.querySelectorAll(".btn-mode").forEach(btn => {
    btn.addEventListener("click", function () {
      const mode = this.getAttribute("data-mode");
      setDisplayMode(mode);
    });
  });

  setBrightness(80);
  setSpeed(40);
  setDisplayMode(4);
  setTimezonePreset(8);
  
  document.querySelectorAll(".btn-utc").forEach(btn => {
    btn.addEventListener("click", function () {
      const tz = this.getAttribute("data-tz");
      setTimezonePreset(tz);
    });
  });

  cekStatusDatabase();
  setInterval(cekStatusDatabase, 12000);

  const inputsToTrack = ['inputTeks', 'inputBrightness', 'inputSpeed'];
  inputsToTrack.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', saveCurrentInputs);
      el.addEventListener('change', saveCurrentInputs);
    }
  });
});
