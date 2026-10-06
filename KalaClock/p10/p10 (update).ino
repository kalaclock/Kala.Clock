// ====================================================================
// KALA.CLOCK — IOT FIRMWARE (ESP8266 + P10 LED MATRIX + RTC + MQTT)
// Versi dengan dukungan mqtt_topic multi-clock:
//   - Setiap alat memiliki mqtt_topic unik (misal KC00, KC01, KC02, dst.)
//   - Subscribe ke 2 topik:
//       1. mqtt_topic (KalaClock/{idjam})    — broadcast untuk semua alat
//       2. mqtt_topic/mqtt_topic_status (KalaClock/{idjam}/status) — spesifik untuk alat ini
//   - Filter pesan: jika payload JSON punya field "mqtt_topic", hanya proses
//     jika cocok dengan mqtt_topic alat ini (atau jika tidak ada field mqtt_topic = broadcast)
//   - Heartbeat kirim JSON {"status":"online","mqtt_topic":"KC00"} agar
//     web dashboard bisa filter status per jam.
//
// Catatan PENTING:
//   - Nama variabel mqtt_topic dan mqtt_topic_status TIDAK BOLEH diubah
//     (digunakan oleh web dashboard untuk referensi topik)
//   - Nilai string boleh diubah di sini jika topik berubah
//   - mqtt_topic dan mqtt_topic_status bisa diubah sesuai unit alat ini
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
const char* mqtt_topic        = "KalaClock/KC00";
const char* mqtt_topic_status = "KalaClock/KC00/status";

// ============================================================
// SECTION 3: ID JAM (IDENTITAS ALAT INI)
// Ubah mqtt_topic_status sesuai unit fisik alat ini (contoh: KC00, KC01, KC02).
// ID ini digunakan untuk:
//   - Subscribe ke topik spesifik: KalaClock/KC00
//   - Filter pesan broadcast yang ada field "mqtt_topic_status"
//   - Mengirim heartbeat JSON yang menyertakan mqtt_topic_status
// ============================================================

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
int    tingkat_kecerahan=150;  // 0-255, default 100
int    timezone_offset = -8;    // UTC+8 (WITA)

// Timer internal fallback jika RTC tidak terpasang
unsigned long detikWaktuInternal = 0;
unsigned long millisSebelumnya   = 0;

volatile boolean teksSedangDiupdate = false;

// --- STRUKTUR DATA JADWAL & EFISIENSI ---
struct JadwalItem {
  String nama;
  int jamMulai, menitMulai;
  int jamSelesai, menitSelesai;
  String pesan;
};

#define MAX_JADWAL 10
JadwalItem daftarJadwal[MAX_JADWAL];
int jumlahJadwal = 0;

