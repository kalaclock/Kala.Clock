// ==========================================================================
// KALA.CLOCK — ADMIN PANEL JAVASCRIPT CONTROLLER
// Mengatur Autentikasi Admin, CRUD Konsumen, Monitoring Log, & UI Interaktif
// ==========================================================================

let usersDataCache = [];
let logsDataCache = [];

document.addEventListener("DOMContentLoaded", function () {
  initAuthCheck();
  initEventListeners();
});

// ==========================================================================
// 1. AUTENTIKASI ADMIN (LOGIN, CEK SESI, LOGOUT)
// ==========================================================================
function initAuthCheck() {
  fetch("api/api_admin_auth.php?action=check")
    .then(res => res.json())
    .then(data => {
      if (data && data.success) {
        showDashboardScreen(data.data);
      } else {
        showLoginScreen();
      }
    })
    .catch(() => {
      showLoginScreen();
    });
}

function showLoginScreen() {
  const loginScreen = document.getElementById("adminLoginScreen");
  const dashScreen  = document.getElementById("adminDashboardScreen");
  if (loginScreen) loginScreen.classList.remove("hidden");
  if (dashScreen)  dashScreen.classList.add("hidden");
}

function showDashboardScreen(adminData) {
  const loginScreen = document.getElementById("adminLoginScreen");
  const dashScreen  = document.getElementById("adminDashboardScreen");
  if (loginScreen) loginScreen.classList.add("hidden");
  if (dashScreen)  dashScreen.classList.remove("hidden");

  if (adminData && adminData.nama_lengkap) {
    const elName = document.getElementById("adminDisplayName");
    if (elName) elName.textContent = adminData.nama_lengkap;
  }

  // Muat data awal
  refreshAllDashboardData();
}

function refreshAllDashboardData() {
  loadAdminStats();
  loadUsersList();
  loadAccessLogs();
}

// ==========================================================================
// 2. EVENT LISTENERS
// ==========================================================================
function initEventListeners() {
  // Form Login Admin
  const formLogin = document.getElementById("adminLoginForm");
  if (formLogin) {
    formLogin.addEventListener("submit", function (e) {
      e.preventDefault();
      handleAdminLogin();
    });
  }

  // Tombol Logout Admin
  const btnLogout = document.getElementById("btnLogoutAdmin");
  if (btnLogout) {
    btnLogout.addEventListener("click", handleAdminLogout);
  }

  // Tab Navigasi
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  // Tombol Modal Tambah Konsumen
  const btnOpenAdd = document.getElementById("btnOpenAddModal");
  if (btnOpenAdd) {
    btnOpenAdd.addEventListener("click", () => openModal("modalAddUser"));
  }

  // Form Submit Tambah Konsumen
  const formAdd = document.getElementById("formAddUser");
  if (formAdd) {
    formAdd.addEventListener("submit", handleAddUserSubmit);
  }

  // Form Submit Edit Konsumen
  const formEdit = document.getElementById("formEditUser");
  if (formEdit) {
    formEdit.addEventListener("submit", handleEditUserSubmit);
  }

  // Live Search & Filter Konsumen
  const searchUsers = document.getElementById("searchUsersInput");
  if (searchUsers) {
    searchUsers.addEventListener("input", debounce(loadUsersList, 300));
  }

  const filterStatus = document.getElementById("filterStatusSelect");
  if (filterStatus) {
    filterStatus.addEventListener("change", loadUsersList);
  }

  const btnRefreshUsers = document.getElementById("btnRefreshUsers");
  if (btnRefreshUsers) {
    btnRefreshUsers.addEventListener("click", loadUsersList);
  }

  // Live Search & Filter Logs
  const searchLogs = document.getElementById("searchLogsInput");
  if (searchLogs) {
    searchLogs.addEventListener("input", debounce(loadAccessLogs, 300));
  }

  const filterLogStatus = document.getElementById("filterLogStatusSelect");
  if (filterLogStatus) {
    filterLogStatus.addEventListener("change", loadAccessLogs);
  }

  const btnRefreshLogs = document.getElementById("btnRefreshLogs");
  if (btnRefreshLogs) {
    btnRefreshLogs.addEventListener("click", loadAccessLogs);
  }

  const btnClearLogs = document.getElementById("btnClearLogs");
  if (btnClearLogs) {
    btnClearLogs.addEventListener("click", handleClearLogs);
  }
}

