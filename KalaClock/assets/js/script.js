// ====================================================================
// KALA.CLOCK — FULLY RESPONSIVE IOT CONTROLLER JAVASCRIPT
// Menggabungkan fungsi-fungsi dari index2.html:
// - Koneksi MQTT Real-Time (Paho MQTT via WebSockets SSL)
// - Cek Status & Baca/Simpan Database MySQL
// - Simulasi Layar Virtual LED P10 Real-Time
// - Sinkronisasi Jam Digital RTC/NTP
// - Penanganan Navigasi Responsif Mobile, Tablet, & Desktop
// ====================================================================

// --- 1. KONFIGURASI MQTT ---
const mqtt_broker = "broker.emqx.io"; // Broker EMQX publik gratis & cepat
const mqtt_port = 8084; // Port WebSockets dengan SSL (Secure)
const mqtt_topic = "KalaClock"; // Topik komunikasi data & perintah ke ESP8266
const mqtt_topic_status = "KalaClock/status"; // Topik status online/offline ESP8266
const id_jam = "KC00";

// Inisialisasi MQTT Client Paho
let mqttClient = null;
try {
  mqttClient = new Paho.MQTT.Client(mqtt_broker, mqtt_port, id_jam);
} catch (e) {
  console.warn("Paho MQTT library belum termuat:", e);
}

// Fungsi Ping untuk memeriksa apakah alat P10 aktif merespons
function pingDevice() {
  if (mqttClient && mqttClient.isConnected()) {
    const pingObj = { action: "ping", timestamp: Date.now() };
    const pingMsg = new Paho.MQTT.Message(JSON.stringify(pingObj));
    pingMsg.destinationName = mqtt_topic;
    mqttClient.send(pingMsg);
    console.log("Ping dikirim ke alat P10 via:", mqtt_topic);
  }
}

// Handler Jika Koneksi MQTT Terputus
if (mqttClient) {
  mqttClient.onConnectionLost = function (responseObject) {
    console.log("MQTT Connection Lost:", responseObject.errorMessage);
    updateStatusBadge("statusMQTT", "offline", "BROKER: OFFLINE");
    updateStatusBadge("statusAlat", "offline", "ALAT P10: OFFLINE");
    updateSidebarStatus(false);

    // Coba hubungkan kembali otomatis setelah 3 detik
    setTimeout(connectMQTT, 3000);
  };

  // Handler Jika Menerima Pesan Masuk dari Broker
  mqttClient.onMessageArrived = function (message) {
    console.log(
      "Pesan MQTT diterima:",
      message.destinationName,
      message.payloadString,
    );

    // Dengarkan status dari topik utama maupun topik alternatif
    if (
      message.destinationName === mqtt_topic_status ||
      message.destinationName === "mqtt_topic_status"
    ) {
      const payload = message.payloadString.trim().toLowerCase();
      if (payload === "online") {
        updateStatusBadge("statusAlat", "online", "ALAT P10: ONLINE");
        updateSidebarStatus(true);
      } else if (payload === "offline") {
        updateStatusBadge("statusAlat", "offline", "ALAT P10: OFFLINE");
        updateSidebarStatus(false);
      }
    }
  };
}

