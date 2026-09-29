// ====================================================================
// KALA.CLOCK — IOT FIRMWARE (ESP8266 + P10 LED MATRIX + RTC + MQTT)
// Versi dengan dukungan ID_Jam multi-clock:
//   - Setiap alat memiliki id_jam unik (misal KC00, KC01, KC02, dst.)
//   - Subscribe ke 2 topik:
//       1. mqtt_topic (KalaClock)    — broadcast untuk semua alat
//       2. mqtt_topic/id_jam (KalaClock/KC00) — spesifik untuk alat ini
//   - Filter pesan: jika payload JSON punya field "id_jam", hanya proses
//     jika cocok dengan id_jam alat ini (atau jika tidak ada field id_jam = broadcast)
//   - Heartbeat kirim JSON {"status":"online","id_jam":"KC00"} agar
//     web dashboard bisa filter status per jam.
//
// Catatan PENTING:
//   - Nama variabel mqtt_topic dan mqtt_topic_status TIDAK BOLEH diubah
//     (digunakan oleh web dashboard untuk referensi topik)
//   - Nilai string boleh diubah di sini jika topik berubah
//   - id_jam bisa diubah sesuai unit alat ini
// ====================================================================

#include <ESP8266WiFi.h>  // Konektivitas WiFi ESP8266
#include <PubSubClient.h> // Library MQTT Client
#include <DMDESP.h>       // Library Driver P10 LED Matrix
#include <fonts/Mono5x7.h>// Font Standar P10
#include <Ticker.h>       // Background Refresh Timer
#include <ArduinoJson.h>  // Parser JSON dari Web Dashboard
#include <LittleFS.h>     // Sistem File Flash untuk Cadangan Offline
#include <Wire.h>         // I2C untuk RTC
#include <RTClib.h>       // Library RTC DS3231/DS1307
#include <NTPClient.h>    // NTP Client
#include <WiFiUDP.h>      // UDP untuk NTP

// ============================================================
// SECTION 1: KONFIGURASI WIFI
// Ubah ssid dan password sesuai jaringan WiFi Anda.
// ============================================================
const char* ssid     = "Melhani";
const char* password = "Sepuluhcucu10";

// ============================================================
// SECTION 2: KONFIGURASI MQTT
// CATATAN: Nama variabel mqtt_topic dan mqtt_topic_status
//          HARUS tetap sama agar kompatibel dengan web dashboard.
// Port 1883 = TCP biasa (hardware).
// Port 8084 = WebSocket TLS (browser web dashboard).
// ============================================================
const char* mqtt_server      = "broker.emqx.io";
const int   mqtt_port        = 1883;

// Topik utama: JANGAN ubah nama variabel ini.
// mqtt_topic        = topik data (Web → ESP, untuk broadcast atau spesifik)
// mqtt_topic_status = topik status (ESP → Web, heartbeat online/offline)
const char* mqtt_topic        = "KalaClock";
const char* mqtt_topic_status = "KalaClock/status";

// ============================================================
// SECTION 3: ID JAM (IDENTITAS ALAT INI)
// Ubah id_jam sesuai unit fisik alat ini (contoh: KC00, KC01, KC02).
// ID ini digunakan untuk:
//   - Subscribe ke topik spesifik: KalaClock/KC00
//   - Filter pesan broadcast yang ada field "id_jam"
//   - Mengirim heartbeat JSON yang menyertakan id_jam
// ============================================================
const char* id_jam = "KC00";  // <--- UBAH SESUAI UNIT ALAT INI

// ============================================================
// SECTION 4: INISIALISASI CLIENT MQTT & WIFI
// ============================================================
WiFiClient    espClient;
PubSubClient  mqttClient(espClient);

// ============================================================
// SECTION 5: HARDWARE DISPLAY P10 & RTC
// ============================================================
#define DISPLAYS_WIDE 1  // Ubah ke 2 jika memakai 2 panel (64x16)
#define DISPLAYS_HIGH 1
DMDESP Disp(DISPLAYS_WIDE, DISPLAYS_HIGH);

// Pin I2C untuk RTC
#define RTC_SDA D2  // GPIO4
#define RTC_SCL D1  // GPIO5

