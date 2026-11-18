-- ====================================================================
-- DATABASE KALA.CLOCK — SISTEM PENGELOLAAN & AKSES KONSUMEN
-- ====================================================================

CREATE DATABASE IF NOT EXISTS `KALACLOCK_IOT_DATABASE` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `KALACLOCK_IOT_DATABASE`;

-- 1. TABEL ADMIN (Untuk Pembuat / Pengelola Kala.Clock)
CREATE TABLE IF NOT EXISTS `admin` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `nama_lengkap` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Akun Admin Default:
-- Username : admin
-- Password : admin123 (Ter-enkripsi dengan BCRYPT)
INSERT INTO `admin` (`id`, `username`, `password`, `nama_lengkap`, `email`) 
VALUES (1, 'admin', '$2y$10$wS2Wb5B2LzF8f7sWk3W7/eGk097l0pB0p3LdZ7L870m70Vv0W4Uae', 'Super Admin Kala.Clock', 'admin@kalaclock.local')
ON DUPLICATE KEY UPDATE `username`=`username`;
-- Catatan: Jika ingin mengganti password admin manual, gunakan fungsi password_hash('password_baru', PASSWORD_BCRYPT) di PHP.

-- 2. TABEL PENGGUNA & ID JAM (Didaftarkan oleh Admin)
CREATE TABLE IF NOT EXISTS `users_jam` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(100) NOT NULL UNIQUE,
  `id_jam` VARCHAR(50) NOT NULL,
  `nama_pemilik` VARCHAR(150) NOT NULL,
  `nomor_kontak` VARCHAR(30) DEFAULT NULL,
  `status` ENUM('aktif', 'nonaktif') DEFAULT 'aktif',
  `catatan` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_id_jam` (`id_jam`),
  INDEX `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Data Awal Pengguna Jam (Sesuai Demo Default)
INSERT INTO `users_jam` (`username`, `id_jam`, `nama_pemilik`, `nomor_kontak`, `status`, `catatan`)
VALUES 
('Budi Santoso', 'KC00', 'Budi Santoso', '081234567890', 'aktif', 'Unit demo awal workshop'),
('Kala Master', 'KC01', 'Kantor Kala.Clock', '081987654321', 'aktif', 'Unit display kantor')
ON DUPLICATE KEY UPDATE `username`=`username`;

-- 3. TABEL LOG AKSES WEBSITE (Monitoring Pengunjung/Konsumen yang Login)
CREATE TABLE IF NOT EXISTS `log_akses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(100) NOT NULL,
  `id_jam` VARCHAR(50) NOT NULL,
  `ip_address` VARCHAR(50) DEFAULT NULL,
  `user_agent` TEXT DEFAULT NULL,
  `status_akses` ENUM('berhasil', 'gagal_tidak_terdaftar', 'gagal_dinonaktifkan') NOT NULL,
  `keterangan` VARCHAR(255) DEFAULT NULL,
  `waktu_akses` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_log_jam` (`id_jam`),
  INDEX `idx_waktu` (`waktu_akses`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. TABEL PENYIMPANAN PENGATURAN JAM (Mendukung api_simpan.php)
CREATE TABLE IF NOT EXISTS `pengaturan_jam` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `id_jam` VARCHAR(50) NOT NULL UNIQUE,
  `teks` TEXT DEFAULT NULL,
  `brightness` INT DEFAULT 80,
  `speed` INT DEFAULT 40,
  `mode` INT DEFAULT 4,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