// Fungsi Menghubungkan ke Broker MQTT
function connectMQTT() {
  if (!mqttClient) return;

  // Update status menjadi menghubungkan
  const mqttEl = document.getElementById("statusMQTT");
  if (mqttEl) {
    mqttEl.innerHTML = "BROKER: MENGHUBUNGKAN...";
    mqttEl.className = "status-box offline";
  }

  const pesanEl = document.getElementById("pesan");
  if (pesanEl) {
    pesanEl.innerHTML =
      "Memeriksa koneksi Broker MQTT & memanggil Alat P10...";
    setTimeout(() => {
      if (pesanEl) pesanEl.innerHTML = "";
    }, 3000);
  }

  mqttClient.connect({
    useSSL: true,
    timeout: 10,
    keepAliveInterval: 30,
    onSuccess: function () {
      console.log("Berhasil terhubung ke Broker MQTT:", mqtt_broker);
      updateStatusBadge("statusMQTT", "online", "BROKER: ONLINE");

      // Subscribe ke topik status alat (utama dan alternatif)
      mqttClient.subscribe(mqtt_topic_status, {
        onSuccess: function () {
          console.log("Berhasil subscribe ke topik status:", mqtt_topic_status);
        },
      });
      mqttClient.subscribe("KalaClock/status");

      // Kirim ping ke alat setelah tersambung
      setTimeout(pingDevice, 400);
    },
    onFailure: function (err) {
      console.error("Gagal terhubung ke MQTT:", err.errorMessage);
      updateStatusBadge("statusMQTT", "offline", "BROKER: GAGAL KONEK");
      updateStatusBadge("statusAlat", "offline", "ALAT P10: OFFLINE");
      updateSidebarStatus(false);
      setTimeout(connectMQTT, 5000);
    },
  });
}

// --- 2. CEK STATUS DATABASE MYSQL (Dari index2.html) ---
function cekDatabase() {
  fetch("/api/api_status_db.php")
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "online") {
        updateStatusBadge("statusDB", "online", "DATABASE MYSQL: CONNECTED");
      } else {
        updateStatusBadge(
          "statusDB",
          "offline",
          "DATABASE MYSQL: DISCONNECTED",
        );
      }
    })
    .catch(() => {
      // Jika file api_status_db.php belum ada / offline di simulasi lokal
      const dbEl = document.getElementById("statusDB");
      if (dbEl) {
        dbEl.className = "status-box offline";
        dbEl.innerHTML = "DATABASE MYSQL: Aiven.Io Ready To Use";
      }
    });
}

// --- 3. AMBIL DATA TERAKHIR DARI DATABASE (Dari index2.html) ---
function loadSavedData() {
  fetch("/api/api_baca.php")
    .then((response) => response.json())
    .then((data) => {
      if (data) {
        if (data.teks) document.getElementById("inputTeks").value = data.teks;
        if (data.brightness !== undefined)
          document.getElementById("inputBrightness").value = data.brightness;
        if (data.speed !== undefined)
          document.getElementById("inputSpeed").value = data.speed;
        if (data.mode !== undefined)
          document.getElementById("inputMode").value = data.mode;

        // Sinkronkan layar preview dengan nilai awal
        updateBrightnessFromSlider(data.brightness || 30);
        updateSpeedFromSlider(data.speed || 40);
        updateTickerPreview(data.teks || "");
        updateModePreview(data.mode || 1);
      }
    })
    .catch(() => {
      // Nilai default jika server backend PHP tidak aktif
      updateBrightnessFromSlider(30);
      updateSpeedFromSlider(40);
      updateTickerPreview(document.getElementById("inputTeks").value);
    });
}

