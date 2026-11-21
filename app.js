/**
 * ============================================================================
 * SISTEM MANAJEMEN KOPERASI PEGAWAI MADRASAH — V5 FINAL (GITHUB PAGES)
 * Arsitektur: Frontend Statis HTTPS + Backend Container Google Sheet (doPost)
 * Fitur: Live Barcode Scanner Native (+ Switch Kamera & Senter), Searchable
 *        Dropdown (Tom Select), Toast/Confirm In-App, & Export Excel Murni
 * ============================================================================
 */

// >>> WAJIB ISI URL WEB APP APPS SCRIPT ANDA DI SINI (BERAKHIRAN /exec) <<<
// Contoh: 'https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxx/exec'
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxZr1KLtzkby3CnYaOnpUpLn1fkpCgpk9didAaRR_ofRU9iWm78m5AWsnHBqvxyZ-7rPw/exec';
const API_URL_STORAGE_KEY = 'KOPERASI_V5_API_URL';

/**
 * ============================================================================
 * STATE GLOBAL, REGISTRY TOM SELECT & KONFIGURASI LIVE SCANNER
 * ============================================================================
 */
let STATE = {
  isAdmin: false,
  periodeBulan: '',
  tahunPilih: '',
  barangList: [],
  stokMenipis: [],
  anggotaList: [],
  rekapWajib: [],
  rekapSHU: [],
  riwayatTransaksi: [],
  rekapBonBulanan: [],
  logOperasional: [],
  logSimpanan: [],
  logOpname: [],
  ringkasanSHU: {},
  config: {
    NAMA_KOPERASI: 'Koperasi Pegawai Madrasah',
    WAJIB_BELANJA_BULANAN: 20000,
    PERSEN_SHU_ANGGOTA: 60,
    PERSEN_JASA_BELANJA: 70,
    PERSEN_JASA_SIMPANAN: 30,
    TAMPILKAN_SHU_PUBLIK: 'TIDAK',
    TAMPILKAN_WAJIB_PUBLIK: 'YA',
    TAMPILKAN_INFO_WAJIB_KASIR: 'YA',
    PESAN_WA_WAJIB: '',
    PESAN_WA_BON: ''
  }
};

let PIN_PENGELOLA_AKTIF = '';
let KERANJANG = [];
let isBusy = false;

// Registry Tom Select (Searchable Dropdown untuk Pegawai & Barang)
const TS = {
  posAnggota: null,
  posPilihBarang: null,
  kulakCariBarang: null,
  selBarcodeBarang: null,
  simpAnggota: null
};

// State Live Barcode Scanner Native (Tanpa Foto — Jeda 1 Detik + Beep + Senter)
let html5QrCode = null;
let activeScannerMode = null;
let activeCameraId = null;
let isCameraTransitioning = false;
let isTorchOn = false;
let lastScanTimestamp = 0;
let audioCtx = null;
const SCAN_COOLDOWN_MS = 1000;

/**
 * ============================================================================
 * KLIEN API GOOGLE SHEET CONTAINER (BEBAS CORS PREFLIGHT)
 * ============================================================================
 */
function getApiUrl() {
  const saved = (localStorage.getItem(API_URL_STORAGE_KEY) || '').trim();
  return saved || (DEFAULT_API_URL || '').trim();
}

function isValidApiUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(\?.*)?$/i.test(String(url || '').trim());
}

async function callServer(action, ...args) {
  const url = getApiUrl();
  if (!url) {
    tampilkanBannerApi(true);
    throw new Error('URL Server Google Sheet belum diatur. Klik ikon rantai di kanan atas untuk menghubungkan.');
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        // text/plain adalah CORS simple request (tanpa preflight OPTIONS) sehingga 100% lolos Apps Script
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ action, args })
    });
  } catch (netErr) {
    throw new Error('Tidak dapat menghubungi server Google Sheet. Periksa koneksi internet & pastikan URL Web App benar.');
  }

  const rawText = await response.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (parseErr) {
    if (/accounts\.google\.com|ServiceLogin|<!DOCTYPE html/i.test(rawText)) {
      throw new Error('Server menolak akses (akses belum publik). Pastikan Deploy Apps Script diatur: Execute as = Me, Who has access = Anyone.');
    }
    throw new Error('Respons server tidak valid. Pastikan Code.gs V5 sudah di-deploy sebagai versi terbaru.');
  }

  if (!json || json.ok !== true) {
    throw new Error((json && json.error) ? json.error : 'Terjadi kesalahan pada server koperasi.');
  }
  return json.data;
}

function tampilkanBannerApi(tampil) {
  const banner = document.getElementById('bannerApiBelumDiatur');
  if (!banner) return;
  banner.classList.toggle('d-none', !tampil);
  banner.classList.toggle('d-flex', tampil);
}

function bukaModalApiConfig() {
  const inp = document.getElementById('inputApiUrl');
  const statusEl = document.getElementById('txtStatusApiModal');
  if (inp) inp.value = getApiUrl();
  if (statusEl) {
    statusEl.innerText = DEFAULT_API_URL
      ? 'URL default tertanam di app.js. Anda tetap dapat menimpanya sementara pada perangkat ini.'
      : 'Belum ada URL default di app.js. Tempelkan URL Web App (/exec) dari Google Apps Script Anda.';
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalApiConfig')).show();
}

async function simpanApiConfig() {
  const inp = document.getElementById('inputApiUrl');
  const url = (inp ? inp.value : '').trim();
  if (!isValidApiUrl(url)) {
    showToast('URL tidak valid. Harus diawali https://script.google.com/macros/s/... dan diakhiri /exec', 'warning');
    return;
  }

  localStorage.setItem(API_URL_STORAGE_KEY, url);
  tampilkanBannerApi(false);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalApiConfig')).hide();
  showToast('URL server disimpan. Menghubungkan ke Google Sheet...', 'info');
  await muatData('Menghubungkan ke server koperasi...');
}

function resetApiConfigDefault() {
  localStorage.removeItem(API_URL_STORAGE_KEY);
  const inp = document.getElementById('inputApiUrl');
  if (inp) inp.value = DEFAULT_API_URL || '';
  if (DEFAULT_API_URL) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalApiConfig')).hide();
    showToast('Kembali menggunakan URL default.', 'info');
    muatData();
  } else {
    showToast('Konfigurasi lokal dibersihkan. Silakan masukkan URL Web App baru.', 'warning');
  }
}

/**
 * ============================================================================
 * INISIALISASI APLIKASI & SEARCHABLE DROPDOWN (TOM SELECT)
 * ============================================================================
 */
function getLocalYearMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

window.addEventListener('DOMContentLoaded', () => {
  // Cek apakah ada parameter ?api=... di URL (memudahkan sharing link siap pakai)
  const params = new URLSearchParams(window.location.search);
  const apiParam = params.get('api');
  if (apiParam && isValidApiUrl(apiParam)) {
    localStorage.setItem(API_URL_STORAGE_KEY, apiParam.trim());
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const blnNow = getLocalYearMonth();
  const thnNow = new Date().getFullYear();

  ['filterBulanInput', 'filterBulanRiwayat', 'filterBulanBon', 'opsBulan', 'simpBulan', 'simpMassalBulan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = blnNow;
  });

  ['filterTahunInput', 'filterTahunKeuangan', 'arsipTahunInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = thnNow;
  });

  // Inisialisasi seluruh Searchable Dropdown (Tom Select)
  initSearchableDropdowns();

  // Matikan live scanner otomatis saat berpindah tab
  document.querySelectorAll('#mainTab button[data-bs-toggle="pill"]').forEach(btn => {
    btn.addEventListener('shown.bs.tab', () => {
      if (html5QrCode) hentikanScannerKamera();
    });
  });

  // Auto-fokus kolom PIN saat modal login pengelola dibuka
  const modalPinEl = document.getElementById('modalPinAdmin');
  if (modalPinEl) {
    modalPinEl.addEventListener('shown.bs.modal', () => {
      const inp = document.getElementById('inputPinLogin');
      if (inp) {
        inp.value = '';
        inp.focus();
      }
    });
  }

  // Kembalikan tampilan layar hanya setelah dialog cetak benar-benar selesai
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('mode-print-slip', 'mode-print-barcode');
  });

  // Muat data atau buka panduan koneksi jika URL API belum diisi
  if (!getApiUrl()) {
    tampilkanBannerApi(true);
    bukaModalApiConfig();
  } else {
    tampilkanBannerApi(false);
    muatData();
  }
});

function initSearchableDropdowns() {
  if (typeof TomSelect === 'undefined') return;

  const renderPegawaiOption = (data, escape) => `
    <div class="ts-opt-row">
      <div>
        <div class="ts-opt-title">${escape(data.nama)}</div>
        <div class="ts-opt-sub">${escape(data.jabatan)} · ${escape(data.id)}${data.nip && data.nip !== '-' ? ' · NIP ' + escape(data.nip) : ''}</div>
      </div>
    </div>`;

  const renderPegawaiItem = (data, escape) => `
    <div><strong>${escape(data.nama)}</strong> <span class="text-muted small">(${escape(data.jabatan)})</span></div>`;

  const renderBarangOption = (data, escape) => {
    const stok = Number(data.stok) || 0;
    const stokBadge = stok <= 0
      ? '<span class="badge badge-soft-danger">Habis</span>'
      : (stok <= (Number(data.minStok) || 5)
          ? `<span class="badge badge-soft-warning">Stok ${stok}</span>`
          : `<span class="badge badge-soft-secondary">Stok ${stok}</span>`);
    return `
      <div class="ts-opt-row">
        <div>
          <div class="ts-opt-title">${escape(data.nama)}</div>
          <div class="ts-opt-sub"><code>${escape(data.barcode)}</code> · ${escape(data.kategori)}</div>
        </div>
        <div class="text-end">
          <div class="ts-opt-price num">${formatRp(data.hargaJual)}</div>
          <div>${stokBadge}</div>
        </div>
      </div>`;
  };

  const renderBarangItem = (data, escape) => `
    <div><strong>${escape(data.nama)}</strong> <span class="text-muted small">(${formatRp(data.hargaJual)})</span></div>`;

  // 1. Searchable Dropdown Pegawai di Kasir POS
  TS.posAnggota = new TomSelect('#posAnggota', {
    valueField: 'id',
    labelField: 'nama',
    searchField: ['nama', 'jabatan', 'nip', 'id'],
    maxOptions: 500,
    placeholder: 'Ketik nama, jabatan, atau NIP pegawai...',
    allowEmptyOption: true,
    render: {
      option: renderPegawaiOption,
      item: renderPegawaiItem,
      no_results: () => '<div class="no-results p-2 small text-muted">Pegawai tidak ditemukan</div>'
    },
    onChange: () => cekStatusWajibAnggota()
  });

  // 2. Searchable Dropdown Barang Manual di Kasir POS
  TS.posPilihBarang = new TomSelect('#posPilihBarang', {
    valueField: 'barcode',
    labelField: 'nama',
    searchField: ['nama', 'barcode', 'kategori'],
    maxOptions: 500,
    placeholder: 'Ketik nama barang, barcode, atau kategori...',
    render: {
      option: renderBarangOption,
      item: renderBarangItem,
      no_results: () => '<div class="no-results p-2 small text-muted">Barang tidak ditemukan</div>'
    },
    onChange: (barcode) => {
      if (!barcode) return;
      document.getElementById('posBarcodeInput').value = barcode;
      tambahKeKeranjangManual(false);
      // Kosongkan kembali pilihan agar siap mencari barang berikutnya
      TS.posPilihBarang.clear(true);
    }
  });

  // 3. Searchable Dropdown Restok Cepat di Tab Kulakan
  TS.kulakCariBarang = new TomSelect('#kulakCariBarang', {
    valueField: 'barcode',
    labelField: 'nama',
    searchField: ['nama', 'barcode', 'kategori'],
    maxOptions: 500,
    placeholder: 'Ketik nama barang terdaftar untuk restok cepat...',
    render: {
      option: renderBarangOption,
      item: renderBarangItem,
      no_results: () => '<div class="no-results p-2 small text-muted">Barang tidak ditemukan</div>'
    },
    onChange: (barcode) => {
      if (!barcode) return;
      document.getElementById('kulakBarcode').value = barcode;
      cekBarangKulakan();
      TS.kulakCariBarang.clear(true);
      const volEl = document.getElementById('kulakVolume');
      if (volEl) { volEl.focus(); volEl.select(); }
    }
  });
  TS.kulakCariBarang.wrapper.classList.add('ts-sm');

  // 4. Searchable Dropdown Cetak Stiker Barcode Mandiri
  TS.selBarcodeBarang = new TomSelect('#selBarcodeBarang', {
    valueField: 'barcode',
    labelField: 'nama',
    searchField: ['nama', 'barcode', 'kategori'],
    maxOptions: 500,
    placeholder: 'Ketik nama atau kode barcode barang...',
    render: {
      option: renderBarangOption,
      item: renderBarangItem,
      no_results: () => '<div class="no-results p-2 small text-muted">Barang tidak ditemukan</div>'
    },
    onChange: (barcode) => {
      if (!barcode) return;
      previewBarcodeDariMaster(barcode);
    }
  });
  TS.selBarcodeBarang.wrapper.classList.add('ts-sm');

  // 5. Searchable Dropdown Pegawai di Tab Simpanan Anggota
  TS.simpAnggota = new TomSelect('#simpAnggota', {
    valueField: 'id',
    labelField: 'nama',
    searchField: ['nama', 'jabatan', 'nip', 'id'],
    maxOptions: 500,
    placeholder: 'Ketik nama, jabatan, atau NIP pegawai...',
    allowEmptyOption: true,
    render: {
      option: renderPegawaiOption,
      item: renderPegawaiItem,
      no_results: () => '<div class="no-results p-2 small text-muted">Pegawai tidak ditemukan</div>'
    }
  });
  TS.simpAnggota.wrapper.classList.add('ts-sm');
}