RTC_DS3231 rtc;
bool rtcDitemukan = false;

// ============================================================
// SECTION 6: VARIABEL KONFIGURASI SISTEM
// Semua nilai ini bisa diperbarui oleh pesan MQTT atau LittleFS.
// ============================================================
String teks_berjalan   = "Kala.Clock IoT — Sistem Jam dan Running Text";
int    posisi_X        = 32;
int    panjang_layar   = 32;
int    mode_tampilan   = 4;    // 1=Kiri, 2=Statis, 3=Kanan, 4=Jam+Teks
int    kecepatan_scroll= 40;   // ms per geser
int    tingkat_kecerahan=100;  // 0-255, default 100
int    timezone_offset = 8;    // UTC+8 (WITA)

// Timer internal fallback jika RTC tidak terpasang
unsigned long detikWaktuInternal = 0;
unsigned long millisSebelumnya   = 0;

volatile boolean teksSedangDiupdate = false;

// ============================================================
// SECTION 7: HELPER FUNCTIONS
// ============================================================

/** Format angka jadi dua digit: 5 → "05" */
String duaDigit(int nilai) {
  if (nilai < 10) return "0" + String(nilai);
  return String(nilai);
}

/**
 * Ambil waktu sekarang dari RTC (jika ada) atau fallback ke timer internal.
 * Timezone offset diterapkan setelah mendapat waktu UTC dari RTC.
 */
void ambilWaktuSekarang(int &jam, int &menit, int &detik,
                         int &hari, int &bulan, int &tahun) {
  if (rtcDitemukan) {
    DateTime now = rtc.now();
    jam   = now.hour();
    menit = now.minute();
    detik = now.second();
    hari  = now.day();
    bulan = now.month();
    tahun = now.year();
  } else {
    // Hitung dari counter internal jika tidak ada RTC fisik
    unsigned long total = detikWaktuInternal + (millis() - millisSebelumnya) / 1000;
    jam   = (total / 3600) % 24;
    menit = (total / 60) % 60;
    detik = total % 60;
    hari  = 22; bulan = 9; tahun = 2026;
  }
}

// ============================================================
// SECTION 8: TICKER P10 REFRESH
// Background timer yang me-refresh tampilan P10 setiap 2ms.
// ============================================================
Ticker timerP10;

void refreshP10() {
  Disp.loop();

  // Jika kecerahan 0 (layar dimatikan), bersihkan dan keluar
  if (tingkat_kecerahan <= 0) {
    Disp.clear();
    return;
  }

  static unsigned long waktuScroll = 0;
  if (millis() - waktuScroll > (unsigned long)kecepatan_scroll) {
    waktuScroll = millis();

    if (!teksSedangDiupdate) {
      Disp.clear();

      int j, m, d, hr, bl, th;
      ambilWaktuSekarang(j, m, d, hr, bl, th);
      String stringJam = duaDigit(j) + ":" + duaDigit(m);

      static unsigned long waktuGantiMode = 0;
      static bool tampilkanJam = true;

      // ---- Mode 1: Teks Berjalan ke Kiri ----
      if (mode_tampilan == 1) {
        Disp.drawText(posisi_X, 4, teks_berjalan);
        int panjang_teks = teks_berjalan.length() * 6;
        posisi_X--;
        if (posisi_X < -panjang_teks) posisi_X = panjang_layar;
      }
      // ---- Mode 2: Teks Diam di Tengah (Statis) ----
      else if (mode_tampilan == 2) {
        int panjang_teks = teks_berjalan.length() * 6;
        int tengah_X = (panjang_layar - panjang_teks) / 2;
        Disp.drawText(tengah_X, 4, teks_berjalan);
      }
      // ---- Mode 3: Teks Berjalan ke Kanan ----
      else if (mode_tampilan == 3) {
        Disp.drawText(posisi_X, 4, teks_berjalan);
        int panjang_teks = teks_berjalan.length() * 6;
        posisi_X++;
        if (posisi_X > panjang_layar) posisi_X = -panjang_teks;
      }
      // ---- Mode 4: Jam Digital + Running Text Bergantian ----
      else if (mode_tampilan == 4) {
        if (millis() - waktuGantiMode > 12000) { // Berganti setiap 12 detik
          waktuGantiMode = millis();
          tampilkanJam   = !tampilkanJam;
          posisi_X       = panjang_layar;
        }

        if (tampilkanJam) {
          // Tampilkan jam HH:MM di tengah panel
          int lebarJam = stringJam.length() * 6;
          int tengah_X = (panjang_layar - lebarJam) / 2;
          Disp.drawText(tengah_X, 4, stringJam);
        } else {
          // Tampilkan running text bergulir
          Disp.drawText(posisi_X, 4, teks_berjalan);
          int panjang_teks = teks_berjalan.length() * 6;
          posisi_X--;
          if (posisi_X < -panjang_teks) posisi_X = panjang_layar;
        }
      }
    }
  }
}