// --- 4. FUNGSI KIRIM DATA (Dari index2.html) ---
function kirimData() {
  const teksVal = document.getElementById("inputTeks").value;
  const brightnessVal = parseInt(
    document.getElementById("inputBrightness").value,
  );
  const speedVal = parseInt(document.getElementById("inputSpeed").value);
  const modeVal = parseInt(document.getElementById("inputMode").value);

  // Buat objek Payload
  let payloadObj = {
    teks: teksVal,
    brightness: isPowerOn ? brightnessVal : 0,
    power: isPowerOn ? 1 : 0,
    speed: speedVal,
    mode: modeVal,
    timezone: timezoneOffset,
    timestamp: Date.now(),
  };

  const pesanEl = document.getElementById("pesan");

  // A. Dorong data via MQTT Real-Time
  let mqttSent = false;
  if (mqttClient && mqttClient.isConnected()) {
    let pesanJSON = JSON.stringify(payloadObj);
    let message = new Paho.MQTT.Message(pesanJSON);
    message.destinationName = mqtt_topic;
    message.retained = true; // Retain: simpan pesan terakhir di broker
    mqttClient.send(message);
    mqttSent = true;
  }

  // Tampilkan notifikasi status
  if (pesanEl) {
    if (mqttSent) {
      pesanEl.innerHTML =
        "Berhasil dikirim ke Panel Kala.Clock secara Real-Time via MQTT!";
    } else {
      pesanEl.innerHTML =
        "Pengaturan diterapkan pada Simulasi (MQTT sedang offline / mencoba hubungkan...)";
    }
  }

  // B. Simpan ke Database MySQL via AJAX Fetch
  let formData = new FormData();
  formData.append("teks", payloadObj.teks);
  formData.append("brightness", payloadObj.brightness);
  formData.append("speed", payloadObj.speed);
  formData.append("mode", payloadObj.mode);

  fetch("/api/api_simpan.php", {
    method: "POST",
    body: formData,
  }).catch(() => {
    // Abaikan jika offline / API lokal belum dijalankan
  });

  // Hilangkan pesan notifikasi setelah 3.5 detik
  setTimeout(() => {
    if (pesanEl) pesanEl.innerHTML = "";
  }, 3500);
}

// --- 5. FUNGSI SINKRONISASI JAM IOT ---
function sinkronWaktu() {
  const now = new Date();
  const jam = String(now.getHours()).padStart(2, "0");
  const menit = String(now.getMinutes()).padStart(2, "0");
  const detik = String(now.getSeconds()).padStart(2, "0");
  const timeStr = `${jam}:${menit}:${detik}`;
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const payloadSync = {
    action: "sync_time",
    time: timeStr,
    date: dateStr,
    timezone: timezoneOffset,
    timestamp: now.getTime(),
  };

  if (mqttClient && mqttClient.isConnected()) {
    let message = new Paho.MQTT.Message(JSON.stringify(payloadSync));
    message.destinationName = mqtt_topic;
    message.retained = false;
    mqttClient.send(message);
  }

  const pesanEl = document.getElementById("pesan");
  if (pesanEl) {
    const tzSign = timezoneOffset >= 0 ? "+" : "";
    pesanEl.innerHTML = `Waktu Kala.Clock berhasil disinkronkan ke <strong>${timeStr}</strong> (UTC${tzSign}${timezoneOffset})!`;
    setTimeout(() => {
      pesanEl.innerHTML = "";
    }, 3500);
  }
}

// --- 6. INTERAKTIVITAS LAYAR SIMULASI VIRTUAL LED ---
let show24h = true;
let showDetik = true;
let showTanggal = true;
let isPowerOn = true;
let timezoneOffset = 8; // Default WITA (UTC+8)

// SAKLAR DAYA PANEL LED
function togglePowerSwitch() {
  isPowerOn = !isPowerOn;
  setPowerState(isPowerOn, true);
}

function setPowerState(state, sendMqtt = true) {
  isPowerOn = state;
  const switchBtn = document.getElementById("powerSlideSwitch");
  const badge = document.getElementById("powerStateBadge");
  const slider = document.getElementById("inputBrightness");

  if (isPowerOn) {
    if (switchBtn) {
      switchBtn.classList.add("active");
      switchBtn.setAttribute("aria-checked", "true");
    }
    if (badge) {
      badge.textContent = "AKTIF (ON)";
      badge.classList.remove("off");
    }
    // Default brightness 100 saat dinyalakan
    const targetVal = 150;
    if (slider) slider.value = targetVal;
    updateBrightnessFromSlider(targetVal, false);

    if (sendMqtt) {
      kirimPowerMqtt(targetVal, 1);
    }
  } else {
    if (switchBtn) {
      switchBtn.classList.remove("active");
      switchBtn.setAttribute("aria-checked", "false");
    }
    if (badge) {
      badge.textContent = "MATI (OFF)";
      badge.classList.add("off");
    }
    // Langsung matikan brightness ke 0
    if (slider) slider.value = 0;
    updateBrightnessFromSlider(0, false);

    if (sendMqtt) {
      kirimPowerMqtt(0, 0);
    }
  }
}