// ==========================================================================
// 3. HANDLER LOGIN & LOGOUT
// ==========================================================================
function handleAdminLogin() {
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value.trim();
  const alertBox = document.getElementById("loginAlertBox");
  const btnLogin = document.getElementById("btnAdminLogin");

  if (!username || !password) {
    showLoginAlert("Silakan isi username dan password admin.");
    return;
  }

  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = "Memverifikasi...";
  }

  const formData = new FormData();
  formData.append("action", "login");
  formData.append("username", username);
  formData.append("password", password);

  fetch("api/api_admin_auth.php", {
    method: "POST",
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      if (btnLogin) {
        btnLogin.disabled = false;
        btnLogin.textContent = "Masuk Ke Panel Admin";
      }

      if (data && data.success) {
        if (alertBox) alertBox.classList.add("hidden");
        showToast("Login Berhasil", "Selamat datang di Admin Panel Kala.Clock!");
        showDashboardScreen(data.data);
      } else {
        showLoginAlert(data.message || "Username atau password salah.");
      }
    })
    .catch(err => {
      if (btnLogin) {
        btnLogin.disabled = false;
        btnLogin.textContent = "Masuk Ke Panel Admin";
      }
      showLoginAlert("Gagal menghubungi server database. Pastikan Apache & MySQL aktif.");
    });
}

function handleAdminLogout() {
  if (!confirm("Apakah Anda yakin ingin keluar dari Panel Admin Kala.Clock?")) return;

  fetch("api/api_admin_auth.php?action=logout")
    .then(res => res.json())
    .then(() => {
      showToast("Logout Berhasil", "Anda telah keluar dari akun admin.");
      showLoginScreen();
    })
    .catch(() => {
      showLoginScreen();
    });
}

function showLoginAlert(msg) {
  const alertBox = document.getElementById("loginAlertBox");
  if (alertBox) {
    alertBox.textContent = msg;
    alertBox.classList.remove("hidden");
  }
}

// ==========================================================================
// 4. STATISTIK DASHBOARD ADMIN
// ==========================================================================
function loadAdminStats() {
  fetch("api/api_logs.php?action=stats")
    .then(res => res.json())
    .then(data => {
      if (data && data.success && data.data) {
        const s = data.data;
        setElText("statTotalUsers", s.total_users || 0);
        setElText("statActiveUsers", s.active_users || 0);
        setElText("statTodayAccess", s.today_access || 0);
        setElText("statTotalLogs", s.total_logs || 0);
      }
    })
    .catch(() => {});
}

// ==========================================================================
// 5. MANAJEMEN KONSUMEN & ID JAM (CRUD)
// ==========================================================================
function loadUsersList() {
  const searchVal = document.getElementById("searchUsersInput")?.value || "";
  const statusVal = document.getElementById("filterStatusSelect")?.value || "all";
  const tbody = document.getElementById("usersTableBody");

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Memuat data konsumen...</td></tr>`;
  }

  const url = `api/api_users.php?action=list&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusVal)}`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!tbody) return;

      if (!data || !data.success || !Array.isArray(data.data) || data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Belum ada konsumen yang terdaftar. Klik '+ Daftarkan Konsumen Baru' di atas.</td></tr>`;
        return;
      }

      usersDataCache = data.data;
      let html = "";

      data.data.forEach((user, index) => {
        const isAktif = user.status === "aktif";
        const badgeClass = isAktif ? "badge-aktif" : "badge-nonaktif";
        const statusLabel = isAktif ? "● Aktif" : "○ Nonaktif";
        const tglDaftar = formatTanggal(user.created_at);

        html += `
          <tr>
            <td style="color: var(--text-muted); font-size: 11px;">${index + 1}</td>
            <td><span class="badge-id-jam">${escapeHtml(user.id_jam)}</span></td>
            <td><strong>${escapeHtml(user.username)}</strong></td>
            <td>${escapeHtml(user.nama_pemilik || "-")}</td>
            <td>${escapeHtml(user.nomor_kontak || "-")}</td>
            <td>
              <span class="badge-status ${badgeClass}">${statusLabel}</span>
            </td>
            <td style="color: var(--text-muted); font-size: 11px;">${tglDaftar}</td>
            <td>
              <div class="table-actions-cell">
                <button type="button" class="btn-icon-action btn-icon-toggle" 
                  title="${isAktif ? 'Nonaktifkan Akun' : 'Aktifkan Akun'}" 
                  onclick="toggleUserStatus(${user.id})">
                  ${isAktif ? '🔒' : '🔓'}
                </button>
                <button type="button" class="btn-icon-action btn-icon-edit" 
                  title="Edit Data Konsumen" 
                  onclick="openEditUserModal(${user.id})">
                  ✏️
                </button>
                <button type="button" class="btn-icon-action btn-icon-delete" 
                  title="Hapus Konsumen" 
                  onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
      loadAdminStats();
    })
    .catch(() => {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty" style="color: #ef4444;">Gagal memuat data pengguna.</td></tr>`;
      }
    });
}

