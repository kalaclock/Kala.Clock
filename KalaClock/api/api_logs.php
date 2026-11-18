<?php
// ==========================================================================
// KALA.CLOCK — API MONITORING LOG AKSES & STATISTIK
// Menampilkan riwayat siapa saja yang mengakses website Kala.Clock
// ==========================================================================

require_once __DIR__ . '/koneksi.php';

// Pastikan hanya admin yang bisa mengakses log
checkAdminAuth();

$action = $_GET['action'] ?? $_POST['action'] ?? 'list';

switch ($action) {

    // ----------------------------------------------------------------------
    // 1. DAFTAR LOG AKSES KONSUMEN TERBARU
    // ----------------------------------------------------------------------
    case 'list':
        $search = trim($_GET['search'] ?? '');
        $status = trim($_GET['status'] ?? 'all');
        $limit  = intval($_GET['limit'] ?? 100);
        if ($limit <= 0 || $limit > 500) $limit = 100;

        $query = "SELECT * FROM `log_akses` WHERE 1=1";
        $params = [];

        if (!empty($search)) {
            $query .= " AND (`username` LIKE :s OR `id_jam` LIKE :s OR `ip_address` LIKE :s)";
            $params[':s'] = "%{$search}%";
        }

        if (in_array($status, ['berhasil', 'gagal_tidak_terdaftar', 'gagal_dinonaktifkan'])) {
            $query .= " AND `status_akses` = :st";
            $params[':st'] = $status;
        }

        $query .= " ORDER BY `waktu_akses` DESC LIMIT " . $limit;

        $stmt = $pdo->prepare($query);
        $stmt->execute($params);
        $logs = $stmt->fetchAll();

        jsonOutput(true, 'Data log akses berhasil dimuat.', $logs);
        break;

    // ----------------------------------------------------------------------
    // 2. STATISTIK RINGKAS UNTUK DASHBOARD ADMIN
    // ----------------------------------------------------------------------
    case 'stats':
        // Total konsumen
        $totalUsers = (int) $pdo->query("SELECT COUNT(*) FROM `users_jam`")->fetchColumn();

        // Konsumen aktif
        $activeUsers = (int) $pdo->query("SELECT COUNT(*) FROM `users_jam` WHERE `status` = 'aktif'")->fetchColumn();

        // Konsumen nonaktif
        $inactiveUsers = (int) $pdo->query("SELECT COUNT(*) FROM `users_jam` WHERE `status` = 'nonaktif'")->fetchColumn();

        // Akses berhasil hari ini
        $todayAccess = (int) $pdo->query("
            SELECT COUNT(*) FROM `log_akses` 
            WHERE DATE(`waktu_akses`) = CURDATE() AND `status_akses` = 'berhasil'
        ")->fetchColumn();

        // Total seluruh log
        $totalLogs = (int) $pdo->query("SELECT COUNT(*) FROM `log_akses`")->fetchColumn();

        // Perangkat unik yang terdaftar
        $uniqueDevices = (int) $pdo->query("SELECT COUNT(DISTINCT `id_jam`) FROM `users_jam`")->fetchColumn();

        jsonOutput(true, 'Statistik admin berhasil dimuat.', [
            'total_users'     => $totalUsers,
            'active_users'    => $activeUsers,
            'inactive_users'  => $inactiveUsers,
            'today_access'    => $todayAccess,
            'total_logs'      => $totalLogs,
            'unique_devices'  => $uniqueDevices
        ]);
        break;

    // ----------------------------------------------------------------------
    // 3. BERSIHKAN / RESET LOG AKSES
    // ----------------------------------------------------------------------
    case 'clear':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonOutput(false, 'Metode request tidak diizinkan. Gunakan POST.', null, 405);
        }

        $pdo->exec("TRUNCATE TABLE `log_akses`");
        jsonOutput(true, 'Seluruh riwayat log akses berhasil dibersihkan.');
        break;

    default:
        jsonOutput(false, 'Aksi log tidak dikenali.');
}