function kirimPowerMqtt(brightnessVal, powerVal) {
  const payloadPower = {
    action: "set_power",
    brightness: brightnessVal,
    power: powerVal,
    timestamp: Date.now(),
  };
  if (mqttClient && mqttClient.isConnected()) {
    let msg = new Paho.MQTT.Message(JSON.stringify(payloadPower));
    msg.destinationName = mqtt_topic;
    msg.retained = true;
    mqttClient.send(msg);
  }
}

function updateClock() {
  const now = new Date();
  // Kalkulasi waktu berdasarkan zona waktu pilihan (UTC + timezoneOffset)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const targetTime = new Date(utcMs + 3600000 * timezoneOffset);

  let hours = targetTime.getHours();
  const minutes = String(targetTime.getMinutes()).padStart(2, "0");
  const seconds = String(targetTime.getSeconds()).padStart(2, "0");

  let ampm = "";
  if (!show24h) {
    ampm = hours >= 12 ? " PM" : " AM";
    hours = hours % 12 || 12;
  }
  const hoursStr = String(hours).padStart(2, "0");

  const timeDisplay = showDetik
    ? `${hoursStr}:${minutes}:${seconds}${ampm}`
    : `${hoursStr}:${minutes}${ampm}`;

  const clockPreviewEl = document.getElementById("virtualClock");
  const cardClockEl = document.getElementById("liveClockCard");

  if (clockPreviewEl) clockPreviewEl.textContent = timeDisplay;
  if (cardClockEl) cardClockEl.textContent = timeDisplay;

  // Tanggal
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const dateStr = `${days[targetTime.getDay()]}, ${String(targetTime.getDate()).padStart(2, "0")} ${months[targetTime.getMonth()]} ${targetTime.getFullYear()}`;

  const datePreviewEl = document.getElementById("virtualDate");
  if (datePreviewEl) {
    datePreviewEl.style.display = showTanggal ? "block" : "none";
    datePreviewEl.textContent = dateStr;
  }
}

// Update Kecerahan di Slider & Preview
function updateBrightnessFromSlider(val, syncSwitch = true) {
  const num = parseInt(val) || 0;
  const badge = document.getElementById("badgeBrightness");
  const previewText = document.getElementById("previewBrightnessText");
  const dimmer = document.getElementById("ledDimmer");
  const percent = Math.round((num / 255) * 100);

  if (badge) badge.textContent = num;
  if (previewText) previewText.textContent = `${num} (${percent}%)`;

  // Sesuaikan kegelapan overlay dimmer (0 = redup maksimal, 255 = terang benderang)
  if (dimmer) {
    const darkness = 0.85 - (num / 255) * 0.75;
    dimmer.style.backgroundColor = `rgba(0, 0, 0, ${darkness})`;
  }

  // Sinkronkan status saklar daya saat slider digeser
  if (syncSwitch) {
    const switchBtn = document.getElementById("powerSlideSwitch");
    const powerBadge = document.getElementById("powerStateBadge");
    if (num === 0) {
      isPowerOn = false;
      if (switchBtn) {
        switchBtn.classList.remove("active");
        switchBtn.setAttribute("aria-checked", "false");
      }
      if (powerBadge) {
        powerBadge.textContent = "MATI (OFF)";
        powerBadge.classList.add("off");
      }
    } else {
      isPowerOn = true;
      if (switchBtn) {
        switchBtn.classList.add("active");
        switchBtn.setAttribute("aria-checked", "true");
      }
      if (powerBadge) {
        powerBadge.textContent = "AKTIF (ON)";
        powerBadge.classList.remove("off");
      }
    }
  }
}

