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

#include <Bitmap.h>
#include <DMDESP.h>
#include <ESP8266WiFi.h>  // Konektivitas WiFi ESP8266
#include <PubSubClient.h> // Library MQTT Client
#include <DMDESP.h>       // Library Driver P10 LED Matrix
#include <fonts/EMSans6x8.h> // Font Standar P10
#include <fonts/EMSans6x16.h> // Font Standar P10
#include <fonts/ElektronMart6x12.h> // Font Standar P10
#include <fonts/ElektronMart6x16.h> // Font Standar P10
#include <fonts/DejaVuSansBold9.h> // Font Standar P10
#include <fonts/Mono5x7.h> // Font Standar P10
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
const char* ssid     = "Infinix HOT 20S";
const char* password = "inf8n8x20s";

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
const char* mqtt_topic        = "KalaClock/KC01";
const char* mqtt_topic_status = "KalaClock/KC01/status";

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
#define DISPLAYS_WIDE 1 // Ubah ke 1 (32x16), 2 (64x16), atau 3 (96x16)
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
int    kecepatan_scroll= 50;   // ms per geser
int    tingkat_kecerahan= 255;  // 0-255, default 100
int    timezone_offset = 8;    // UTC+8 (WITA)

// Timer internal fallback jika RTC tidak terpasang
unsigned long detikWaktuInternal = 0; 
unsigned long millisSebelumnya   = 0;
int internalHari = 2;
int internalBulan = 11; // November
int internalTahun = 2026;

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
int kecerahanMalam = 1;
bool autoSleep = false;
bool isNightModeSleep = false;
String teksUtamaBackup = "Kala.Clock IoT - Sistem Jam dan Running Text";

// ============================================================
// SECTION : HELPER FUNCTIONS & JADWAL SHOLAT
// ============================================================

/** Format angka jadi dua digit: 5 → "05" */
String duaDigit(int nilai) {
  if (nilai < 10) return "0" + String(nilai);
  return String(nilai);
}

const char* namaBulan[] = {
  "", "Jan", "Feb", "Mar", "Apr", "Juni", "Juli", "Agus", "Sep", "Okt", "Nov", "Des"
};

const char* NAMA_HARI[] = {
  "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"
};

const char* NAMA_BULAN_CAPS[] = {
  // "", "JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
};

/**
 * Hitung nama hari dalam seminggu (0 = Minggu, 1 = Senin, ..., 6 = Sabtu)
 */
int hitungHariDalamSeminggu(int y, int m, int d) {
  static int t[] = { 0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4 };
  if (m < 3) y -= 1;
  return (y + y/4 - y/100 + y/400 + t[m-1] + d) % 7;
}

/**
 * Perhitungan Astronomis 5 Waktu Sholat Presisi (NOAA & Kemenag RI)
 * Menggunakan Ephemeris Matahari (Equation of Time & Deklinasi)
 * Teruji akurat untuk Kota Banjarmasin (WITA UTC+8) dan seluruh Indonesia.
 */
