<?php
$host = 'localhost';      // Contoh: mysql-xxxx.aivencloud.com
$user = 'KALACLOCK_Admin_KalaClock';
$password = 'O4$RL3{@XOjS8d/f';
$dbname = 'KALACLOCK_IOT_DATABASE';          // Menggunakan database db_iot yang lu buat

// Koneksi ke database lokal HestiaCP
$conn = mysqli_connect($host, $user, $password, $dbname);

if (!$conn) {
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'Koneksi Database Gagal: ' . mysqli_connect_error()
    ]);
    exit();
}
?>