function segarkanTomSelect(instance, options, pertahankanNilai = false) {
  if (!instance) return;
  const prevVal = pertahankanNilai ? instance.getValue() : '';
  instance.clear(true);
  instance.clearOptions();
  instance.addOptions(options);
  instance.refreshOptions(false);
  if (pertahankanNilai && prevVal && options.some(o => String(o[instance.settings.valueField]) === String(prevVal))) {
    instance.setValue(prevVal, true);
  }
}

/**
 * ============================================================================
 * ENGINE NOTIFIKASI IN-APP (TOAST + MODAL KONFIRMASI — ZERO ALERT/CONFIRM)
 * ============================================================================
 */
function setBusy(aktif, pesan = 'Menyinkronkan data koperasi...') {
  isBusy = Boolean(aktif);
  const overlay = document.getElementById('busyOverlay');
  const msgEl = document.getElementById('busyMessage');
  if (msgEl) msgEl.innerText = pesan;
  if (overlay) overlay.classList.toggle('show', isBusy);
}

function showToast(pesan, tipe = 'success', judul = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const mapTema = {
    success: { bg: 'bg-success text-white', icon: 'bi-check-circle-fill', label: 'Berhasil' },
    danger:  { bg: 'bg-danger text-white',  icon: 'bi-exclamation-octagon-fill', label: 'Perhatian' },
    warning: { bg: 'bg-warning text-dark',  icon: 'bi-exclamation-triangle-fill', label: 'Peringatan' },
    info:    { bg: 'bg-primary text-white', icon: 'bi-info-circle-fill', label: 'Informasi' }
  };
  const t = mapTema[tipe] || mapTema.info;
  const namaKop = (STATE && STATE.config && STATE.config.NAMA_KOPERASI) ? STATE.config.NAMA_KOPERASI : 'Koperasi Pegawai';
  const headerTitle = judul || `${namaKop} · ${t.label}`;
  const btnCloseClass = tipe === 'warning' ? 'btn-close' : 'btn-close btn-close-white';

  const toastEl = document.createElement('div');
  toastEl.className = 'toast koperasi-toast shadow mb-2';
  toastEl.setAttribute('role', 'alert');
  toastEl.setAttribute('aria-live', 'assertive');
  toastEl.setAttribute('aria-atomic', 'true');
  toastEl.innerHTML = `
    <div class="toast-header ${t.bg} py-2">
      <i class="bi ${t.icon} me-2"></i>
      <strong class="me-auto small">${escHtml(headerTitle)}</strong>
      <button type="button" class="${btnCloseClass}" data-bs-dismiss="toast" aria-label="Tutup"></button>
    </div>
    <div class="toast-body bg-white text-dark small">${escHtml(pesan)}</div>`;

  container.appendChild(toastEl);
  const bsToast = new bootstrap.Toast(toastEl, { delay: tipe === 'danger' ? 5500 : 3800 });
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  bsToast.show();
}

function tanyaKonfirmasi(pesan, opsi = {}) {
  return new Promise(resolve => {
    const modalEl = document.getElementById('modalKonfirmasi');
    const headerEl = document.getElementById('konfHeader');
    const judulEl = document.getElementById('konfJudul');
    const pesanEl = document.getElementById('konfPesan');
    const btnYa = document.getElementById('btnKonfYa');

    const bahaya = Boolean(opsi.bahaya);
    headerEl.className = bahaya ? 'modal-header bg-danger text-white py-2' : 'modal-header bg-success text-white py-2';
    judulEl.innerText = opsi.judul || (STATE.config.NAMA_KOPERASI || 'Konfirmasi');
    pesanEl.innerText = pesan;
    btnYa.className = bahaya ? 'btn btn-danger btn-sm fw-semibold' : 'btn btn-emerald btn-sm';
    btnYa.innerText = opsi.teksYa || 'Ya, Lanjutkan';

    let resolved = false;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    const onYa = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      modal.hide();
      resolve(true);
    };

    const onHide = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      btnYa.removeEventListener('click', onYa);
      modalEl.removeEventListener('hidden.bs.modal', onHide);
    };

    btnYa.addEventListener('click', onYa);
    modalEl.addEventListener('hidden.bs.modal', onHide);
    modal.show();
  });
}

/**
 * ============================================================================
 * UTILITAS UMUM (FORMAT RUPIAH, ESCAPE HTML/JS, AUDIO BEEP, SINKRON FILTER)
 * ============================================================================
 */
function formatRp(angka) {
  return 'Rp' + (Number(angka) || 0).toLocaleString('id-ID');
}

function escHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escJsAttr(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, ' ');
}

function bukaTab(btnId) {
  const btn = document.getElementById(btnId);
  if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
}

function playBeep(frekuensi = 1050, durasiMs = 110) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frekuensi, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durasiMs / 1000);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durasiMs / 1000);
  } catch (e) {
    // Abaikan jika perangkat dalam mode senyap
  }
}

function sinkronFilterBulan(val) {
  if (!val) return;
  ['filterBulanInput', 'filterBulanRiwayat', 'filterBulanBon'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== val) el.value = val;
  });
  muatData();
}

function sinkronFilterTahun(val) {
  if (!/^\d{4}$/.test(String(val || ''))) return;
  ['filterTahunInput', 'filterTahunKeuangan', 'arsipTahunInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el && String(el.value) !== String(val)) el.value = val;
  });
  muatData();
}

/**
 * ============================================================================
 * SINKRONISASI DATA SERVER & OTORISASI PENGELOLA (PIN)
 * ============================================================================
 */
async function muatData(pesanLoading) {
  if (!getApiUrl()) {
    tampilkanBannerApi(true);
    return;
  }
  setBusy(true, pesanLoading || 'Menyinkronkan data koperasi...');
  const bln = document.getElementById('filterBulanInput').value || getLocalYearMonth();
  const thn = document.getElementById('filterTahunInput').value || String(new Date().getFullYear());

  try {
    const data = await callServer('getAppData', bln, thn, PIN_PENGELOLA_AKTIF);
    tampilkanBannerApi(false);
    renderApp(data);
  } catch (err) {
    setBusy(false);
    showToast(err.message || 'Gagal memuat data koperasi.', 'danger');
  }
}

async function prosesLoginAdmin() {
  if (isBusy) return;
  const pin = document.getElementById('inputPinLogin').value.trim();
  if (!pin) {
    showToast('Masukkan PIN Pengelola terlebih dahulu.', 'warning');
    return;
  }

  setBusy(true, 'Memverifikasi PIN Pengelola...');
  try {
    const res = await callServer('verifikasiPinAdmin', pin);
    if (res.sukses) {
      PIN_PENGELOLA_AKTIF = pin;
      document.getElementById('inputPinLogin').value = '';
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalPinAdmin')).hide();
      showToast(res.pesan, 'success');
      await muatData('Membuka menu pengelola...');
    } else {
      setBusy(false);
      showToast(res.pesan, 'danger');
      const inp = document.getElementById('inputPinLogin');
      if (inp) { inp.select(); inp.focus(); }
    }
  } catch (err) {
    setBusy(false);
    showToast('Gagal verifikasi PIN: ' + (err.message || err), 'danger');
  }
}

function logoutAdmin() {
  PIN_PENGELOLA_AKTIF = '';
  if (html5QrCode) hentikanScannerKamera();
  bukaTab('btn-tab-kasir');
  showToast('Mode Pengelola telah dikunci kembali ke Mode Kasir.', 'info');
  muatData('Mengunci sesi pengelola...');
}

function aturVisibilitasMenu(data) {
  const isAdmin = Boolean(data.isAdmin);
  const cfg = data.config;

  document.body.classList.toggle('is-admin', isAdmin);

  const tampilSHU = isAdmin || cfg.TAMPILKAN_SHU_PUBLIK === 'YA';
  const tampilWajib = isAdmin || cfg.TAMPILKAN_WAJIB_PUBLIK === 'YA';
  document.getElementById('nav-shu').classList.toggle('d-none', !tampilSHU);
  document.getElementById('nav-wajib').classList.toggle('d-none', !tampilWajib);

  document.getElementById('btnLoginAdmin').classList.toggle('d-none', isAdmin);
  document.getElementById('btnLogoutAdmin').classList.toggle('d-none', !isAdmin);

  const badge = document.getElementById('badgeMode');
  if (isAdmin) {
    badge.className = 'badge bg-warning text-dark fw-bold px-3 py-2 rounded-pill';
    badge.innerHTML = '<i class="bi bi-shield-check me-1"></i> Mode Pengelola';
  } else {
    badge.className = 'badge bg-white text-success fw-semibold px-3 py-2 rounded-pill';
    badge.innerHTML = '<i class="bi bi-cart3 me-1"></i> Mode Kasir';
  }

  const banner = document.getElementById('bannerStokMenipis');
  if (isAdmin && data.stokMenipis && data.stokMenipis.length > 0) {
    const contoh = data.stokMenipis.slice(0, 3).map(b => `${b.nama} (${b.stok})`).join(', ');
    const sisa = data.stokMenipis.length > 3 ? ` dan ${data.stokMenipis.length - 3} barang lainnya` : '';
    document.getElementById('txtRingkasanMenipis').innerText = `${data.stokMenipis.length} barang perlu kulakan: ${contoh}${sisa}.`;
    banner.classList.remove('d-none');
    banner.classList.add('d-flex');
  } else {
    banner.classList.add('d-none');
    banner.classList.remove('d-flex');
  }

  if (isAdmin) {
    document.getElementById('setTampilSHU').checked = (cfg.TAMPILKAN_SHU_PUBLIK === 'YA');
    document.getElementById('setTampilWajib').checked = (cfg.TAMPILKAN_WAJIB_PUBLIK === 'YA');
    document.getElementById('setTampilNotifKasir').checked = (cfg.TAMPILKAN_INFO_WAJIB_KASIR === 'YA');
    document.getElementById('setNamaKoperasi').value = cfg.NAMA_KOPERASI;
    document.getElementById('setWajibBulanan').value = cfg.WAJIB_BELANJA_BULANAN;
    document.getElementById('setPersenSHU').value = cfg.PERSEN_SHU_ANGGOTA;
    document.getElementById('setPersenJasaBelanja').value = cfg.PERSEN_JASA_BELANJA;
    document.getElementById('setPersenJasaSimpanan').value = cfg.PERSEN_JASA_SIMPANAN;
    document.getElementById('setPesanWaWajib').value = cfg.PESAN_WA_WAJIB || '';
    document.getElementById('setPesanWaBon').value = cfg.PESAN_WA_BON || '';
    document.getElementById('setPinBaru').value = '';
  }
}