// ============================================================
// SECTION 9: HANDLER PESAN MQTT MASUK
// Memfilter pesan berdasarkan id_jam jika ada field tersebut.
// Mendukung dua topik:
//   a) mqtt_topic (broadcast) → cek field id_jam di payload
//   b) mqtt_topic/id_jam (spesifik) → langsung proses tanpa filter
// ============================================================

void saatPesanMqttMasuk(char* topic, byte* payload, unsigned int length) {
  // Abaikan pesan dari topik status (mencegah loop / salah parsing)
  if (strcmp(topic, mqtt_topic_status) == 0) return;

  // Baca payload menjadi String
  String pesanMasuk = "";
  for (unsigned int i = 0; i < length; i++) {
    pesanMasuk += (char)payload[i];
  }

  Serial.print("Pesan Masuk [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(pesanMasuk);

  // ----------------------------------------------------------------
  // Tentukan apakah ini topik broadcast atau topik spesifik alat ini.
  // Topik spesifik: "KalaClock/KC00" → langsung proses.
  // Topik broadcast: "KalaClock" → cek field id_jam di JSON.
  // ----------------------------------------------------------------
  String topicSpesifik = String(mqtt_topic) + "/" + String(id_jam);
  bool   isTopikSpesifik = (String(topic) == topicSpesifik);

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, pesanMasuk);

  if (!error) {
    // ---- Filter ID Jam (hanya untuk topik broadcast) ----
    // Jika pesan dari topik broadcast (KalaClock) dan ada field id_jam,
    // abaikan jika id_jam tidak cocok dengan alat ini.
    if (!isTopikSpesifik && doc.containsKey("id_jam")) {
      String targetId = doc["id_jam"].as<String>();
      if (targetId != String(id_jam)) {
        Serial.println("Pesan diabaikan: id_jam tidak cocok (" + targetId + " != " + String(id_jam) + ")");
        return; // Bukan untuk alat ini
      }
    }

    // ---- Balas Ping dari Web Dashboard ----
    // Web mengirim {"action":"ping","id_jam":"KC00"} untuk cek alat online.
    if (doc.containsKey("action")) {
      String act = doc["action"].as<String>();
      if (act == "ping") {
        // Kirim status online dalam format JSON dengan id_jam
        String statusPayload = "{\"status\":\"online\",\"id_jam\":\"" + String(id_jam) + "\"}";
        mqttClient.publish(mqtt_topic_status, statusPayload.c_str(), true);
        Serial.println("Ping diterima! Membalas status online untuk " + String(id_jam));
        return;
      }
    }

    teksSedangDiupdate = true;

    // ---- 1. Update Teks Berjalan ----
    if (doc.containsKey("teks")) {
      String teks_baru = doc["teks"].as<String>();
      if (teks_baru != "") {
        teks_berjalan = teks_baru;
        posisi_X = panjang_layar; // Reset posisi ke awal
      }
    }

    // ---- 2. Update Kecerahan & Daya Layar ----
    if (doc.containsKey("brightness")) {
      tingkat_kecerahan = doc["brightness"].as<int>();
      if (tingkat_kecerahan <= 0) {
        Disp.setBrightness(0);
        Disp.clear();
      } else {
        Disp.setBrightness(tingkat_kecerahan);
      }
    }

    // ---- 3. Update Kecepatan Scroll ----
    if (doc.containsKey("speed")) {
      kecepatan_scroll = doc["speed"].as<int>();
    }

    // ---- 4. Update Mode Tampilan ----
    if (doc.containsKey("mode")) {
      mode_tampilan = doc["mode"].as<int>();
      posisi_X = panjang_layar; // Reset posisi saat ganti mode
    }

    // ---- 5. Update Zona Waktu (UTC-12 s/d UTC+12) ----
    if (doc.containsKey("timezone")) {
      timezone_offset = doc["timezone"].as<int>();
      if (timezone_offset < -12) timezone_offset = -12;
      if (timezone_offset > 12)  timezone_offset = 12;
      Serial.printf("Zona Waktu: UTC%+d\n", timezone_offset);
    }

    // ---- 6. Sinkronisasi Waktu & Tanggal RTC dari Web ----
    if (doc.containsKey("time")) {
      String timeStr = doc["time"].as<String>();
      if (timeStr.length() >= 5) {
        int j = timeStr.substring(0, 2).toInt();
        int m = timeStr.substring(3, 5).toInt();
        int d = (timeStr.length() >= 8) ? timeStr.substring(6, 8).toInt() : 0;
        int th = 2026, bl = 9, hr = 22;

        if (doc.containsKey("date")) {
          String dateStr = doc["date"].as<String>();
          if (dateStr.length() >= 10) {
            th = dateStr.substring(0, 4).toInt();
            bl = dateStr.substring(5, 7).toInt();
            hr = dateStr.substring(8, 10).toInt();
          }
        }

        if (rtcDitemukan) {
          rtc.adjust(DateTime(th, bl, hr, j, m, d));
          Serial.printf("RTC Disinkronkan: %04d-%02d-%02d %02d:%02d:%02d\n", th, bl, hr, j, m, d);
        } else {
          detikWaktuInternal = (unsigned long)j * 3600 + (unsigned long)m * 60 + d;
          millisSebelumnya   = millis();
          Serial.printf("Jam Internal: %02d:%02d:%02d\n", j, m, d);
        }
      }
    }

    // ---- 7. Perintah Kalibrasi (RTC/NTP) ----
    if (doc.containsKey("cal_source")) {
      String src = doc["cal_source"].as<String>();
      Serial.println("Kalibrasi diminta: " + src);
      // NTP sync bisa diimplementasikan di sini jika ada modul NTP
    }

    teksSedangDiupdate = false;

    // ---- Simpan Konfigurasi ke LittleFS (Flash) ----
    // Agar pengaturan tetap tersimpan meskipun listrik padam.
    File f = LittleFS.open("/config.json", "w");
    if (f) {
      serializeJson(doc, f);
      f.close();
      Serial.println("Konfigurasi disimpan ke LittleFS.");
    }
  }
}

