<?php
// ==========================================================================
// KALA.CLOCK — API AUTENTIKASI ADMIN
// Mengatur Login, Cek Sesi, dan Logout Administrator
// ==========================================================================

require_once __DIR__ . '/koneksi.php';

$action = $_GET['action'] ?? $_POST['action'] ?? 'check';

switch ($action) {

    // ----------------------------------------------------------------------
    // 1. PROSES LOGIN ADMIN
    // ----------------------------------------------------------------------
    case 'login':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonOutput(false, 'Metode request tidak diizinkan. Gunakan POST.', null, 405);
        }

        // Ambil input JSON atau FormData
        $input = json_decode(file_get_contents('php://input'), true);
        $username = trim($input['username'] ?? $_POST['username'] ?? '');
        $password = trim($input['password'] ?? $_POST['password'] ?? '');

        if (empty($username) || empty($password)) {
            jsonOutput(false, 'Username dan password admin wajib diisi.');
        }

        // Cari data admin di database
        $stmt = $pdo->prepare("SELECT * FROM `admin` WHERE `username` = :username LIMIT 1");
        $stmt->execute([':username' => $username]);
        $admin = $stmt->fetch();

        if (!$admin) {
            jsonOutput(false, 'Username atau password admin salah.');
        }

        // Verifikasi password (Bcrypt atau fallback plain-text jika diedit manual)
        $passwordValid = false;
        if (password_verify($password, $admin['password'])) {
            $passwordValid = true;
        } elseif ($password === $admin['password']) {
            // Jika disimpan plain-text, otomatis re-hash ke Bcrypt yang aman
            $newHash = password_hash($password, PASSWORD_BCRYPT);
            $rehashStmt = $pdo->prepare("UPDATE `admin` SET `password` = :p WHERE `id` = :id");
            $rehashStmt->execute([':p' => $newHash, ':id' => $admin['id']]);
            $passwordValid = true;
        }

        if (!$passwordValid) {
            jsonOutput(false, 'Username atau password admin salah.');
        }

        // Set Session Admin
        $_SESSION['kala_admin_logged'] = true;
        $_SESSION['kala_admin_id']     = $admin['id'];
        $_SESSION['kala_admin_user']   = $admin['username'];
        $_SESSION['kala_admin_name']   = $admin['nama_lengkap'];

        jsonOutput(true, 'Login admin berhasil! Mengalihkan ke Dashboard...', [
            'username'     => $admin['username'],
            'nama_lengkap' => $admin['nama_lengkap']
        ]);
        break;

    // ----------------------------------------------------------------------
    // 2. CEK STATUS SESI ADMIN
    // ----------------------------------------------------------------------
    case 'check':
        if (!empty($_SESSION['kala_admin_logged']) && $_SESSION['kala_admin_logged'] === true) {
            jsonOutput(true, 'Sesi admin aktif.', [
                'username'     => $_SESSION['kala_admin_user'],
                'nama_lengkap' => $_SESSION['kala_admin_name']
            ]);
        } else {
            jsonOutput(false, 'Sesi admin tidak aktif atau telah kedaluwarsa.', null, 401);
        }
        break;

    // ----------------------------------------------------------------------
    // 3. LOGOUT ADMIN
    // ----------------------------------------------------------------------
    case 'logout':
        $_SESSION = [];
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params["path"], $params["domain"],
                $params["secure"], $params["httponly"]
            );
        }
        session_destroy();
        jsonOutput(true, 'Logout admin berhasil.');
        break;

    default:
        jsonOutput(false, 'Aksi tidak dikenali.');
}