void hitung5WaktuSholat(int y, int m, int d, int tz,
                        String &jamSubuh, String &jamZuhur,
                        String &jamAsar, String &jamMagrib, String &jamIsya) {
  static int lastD = -1, lastM = -1, lastY = -1, lastTz = -99;
  static String cSubuh = "04:41", cZuhur = "12:08", cAsar = "15:26", cMagrib = "18:15", cIsya = "19:26";

  if (d == lastD && m == lastM && y == lastY && tz == lastTz) {
    jamSubuh  = cSubuh;
    jamZuhur  = cZuhur;
    jamAsar   = cAsar;
    jamMagrib = cMagrib;
    jamIsya   = cIsya;
    return;
  }

  // Koordinat acuan Kota Banjarmasin (WITA UTC+8)
  float lat = -3.3194;
  float lon = 114.5908;
  if (tz == 7) { lat = -6.2088; lon = 106.8456; }      // WIB (Jakarta/Jawa)
  else if (tz == 8) { lat = -3.3194; lon = 114.5908; } // WITA (Banjarmasin)
  else if (tz == 9) { lat = -3.7000; lon = 128.1800; } // WIT (Ambon/Papua)

  // Hitung Day of Year (doy)
  int daysInMonth[] = { 0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
  if (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) daysInMonth[2] = 29;
  int doy = d;
  for (int i = 1; i < m && i <= 12; i++) {
    doy += daysInMonth[i];
  }

  // Sudut fraksional tahun (gamma dalam radian)
  float gamma = (2.0 * PI / 365.25) * (float)(doy - 1);

  // NOAA Equation of Time (menit) & Deklinasi Matahari (radian)
  float eqtime = 229.18 * (0.000075 + 0.001868 * cos(gamma) - 0.032077 * sin(gamma)
                - 0.014615 * cos(2.0 * gamma) - 0.040849 * sin(2.0 * gamma));

  float decl = 0.006918 - 0.399912 * cos(gamma) + 0.070257 * sin(gamma)
             - 0.006758 * cos(2.0 * gamma) + 0.000907 * sin(2.0 * gamma)
             - 0.002697 * cos(3.0 * gamma) + 0.00148 * sin(3.0 * gamma);

  // Waktu matahari tepat di titik kulminasi atas (Zuhur astronomis)
  float zuhurRaw = 12.0 + (tz * 15.0 - lon) / 15.0 - (eqtime / 60.0);
  float latRad   = lat * DEG_TO_RAD;

  auto hitungHA = [&](float altDeg) -> float {
    float altRad = altDeg * DEG_TO_RAD;
    float cosHA = (sin(altRad) - sin(latRad) * sin(decl)) / (cos(latRad) * cos(decl));
    if (cosHA > 1.0)  cosHA = 1.0;
    if (cosHA < -1.0) cosHA = -1.0;
    return acos(cosHA) * RAD_TO_DEG / 15.0;
  };

  // Sudut posisi matahari standar Kemenag RI + Ihtiyat
  float haSubuh = hitungHA(-20.0);
  float subuhFloat = zuhurRaw - haSubuh + (2.0 / 60.0);

  float zuhurFloat = zuhurRaw + (2.6 / 60.0);

  float altAshar = atan(1.0 / (1.0 + tan(fabs(latRad - decl)))) * RAD_TO_DEG;
  float haAshar = hitungHA(altAshar);
  float asharFloat = zuhurRaw + haAshar + (2.0 / 60.0);

  float haMagrib = hitungHA(-0.8333);
  float magribFloat = zuhurRaw + haMagrib + (2.5 / 60.0);

  float haIsya = hitungHA(-18.0);
  float isyaFloat = zuhurRaw + haIsya + (2.5 / 60.0);

  auto toHMStr = [](float t) -> String {
    if (t < 0) t += 24.0;
    if (t >= 24.0) t -= 24.0;
    int h = (int)t;
    int min = (int)((t - h) * 60.0 + 0.5);
    if (min >= 60) { min -= 60; h = (h + 1) % 24; }
    return duaDigit(h) + ":" + duaDigit(min);
  };

  cSubuh  = toHMStr(subuhFloat);
  cZuhur  = toHMStr(zuhurFloat);
  cAsar   = toHMStr(asharFloat);
  cMagrib = toHMStr(magribFloat);
  cIsya   = toHMStr(isyaFloat);

  lastD = d; lastM = m; lastY = y; lastTz = tz;

  jamSubuh  = cSubuh;
  jamZuhur  = cZuhur;
  jamAsar   = cAsar;
  jamMagrib = cMagrib;
  jamIsya   = cIsya;
}

/**
 * Gambar Tanggal Kustom di X = startX, Y = startY
 * Format: 2NOV2026 dengan ekstra 1px gap (total 2px gap) antara Tgl-Bulan dan Bulan-Tahun.
 * Fallback aman ke NOV (11) jika bulan tidak valid agar tidak pernah muncul "BLN".
 */
void drawTanggalKustom(int startX, int startY, int d, int bl, int y) {
  int bulanValid = (bl >= 1 && bl <= 12) ? bl : 11;
  String strTgl = String(d);
  String strBln = NAMA_BULAN_CAPS[bulanValid];
  String strThn = (d < 10) ? String(y) : String(y % 100);

  // Gambar Hari/Tanggal
  Disp.drawText(startX, startY, strTgl);
  int curX = startX + (strTgl.length() * 6) + 1; // Ekstra 1px gap (total 2px)

  // Gambar Bulan
  Disp.drawText(curX, startY, strBln);
  curX += (strBln.length() * 6) + 1; // Ekstra 1px gap (total 2px)

  // Gambar Tahun
  Disp.drawText(curX, startY, strThn);
}

// ============================================================
// MODE 4: SLIDESHOW INFORMASI MULTI-SLIDE ANIMASI
// Slide 1: Jam (stringJam ElektronMart6x16, stringMenit & stringDetik DejaVuSansBold9) - 5s
// Slide 2: Tanggal (Hari & Tanggal DD Mon) - 2.5s
// Slide 3-7: Sholat 5 Waktu (Subuh, Zuhur/Jum'at, Asar, Magrib, ISYA & Jam) - 2.5s
// Slide 8: Running Text (DejaVuSansBold9, Y: 3) tampil minimal 2 kali -> Kembali ke Slide 1
// Alert Sholat: Teks "Sekarang Sudah Memasuki Waktu {Sholat}." berjalan 2 menit, lalu layar clear 5 menit
// ============================================================
enum Mode4SlideType {
  M4_SLIDE_CLOCK = 0,
  M4_SLIDE_DATE  = 1,
  M4_SLIDE_SUBUH = 2,
  M4_SLIDE_ZUHUR = 3,
  M4_SLIDE_ASAR  = 4,
  M4_SLIDE_MAGRIB = 5,
  M4_SLIDE_ISYA  = 6,
  M4_SLIDE_TEKS  = 7
};

enum M4AnimState {
  M4_ANIM_IN,
  M4_ANIM_HOLD,
  M4_ANIM_OUT,
  M4_ANIM_DELAY
};

// State Alert Waktu Sholat (Aktif untuk semua ukuran panel)
enum SholatAlertState {
  ALERT_INAKTIF = 0,
  ALERT_RUNNING_TEKS,
  ALERT_CLEAR_LAYAR
};

static SholatAlertState statusAlertSholat = ALERT_INAKTIF;
static unsigned long waktuMulaiAlertSholat = 0;
static String pesanAlertSholat = "";
static int posisi_X_alert = 32;
static String lastAlertSholatHari = "";

#if DISPLAYS_WIDE == 1

// ============================================================
// DISPLAYS_WIDE == 1 (32x16): 1 PANEL
// ============================================================
static Mode4SlideType m4Slide = M4_SLIDE_CLOCK;
static M4AnimState m4AnimState = M4_ANIM_IN;
static unsigned long m4Timer = 0;

static int m4JamX = -14;
static int m4MenitY = -9;
static int m4DetikY = 17;

static int m4TopY = -9;
static int m4BottomY = 17;
static int m4TeksCount = 0;

void renderM4SplitSlide(const String &topText, const String &bottomText) {
  Disp.setFont(DejaVuSansBold9);
  int lebarTop = topText.length() * 5;
  int xTop = (panjang_layar - lebarTop) / 2 - 1;
  Disp.drawText(xTop, m4TopY, topText);

  int lebarBottom = bottomText.length() * 5;
  int xBottom = (panjang_layar - lebarBottom) / 2 - 1;
  Disp.drawText(xBottom, m4BottomY, bottomText);

  if (m4AnimState == M4_ANIM_IN) {
    if (m4TopY < 0) m4TopY++;
    if (m4BottomY > 8) m4BottomY--;

    if (m4TopY >= 0 && m4BottomY <= 8) {
      m4TopY = 0;
      m4BottomY = 8;
      m4AnimState = M4_ANIM_HOLD;
      m4Timer = millis();
    }
  } else if (m4AnimState == M4_ANIM_HOLD) {
    m4TopY = 0;
    m4BottomY = 8;
    if (millis() - m4Timer >= 2500) { // 2.5 Detik
      m4AnimState = M4_ANIM_OUT;
    }
  } else if (m4AnimState == M4_ANIM_OUT) {
    if (m4TopY > -9) m4TopY--;
    if (m4BottomY < 17) m4BottomY++;

    if (m4TopY <= -9 && m4BottomY >= 17) {
      m4TopY = -9;
      m4BottomY = 17;
      m4AnimState = M4_ANIM_IN;
      m4Slide = (Mode4SlideType)((int)m4Slide + 1);
      if (m4Slide == M4_SLIDE_TEKS) {
        posisi_X = panjang_layar;
        m4TeksCount = 0;
      }
    }
  }
}

void renderSlide1Clock(const String &stringJam, const String &stringMenit, const String &stringDetik) {
  Disp.setFont(ElektronMart6x16);
  Disp.drawText(m4JamX, 0, stringJam);

  Disp.setFont(DejaVuSansBold9);
  Disp.drawText(18, m4MenitY, stringMenit);
  Disp.drawText(18, m4DetikY, stringDetik);

  if (m4AnimState == M4_ANIM_IN) {
    if (m4JamX < 1) m4JamX++;
    if (m4MenitY < -1) m4MenitY++;
    if (m4DetikY > 8) m4DetikY--;

    if (m4JamX >= 1 && m4MenitY >= -1 && m4DetikY <= 8) {
      m4JamX = 1;
      m4MenitY = -1;
      m4DetikY = 8;
      m4AnimState = M4_ANIM_HOLD;
      m4Timer = millis();
    }
  } else if (m4AnimState == M4_ANIM_HOLD) {
    m4JamX = 1;
    m4MenitY = -1;
    m4DetikY = 8;
    if (millis() - m4Timer >= 5000) { // Tahan 5 detik
      m4AnimState = M4_ANIM_OUT;
    }
  } else if (m4AnimState == M4_ANIM_OUT) {
    if (m4JamX > -14) m4JamX--;
    if (m4MenitY > -9) m4MenitY--;
    if (m4DetikY < 17) m4DetikY++;

    if (m4JamX <= -14 && m4MenitY <= -9 && m4DetikY >= 17) {
      m4JamX = -14;
      m4MenitY = -9;
      m4DetikY = 17;
      m4TopY = -9;
      m4BottomY = 17;
      m4AnimState = M4_ANIM_IN;
      m4Slide = M4_SLIDE_DATE;
    }
  }
}

void renderSlide2Date(int hr, int bl, int th) {
  int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
  int bulanValid = (bl >= 1 && bl <= 12) ? bl : 11;
  String strHari = NAMA_HARI[hariIdx];
  String strTanggal = String(hr) + NAMA_BULAN_CAPS[bulanValid];
  renderM4SplitSlide(strHari, strTanggal);
}

void renderSlide3to7Sholat(int hr, int bl, int th) {
  String jSubuh, jZuhur, jAsar, jMagrib, jIsya;
  hitung5WaktuSholat(th, bl, hr, timezone_offset, jSubuh, jZuhur, jAsar, jMagrib, jIsya);

  String sholatLabel = "";
  String sholatTime = "";

  switch (m4Slide) {
    case M4_SLIDE_SUBUH:
      sholatLabel = "Subuh";
      sholatTime = jSubuh;
      break;
    case M4_SLIDE_ZUHUR: {
      int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
      sholatLabel = (hariIdx == 5) ? "Jum'at" : "Zuhur";
      sholatTime = jZuhur;
      break;
    }
    case M4_SLIDE_ASAR:
      sholatLabel = "Asar";
      sholatTime = jAsar;
      break;
    case M4_SLIDE_MAGRIB:
      sholatLabel = "Magrib";
      sholatTime = jMagrib;
      break;
    case M4_SLIDE_ISYA:
      sholatLabel = "ISYA";
      sholatTime = jIsya;
      break;
    default:
      break;
  }

  renderM4SplitSlide(sholatLabel, sholatTime);
}

void renderSlide8Teks() {
  int panjang_teks_px = teks_berjalan.length() * 7;

  if (m4AnimState != M4_ANIM_DELAY) {
    Disp.setFont(ElektronMart6x12);
    Disp.drawText(posisi_X, 2, teks_berjalan);
    posisi_X--;

    if (posisi_X < -panjang_teks_px) {
      m4AnimState = M4_ANIM_DELAY;
      m4Timer = millis();
      m4TeksCount++;
    }
  } else {
    // Delay 300 ms setelah selesai tampil
    if (millis() - m4Timer >= 300) {
      if (m4TeksCount < 2) {
        // Tampilkan lagi (total minimal 2 kali)
        posisi_X = panjang_layar;
        m4AnimState = M4_ANIM_IN;
      } else {
        // Sudah tampil setidaknya 2 kali, kembali ke Slide 1
        m4TeksCount = 0;
        m4Slide = M4_SLIDE_CLOCK;
        m4AnimState = M4_ANIM_IN;
        m4JamX = -14;
        m4MenitY = -9;
        m4DetikY = 17;
      }
    }
  }
}

#elif DISPLAYS_WIDE == 2

// ============================================================
// DISPLAYS_WIDE == 2 (64x16): SPLIT DUAL PANEL
// ============================================================
enum M4Wide2State {
  W2_SLIDE1_ACTIVE,
  W2_SLIDE1_OUT,
  W2_SLIDE2_IN,
  W2_SLIDE2_HOLD,
  W2_SLIDE2_OUT
};

enum AnimasiInfoState {
  INFO_SLIDE_IN,
  INFO_HOLD,
  INFO_SLIDE_OUT
};

static M4Wide2State statusWide2 = W2_SLIDE1_ACTIVE;
static unsigned long waktuMulaiSlide1_W2 = 0;
static unsigned long waktuHoldSlide2_W2 = 0;

static int teksCycleCount_W2 = 0;
static int infoCycleCount_W2 = 0;

// Animasi InfoAtas
static AnimasiInfoState statusAnimInfo_W2 = INFO_SLIDE_IN;
static int curY_Info_W2 = -8;
static unsigned long waktuHoldInfo_W2 = 0;
static int indexSlideInfo_W2 = 0;

static int curClockX_W2 = 1;
static int curClockJamY_W2 = 0;
static int curClockMenitY_W2 = 8;
static int curTeksY_W2 = 7;
static int curClockFullY_W2 = -16;

void updateAnimasiInfo_W2() {
  if (statusAnimInfo_W2 == INFO_SLIDE_IN) {
    curY_Info_W2++;
    if (curY_Info_W2 >= 0) {
      curY_Info_W2 = 0;
      statusAnimInfo_W2 = INFO_HOLD;
      waktuHoldInfo_W2 = millis();
    }
  } else if (statusAnimInfo_W2 == INFO_HOLD) {
    curY_Info_W2 = 0;
    if (millis() - waktuHoldInfo_W2 >= 2500) { // 2.5 Detik
      statusAnimInfo_W2 = INFO_SLIDE_OUT;
    }
  } else if (statusAnimInfo_W2 == INFO_SLIDE_OUT) {
    curY_Info_W2--;
    if (curY_Info_W2 <= -8) {
      curY_Info_W2 = -8;
      indexSlideInfo_W2 = (indexSlideInfo_W2 + 1) % 12;
      if (indexSlideInfo_W2 == 0) {
        infoCycleCount_W2++;
      }
      statusAnimInfo_W2 = INFO_SLIDE_IN;
    }
  }
}

void renderInfoAtas_W2(int hr, int bl, int th, int baseY) {
  updateAnimasiInfo_W2();

  String jSubuh, jZuhur, jAsar, jMagrib, jIsya;
  hitung5WaktuSholat(th, bl, hr, timezone_offset, jSubuh, jZuhur, jAsar, jMagrib, jIsya);

  Disp.setFont(DejaVuSansBold9);
  auto drawCenteredW2 = [&](int yOffset, const String &teks) {
    int lebar = teks.length() * 5;
    int xCentered = 15 + ((49 - lebar) / 2);
    if (xCentered < 15) xCentered = 15;
    Disp.drawText(xCentered, yOffset, teks);
  };

  int renderY = curY_Info_W2 + baseY;

  switch (indexSlideInfo_W2) {
    case 0: {
      int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
      drawCenteredW2(renderY, NAMA_HARI[hariIdx]);
      break;
    }
    case 1: {
      String strTgl = String(hr) + NAMA_BULAN_CAPS[(bl >= 1 && bl <= 12) ? bl : 11];
      drawCenteredW2(renderY, strTgl);
      break;
    }
    case 2:
      drawCenteredW2(renderY, "Subuh");
      break;
    case 3:
      drawCenteredW2(renderY, jSubuh);
      break;
    case 4: {
      int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
      drawCenteredW2(renderY, (hariIdx == 5) ? "Jum'at" : "Zuhur");
      break;
    }
    case 5:
      drawCenteredW2(renderY, jZuhur);
      break;
    case 6:
      drawCenteredW2(renderY, "Asar");
      break;
    case 7:
      drawCenteredW2(renderY, jAsar);
      break;
    case 8:
      drawCenteredW2(renderY, "Magrib");
      break;
    case 9:
      drawCenteredW2(renderY, jMagrib);
      break;
    case 10:
      drawCenteredW2(renderY, "ISYA");
      break;
    case 11:
      drawCenteredW2(renderY, jIsya);
      break;
    default:
      indexSlideInfo_W2 = 0;
      break;
  }
}

#else // DISPLAYS_WIDE == 3

// ============================================================
// DISPLAYS_WIDE == 3 (96x16): 3 PANEL WIDESCREEN
// ============================================================
enum M4Wide3State {
  W3_SLIDE1_ACTIVE,
  W3_SLIDE1_OUT,
  W3_SLIDE2_IN,
  W3_SLIDE2_HOLD,
  W3_SLIDE2_OUT
};

enum AnimasiInfoState3 {
  INFO3_SLIDE_IN,
  INFO3_HOLD,
  INFO3_SLIDE_OUT
};

static M4Wide3State statusWide3 = W3_SLIDE1_ACTIVE;
static unsigned long waktuMulaiSlide1_W3 = 0;
static unsigned long waktuHoldSlide2_W3 = 0;

static int teksCycleCount_W3 = 0;
static int infoCycleCount_W3 = 0;

static AnimasiInfoState3 statusAnimInfo_W3 = INFO3_SLIDE_IN;
static int curY_Info_W3 = -8;
static unsigned long waktuHoldInfo_W3 = 0;
static int indexSlideInfo_W3 = 0;

static int curClockP1_X_W3 = 1;
static int curInfoP23_Y_W3 = 0;
static int curTeksP23_Y_W3 = 7;
static int curClockFullY_W3 = -16;

void updateAnimasiInfo_W3() {
  if (statusAnimInfo_W3 == INFO3_SLIDE_IN) {
    curY_Info_W3++;
    if (curY_Info_W3 >= 0) {
      curY_Info_W3 = 0;
      statusAnimInfo_W3 = INFO3_HOLD;
      waktuHoldInfo_W3 = millis();
    }
  } else if (statusAnimInfo_W3 == INFO3_HOLD) {
    curY_Info_W3 = 0;
    if (millis() - waktuHoldInfo_W3 >= 2500) {
      statusAnimInfo_W3 = INFO3_SLIDE_OUT;
    }
  } else if (statusAnimInfo_W3 == INFO3_SLIDE_OUT) {
    curY_Info_W3--;
    if (curY_Info_W3 <= -8) {
      curY_Info_W3 = -8;
      indexSlideInfo_W3 = (indexSlideInfo_W3 + 1) % 12;
      if (indexSlideInfo_W3 == 0) {
        infoCycleCount_W3++;
      }
      statusAnimInfo_W3 = INFO3_SLIDE_IN;
    }
  }
}

void renderInfoAtas_W3(int hr, int bl, int th, int baseY) {
  updateAnimasiInfo_W3();

  String jSubuh, jZuhur, jAsar, jMagrib, jIsya;
  hitung5WaktuSholat(th, bl, hr, timezone_offset, jSubuh, jZuhur, jAsar, jMagrib, jIsya);

  Disp.setFont(DejaVuSansBold9);
  auto drawCenteredW3 = [&](int yOffset, const String &teks) {
    int lebar = teks.length() * 5;
    int xCentered = 32 + ((64 - lebar) / 2);
    if (xCentered < 32) xCentered = 32;
    Disp.drawText(xCentered, yOffset, teks);
  };

  int renderY = curY_Info_W3 + baseY;

  switch (indexSlideInfo_W3) {
    case 0: {
      int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
      drawCenteredW3(renderY, NAMA_HARI[hariIdx]);
      break;
    }
    case 1: {
      String strTgl = String(hr) + NAMA_BULAN_CAPS[(bl >= 1 && bl <= 12) ? bl : 11];
      drawCenteredW3(renderY, strTgl);
      break;
    }
    case 2:
      drawCenteredW3(renderY, "Subuh");
      break;
    case 3:
      drawCenteredW3(renderY, jSubuh);
      break;
    case 4: {
      int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
      drawCenteredW3(renderY, (hariIdx == 5) ? "Jum'at" : "Zuhur");
      break;
    }
    case 5:
      drawCenteredW3(renderY, jZuhur);
      break;
    case 6:
      drawCenteredW3(renderY, "Asar");
      break;
    case 7:
      drawCenteredW3(renderY, jAsar);
      break;
    case 8:
      drawCenteredW3(renderY, "Magrib");
      break;
    case 9:
      drawCenteredW3(renderY, jMagrib);
      break;
    case 10:
      drawCenteredW3(renderY, "ISYA");
      break;
    case 11:
      drawCenteredW3(renderY, jIsya);
      break;
    default:
      indexSlideInfo_W3 = 0;
      break;
  }
}

#endif

bool periksaDanJalankanAlertSholat(int j, int m, int hr, int bl, int th) {
  // 1. Jika fase running text alert aktif (2 menit)
  if (statusAlertSholat == ALERT_RUNNING_TEKS) {
    if (millis() - waktuMulaiAlertSholat >= 120000UL) { // 2 menit
      statusAlertSholat = ALERT_CLEAR_LAYAR;
      waktuMulaiAlertSholat = millis();
      Disp.clear();
      return true;
    }

    Disp.setFont(ElektronMart6x12);
    Disp.drawText(posisi_X_alert, 0, pesanAlertSholat);
    posisi_X_alert--;
    int panjang_alert_px = pesanAlertSholat.length() * 6;
    if (posisi_X_alert < -panjang_alert_px) {
      posisi_X_alert = panjang_layar;
    }
    return true;
  }
  // 2. Jika fase clear layar aktif (5 menit)
  else if (statusAlertSholat == ALERT_CLEAR_LAYAR) {
    Disp.clear();
    if (millis() - waktuMulaiAlertSholat >= 300000UL) { // 5 menit
      statusAlertSholat = ALERT_INAKTIF;
#if DISPLAYS_WIDE == 1
      m4Slide = M4_SLIDE_CLOCK;
      m4AnimState = M4_ANIM_IN;
      m4JamX = -14;
      m4MenitY = -9;
      m4DetikY = 17;
#elif DISPLAYS_WIDE == 2
      statusWide2 = W2_SLIDE1_ACTIVE;
      waktuMulaiSlide1_W2 = millis();
      teksCycleCount_W2 = 0;
      infoCycleCount_W2 = 0;
      curClockX_W2 = 1;
      curClockJamY_W2 = 0;
      curClockMenitY_W2 = 8;
      curTeksY_W2 = 7;
#else
      statusWide3 = W3_SLIDE1_ACTIVE;
      waktuMulaiSlide1_W3 = millis();
      teksCycleCount_W3 = 0;
      infoCycleCount_W3 = 0;
      curClockP1_X_W3 = 1;
      curInfoP23_Y_W3 = 0;
      curTeksP23_Y_W3 = 7;
#endif
      return false;
    }
    return true;
  }

  // 3. Evaluasi apakah Waktu saat ini persis sama dengan salah satu Waktu Sholat (Format 24 jam)
  String waktuSekarang = duaDigit(j) + ":" + duaDigit(m);
  String jSubuh, jZuhur, jAsar, jMagrib, jIsya;
  hitung5WaktuSholat(th, bl, hr, timezone_offset, jSubuh, jZuhur, jAsar, jMagrib, jIsya);

  String namaSholat = "";
  if (waktuSekarang == jSubuh) {
    namaSholat = "Subuh";
  } else if (waktuSekarang == jZuhur) {
    int hariIdx = hitungHariDalamSeminggu(th, bl, hr);
    namaSholat = (hariIdx == 5) ? "Jum'at" : "Zuhur";
  } else if (waktuSekarang == jAsar) {
    namaSholat = "Asar";
  } else if (waktuSekarang == jMagrib) {
    namaSholat = "Magrib";
  } else if (waktuSekarang == jIsya) {
    namaSholat = "ISYA";
  }

  if (namaSholat != "") {
    String alertKey = namaSholat + "_" + String(hr) + "_" + String(bl);
    if (lastAlertSholatHari != alertKey) {
      lastAlertSholatHari = alertKey;
      pesanAlertSholat = "Sekarang Sudah Memasuki Waktu " + namaSholat + ".";
      statusAlertSholat = ALERT_RUNNING_TEKS;
      waktuMulaiAlertSholat = millis();
      posisi_X_alert = panjang_layar;
      return true;
    }
  }

  return false;
}

void tampilkanMode4(int j, int m, int d, int hr, int bl, int th) {
  // Jika sedang masa alert sholat (2 menit teks + 5 menit clear), tampilkan alert
  if (periksaDanJalankanAlertSholat(j, m, hr, bl, th)) {
    return;
  }

  String stringJam = duaDigit(j);
  String stringMenit = duaDigit(m);
  String stringDetik = duaDigit(d);

#if DISPLAYS_WIDE == 1

  if (m4Slide == M4_SLIDE_CLOCK) {
    renderSlide1Clock(stringJam, stringMenit, stringDetik);
  } else if (m4Slide == M4_SLIDE_DATE) {
    renderSlide2Date(hr, bl, th);
  } else if (m4Slide >= M4_SLIDE_SUBUH && m4Slide <= M4_SLIDE_ISYA) {
    renderSlide3to7Sholat(hr, bl, th);
  } else if (m4Slide == M4_SLIDE_TEKS) {
    renderSlide8Teks();
  }

#elif DISPLAYS_WIDE == 2

  if (waktuMulaiSlide1_W2 == 0) waktuMulaiSlide1_W2 = millis();

  if (statusWide2 == W2_SLIDE1_ACTIVE) {
    // 1. Tampilkan running text di baris bawah kanan
    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(posisi_X, curTeksY_W2, teks_berjalan);
    posisi_X--;
    int p_teks = teks_berjalan.length() * 6;
    if (posisi_X < 15 - p_teks) {
      posisi_X = panjang_layar;
      teksCycleCount_W2++;
    }

    // 2. Tampilkan InfoAtas di baris atas kanan (Hari, Tanggal, Sholat)
    renderInfoAtas_W2(hr, bl, th, 0);

    // 3. Mask area jam kiri dan gambar jam vertikal
    Disp.drawText(0, 0, "   ");
    Disp.drawText(0, 8, "   ");
    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(curClockX_W2, curClockJamY_W2, stringJam);
    Disp.drawText(curClockX_W2, curClockMenitY_W2, stringMenit);

    // Cek syarat pindah slide: minimal 40 detik dan teks serta InfoAtas sudah tampil setidaknya 2x
    if (millis() - waktuMulaiSlide1_W2 >= 40000UL && teksCycleCount_W2 >= 2 && infoCycleCount_W2 >= 2) {
      statusWide2 = W2_SLIDE1_OUT;
    }
  }
  else if (statusWide2 == W2_SLIDE1_OUT) {
    curClockX_W2--;
    curTeksY_W2++;
    curY_Info_W2--;

    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(posisi_X, curTeksY_W2, teks_berjalan);
    renderInfoAtas_W2(hr, bl, th, 0);

    Disp.drawText(0, 0, "   ");
    Disp.drawText(0, 8, "   ");
    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(curClockX_W2, curClockJamY_W2, stringJam);
    Disp.drawText(curClockX_W2, curClockMenitY_W2, stringMenit);

    if (curClockX_W2 < -16 && curTeksY_W2 > 16 && curY_Info_W2 < -9) {
      statusWide2 = W2_SLIDE2_IN;
      curClockFullY_W2 = -16;
    }
  }
  else if (statusWide2 == W2_SLIDE2_IN) {
    curClockFullY_W2++;
    String jamFull = stringJam + ":" + stringMenit + ":" + stringDetik;
    Disp.setFont(ElektronMart6x16);
    int xClock = (panjang_layar - (jamFull.length() * 6)) / 2;
    Disp.drawText(xClock, curClockFullY_W2, jamFull);

    if (curClockFullY_W2 >= 0) {
      curClockFullY_W2 = 0;
      statusWide2 = W2_SLIDE2_HOLD;
      waktuHoldSlide2_W2 = millis();
    }
  }
  else if (statusWide2 == W2_SLIDE2_HOLD) {
    String jamFull = stringJam + ":" + stringMenit + ":" + stringDetik;
    Disp.setFont(ElektronMart6x16);
    int xClock = (panjang_layar - (jamFull.length() * 6)) / 2;
    Disp.drawText(xClock, 0, jamFull);

    if (millis() - waktuHoldSlide2_W2 >= 15000UL) { // 15 detik
      statusWide2 = W2_SLIDE2_OUT;
    }
  }
  else if (statusWide2 == W2_SLIDE2_OUT) {
    curClockFullY_W2++;
    String jamFull = stringJam + ":" + stringMenit + ":" + stringDetik;
    Disp.setFont(ElektronMart6x16);
    int xClock = (panjang_layar - (jamFull.length() * 6)) / 2;
    Disp.drawText(xClock, curClockFullY_W2, jamFull);

    if (curClockFullY_W2 > 16) {
      statusWide2 = W2_SLIDE1_ACTIVE;
      waktuMulaiSlide1_W2 = millis();
      teksCycleCount_W2 = 0;
      infoCycleCount_W2 = 0;
      posisi_X = panjang_layar;
      curClockX_W2 = 1;
      curClockJamY_W2 = 0;
      curClockMenitY_W2 = 8;
      curTeksY_W2 = 7;
      curY_Info_W2 = -8;
      statusAnimInfo_W2 = INFO_SLIDE_IN;
    }
  }

#else // DISPLAYS_WIDE == 3

  if (waktuMulaiSlide1_W3 == 0) waktuMulaiSlide1_W3 = millis();

  if (statusWide3 == W3_SLIDE1_ACTIVE) {
    // 1. Panel 2 & 3: Tampilkan running text di baris bawah (Y = 9)
    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(posisi_X, curTeksP23_Y_W3, teks_berjalan);
    posisi_X--;
    int p_teks = teks_berjalan.length() * 5;
    if (posisi_X < 32 - p_teks) {
      posisi_X = panjang_layar;
      teksCycleCount_W3++;
    }

    // 2. Panel 2 & 3: Tampilkan InfoAtas di baris atas (Y = 0)
    renderInfoAtas_W3(hr, bl, th, 0);

    // 3. Panel 1: Tampilkan Jam konfigurasi DISPLAYS_WIDE 1
    Disp.setFont(ElektronMart6x16);
    Disp.drawText(curClockP1_X_W3, 0, stringJam);
    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(curClockP1_X_W3 + 17, -1, stringMenit);
    Disp.drawText(curClockP1_X_W3 + 17, 8, stringDetik);

    if (millis() - waktuMulaiSlide1_W3 >= 40000UL && teksCycleCount_W3 >= 2 && infoCycleCount_W3 >= 2) {
      statusWide3 = W3_SLIDE1_OUT;
    }
  }
  else if (statusWide3 == W3_SLIDE1_OUT) {
    curClockP1_X_W3--;
    curTeksP23_Y_W3++;
    curY_Info_W3--;

    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(posisi_X, curTeksP23_Y_W3, teks_berjalan);
    renderInfoAtas_W3(hr, bl, th, 0);

    Disp.setFont(ElektronMart6x16);
    Disp.drawText(curClockP1_X_W3, 0, stringJam);
    Disp.setFont(DejaVuSansBold9);
    Disp.drawText(curClockP1_X_W3 + 17, -1, stringMenit);
    Disp.drawText(curClockP1_X_W3 + 17, 8, stringDetik);

    if (curClockP1_X_W3 < -32 && curTeksP23_Y_W3 > 16 && curY_Info_W3 < -9) {
      statusWide3 = W3_SLIDE2_IN;
      curClockFullY_W3 = -16;
    }
  }
  else if (statusWide3 == W3_SLIDE2_IN) {
    curClockFullY_W3++;
    String jamFull = stringJam + ":" + stringMenit + ":" + stringDetik;
    Disp.setFont(ElektronMart6x16);
    int xClock = (panjang_layar - (jamFull.length() * 6)) / 2;
    Disp.drawText(xClock, curClockFullY_W3, jamFull);

    if (curClockFullY_W3 >= 0) {
      curClockFullY_W3 = 0;
      statusWide3 = W3_SLIDE2_HOLD;
      waktuHoldSlide2_W3 = millis();
    }
  }
  else if (statusWide3 == W3_SLIDE2_HOLD) {
    String jamFull = stringJam + ":" + stringMenit + ":" + stringDetik;
    Disp.setFont(ElektronMart6x16);
    int xClock = (panjang_layar - (jamFull.length() * 6)) / 2;
    Disp.drawText(xClock, 0, jamFull);

    if (millis() - waktuHoldSlide2_W3 >= 15000UL) {
      statusWide3 = W3_SLIDE2_OUT;
    }
  }
  else if (statusWide3 == W3_SLIDE2_OUT) {
    curClockFullY_W3++;
    String jamFull = stringJam + ":" + stringMenit + ":" + stringDetik;
    Disp.setFont(ElektronMart6x16);
    int xClock = (panjang_layar - (jamFull.length() * 6)) / 2;
    Disp.drawText(xClock, curClockFullY_W3, jamFull);

    if (curClockFullY_W3 > 16) {
      statusWide3 = W3_SLIDE1_ACTIVE;
      waktuMulaiSlide1_W3 = millis();
      teksCycleCount_W3 = 0;
      infoCycleCount_W3 = 0;
      posisi_X = panjang_layar;
      curClockP1_X_W3 = 1;
      curInfoP23_Y_W3 = 0;
      curTeksP23_Y_W3 = =7;
      curY_Info_W3 = -8;
      statusAnimInfo_W3 = INFO3_SLIDE_IN;
    }
  }

#endif
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

    if (bulan < 1 || bulan > 12) bulan = internalBulan;
    if (hari < 1 || hari > 31) hari = internalHari;
    if (tahun < 2020) tahun = internalTahun;
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
    hari  = internalHari;
    bulan = internalBulan;
    tahun = internalTahun;
  }
}



