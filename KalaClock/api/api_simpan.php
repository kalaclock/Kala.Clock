<?php
// ====================================================================
// FILE: api_simpan.php (Dynamic per ID Jam - Upsert Mode)
// ====================================================================
header('Content-Type: application/json');
include 'koneksi.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    
    // Tangkap data input dari form dashboard
    $id_jam = isset($_POST['id_jam']) ? (int)$_POST['id_jam'] : 0;
    $teks = isset($_POST['teks']) ? mysqli_real_escape_string($conn, $_POST['teks']) : 'Kala.Clock Ready';
    $brightness = isset($_POST['brightness']) ? (int)$_POST['brightness'] : 150;
    $speed = isset($_POST['speed']) ? (int)$_POST['speed'] : 40;
    $mode = isset($_POST['mode']) ? (int)$_POST['mode'] : 1;
    
    if ($id_jam <= 0) {
        echo json_encode(["status" => "error", "message" => "id_jam wajib diisi!"]);
        exit();
    }

    // Gunakan ON DUPLICATE KEY UPDATE agar jika id_jam sudah ada akan di-UPDATE, 
    // jika belum ada akan otomatis di-INSERT.
    $sql = "INSERT INTO settings_p10 (id_jam, teks, brightness, speed, mode) 
            VALUES ($id_jam, '$teks', $brightness, $speed, $mode)
            ON DUPLICATE KEY UPDATE 
                teks = '$teks', 
                brightness = $brightness, 
                speed = $speed, 
                mode = $mode,
                updated_at = CURRENT_TIMESTAMP";

    if (mysqli_query($conn, $sql)) {
        echo json_encode([
            "status" => "success", 
            "message" => "Pengaturan ID Jam $id_jam berhasil disimpan!",
            "id_jam" => $id_jam
        ]);
    } else {
        echo json_encode([
            "status" => "error", 
            "message" => "Gagal menyimpan: " . mysqli_error($conn)
        ]);
    }
} else {
        echo json_encode(["status" => "error", "message" => "Metode request harus POST!"]);
}
?>
