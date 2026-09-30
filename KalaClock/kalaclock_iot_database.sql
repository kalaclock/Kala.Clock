-- ==========================================================
-- FILE DATABASE UNTUK PROJECT IOT P10 MQTT
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `kalaclock_iot_database`;
USE `kalaclock_iot_database`;

-- `
-- Table structure for table `pengguna`
--

DROP TABLE IF EXISTS `pengguna`;

CREATE TABLE `pengguna` (
  `id_pengguna` int NOT NULL AUTO_INCREMENT,
  `nama_pengguna` varchar(300) NOT NULL,
  `email_pengguna` varchar(200) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_pengguna`),
  UNIQUE KEY `nama_pengguna` (`nama_pengguna`),
  UNIQUE KEY `email_pengguna` (`email_pengguna`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `pengguna`
--

LOCK TABLES `pengguna` WRITE;
UNLOCK TABLES;

--
-- Table structure for table `jam`
--

DROP TABLE IF EXISTS `jam`;
CREATE TABLE `jam` (
  `id_jam` int NOT NULL AUTO_INCREMENT,
  `nama_jam` varchar(100) DEFAULT 'Kala.Clock Model 1',
  `status` enum('online','offline') DEFAULT 'offline',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `id_pengguna` int NOT NULL,
  PRIMARY KEY (`id_jam`),
  KEY `id_pengguna` (`id_pengguna`),
  CONSTRAINT `id_pengguna` FOREIGN KEY (`id_pengguna`) REFERENCES `pengguna` (`id_pengguna`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `jam`
--

LOCK TABLES `jam` WRITE;
UNLOCK TABLES;

--
-- Table structure for table `settings_p10`
--

DROP TABLE IF EXISTS `settings_p10`;
CREATE TABLE `settings_p10` (
  `setting_id` int NOT NULL AUTO_INCREMENT,
  `teks` varchar(255) NOT NULL DEFAULT 'Kala.Clock Siap Dijalankan',
  `brightness` int NOT NULL DEFAULT 150,
  `tanggal` date DEFAULT NULL,
  `mode` int NOT NULL DEFAULT 1,
  `speed` int NOT NULL DEFAULT 40,
  `waktu` time DEFAULT NULL,
  `id_jam` int NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_id`),
  UNIQUE KEY `id_jam` (`id_jam`),
  CONSTRAINT `id_jam` FOREIGN KEY (`id_jam`) REFERENCES `jam` (`id_jam`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `settings_p10`
--

LOCK TABLES `settings_p10` WRITE;
UNLOCK TABLES;