// Preset Kecerahan Cepat
function setBrightnessPreset(val) {
  const slider = document.getElementById("inputBrightness");
  if (slider) {
    slider.value = val;
    updateBrightnessFromSlider(val, true);
  }
  terapkanKecerahanLangsung();
}

function terapkanKecerahanLangsung() {
  const slider = document.getElementById("inputBrightness");
  const brightnessVal = slider ? parseInt(slider.value) : 100;
  kirimPowerMqtt(isPowerOn ? brightnessVal : 0, isPowerOn ? 1 : 0);

  const pesanEl = document.getElementById("pesan");
  if (pesanEl) {
    pesanEl.innerHTML = `Kecerahan layar diatur ke <strong>${brightnessVal}</strong> (${isPowerOn ? "Layar Aktif" : "Layar Mati"})!`;
    setTimeout(() => {
      pesanEl.innerHTML = "";
    }, 3500);
  }
}

// --- PENGATURAN ZONA WAKTU & RTC MANUAL (CARD 3) ---
function updateTimezoneFromInput(val) {
  let num = parseInt(val);
  if (isNaN(num)) num = 0;
  if (num < -12) num = -12;
  if (num > 12) num = 12;
  timezoneOffset = num;

  const tzInput = document.getElementById("inputTimezone");
  if (tzInput && tzInput.value !== String(num)) {
    tzInput.value = num;
  }

  const tzBadge = document.getElementById("badgeTimezone");
  const tzPrefix = num >= 0 ? `+${num}` : `${num}`;
  if (tzBadge) tzBadge.textContent = `UTC${tzPrefix}`;

  const cardTzLabel = document.getElementById("liveTimezoneLabel");
  let tzName = `UTC${tzPrefix}`;
  if (num === 7) tzName = "WIB (UTC+7)";
  else if (num === 8) tzName = "WITA (UTC+8)";
  else if (num === 9) tzName = "WIT (UTC+9)";
  if (cardTzLabel) cardTzLabel.textContent = tzName;

  document.querySelectorAll(".btn-tz-pill").forEach((pill) => {
    if (
      pill.getAttribute("onclick") &&
      pill.getAttribute("onclick").includes(`(${num})`)
    ) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });

  updateClock();
}

function setTimezonePreset(val) {
  const tzInput = document.getElementById("inputTimezone");
  if (tzInput) tzInput.value = val;
  updateTimezoneFromInput(val);
}