function renderApp(data) {
  setBusy(false);
  STATE = data;

  const namaKop = data.config.NAMA_KOPERASI || 'Koperasi Pegawai Madrasah';
  document.getElementById('txtNamaKoperasi').innerText = namaKop;
  document.title = `${namaKop} — Sistem Terpadu V5`;
  document.getElementById('txtTargetWajibLabel').innerText = formatRp(data.config.WAJIB_BELANJA_BULANAN);
  aturVisibilitasMenu(data);

  // 1. Segarkan Searchable Dropdown Pegawai Aktif (Kasir POS & Simpanan)
  const pegawaiAktif = (data.anggotaList || []).filter(a => a.status === 'Aktif');
  segarkanTomSelect(TS.posAnggota, pegawaiAktif, true);
  segarkanTomSelect(TS.simpAnggota, pegawaiAktif, true);
  cekStatusWajibAnggota();

  // 2. Segarkan Searchable Dropdown Barang (POS, Kulakan Restok, & Generator Barcode)
  const semuaBarang = data.barangList || [];
  segarkanTomSelect(TS.posPilihBarang, semuaBarang, false);
  segarkanTomSelect(TS.kulakCariBarang, semuaBarang, false);
  segarkanTomSelect(TS.selBarcodeBarang, semuaBarang, true);

  // 3. Render Tab Wajib Belanja & SHU
  renderTabelWajibBelanja();
  renderTabSHU();

  // 4. Render Modul Khusus Pengelola (Fungsi berada di Part 4B)
  if (data.isAdmin) {
    renderTabelRiwayat();
    renderTabBon();
    renderTabKeuangan();
    renderMasterBarang();
    renderMasterAnggota();
    renderStokMenipis();
    renderLogOpname();
  }
}

/**
 * ============================================================================
 * MODUL 1: KASIR BELANJA (POS) & CEK WAJIB BELANJA
 * ============================================================================
 */
function getSelectedPosAnggotaId() {
  return TS.posAnggota ? String(TS.posAnggota.getValue() || '') : (document.getElementById('posAnggota').value || '');
}

function cekStatusWajibAnggota() {
  const id = getSelectedPosAnggotaId();
  const box = document.getElementById('infoWajibPos');
  if (!id || (!STATE.isAdmin && STATE.config.TAMPILKAN_INFO_WAJIB_KASIR !== 'YA')) {
    box.classList.add('d-none');
    return;
  }

  const rekap = (STATE.rekapWajib || []).find(r => r.id === id);
  if (!rekap) {
    box.classList.add('d-none');
    return;
  }

  box.classList.remove('d-none');
  if (rekap.kurangWajib === 0) {
    box.className = 'alert alert-success py-2 px-3 small mb-2';
    box.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i> Belanja bulan ini: <strong class="num">${formatRp(rekap.belanjaBulanIni)}</strong> (Wajib bulanan sudah terpenuhi).`;
  } else {
    box.className = 'alert alert-warning py-2 px-3 small mb-2';
    box.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i> Belanja bulan ini: <strong class="num">${formatRp(rekap.belanjaBulanIni)}</strong>. Kurang <strong class="num">${formatRp(rekap.kurangWajib)}</strong> dari wajib bulanan.`;
  }
}

function handleEnterPos(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    tambahKeKeranjangManual(false);
  }
}

function tambahKeKeranjangManual(dariKamera = false) {
  const inputEl = document.getElementById('posBarcodeInput');
  const kode = inputEl.value.trim();
  const qty = parseInt(document.getElementById('posQtyInput').value, 10) || 1;
  if (!kode) return;

  if (qty <= 0) {
    showToast('Volume barang minimal 1 unit.', 'warning');
    return;
  }

  const brg = (STATE.barangList || []).find(b => b.barcode === kode);
  if (!brg) {
    playBeep(320, 220);
    if (dariKamera) setStatusLiveScan('POS', `Barcode "${kode}" belum terdaftar!`, true);
    showToast(`Barcode "${kode}" belum terdaftar di Master Barang.`, 'warning');
    inputEl.value = '';
    if (!dariKamera) inputEl.focus();
    return;
  }

  const existing = KERANJANG.find(k => k.barcode === kode);
  const totalQtyBaru = (existing ? existing.qty : 0) + qty;
  if (totalQtyBaru > brg.stok) {
    playBeep(320, 220);
    if (dariKamera) setStatusLiveScan('POS', `Stok "${brg.nama}" tersisa ${brg.stok} unit!`, true);
    showToast(`Stok "${brg.nama}" hanya tersisa ${brg.stok} unit.`, 'warning');
    inputEl.value = '';
    return;
  }

  if (existing) {
    existing.qty = totalQtyBaru;
  } else {
    KERANJANG.push({
      barcode: brg.barcode,
      nama: brg.nama,
      hargaJual: brg.hargaJual,
      qty: qty
    });
  }

  playBeep(1150, 95);
  if (dariKamera) {
    setStatusLiveScan('POS', `+${qty} ${brg.nama} (${formatRp(brg.hargaJual)})`, false);
  }

  inputEl.value = '';
  document.getElementById('posQtyInput').value = 1;
  renderKeranjang();
  if (!dariKamera) inputEl.focus();
}

function ubahQtyKeranjang(index, delta) {
  const item = KERANJANG[index];
  if (!item) return;
  const brg = (STATE.barangList || []).find(b => b.barcode === item.barcode);
  const nextQty = item.qty + delta;

  if (nextQty <= 0) {
    KERANJANG.splice(index, 1);
  } else if (brg && nextQty > brg.stok) {
    showToast(`Melebihi stok tersedia (${brg.stok} unit).`, 'warning');
  } else {
    item.qty = nextQty;
  }
  renderKeranjang();
}

function kosongkanKeranjang() {
  KERANJANG = [];
  renderKeranjang();
}

