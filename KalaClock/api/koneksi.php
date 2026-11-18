<?php
// ==========================================================================
// KALA.CLOCK — KONEKSI DATABASE & HELPER GLOBAL (PDO)
// ==========================================================================

// Mulai sesi jika belum aktif
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Konfigurasi Header Response JSON & CORS
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Tangani Preflight Request OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ==========================================================================
// KONFIGURASI KONEKSI DATABASE MYSQL
// Silakan sesuaikan nama host, database, user, dan password dengan server Anda
// ==========================================================================
$db_host = 'localhost';
$db_name = 'KALACLOCK_IOT_DATABASE';
$db_user = 'KALACLOCK_Admin_KalaClock';
$db_pass = 'O4$RL3{@XOjS8d/f';
$db_port = 3306;

try {
    $dsn = "mysql:host={$db_host};port={$db_port};dbname={$db_name};charset=utf8mb4";
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $pdo = new PDO($dsn, $db_user, $db_pass, $options);
} catch (PDOException $e) {
    // Tangani jika database gagal terhubung
    http_response_code(500);
    echo json_encode([
        'status'  => 'offline',
        'success' => false,
        'message' => 'Gagal terhubung ke database: ' . $e->getMessage()
    ]);
    exit();
}

// ==========================================================================
// FUNGSI HELPER GLOBAL
// ==========================================================================

/**
 * Mengirimkan response JSON standar
 */
function jsonOutput($success, $message, $data = null, $httpCode = 200) {
    http_response_code($httpCode);
    echo json_encode([
        'success' => $success,
        'status'  => $success ? 'online' : 'error',
        'message' => $message,
        'data'    => $data
    ]);
    exit();
}

/**
 * Mendapatkan IP Address Pengunjung yang Real
 */
function getClientIP() {
    if (!empty($_SERVER['HTTP_CLIENT_IP'])) {
        return $_SERVER['HTTP_CLIENT_IP'];
    } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        return explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
    } else {
        return $_SERVER['REMOTE_ADDR'] ?? 'UNKNOWN';
    }
}

/**
 * Validasi apakah session admin sedang aktif
 */
function checkAdminAuth() {
    if (empty($_SESSION['kala_admin_logged']) || $_SESSION['kala_admin_logged'] !== true) {
        jsonOutput(false, 'Akses ditolak. Sesi admin belum login atau telah berakhir.', null, 401);
    }
}