// Efisiensi Energi (Night Mode)
bool efisiensiAktif = false;
int jamTidur = 22, menitTidur = 0;
int jamBangun = 5, menitBangun = 0;
int kecerahanMalam = 15;
bool autoSleep = false;
String teksUtamaBackup = "";

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
    
    // Waktu RTC dianggap standar UTC+8 (WITA)
    // Hitung selisih relatif terhadap UTC+8
    int selisihZona = timezone_offset - 8; 
    int jamHitung   = now.hour() + selisihZona;
    
    // Penanganan meluap (overflow/underflow jam)
    if (jamHitung >= 24) {
      jamHitung -= 24;
    } else if (jamHitung < 0) {
      jamHitung += 24;
    }

    jam   = jamHitung;
    menit = now.minute();
    detik = now.second();
    hari  = now.day();
    bulan = now.month();
    tahun = now.year();
  } else {
    // Fallback timer internal
    unsigned long total = detikWaktuInternal + (millis() - millisSebelumnya) / 1000;
    int selisihZona = timezone_offset - 8;
    int jamHitung   = ((total / 3600) % 24) + selisihZona;
    
    if (jamHitung >= 24) jamHitung -= 24;
    if (jamHitung < 0)  jamHitung += 24;

    jam   = jamHitung;
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
      static unsigned long waktuGantiMode = 0;
      static bool tampilkanJam = true;

      // 1. Hitung panjang teks dalam piksel (font Mono5x7 lebarnya 6px per karakter)
      int panjang_teks_px = teks_berjalan.length() * 6;

      // 2. Hitung total jarak gulir dari luar kanan sampai habis ke luar kiri
      int total_jarak_px = panjang_layar + panjang_teks_px;

      // 3. Hitung durasi berjalannya teks secara presisi (termasuk kecepatan_scroll)
      // Ditambah 1000ms (1 detik) delay pause setelah teks selesai gulir penuh
      unsigned long durasi_teks_ms = (unsigned long)(total_jarak_px * kecepatan_scroll) + 1000;

      // 4. Durasi tampilan jam (misal dibuat tetap 5 detik / 5000ms)
      unsigned long durasi_jam_ms = 5000; 

      // Tentukan batas waktu berdasarkan mode yang lagi aktif saat ini
      unsigned long batasWaktuSekarang = tampilkanJam ? durasi_jam_ms : durasi_teks_ms;

      // Evaluasi apakah sudah waktunya ganti dari Teks -> Jam atau Jam -> Teks
      if (millis() - waktuGantiMode > batasWaktuSekarang) {
        waktuGantiMode = millis();
        tampilkanJam   = !tampilkanJam;
        posisi_X       = panjang_layar; // Reset posisi awal teks ke kanan
      }

      if (tampilkanJam) {
        // Tampilkan jam HH:MM di tengah panel
        int lebarJam = stringJam.length() * 6;
        int tengah_X = (panjang_layar - lebarJam) / 2;
        Disp.drawText(tengah_X, 4, stringJam);
      } else {
        // Tampilkan running text bergulir
        Disp.drawText(posisi_X, 4, teks_berjalan);
        posisi_X--;

        // Tahan teks di posisi akhir (luar layar) selama delay 1 detik
        if (posisi_X < -panjang_teks_px) {
          posisi_X = -panjang_teks_px; 
          }
        }
      }
    }
  }
}
// ============================================================
// SECTION 9: HANDLER PESAN MQTT MASUK
// Memfilter pesan berdasarkan mqtt_topic_status jika ada field tersebut.
// Mendukung dua topik:
//   a) mqtt_topic (broadcast) → cek field mqtt_topic_status di payload
//   b) mqtt_topic/mqtt_topic_status (spesifik) → langsung proses tanpa filter
// ============================================================

