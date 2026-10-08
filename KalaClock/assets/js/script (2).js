// ==========================================================================
// KALA.CLOCK — JAVASCRIPT CONTROLLER LENGKAP
// Mengatur Seluruh Alur: Loading Screen -> Login Page -> Countdown Modal -> Main Dashboard
// Fitur:
// 1. Koneksi MQTT Real-Time (Paho MQTT WebSockets SSL)
// 2. id_jam dinamis menjadi mqtt_topic_status dengan variabel 'let'
// 3. Jam Analog (3 Jarum: 1 Merah Terpendek, 1 Putih Terpanjang, 1 Putih Tengah)
// 4. Jam Digital (Plus Jakarta Sans Light Weight) yang selalu sinkron 100%
// 5. Layar Simulasi LED Running Text Virtual dengan 4 Mode (Kiri, Statis, Kanan, Jam+Teks)
// 6. Kontrol Kecerahan, Kecepatan, Mode Tampilan, Zona Waktu, & Kalibrasi
// 7. Notifikasi Toast Sukses Pengiriman Real-Time
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

// Variabel untuk mode 4 (alternasi tampilan jam & teks virtual)
let mode4ShowClock    = true;
let mode4Timer        = null;


// ==========================================
// 2. AUTO-SAVE & LOAD FUNCTIONS (DISESUAIKAN DENGAN NAMA ID FORM REALS)
// ==========================================