function handleAddUserSubmit(e) {
  e.preventDefault();

  const username     = document.getElementById("addUsername").value.trim();
  const id_jam       = document.getElementById("addIdJam").value.trim().toUpperCase();
  const nama_pemilik = document.getElementById("addNamaPemilik").value.trim();
  const nomor_kontak = document.getElementById("addKontak").value.trim();
  const status       = document.getElementById("addStatus").value;
  const catatan      = document.getElementById("addCatatan").value.trim();

  if (!username || !id_jam) {
    showToast("Peringatan", "Username dan ID Jam wajib diisi!", true);
    return;
  }

  const payload = {
    username,
    id_jam,
    nama_pemilik,
    nomor_kontak,
    status,
    catatan
  };

  fetch("api/api_users.php?action=create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data && data.success) {
        showToast("Pendaftaran Berhasil", data.message);
        closeModal("modalAddUser");
        document.getElementById("formAddUser").reset();
        loadUsersList();
      } else {
        showToast("Gagal Mendaftar", data.message || "Terjadi kesalahan.", true);
      }
    })
    .catch(() => {
      showToast("Error", "Gagal menyimpan konsumen ke database.", true);
    });
}

function openEditUserModal(userId) {
  const user = usersDataCache.find(u => parseInt(u.id) === parseInt(userId));
  if (!user) return;

  document.getElementById("editUserId").value      = user.id;
  document.getElementById("editUsername").value    = user.username;
  document.getElementById("editIdJam").value      = user.id_jam;
  document.getElementById("editNamaPemilik").value = user.nama_pemilik || "";
  document.getElementById("editKontak").value      = user.nomor_kontak || "";
  document.getElementById("editStatus").value      = user.status || "aktif";
  document.getElementById("editCatatan").value     = user.catatan || "";

  openModal("modalEditUser");
}

function handleEditUserSubmit(e) {
  e.preventDefault();

  const id           = document.getElementById("editUserId").value;
  const username     = document.getElementById("editUsername").value.trim();
  const id_jam       = document.getElementById("editIdJam").value.trim().toUpperCase();
  const nama_pemilik = document.getElementById("editNamaPemilik").value.trim();
  const nomor_kontak = document.getElementById("editKontak").value.trim();
  const status       = document.getElementById("editStatus").value;
  const catatan      = document.getElementById("editCatatan").value.trim();

  const payload = {
    id,
    username,
    id_jam,
    nama_pemilik,
    nomor_kontak,
    status,
    catatan
  };

  fetch("api/api_users.php?action=update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data && data.success) {
        showToast("Perubahan Disimpan", data.message);
        closeModal("modalEditUser");
        loadUsersList();
      } else {
        showToast("Gagal Memperbarui", data.message || "Terjadi kesalahan.", true);
      }
    })
    .catch(() => {
      showToast("Error", "Gagal memperbarui data pengguna.", true);
    });
}

function toggleUserStatus(userId) {
  fetch("api/api_users.php?action=toggle_status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId })
  })
    .then(res => res.json())
    .then(data => {
      if (data && data.success) {
        showToast("Status Diperbarui", data.message);
        loadUsersList();
      } else {
        showToast("Gagal Ubah Status", data.message, true);
      }
    })
    .catch(() => {
      showToast("Error", "Gagal mengubah status konsumen.", true);
    });
}

function deleteUser(userId, username) {
  if (!confirm(`Hapus konsumen '${username}'? Konsumen ini tidak akan bisa lagi mengakses dashboard jam.`)) {
    return;
  }

  fetch("api/api_users.php?action=delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId })
  })
    .then(res => res.json())
    .then(data => {
      if (data && data.success) {
        showToast("Konsumen Dihapus", data.message);
        loadUsersList();
      } else {
        showToast("Gagal Menghapus", data.message, true);
      }
    })
    .catch(() => {
      showToast("Error", "Gagal menghapus konsumen dari database.", true);
    });
}