// ============================================================
// SECTION 10: KONEKSI MQTT (dengan LWT / Last Will)
// LWT (Last Will and Testament): jika alat terputus mendadak,
// broker otomatis publish {"status":"offline","id_jam":"KC00"}
// ke mqtt_topic_status agar web dashboard tahu alat offline.
// ============================================================

void konekMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Menghubungkan ke MQTT (" + String(mqtt_server) + ":" + String(mqtt_port) + ")...");

    // Client ID unik per koneksi
    String clientId = "KalaClock_" + String(id_jam) + "_" + String(random(0xffff), HEX);

    // Pesan LWT: akan dikirim broker jika koneksi terputus mendadak
    String lwtPayload = "{\"status\":\"offline\",\"id_jam\":\"" + String(id_jam) + "\"}";

    if (mqttClient.connect(clientId.c_str(), NULL, NULL,
                            mqtt_topic_status, 0, true, lwtPayload.c_str())) {
      Serial.println(" BERHASIL!");

      // Kirim status online dalam format JSON (retained=true)
      String onlinePayload = "{\"status\":\"online\",\"id_jam\":\"" + String(id_jam) + "\"}";
      mqttClient.publish(mqtt_topic_status, onlinePayload.c_str(), true);

      // Subscribe ke topik broadcast (semua alat)
      mqttClient.subscribe(mqtt_topic);
      Serial.println("Subscribe topik broadcast: [" + String(mqtt_topic) + "]");

      // Subscribe ke topik spesifik alat ini: KalaClock/KC00
      String topikSpesifik = String(mqtt_topic) + "/" + String(id_jam);
      mqttClient.subscribe(topikSpesifik.c_str());
      Serial.println("Subscribe topik spesifik:  [" + topikSpesifik + "]");

    } else {
      Serial.print(" Gagal, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" | Coba lagi dalam 5 detik...");
      delay(5000);
    }
  }
}