function renderKeranjang() {
  const tbody = document.getElementById('tabelKeranjang');
  const badgeItem = document.getElementById('badgeJumlahItem');
  const txtQty = document.getElementById('txtRingkasanQty');

  if (KERANJANG.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted py-5">
          <i class="bi bi-upc-scan fs-2 d-block mb-2 opacity-50"></i>
          Belum ada barang. Pindai barcode atau cari barang di sebelah kiri.
        </td>
      </tr>`;
    document.getElementById('txtTotalKeranjang').innerText = 'Rp0';
    if (badgeItem) badgeItem.innerText = '0 item';
    if (txtQty) txtQty.innerText = '0 unit barang';
    return;
  }

  let total = 0;
  let totalUnit = 0;
  tbody.innerHTML = '';

  KERANJANG.forEach((item, idx) => {
    const sub = item.hargaJual * item.qty;
    total += sub;
    totalUnit += item.qty;
    tbody.innerHTML += `
      <tr>
        <td>
          <div class="fw-semibold">${escHtml(item.nama)}</div>
          <small class="text-muted"><code>${escHtml(item.barcode)}</code></small>
        </td>
        <td class="text-end num">${formatRp(item.hargaJual)}</td>
        <td class="text-center">
          <div class="qty-stepper">
            <button type="button" onclick="ubahQtyKeranjang(${idx}, -1)" aria-label="Kurangi">−</button>
            <span class="num">${item.qty}</span>
            <button type="button" onclick="ubahQtyKeranjang(${idx}, 1)" aria-label="Tambah">+</button>
          </div>
        </td>
        <td class="text-end fw-bold num">${formatRp(sub)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm text-danger p-1" onclick="ubahQtyKeranjang(${idx}, -9999)" title="Hapus">
            <i class="bi bi-trash3"></i>
          </button>
        </td>
      </tr>`;
  });

  document.getElementById('txtTotalKeranjang').innerText = formatRp(total);
  if (badgeItem) badgeItem.innerText = `${KERANJANG.length} jenis`;
  if (txtQty) txtQty.innerText = `${totalUnit} unit barang`;
}

async function prosesCheckout() {
  if (isBusy) return;
  const idAnggota = getSelectedPosAnggotaId();
  if (!idAnggota) {
    showToast('Pilih nama pegawai terlebih dahulu sebelum menyimpan transaksi.', 'warning');
    if (TS.posAnggota) TS.posAnggota.focus();
    return;
  }
  if (KERANJANG.length === 0) {
    showToast('Keranjang belanja masih kosong.', 'warning');
    return;
  }

  const ang = (STATE.anggotaList || []).find(a => a.id === idAnggota);
  const payload = {
    idAnggota: idAnggota,
    namaAnggota: ang ? ang.nama : idAnggota,
    metodeBayar: document.getElementById('posMetode').value,
    items: KERANJANG.map(k => ({ barcode: k.barcode, qty: k.qty }))
  };

  setBusy(true, 'Menyimpan transaksi & memotong stok...');
  try {
    const res = await callServer('simpanTransaksiBelanja', payload);
    playBeep(1400, 140);
    kosongkanKeranjang();
    showToast(res.pesan, 'success', 'Transaksi Berhasil');
    await muatData('Memperbarui stok & rekap...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menyimpan transaksi: ' + (err.message || err), 'danger');
  }
}

function renderTabelWajibBelanja() {
  const tbody = document.getElementById('bodyWajibBelanja');
  if (!tbody) return;
  const kw = (document.getElementById('cariWajib')?.value || '').toLowerCase().trim();
  const list = (STATE.rekapWajib || []).filter(r => {
    if (!kw) return true;
    return r.nama.toLowerCase().includes(kw) || r.jabatan.toLowerCase().includes(kw) || r.id.toLowerCase().includes(kw);
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Tidak ada data pegawai yang cocok</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(r => {
    const lunas = r.statusWajib === 'Terpenuhi';
    const btnWa = !lunas
      ? `<button type="button" class="btn btn-success btn-sm" onclick="kirimWaWajib('${escJsAttr(r.id)}')" title="Kirim pengingat WhatsApp">
           <i class="bi bi-whatsapp me-1"></i> Ingatkan
         </button>`
      : '<span class="text-muted small">—</span>';

    tbody.innerHTML += `
      <tr>
        <td><code>${escHtml(r.id)}</code></td>
        <td class="fw-semibold">${escHtml(r.nama)}</td>
        <td class="text-muted">${escHtml(r.jabatan)}</td>
        <td class="text-end fw-bold num">${formatRp(r.belanjaBulanIni)}</td>
        <td class="text-end text-danger num">${formatRp(r.kurangWajib)}</td>
        <td class="text-center">
          <span class="badge ${lunas ? 'badge-soft-success' : 'badge-soft-warning'} px-2 py-1">
            ${lunas ? 'Terpenuhi' : 'Kurang ' + formatRp(r.kurangWajib)}
          </span>
        </td>
        <td class="text-center admin-only no-print">${btnWa}</td>
      </tr>`;
  });
}

/**
 * ============================================================================
 * MODUL 2: LIVE BARCODE SCANNER NATIVE (HTTPS GITHUB PAGES — TANPA FOTO)
 * ============================================================================
 */
function getFormatBarcodeDidukung_() {
  if (typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
  return [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.CODABAR,
    Html5QrcodeSupportedFormats.QR_CODE
  ];
}

function setStatusLiveScan(mode, teks, isError = false) {
  const el = document.getElementById(mode === 'POS' ? 'statusScanPOS' : 'statusScanKULAK');
  if (!el) return;
  el.className = isError ? 'text-warning fw-semibold' : 'text-white';
  el.innerText = teks;
}

function resetUiKamera_(mode) {
  const shell = document.getElementById(mode === 'POS' ? 'scannerShellPOS' : 'scannerShellKULAK');
  const btn = document.getElementById(mode === 'POS' ? 'btnCamPOS' : 'btnCamKULAK');
  const torchBtn = document.getElementById(mode === 'POS' ? 'btnTorchPOS' : 'btnTorchKULAK');

  if (shell) shell.classList.remove('active');
  if (btn) {
    btn.className = 'btn btn-emerald btn-sm';
    btn.innerHTML = mode === 'POS'
      ? '<i class="bi bi-camera-video-fill me-1"></i> Mulai Live Scan'
      : '<i class="bi bi-camera-video-fill me-1"></i> Live Scan Barcode';
  }
  if (torchBtn) {
    torchBtn.classList.add('d-none');
    torchBtn.classList.remove('btn-warning', 'text-dark');
    torchBtn.classList.add('btn-outline-warning');
  }
  isTorchOn = false;
}

function hentikanScannerKamera() {
  if (!html5QrCode) return Promise.resolve();
  const prevMode = activeScannerMode;
  const instance = html5QrCode;
  html5QrCode = null;
  activeScannerMode = null;
  activeCameraId = null;

  return Promise.resolve()
    .then(() => instance.stop())
    .catch(() => {})
    .then(() => {
      try { instance.clear(); } catch (e) {}
      if (prevMode) resetUiKamera_(prevMode);
    });
}

function toggleCameraScanner(mode) {
  if (isCameraTransitioning) return;

  if (html5QrCode && activeScannerMode === mode) {
    isCameraTransitioning = true;
    hentikanScannerKamera().finally(() => { isCameraTransitioning = false; });
    return;
  }

  if (html5QrCode) {
    isCameraTransitioning = true;
    hentikanScannerKamera().then(() => {
      isCameraTransitioning = false;
      mulaiKameraLive_(mode, null);
    });
    return;
  }

  // Dipanggil sinkron dalam user gesture klik tombol
  mulaiKameraLive_(mode, null);
}

function gantiKameraAktif(mode, deviceId) {
  if (!deviceId || isCameraTransitioning || deviceId === activeCameraId) return;
  isCameraTransitioning = true;
  hentikanScannerKamera().then(() => {
    isCameraTransitioning = false;
    mulaiKameraLive_(mode, deviceId);
  });
}

function mulaiKameraLive_(mode, preferredDeviceId) {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Pustaka Live Scanner belum termuat. Periksa koneksi internet lalu Refresh.', 'danger');
    return;
  }

  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showToast('Live Scanner membutuhkan halaman HTTPS (GitHub Pages).', 'danger');
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Browser pada perangkat ini tidak mendukung akses kamera live. Buka di Chrome atau Safari terbaru.', 'danger');
    return;
  }

  const readerId = mode === 'POS' ? 'readerPOS' : 'readerKULAK';
  const shell = document.getElementById(mode === 'POS' ? 'scannerShellPOS' : 'scannerShellKULAK');
  const btn = document.getElementById(mode === 'POS' ? 'btnCamPOS' : 'btnCamKULAK');

  isCameraTransitioning = true;
  isTorchOn = false;
  activeScannerMode = mode;

  if (shell) shell.classList.add('active');
  if (btn) {
    btn.className = 'btn btn-danger btn-sm';
    btn.innerHTML = '<i class="bi bi-camera-video-off-fill me-1"></i> Matikan Kamera';
  }
  setStatusLiveScan(mode, 'Membuka kamera live...');

  const formats = getFormatBarcodeDidukung_();
  const instanceConfig = {
    verbose: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };
  if (formats) instanceConfig.formatsToSupport = formats;

  try {
    html5QrCode = new Html5Qrcode(readerId, instanceConfig);
  } catch (e) {
    html5QrCode = new Html5Qrcode(readerId);
  }

  const scanOptions = {
    fps: 15,
    qrbox: (vw, vh) => {
      const w = Math.min(300, Math.max(180, Math.floor(vw * 0.82)));
      const h = Math.min(140, Math.max(95, Math.floor(vh * 0.42)));
      return { width: w, height: h };
    }
  };

  const onDecodeSuccess = (decodedText) => {
    const now = Date.now();
    // Jeda anti-scan ganda: 1 detik (1000 ms)
    if (now - lastScanTimestamp < SCAN_COOLDOWN_MS) return;
    lastScanTimestamp = now;

    const cleanCode = String(decodedText || '').trim();
    if (!cleanCode) return;

    if (mode === 'POS') {
      document.getElementById('posBarcodeInput').value = cleanCode;
      tambahKeKeranjangManual(true);
    } else {
      playBeep(1150, 95);
      document.getElementById('kulakBarcode').value = cleanCode;
      cekBarangKulakan();
      setStatusLiveScan('KULAK', `Terpindai: ${cleanCode}`, false);
      showToast(`Barcode "${cleanCode}" berhasil dipindai.`, 'success');
    }
  };

  const cameraTarget = preferredDeviceId ? preferredDeviceId : { facingMode: 'environment' };

  html5QrCode.start(cameraTarget, scanOptions, onDecodeSuccess, () => {})
    .then(() => {
      isCameraTransitioning = false;
      activeCameraId = preferredDeviceId || null;
      setStatusLiveScan(mode, 'Live aktif — arahkan ke garis barcode...');
      muatDaftarKameraDanSenter_(mode);
    })
    .catch(errUtama => {
      // Jika constraint facingMode gagal (misal laptop hanya punya 1 kamera depan), fallback ke kamera pertama
      const errStr = String(errUtama || '');
      const denied = /NotAllowedError|Permission denied|PermissionDismissed/i.test(errStr);

      if (!denied && !preferredDeviceId && html5QrCode) {
        Html5Qrcode.getCameras().then(devices => {
          if (!devices || devices.length === 0) throw errUtama;
          const back = devices.find(d => /back|rear|belakang|environment/i.test(d.label || ''));
          const chosen = back ? back.id : devices[0].id;
          activeCameraId = chosen;
          return html5QrCode.start(chosen, scanOptions, onDecodeSuccess, () => {});
        }).then(() => {
          isCameraTransitioning = false;
          setStatusLiveScan(mode, 'Live aktif — arahkan ke garis barcode...');
          muatDaftarKameraDanSenter_(mode);
        }).catch(errFinal => {
          tanganiGagalKameraLive_(mode, errFinal);
        });
      } else {
        tanganiGagalKameraLive_(mode, errUtama);
      }
    });
}

function muatDaftarKameraDanSenter_(mode) {
  const sel = document.getElementById(mode === 'POS' ? 'camSelectPOS' : 'camSelectKULAK');
  const torchBtn = document.getElementById(mode === 'POS' ? 'btnTorchPOS' : 'btnTorchKULAK');

  // 1. Isi dropdown pemilih kamera (belakang/depan)
  Html5Qrcode.getCameras().then(devices => {
    if (!sel || !devices || devices.length === 0) return;
    sel.innerHTML = '';
    devices.forEach((dev, i) => {
      const label = dev.label || `Kamera ${i + 1}`;
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = label;
      sel.appendChild(opt);
    });

    // Cocokkan dengan track kamera yang sedang berjalan
    if (activeCameraId) {
      sel.value = activeCameraId;
    } else {
      const back = devices.find(d => /back|rear|belakang|environment/i.test(d.label || ''));
      if (back) {
        sel.value = back.id;
        activeCameraId = back.id;
      } else if (devices[0]) {
        sel.value = devices[0].id;
        activeCameraId = devices[0].id;
      }
    }
  }).catch(() => {});

  // 2. Cek dukungan Senter / Torch pada HP
  if (torchBtn && html5QrCode) {
    try {
      const caps = html5QrCode.getRunningTrackCameraCapabilities
        ? html5QrCode.getRunningTrackCameraCapabilities()
        : null;
      const supportsTorch = Boolean(caps && caps.torchFeature && caps.torchFeature().isSupported());
      torchBtn.classList.toggle('d-none', !supportsTorch);
    } catch (e) {
      torchBtn.classList.add('d-none');
    }
  }
}

async function toggleSenterKamera(mode) {
  if (!html5QrCode) return;
  const torchBtn = document.getElementById(mode === 'POS' ? 'btnTorchPOS' : 'btnTorchKULAK');
  try {
    const caps = html5QrCode.getRunningTrackCameraCapabilities();
    if (caps && caps.torchFeature && caps.torchFeature().isSupported()) {
      const nextState = !isTorchOn;
      await caps.torchFeature().apply(nextState);
      isTorchOn = nextState;
      if (torchBtn) {
        torchBtn.classList.toggle('btn-warning', isTorchOn);
        torchBtn.classList.toggle('text-dark', isTorchOn);
        torchBtn.classList.toggle('btn-outline-warning', !isTorchOn);
      }
    }
  } catch (e) {
    showToast('Senter kamera tidak didukung pada lensa ini.', 'warning');
  }
}

function tanganiGagalKameraLive_(mode, err) {
  isCameraTransitioning = false;
  html5QrCode = null;
  activeScannerMode = null;
  activeCameraId = null;
  resetUiKamera_(mode);

  const errStr = String(err || '');
  const ua = navigator.userAgent || '';
  const isInApp = /WhatsApp|Instagram|FBAN|FBAV|Line\/|Telegram|; wv\)/i.test(ua);

  if (isInApp) {
    showToast('Browser internal WhatsApp/Telegram memblokir kamera. Tekan titik tiga (⋮) lalu pilih "Buka di Chrome / Safari".', 'danger', 'Izin Kamera Diblokir');
  } else if (/NotAllowedError|Permission denied|PermissionDismissed/i.test(errStr)) {
    showToast('Izin kamera ditolak. Klik ikon gembok di bilah alamat browser → Izinkan Kamera → muat ulang halaman.', 'danger', 'Izin Kamera Ditolak');
  } else if (/NotFoundError|Requested device not found/i.test(errStr)) {
    showToast('Kamera tidak ditemukan pada perangkat ini. Gunakan scanner USB atau pencarian barang manual.', 'warning', 'Kamera Tidak Ditemukan');
  } else {
    showToast('Gagal membuka kamera live: ' + errStr, 'danger');
  }
}

/**
 * ============================================================================
 * MODUL 3: KULAKAN & GENERATOR CETAK STIKER BARCODE BARANG CURAH
 * ============================================================================
 */
function buatKodeBarcodeMandiri() {
  let kodeBaru = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    const rand = String(Math.floor(100000 + Math.random() * 900000));
    const kandidat = 'KOP' + rand;
    if (!(STATE.barangList || []).some(b => b.barcode === kandidat)) {
      kodeBaru = kandidat;
      break;
    }
  }
  if (!kodeBaru) kodeBaru = 'KOP' + String(Date.now()).slice(-6);

  document.getElementById('kulakBarcode').value = kodeBaru;
  cekBarangKulakan();

  document.getElementById('genBarcodeKode').value = kodeBaru;
  document.getElementById('genBarcodeNama').value = document.getElementById('kulakNama').value || 'Barang Curah';
  document.getElementById('genBarcodeHarga').value = document.getElementById('kulakHargaJual').value || 0;
  renderPreviewBarcode();
}

function cekBarangKulakan() {
  const kode = document.getElementById('kulakBarcode').value.trim();
  const info = document.getElementById('statusDeteksiKulak');
  if (!kode) {
    info.innerText = '';
    return;
  }

  const brg = (STATE.barangList || []).find(b => b.barcode === kode);
  if (brg) {
    document.getElementById('kulakNama').value = brg.nama;
    document.getElementById('kulakKategori').value = brg.kategori;
    document.getElementById('kulakHargaBeli').value = brg.hargaKulak;
    document.getElementById('kulakHargaJual').value = brg.hargaJual;
    document.getElementById('kulakMinStok').value = brg.minStok;
    info.className = 'd-block mt-1 text-success fw-semibold';
    info.innerText = `Barang terdaftar (Stok saat ini: ${brg.stok}). Cukup isi Volume Masuk.`;
  } else {
    info.className = 'd-block mt-1 text-primary fw-semibold';
    info.innerText = 'Barcode baru! Lengkapi nama, harga kulak, dan harga jual.';
  }
}

async function prosesSimpanKulakan() {
  if (isBusy) return;
  const payload = {
    barcode: document.getElementById('kulakBarcode').value.trim(),
    nama: document.getElementById('kulakNama').value.trim(),
    kategori: document.getElementById('kulakKategori').value.trim() || 'Umum',
    hargaKulak: document.getElementById('kulakHargaBeli').value,
    hargaJual: document.getElementById('kulakHargaJual').value,
    volume: document.getElementById('kulakVolume').value,
    minStok: document.getElementById('kulakMinStok').value
  };

  if (!payload.barcode || !payload.nama || Number(payload.volume) <= 0) {
    showToast('Barcode, Nama Barang, dan Volume Masuk (min. 1) wajib diisi.', 'warning');
    return;
  }

  setBusy(true, 'Menyimpan data kulakan & menambah stok...');
  try {
    const res = await callServer('simpanKulakan', payload, PIN_PENGELOLA_AKTIF);
    showToast(res.pesan, 'success', 'Kulakan Tersimpan');
    if (String(payload.barcode).startsWith('KOP')) {
      document.getElementById('genBarcodeKode').value = payload.barcode;
      document.getElementById('genBarcodeNama').value = payload.nama;
      document.getElementById('genBarcodeHarga').value = payload.hargaJual;
      renderPreviewBarcode();
    }
    document.getElementById('kulakBarcode').value = '';
    document.getElementById('kulakNama').value = '';
    document.getElementById('statusDeteksiKulak').innerText = '';
    await muatData('Memperbarui daftar stok...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menyimpan kulakan: ' + (err.message || err), 'danger');
  }
}

function previewBarcodeDariMaster(kodeParam) {
  const kode = kodeParam || (TS.selBarcodeBarang ? TS.selBarcodeBarang.getValue() : '');
  if (!kode) return;
  const brg = (STATE.barangList || []).find(b => b.barcode === kode);
  if (!brg) return;
  document.getElementById('genBarcodeKode').value = brg.barcode;
  document.getElementById('genBarcodeNama').value = brg.nama;
  document.getElementById('genBarcodeHarga').value = brg.hargaJual;
  renderPreviewBarcode();
}

function renderPreviewBarcode() {
  const kode = document.getElementById('genBarcodeKode').value.trim();
  const nama = document.getElementById('genBarcodeNama').value.trim() || 'Nama Barang';
  const harga = document.getElementById('genBarcodeHarga').value || 0;

  document.getElementById('prevNamaBarcode').innerText = nama;
  document.getElementById('prevHargaBarcode').innerText = formatRp(harga);
  const svg = document.getElementById('prevSvgBarcode');
  svg.innerHTML = '';

  if (kode && typeof JsBarcode !== 'undefined') {
    try {
      JsBarcode('#prevSvgBarcode', kode, {
        format: 'CODE128',
        width: 1.6,
        height: 45,
        displayValue: true,
        fontSize: 12,
        margin: 4
      });
    } catch (e) {
      svg.innerHTML = '';
    }
  }
}

function cetakStikerBarcode() {
  const kode = document.getElementById('genBarcodeKode').value.trim();
  const nama = document.getElementById('genBarcodeNama').value.trim() || 'Barang Koperasi';
  const harga = document.getElementById('genBarcodeHarga').value || 0;
  const jumlah = Math.min(60, Math.max(1, parseInt(document.getElementById('genBarcodeJumlah').value, 10) || 12));

  if (!kode) {
    showToast('Masukkan atau pilih kode barcode terlebih dahulu.', 'warning');
    return;
  }

  const area = document.getElementById('areaCetakBarcode');
  let html = '<div class="barcode-print-grid">';
  for (let i = 0; i < jumlah; i++) {
    html += `
      <div class="barcode-sticker">
        <div style="font-weight:700; font-size:11px; margin-bottom:2px;">${escHtml(nama)}</div>
        <svg class="print-bc-item"></svg>
        <div style="font-weight:700; font-size:12px;">${formatRp(harga)}</div>
      </div>`;
  }
  html += '</div>';
  area.innerHTML = html;

  try {
    area.querySelectorAll('.print-bc-item').forEach(svgEl => {
      JsBarcode(svgEl, kode, {
        format: 'CODE128',
        width: 1.5,
        height: 42,
        displayValue: true,
        fontSize: 11,
        margin: 2
      });
    });
  } catch (e) {
    showToast('Kode barcode mengandung karakter tidak valid untuk format Code128.', 'danger');
    return;
  }

  document.body.classList.add('mode-print-barcode');
  setTimeout(() => window.print(), 250);
}

/**
 * ============================================================================
 * MODUL 4: RIWAYAT TRANSAKSI & PEMBATALAN (RETUR STOK OTOMATIS)
 * ============================================================================
 */
function renderTabelRiwayat() {
  const tbody = document.getElementById('bodyRiwayatTrx');
  if (!tbody) return;
  const keyword = (document.getElementById('cariRiwayat')?.value || '').toLowerCase().trim();
  const list = (STATE.riwayatTransaksi || []).filter(t => {
    if (!keyword) return true;
    return (
      t.idTrx.toLowerCase().includes(keyword) ||
      t.namaAng.toLowerCase().includes(keyword) ||
      t.rincian.toLowerCase().includes(keyword)
    );
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Belum ada transaksi pada bulan ini</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(t => {
    const batal = t.statusTransaksi === 'Dibatalkan';
    const lunas = t.statusBayar === 'Lunas';
    const rowClass = batal ? 'table-secondary text-decoration-line-through text-muted' : '';

    const badgeStatus = batal
      ? '<span class="badge badge-soft-danger">Dibatalkan</span>'
      : '<span class="badge badge-soft-success">Aktif</span>';

    const badgeMetode = `
      <div class="small fw-semibold">${escHtml(t.metodeBayar)}</div>
      <span class="badge ${lunas ? 'badge-soft-success' : 'badge-soft-warning'}">${escHtml(t.statusBayar)}</span>`;

    const tombolAksi = batal
      ? '<span class="small text-muted">—</span>'
      : `<button type="button" class="btn btn-outline-danger btn-sm" onclick="konfirmasiBatalTransaksi('${escJsAttr(t.idTrx)}')" title="Batalkan & Kembalikan Stok">
           <i class="bi bi-x-circle me-1"></i>Batal
         </button>`;

    tbody.innerHTML += `
      <tr class="${rowClass}">
        <td>
          <code class="small">${escHtml(t.idTrx)}</code>
          <div class="small text-muted">${escHtml(t.waktu)}</div>
        </td>
        <td class="fw-semibold">${escHtml(t.namaAng)}</td>
        <td class="small">${escHtml(t.rincian)}</td>
        <td class="text-end fw-bold num">${formatRp(t.totalBelanja)}</td>
        <td class="text-end text-success num">${formatRp(t.labaKotor)}</td>
        <td class="text-center">${badgeMetode}</td>
        <td class="text-center">${badgeStatus}</td>
        <td class="text-center no-print">${tombolAksi}</td>
      </tr>`;
  });
}

async function konfirmasiBatalTransaksi(idTrx) {
  if (isBusy) return;
  const setuju = await tanyaKonfirmasi(
    `Batalkan transaksi ${idTrx}?\n\nNominal belanja & laba akan dikeluarkan dari seluruh rekap, dan stok barang akan dikembalikan otomatis ke Master Barang.`,
    { judul: 'Batalkan Transaksi', teksYa: 'Ya, Batalkan & Retur Stok', bahaya: true }
  );
  if (!setuju) return;

  setBusy(true, 'Membatalkan transaksi & mengembalikan stok...');
  try {
    const res = await callServer('batalkanTransaksi', idTrx, PIN_PENGELOLA_AKTIF);
    showToast(res.pesan, 'success', 'Transaksi Dibatalkan');
    await muatData('Memperbarui stok & laporan...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal membatalkan transaksi: ' + (err.message || err), 'danger');
  }
}

/**
 * ============================================================================
 * MODUL 5: REKAP TAGIHAN BON / POTONG GAJI BENDAHARA
 * ============================================================================
 */
function renderTabBon() {
  const tbody = document.getElementById('bodyRekapBon');
  if (!tbody) return;
  const list = STATE.rekapBonBulanan || [];

  let sumTotal = 0;
  let sumLunas = 0;
  let sumBelum = 0;

  list.forEach(b => {
    sumTotal += b.totalTagihan;
    sumLunas += b.sudahLunas;
    sumBelum += b.belumLunas;
  });

  document.getElementById('bonTotalTagihan').innerText = formatRp(sumTotal);
  document.getElementById('bonTotalLunas').innerText = formatRp(sumLunas);
  document.getElementById('bonTotalBelum').innerText = formatRp(sumBelum);

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">Tidak ada tagihan Potong Gaji pada bulan ini</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(b => {
    const sudahLunasSemua = b.belumLunas <= 0;
    const badge = sudahLunasSemua
      ? '<span class="badge badge-soft-success">Lunas</span>'
      : '<span class="badge badge-soft-danger">Belum Lunas</span>';

    const aksiHtml = sudahLunasSemua
      ? '<span class="small text-success fw-semibold"><i class="bi bi-check-all"></i> Selesai</span>'
      : `<div class="btn-group btn-group-sm">
           <button type="button" class="btn btn-emerald" onclick="prosesLunasiBonAnggota('${escJsAttr(b.idAnggota)}')" title="Tandai Lunas">
             <i class="bi bi-check2"></i> Lunas
           </button>
           <button type="button" class="btn btn-outline-success" onclick="kirimWaBon('${escJsAttr(b.idAnggota)}')" title="Kirim info tagihan via WA">
             <i class="bi bi-whatsapp"></i>
           </button>
         </div>`;

    tbody.innerHTML += `
      <tr>
        <td><code>${escHtml(b.idAnggota)}</code></td>
        <td class="small text-muted">${escHtml(b.nip)}</td>
        <td class="fw-semibold">${escHtml(b.nama)}</td>
        <td class="text-muted">${escHtml(b.jabatan)}</td>
        <td class="text-center num">${b.jumlahTrx}x</td>
        <td class="text-end fw-semibold num">${formatRp(b.totalTagihan)}</td>
        <td class="text-end text-success num">${formatRp(b.sudahLunas)}</td>
        <td class="text-end fw-bold text-danger num">${formatRp(b.belumLunas)}</td>
        <td class="text-center">${badge}</td>
        <td class="text-center no-print">${aksiHtml}</td>
      </tr>`;
  });
}

async function prosesLunasiBonAnggota(idAnggota) {
  if (isBusy) return;
  const b = (STATE.rekapBonBulanan || []).find(x => x.idAnggota === idAnggota);
  const nama = b ? b.nama : idAnggota;
  const bln = document.getElementById('filterBulanBon').value;

  const setuju = await tanyaKonfirmasi(
    `Tandai seluruh tagihan Potong Gaji atas nama "${nama}" periode ${bln} sebesar ${formatRp(b ? b.belumLunas : 0)} sebagai LUNAS?`,
    { judul: 'Pelunasan Potong Gaji', teksYa: 'Ya, Tandai Lunas' }
  );
  if (!setuju) return;

  setBusy(true, 'Memperbarui status pelunasan...');
  try {
    const res = await callServer('lunasiBonAnggota', idAnggota, bln, PIN_PENGELOLA_AKTIF);
    showToast(res.pesan, 'success', 'Tagihan Lunas');
    await muatData('Menyinkronkan rekap potong gaji...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal melunasi tagihan: ' + (err.message || err), 'danger');
  }
}

async function prosesLunasiBonMassal() {
  if (isBusy) return;
  const bln = document.getElementById('filterBulanBon').value;
  const belum = (STATE.rekapBonBulanan || []).filter(b => b.belumLunas > 0);
  if (belum.length === 0) {
    showToast(`Seluruh tagihan Potong Gaji bulan ${bln} sudah lunas atau belum ada tagihan.`, 'info');
    return;
  }

  const setuju = await tanyaKonfirmasi(
    `Tandai LUNAS SERENTAK untuk ${belum.length} pegawai pada periode ${bln} setelah pemotongan dari Bendahara Gaji selesai?`,
    { judul: 'Pelunasan Massal Potong Gaji', teksYa: 'Ya, Lunasi Semua' }
  );
  if (!setuju) return;

  setBusy(true, 'Melunasi seluruh tagihan bulan ini...');
  try {
    const res = await callServer('lunasiBonMassal', bln, PIN_PENGELOLA_AKTIF);
    showToast(res.pesan, 'success', 'Pelunasan Serentak Selesai');
    await muatData('Menyinkronkan rekap potong gaji...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal melunasi massal: ' + (err.message || err), 'danger');
  }
}

/**
 * ============================================================================
 * MODUL 6: KEUANGAN (BIAYA OPERASIONAL & SIMPANAN ANGGOTA)
 * ============================================================================
 */
function toggleModeSimpanan(mode) {
  const isIndividu = mode === 'INDIVIDU';
  document.getElementById('formSimpIndividu').classList.toggle('d-none', !isIndividu);
  document.getElementById('formSimpMassal').classList.toggle('d-none', isIndividu);
  document.getElementById('btnModeSimpIndividu').className = isIndividu ? 'btn btn-primary active' : 'btn btn-outline-primary';
  document.getElementById('btnModeSimpMassal').className = !isIndividu ? 'btn btn-primary active' : 'btn btn-outline-primary';
}

function renderTabKeuangan() {
  // 1. Log Biaya Operasional
  const bOps = document.getElementById('bodyLogOperasional');
  const listOps = STATE.logOperasional || [];
  let totalOps = 0;

  if (listOps.length === 0) {
    bOps.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Belum ada catatan pengeluaran tahun ini</td></tr>';
  } else {
    bOps.innerHTML = '';
    listOps.forEach(o => {
      totalOps += o.nominal;
      bOps.innerHTML += `
        <tr>
          <td class="small text-muted">${escHtml(o.periodeBulan)}</td>
          <td class="small">
            <strong>${escHtml(o.kategori)}</strong>
            <div class="text-muted">${escHtml(o.keterangan)}</div>
          </td>
          <td class="text-end fw-semibold text-danger num">${formatRp(o.nominal)}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm text-danger p-0" onclick="konfirmasiHapusBiaya('${escJsAttr(o.id)}')" title="Hapus">
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        </tr>`;
    });
  }
  document.getElementById('txtTotalOpsTahun').innerText = 'Total: ' + formatRp(totalOps);

  // 2. Log Simpanan Anggota
  const bSimp = document.getElementById('bodyLogSimpanan');
  const listSimp = STATE.logSimpanan || [];
  let totalSimp = 0;

  if (listSimp.length === 0) {
    bSimp.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Belum ada catatan simpanan tahun ini</td></tr>';
  } else {
    bSimp.innerHTML = '';
    listSimp.forEach(s => {
      totalSimp += s.nominal;
      bSimp.innerHTML += `
        <tr>
          <td class="small text-muted">${escHtml(s.periodeBulan)}</td>
          <td class="small fw-semibold">${escHtml(s.namaPegawai)}</td>
          <td class="small text-muted">${escHtml(s.jenis)}</td>
          <td class="text-end fw-semibold text-primary num">${formatRp(s.nominal)}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm text-danger p-0" onclick="konfirmasiHapusSimpanan('${escJsAttr(s.id)}')" title="Hapus catatan simpanan">
              <i class="bi bi-trash3"></i>
            </button>
          </td>
        </tr>`;
    });
  }
  document.getElementById('txtTotalSimpTahun').innerText = 'Total: ' + formatRp(totalSimp);
}

async function simpanOperasional() {
  if (isBusy) return;
  const payload = {
    periodeBulan: document.getElementById('opsBulan').value,
    kategori: document.getElementById('opsKategori').value,
    keterangan: document.getElementById('opsKeterangan').value.trim(),
    nominal: document.getElementById('opsNominal').value
  };
  if (!payload.keterangan || Number(payload.nominal) <= 0) {
    showToast('Keterangan dan nominal pengeluaran wajib diisi lebih dari 0.', 'warning');
    return;
  }

  setBusy(true, 'Menyimpan pengeluaran operasional...');
  try {
    const res = await callServer('simpanBiayaOperasional', payload, PIN_PENGELOLA_AKTIF);
    document.getElementById('opsKeterangan').value = '';
    document.getElementById('opsNominal').value = '';
    showToast(res.pesan, 'success', 'Pengeluaran Tercatat');
    await muatData('Menghitung ulang laba bersih...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menyimpan biaya: ' + (err.message || err), 'danger');
  }
}

async function konfirmasiHapusBiaya(idBiaya) {
  if (isBusy) return;
  const setuju = await tanyaKonfirmasi(
    'Hapus catatan pengeluaran operasional ini? Laba bersih tahunan akan langsung disesuaikan kembali.',
    { judul: 'Hapus Biaya Operasional', teksYa: 'Ya, Hapus', bahaya: true }
  );
  if (!setuju) return;

  setBusy(true, 'Menghapus catatan pengeluaran...');
  try {
    const res = await callServer('hapusBiayaOperasional', idBiaya, PIN_PENGELOLA_AKTIF);
    showToast(res.pesan, 'success', 'Catatan Dihapus');
    await muatData('Menghitung ulang laba bersih...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menghapus biaya: ' + (err.message || err), 'danger');
  }
}

async function simpanSimpananIndividu() {
  if (isBusy) return;
  const idAng = TS.simpAnggota
    ? String(TS.simpAnggota.getValue() || '')
    : (document.getElementById('simpAnggota').value || '');
  const ang = (STATE.anggotaList || []).find(a => a.id === idAng);

  const payload = {
    idAnggota: idAng,
    namaPegawai: ang ? ang.nama : idAng,
    periodeBulan: document.getElementById('simpBulan').value,
    jenis: document.getElementById('simpJenis').value,
    nominal: document.getElementById('simpNominal').value,
    keterangan: document.getElementById('simpKeterangan').value.trim()
  };

  if (!payload.idAnggota || Number(payload.nominal) <= 0) {
    showToast('Pilih pegawai dan masukkan nominal simpanan lebih dari 0.', 'warning');
    if (!payload.idAnggota && TS.simpAnggota) TS.simpAnggota.focus();
    return;
  }

  setBusy(true, 'Menyimpan iuran simpanan...');
  try {
    const res = await callServer('simpanSimpananAnggota', payload, PIN_PENGELOLA_AKTIF);
    document.getElementById('simpKeterangan').value = '';
    showToast(res.pesan, 'success', 'Simpanan Tercatat');
    await muatData('Memperbarui kalkulasi SHU...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menyimpan iuran: ' + (err.message || err), 'danger');
  }
}

async function konfirmasiHapusSimpanan(idSimp) {
  if (isBusy) return;
  const setuju = await tanyaKonfirmasi(
    'Hapus catatan simpanan ini? Proporsi SHU Jasa Simpanan akan langsung dihitung ulang.',
    { judul: 'Hapus Catatan Simpanan', teksYa: 'Ya, Hapus', bahaya: true }
  );
  if (!setuju) return;

  setBusy(true, 'Menghapus catatan simpanan...');
  try {
    const res = await callServer('hapusSimpananAnggota', idSimp, PIN_PENGELOLA_AKTIF);
    showToast(res.pesan, 'success', 'Simpanan Dihapus');
    await muatData('Memperbarui kalkulasi SHU...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menghapus simpanan: ' + (err.message || err), 'danger');
  }
}

async function prosesSimpananMassal() {
  if (isBusy) return;
  const bln = document.getElementById('simpMassalBulan').value;
  const jenis = document.getElementById('simpMassalJenis').value;
  const nom = Number(document.getElementById('simpMassalNominal').value) || 0;
  if (nom <= 0) {
    showToast('Nominal simpanan serentak harus lebih dari 0.', 'warning');
    return;
  }

  const jmlAktif = (STATE.anggotaList || []).filter(a => a.status === 'Aktif').length;
  const setuju = await tanyaKonfirmasi(
    `Catat ${jenis} sebesar ${formatRp(nom)} untuk SELURUH pegawai aktif (${jmlAktif} orang) pada periode ${bln}?`,
    { judul: 'Catat Simpanan Serentak', teksYa: 'Ya, Catat Serentak' }
  );
  if (!setuju) return;

  setBusy(true, 'Mencatat simpanan serentak...');
  try {
    const res = await callServer('simpanSimpananMassal', {
      periodeBulan: bln,
      jenis: jenis,
      nominal: nom,
      keterangan: document.getElementById('simpMassalKet').value.trim()
    }, PIN_PENGELOLA_AKTIF);
    document.getElementById('simpMassalKet').value = '';
    showToast(res.pesan, 'success', 'Simpanan Serentak Tersimpan');
    await muatData('Memperbarui kalkulasi SHU...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal mencatat simpanan massal: ' + (err.message || err), 'danger');
  }
}

/**
 * ============================================================================
 * MODUL 7: PERHITUNGAN SHU 2 KOMPONEN & CETAK SLIP A6 AMPLOP LEBARAN
 * ============================================================================
 */
function renderTabSHU() {
  const r = STATE.ringkasanSHU || {};
  document.getElementById('shuTotalOmzet').innerText = formatRp(r.totalOmzetTahunan);
  document.getElementById('shuTotalLabaKotor').innerText = formatRp(r.totalLabaKotorTahunan);
  document.getElementById('shuTotalBiayaOps').innerText = formatRp(r.totalBiayaOperasional);
  document.getElementById('shuLabaBersih').innerText = formatRp(r.labaBersihTahunan);
  document.getElementById('shuPersenAlokasi').innerText = r.persenSHU || 0;
  document.getElementById('shuDanaDibagi').innerText = formatRp(r.alokasiDanaSHU);
  document.getElementById('shuPersenBelanjaLabel').innerText = r.persenJasaBelanja || 0;
  document.getElementById('shuDanaBelanja').innerText = formatRp(r.danaSHUBelanja);
  document.getElementById('shuPersenSimpananLabel').innerText = r.persenJasaSimpanan || 0;
  document.getElementById('shuDanaSimpanan').innerText = formatRp(r.danaSHUSimpanan);
  document.getElementById('shuTotalSimpanan').innerText = formatRp(r.totalSimpananTahunan);

  const alertKosong = document.getElementById('alertSimpananKosong');
  if (alertKosong) {
    alertKosong.classList.toggle('d-none', !(STATE.isAdmin && r.peringatanSimpananKosong));
  }

  const tbody = document.getElementById('bodyRekapSHU');
  const tfoot = document.getElementById('footRekapSHU');
  const kw = (document.getElementById('cariSHU')?.value || '').toLowerCase().trim();
  const list = (STATE.rekapSHU || []).filter(m => {
    if (!kw) return true;
    return (
      m.nama.toLowerCase().includes(kw) ||
      m.nip.toLowerCase().includes(kw) ||
      m.id.toLowerCase().includes(kw) ||
      m.jabatan.toLowerCase().includes(kw)
    );
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">Tidak ada data SHU yang sesuai</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  let totFrek = 0, totBelanja = 0, totSimp = 0, totShuBel = 0, totShuSimp = 0, totShuAll = 0;
  tbody.innerHTML = '';
  list.forEach(m => {
    totFrek += m.frekuensiTahunan;
    totBelanja += m.totalBelanjaTahunan;
    totSimp += m.totalSimpananTahunan;
    totShuBel += m.shuBelanja;
    totShuSimp += m.shuSimpanan;
    totShuAll += m.totalSHU;

    const tagNonaktif = m.status === 'Nonaktif' ? ' <span class="badge badge-soft-secondary">Nonaktif</span>' : '';
    tbody.innerHTML += `
      <tr>
        <td><code>${escHtml(m.id)}</code></td>
        <td class="small text-muted">${escHtml(m.nip)}</td>
        <td class="fw-semibold">${escHtml(m.nama)}${tagNonaktif}</td>
        <td class="text-center num">${m.frekuensiTahunan}x</td>
        <td class="text-end num">${formatRp(m.totalBelanjaTahunan)}</td>
        <td class="text-end num">${formatRp(m.totalSimpananTahunan)}</td>
        <td class="text-end num">${formatRp(m.shuBelanja)}</td>
        <td class="text-end num">${formatRp(m.shuSimpanan)}</td>
        <td class="text-end fw-bold text-success num">${formatRp(m.totalSHU)}</td>
        <td class="text-center no-print">
          <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2" onclick="cetakSlipSHUSatu('${escJsAttr(m.id)}')" title="Cetak Slip A6 Pegawai Ini">
            <i class="bi bi-printer"></i>
          </button>
        </td>
      </tr>`;
  });

  if (tfoot) {
    tfoot.innerHTML = `
      <tr>
        <td colspan="3" class="text-end small text-uppercase text-muted">Total ${kw ? '(Terfilter)' : 'Keseluruhan'}</td>
        <td class="text-center num">${totFrek}x</td>
        <td class="text-end num">${formatRp(totBelanja)}</td>
        <td class="text-end num">${formatRp(totSimp)}</td>
        <td class="text-end num">${formatRp(totShuBel)}</td>
        <td class="text-end num">${formatRp(totShuSimp)}</td>
        <td class="text-end text-success num">${formatRp(totShuAll)}</td>
        <td class="no-print"></td>
      </tr>`;
  }
}

function buatHtmlSlipA6(m) {
  const namaKop = STATE.config.NAMA_KOPERASI || 'Koperasi Pegawai Madrasah';
  const thn = STATE.tahunPilih || new Date().getFullYear();
  const tglCetak = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

  return `
    <div class="slip-card">
      <div class="slip-header">
        <div style="font-weight:700; font-size:13px; text-transform:uppercase;">${escHtml(namaKop)}</div>
        <div style="font-weight:600; font-size:11px;">SLIP PEMBAGIAN SHU TAHUN BUKU ${escHtml(thn)}</div>
      </div>
      <table class="slip-table">
        <tr><td style="width:36%;">Nama Pegawai</td><td>: <strong>${escHtml(m.nama)}</strong></td></tr>
        <tr><td>NIP / NIY</td><td>: ${escHtml(m.nip)} (${escHtml(m.id)})</td></tr>
        <tr><td>Jabatan / Unit</td><td>: ${escHtml(m.jabatan)}</td></tr>
      </table>
      <div style="border-top:1px dotted #666; margin:4px 0;"></div>
      <table class="slip-table">
        <tr><td>Total Belanja (${m.frekuensiTahunan}x)</td><td style="text-align:right;">${formatRp(m.totalBelanjaTahunan)}</td></tr>
        <tr><td>Total Simpanan</td><td style="text-align:right;">${formatRp(m.totalSimpananTahunan)}</td></tr>
        <tr><td>SHU Jasa Belanja (${m.persenBelanja}%)</td><td style="text-align:right;">${formatRp(m.shuBelanja)}</td></tr>
        <tr><td>SHU Jasa Simpanan (${m.persenSimpanan}%)</td><td style="text-align:right;">${formatRp(m.shuSimpanan)}</td></tr>
      </table>
      <div class="slip-total-box">
        <span>TOTAL SHU DITERIMA</span>
        <span>${formatRp(m.totalSHU)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:12px; font-size:10px;">
        <div>Diterima oleh,<br><br><br>( ${escHtml(m.nama)} )</div>
        <div style="text-align:right;">${escHtml(tglCetak)}<br>Pengelola Koperasi,<br><br>( __________________ )</div>
      </div>
    </div>`;
}

function cetakDaftarSlipSHU(daftar) {
  if (!daftar || daftar.length === 0) {
    showToast('Tidak ada data SHU untuk dicetak.', 'warning');
    return;
  }
  const area = document.getElementById('areaCetakSlipSHU');
  area.innerHTML = `<div class="slip-grid">${daftar.map(buatHtmlSlipA6).join('')}</div>`;
  document.body.classList.add('mode-print-slip');
  setTimeout(() => window.print(), 250);
}

function cetakSemuaSlipSHU() {
  cetakDaftarSlipSHU(STATE.rekapSHU || []);
}

function cetakSlipSHUSatu(idAnggota) {
  const m = (STATE.rekapSHU || []).find(x => x.id === idAnggota);
  if (m) cetakDaftarSlipSHU([m]);
}

/**
 * ============================================================================
 * MODUL 8: STOK MENIPIS, EDIT BARANG, STOK OPNAME & MASTER ANGGOTA
 * ============================================================================
 */
function renderStokMenipis() {
  const card = document.getElementById('cardStokMenipis');
  const tbody = document.getElementById('bodyStokMenipis');
  const list = STATE.stokMenipis || [];

  if (list.length === 0) {
    card.classList.add('d-none');
    return;
  }

  card.classList.remove('d-none');
  tbody.innerHTML = '';
  list.forEach(b => {
    tbody.innerHTML += `
      <tr>
        <td><code>${escHtml(b.barcode)}</code></td>
        <td class="fw-semibold">${escHtml(b.nama)}</td>
        <td class="text-muted">${escHtml(b.kategori)}</td>
        <td class="text-center fw-bold text-danger num">${b.stok}</td>
        <td class="text-center num">${b.minStok}</td>
        <td class="text-end num">${formatRp(b.hargaKulak)}</td>
      </tr>`;
  });
}

function renderMasterBarang() {
  const tbody = document.getElementById('bodyMasterBarang');
  if (!tbody) return;
  const kw = (document.getElementById('cariBarangMaster')?.value || '').toLowerCase().trim();
  const list = (STATE.barangList || []).filter(b => {
    if (!kw) return true;
    return b.nama.toLowerCase().includes(kw) || b.barcode.toLowerCase().includes(kw) || b.kategori.toLowerCase().includes(kw);
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Barang tidak ditemukan</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(b => {
    const tipis = b.stok <= b.minStok;
    tbody.innerHTML += `
      <tr>
        <td>
          <div class="fw-semibold">${escHtml(b.nama)}</div>
          <small class="text-muted"><code>${escHtml(b.barcode)}</code> · ${escHtml(b.kategori)}</small>
        </td>
        <td class="text-end small num">${formatRp(b.hargaKulak)}</td>
        <td class="text-end fw-semibold small num">${formatRp(b.hargaJual)}</td>
        <td class="text-end text-success small num">${formatRp(b.margin)}</td>
        <td class="text-center">
          <span class="badge ${tipis ? 'badge-soft-danger' : 'badge-soft-secondary'} num">${b.stok}</span>
        </td>
        <td class="text-center">
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn btn-outline-primary py-0 px-1" onclick="bukaModalEditBarang('${escJsAttr(b.barcode)}')" title="Edit Harga/Nama">
              <i class="bi bi-pencil"></i>
            </button>
            <button type="button" class="btn btn-outline-warning py-0 px-1 text-dark" onclick="bukaModalOpname('${escJsAttr(b.barcode)}')" title="Stok Opname">
              <i class="bi bi-clipboard-check"></i>
            </button>
          </div>
        </td>
      </tr>`;
  });
}

function bukaModalEditBarang(barcode) {
  const b = (STATE.barangList || []).find(x => x.barcode === barcode);
  if (!b) return;
  document.getElementById('editBrgBarcode').value = b.barcode;
  document.getElementById('editBrgNama').value = b.nama;
  document.getElementById('editBrgKategori').value = b.kategori;
  document.getElementById('editBrgKulak').value = b.hargaKulak;
  document.getElementById('editBrgJual').value = b.hargaJual;
  document.getElementById('editBrgMinStok').value = b.minStok;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditBarang')).show();
}

async function simpanEditBarang() {
  if (isBusy) return;
  const payload = {
    barcode: document.getElementById('editBrgBarcode').value,
    nama: document.getElementById('editBrgNama').value.trim(),
    kategori: document.getElementById('editBrgKategori').value.trim(),
    hargaKulak: document.getElementById('editBrgKulak').value,
    hargaJual: document.getElementById('editBrgJual').value,
    minStok: document.getElementById('editBrgMinStok').value
  };
  if (!payload.nama) {
    showToast('Nama barang wajib diisi.', 'warning');
    return;
  }

  setBusy(true, 'Menyimpan perubahan barang...');
  try {
    const res = await callServer('editBarangMaster', payload, PIN_PENGELOLA_AKTIF);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditBarang')).hide();
    showToast(res.pesan, 'success', 'Barang Diperbarui');
    await muatData('Memperbarui daftar barang...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal edit barang: ' + (err.message || err), 'danger');
  }
}

function bukaModalOpname(barcode) {
  const b = (STATE.barangList || []).find(x => x.barcode === barcode);
  if (!b) return;
  document.getElementById('opnBarcode').value = b.barcode;
  document.getElementById('opnNamaBarang').innerText = `${b.nama} (${b.barcode})`;
  document.getElementById('opnStokSistem').innerText = b.stok;
  document.getElementById('opnStokFisik').value = b.stok;
  document.getElementById('opnAlasanSelect').selectedIndex = 0;
  document.getElementById('opnAlasanText').value = document.getElementById('opnAlasanSelect').value;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalOpname')).show();
}

async function prosesSimpanOpname() {
  if (isBusy) return;
  const payload = {
    barcode: document.getElementById('opnBarcode').value,
    stokFisik: document.getElementById('opnStokFisik').value,
    alasan: document.getElementById('opnAlasanText').value.trim()
  };

  setBusy(true, 'Menyimpan penyesuaian stok opname...');
  try {
    const res = await callServer('simpanStokOpname', payload, PIN_PENGELOLA_AKTIF);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalOpname')).hide();
    showToast(res.pesan, 'success', 'Opname Tersimpan');
    await muatData('Memperbarui stok & log opname...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menyimpan opname: ' + (err.message || err), 'danger');
  }
}

function renderLogOpname() {
  const tbody = document.getElementById('bodyLogOpname');
  if (!tbody) return;
  const list = STATE.logOpname || [];
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Belum ada riwayat penyesuaian opname</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(o => {
    const selClass = o.selisih < 0 ? 'text-danger fw-bold' : (o.selisih > 0 ? 'text-success fw-bold' : 'text-muted');
    const selText = o.selisih > 0 ? `+${o.selisih}` : String(o.selisih);
    tbody.innerHTML += `
      <tr class="small">
        <td class="text-muted">${escHtml(o.waktu)}</td>
        <td class="fw-semibold">${escHtml(o.nama)}</td>
        <td class="text-center num">${o.stokSistem} → <strong>${o.stokFisik}</strong></td>
        <td class="text-center num ${selClass}">${selText}</td>
        <td>${escHtml(o.alasan)}</td>
      </tr>`;
  });
}

function renderMasterAnggota() {
  const tbody = document.getElementById('bodyMasterAnggota');
  if (!tbody) return;
  const kw = (document.getElementById('cariAnggotaMaster')?.value || '').toLowerCase().trim();
  const list = (STATE.anggotaList || []).filter(a => {
    if (!kw) return true;
    return (
      a.nama.toLowerCase().includes(kw) ||
      a.id.toLowerCase().includes(kw) ||
      a.jabatan.toLowerCase().includes(kw) ||
      a.nip.toLowerCase().includes(kw) ||
      a.hp.toLowerCase().includes(kw)
    );
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Pegawai tidak ditemukan</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(a => {
    const aktif = a.status === 'Aktif';
    tbody.innerHTML += `
      <tr>
        <td>
          <div class="fw-semibold">${escHtml(a.nama)}</div>
          <small class="text-muted">${escHtml(a.id)} · ${escHtml(a.jabatan)}${a.hp ? ' · ' + escHtml(a.hp) : ''}</small>
        </td>
        <td><span class="badge ${aktif ? 'badge-soft-success' : 'badge-soft-secondary'}">${escHtml(a.status)}</span></td>
        <td class="text-center">
          <button type="button" class="btn btn-outline-success btn-sm py-0 px-2" onclick="bukaModalEditAnggota('${escJsAttr(a.id)}')" title="Edit Pegawai / Status">
            <i class="bi bi-pencil-square"></i>
          </button>
        </td>
      </tr>`;
  });
}

async function simpanAnggota() {
  if (isBusy) return;
  const nama = document.getElementById('angNama').value.trim();
  if (!nama) {
    showToast('Nama lengkap pegawai wajib diisi.', 'warning');
    return;
  }

  setBusy(true, 'Menambahkan data pegawai...');
  try {
    const res = await callServer('tambahAnggotaBaru', {
      nama: nama,
      nip: document.getElementById('angNip').value.trim(),
      jabatan: document.getElementById('angJabatan').value.trim(),
      hp: document.getElementById('angHp').value.trim()
    }, PIN_PENGELOLA_AKTIF);

    document.getElementById('angNama').value = '';
    document.getElementById('angNip').value = '';
    document.getElementById('angJabatan').value = '';
    document.getElementById('angHp').value = '';
    showToast(res.pesan, 'success', 'Anggota Ditambahkan');
    await muatData('Memperbarui daftar pegawai...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menambah anggota: ' + (err.message || err), 'danger');
  }
}

function bukaModalEditAnggota(idAnggota) {
  const a = (STATE.anggotaList || []).find(x => x.id === idAnggota);
  if (!a) return;
  document.getElementById('editAngId').value = a.id;
  document.getElementById('editAngStatus').value = a.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif';
  document.getElementById('editAngNama').value = a.nama;
  document.getElementById('editAngNip').value = a.nip;
  document.getElementById('editAngJabatan').value = a.jabatan;
  document.getElementById('editAngHp').value = a.hp;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditAnggota')).show();
}

async function simpanEditAnggota() {
  if (isBusy) return;
  const payload = {
    id: document.getElementById('editAngId').value,
    status: document.getElementById('editAngStatus').value,
    nama: document.getElementById('editAngNama').value.trim(),
    nip: document.getElementById('editAngNip').value.trim(),
    jabatan: document.getElementById('editAngJabatan').value.trim(),
    hp: document.getElementById('editAngHp').value.trim()
  };
  if (!payload.nama) {
    showToast('Nama pegawai tidak boleh kosong.', 'warning');
    return;
  }

  setBusy(true, 'Menyimpan perubahan data pegawai...');
  try {
    const res = await callServer('editAnggotaMaster', payload, PIN_PENGELOLA_AKTIF);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditAnggota')).hide();
    showToast(res.pesan, 'success', 'Pegawai Diperbarui');
    await muatData('Memperbarui daftar pegawai...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal memperbarui pegawai: ' + (err.message || err), 'danger');
  }
}

/**
 * ============================================================================
 * MODUL 9: PANEL PENGATURAN ADMIN, ARSIP TUTUP BUKU, WA 1-KLIK & EXCEL MURNI
 * ============================================================================
 */
function sinkronPorsiSHU(sumber) {
  const elBelanja = document.getElementById('setPersenJasaBelanja');
  const elSimpanan = document.getElementById('setPersenJasaSimpanan');
  if (sumber === 'BELANJA') {
    const v = Math.min(100, Math.max(0, Number(elBelanja.value) || 0));
    elSimpanan.value = 100 - v;
  } else {
    const v = Math.min(100, Math.max(0, Number(elSimpanan.value) || 0));
    elBelanja.value = 100 - v;
  }
}

async function simpanPengaturan() {
  if (isBusy) return;
  const payload = {
    TAMPILKAN_SHU_PUBLIK: document.getElementById('setTampilSHU').checked ? 'YA' : 'TIDAK',
    TAMPILKAN_WAJIB_PUBLIK: document.getElementById('setTampilWajib').checked ? 'YA' : 'TIDAK',
    TAMPILKAN_INFO_WAJIB_KASIR: document.getElementById('setTampilNotifKasir').checked ? 'YA' : 'TIDAK',
    NAMA_KOPERASI: document.getElementById('setNamaKoperasi').value.trim(),
    WAJIB_BELANJA_BULANAN: document.getElementById('setWajibBulanan').value,
    PERSEN_SHU_ANGGOTA: document.getElementById('setPersenSHU').value,
    PERSEN_JASA_BELANJA: document.getElementById('setPersenJasaBelanja').value,
    PERSEN_JASA_SIMPANAN: document.getElementById('setPersenJasaSimpanan').value,
    PESAN_WA_WAJIB: document.getElementById('setPesanWaWajib').value.trim(),
    PESAN_WA_BON: document.getElementById('setPesanWaBon').value.trim(),
    PIN_BARU: document.getElementById('setPinBaru').value.trim()
  };

  setBusy(true, 'Menyimpan pengaturan koperasi...');
  try {
    const res = await callServer('simpanPengaturanAdmin', PIN_PENGELOLA_AKTIF, payload);
    PIN_PENGELOLA_AKTIF = res.pinAktif;
    showToast(res.pesan, 'success', 'Pengaturan Disimpan');
    await muatData('Menerapkan pengaturan baru...');
  } catch (err) {
    setBusy(false);
    showToast('Gagal menyimpan pengaturan: ' + (err.message || err), 'danger');
  }
}

async function prosesArsipTutupBuku() {
  if (isBusy) return;
  const thn = document.getElementById('arsipTahunInput').value.trim();
  if (!/^\d{4}$/.test(thn)) {
    showToast('Masukkan 4 digit tahun buku yang valid (misal: 2026).', 'warning');
    return;
  }

  const setuju = await tanyaKonfirmasi(
    `Buat atau perbarui sheet arsip permanen "Arsip_SHU_${thn}" di file Google Sheet sebagai dokumentasi resmi RAT?`,
    { judul: 'Arsip Tutup Buku Tahunan', teksYa: 'Ya, Buat Sheet Arsip' }
  );
  if (!setuju) return;

  setBusy(true, `Membuat sheet arsip Arsip_SHU_${thn}...`);
  try {
    const res = await callServer('arsipTutupBukuSHU', thn, PIN_PENGELOLA_AKTIF);
    setBusy(false);
    showToast(res.pesan, 'success', 'Arsip RAT Selesai');
  } catch (err) {
    setBusy(false);
    showToast('Gagal membuat arsip: ' + (err.message || err), 'danger');
  }
}

function formatNomorWa(hp) {
  let clean = String(hp || '').replace(/[^0-9]/g, '');
  if (!clean) return '';
  if (clean.startsWith('0')) clean = '62' + clean.slice(1);
  return clean;
}

function kirimWaWajib(idAnggota) {
  const r = (STATE.rekapWajib || []).find(x => x.id === idAnggota);
  if (!r) return;
  const noWa = formatNomorWa(r.hp);
  if (!noWa) {
    showToast(`Nomor WA untuk ${r.nama} belum diisi. Lengkapi di tab Stok, Opname & Anggota.`, 'warning');
    return;
  }

  const template = STATE.config.PESAN_WA_WAJIB ||
    'Assalamualaikum Bapak/Ibu {NAMA}, mengingatkan kuota wajib belanja koperasi bulan {BULAN} masih kurang {KURANG}. Terima kasih.';
  const pesan = template
    .replace(/\{NAMA\}/g, r.nama)
    .replace(/\{BULAN\}/g, STATE.periodeBulan)
    .replace(/\{KURANG\}/g, formatRp(r.kurangWajib));

  window.open(`https://wa.me/${noWa}?text=${encodeURIComponent(pesan)}`, '_blank');
}

function kirimWaBon(idAnggota) {
  const b = (STATE.rekapBonBulanan || []).find(x => x.idAnggota === idAnggota);
  if (!b) return;
  const noWa = formatNomorWa(b.hp);
  if (!noWa) {
    showToast(`Nomor WA untuk ${b.nama} belum diisi. Lengkapi di tab Stok, Opname & Anggota.`, 'warning');
    return;
  }

  const template = STATE.config.PESAN_WA_BON ||
    'Assalamualaikum Bapak/Ibu {NAMA}, informasi total tagihan Potong Gaji Koperasi bulan {BULAN} sebesar {TAGIHAN}. Terima kasih.';
  const pesan = template
    .replace(/\{NAMA\}/g, b.nama)
    .replace(/\{BULAN\}/g, STATE.periodeBulan)
    .replace(/\{TAGIHAN\}/g, formatRp(b.belumLunas));

  window.open(`https://wa.me/${noWa}?text=${encodeURIComponent(pesan)}`, '_blank');
}

function getLocalDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Export Excel (.xlsx) dengan ANGKA MURNI (langsung bisa di-SUM) & lebar kolom otomatis
 */
function exportLaporanExcel(jenis) {
  if (typeof XLSX === 'undefined') {
    showToast('Pustaka Excel belum siap. Periksa koneksi internet lalu Refresh.', 'danger');
    return;
  }

  let rows = [];
  let sheetTitle = 'Laporan';
  let filePrefix = 'Laporan_Koperasi';
  let stempel = STATE.periodeBulan || getLocalYearMonth();

  if (jenis === 'wajib') {
    sheetTitle = 'Wajib Belanja';
    filePrefix = 'Rekap_Wajib_Belanja';
    rows = (STATE.rekapWajib || []).map(r => ({
      'ID Anggota': r.id,
      'Nama Pegawai': r.nama,
      'Jabatan / Unit': r.jabatan,
      'Belanja Bulan Ini (Rp)': Number(r.belanjaBulanIni) || 0,
      'Kekurangan Wajib (Rp)': Number(r.kurangWajib) || 0,
      'Status Wajib': r.statusWajib
    }));
  } else if (jenis === 'riwayat') {
    sheetTitle = 'Riwayat Transaksi';
    filePrefix = 'Riwayat_Transaksi';
    rows = (STATE.riwayatTransaksi || []).map(t => ({
      'ID Transaksi': t.idTrx,
      'Waktu': t.waktu,
      'ID Anggota': t.idAng,
      'Nama Pegawai': t.namaAng,
      'Rincian Barang': t.rincian,
      'Total Belanja (Rp)': Number(t.totalBelanja) || 0,
      'Laba Kotor (Rp)': Number(t.labaKotor) || 0,
      'Metode Bayar': t.metodeBayar,
      'Status Bayar': t.statusBayar,
      'Status Transaksi': t.statusTransaksi
    }));
  } else if (jenis === 'bon') {
    sheetTitle = 'Potong Gaji';
    filePrefix = 'Tagihan_Potong_Gaji';
    rows = (STATE.rekapBonBulanan || []).map(b => ({
      'ID Anggota': b.idAnggota,
      'NIP / NIY': b.nip,
      'Nama Pegawai': b.nama,
      'Jabatan': b.jabatan,
      'Jumlah Transaksi': Number(b.jumlahTrx) || 0,
      'Total Bon (Rp)': Number(b.totalTagihan) || 0,
      'Sudah Lunas (Rp)': Number(b.sudahLunas) || 0,
      'Belum Lunas (Rp)': Number(b.belumLunas) || 0,
      'Status': b.belumLunas <= 0 ? 'Lunas' : 'Belum Lunas'
    }));
  } else if (jenis === 'shu') {
    sheetTitle = 'Pembagian SHU';
    filePrefix = 'Pembagian_SHU_Koperasi';
    stempel = STATE.tahunPilih || String(new Date().getFullYear());
    rows = (STATE.rekapSHU || []).map(m => ({
      'ID Anggota': m.id,
      'NIP / NIY': m.nip,
      'Nama Pegawai': m.nama,
      'Jabatan': m.jabatan,
      'Status': m.status,
      'Frekuensi Belanja': Number(m.frekuensiTahunan) || 0,
      'Total Belanja (Rp)': Number(m.totalBelanjaTahunan) || 0,
      'Total Simpanan (Rp)': Number(m.totalSimpananTahunan) || 0,
      'SHU Jasa Belanja (Rp)': Number(m.shuBelanja) || 0,
      'SHU Jasa Simpanan (Rp)': Number(m.shuSimpanan) || 0,
      'Total SHU Diterima (Rp)': Number(m.totalSHU) || 0
    }));
  } else if (jenis === 'stok_menipis') {
    sheetTitle = 'Daftar Kulakan';
    filePrefix = 'Daftar_Belanja_Kulakan';
    stempel = getLocalDateStr();
    rows = (STATE.stokMenipis || []).map(b => ({
      'Barcode': b.barcode,
      'Nama Barang': b.nama,
      'Kategori': b.kategori,
      'Sisa Stok': Number(b.stok) || 0,
      'Min. Stok': Number(b.minStok) || 0,
      'Harga Kulak Terakhir (Rp)': Number(b.hargaKulak) || 0
    }));
  }

  if (rows.length === 0) {
    showToast('Tidak ada data untuk diekspor ke Excel.', 'warning');
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0]);
  ws['!cols'] = headers.map(h => {
    let maxLen = h.length;
    rows.forEach(r => {
      const len = String(r[h] === null || r[h] === undefined ? '' : r[h]).length;
      if (len > maxLen) maxLen = len;
    });
    return { wch: Math.min(42, maxLen + 3) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
  XLSX.writeFile(wb, `${filePrefix}_${stempel}.xlsx`);
  showToast(`File ${filePrefix}_${stempel}.xlsx berhasil diunduh.`, 'success', 'Export Excel');
}
