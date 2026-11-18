<?php
// ==========================================================================
// KALA.CLOCK — API STATUS KONEKSI DATABASE
// Dipanggil secara berkala oleh script.js untuk indikator dotDatabase
// ==========================================================================

require_once __DIR__ . '/koneksi.php';

// Jika file koneksi.php berhasil dipanggil tanpa error PDOException, database berstatus online
echo json_encode([
    'status'    => 'online',
    'success'   => true,
    'message'   => 'Database MySQL Kala.Clock aktif dan terhubung dengan baik.',
    'server_time' => date('Y-m-d H:i:s')
]);