function initManualTimeInputs() {
  const now = new Date();
  const timeInput = document.getElementById("inputManualTime");
  const dateInput = document.getElementById("inputManualDate");
  if (timeInput && !timeInput.value) {
    timeInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  }
  if (dateInput && !dateInput.value) {
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
}

function terapkanWaktuManual() {
  const timeInput = document.getElementById("inputManualTime");
  const dateInput = document.getElementById("inputManualDate");
  const pesanEl = document.getElementById("pesan");

  let timeVal = timeInput ? timeInput.value : "";
  let dateVal = dateInput ? dateInput.value : "";

  const now = new Date();
  if (!timeVal) {
    timeVal = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  } else if (timeVal.length === 5) {
    timeVal += ":00";
  }

  if (!dateVal) {
    dateVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  const payloadTime = {
    action: "set_time",
    time: timeVal,
    date: dateVal,
    timezone: timezoneOffset,
    timestamp: Date.now(),
  };

  let sent = false;
  if (mqttClient && mqttClient.isConnected()) {
    let msg = new Paho.MQTT.Message(JSON.stringify(payloadTime));
    msg.destinationName = mqtt_topic;
    msg.retained = false;
    mqttClient.send(msg);
    sent = true;
  }

  if (pesanEl) {
    const tzSign = timezoneOffset >= 0 ? "+" : "";
    pesanEl.innerHTML = sent
      ? `Jam & Tanggal manual (${timeVal}, ${dateVal}, UTC${tzSign}${timezoneOffset}) berhasil dikirim ke RTC modul!`
      : `Jam manual (${timeVal}) diterapkan di simulasi (Broker MQTT offline).`;
    setTimeout(() => {
      pesanEl.innerHTML = "";
    }, 3500);
  }
}

// Update Kecepatan Scroll
function updateSpeedFromSlider(val) {
  const num = parseInt(val) || 40;
  const badge = document.getElementById("badgeSpeed");
  const previewText = document.getElementById("previewSpeedText");
  const ticker = document.getElementById("virtualTicker");

  if (badge) badge.textContent = `${num} ms`;
  if (previewText) previewText.textContent = `${num} ms`;

  // Atur durasi animasi marquee berdasarkan kecepatan
  if (ticker) {
    const duration = Math.max(4, Math.round(25 - (num / 100) * 19));
    ticker.style.animationDuration = `${duration}s`;
  }
}

// Update Pesan Teks di Layar Preview
function updateTickerPreview(text) {
  const ticker = document.getElementById("virtualTicker");
  if (ticker) {
    ticker.textContent =
      text && text.trim().length > 0
        ? text
        : "Kala.Clock — Sistem Jam & Running Text Siap Digunakan";
  }
}

// Update Mode Tampilan
function updateModePreview(mode) {
  const ticker = document.getElementById("virtualTicker");
  const modeLabel = document.getElementById("previewModeLabel");
  const clockBox = document.querySelector(".led-clock-box");
  const divider = document.querySelector(".led-divider");

  if (!ticker) return;

  switch (String(mode)) {
    case "1": // Berjalan Kiri
      ticker.style.animationName = "scrollLeft";
      ticker.style.textAlign = "left";
      ticker.style.paddingLeft = "100%";
      if (clockBox) clockBox.style.display = "block";
      if (divider) divider.style.display = "block";
      if (modeLabel) modeLabel.textContent = "Mode: Jam + Teks Berjalan Kiri";
      break;
    case "2": // Diam di Tengah (Statis)
      ticker.style.animationName = "none";
      ticker.style.textAlign = "center";
      ticker.style.paddingLeft = "0";
      if (clockBox) clockBox.style.display = "block";
      if (divider) divider.style.display = "block";
      if (modeLabel) modeLabel.textContent = "Mode: Jam + Teks Diam di Tengah";
      break;
    case "3": // Berjalan Kanan
      ticker.style.animationName = "scrollRight";
      ticker.style.textAlign = "right";
      ticker.style.paddingLeft = "0";
      if (clockBox) clockBox.style.display = "block";
      if (divider) divider.style.display = "block";
      if (modeLabel) modeLabel.textContent = "Mode: Teks Berjalan Kanan";
      break;
    case "4": // Jam + Teks Bergantian
      ticker.style.animationName = "scrollLeft";
      if (clockBox) clockBox.style.display = "block";
      if (divider) divider.style.display = "block";
      if (modeLabel) modeLabel.textContent = "Mode: Jam & Teks Bergantian";
      break;
    default:
      ticker.style.animationName = "scrollLeft";
  }
}

function fokusInputTeks() {
  const input = document.getElementById("inputTeks");
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function toggleTimeFormat() {
  const check = document.getElementById("check24h");
  show24h = check ? check.checked : true;
  updateClock();
}

function toggleDetikDisplay() {
  const check = document.getElementById("checkDetik");
  showDetik = check ? check.checked : true;
  updateClock();
}

function toggleTanggalDisplay() {
  const check = document.getElementById("checkTanggal");
  showTanggal = check ? check.checked : true;
  updateClock();
}

// Helpers
function updateStatusBadge(id, status, text) {
  const el = document.getElementById(id);
  if (el) {
    el.className = "status-box " + status;
    el.innerHTML = text;
  }
}

function updateSidebarStatus(isOnline) {
  const desktopDot = document.getElementById("sidebarDot");
  const desktopText = document.getElementById("sidebarStatusText");
  const mobileDot = document.getElementById("mobileSidebarDot");
  const mobileText = document.getElementById("mobileStatusText");

  const statusClass = isOnline ? "var(--color-online)" : "var(--color-offline)";
  const statusLabel = isOnline ? "Online" : "Offline";

  if (desktopDot) {
    desktopDot.style.backgroundColor = statusClass;
    desktopDot.style.boxShadow = "0 0 6px " + statusClass;
  }
  if (desktopText) {
    desktopText.textContent = isOnline ? "Sistem Online" : "Sistem Offline";
  }

  if (mobileDot) {
    mobileDot.style.backgroundColor = statusClass;
    mobileDot.style.boxShadow = "0 0 6px " + statusClass;
  }
  if (mobileText) {
    mobileText.textContent = statusLabel;
  }
}

// --- 7. RESPONSIVE MOBILE DRAWER & NAVIGATION HANDLERS ---
function setupResponsiveNav() {
  const menuBtn = document.getElementById("mobileMenuBtn");
  const closeBtn = document.getElementById("sidebarCloseBtn");
  const backdrop = document.getElementById("sidebarBackdrop");
  const navLinks = document.querySelectorAll(".nav-link");

  function openDrawer() {
    document.body.classList.add("sidebar-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    document.body.classList.remove("sidebar-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }

  if (menuBtn) {
    menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (document.body.classList.contains("sidebar-open")) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeDrawer();
    });
  }

  if (backdrop) {
    backdrop.addEventListener("click", function () {
      closeDrawer();
    });
  }

  // Tutup drawer otomatis saat link navigasi diklik
  navLinks.forEach((link) => {
    link.addEventListener("click", function () {
      closeDrawer();

      // Update active state di nav
      if (this.classList.contains("nav-link")) {
        document
          .querySelectorAll(".nav-link")
          .forEach((l) => l.classList.remove("active"));
        this.classList.add("active");
      }
    });
  });

  // Tutup drawer jika layar di-resize kembali ke desktop (> 768px)
  window.addEventListener("resize", function () {
    if (
      window.innerWidth > 768 &&
      document.body.classList.contains("sidebar-open")
    ) {
      closeDrawer();
    }
  });
}

// --- 8. SCROLLSPY OTOMATIS UNTUK HIGHLIGHT SIDEBAR ---
function setupScrollSpy() {
  const sections = [
    document.getElementById("preview-section"),
    document.getElementById("dashboard"),
    document.getElementById("panduan"),
  ].filter(Boolean);

  const navLinks = document.querySelectorAll(".sidebar nav .nav-link");

  function onScroll() {
    const scrollPosition = window.scrollY + 180;

    let currentSectionId = "";
    sections.forEach((section) => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      if (scrollPosition >= top && scrollPosition < top + height) {
        currentSectionId = section.getAttribute("id");
      }
    });

    if (
      window.innerHeight + window.scrollY >=
      document.body.offsetHeight - 60
    ) {
      if (sections.length > 0) {
        currentSectionId = sections[sections.length - 1].getAttribute("id");
      }
    }

    if (currentSectionId) {
      navLinks.forEach((link) => {
        const target =
          link.getAttribute("data-section") ||
          link.getAttribute("href").replace("#", "");
        if (target === currentSectionId) {
          link.classList.add("active");
        } else {
          link.classList.remove("active");
        }
      });
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// --- INISIALISASI SAAT HALAMAN DIMUAT ---
document.addEventListener("DOMContentLoaded", function () {
  // Inisialisasi input manual waktu & tanggal
  initManualTimeInputs();

  // Jalankan jam digital
  updateClock();
  setInterval(updateClock, 1000);

  // Setup navigasi responsif & Scrollspy
  setupResponsiveNav();
  setupScrollSpy();

  // Jalankan koneksi MQTT & Database
  connectMQTT();
  cekDatabase();
  setInterval(cekDatabase, 10000); // Polling DB setiap 10 detik

  // Muat data terakhir
  loadSavedData();
});