// ============================================================
// SECTION 8: TICKER P10 REFRESH
// Background timer yang me-refresh tampilan P10 setiap 2ms.
// ============================================================
Ticker timerP10;

void refreshP10() {
  Disp.loop();

  // Jika kecerahan 0 atau mode tidur malam aktif, bersihkan dan keluar
  if (tingkat_kecerahan <= 0 || isNightModeSleep) {
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
      String stringJam = duaDigit(j);
      String stringMenit = duaDigit(m);
      String stringDetik = duaDigit(d);

      // ---- Mode 1: Teks Berjalan ke Kiri ----
      if (mode_tampilan == 1) {
        Disp.setFont(ElektronMart6x12);
        Disp.drawText(posisi_X, 2, teks_berjalan);
        int panjang_teks = teks_berjalan.length() * 6;
        posisi_X--;
        if (posisi_X < -panjang_teks) posisi_X = panjang_layar;
      }
      // ---- Mode 2: Teks Diam di Tengah (Statis) ----
      else if (mode_tampilan == 2) {
        Disp.setFont(ElektronMart6x12);
        int panjang_teks = teks_berjalan.length() * 6;
        int tengah_X = (panjang_layar - panjang_teks) / 2;
        Disp.drawText(tengah_X, 2, teks_berjalan);
      }
      // ---- Mode 3: Teks Berjalan ke Kanan ----
      else if (mode_tampilan == 3) {
        Disp.setFont(ElektronMart6x12);
        Disp.drawText(posisi_X, 2, teks_berjalan);
        int panjang_teks = teks_berjalan.length() * 6;
        posisi_X++;
        if (posisi_X > panjang_layar) posisi_X = -panjang_teks;
      }
      // ---- Mode 4: Slideshow Informasi Multi-Slide ----
      else if (mode_tampilan == 4) {
        tampilkanMode4(j, m, d, hr, bl, th);
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

  Serial.print("Pesan Masuk [");
  Serial.print(topic);
  Serial.printf("] (%u bytes)\n", length);

  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, payload, length);

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
      posisi_X = panjang_layar - 1; // Reset posisi ke awal
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
      if (mode_tampilan == 4) {
#if DISPLAYS_WIDE == 1
        m4Slide = M4_SLIDE_CLOCK;
        m4AnimState = M4_ANIM_IN;
        m4JamX = -14;
        m4MenitY = -9;
        m4DetikY = 17;
        m4TeksCount = 0;
#elif DISPLAYS_WIDE == 2
        statusWide2 = W2_SLIDE1_ACTIVE;
        waktuMulaiSlide1_W2 = millis();
        teksCycleCount_W2 = 0;
        infoCycleCount_W2 = 0;
        curClockX_W2 = 1;
        curClockJamY_W2 = 0;
        curClockMenitY_W2 = 8;
        curTeksY_W2 = 7;
#else
        statusWide3 = W3_SLIDE1_ACTIVE;
        waktuMulaiSlide1_W3 = millis();
        teksCycleCount_W3 = 0;
        infoCycleCount_W3 = 0;
        curClockP1_X_W3 = 1;
        curInfoP23_Y_W3 = 0;
        curTeksP23_Y_W3 = 7;
#endif
        statusAlertSholat = ALERT_INAKTIF;
      }
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
            internalTahun = th;
            internalBulan = bl;
            internalHari  = hr;
          }
        }

        if (rtcDitemukan) {
          rtc.adjust(DateTime(th, bl, hr, j, m, d));
          Serial.printf("RTC Disinkronkan: %04d-%02d-%02d %02d:%02d:%02d\n", th, bl, hr, j, m, d);
        } else {
          detikWaktuInternal = (unsigned long)j * 3600 + (unsigned long)m * 60 + d;
          millisSebelumnya   = millis();
          internalTahun = th;
          internalBulan = bl;
          internalHari  = hr;
          Serial.printf("Jam Internal Disinkronkan: %04d-%02d-%02d %02d:%02d:%02d\n", th, bl, hr, j, m, d);
        }
      }
    }

    // ---- 7. Update Jadwal & Efisiensi Energi ----
    bool isUpdateJadwal = (doc.containsKey("cmd") && doc["cmd"].as<String>() == "update_jadwal") ||
                          (doc.containsKey("action") && doc["action"].as<String>() == "update_jadwal");

    if (isUpdateJadwal) {
      // 1. Read Efficiency
      if (doc.containsKey("efisiensi")) {
        JsonObject eff = doc["efisiensi"];
        String t = eff["tidur"] | "22:00";
        String b = eff["bangun"] | "04:00";
        jamTidur = t.substring(0, 2).toInt();
        menitTidur = t.substring(3, 5).toInt();
        jamBangun = b.substring(0, 2).toInt();
        menitBangun = b.substring(3, 5).toInt();
        kecerahanMalam = eff["kecerahan_malam"] | 1;
        autoSleep = eff["auto_sleep"] | false;
        efisiensiAktif = true;
      }

      // 2. Baca jadwal-jadwal terpisah: jadwal1 s/d jadwal10
      bool adaJadwalTerpisah = false;
      for (int i = 1; i <= MAX_JADWAL; i++) {
        String key = "jadwal" + String(i);
        if (doc.containsKey(key) && doc[key].is<JsonObject>()) {
          adaJadwalTerpisah = true;
          JsonObject item = doc[key];
          int idx = i - 1;

          String m = item["mulai"] | "00:00";
          String s = item["selesai"] | "00:00";
          String msg = item["pesan"] | "";

          int idxColonM = m.indexOf(':');
          int idxColonS = s.indexOf(':');

          daftarJadwal[idx].nama = item["nama"] | ("Jadwal " + String(i));
          daftarJadwal[idx].jamMulai = (idxColonM != -1) ? m.substring(0, idxColonM).toInt() : 0;
          daftarJadwal[idx].menitMulai = (idxColonM != -1) ? m.substring(idxColonM + 1).toInt() : 0;
          daftarJadwal[idx].jamSelesai = (idxColonS != -1) ? s.substring(0, idxColonS).toInt() : 0;
          daftarJadwal[idx].menitSelesai = (idxColonS != -1) ? s.substring(idxColonS + 1).toInt() : 0;
          daftarJadwal[idx].pesan = msg;

          Serial.printf("--> [Terpisah] Slot #%d [%s]: %02d:%02d to %02d:%02d -> Msg: '%s'\n",
                        i,
                        daftarJadwal[idx].nama.c_str(),
                        daftarJadwal[idx].jamMulai,
                        daftarJadwal[idx].menitMulai,
                        daftarJadwal[idx].jamSelesai,
                        daftarJadwal[idx].menitSelesai,
                        daftarJadwal[idx].pesan.c_str());
        }
      }

      if (adaJadwalTerpisah) {
        jumlahJadwal = MAX_JADWAL;
      } else if (doc.containsKey("jadwal") && doc["jadwal"].is<JsonArray>()) {
        // 3. Fallback: Baca Array Jadwal
        jumlahJadwal = 0;
        JsonArray arr = doc["jadwal"].as<JsonArray>();
        
        for (JsonVariant v : arr) {
          if (!v.is<JsonObject>()) continue;
          JsonObject item = v.as<JsonObject>();

          if (jumlahJadwal < MAX_JADWAL) {
            String m = item["mulai"] | "00:00";
            String s = item["selesai"] | "00:00";
            String msg = item["pesan"] | "";

            int idxColonM = m.indexOf(':');
            int idxColonS = s.indexOf(':');

            daftarJadwal[jumlahJadwal].nama = item["nama"] | ("Jadwal " + String(jumlahJadwal + 1));
            daftarJadwal[jumlahJadwal].jamMulai = (idxColonM != -1) ? m.substring(0, idxColonM).toInt() : 0;
            daftarJadwal[jumlahJadwal].menitMulai = (idxColonM != -1) ? m.substring(idxColonM + 1).toInt() : 0;
            daftarJadwal[jumlahJadwal].jamSelesai = (idxColonS != -1) ? s.substring(0, idxColonS).toInt() : 0;
            daftarJadwal[jumlahJadwal].menitSelesai = (idxColonS != -1) ? s.substring(idxColonS + 1).toInt() : 0;
            daftarJadwal[jumlahJadwal].pesan = msg;

            Serial.printf("--> Slot #%d [%s]: %02d:%02d to %02d:%02d -> Msg: '%s'\n",
                          jumlahJadwal + 1,
                          daftarJadwal[jumlahJadwal].nama.c_str(),
                          daftarJadwal[jumlahJadwal].jamMulai,
                          daftarJadwal[jumlahJadwal].menitMulai,
                          daftarJadwal[jumlahJadwal].jamSelesai,
                          daftarJadwal[jumlahJadwal].menitSelesai,
                          daftarJadwal[jumlahJadwal].pesan.c_str());

            jumlahJadwal++;
          }
        }
      }
      Serial.printf("Jadwal updated successfully! Total slot: %d\n", jumlahJadwal);
    }
    teksSedangDiupdate = false;

    // Simpan ke Flash LittleFS terpisah agar tidak saling menimpa
    if (isUpdateJadwal) {
      File f = LittleFS.open("/jadwal.json", "w");
      if (f) {
        serializeJson(doc, f);
        f.close();
        Serial.println("Jadwal & Efisiensi disimpan ke LittleFS (/jadwal.json).");
      }
    } else {
      File f = LittleFS.open("/config.json", "w");
      if (f) {
        serializeJson(doc, f);
        f.close();
        Serial.println("Konfigurasi Tampilan disimpan ke LittleFS (/config.json).");
      }
    }
  } else {
    Serial.println("Gagal parse JSON MQTT.");
  }
}