// ==========================================================================
// 6. MONITORING LOG AKSES KONSUMEN
// ==========================================================================
function loadAccessLogs() {
  const searchVal = document.getElementById("searchLogsInput")?.value || "";
  const statusVal = document.getElementById("filterLogStatusSelect")?.value || "all";
  const tbody = document.getElementById("logsTableBody");

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Memuat riwayat log...</td></tr>`;
  }

  const url = `api/api_logs.php?action=list&search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusVal)}&limit=100`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!tbody) return;

      if (!data || !data.success || !Array.isArray(data.data) || data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Belum ada aktivitas log akses yang tercatat.</td></tr>`;
        return;
      }

      logsDataCache = data.data;
      let html = "";

      data.data.forEach((log, index) => {
        let badgeHtml = "";
        if (log.status_akses === "berhasil") {
          badgeHtml = `<span class="badge-status badge-log-sukses">✓ Berhasil Masuk</span>`;
        } else if (log.status_akses === "gagal_tidak_terdaftar") {
          badgeHtml = `<span class="badge-status badge-log-gagal">✕ Tidak Terdaftar</span>`;
        } else if (log.status_akses === "gagal_dinonaktifkan") {
          badgeHtml = `<span class="badge-status badge-log-warning">⚠ Dinonaktifkan</span>`;
        } else {
          badgeHtml = `<span class="badge-status">${escapeHtml(log.status_akses)}</span>`;
        }

        const waktu = formatWaktuLengkap(log.waktu_akses);

        html += `
          <tr>
            <td style="color: var(--text-muted); font-size: 11px;">${index + 1}</td>
            <td style="font-size: 11px; white-space: nowrap;">${waktu}</td>
            <td><strong>${escapeHtml(log.username)}</strong></td>
            <td><span class="badge-id-jam">${escapeHtml(log.id_jam)}</span></td>
            <td>${badgeHtml}</td>
            <td style="font-family: monospace; font-size: 11px; color: var(--text-muted);">${escapeHtml(log.ip_address || "-")}</td>
            <td style="font-size: 11px; color: var(--text-muted);">${escapeHtml(log.keterangan || "-")}</td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
      loadAdminStats();
    })
    .catch(() => {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: #ef4444;">Gagal memuat data log.</td></tr>`;
      }
    });
}

function handleClearLogs() {
  if (!confirm("Apakah Anda yakin ingin menghapus seluruh riwayat log akses konsumen?")) {
    return;
  }

  fetch("api/api_logs.php?action=clear", { method: "POST" })
    .then(res => res.json())
    .then(data => {
      if (data && data.success) {
        showToast("Log Dibersihkan", data.message);
        loadAccessLogs();
      }
    })
    .catch(() => {
      showToast("Error", "Gagal membersihkan riwayat log.", true);
    });
}

// ==========================================================================
// 7. HELPER UI (MODALS, TABS, TOAST, UTILS)
// ==========================================================================
function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    if (btn.getAttribute("data-tab") === tabId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  document.querySelectorAll(".tab-content").forEach(content => {
    if (content.id === tabId) {
      content.classList.add("active");
    } else {
      content.classList.remove("active");
    }
  });

  if (tabId === "tabUsers") {
    loadUsersList();
  } else if (tabId === "tabLogs") {
    loadAccessLogs();
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add("active");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove("active");
}

let toastTimer = null;
function showToast(title, message, isError = false) {
  const wrap = document.getElementById("adminToast");
  const card = document.getElementById("adminToastCard");
  const elTitle = document.getElementById("adminToastTitle");
  const elBody = document.getElementById("adminToastBody");
  const elIcon = document.getElementById("adminToastIcon");

  if (!wrap) return;

  if (elTitle) elTitle.textContent = title;
  if (elBody)  elBody.textContent  = message;

  if (card) {
    if (isError) {
      card.classList.add("error");
      if (elIcon) elIcon.textContent = "✕";
    } else {
      card.classList.remove("error");
      if (elIcon) elIcon.textContent = "✅";
    }
  }

  wrap.classList.add("active");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    wrap.classList.remove("active");
  }, 3500);
}

function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTanggal(strDate) {
  if (!strDate) return "-";
  const d = new Date(strDate);
  if (isNaN(d.getTime())) return strDate;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatWaktuLengkap(strDate) {
  if (!strDate) return "-";
  const d = new Date(strDate);
  if (isNaN(d.getTime())) return strDate;
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
