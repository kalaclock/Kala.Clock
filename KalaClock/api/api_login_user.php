<?php
// ==========================================================================
// KALA.CLOCK — API VERIFIKASI LOGIN KONSUMEN & PENCATAT AKSES
// Dipanggil oleh loginForm pada index.html milik konsumen
// ==========================================================================

require_once __DIR__ . '/koneksi.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonOutput(false, 'Metode request tidak diizinkan. Gunakan POST.', null, 405);
}

// Tangani input via FormData atau JSON
$input    = json_decode(file_get_contents('php://input'), true);
$username = trim($input['username'] ?? $_POST['username'] ?? '');
$id_jam   = strtoupper(trim($input['id_jam'] ?? $_POST['id_jam'] ?? ''));

$clientIP  = getClientIP();
$userAgent = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown Device';

if (empty($username) || empty($id_jam)) {
    jsonOutput(false, 'Username dan ID Jam wajib diisi.');
}

// 1. Cek apakah kombinasi Username dan ID Jam terdaftar di database
$stmt = $pdo->prepare("
    SELECT * FROM `users_jam` 
    WHERE `username` = :u AND `id_jam` = :idj 
    LIMIT 1
");
$stmt->execute([
    ':u'   => $username,
    ':idj' => $id_jam
]);
$user = $stmt->fetch();

// 2. Jika Tidak Ditemukan
if (!$user) {
    // Catat kegagalan akses ke tabel log_akses
    $logStmt = $pdo->prepare("
        INSERT INTO `log_akses` (`username`, `id_jam`, `ip_address`, `user_agent`, `status_akses`, `keterangan`)
        VALUES (:u, :idj, :ip, :ua, 'gagal_tidak_terdaftar', 'Mencoba login namun data tidak cocok atau belum didaftarkan')
    ");
    $logStmt->execute([
        ':u'   => $username,
        ':idj' => $id_jam,
        ':ip'  => $clientIP,
        ':ua'  => $userAgent
    ]);

    jsonOutput(false, "Username '{$username}' atau ID Jam '{$id_jam}' belum didaftarkan oleh pembuat Kala.Clock. Hubungi produsen untuk mendaftar.");
}

// 3. Jika Akun Sedang Dinonaktifkan oleh Admin
if ($user['status'] !== 'aktif') {
    // Catat kegagalan akses karena nonaktif
    $logStmt = $pdo->prepare("
        INSERT INTO `log_akses` (`username`, `id_jam`, `ip_address`, `user_agent`, `status_akses`, `keterangan`)
        VALUES (:u, :idj, :ip, :ua, 'gagal_dinonaktifkan', 'Akun diblokir / dinonaktifkan oleh admin')
    ");
    $logStmt->execute([
        ':u'   => $username,
        ':idj' => $id_jam,
        ':ip'  => $clientIP,
        ':ua'  => $userAgent
    ]);

    jsonOutput(false, "Akses untuk akun '{$username}' sedang DINONAKTIFKAN oleh admin. Silakan hubungi pembuat Kala.Clock.");
}

// 4. Jika Akun Terdaftar & Berstatus Aktif -> Catat Log Berhasil!
$logStmt = $pdo->prepare("
    INSERT INTO `log_akses` (`username`, `id_jam`, `ip_address`, `user_agent`, `status_akses`, `keterangan`)
    VALUES (:u, :idj, :ip, :ua, 'berhasil', 'Berhasil masuk ke dashboard kontrol jam')
");
$logStmt->execute([
    ':u'   => $username,
    ':idj' => $id_jam,
    ':ip'  => $clientIP,
    ':ua'  => $userAgent
]);

// Berikan respon sukses kepada frontend konsumen
jsonOutput(true, 'Verifikasi akun berhasil! Selamat datang di Kala.Clock.', [
    'username'     => $user['username'],
    'id_jam'       => $user['id_jam'],
    'nama_pemilik' => $user['nama_pemilik']
]);