void periksaJadwalDanEfisiensi() {
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck < 1000) return; // Cek setiap 1 detik
  lastCheck = millis();

  int j, m, d, hr, bl, th;
  ambilWaktuSekarang(j, m, d, hr, bl, th);
  int menitSekarang = (j * 60) + m;

  bool adaJadwalAktif = false;
  String pesanJadwalKetemu = "";

  for (int i = 0; i < jumlahJadwal; i++) {
    // Lewati slot jika pesan kosong
    if (daftarJadwal[i].pesan.length() == 0) continue;

    int mulai = (daftarJadwal[i].jamMulai * 60) + daftarJadwal[i].menitMulai;
    int selesai = (daftarJadwal[i].jamSelesai * 60) + daftarJadwal[i].menitSelesai;
    if (mulai == selesai) continue;

    bool aktifSaatIni = false;
    if (mulai <= selesai) {
      aktifSaatIni = (menitSekarang >= mulai && menitSekarang < selesai);
    } else {
      // Jadwal melintasi tengah malam (misal 21:00 sampai 04:00)
      aktifSaatIni = (menitSekarang >= mulai || menitSekarang < selesai);
    }

    if (aktifSaatIni) {
      pesanJadwalKetemu = daftarJadwal[i].pesan;
      adaJadwalAktif = true;
      break; 
    }
  }

  if (adaJadwalAktif) {
    if (teks_berjalan != pesanJadwalKetemu) {
      teks_berjalan = pesanJadwalKetemu;
      posisi_X = panjang_layar;
      kecepatan_scroll = kecepatan_scroll * 1.5;
    }
  } else {
    // Revert to Main Backup Text during gaps or when schedules complete
    if (teksUtamaBackup != "" && teks_berjalan != teksUtamaBackup) {
      teks_berjalan = teksUtamaBackup;
      posisi_X = panjang_layar;
    }
  }

  // 2. EVALUASI EFISIENSI ENERGI (NIGHT MODE)
  if (efisiensiAktif) {
    int menitMulaiTidur = (jamTidur * 60) + menitTidur;
    int menitSelesaiTidur = (jamBangun * 60) + menitBangun;
    bool isMalam = false;

    if (menitMulaiTidur > menitSelesaiTidur) {
      // Lewat tengah malam (misal 22:00 - 05:00)
      isMalam = (menitSekarang >= menitMulaiTidur || menitSekarang < menitSelesaiTidur);
    } else {
      isMalam = (menitSekarang >= menitMulaiTidur && menitSekarang < menitSelesaiTidur);
    }

    if (isMalam) {
      if (autoSleep) {
        isNightModeSleep = true;
        Disp.setBrightness(0);
        Disp.clear();
      } else {
        isNightModeSleep = false;
        Disp.setBrightness(kecerahanMalam);
      }
    } else {
      isNightModeSleep = false;
      Disp.setBrightness(tingkat_kecerahan);
    }
  } else {
    isNightModeSleep = false;
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
    // 1. Muat Konfigurasi Tampilan & Jam (/config.json)
    if (LittleFS.exists("/config.json")) {
      File file = LittleFS.open("/config.json", "r");
      if (file) {
        DynamicJsonDocument doc(4096);
        if (!deserializeJson(doc, file)) {
          if (doc.containsKey("teks")) {
            teks_berjalan     = doc["teks"].as<String>();
            teksUtamaBackup   = teks_berjalan;
          }
          if (doc.containsKey("brightness")) tingkat_kecerahan = doc["brightness"];
          if (doc.containsKey("speed"))      kecepatan_scroll  = doc["speed"];
          if (doc.containsKey("mode"))       mode_tampilan     = doc["mode"];
          if (doc.containsKey("timezone"))   timezone_offset   = doc["timezone"];
        }
        file.close();
      }
    }

    // 2. Muat Jadwal & Efisiensi Energi (/jadwal.json atau fallback ke /config.json)
    String fileJadwalPath = LittleFS.exists("/jadwal.json") ? "/jadwal.json" : "/config.json";
    if (LittleFS.exists(fileJadwalPath)) {
      File fileJ = LittleFS.open(fileJadwalPath, "r");
      if (fileJ) {
        DynamicJsonDocument docJ(4096);
        if (!deserializeJson(docJ, fileJ)) {
          if (docJ.containsKey("efisiensi")) {
            JsonObject eff = docJ["efisiensi"];
            String t = eff["tidur"] | "22:00";
            String b = eff["bangun"] | "04:00";
            jamTidur = t.substring(0, 2).toInt();
            menitTidur = t.substring(3, 5).toInt();
            jamBangun = b.substring(0, 2).toInt();
            menitBangun = b.substring(3, 5).toInt();
            kecerahanMalam = eff["kecerahan_malam"] | 1;
            autoSleep = eff["auto_sleep"] | false;
            efisiensiAktif = true;
          }

          bool adaJadwalTerpisah = false;
          for (int i = 1; i <= MAX_JADWAL; i++) {
            String key = "jadwal" + String(i);
            if (docJ.containsKey(key) && docJ[key].is<JsonObject>()) {
              adaJadwalTerpisah = true;
              JsonObject item = docJ[key];
              int idx = i - 1;
              String m = item["mulai"] | "00:00";
              String s = item["selesai"] | "00:00";
              String msg = item["pesan"] | "";
              int idxColonM = m.indexOf(':');
              int idxColonS = s.indexOf(':');
              daftarJadwal[idx].nama = item["nama"] | ("Jadwal " + String(i));
              daftarJadwal[idx].jamMulai = (idxColonM != -1) ? m.substring(0, idxColonM).toInt() : 0;
              daftarJadwal[idx].menitMulai = (idxColonM != -1) ? m.substring(idxColonM + 1).toInt() : 0;
              daftarJadwal[idx].jamSelesai = (idxColonS != -1) ? s.substring(0, idxColonS).toInt() : 0;
              daftarJadwal[idx].menitSelesai = (idxColonS != -1) ? s.substring(idxColonS + 1).toInt() : 0;
              daftarJadwal[idx].pesan = msg;
            }
          }

          if (adaJadwalTerpisah) {
            jumlahJadwal = MAX_JADWAL;
          } else if (docJ.containsKey("jadwal") && docJ["jadwal"].is<JsonArray>()) {
            JsonArray arr = docJ["jadwal"].as<JsonArray>();
            jumlahJadwal = 0;
            for (JsonVariant v : arr) {
              if (!v.is<JsonObject>()) continue;
              JsonObject item = v.as<JsonObject>();
              if (jumlahJadwal < MAX_JADWAL) {
                String m = item["mulai"] | "00:00";
                String s = item["selesai"] | "00:00";
                String msg = item["pesan"] | "";

                int idxColonM = m.indexOf(':');
                int idxColonS = s.indexOf(':');
                daftarJadwal[jumlahJadwal].nama = item["nama"] | ("Jadwal " + String(jumlahJadwal + 1));
                daftarJadwal[jumlahJadwal].jamMulai = (idxColonM != -1) ? m.substring(0, idxColonM).toInt() : 0;
                daftarJadwal[jumlahJadwal].menitMulai = (idxColonM != -1) ? m.substring(idxColonM + 1).toInt() : 0;
                daftarJadwal[jumlahJadwal].jamSelesai = (idxColonS != -1) ? s.substring(0, idxColonS).toInt() : 0;
                daftarJadwal[jumlahJadwal].menitSelesai = (idxColonS != -1) ? s.substring(idxColonS + 1).toInt() : 0;
                daftarJadwal[jumlahJadwal].pesan = msg;
                jumlahJadwal++;
              }
            }
          }
          Serial.printf("Konfigurasi LittleFS dimuat. Jadwal aktif: %d\n", jumlahJadwal);
        }
        fileJ.close();
      }
    }
  }

  // Konfigurasi dan mulai layar P10
  Disp.start();
  Disp.setBrightness(tingkat_kecerahan);
  Disp.setFont(EMSans6x8);
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
    Serial.println("\n[PERINGATAN] WiFi gagal. Periksa SSID/Password di baris 39-40.");
  }

  // Inisialisasi MQTT client (buffer 4096 byte agar mampu menampung paket jadwal lengkap)
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setBufferSize(4096);
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
