<?php
// ==========================================================================
// KALA.CLOCK — API MANAJEMEN PENGGUNA & ID JAM (CRUD)
// Khusus diakses oleh Admin untuk mendaftarkan dan mengelola konsumen
// ==========================================================================

require_once __DIR__ . '/koneksi.php';

// Pastikan hanya admin yang bisa mengakses endpoint ini
checkAdminAuth();

$action = $_GET['action'] ?? $_POST['action'] ?? 'list';

switch ($action) {

    // ----------------------------------------------------------------------
    // 1. DAFTAR PENGGUNA (READ & SEARCH)
    // ----------------------------------------------------------------------
    case 'list':
        $search = trim($_GET['search'] ?? '');
        $status = trim($_GET['status'] ?? 'all');

        $query = "SELECT * FROM `users_jam` WHERE 1=1";
        $params = [];

        if (!empty($search)) {
            $query .= " AND (`username` LIKE :s OR `id_jam` LIKE :s OR `nama_pemilik` LIKE :s)";
            $params[':s'] = "%{$search}%";
        }

        if ($status === 'aktif' || $status === 'nonaktif') {
            $query .= " AND `status` = :st";
            $params[':st'] = $status;
        }

        $query .= " ORDER BY `created_at` DESC";

        $stmt = $pdo->prepare($query);
        $stmt->execute($params);
        $users = $stmt->fetchAll();

        jsonOutput(true, 'Daftar pengguna berhasil dimuat.', $users);
        break;

    // ----------------------------------------------------------------------
    // 2. DAFTARKAN PENGGUNA & ID JAM BARU (CREATE)
    // ----------------------------------------------------------------------
    case 'create':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonOutput(false, 'Metode request tidak diizinkan. Gunakan POST.', null, 405);
        }

        $input        = json_decode(file_get_contents('php://input'), true);
        $username     = trim($input['username'] ?? $_POST['username'] ?? '');
        $id_jam       = strtoupper(trim($input['id_jam'] ?? $_POST['id_jam'] ?? ''));
        $nama_pemilik = trim($input['nama_pemilik'] ?? $_POST['nama_pemilik'] ?? '');
        $nomor_kontak = trim($input['nomor_kontak'] ?? $_POST['nomor_kontak'] ?? '');
        $status       = in_array($input['status'] ?? $_POST['status'] ?? '', ['aktif', 'nonaktif']) 
                        ? ($input['status'] ?? $_POST['status']) : 'aktif';
        $catatan      = trim($input['catatan'] ?? $_POST['catatan'] ?? '');

        if (empty($username) || empty($id_jam)) {
            jsonOutput(false, 'Username dan ID Jam wajib diisi.');
        }

        // Cek apakah username sudah pernah didaftarkan
        $cekStmt = $pdo->prepare("SELECT `id` FROM `users_jam` WHERE `username` = :u LIMIT 1");
        $cekStmt->execute([':u' => $username]);
        if ($cekStmt->fetch()) {
            jsonOutput(false, "Username '{$username}' sudah terdaftar. Silakan gunakan username lain.");
        }

        // Simpan data ke tabel users_jam
        $insertStmt = $pdo->prepare("
            INSERT INTO `users_jam` (`username`, `id_jam`, `nama_pemilik`, `nomor_kontak`, `status`, `catatan`)
            VALUES (:u, :idj, :np, :nk, :st, :cat)
        ");
        $insertStmt->execute([
            ':u'   => $username,
            ':idj' => $id_jam,
            ':np'  => !empty($nama_pemilik) ? $nama_pemilik : $username,
            ':nk'  => $nomor_kontak,
            ':st'  => $status,
            ':cat' => $catatan
        ]);

        jsonOutput(true, "Konsumen '{$username}' dengan ID Jam '{$id_jam}' berhasil didaftarkan!");
        break;

    // ----------------------------------------------------------------------
    // 3. EDIT DATA PENGGUNA (UPDATE)
    // ----------------------------------------------------------------------
    case 'update':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonOutput(false, 'Metode request tidak diizinkan. Gunakan POST.', null, 405);
        }

        $input        = json_decode(file_get_contents('php://input'), true);
        $id           = intval($input['id'] ?? $_POST['id'] ?? 0);
        $username     = trim($input['username'] ?? $_POST['username'] ?? '');
        $id_jam       = strtoupper(trim($input['id_jam'] ?? $_POST['id_jam'] ?? ''));
        $nama_pemilik = trim($input['nama_pemilik'] ?? $_POST['nama_pemilik'] ?? '');
        $nomor_kontak = trim($input['nomor_kontak'] ?? $_POST['nomor_kontak'] ?? '');
        $status       = in_array($input['status'] ?? $_POST['status'] ?? '', ['aktif', 'nonaktif']) 
                        ? ($input['status'] ?? $_POST['status']) : 'aktif';
        $catatan      = trim($input['catatan'] ?? $_POST['catatan'] ?? '');

        if ($id <= 0 || empty($username) || empty($id_jam)) {
            jsonOutput(false, 'ID, Username, dan ID Jam tidak boleh kosong.');
        }

        // Cek duplikasi username pada record lain
        $cekStmt = $pdo->prepare("SELECT `id` FROM `users_jam` WHERE `username` = :u AND `id` != :id LIMIT 1");
        $cekStmt->execute([':u' => $username, ':id' => $id]);
        if ($cekStmt->fetch()) {
            jsonOutput(false, "Username '{$username}' sudah dipakai oleh akun lain.");
        }

        $updateStmt = $pdo->prepare("
            UPDATE `users_jam` 
            SET `username` = :u, `id_jam` = :idj, `nama_pemilik` = :np, 
                `nomor_kontak` = :nk, `status` = :st, `catatan` = :cat
            WHERE `id` = :id
        ");
        $updateStmt->execute([
            ':u'   => $username,
            ':idj' => $id_jam,
            ':np'  => $nama_pemilik,
            ':nk'  => $nomor_kontak,
            ':st'  => $status,
            ':cat' => $catatan,
            ':id'  => $id
        ]);

        jsonOutput(true, 'Data konsumen berhasil diperbarui.');
        break;

    // ----------------------------------------------------------------------
    // 4. TOGGLE STATUS AKTIF / NONAKTIF
    // ----------------------------------------------------------------------
    case 'toggle_status':
        $input = json_decode(file_get_contents('php://input'), true);
        $id    = intval($input['id'] ?? $_POST['id'] ?? 0);

        if ($id <= 0) {
            jsonOutput(false, 'ID konsumen tidak valid.');
        }

        $stmt = $pdo->prepare("SELECT `status` FROM `users_jam` WHERE `id` = :id LIMIT 1");
        $stmt->execute([':id' => $id]);
        $curr = $stmt->fetch();

        if (!$curr) {
            jsonOutput(false, 'Data pengguna tidak ditemukan.');
        }

        $newStatus = ($curr['status'] === 'aktif') ? 'nonaktif' : 'aktif';

        $upStmt = $pdo->prepare("UPDATE `users_jam` SET `status` = :st WHERE `id` = :id");
        $upStmt->execute([':st' => $newStatus, ':id' => $id]);

        jsonOutput(true, "Status konsumen berhasil diubah menjadi {$newStatus}.", ['new_status' => $newStatus]);
        break;

    // ----------------------------------------------------------------------
    // 5. HAPUS PENGGUNA (DELETE)
    // ----------------------------------------------------------------------
    case 'delete':
        $input = json_decode(file_get_contents('php://input'), true);
        $id    = intval($input['id'] ?? $_POST['id'] ?? 0);

        if ($id <= 0) {
            jsonOutput(false, 'ID pengguna tidak valid.');
        }

        $delStmt = $pdo->prepare("DELETE FROM `users_jam` WHERE `id` = :id");
        $delStmt->execute([':id' => $id]);

        jsonOutput(true, 'Data konsumen berhasil dihapus dari sistem.');
        break;

    default:
        jsonOutput(false, 'Aksi manajemen pengguna tidak valid.');
}