// ============================================================
// SECTION 11: SETUP
// Inisialisasi semua hardware dan koneksi saat pertama nyala.
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n===========================================");
  Serial.println("=== Kala.Clock IoT Firmware v2 (Multi) ===");
  Serial.println("=== ID Jam: " + String(id_jam) + " ===");
  Serial.println("===========================================");

  // Inisialisasi I2C & RTC
  Wire.begin(4, 5); // SDA=D2(GPIO4), SCL=D1(GPIO5)
  if (rtc.begin()) {
    rtcDitemukan = true;
    Serial.println("RTC DS3231 ditemukan dan siap.");
  } else {
    Serial.println("Peringatan: RTC tidak terdeteksi. Menggunakan timer internal.");
  }

  // Muat pengaturan tersimpan dari LittleFS
  if (LittleFS.begin()) {
    if (LittleFS.exists("/config.json")) {
      File file = LittleFS.open("/config.json", "r");
      if (file) {
        StaticJsonDocument<512> doc;
        if (!deserializeJson(doc, file)) {
          if (doc.containsKey("teks"))       teks_berjalan     = doc["teks"].as<String>();
          if (doc.containsKey("brightness")) tingkat_kecerahan = doc["brightness"];
          if (doc.containsKey("speed"))      kecepatan_scroll  = doc["speed"];
          if (doc.containsKey("mode"))       mode_tampilan     = doc["mode"];
          if (doc.containsKey("timezone"))   timezone_offset   = doc["timezone"];
          Serial.println("Konfigurasi LittleFS dimuat.");
        }
        file.close();
      }
    }
  }

  // Konfigurasi dan mulai layar P10
  Disp.start();
  Disp.setBrightness(tingkat_kecerahan);
  Disp.setFont(Mono5x7);
  panjang_layar = Disp.width();
  posisi_X      = panjang_layar;

  // Hubungkan background timer refresh P10 (2ms interval)
  timerP10.attach_ms(2, refreshP10);

  // Hubungkan ke WiFi (timeout 20 detik)
  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan ke WiFi [" + String(ssid) + "]");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Terhubung! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[PERINGATAN] WiFi gagal. Periksa SSID/Password di baris 46-47.");
  }

  // Inisialisasi MQTT client
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(saatPesanMqttMasuk);
}

// ============================================================
// SECTION 12: LOOP UTAMA
// Menjaga koneksi MQTT tetap aktif.
// Mengirim heartbeat JSON setiap 8 detik.
// ============================================================

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    // Pastikan MQTT tetap terhubung
    if (!mqttClient.connected()) {
      konekMQTT();
    }
    mqttClient.loop();

    // ---- Heartbeat: kirim status online setiap 8 detik ----
    // Format JSON agar web dashboard bisa filter berdasarkan id_jam.
    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat > 8000) {
      lastHeartbeat = millis();
      if (mqttClient.connected()) {
        String heartbeatPayload = "{\"status\":\"online\",\"id_jam\":\"" + String(id_jam) + "\"}";
        mqttClient.publish(mqtt_topic_status, heartbeatPayload.c_str(), true);
      }
    }

  } else {
    // Jika WiFi terputus, coba reconnect setiap 10 detik
    static unsigned long lastWiFiCheck = 0;
    if (millis() - lastWiFiCheck > 10000) {
      lastWiFiCheck = millis();
      Serial.println("WiFi terputus, mencoba reconnect...");
      WiFi.reconnect();
    }
  }
}
