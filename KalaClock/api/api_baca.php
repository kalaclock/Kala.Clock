<?php
// ====================================================================
// FILE: api_baca.php (Dynamic per ID Jam)
// ====================================================================
header('Content-Type: application/json');
include 'koneksi.php';

// Tangkap id_jam dari query string GET atau POST
$id_jam = isset($_GET['id_jam']) ? (int)$_GET['id_jam'] : (isset($_POST['id_jam']) ? (int)$_POST['id_jam'] : 0);

if ($id_jam <= 0) {
    echo json_encode([
        "status" => "error", 
        "message" => "id_jam tidak valid atau belum dikirim!"
    ]);
    exit();
}

// Ambil setting spesifik untuk id_jam ini
$sql = "SELECT s.*, j.nama_jam 
        FROM settings_p10 s 
        JOIN jam j ON s.id_jam = j.id_jam 
        WHERE s.id_jam = $id_jam";

$result = mysqli_query($conn, $sql);

if ($result && mysqli_num_rows($result) > 0) {
    echo json_encode(mysqli_fetch_assoc($result));
} else {
    // Jika jam terdaftar tapi belum ada setting, kirim nilai default
    echo json_encode([
        "id_jam" => $id_jam,
        "teks" => "Kala.Clock Ready", 
        "brightness" => 150, 
        "speed" => 40, 
        "mode" => 1
    ]);
}
?>