void saatPesanMqttMasuk(char* topic, byte* payload, unsigned int length) {
  // 1. ABAIKAN jika pesan berasal dari topik status milik ESP sendiri (mencegah feedback loop)
  if (String(topic) == String(mqtt_topic_status)) return;

  // 2. Baca payload menjadi String
  String pesanMasuk = "";
  for (unsigned int i = 0; i < length; i++) {
    pesanMasuk += (char)payload[i];
  }

  Serial.print("Pesan Masuk [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(pesanMasuk);

  DynamicJsonDocument doc(2048);
  DeserializationError error = deserializeJson(doc, pesanMasuk);

  if (!error) {
    // ---- Filter ID Jam / mqtt_topic ----
    // Jika JSON membawa field "id_jam", pastikan cocok dengan alat ini (atau KC00)
    if (doc.containsKey("id_jam")) {
      String targetId = doc["id_jam"].as<String>();
      // Ambil ID alat dari string mqtt_topic (misal KalaClock/KC00 -> KC00)
      String unitId = String(mqtt_topic);
      int slashIdx = unitId.lastIndexOf('/');
      if (slashIdx != -1) unitId = unitId.substring(slashIdx + 1);

      if (targetId != unitId && targetId != "BROADCAST") {
        Serial.println("Pesan diabaikan: id_jam tidak cocok (" + targetId + " != " + unitId + ")");
        return;
      }
    }

    // ---- Balas Ping dari Web Dashboard ----
    if (doc.containsKey("action")) {
      String act = doc["action"].as<String>();
      if (act == "ping") {
        String statusPayload = "{\"status\":\"online\",\"mqtt_topic_status\":\"" + String(mqtt_topic_status) + "\"}";
        mqttClient.publish(mqtt_topic_status, statusPayload.c_str(), true);
        Serial.println("Ping diterima! Membalas status online untuk " + String(mqtt_topic_status));
        return;
      }
    }

    teksSedangDiupdate = true;

    // ---- 1. Update Teks Berjalan ----
  if (doc.containsKey("teks")) {
    String teks_baru = doc["teks"].as<String>();
    if (teks_baru != "") {
      teksUtamaBackup = teks_baru; // SIMPAN JUGA KE BACKUP
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

    // ---- 5. Update Zona Waktu ----
    if (doc.containsKey("timezone")) {
      timezone_offset = doc["timezone"].as<int>();
      if (timezone_offset < -12) timezone_offset = -12;
      if (timezone_offset > 12)  timezone_offset = 12;
      Serial.printf("Zona Waktu: UTC%+d\n", timezone_offset);
    }

    // ---- 6. Sinkronisasi Waktu & Tanggal RTC ----
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

   // ---- 7. Update Jadwal & Efisiensi Energi ----
String action = doc["action"];
if (action == "update_jadwal") {
  
  // Baca Efisiensi Energi (Night Mode)
  if (doc.containsKey("efisiensi")) {
    JsonObject eff = doc["efisiensi"];
    String t = eff["tidur"].as<String>();
    String b = eff["bangun"].as<String>();
    jamTidur = t.substring(0, 2).toInt();
    menitTidur = t.substring(3, 5).toInt();
    jamBangun = b.substring(0, 2).toInt();
    menitBangun = b.substring(3, 5).toInt();
    kecerahanMalam = eff["kecerahan_malam"].as<int>();
    autoSleep = eff["auto_sleep"].as<bool>();
    efisiensiAktif = true;
  }

  // Hapus/Kosongkan jadwal lama terlebih dahulu
  jumlahJadwal = 0; 

  // Baca Array Jadwal Pesan Baru (jika ada)
  if (doc.containsKey("jadwal")) {
    JsonArray arr = doc["jadwal"].as<JsonArray>();
    for (JsonObject item : arr) {
      if (jumlahJadwal < MAX_JADWAL) {
        String m = item["mulai"].as<String>();
        String s = item["selesai"].as<String>();
        
        daftarJadwal[jumlahJadwal].nama = item["nama"].as<String>();
        daftarJadwal[jumlahJadwal].jamMulai = m.substring(0, 2).toInt();
        daftarJadwal[jumlahJadwal].menitMulai = m.substring(3, 5).toInt();
        daftarJadwal[jumlahJadwal].jamSelesai = s.substring(0, 2).toInt();
        daftarJadwal[jumlahJadwal].menitSelesai = s.substring(3, 5).toInt();
        daftarJadwal[jumlahJadwal].pesan = item["pesan"].as<String>();
        jumlahJadwal++;
      }
    }
  }
  Serial.printf("Jadwal diperbarui! Total jadwal aktif: %d\n", jumlahJadwal);
}
    teksSedangDiupdate = false;

if (doc.containsKey("id_jam")) {
  String targetId = doc["id_jam"].as<String>();
  String unitId = String(mqtt_topic);
  
  // Jika mqtt_topic berbentuk KalaClock/KC00, ambil substring ID nya saja (KC00)
  int slashIdx = unitId.lastIndexOf('/');
  if (slashIdx != -1) {
    unitId = unitId.substring(slashIdx + 1);
  }

  // Cocokkan id_jam
  if (targetId != unitId && targetId != "BROADCAST" && doc["id_jam"].as<String>() != String(mqtt_topic)) {
    Serial.println("Pesan diabaikan: id_jam tidak cocok (" + targetId + " != " + unitId + ")");
    return;
  }
}
    
    // Simpan ke Flash LittleFS
    File f = LittleFS.open("/config.json", "w");
    if (f) {
      serializeJson(doc, f);
      f.close();
      Serial.println("Konfigurasi disimpan ke LittleFS.");
    }
  }
}

void periksaJadwalDanEfisiensi() {
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck < 2000) return; // Cek setiap 2 detik
  lastCheck = millis();

  int j, m, d, hr, bl, th;
  ambilWaktuSekarang(j, m, d, hr, bl, th);
  int menitSekarang = j * 60 + m;

  // Simpan backup teks utama dari web jika belum ada
  if (teksUtamaBackup == "" && !adaJadwalAktif) {
    teksUtamaBackup = teks_berjalan;
  }

  // 1. INSIALISASI BACKUP TEKS UTAMA
  if (teksUtamaBackup == "") {
    teksUtamaBackup = teks_berjalan;
  }

  // 2. EVALUASI EFISIENSI ENERGI (NIGHT MODE)
  if (efisiensiAktif) {
    int menitMulaiTidur = jamTidur * 60 + menitTidur;
    int menitSelesaiTidur = jamBangun * 60 + menitBangun;
    bool isMalam = false;

    if (menitMulaiTidur > menitSelesaiTidur) {
      // Lewat tengah malam (misal 22:00 - 05:00)
      isMalam = (menitSekarang >= menitMulaiTidur || menitSekarang < menitSelesaiTidur);
    } else {
      isMalam = (menitSekarang >= menitMulaiTidur && menitSekarang < menitSelesaiTidur);
    }

    if (isMalam) {
      if (autoSleep) {
        Disp.setBrightness(0);
        Disp.clear();
      } else {
        Disp.setBrightness(kecerahanMalam);
      }
    } else {
      Disp.setBrightness(tingkat_kecerahan);
    }
  }

  // 3. EVALUASI SIARAN PESAN TERJADWAL
  bool adaJadwalAktif = false;
  for (int i = 0; i < jumlahJadwal; i++) {
    int mulai = daftarJadwal[i].jamMulai * 60 + daftarJadwal[i].menitMulai;
    int selesai = daftarJadwal[i].jamSelesai * 60 + daftarJadwal[i].menitSelesai;

    if (menitSekarang >= mulai && menitSekarang <= selesai) {
      // Tampilkan pesan jadwal jika jam sekarang berada di dalam rentang
      if (teks_berjalan != daftarJadwal[i].pesan) {
        teks_berjalan = daftarJadwal[i].pesan;
        posisi_X = panjang_layar; // Reset running text dari kanan
      }
      adaJadwalAktif = true;
      break; // Ambil jadwal pertama yang cocok
    }
  }

  // Kembalikan ke teks utama jika TIDAK ADA jadwal yang aktif
  if (!adaJadwalAktif && teks_berjalan != teksUtamaBackup) {
    teks_berjalan = teksUtamaBackup;
    posisi_X = panjang_layar;
  }
}

// ============================================================
// SECTION 10: KONEKSI MQTT (dengan LWT / Last Will)
// LWT (Last Will and Testament): jika alat terputus mendadak,
// broker otomatis publish {"status":"offline","mqtt_topic_status":"KC00"}
// ke mqtt_topic_status agar web dashboard tahu alat offline.
// ============================================================

void konekMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Menghubungkan ke MQTT (" + String(mqtt_server) + ":" + String(mqtt_port) + ")...");

    String clientId = "ESP8266_" + String(mqtt_topic) + "_" + String(random(0xffff), HEX);

    // LWT dipasang pada mqtt_topic_status (bukan mqtt_topic biasa)
    String lwtPayload = "{\"status\":\"offline\",\"mqtt_topic_status\":\"" + String(mqtt_topic_status) + "\"}";

    if (mqttClient.connect(clientId.c_str(), NULL, NULL,
                            mqtt_topic_status, 0, true, lwtPayload.c_str())) {
      Serial.println(" BERHASIL!");

      // Publish Heartbeat Online
      String onlinePayload = "{\"status\":\"online\",\"mqtt_topic_status\":\"" + String(mqtt_topic_status) + "\"}";
      mqttClient.publish(mqtt_topic_status, onlinePayload.c_str(), true);

      // Subscribe ke topik kontrol (KalaClock/KC00)
      mqttClient.subscribe(mqtt_topic);
      Serial.println("Subscribe topik kontrol: [" + String(mqtt_topic) + "]");

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
  Serial.println("=== ID Jam: " + String(mqtt_topic) + " ===");
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
        DynamicJsonDocument doc(2048);
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
  periksaJadwalDanEfisiensi();

  if (WiFi.status() == WL_CONNECTED) {
    // Pastikan MQTT tetap terhubung
    if (!mqttClient.connected()) {
      konekMQTT();
    }
    mqttClient.loop();

    // ---- Heartbeat: kirim status online setiap 8 detik ----
    // Format JSON agar web dashboard bisa filter berdasarkan mqtt_topic_status.
    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat > 8000) {
      lastHeartbeat = millis();
      if (mqttClient.connected()) {
        String heartbeatPayload = "{\"status\":\"online\",\"mqtt_topic_status\":\"" + String(mqtt_topic_status) + "\"}";
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
