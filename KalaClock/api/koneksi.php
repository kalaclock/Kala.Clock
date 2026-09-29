<?php
$host = 'mysql-kalaclock-kalaclock.f.aivencloud.com';      // Contoh: mysql-xxxx.aivencloud.com
$port = 18254;      // Port Aiven (misal: 12345 atau sesuai di Aiven)
$user = 'avnadmin';
$password = 'AVNS_6Tof4kG-EYfIvRdehKR';
$dbname = 'db_iot';          // Menggunakan database db_iot yang lu buat

// Aiven WAJIB menggunakan koneksi SSL
$conn = mysqli_init();
mysqli_ssl_set($conn, NULL, NULL, NULL, NULL, NULL);

// Lakukan koneksi dengan port dan SSL
if (!mysqli_real_connect($conn, $host, $user, $password, $dbname, $port, NULL, MYSQLI_CLIENT_SSL)) {
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'Koneksi Aiven Gagal: ' . mysqli_connect_error()
    ]);
    exit();
}
?>