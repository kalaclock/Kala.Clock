<?php
// ==========================================================================
// KALA.CLOCK — API SIMPAN PENGATURAN JAM IoT KE DATABASE
// Dipanggil oleh dashboard konsumen saat autosave atau tombol kirim realtime
// ==========================================================================

require_once __DIR__ . '/koneksi.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonOutput(false, 'Metode request tidak diizinkan. Gunakan POST.', null, 405);
}

$id_jam     = strtoupper(trim($_POST['id_jam'] ?? ''));
$teks       = trim($_POST['teks'] ?? '');
$brightness = intval($_POST['brightness'] ?? 80);
$speed      = intval($_POST['speed'] ?? 40);
$mode       = intval($_POST['mode'] ?? 4);

if (empty($id_jam) || $id_jam === '{KC00}') {
    jsonOutput(false, 'ID Jam tidak valid atau masih kosong.');
}

// Simpan atau perbarui data pengaturan jam
$stmt = $pdo->prepare("
    INSERT INTO `pengaturan_jam` (`id_jam`, `teks`, `brightness`, `speed`, `mode`)
    VALUES (:idj, :teks, :br, :sp, :md)
    ON DUPLICATE KEY UPDATE 
        `teks` = VALUES(`teks`),
        `brightness` = VALUES(`brightness`),
        `speed` = VALUES(`speed`),
        `mode` = VALUES(`mode`),
        `updated_at` = CURRENT_TIMESTAMP
");

$stmt->execute([
    ':idj'  => $id_jam,
    ':teks' => $teks,
    ':br'   => $brightness,
    ':sp'   => $speed,
    ':md'   => $mode
]);

jsonOutput(true, "Pengaturan jam {$id_jam} berhasil disimpan ke database.", [
    'id_jam'     => $id_jam,
    'brightness' => $brightness,
    'speed'      => $speed,
    'mode'       => $mode
]);