// Simpan input form ke localStorage khusus ID jam ini
function saveCurrentInputs() {
  if (!id_jam) return;
  
  // Ambil daftar jadwal aktif
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
// Mengirim data input ke API PHP secara otomatis saat user mengetik/mengubah form
function saveInputsToDatabase() {
  // 1. Ambil ID Jam dari berbagai sumber cadangan
  let activeIdJam = id_jam;
  if (!activeIdJam || activeIdJam.trim() === '') {
    activeIdJam = localStorage.getItem('kalaclock_id_jam');
  }
  if (!activeIdJam || activeIdJam.trim() === '') {
    const elDisplay = document.getElementById('displayIdJam');
    if (elDisplay) activeIdJam = elDisplay.innerText.trim();
  }

  // 2. JIKA TETAP KOSONG / TULISAN DEFAULT, BATALKAN AUTOSAVE (Mencegah Error PHP)
  if (!activeIdJam || activeIdJam === '' || activeIdJam === '{KC00}') {
    console.log("Autosave ditunda: ID Jam belum siap.");
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

// Muat kembali input tersimpan saat ID jam dipilih/login
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

    // Load Efisiensi & Jadwal
    if (data.tidur && document.getElementById('valWaktuTidur')) document.getElementById('valWaktuTidur').value = data.tidur;
    if (data.bangun && document.getElementById('valWaktuBangun')) document.getElementById('valWaktuBangun').value = data.bangun;
    if (data.kecerahan_malam && document.getElementById('valKecerahanMalam')) document.getElementById('valKecerahanMalam').value = data.kecerahan_malam;
    if (data.auto_sleep !== undefined && document.getElementById('valAutoSleep')) document.getElementById('valAutoSleep').checked = data.auto_sleep;

    if (data.jadwal && Array.isArray(data.jadwal) && data.jadwal.length > 0) {
      const container = document.getElementById('wadahJadwal');
      if (container) {
        container.innerHTML = ''; // Clear default
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

  // Unsubscribe topik lama jika ID berubah
  if (mqttClient && mqttClient.isConnected() && id_jam && id_jam !== newID) {
    mqttClient.unsubscribe(mqtt_topic);
  }

  id_jam = newID;
  mqtt_topic = `KalaClock/${id_jam}`;
  mqtt_topic_status = `KalaClock/${id_jam}/status`;

  // --- MEMANGGIL LOAD SAVED INPUTS SAAT LOGIN / GANTI ID ---
  loadSavedInputs(newID);

  if (mqttClient && mqttClient.isConnected()) {
    mqttClient.subscribe(mqtt_topic);
  }
}

// ==========================================================================
// BAGIAN 2: INISIALISASI JAM ANALOG & DIGITAL (SELALU SINKRON)
// Menghitung sudut rotasi untuk 3 jarum:
// - Jarum Jam: 1 Jarum Merah, TERPENDEK
// - Jarum Menit: Putih/Krem, PALING PANJANG
// - Jarum Detik: Putih, PANJANG DI TENGAH-TENGAH
// Jam digital menggunakan font 'Plus Jakarta Sans' Light Weight (300).
// ==========================================================================
function updateClocks() {
  const now = new Date();
  
  // Konversi waktu lokal ke UTC kemudian sesuaikan dengan timezoneOffset yang dipilih
  const utcMillis = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetDate = new Date(utcMillis + (3600000 * timezoneOffset));

  const hours   = targetDate.getHours();
  const minutes = targetDate.getMinutes();
  const seconds = targetDate.getSeconds();

  // 1. Hitung rotasi jarum jam analog (360 derajat)
  // Detik: 6 derajat per detik
  const secondDeg = seconds * 6;
  // Menit: 6 derajat per menit + tambahan pergeseran detik
  const minuteDeg = (minutes * 6) + (seconds * 0.1);
  // Jam: 30 derajat per jam + tambahan pergeseran menit dan detik
  const hourDeg   = ((hours % 12) * 30) + (minutes * 0.5) + (seconds * (0.5 / 60));

  // Terapkan rotasi ke elemen DOM jarum analog
  const needleHour   = document.getElementById("needleHour");
  const needleMinute = document.getElementById("needleMinute");
  const needleSecond = document.getElementById("needleSecond");

  if (needleHour)   needleHour.style.transform   = `translateX(-50%) rotate(${hourDeg}deg)`;
  if (needleMinute) needleMinute.style.transform = `translateX(-50%) rotate(${minuteDeg}deg)`;
  if (needleSecond) needleSecond.style.transform = `translateX(-50%) rotate(${secondDeg}deg)`;

  // 2. Format string jam digital HH:MM:SS
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const timeString = `${hh}:${mm}:${ss}`;

  // Terapkan teks jam ke seluruh display jam digital agar SINKRON
  const liveDigitalEl = document.getElementById("digitalClockLive"); // Di bawah jam analog (Plus Jakarta Sans Light)
  const virtualLedEl  = document.getElementById("virtualClock");    // Di dalam simulasi LED P10
  const rtcBoxEl      = document.getElementById("rtcDigitalClock"); // Di kotak Kalibrasi RTC

  if (liveDigitalEl) liveDigitalEl.textContent = timeString;
  if (virtualLedEl)  virtualLedEl.textContent  = timeString;
  if (rtcBoxEl)      rtcBoxEl.textContent      = timeString;

  // Format tanggal pada layar virtual LED
  const namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const namaBulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dateString = `${namaHari[targetDate.getDay()]}, ${String(targetDate.getDate()).padStart(2, "0")} ${namaBulan[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  
  const virtualDateEl = document.getElementById("virtualDate");
  if (virtualDateEl) virtualDateEl.textContent = dateString;
}

// Inisialisasi 12 penanda jam analog berbentuk kapsul (Capsule Pill Ticks)
function generateClockTicks() {
  const container = document.getElementById("analogClockFace");
  if (!container) return;

  // Bersihkan elemen lama jika ada
  const existingTicks = container.querySelectorAll(".clock-tick-mark");
  existingTicks.forEach(t => t.remove());

  for (let i = 0; i < 12; i++) {
    const tick = document.createElement("div");
    tick.className = "clock-tick-mark";
    const isMajor = (i % 3 === 0);
    if (isMajor) {
      tick.classList.add("clock-tick-major");
    }
    // Rotasi setiap penanda sejauh 30 derajat mengelilingi pusat jam
    const angle = i * 30;
    tick.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    container.appendChild(tick);
  }
}
// ==========================================================================
// BAGIAN 3: ALUR LOADING SCREEN, LOGIN, DAN COUNTDOWN MODAL
// ==========================================================================
function initAppFlow() {
  const loginScreen   = document.getElementById("loginScreen");
  const loginForm     = document.getElementById("loginForm");
  const inputUsername = document.getElementById("loginUsername");
  const inputIdJam    = document.getElementById("loginIdJam");
  const checkRemember = document.getElementById("loginRemember");

  // Periksa apakah ada akun yang disimpan sebelumnya (Remember Me)
  const savedUsername = localStorage.getItem("kalaclock_username");
  const savedIdJam    = localStorage.getItem("kalaclock_id_jam");
  const isRemembered  = localStorage.getItem("kalaclock_remember") === "true";

  if (isRemembered && savedUsername && savedIdJam) {
    if (inputUsername) inputUsername.value = savedUsername;
    if (inputIdJam)    inputIdJam.value    = savedIdJam;
    if (checkRemember) checkRemember.checked = true;
  }

  // Transisi dari Loading Screen ke Login Screen
  if (loginScreen) {
    loginScreen.classList.remove("hidden");
  }

  // Tangani Submit Form Login
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

      // SIMPAN DATA LOGIN & UPDATE TOPIK MQTT (PANGGIL FUNGSI REUSABLE)
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

      // Update Tampilan Info di Dashboard
      const displayIdJamEl = document.getElementById("displayIdJam");
      const userGreetingEl = document.getElementById("userGreeting");
      if (displayIdJamEl) displayIdJamEl.textContent = id_jam;
      if (userGreetingEl) userGreetingEl.textContent = userVal;

      // Hubungkan MQTT dengan ID Jam baru
      setupMQTT();

      // Tampilkan Modal Notifikasi Login & Jalankan Countdown
      showLoginCountdownModal();
    });
  }
}

// Menampilkan Modal Sukses Login & Hitung Mundur 5 Detik
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
      
      // Sembunyikan halaman login dan tampilkan Main Dashboard
      if (loginScreen)   loginScreen.classList.add("hidden");
      if (mainDashboard) mainDashboard.classList.remove("hidden");

      // Scroll ke paling atas halaman dashboard
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, 1000);
}

// Fungsi untuk Ganti ID Jam / Logout kembali ke layar login
function logout() {
  const loginScreen   = document.getElementById("loginScreen");
  const mainDashboard = document.getElementById("mainDashboard");
  if (mainDashboard) mainDashboard.classList.add("hidden");
  if (loginScreen)   loginScreen.classList.remove("hidden");
}

// ==========================================================================
// BAGIAN 4: KONEKSI MQTT REAL-TIME DENGAN PAHO MQTT
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
      
      // Jika pesan berasal dari topik status (id_jam itu sendiri atau KalaClock/status)
      if (
        message.destinationName === mqtt_topic_status
      ) {
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

      // Subscribe ke topik alat (dinamis sesuai id_jam)
      mqttClient.subscribe(mqtt_topic_status, {
        onSuccess: function () {
          console.log("Berhasil subscribe ke mqtt_topic_status:", mqtt_topic_status);
        }
      });

      // Kirim ping untuk mengecek respons unit jam
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
// BAGIAN 5: STATUS DATABASE MYSQL
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
// BAGIAN 6: KONTROL PREVIEW RUNNING TEXT, KECERAHAN, & KECEPATAN
// MENDUKUNG 4 MODE TAMPILAN:
// Mode 1: ← KIRI (Scroll Text Left)
// Mode 2: STATIS (Text Static Center)
// Mode 3: KANAN → (Scroll Text Right)
// Mode 4: JAM + TEKS (Jam Digital + Running Text Bergantian Sesuai Firmware P10)
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

// 4 Mode Tampilan Jam
function setDisplayMode(mode) {
  currentMode = parseInt(mode);
  const tickerEl   = document.getElementById("virtualTicker");
  const clockBox   = document.querySelector(".led-clock-box");
  const tickerWrap = document.querySelector(".led-ticker-wrap");
  const divider    = document.querySelector(".led-divider");

  // Update tombol aktif di UI
  document.querySelectorAll(".btn-mode").forEach(btn => {
    if (parseInt(btn.getAttribute("data-mode")) === currentMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Hentikan timer alternasi jika ada
  if (mode4Timer) {
    clearInterval(mode4Timer);
    mode4Timer = null;
  }

  if (!tickerEl) return;

  switch (currentMode) {
    case 1: // ← KIRI: Berjalan ke Kiri murni
      if (clockBox)   clockBox.style.display   = "none";
      if (divider)    divider.style.display    = "none";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "tickerScrollLeft";
      tickerEl.style.textAlign = "left";
      tickerEl.style.paddingLeft = "100%";
      break;

    case 2: // STATIS: Diam di Tengah
      if (clockBox)   clockBox.style.display   = "none";
      if (divider)    divider.style.display    = "none";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "none";
      tickerEl.style.textAlign = "center";
      tickerEl.style.paddingLeft = "0";
      break;

    case 3: // KANAN →: Berjalan ke Kanan
      if (clockBox)   clockBox.style.display   = "none";
      if (divider)    divider.style.display    = "none";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "tickerScrollRight";
      tickerEl.style.textAlign = "right";
      tickerEl.style.paddingLeft = "0";
      break;

    case 4: // JAM + TEKS: Menampilkan Jam Digital & Running Text Bergantian (Sesuai Firmware P10)
    default:
      if (clockBox)   clockBox.style.display   = "flex";
      if (divider)    divider.style.display    = "block";
      if (tickerWrap) tickerWrap.style.display = "block";
      tickerEl.style.animationName = "tickerScrollLeft";
      tickerEl.style.textAlign = "left";
      tickerEl.style.paddingLeft = "100%";

      // Siklus alternasi setiap 5 detik seperti pada firmware ESP8266 p10.ino
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
// BAGIAN 7: PENGATURAN ZONA WAKTU & KALIBRASI RTC / NTP
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

  // Tambahkan ini biar langsung ngirim ke ESP pas tombol UTC diklik
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
// BAGIAN 8: PENGIRIMAN DATA SECARA REAL TIME
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

  // 1. Kirim via MQTT
  let mqttSent = false;
  if (mqttClient && mqttClient.isConnected()) {
    const msg = new Paho.MQTT.Message(JSON.stringify(payloadObj));
    msg.destinationName = mqtt_topic;
    msg.retained = false;
    mqttClient.send(msg);
    mqttSent = true;
  }

  // 2. Simpan ke Backend Database (Fetch AJAX Aman)
  const formData = new FormData();
  formData.append("id_jam", id_jam);
  formData.append("teks", payloadObj.teks);
  formData.append("brightness", payloadObj.brightness);
  formData.append("speed", payloadObj.speed);
  formData.append("mode", payloadObj.mode);

  fetch("api/api_simpan.php", {
    method: "POST",
    body: formData
  }).catch(() => {
    // Abaikan jika server backend offline di lokal
  });

  // 3. Tampilkan Notifikasi Toast Hijau
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
// FUNGSI MANAJEMEN JADWAL & EFISIENSI
// ==========================================
let jadwalCount = 1;

// 1. Fungsi Tambah Baris Jadwal Baru di UI
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
        <button onclick="this.parentElement.parentElement.parentElement.remove()" style="background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; margin-left: 4px; display: flex; align-items: center; justify-content: center; transition: 0.2s;" title="Hapus;">✕</button>
      </div>
    </div>
    <input type="text" class="control-input input-pesan" placeholder="Ketik pesan jadwal baru..." value="" style="width: 100%;">
  `;

  container.appendChild(newItem);
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

// Helper untuk konversi waktu "01:00 PM" atau "01:00" ke format 24 Jam ("13:00")
function konversiKe24Jam(waktuStr) {
  if (!waktuStr) return "00:00";
  
  // Jika input time browser memberikan format AM/PM
  let match = waktuStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (match) {
    let jam = parseInt(match[1]);
    let menit = match[2];
    let ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && jam < 12) jam += 12;
    if (ampm === "AM" && jam === 12) jam = 0;

    return `${String(jam).padStart(2, '0')}:${menit}`;
  }
  return waktuStr;
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

  if (typeof showToastNotification === 'function') {
    showToastNotification(
      "Jadwal & Efisiensi Tersimpan!",
      "Pengaturan jadwal baru telah berhasil dikirim ke perangkat jam IoT."
    );
  } else {
    alert("Jadwal & Efisiensi Berhasil Dikirim!");
  }
  saveCurrentInputs();
}

// ==========================================================================
// BAGIAN 9: EVENT LISTENER & INISIALISASI HALAMAN
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  // 1. Buat penanda jam analog (12 penanda kapsul)
  generateClockTicks();

  // 2. Jalankan pembaruan jam secara berkala setiap detik (Selalu Sinkron)
  updateClocks();
  setInterval(updateClocks, 1000);

  // 3. Inisialisasi Alur Loading Screen -> Login
  initAppFlow();

  // 4. Event Listener untuk Input Running Text (Live Ticker Update)
  const inputTeksEl = document.getElementById("inputTeks");
  if (inputTeksEl) {
    inputTeksEl.addEventListener("input", function () {
      updateTickerText(this.value);
    });
  }

  // 5. Event Listener untuk Slider Kecepatan
  const inputSpeedEl = document.getElementById("inputSpeed");
  if (inputSpeedEl) {
    inputSpeedEl.addEventListener("input", function () {
      setSpeed(this.value);
    });
  }

  // 6. Event Listener untuk Slider Kecerahan
  const inputBrightnessEl = document.getElementById("inputBrightness");
  if (inputBrightnessEl) {
    inputBrightnessEl.addEventListener("input", function () {
      setBrightness(this.value);
    });
  }

  // 7. Event Listener untuk Tombol-Tombol Mode Tampilan Jam
  document.querySelectorAll(".btn-mode").forEach(btn => {
    btn.addEventListener("click", function () {
      const mode = this.getAttribute("data-mode");
      setDisplayMode(mode);
    });
  });

  // 8. Terapkan state awal (Default Mode 4: Jam Digital + Teks Bergantian)
  setBrightness(80);
  setSpeed(40);
  setDisplayMode(4); // Default Mode 4
  setTimezonePreset(8); // UTC+8 WITA
  
  document.querySelectorAll(".btn-utc").forEach(btn => {
  btn.addEventListener("click", function () {
    const tz = this.getAttribute("data-tz");
    setTimezonePreset(tz);
    });
  });

  // 9. Cek status database berkala
  cekStatusDatabase();
  setInterval(cekStatusDatabase, 12000);

  // 10. Event listener untuk simpan otomatis tiap kali ada perubahan input
  const inputsToTrack = ['inputTeks', 'inputBrightness', 'inputSpeed'];

  inputsToTrack.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', saveCurrentInputs);
      el.addEventListener('change', saveCurrentInputs);
    }
  });
});
