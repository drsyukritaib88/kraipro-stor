// ==========================================
// FAIL: app.js
// Tujuan: Pemprosesan Logik Utama KraiPRO STOR
// ==========================================


// ------------------------------------------
// 1. PEMBOLEHUBAH GLOBAL & KEADAAN (STATE)
// ------------------------------------------
let items = [...initialMasterItems];
let pembekalList = [...initialMasterPembekal];
let requests = [];
let lpoList = [];
let auditLogs = [];

// SuperAdmin (juga ditetapkan dalam firestore.rules - mesti sama)
const SUPERADMIN_EMAIL = "pkpkk@moh.gov.my";

// Pengguna berdaftar (koleksi kraipro_users): Pegawai Pelulus & Pemohon
let appUsers = [];
let approverUsers = [];

// Status Sesi Pengguna (diisi selepas log masuk Firebase Auth)
let isAdminLoggedIn = false; // true untuk SuperAdmin & Pegawai Pelulus
let currentUserRole = ''; // 'superadmin' | 'pelulus' | 'pemohon'
let currentUserEmail = '';
let currentUserAllowedCategories = [];
let currentApproverData = null;
let currentUserProfile = null;

let inactivityTimer = null;
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000; // 60 Minit (3,600,000 ms)

// Kawalan Muka Surat (Pagination)
let bakiPage = 1;
let bakiPageSize = 25;
let masterPage = 1;
let masterPageSize = 25;

// Pembolehubah Draf Borang
let draftReqItems = [];
let draftLpoItems = [];
let currentReqCatTab = 'all';
let currentApprovalCatTab = 'all';

// Graf Chart.js
let topChartInstance = null;

// Tetapan Kategori & Sub-Kategori
let subcategories = {
  "Bahan Pergigian (Kontrak)": ["Restoratif", "Periodontik", "Ortodontik", "Endodontik", "Bedah Mulut", "Prostodontik", "APD / Pencegahan", "PPE", "Lab"],
  "Bahan Pergigian (Bukan Kontrak)": ["Restoratif", "Periodontik", "Ortodontik", "Endodontik", "Bedah Mulut", "Prostodontik", "APD / Pencegahan", "CONSUMABLES", "Rendaman", "HandHygiene", "Autoclave", "Ubat", "Instrument", "Xray", "Lab"],
  "Alat Tulis": ["Kertas & Buku", "Alat Menulis", "Fail & Folder", "Toner & Dakwat", "Resit"],
  "Bekalan Am": ["Perkakas Pejabat", "Bekalan Kebersihan", "Lain-lain Bekalan Am"],
  "Bahan Promosi": ["Risalah / Pamflet", "Bunting & Banner", "Cenderamata / Souvenir", "Poster & Model", "Pameran & Promosi"]
};

let packagingUnits = [
  "Box", "Syringe", "Pax", "Bottle", "Pkt", "Roll", "Tub", "Set", "Unit", "Tube", "Reel", "Rim", "Buku", "Keping"
];

// Firebase
let auth = null;
let db = null;
let firestorePermissionDenied = false;
let firestoreUnsubscribers = [];
let authMode = 'login'; // pendaftaran kata laluan tidak lagi digunakan (log masuk Google)

// Config EmailJS (notifikasi permohonan baharu kepada pelulus)
const EMAILJS_PUBLIC_KEY = "BoCCW085jSDyXH5Am";
const EMAILJS_SERVICE_ID = "PKPD_KualaKrai";
const EMAILJS_TEMPLATE_ID = "PKPD_KualaKrai";


// ------------------------------------------
// 2. PENYEGERAKAN DATA (CLOUD FIRESTORE)
// ------------------------------------------
function stateDocRef() {
  return db.collection('kraipro_store').doc('live_inventory_state');
}

function requestRef(reqId) {
  return db.collection('kraipro_requests').doc(String(reqId));
}

// Tarikh hari ini (YYYY-MM-DD) mengikut waktu Malaysia, bukan UTC
// (UTC menyebabkan rekod antara 12:00 malam - 8:00 pagi mendapat tarikh semalam)
function todayISODate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// Tarikh (YYYY-MM-DD, waktu Malaysia) bagi cap masa ISO
function todayISODateOf(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso || '').slice(0, 10) : d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// Paparan tarikh: dd-mm-yyyy (data disimpan sebagai YYYY-MM-DD)
function formatDate(val) {
  const s = String(val || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

// Paparan tarikh & masa: dd-mm-yyyy HH:MM (waktu Malaysia)
function formatDateTime(val) {
  const d = val instanceof Date ? val : new Date(val);
  if (!val || isNaN(d.getTime())) return String(val || '');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

function setSyncBadge(state, text) {
  const syncDot = document.getElementById('firestore-sync-dot');
  const syncText = document.getElementById('firestore-sync-text');
  const dotClass = { ok: 'bg-emerald-400', wait: 'bg-amber-400 animate-pulse', error: 'bg-rose-500' }[state] || 'bg-slate-400';
  if (syncDot) syncDot.className = `h-2 w-2 rounded-full ${dotClass}`;
  if (syncText) syncText.innerText = text;
}

function initFirebase() {
  try {
    if (typeof firebase === 'undefined' || !firebase.apps.length) {
      throw new Error('Konfigurasi Firebase (/__/firebase/init.js) tidak dimuatkan.');
    }
    auth = firebase.auth();
    db = firebase.firestore();

    // Ujian tempatan: guna Firebase Emulator (firebase emulators:start)
    if (['localhost', '127.0.0.1'].includes(location.hostname)) {
      auth.useEmulator('http://127.0.0.1:9099');
      db.useEmulator('127.0.0.1', 8080);
    }
  } catch (err) {
    console.error(err);
    showAuthStep('login');
    showAuthMessage('error', 'Sistem tidak dapat menyambung ke Firebase. Sila buka aplikasi melalui alamat rasmi (https://kraipro-stor.web.app).');
    return;
  }

  preserveLegacyLocalCache();

  // Sesi tamat apabila tab/pelayar ditutup (penting untuk komputer klinik yang dikongsi)
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
    .catch(err => console.warn('Gagal menetapkan sesi log masuk:', err))
    .finally(() => {
      auth.onAuthStateChanged(handleAuthStateChanged);
      auth.getRedirectResult().catch(err => {
        showAuthStep('login');
        showAuthMessage('error', authErrorMessage(err));
      });
    });
}

// Versi lama menyimpan salinan data dalam localStorage ("Mod Tempatan").
// Simpan salinan itu sebagai sandaran sekali sahaja supaya tidak hilang.
const LEGACY_BACKUP_KEY = 'kraipro_backup_sebelum_auth';
const LEGACY_CACHE_KEYS = ['kraipro_items', 'kraipro_pembekal', 'kraipro_requests', 'kraipro_lpo', 'kraipro_audit', 'kraipro_approvers_list'];

function preserveLegacyLocalCache() {
  try {
    const backup = {};
    LEGACY_CACHE_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) backup[k] = v;
    });
    if (Object.keys(backup).length === 0) return;
    if (!localStorage.getItem(LEGACY_BACKUP_KEY)) {
      localStorage.setItem(LEGACY_BACKUP_KEY, JSON.stringify({ disimpanPada: new Date().toISOString(), data: backup }));
    }
    LEGACY_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('kraipro_admin_remember');
  } catch (err) {
    console.warn('Gagal menyimpan sandaran tempatan lama:', err);
  }
}

function downloadLegacyLocalBackup() {
  let raw = null;
  try { raw = localStorage.getItem(LEGACY_BACKUP_KEY); } catch (e) {}
  if (!raw) {
    showToast('Tiada sandaran tempatan lama pada peranti ini.', 'info');
    return;
  }
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `KraiPRO_Sandaran_Tempatan_${todayISODate()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function updateLegacyBackupButton() {
  const btn = document.getElementById('legacy-backup-btn');
  if (!btn) return;
  let has = false;
  try { has = !!localStorage.getItem(LEGACY_BACKUP_KEY); } catch (e) {}
  btn.classList.toggle('hidden', !(has && currentUserRole === 'superadmin'));
}

function stopFirestoreListeners() {
  firestoreUnsubscribers.forEach(unsub => {
    try { unsub(); } catch (e) {}
  });
  firestoreUnsubscribers = [];
}

function onFirestoreError(label) {
  return (error) => {
    console.warn(`Firestore (${label}):`, error);
    if (error && error.code === 'permission-denied') firestorePermissionDenied = true;
    setSyncBadge('error', firestorePermissionDenied ? 'Akses Ditolak' : 'Ralat Sambungan');
  };
}

function startFirestoreListeners() {
  stopFirestoreListeners();
  firestorePermissionDenied = false;
  setSyncBadge('wait', 'Menyambung Cloud...');

  // Popup "Memuatkan data" sehingga data stok pertama diterima (atau ralat / 15 saat)
  const loadToken = showLoadingOverlay('Memuatkan data...');
  let firstLoadDone = false;
  const finishFirstLoad = () => {
    if (firstLoadDone) return;
    firstLoadDone = true;
    hideLoadingOverlay(loadToken);
  };
  setTimeout(finishFirstLoad, 15000);

  // Stok induk, pembekal & LPO
  firestoreUnsubscribers.push(stateDocRef().onSnapshot((snap) => {
    finishFirstLoad();
    if (!snap.exists) {
      // Kali pertama: cipta dokumen daripada data permulaan (data.js)
      if (isAdminLoggedIn) syncStateToFirestore();
      return;
    }
    const data = snap.data();
    if (Array.isArray(data.items)) items = data.items.filter(i => i && typeof i === 'object').map(i => ({ ...i, id: String(i.id), baki: toInt(i.baki), reorder: toInt(i.reorder), paraMin: toInt(i.paraMin), paraMaks: toInt(i.paraMaks), harga: parseFloat(i.harga) || 0 }));
    if (Array.isArray(data.pembekalList)) pembekalList = data.pembekalList;
    // LPO format lama (dalam dokumen stok): papar sementara & pindahkan ke koleksi kraipro_lpo
    legacyStateLpo = Array.isArray(data.lpoList) ? data.lpoList.filter(l => l && typeof l === 'object') : [];
    if (legacyStateLpo.length && isAdminLoggedIn) migrateLpoToCollection(legacyStateLpo);
    rebuildLpoList();
    setSyncBadge('ok', 'Cloud Synced');
    renderAll();
  }, (err) => { finishFirstLoad(); onFirestoreError('stok')(err); }));

  // Permohonan:
  //  - Pemohon: permohonan sendiri sahaja
  //  - Pelulus/SuperAdmin: tahun semasa + tahun lepas, dan SEMUA yang masih Pending (jimat bacaan Firestore);
  //    permohonan lebih lama dimuatkan hanya apabila diminta (loadOlderRequests)
  const reqCol = db.collection('kraipro_requests');
  const toRequests = (qs) => qs.docs.map(d => sanitizeRequest(d.data())).filter(Boolean);
  if (isAdminLoggedIn) {
    firestoreUnsubscribers.push(reqCol.where('tarikh', '>=', requestWindowStart()).onSnapshot((qs) => {
      requestSources.recent = toRequests(qs);
      rebuildRequests();
    }, onFirestoreError('permohonan')));
    firestoreUnsubscribers.push(reqCol.where('status', '==', 'Pending').onSnapshot((qs) => {
      requestSources.pending = toRequests(qs);
      rebuildRequests();
    }, onFirestoreError('permohonan')));
  } else {
    firestoreUnsubscribers.push(reqCol.where('ownerEmail', '==', currentUserEmail).onSnapshot((qs) => {
      requestSources.own = toRequests(qs);
      rebuildRequests();
    }, onFirestoreError('permohonan')));
  }

  // Pesanan LPO (pelulus & SuperAdmin)
  if (isAdminLoggedIn) {
    firestoreUnsubscribers.push(db.collection('kraipro_lpo').onSnapshot((qs) => {
      lpoCollection = qs.docs.map(d => sanitizeLpo({ ...d.data(), id: d.id }));
      rebuildLpoList();
      renderAll();
    }, onFirestoreError('lpo')));
  }

  // Senarai pengguna berdaftar (untuk notifikasi pelulus & pengurusan pengguna)
  firestoreUnsubscribers.push(db.collection('kraipro_users').onSnapshot((qs) => {
    appUsers = qs.docs.map(d => ({ id: d.id, ...d.data() }));
    approverUsers = appUsers.filter(u => u.role === 'pelulus');
    renderApproversTable();
    if (currentUserRole === 'superadmin') syncAllowlist();
  }, onFirestoreError('pengguna')));

  // Permohonan akses (SuperAdmin sahaja)
  if (currentUserRole === 'superadmin') {
    firestoreUnsubscribers.push(db.collection('kraipro_access_requests').onSnapshot((qs) => {
      accessRequests = qs.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
      renderAccessRequests();
    }, onFirestoreError('permohonan akses')));
  }

  // Stor klinik (penjaga stor klinik & pentadbir)
  startKlinikListeners();

  // Log audit (pelulus & SuperAdmin sahaja)
  if (isAdminLoggedIn) {
    firestoreUnsubscribers.push(db.collection('kraipro_audit').orderBy('createdAt', 'desc').limit(200).onSnapshot((qs) => {
      auditLogs = qs.docs.map(d => ({ docId: d.id, ...d.data() }));
      renderAuditTrail();
    }, onFirestoreError('audit')));
  }
}

// ---- Permohonan: gabungan beberapa sumber (tempoh semasa, Pending, lama, milik sendiri) ----
const REQUEST_RECENT_YEARS = 2; // tahun semasa + tahun lepas
let requestSources = { recent: [], pending: [], older: [], own: [] };
let olderRequestsLoaded = false;

function requestWindowStart() {
  return `${parseInt(todayISODate().slice(0, 4)) - (REQUEST_RECENT_YEARS - 1)}-01-01`;
}

function rebuildRequests() {
  const byId = new Map();
  [...requestSources.older, ...requestSources.recent, ...requestSources.pending, ...requestSources.own]
    .forEach(r => byId.set(r.id, r));
  requests = [...byId.values()].sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id).localeCompare(String(a.id))
  );
  renderAll();
}

// Muat permohonan sebelum tempoh semasa (sekali sahaja, tidak dipantau secara langsung)
async function loadOlderRequests() {
  if (!isAdminLoggedIn || olderRequestsLoaded) return;
  const token = showLoadingOverlay('Memuatkan permohonan lama...');
  try {
    const qs = await db.collection('kraipro_requests').where('tarikh', '<', requestWindowStart()).get();
    requestSources.older = qs.docs.map(d => sanitizeRequest(d.data())).filter(Boolean);
    olderRequestsLoaded = true;
    rebuildRequests();
    showToast(`${requestSources.older.length} permohonan lama dimuatkan.`, 'info');
  } catch (err) {
    showToast('Gagal memuatkan permohonan lama: ' + authErrorMessage(err), 'error');
  } finally {
    hideLoadingOverlay(token);
  }
}

// ---- LPO: koleksi kraipro_lpo (+ senarai lama dalam dokumen stok semasa peralihan) ----
let lpoCollection = [];
let legacyStateLpo = [];
let lpoMigrationRunning = false;

function sanitizeLpo(l) {
  return { ...l, items: Array.isArray(l.items) ? l.items.map(i => ({ ...i, qty: toInt(i.qty) })) : [] };
}

// ID tetap untuk LPO yang dipindahkan, supaya pemindahan berulang tidak mencipta salinan
function migratedLpoId(l, idx) {
  const slug = String(l.no || 'lpo').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  return `mig_${idx}_${slug}`;
}

function rebuildLpoList() {
  const known = new Set(lpoCollection.map(l => String(l.no).toLowerCase()));
  const legacy = legacyStateLpo
    .map((l, idx) => sanitizeLpo({ ...l, id: migratedLpoId(l, idx), _legacy: true }))
    .filter(l => !known.has(String(l.no).toLowerCase()));
  lpoList = [...lpoCollection, ...legacy].sort((a, b) =>
    String(b.createdAt || b.tarikh || '').localeCompare(String(a.createdAt || a.tarikh || '')) || String(b.no).localeCompare(String(a.no))
  );
}

// Pindahkan LPO dari dokumen stok ke koleksi kraipro_lpo (sekali; selamat diulang)
async function migrateLpoToCollection(legacyList) {
  if (lpoMigrationRunning || !isAdminLoggedIn) return;
  lpoMigrationRunning = true;
  try {
    const ops = legacyList.map((l, idx) => b => b.set(db.collection('kraipro_lpo').doc(migratedLpoId(l, idx)), {
      ...l,
      id: migratedLpoId(l, idx),
      items: Array.isArray(l.items) ? l.items : [],
      no: String(l.no || ''),
      createdAt: l.createdAt || `${l.tarikh || '1970-01-01'}T00:00:00.000Z`,
      sumberMigrasi: 'live_inventory_state'
    }));
    // Batch terakhir juga membuang lpoList dari dokumen stok (atomik dengan baki LPO)
    ops.push(b => b.update(stateDocRef(), { lpoList: firebase.firestore.FieldValue.delete() }));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => op(batch));
      await batch.commit();
    }
    addAuditLog('Migrasi LPO', `${legacyList.length} pesanan LPO dipindahkan ke koleksi berasingan.`);
  } catch (err) {
    console.warn('Pemindahan LPO gagal:', err);
  } finally {
    lpoMigrationRunning = false;
  }
}

// Pastikan senarai e-mel dibenarkan sepadan dengan senarai pengguna (SuperAdmin sahaja)
let allowlistSyncRunning = false;
async function syncAllowlist() {
  if (allowlistSyncRunning || currentUserRole !== 'superadmin') return;
  allowlistSyncRunning = true;
  try {
    const existing = new Set((await db.collection('kraipro_allowlist').get()).docs.map(d => d.id));
    const wanted = new Set(appUsers.map(u => u.id));
    const ops = [];
    wanted.forEach(id => { if (!existing.has(id)) ops.push(b => b.set(db.collection('kraipro_allowlist').doc(id), { aktif: true })); });
    existing.forEach(id => { if (!wanted.has(id)) ops.push(b => b.delete(db.collection('kraipro_allowlist').doc(id))); });
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => op(batch));
      await batch.commit();
    }
  } catch (err) {
    console.warn('Penyelarasan senarai e-mel dibenarkan gagal:', err);
  } finally {
    allowlistSyncRunning = false;
  }
}

// Pulangkan Promise<boolean>: true jika berjaya disimpan ke Cloud
function saveState() {
  updateAdminTaskBadges();
  return syncStateToFirestore();
}

// Tulis stok induk, pembekal & LPO (pelulus/SuperAdmin sahaja - dikuatkuasa oleh firestore.rules)
function syncStateToFirestore() {
  if (!db || !isAdminLoggedIn) return Promise.resolve(false);
  const payload = {
    items: items,
    pembekalList: pembekalList,
    lastUpdated: new Date().toISOString()
  };

  return stateDocRef().set(payload, { merge: true })
    .then(() => true)
    .catch(err => {
      console.warn("Firestore sync warning:", err);
      showToast('Gagal menyimpan ke Cloud: ' + (err.message || err), 'error');
      return false;
    });
}

// Kemas kini stok secara atomik (transaksi) supaya tidak menindih perubahan pengguna lain.
// `mutator(tx, fresh)` menerima data stok terkini { items } dan boleh mengubahnya terus.
function runStockTransaction(mutator) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(stateDocRef());
    const data = snap.exists ? snap.data() : {};
    const fresh = {
      items: Array.isArray(data.items) ? data.items : JSON.parse(JSON.stringify(items))
    };
    const result = await mutator(tx, fresh);
    tx.set(stateDocRef(), { items: fresh.items, lastUpdated: new Date().toISOString() }, { merge: true });
    return result;
  });
}

// Pindahkan data format lama (semua dalam satu dokumen) ke koleksi baharu. Dijalankan oleh SuperAdmin sekali sahaja.
async function migrateLegacyData() {
  try {
    const snap = await stateDocRef().get();
    if (!snap.exists) return;
    const data = snap.data();
    if (!('requests' in data) && !('auditLogs' in data) && !('approverUsers' in data)) return;

    const legacyReqs = Array.isArray(data.requests) ? data.requests : [];
    const legacyAudit = Array.isArray(data.auditLogs) ? data.auditLogs : [];
    const legacyApprovers = Array.isArray(data.approverUsers) ? data.approverUsers : [];

    const ops = [];
    const year = new Date().getFullYear();
    let maxSeq = 0;
    const trackSeq = (id) => {
      const m = /^BPSI-(\d{4})-(\d+)$/.exec(id);
      if (m && parseInt(m[1]) === year) maxSeq = Math.max(maxSeq, parseInt(m[2]));
    };

    const existingReqs = {};
    (await db.collection('kraipro_requests').get()).forEach(d => {
      existingReqs[d.id] = d.data();
      trackSeq(d.id);
    });

    // Permohonan: yang lama dahulu supaya nombor asal dikekalkan; nombor bertindih diberi akhiran -2, -3...
    const claimedIds = new Set();
    legacyReqs.slice().reverse().forEach(r => {
      if (!r || !r.id) return;
      const baseId = String(r.id).replace(/\//g, '-');
      let id = baseId;
      let n = 2;
      while (claimedIds.has(id) || (existingReqs[id] && !existingReqs[id].sumberMigrasi)) id = `${baseId}-${n++}`;
      claimedIds.add(id);
      if (existingReqs[id]) return; // telah dipindahkan dalam larian sebelum ini
      trackSeq(id);
      ops.push(b => b.set(requestRef(id), {
        ...r,
        id,
        ownerEmail: r.ownerEmail || '',
        createdAt: r.createdAt || `${r.tarikh || '1970-01-01'}T00:00:00.000Z`,
        sumberMigrasi: 'live_inventory_state'
      }));
    });

    // Pegawai pelulus
    const existingUsers = {};
    (await db.collection('kraipro_users').get()).forEach(d => { existingUsers[d.id] = true; });
    legacyApprovers.forEach(a => {
      const email = String(a.email || '').trim().toLowerCase();
      if (!email || email === SUPERADMIN_EMAIL.toLowerCase() || existingUsers[email]) return;
      existingUsers[email] = true;
      ops.push(b => b.set(db.collection('kraipro_users').doc(email), {
        email,
        nama: a.nama || '',
        jawatan: a.jawatan || '',
        role: 'pelulus',
        allowedCategories: Array.isArray(a.allowedCategories) ? a.allowedCategories : []
      }));
    });

    // Log audit lama (susunan dikekalkan; diletakkan sebelum log baharu)
    const baseTime = Date.now() - 24 * 60 * 60 * 1000;
    legacyAudit.forEach((log, idx) => {
      ops.push(b => b.set(db.collection('kraipro_audit').doc(), {
        createdAt: new Date(baseTime - idx * 1000).toISOString(),
        timestamp: log.timestamp || '',
        userRole: log.userRole || '',
        userEmail: SUPERADMIN_EMAIL,
        actionType: log.actionType || '',
        details: `${log.details || ''} [migrasi]`
      }));
    });

    // Pembilang nombor permohonan tahun semasa
    const counterRef = db.collection('kraipro_counters').doc(`bpsi_${year}`);
    const counterSnap = await counterRef.get();
    const currentSeq = counterSnap.exists ? (counterSnap.data().seq || 0) : 0;
    if (maxSeq > currentSeq) ops.push(b => b.set(counterRef, { seq: maxSeq }));

    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => op(batch));
      await batch.commit();
    }

    const del = firebase.firestore.FieldValue.delete();
    await stateDocRef().update({ requests: del, auditLogs: del, approverUsers: del });

    addAuditLog('Migrasi Data', `${legacyReqs.length} permohonan, ${legacyApprovers.length} pelulus dan ${legacyAudit.length} log audit dipindahkan ke format baharu.`);
    showToast('Data lama berjaya dipindahkan ke format Cloud baharu.', 'success');
  } catch (err) {
    console.error('Migrasi data gagal:', err);
    showToast('Migrasi data lama gagal: ' + (err.message || err), 'error');
  }
}


// ------------------------------------------
// 3. JEJAK AUDIT / AUDIT TRAIL
// ------------------------------------------
// ID yang selamat untuk diletakkan dalam atribut HTML / id elemen
const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;

function toInt(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

// Permohonan boleh ditulis oleh Pemohon - pastikan bentuknya selamat sebelum dipaparkan
function sanitizeRequest(r) {
  if (!r || !SAFE_ID_RE.test(String(r.id || ''))) return null;
  return {
    ...r,
    id: String(r.id),
    items: Array.isArray(r.items)
      ? r.items.filter(i => i && typeof i === 'object').map(i => ({ ...i, qtyMohon: toInt(i.qtyMohon), qtyLulus: toInt(i.qtyLulus) }))
      : []
  };
}

function escapeHtml(val) {
  return String(val ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addAuditLog(actionType, details) {
  if (!db || !currentUserEmail) return;
  const now = new Date();
  const roleName = (currentUserRole || 'pemohon').toUpperCase();

  db.collection('kraipro_audit').add({
    createdAt: now.toISOString(),
    timestamp: formatDateTime(now),
    userRole: `${roleName} (${currentUserEmail})`,
    userEmail: currentUserEmail,
    actionType: actionType,
    details: details
  }).catch(err => console.warn('Gagal merekod log audit:', err));
}

// Masa log audit: dari createdAt (dd-mm-yyyy HH:MM); log migrasi kekalkan teks masa asal
function auditLogTime(log) {
  const migrated = String(log.details || '').endsWith('[migrasi]');
  return !migrated && log.createdAt ? formatDateTime(log.createdAt) : legacyTimestampToDisplay(log.timestamp);
}

// Tukar teks masa format lama (cth "18/09/2026, 2:05:00 PTG") kepada dd-mm-yyyy HH:MM
function legacyTimestampToDisplay(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(PG|PTG|AM|PM)?/i.exec(String(text || '').trim());
  if (!m) return text || '';
  let hour = parseInt(m[4]);
  const ampm = (m[6] || '').toUpperCase();
  if ((ampm === 'PTG' || ampm === 'PM') && hour < 12) hour += 12;
  if ((ampm === 'PG' || ampm === 'AM') && hour === 12) hour = 0;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(m[1])}-${pad(m[2])}-${m[3]} ${pad(hour)}:${m[5]}`;
}

function renderAuditTrail() {
  const tbody = document.getElementById('audit-trail-table-body');
  if (!tbody) return;

  if (auditLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Tiada log aktiviti direkodkan lagi.</td></tr>`;
    return;
  }

  tbody.innerHTML = auditLogs.map(log => `
    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-slate-500 whitespace-nowrap">${escapeHtml(auditLogTime(log))}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-800">${escapeHtml(log.userRole)}</span>
      </td>
      <td class="p-3 font-bold text-slate-800">${escapeHtml(log.actionType)}</td>
      <td class="p-3 text-slate-600">${escapeHtml(log.details)}</td>
    </tr>
  `).join('');
}

function clearAuditTrailLogs() {
  if (currentUserRole !== 'superadmin') {
    showToast('Hanya SuperAdmin boleh membersihkan log audit.', 'error');
    return;
  }
  showConfirmModal('Bersihkan Log Audit', 'Adakah anda pasti mahu memadam semua rekod jejak audit?', async () => {
    const loadingToken = showLoadingOverlay('Membersihkan log audit...');
    try {
      const qs = await db.collection('kraipro_audit').get();
      for (let i = 0; i < qs.docs.length; i += 400) {
        const batch = db.batch();
        qs.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      addAuditLog('Bersihkan Log Audit', `${qs.size} rekod log audit telah dipadam.`);
      showToast('Log jejak audit telah dibersihkan.', 'info');
    } catch (err) {
      showToast('Gagal membersihkan log audit: ' + (err.message || err), 'error');
    } finally {
      hideLoadingOverlay(loadingToken);
    }
  });
}


// ------------------------------------------
// 3b. SANDARAN PENUH & PEMULIHAN DATA (SUPERADMIN)
// ------------------------------------------
const BACKUP_FORMAT = 'kraipro-stor-backup';
const BACKUP_VERSION = 1;
const LAST_BACKUP_KEY = 'kraipro_sandaran_terakhir';
let pendingRestore = null;

// Baca SEMUA data terus dari Firestore (bukan salinan dalam pelayar)
async function collectFullBackup() {
  const docsOf = async (name) => (await db.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const stateSnap = await stateDocRef().get();
  const [requestsAll, usersAll, auditAll, countersAll, lpoAll, klinikAll, klinikLogAll] = await Promise.all([
    docsOf('kraipro_requests'), docsOf('kraipro_users'), docsOf('kraipro_audit'), docsOf('kraipro_counters'), docsOf('kraipro_lpo'),
    docsOf('kraipro_klinik'), docsOf('kraipro_klinik_log')
  ]);
  const state = stateSnap.exists ? stateSnap.data() : { items: [], pembekalList: [] };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: currentUserEmail,
    projectId: (firebase.app().options || {}).projectId || '',
    counts: backupCounts({ state, requests: requestsAll, users: usersAll, audit: auditAll, lpo: lpoAll }),
    data: { state, requests: requestsAll, users: usersAll, audit: auditAll, counters: countersAll, lpo: lpoAll, klinik: klinikAll, klinikLog: klinikLogAll }
  };
}

function backupCounts(d) {
  return {
    items: (d.state.items || []).length,
    pembekal: (d.state.pembekalList || []).length,
    lpo: backupLpoList(d).length,
    requests: d.requests.length,
    users: d.users.length,
    audit: d.audit.length
  };
}

// LPO dalam sandaran: koleksi kraipro_lpo (baharu) atau lpoList dalam dokumen stok (sandaran lama)
function backupLpoList(d) {
  const fromCollection = Array.isArray(d.lpo) ? d.lpo : [];
  const legacy = Array.isArray(d.state && d.state.lpoList) ? d.state.lpoList.map((l, idx) => ({ ...l, id: migratedLpoId(l, idx) })) : [];
  const known = new Set(fromCollection.map(l => String(l.no).toLowerCase()));
  return [...fromCollection, ...legacy.filter(l => !known.has(String(l.no).toLowerCase()))];
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function backupFilename(prefix) {
  const now = new Date();
  const stamp = `${todayISODate()}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${prefix}_${stamp}.json`;
}

function updateBackupReminder() {
  const el = document.getElementById('backup-last-text');
  if (!el) return;
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch (e) {}
  if (!last) {
    el.className = 'text-[11px] font-bold mt-1 text-amber-700';
    el.textContent = '⚠ Belum ada sandaran dimuat turun dari peranti ini.';
    return;
  }
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  const when = formatDateTime(last);
  el.className = `text-[11px] font-bold mt-1 ${days >= 7 ? 'text-amber-700' : 'text-emerald-700'}`;
  el.textContent = `${days >= 7 ? '⚠ ' : '✓ '}Sandaran terakhir dari peranti ini: ${when} (${days} hari lalu)${days >= 7 ? '. Disyorkan buat sandaran baharu.' : ''}`;
}

async function downloadFullBackup() {
  if (currentUserRole !== 'superadmin') return;
  showLoadingOverlay('Menyediakan sandaran penuh...');
  try {
    const backup = await collectFullBackup();
    downloadJson(backup, backupFilename('KraiPRO_Sandaran'));
    try { localStorage.setItem(LAST_BACKUP_KEY, backup.createdAt); } catch (e) {}
    updateBackupReminder();
    const c = backup.counts;
    addAuditLog('Sandaran Data', `Sandaran penuh dimuat turun: ${c.items} item, ${c.requests} permohonan, ${c.lpo} LPO, ${c.pembekal} pembekal, ${c.users} pengguna, ${c.audit} log audit.`);
    showToast('Sandaran penuh berjaya dimuat turun.', 'success');
  } catch (err) {
    showToast('Gagal menyediakan sandaran: ' + authErrorMessage(err), 'error');
  } finally {
    hideLoadingOverlay();
  }
}

// Semak fail sandaran sebelum digunakan
function validateBackup(obj) {
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('Fail ini bukan sandaran KraiPRO STOR.');
  if (obj.version !== BACKUP_VERSION) throw new Error(`Versi sandaran tidak disokong (${obj.version}).`);
  const d = obj.data || {};
  if (!d.state || !Array.isArray(d.state.items)) throw new Error('Data stok dalam sandaran tidak sah.');
  ['requests', 'users', 'audit', 'counters'].forEach(k => {
    if (!Array.isArray(d[k])) throw new Error(`Bahagian "${k}" dalam sandaran tidak sah.`);
  });
  if (d.lpo !== undefined && !Array.isArray(d.lpo)) throw new Error('Bahagian "lpo" dalam sandaran tidak sah.');
  ['klinik', 'klinikLog'].forEach(k => {
    if (d[k] === undefined) return;
    if (!Array.isArray(d[k]) || d[k].some(x => !x || !SAFE_ID_RE.test(String(x.id || '')))) throw new Error(`Bahagian "${k}" dalam sandaran tidak sah.`);
  });
  const badLpo = (d.lpo || []).find(l => !l || !SAFE_ID_RE.test(String(l.id || '')) || !Array.isArray(l.items));
  if (badLpo) throw new Error('Terdapat LPO tidak sah dalam sandaran.');
  const badReq = d.requests.find(r => !r || !SAFE_ID_RE.test(String(r.id || '')));
  if (badReq) throw new Error('Terdapat permohonan dengan ID tidak sah dalam sandaran.');
  const badUser = d.users.find(u => !u || !u.id || u.id !== String(u.id).toLowerCase() || u.email !== u.id || !['pelulus', 'pemohon'].includes(u.role));
  if (badUser) throw new Error(`Rekod pengguna tidak sah dalam sandaran (${badUser && badUser.id}).`);
  return obj;
}

function onRestoreFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || currentUserRole !== 'superadmin') return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      pendingRestore = validateBackup(JSON.parse(e.target.result));
    } catch (err) {
      pendingRestore = null;
      showToast('Fail sandaran tidak boleh digunakan: ' + (err.message || err), 'error');
      return;
    }
    openRestoreModal(file.name);
  };
  reader.readAsText(file);
}

function openRestoreModal(filename) {
  const b = pendingRestore;
  const backupC = backupCounts(b.data);
  const nowC = { items: items.length, pembekal: pembekalList.length, lpo: lpoList.length, requests: requests.length, users: appUsers.length, audit: null };
  const labels = { items: 'Item stok', pembekal: 'Pembekal', lpo: 'Pesanan LPO', requests: 'Permohonan', users: 'Pengguna (Pelulus/Pemohon)', audit: 'Log audit' };

  const info = document.getElementById('restore-file-info');
  if (info) {
    const when = formatDateTime(b.createdAt);
    info.textContent = `${filename}: dibuat ${when} oleh ${b.createdBy || '-'}`;
  }
  const body = document.getElementById('restore-summary-body');
  if (body) {
    body.innerHTML = Object.keys(labels).map(k => `
      <tr>
        <td class="p-2 font-semibold">${labels[k]}</td>
        <td class="p-2 text-right font-black">${backupC[k]}</td>
        <td class="p-2 text-right text-slate-500">${nowC[k] === null ? 'dikekalkan' : nowC[k]}</td>
      </tr>`).join('');
  }
  const input = document.getElementById('restore-confirm-input');
  if (input) input.value = '';
  onRestoreConfirmInput();
  document.getElementById('restore-modal')?.classList.remove('hidden');
}

function closeRestoreModal() {
  document.getElementById('restore-modal')?.classList.add('hidden');
  pendingRestore = null;
}

function onRestoreConfirmInput() {
  const ok = (document.getElementById('restore-confirm-input')?.value || '').trim().toUpperCase() === 'PULIHKAN';
  const btn = document.getElementById('restore-confirm-btn');
  if (btn) btn.disabled = !ok || !pendingRestore;
}

async function commitInBatches(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}

async function confirmRestoreBackup() {
  if (currentUserRole !== 'superadmin' || !pendingRestore) return;
  const backup = pendingRestore;
  const d = backup.data;
  document.getElementById('restore-modal')?.classList.add('hidden');
  pendingRestore = null;

  showLoadingOverlay('Memuat turun sandaran data semasa (keselamatan)...');
  try {
    // 1. Sandaran automatik data semasa sebelum ditimpa
    const safety = await collectFullBackup();
    downloadJson(safety, backupFilename('KraiPRO_Sandaran_SebelumPulih'));

    showLoadingOverlay('Memulihkan data daripada sandaran...');
    const ops = [];
    const strip = ({ id, ...rest }) => rest;

    // 2. Permohonan: padam yang tiada dalam sandaran, tulis semula semua dari sandaran
    const backupReqIds = new Set(d.requests.map(r => String(r.id)));
    safety.data.requests.forEach(r => {
      if (!backupReqIds.has(String(r.id))) ops.push(b => b.delete(requestRef(r.id)));
    });
    d.requests.forEach(r => ops.push(b => b.set(requestRef(r.id), { ...strip(r), id: String(r.id) })));

    // 3. Pengguna: padam yang tiada dalam sandaran, tulis semula semua dari sandaran
    const backupUserIds = new Set(d.users.map(u => u.id));
    safety.data.users.forEach(u => {
      if (!backupUserIds.has(u.id)) ops.push(b => b.delete(db.collection('kraipro_users').doc(u.id)));
    });
    d.users.forEach(u => ops.push(b => b.set(db.collection('kraipro_users').doc(u.id), strip(u))));

    // 4. Pembilang nombor permohonan
    d.counters.forEach(c => {
      if (c && c.id && Number.isInteger(c.seq)) ops.push(b => b.set(db.collection('kraipro_counters').doc(c.id), { seq: c.seq }));
    });

    // 5. Log audit: tambah yang tiada sahaja (log sedia ada tidak dipadam/diubah)
    const existingAudit = new Set(safety.data.audit.map(a => a.id));
    d.audit.forEach(a => {
      if (a && a.id && !existingAudit.has(a.id)) ops.push(b => b.set(db.collection('kraipro_audit').doc(a.id), strip(a)));
    });

    // 6. LPO: padam yang tiada dalam sandaran, tulis semula semua dari sandaran
    const backupLpo = backupLpoList(d);
    const backupLpoIds = new Set(backupLpo.map(l => String(l.id)));
    (safety.data.lpo || []).forEach(l => {
      if (!backupLpoIds.has(String(l.id))) ops.push(b => b.delete(db.collection('kraipro_lpo').doc(String(l.id))));
    });
    backupLpo.forEach(l => ops.push(b => b.set(db.collection('kraipro_lpo').doc(String(l.id)), { ...strip(l), id: String(l.id), no: String(l.no || ''), items: Array.isArray(l.items) ? l.items : [] })));

    // 6b. Stor klinik: hanya jika sandaran mengandungi data klinik (sandaran lama tidak menyentuh data klinik)
    if (Array.isArray(d.klinik)) {
      const backupKlinikIds = new Set(d.klinik.map(k => String(k.id)));
      (safety.data.klinik || []).forEach(k => {
        if (!backupKlinikIds.has(String(k.id))) ops.push(b => b.delete(db.collection('kraipro_klinik').doc(String(k.id))));
      });
      d.klinik.forEach(k => ops.push(b => b.set(db.collection('kraipro_klinik').doc(String(k.id)), strip(k))));
    }
    if (Array.isArray(d.klinikLog)) {
      const existingKlinikLog = new Set((safety.data.klinikLog || []).map(l => l.id));
      d.klinikLog.forEach(l => {
        if (!existingKlinikLog.has(l.id)) ops.push(b => b.set(db.collection('kraipro_klinik_log').doc(String(l.id)), strip(l)));
      });
    }

    // 7. Stok & pembekal (ganti sepenuhnya; LPO kini dalam koleksi sendiri)
    const st = d.state;
    ops.push(b => b.set(stateDocRef(), {
      items: st.items || [],
      pembekalList: st.pembekalList || [],
      lastUpdated: new Date().toISOString()
    }));

    await commitInBatches(ops);

    const c = backupCounts(d);
    const when = formatDateTime(backup.createdAt);
    addAuditLog('Pulih Data', `Data dipulihkan daripada sandaran ${when} (${c.items} item, ${c.requests} permohonan, ${c.lpo} LPO, ${c.users} pengguna).`);
    showToast('Data berjaya dipulihkan daripada sandaran.', 'success');
  } catch (err) {
    showToast('Pemulihan gagal: ' + authErrorMessage(err) + '. Fail sandaran keselamatan telah dimuat turun.', 'error');
  } finally {
    hideLoadingOverlay();
  }
}


// ------------------------------------------
// 4. EKSPORT & IMPORT CSV
// ------------------------------------------
function exportItemsToCSV() {
  if (items.length === 0) {
    showToast('Tiada item untuk dieksport!', 'error');
    return;
  }

  const headers = ["SKU", "Nama Item", "Kategori", "SubKategori", "Packaging Unit", "Harga Seunit (RM)", "Baki Stok", "Reorder Level", "Paras Minimum", "Paras Maksimum"];
  const csvRows = [headers.join(",")];

  items.forEach(i => {
    const row = [
      `"${(i.sku || '').replace(/"/g, '""')}"`,
      `"${(i.nama || '').replace(/"/g, '""')}"`,
      `"${(i.kategori || '').replace(/"/g, '""')}"`,
      `"${(i.subkategori || '').replace(/"/g, '""')}"`,
      `"${(i.unit || 'Box').replace(/"/g, '""')}"`,
      parseFloat(i.harga || 0).toFixed(2),
      parseInt(i.baki || 0),
      parseInt(i.reorder || 5),
      toInt(i.paraMin),
      toInt(i.paraMaks)
    ];
    csvRows.push(row.join(","));
  });

  const csvString = csvRows.join("\n");
  const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `KraiPRO_Stok_Induk_${todayISODate()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  addAuditLog("Eksport CSV", `Mengeksport ${items.length} item stok induk ke fail CSV.`);
  showToast('Fail CSV berjaya dimuat turun!', 'success');
}

function importItemsFromCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split(/\r\n|\n/);
    let importedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(col => col.replace(/^"|"$/g, '').trim());

      if (cols.length >= 3) {
        const sku = cols[0];
        const nama = cols[1];
        const kat = cols[2] || "Bekalan Am";
        const subkat = cols[3] || "";
        const unit = cols[4] || "Box";
        const harga = parseFloat(cols[5]) || 0;
        const baki = parseInt(cols[6]) || 0;
        const reorder = parseInt(cols[7]) || 5;

        if (sku && nama) {
          const existingIdx = items.findIndex(it => (it.sku || '').toLowerCase() === sku.toLowerCase());
          const existing = existingIdx !== -1 ? items[existingIdx] : {};
          // Fail CSV lama tiada lajur Min/Maks: kekalkan nilai sedia ada
          const paraMin = cols.length > 8 ? toInt(cols[8]) : toInt(existing.paraMin);
          const paraMaks = cols.length > 9 ? toInt(cols[9]) : toInt(existing.paraMaks);
          const newItem = {
            id: existingIdx !== -1 ? existing.id : String(Date.now() + i),
            sku, nama, kategori: kat, subkategori: subkat, unit, harga, baki, reorder, paraMin, paraMaks
          };

          if (existingIdx !== -1) {
            items[existingIdx] = newItem;
          } else {
            items.push(newItem);
          }
          importedCount++;
        }
      }
    }

    const ok = await runWithLoading(`Mengimport ${importedCount} item ke Cloud...`, () => saveState());
    renderAll();
    addAuditLog("Import CSV", `Berjaya memuat naik/kemaskini ${importedCount} item daripada CSV.`);
    if (ok) showToast(`Berjaya mengimport ${importedCount} item dari fail CSV!`, 'success');
    event.target.value = '';
  };

  reader.readAsText(file);
}


// ------------------------------------------
// 5. LOG MASUK FIREBASE AUTH & AUTO-LOGOUT 60 MINIT
// ------------------------------------------
function showAuthGate(show) {
  const gate = document.getElementById('auth-gate');
  if (gate) gate.classList.toggle('hidden', !show);
}

function showAuthStep(step) {
  ['loading', 'login', 'verify', 'unlisted'].forEach(s => {
    const el = document.getElementById(`auth-step-${s}`);
    if (el) el.classList.toggle('hidden', s !== step);
  });
  showAuthGate(true);
}

function showAuthMessage(type, msg) {
  const errEl = document.getElementById('auth-error');
  const infoEl = document.getElementById('auth-info');
  if (errEl) {
    errEl.classList.toggle('hidden', type !== 'error');
    errEl.innerText = type === 'error' ? msg : '';
  }
  if (infoEl) {
    infoEl.classList.toggle('hidden', type !== 'info');
    infoEl.innerText = type === 'info' ? msg : '';
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  const activeCls = 'py-2 rounded-xl text-xs font-black transition text-slate-900 bg-white shadow-sm';
  const idleCls = 'py-2 rounded-xl text-xs font-bold transition text-slate-600 hover:text-slate-900';

  const btnLogin = document.getElementById('auth-mode-login');
  const btnRegister = document.getElementById('auth-mode-register');
  if (btnLogin) btnLogin.className = isRegister ? idleCls : activeCls;
  if (btnRegister) btnRegister.className = isRegister ? activeCls : idleCls;

  document.getElementById('auth-password2-wrap')?.classList.toggle('hidden', !isRegister);
  document.getElementById('auth-register-note')?.classList.toggle('hidden', !isRegister);
  document.getElementById('auth-forgot-btn')?.classList.toggle('hidden', isRegister);
  const pw = document.getElementById('auth-password');
  if (pw) pw.autocomplete = isRegister ? 'new-password' : 'current-password';
  const submitBtn = document.getElementById('auth-submit-btn');
  if (submitBtn) submitBtn.innerText = isRegister ? 'Tetapkan Kata Laluan & Hantar E-mel Pengesahan' : 'Log Masuk';
  resetPasswordVisibility();
  showAuthMessage(null);
}

function authErrorMessage(err) {
  const code = err && err.code ? err.code : '';
  const messages = {
    'auth/invalid-credential': 'E-mel atau kata laluan tidak betul.',
    'auth/invalid-login-credentials': 'E-mel atau kata laluan tidak betul.',
    'auth/wrong-password': 'E-mel atau kata laluan tidak betul.',
    'auth/user-not-found': 'E-mel atau kata laluan tidak betul.',
    'auth/email-already-in-use': 'Kata laluan untuk e-mel ini telah ditetapkan. Sila log masuk, atau guna "Lupa kata laluan?" jika terlupa.',
    'auth/weak-password': 'Kata laluan terlalu lemah. Gunakan sekurang-kurangnya 8 aksara.',
    'auth/invalid-email': 'Format e-mel tidak sah.',
    'auth/too-many-requests': 'Terlalu banyak cubaan. Sila tunggu beberapa minit dan cuba lagi.',
    'auth/network-request-failed': 'Tiada sambungan internet. Sila cuba lagi.',
    'auth/operation-not-allowed': 'Kaedah log masuk ini belum diaktifkan dalam Firebase Console (Authentication → Sign-in method).',
    'auth/account-exists-with-different-credential': 'E-mel ini sudah mempunyai akaun kata laluan dalam sistem. Sila log masuk dengan kata laluan, atau minta SuperAdmin memadam akaun kata laluan lama di Firebase Console.',
    'auth/unauthorized-domain': 'Alamat laman ini belum dibenarkan untuk log masuk Google (Firebase Console → Authentication → Settings → Authorized domains).',
    'auth/popup-blocked': 'Popup log masuk disekat oleh pelayar. Sila benarkan popup untuk laman ini.',
    'auth/user-disabled': 'Akaun ini telah dinyahaktifkan.',
    'permission-denied': 'Akses ditolak oleh peraturan keselamatan Firestore.'
  };
  return messages[code] || (err && err.message) || String(err);
}

// Tunjuk / sembunyi kata laluan pada borang log masuk
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const label = show ? 'Sembunyikan kata laluan' : 'Tunjuk kata laluan';
  if (btn) {
    btn.setAttribute('aria-label', label);
    btn.title = label;
    const icon = btn.querySelector('i');
    if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  }
  input.focus();
}

// Sentiasa sembunyikan semula kata laluan selepas borang dihantar / ditukar
function resetPasswordVisibility() {
  ['auth-password', 'auth-password2'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = 'password';
    const btn = input.parentElement && input.parentElement.querySelector('button');
    if (btn) {
      btn.setAttribute('aria-label', 'Tunjuk kata laluan');
      btn.title = 'Tunjuk kata laluan';
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-eye';
    }
  });
}

function loadSavedLoginEmail() {
  let saved = '';
  try { saved = localStorage.getItem('kraipro_admin_email') || ''; } catch (e) {}
  const emailEl = document.getElementById('auth-email');
  const rememberEl = document.getElementById('auth-remember');
  if (emailEl && saved && !emailEl.value) emailEl.value = saved;
  if (rememberEl) rememberEl.checked = !!saved;
}

async function isEmailRegistered(email) {
  if (email === SUPERADMIN_EMAIL.toLowerCase()) return true;
  const snap = await db.collection('kraipro_allowlist').doc(email).get();
  return snap.exists;
}

// Mesej untuk dipaparkan selepas akaun tidak sah dipadam (onAuthStateChanged akan dipanggil semula)
let pendingAuthNotice = '';
let pendingAuthNoticeType = 'error';

// Log masuk dengan akaun Google (Gmail / akaun MOH). Pengguna dikenal pasti melalui e-mel,
// jadi akaun yang didaftarkan SuperAdmin kekal sama (peranan, profil & sejarah permohonan).
async function handleGoogleSignIn() {
  if (!auth) return;
  showAuthMessage(null);
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const token = showLoadingOverlay('Log masuk dengan Google...');
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    const code = err && err.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      // Pelayar menyekat popup: guna halaman penuh
      await auth.signInWithRedirect(provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    showAuthMessage('error', authErrorMessage(err));
  } finally {
    hideLoadingOverlay(token);
  }
}

function togglePasswordLogin() {
  const form = document.getElementById('auth-password-form');
  if (!form) return;
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) {
    loadSavedLoginEmail();
    document.getElementById('auth-email')?.focus();
  }
}

async function handleAuthSubmit() {
  const email = document.getElementById('auth-email')?.value.trim().toLowerCase();
  const password = document.getElementById('auth-password')?.value || '';
  const password2 = document.getElementById('auth-password2')?.value || '';
  const remember = document.getElementById('auth-remember')?.checked;
  showAuthMessage(null);

  if (!auth) return;
  if (!email || !password) {
    showAuthMessage('error', 'Sila masukkan e-mel dan kata laluan.');
    return;
  }

  try {
    if (remember) localStorage.setItem('kraipro_admin_email', email);
    else localStorage.removeItem('kraipro_admin_email');
  } catch (e) {}

  const submitBtn = document.getElementById('auth-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  const loadingToken = showLoadingOverlay(authMode === 'register' ? 'Menetapkan kata laluan...' : 'Sedang log masuk...');

  try {
    if (authMode === 'register') {
      if (password.length < 8) {
        showAuthMessage('error', 'Kata laluan mesti sekurang-kurangnya 8 aksara.');
        return;
      }
      if (password !== password2) {
        showAuthMessage('error', 'Pengesahan kata laluan tidak sepadan.');
        return;
      }
      // Hanya e-mel yang didaftarkan SuperAdmin boleh menetapkan kata laluan
      if (!(await isEmailRegistered(email))) {
        showAuthMessage('error', `E-mel ${email} belum didaftarkan oleh SuperAdmin. Sila hubungi SuperAdmin untuk didaftarkan terlebih dahulu.`);
        return;
      }
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.sendEmailVerification();
      // onAuthStateChanged akan memaparkan langkah pengesahan e-mel
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (err) {
    showAuthMessage('error', authErrorMessage(err));
  } finally {
    hideLoadingOverlay(loadingToken);
    if (submitBtn) submitBtn.disabled = false;
    const pwEl = document.getElementById('auth-password');
    const pw2El = document.getElementById('auth-password2');
    if (pwEl) pwEl.value = '';
    if (pw2El) pw2El.value = '';
    resetPasswordVisibility();
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('auth-email')?.value.trim().toLowerCase();
  if (!email) {
    showAuthMessage('error', 'Masukkan e-mel anda dahulu, kemudian tekan "Lupa kata laluan?".');
    return;
  }
  const loadingToken = showLoadingOverlay('Menghantar pautan set semula kata laluan...');
  try {
    await auth.sendPasswordResetEmail(email);
    showAuthMessage('info', `Jika ${email} mempunyai akaun, pautan set semula kata laluan telah dihantar.`);
  } catch (err) {
    showAuthMessage('error', authErrorMessage(err));
  } finally {
    hideLoadingOverlay(loadingToken);
  }
}

async function checkEmailVerified() {
  const user = auth && auth.currentUser;
  if (!user) return;
  const loadingToken = showLoadingOverlay('Menyemak pengesahan e-mel...');
  try {
    await user.reload();
    if (!auth.currentUser.emailVerified) {
      showAuthMessage('error', 'E-mel belum disahkan lagi. Sila klik pautan dalam e-mel anda.');
      return;
    }
    // Dapatkan token baharu (email_verified = true) yang diperlukan oleh firestore.rules
    await auth.currentUser.getIdToken(true);
    hideLoadingOverlay(loadingToken);
    handleAuthStateChanged(auth.currentUser);
  } catch (err) {
    showAuthMessage('error', authErrorMessage(err));
  } finally {
    hideLoadingOverlay(loadingToken);
  }
}

async function resendVerificationEmail() {
  const user = auth && auth.currentUser;
  if (!user) return;
  const loadingToken = showLoadingOverlay('Menghantar semula e-mel pengesahan...');
  try {
    await user.sendEmailVerification();
    showAuthMessage('info', 'E-mel pengesahan telah dihantar semula.');
  } catch (err) {
    showAuthMessage('error', authErrorMessage(err));
  } finally {
    hideLoadingOverlay(loadingToken);
  }
}

function resetSessionState() {
  stopFirestoreListeners();
  if (inactivityTimer) clearTimeout(inactivityTimer);
  isAdminLoggedIn = false;
  currentUserRole = '';
  currentUserEmail = '';
  currentUserProfile = null;
  currentApproverData = null;
  currentUserAllowedCategories = [];
  requests = [];
  requestSources = { recent: [], pending: [], older: [], own: [] };
  accessRequests = [];
  pendingAccessRequestId = '';
  olderRequestsLoaded = false;
  lpoCollection = [];
  legacyStateLpo = [];
  lpoList = [];
  auditLogs = [];
  appUsers = [];
  approverUsers = [];
  draftReqItems = [];
  draftLpoItems = [];
  Object.keys(historyOpenMonths).forEach(k => { historyOpenMonths[k] = null; });
  resetKlinikState();
}

async function handleAuthStateChanged(user) {
  resetSessionState();
  showAuthMessage(null);

  if (!user) {
    loadSavedLoginEmail();
    setAuthMode(authMode);
    showAuthStep('login');
    updateAdminStatusUI();
    if (pendingAuthNotice) {
      showAuthMessage(pendingAuthNoticeType || 'error', pendingAuthNotice);
      pendingAuthNotice = '';
      pendingAuthNoticeType = 'error';
    }
    return;
  }

  const email = (user.email || '').toLowerCase();

  if (!user.emailVerified) {
    const el = document.getElementById('auth-verify-email');
    if (el) el.innerText = email;
    showAuthStep('verify');
    return;
  }

  showAuthStep('loading');

  let role = null;
  let profile = null;
  if (email === SUPERADMIN_EMAIL.toLowerCase()) {
    role = 'superadmin';
  } else {
    try {
      const snap = await db.collection('kraipro_users').doc(email).get();
      if (snap.exists) {
        profile = snap.data();
        role = profile.role === 'pelulus' ? 'pelulus' : 'pemohon';
      }
    } catch (err) {
      console.warn('Semakan pendaftaran gagal:', err);
      showAuthStep('login');
      showAuthMessage('error', 'Tidak dapat menyemak pendaftaran akaun: ' + authErrorMessage(err));
      return;
    }
  }

  if (!role) {
    // Belum didaftarkan SuperAdmin: beri peluang memohon akses
    await showAccessRequestStep(user);
    return;
  }

  currentUserEmail = email;
  currentUserRole = role;
  currentUserProfile = profile;
  isAdminLoggedIn = role === 'superadmin' || role === 'pelulus';
  currentApproverData = role === 'pelulus' ? profile : null;
  currentUserAllowedCategories = role === 'superadmin' ? ['all'] : (role === 'pelulus' ? (profile.allowedCategories || []) : []);

  showAuthGate(false);
  prefillRequesterForm();
  updateAdminStatusUI();
  if (isAdminLoggedIn) switchAdminTab(role === 'superadmin' ? 'katalog' : 'kelulusan');
  startInactivityTimer();
  startFirestoreListeners();
  updateLegacyBackupButton();
  // Penjaga stor klinik (bukan pentadbir) terus ke tab Stor Klinik
  if (isKlinikPenjaga() && !isAdminLoggedIn) switchTab('klinik');
  else renderAll();

  if (role === 'superadmin') migrateLegacyData();

  showToast(`Selamat datang, ${(profile && profile.nama) || email}!`, 'success');
}

// Pilihan Jawatan / Gred / Unit dikongsi dengan borang permohonan (satu sumber)
function requestFormOptions(selectId) {
  const select = document.getElementById(selectId);
  return select ? [...select.options].map(o => o.value).filter(Boolean) : [];
}

// Tetapkan nilai <select>; tambah pilihan jika nilai tiada dalam senarai
function setSelectValue(select, value) {
  if (!select) return;
  if (value && ![...select.options].some(o => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  select.value = value || '';
}

const LOCKED_FIELD_CLASSES = ['bg-slate-100', 'text-slate-700', 'cursor-not-allowed'];

// Isi Nama, Jawatan, Gred & Unit daripada maklumat yang didaftarkan SuperAdmin, dan kunci medan tersebut
// ---- Permohonan akses (pengguna yang belum didaftarkan) ----
function fillOptions(select, values, placeholder) {
  if (!select) return;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}

async function showAccessRequestStep(user) {
  const email = (user.email || '').toLowerCase();
  const el = document.getElementById('auth-unlisted-email');
  if (el) el.innerText = email;

  fillOptions(document.getElementById('access-gred'), requestFormOptions('req-gred'), '-- Pilih Gred --');
  fillOptions(document.getElementById('access-unit'), requestFormOptions('req-unit'), '-- Pilih Unit / Klinik --');
  const jl = document.getElementById('access-jawatan-list');
  if (jl) jl.innerHTML = requestFormOptions('req-jawatan').map(o => `<option value="${escapeHtml(o)}"></option>`).join('');

  const setVal = (id, v) => { const x = document.getElementById(id); if (x) x.value = v || ''; };
  setVal('access-nama', user.displayName || '');
  setVal('access-jawatan', '');

  const statusEl = document.getElementById('access-request-status');
  const submitBtn = document.getElementById('access-submit-btn');
  statusEl?.classList.add('hidden');
  if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Hantar Permohonan Akses';

  // Permohonan sedia ada: papar status & isi semula borang
  try {
    const snap = await db.collection('kraipro_access_requests').doc(email).get();
    if (snap.exists) {
      const d = snap.data();
      setVal('access-nama', d.nama);
      setVal('access-jawatan', d.jawatan);
      setSelectValue(document.getElementById('access-gred'), d.gred || '');
      setSelectValue(document.getElementById('access-unit'), d.unit || '');
      if (statusEl) {
        statusEl.textContent = `Permohonan akses anda telah dihantar pada ${formatDateTime(d.createdAt)} dan sedang menunggu kelulusan SuperAdmin. Anda boleh mengemas kini maklumat di bawah jika perlu.`;
        statusEl.classList.remove('hidden');
      }
      if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-rotate mr-1"></i> Kemas Kini Permohonan';
    }
  } catch (err) {
    console.warn('Semakan permohonan akses gagal:', err);
  }

  showAuthStep('unlisted');
}

async function submitAccessRequest() {
  const user = auth && auth.currentUser;
  if (!user) return;
  const email = (user.email || '').toLowerCase();
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const data = {
    email,
    nama: val('access-nama'),
    jawatan: val('access-jawatan'),
    gred: val('access-gred'),
    unit: val('access-unit'),
    status: 'Pending'
  };
  if (!data.nama || !data.jawatan || !data.unit) {
    showAuthMessage('error', 'Sila isi Nama, Jawatan dan Unit / Klinik.');
    return;
  }

  const token = showLoadingOverlay('Menghantar permohonan akses...');
  try {
    const ref = db.collection('kraipro_access_requests').doc(email);
    const existing = await ref.get();
    const now = new Date().toISOString();
    await ref.set({ ...data, createdAt: existing.exists ? (existing.data().createdAt || now) : now, dikemaskiniPada: now });

    // Notifikasi e-mel kepada SuperAdmin (tidak menghalang jika gagal)
    if (window.emailjs && !existing.exists) {
      emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: SUPERADMIN_EMAIL,
        req_id: 'PERMOHONAN AKSES',
        applicant_name: data.nama,
        applicant_jawatan: [data.jawatan, data.gred].filter(Boolean).join(' '),
        applicant_unit: data.unit,
        request_date: formatDate(todayISODate()),
        item_list: `E-mel: ${email}`,
        from_name: 'Sistem KraiPRO STOR',
        message: `PERMOHONAN AKSES KRAIPRO STOR\n\nNama: ${data.nama}\nE-mel: ${email}\nJawatan: ${data.jawatan} ${data.gred}\nUnit/Klinik: ${data.unit}\n\nSila log masuk ke KraiPRO STOR > Pentadbir > Pengurusan Pengguna untuk mendaftarkan pengguna ini.`,
        reply_to: email
      }, EMAILJS_PUBLIC_KEY).catch(err => console.warn('Notifikasi permohonan akses gagal:', err));
    }

    hideLoadingOverlay(token);
    await endUnlistedSession(existing.exists
      ? 'Permohonan akses anda telah dikemas kini. Anda boleh log masuk selepas SuperAdmin mendaftarkan akaun anda.'
      : 'Permohonan akses anda telah dihantar kepada SuperAdmin. Anda boleh log masuk selepas akaun anda didaftarkan.', 'info');
  } catch (err) {
    hideLoadingOverlay(token);
    showAuthMessage('error', 'Gagal menghantar permohonan: ' + authErrorMessage(err));
  }
}

function leaveUnlistedSession() {
  endUnlistedSession('', 'error');
}

// Tamatkan sesi pengguna belum berdaftar: padam akaun log masuk (permohonan akses kekal dalam pangkalan data)
async function endUnlistedSession(message, type) {
  pendingAuthNotice = message;
  pendingAuthNoticeType = type || 'error';
  const user = auth && auth.currentUser;
  if (!user) return;
  try {
    await user.delete();
  } catch (err) {
    try { await auth.signOut(); } catch (e) {}
  }
}

// ---- SuperAdmin: senarai permohonan akses ----
let accessRequests = [];
let pendingAccessRequestId = '';

function renderAccessRequests() {
  const card = document.getElementById('access-requests-card');
  const body = document.getElementById('access-requests-body');
  const badge = document.getElementById('badge-admin-access');
  const count = document.getElementById('access-requests-count');
  const n = accessRequests.length;
  const show = currentUserRole === 'superadmin' && n > 0;
  card?.classList.toggle('hidden', !show);
  badge?.classList.toggle('hidden', !show);
  if (badge) badge.textContent = n;
  if (count) count.textContent = n;
  if (!body) return;
  body.innerHTML = accessRequests.map(a => `
    <tr class="bg-white">
      <td class="p-2 font-bold text-slate-800">${escapeHtml(a.nama)}</td>
      <td class="p-2">${escapeHtml(a.jawatan)}${a.gred ? ` (${escapeHtml(a.gred)})` : ''}</td>
      <td class="p-2">${escapeHtml(a.unit)}</td>
      <td class="p-2 font-semibold text-purple-900">${escapeHtml(a.email)}</td>
      <td class="p-2 whitespace-nowrap text-slate-500">${escapeHtml(formatDateTime(a.createdAt))}</td>
      <td class="p-2 text-center whitespace-nowrap">
        <button type="button" data-id="${escapeHtml(a.id)}" onclick="approveAccessRequest(this.dataset.id)" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] px-2.5 py-1 rounded-lg mr-1"><i class="fa-solid fa-user-check mr-1"></i>Daftar</button>
        <button type="button" data-id="${escapeHtml(a.id)}" onclick="rejectAccessRequest(this.dataset.id)" class="bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px] px-2.5 py-1 rounded-lg"><i class="fa-solid fa-xmark mr-1"></i>Tolak</button>
      </td>
    </tr>`).join('');
}

// Buka borang pengguna dengan maklumat daripada permohonan akses
function approveAccessRequest(id) {
  const a = accessRequests.find(x => x.id === id);
  if (!a || currentUserRole !== 'superadmin') return;
  openApproverModal();
  pendingAccessRequestId = a.id;
  const setVal = (eid, v) => { const el = document.getElementById(eid); if (el) el.value = v || ''; };
  setVal('modal-approver-nama', a.nama);
  setVal('modal-approver-jawatan', a.jawatan);
  setVal('modal-approver-email', a.email);
  setSelectValue(document.getElementById('modal-approver-gred'), a.gred || '');
  setSelectValue(document.getElementById('modal-approver-unit'), a.unit || '');
  setVal('modal-approver-role', 'pemohon');
  onApproverRoleChange();
  const title = document.getElementById('approver-modal-title');
  if (title) title.innerText = 'Daftar Pengguna (Permohonan Akses)';
}

function rejectAccessRequest(id) {
  const a = accessRequests.find(x => x.id === id);
  if (!a || currentUserRole !== 'superadmin') return;
  showConfirmModal('Tolak Permohonan Akses', `Tolak permohonan akses daripada ${a.nama} (${a.email})?`, async () => {
    const token = showLoadingOverlay('Menolak permohonan akses...');
    try {
      await db.collection('kraipro_access_requests').doc(a.id).delete();
      addAuditLog('Tolak Permohonan Akses', `Permohonan akses ${a.nama} (${a.email}) ditolak.`);
      showToast('Permohonan akses ditolak.', 'info');
    } catch (err) {
      showToast('Gagal menolak permohonan: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay(token);
    }
  });
}

function prefillRequesterForm() {
  const p = currentUserProfile || {};
  const fields = [
    ['req-nama', p.nama],
    ['req-jawatan', p.jawatan],
    ['req-gred', p.gred],
    ['req-unit', p.unit]
  ];
  let lockedCount = 0;

  fields.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = String(value || '').trim();
    const lock = !!v;
    // Medan yang dikunci untuk pengguna sebelumnya: kosongkan apabila tidak lagi dikunci
    const wasLocked = el.tagName === 'SELECT' ? el.disabled : el.readOnly;
    if (!lock && wasLocked) el.value = '';
    if (lock) {
      if (el.tagName === 'SELECT') setSelectValue(el, v);
      else el.value = v;
      lockedCount++;
    }
    // Input guna readonly; select guna disabled (nilai masih boleh dibaca oleh kod)
    if (el.tagName === 'SELECT') el.disabled = lock;
    else el.readOnly = lock;
    LOCKED_FIELD_CLASSES.forEach(c => el.classList.toggle(c, lock));
    el.title = lock ? 'Diambil daripada akaun anda' : '';
  });

  document.getElementById('req-profile-note')?.classList.toggle('hidden', lockedCount === 0);
}

function startInactivityTimer() {
  resetInactivityTimer();

  window.addEventListener('mousemove', resetInactivityTimer);
  window.addEventListener('keydown', resetInactivityTimer);
  window.addEventListener('click', resetInactivityTimer);
  window.addEventListener('scroll', resetInactivityTimer);
  window.addEventListener('touchstart', resetInactivityTimer);
}

function resetInactivityTimer() {
  if (!currentUserEmail) return;

  if (inactivityTimer) clearTimeout(inactivityTimer);

  inactivityTimer = setTimeout(() => {
    autoLogoutDueToInactivity();
  }, INACTIVITY_LIMIT_MS);
}

function autoLogoutDueToInactivity() {
  if (!currentUserEmail) return;

  addAuditLog("Auto-Logout", `Pengguna [${currentUserEmail}] dilog keluar automatik selepas 60 minit inaktiviti.`);

  handleAdminLogout();
  showToast('🔒 Sesi anda telah ditamatkan secara automatik selepas 60 minit tanpa aktiviti.', 'error');
}

function updateAdminStatusUI() {
  const statusEl = document.getElementById('header-admin-status');
  const roleTextEl = document.getElementById('header-user-role');
  const adminPanel = document.getElementById('admin-panel');
  const adminTabBtn = document.getElementById('main-tab-admin');

  if (statusEl) statusEl.style.display = currentUserEmail ? 'flex' : 'none';
  if (adminPanel) adminPanel.style.display = isAdminLoggedIn ? 'block' : 'none';
  if (adminTabBtn) adminTabBtn.style.display = isAdminLoggedIn ? '' : 'none';

  // Pemohon tidak boleh berada di tab Pentadbir
  const adminSection = document.getElementById('content-admin');
  if (!isAdminLoggedIn && adminSection && !adminSection.classList.contains('hidden')) {
    adminSection.classList.add('hidden');
    document.getElementById('content-dashboard')?.classList.remove('hidden');
  }

  // Tab Stor Klinik: penjaga stor klinik sahaja
  const klinikTabBtn = document.getElementById('main-tab-klinik');
  if (klinikTabBtn) klinikTabBtn.style.display = isKlinikPenjaga() ? '' : 'none';
  const klinikSection = document.getElementById('content-klinik');
  if (!isKlinikPenjaga() && klinikSection && !klinikSection.classList.contains('hidden')) {
    klinikSection.classList.add('hidden');
    document.getElementById('content-dashboard')?.classList.remove('hidden');
  }

  const nama = (currentUserProfile && currentUserProfile.nama) || '';
  const displayName = nama || (currentUserRole === 'superadmin' ? 'SuperAdmin' : currentUserEmail);
  const nameEl = document.getElementById('header-user-name');
  const initialEl = document.getElementById('header-user-initial');
  if (nameEl) {
    nameEl.innerText = displayName || '';
    nameEl.title = currentUserEmail || '';
  }
  if (initialEl) {
    // Huruf awal nama (abaikan gelaran seperti Dr., Pn., En.)
    const words = String(displayName || '?').replace(/^(dr|pn|en|cik|tn|puan|encik|prof)\.?\s+/i, '').trim();
    initialEl.innerText = (words.charAt(0) || '?').toUpperCase();
  }
  if (roleTextEl) {
    roleTextEl.innerText = currentUserRole === 'superadmin' ? 'SuperAdmin'
      : currentUserRole === 'pelulus' ? 'Pegawai Pelulus'
      : 'Pemohon';
  }

  applyRolePermissions();
}

function applyRolePermissions() {
  if (!isAdminLoggedIn) return;

  const isSuper = currentUserRole === 'superadmin';
  const subtabPelulus = document.getElementById('admin-subtab-pelulus');
  const auditClearBtn = document.getElementById('audit-clear-btn');

  // Pegawai Pelulus boleh akses semua kecuali 'Pengurusan Pengguna'
  ['kelulusan', 'katalog', 'reorder', 'lpo', 'pembekal', 'laporan', 'klinik', 'audit'].forEach(id => {
    const el = document.getElementById('admin-subtab-' + id);
    if (el) el.style.display = 'flex';
  });
  if (subtabPelulus) subtabPelulus.style.display = isSuper ? 'flex' : 'none';
  if (auditClearBtn) auditClearBtn.style.display = isSuper ? '' : 'none';
  document.getElementById('backup-card')?.classList.toggle('hidden', !isSuper);
  if (isSuper) updateBackupReminder();
}

function handleAdminLogout() {
  if (inactivityTimer) clearTimeout(inactivityTimer);

  window.removeEventListener('mousemove', resetInactivityTimer);
  window.removeEventListener('keydown', resetInactivityTimer);
  window.removeEventListener('click', resetInactivityTimer);
  window.removeEventListener('scroll', resetInactivityTimer);
  window.removeEventListener('touchstart', resetInactivityTimer);

  stopFirestoreListeners();
  if (auth) auth.signOut();
  showToast('Anda telah log keluar.', 'info');
}


// ------------------------------------------
// 6. PENGURUSAN PENGGUNA: PELULUS & PEMOHON (SUPERADMIN)
// ------------------------------------------
function renderApproversTable() {
  const tbody = document.getElementById('approvers-master-body');
  if (!tbody) return;

  if (appUsers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Tiada pengguna didaftarkan lagi.</td></tr>`;
    return;
  }

  const sorted = [...appUsers].sort((a, b) =>
    (a.role === b.role ? 0 : (a.role === 'pelulus' ? -1 : 1)) || String(a.nama || '').localeCompare(String(b.nama || ''))
  );

  tbody.innerHTML = sorted.map(a => {
    const isPelulus = a.role === 'pelulus';
    const catsHtml = isPelulus
      ? (a.allowedCategories || []).map(c => `<span class="inline-block bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[10px] font-bold mr-1 mb-1">${escapeHtml(c)}</span>`).join('')
      : '';
    const roleBadge = (isPelulus
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">Pelulus</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-700">Pemohon</span>')
      + (a.penjagaStor && a.unit ? '<span class="block mt-1 w-fit px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-800"><i class="fa-solid fa-house-medical mr-0.5"></i>Penjaga Stor</span>' : '');
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
        <td class="p-3 font-bold text-slate-800">${escapeHtml(a.nama)}</td>
        <td class="p-3 font-semibold text-slate-600">${escapeHtml(a.jawatan)}${a.gred ? ` (${escapeHtml(a.gred)})` : ''}${a.unit ? `<span class="block text-[10px] text-slate-400 font-medium">${escapeHtml(a.unit)}</span>` : ''}</td>
        <td class="p-3 font-bold text-purple-900">${escapeHtml(a.email)}</td>
        <td class="p-3">${roleBadge}</td>
        <td class="p-3">${catsHtml || '<span class="text-slate-400">-</span>'}</td>
        <td class="p-3 text-center whitespace-nowrap">
          <button type="button" data-id="${escapeHtml(a.id)}" onclick="openApproverModal(this.dataset.id)" class="text-blue-600 hover:text-blue-800 font-bold mr-2"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
          <button type="button" data-id="${escapeHtml(a.id)}" onclick="deleteApprover(this.dataset.id)" class="text-rose-600 hover:text-rose-800 font-bold"><i class="fa-solid fa-trash"></i> Padam</button>
        </td>
      </tr>
    `;
  }).join('');
}

function onApproverRoleChange() {
  const role = document.getElementById('modal-approver-role')?.value;
  document.getElementById('modal-approver-cats-wrap')?.classList.toggle('hidden', role !== 'pelulus');
}

function openApproverModal(userId = null) {
  const modal = document.getElementById('approver-modal');
  const title = document.getElementById('approver-modal-title');
  if (!modal) return;

  document.querySelectorAll('.approver-cat-checkbox').forEach(cb => cb.checked = false);
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const penjagaCb = document.getElementById('modal-approver-penjaga');
  if (penjagaCb) penjagaCb.checked = false;

  const gredSel = document.getElementById('modal-approver-gred');
  const unitSel = document.getElementById('modal-approver-unit');
  if (gredSel) gredSel.innerHTML = '<option value="">-- Pilih Gred --</option>' + requestFormOptions('req-gred').map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  if (unitSel) unitSel.innerHTML = '<option value="">-- Pilih Unit / Klinik --</option>' + requestFormOptions('req-unit').map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  const jawatanList = document.getElementById('modal-approver-jawatan-list');
  if (jawatanList) jawatanList.innerHTML = requestFormOptions('req-jawatan').map(o => `<option value="${escapeHtml(o)}"></option>`).join('');

  if (userId) {
    const u = appUsers.find(a => String(a.id) === String(userId));
    if (!u) return;

    if (title) title.innerText = 'Kemaskini Pengguna';
    setVal('modal-approver-id', u.id);
    setVal('modal-approver-nama', u.nama || '');
    setVal('modal-approver-jawatan', u.jawatan || '');
    setVal('modal-approver-email', u.email || u.id);
    setVal('modal-approver-role', u.role === 'pelulus' ? 'pelulus' : 'pemohon');
    setSelectValue(gredSel, u.gred || '');
    setSelectValue(unitSel, u.unit || '');
    if (penjagaCb) penjagaCb.checked = !!u.penjagaStor;

    (u.allowedCategories || []).forEach(c => {
      document.querySelectorAll('.approver-cat-checkbox').forEach(cb => {
        if (cb.value === c) cb.checked = true;
      });
    });
  } else {
    if (title) title.innerText = 'Tambah Pengguna';
    setVal('modal-approver-id', '');
    setVal('modal-approver-nama', '');
    setVal('modal-approver-jawatan', '');
    setVal('modal-approver-email', '');
    setVal('modal-approver-role', 'pemohon');
    setSelectValue(gredSel, '');
    setSelectValue(unitSel, '');
  }

  onApproverRoleChange();
  modal.classList.remove('hidden');
}

function closeApproverModal() {
  const modal = document.getElementById('approver-modal');
  if (modal) modal.classList.add('hidden');
  pendingAccessRequestId = '';
}

async function saveApprover() {
  if (currentUserRole !== 'superadmin') {
    showToast('Hanya SuperAdmin boleh mengurus pengguna.', 'error');
    return;
  }

  const oldId = document.getElementById('modal-approver-id')?.value;
  const nama = document.getElementById('modal-approver-nama')?.value.trim();
  const jawatan = document.getElementById('modal-approver-jawatan')?.value.trim();
  const email = document.getElementById('modal-approver-email')?.value.trim().toLowerCase();
  const role = document.getElementById('modal-approver-role')?.value === 'pelulus' ? 'pelulus' : 'pemohon';
  const gred = document.getElementById('modal-approver-gred')?.value || '';
  const unit = document.getElementById('modal-approver-unit')?.value || '';
  const penjagaStor = !!document.getElementById('modal-approver-penjaga')?.checked;

  const selectedCats = [];
  if (role === 'pelulus') {
    document.querySelectorAll('.approver-cat-checkbox:checked').forEach(cb => selectedCats.push(cb.value));
  }

  if (!nama || !jawatan || !email) {
    showToast('Sila lengkapkan Nama, Jawatan, dan E-mel!', 'error');
    return;
  }
  if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(email)) {
    showToast('Format e-mel tidak sah!', 'error');
    return;
  }
  if (email === SUPERADMIN_EMAIL.toLowerCase()) {
    showToast('E-mel SuperAdmin tidak perlu didaftarkan di sini.', 'error');
    return;
  }
  if (role === 'pelulus' && selectedCats.length === 0) {
    showToast('Sila pilih sekurang-kurangnya satu kategori kuasa!', 'error');
    return;
  }
  if (penjagaStor && !unit) {
    showToast('Sila pilih Unit / Klinik untuk Penjaga Stor Klinik.', 'error');
    return;
  }
  if (email !== oldId && appUsers.some(u => u.id === email)) {
    showToast('E-mel ini telah didaftarkan.', 'error');
    return;
  }

  const userData = {
    email,
    nama,
    jawatan,
    gred,
    unit,
    role,
    penjagaStor,
    allowedCategories: selectedCats,
    dikemaskiniPada: new Date().toISOString()
  };

  const loadingToken = showLoadingOverlay(oldId ? 'Mengemaskini maklumat pengguna...' : 'Mendaftarkan pengguna...');
  try {
    const batch = db.batch();
    batch.set(db.collection('kraipro_users').doc(email), userData);
    // Jika didaftarkan daripada permohonan akses (atau e-mel ini ada permohonan), buang permohonan tersebut
    if (accessRequests.some(a => a.id === email)) batch.delete(db.collection('kraipro_access_requests').doc(email));
    if (pendingAccessRequestId && pendingAccessRequestId !== email) batch.delete(db.collection('kraipro_access_requests').doc(pendingAccessRequestId));
    batch.set(db.collection('kraipro_allowlist').doc(email), { aktif: true });
    if (oldId && oldId !== email) {
      batch.delete(db.collection('kraipro_users').doc(oldId));
      batch.delete(db.collection('kraipro_allowlist').doc(oldId));
    }
    await batch.commit();

    const roleLabel = role === 'pelulus' ? 'Pegawai Pelulus' : 'Pemohon';
    addAuditLog(oldId ? "Kemaskini Pengguna" : "Tambah Pengguna", `${oldId ? 'Mengemaskini' : 'Mendaftarkan'} ${roleLabel} ${nama} (${email}).`);
    closeApproverModal();
    showToast('Maklumat pengguna berjaya disimpan!', 'success');
  } catch (err) {
    showToast('Gagal menyimpan pengguna: ' + authErrorMessage(err), 'error');
  } finally {
    hideLoadingOverlay(loadingToken);
  }
}

function deleteApprover(id) {
  if (currentUserRole !== 'superadmin') return;
  const target = appUsers.find(a => String(a.id) === String(id));
  showConfirmModal('Padam Pengguna', 'Adakah anda pasti mahu memadam pengguna ini? Mereka tidak lagi boleh log masuk.', async () => {
    const loadingToken = showLoadingOverlay('Memadam pengguna...');
    try {
      const batch = db.batch();
      batch.delete(db.collection('kraipro_users').doc(String(id)));
      batch.delete(db.collection('kraipro_allowlist').doc(String(id)));
      await batch.commit();
      if (target) addAuditLog("Padam Pengguna", `Memadam akaun ${target.nama} (${target.email || target.id}).`);
      showToast('Akaun pengguna dipadam.', 'info');
    } catch (err) {
      showToast('Gagal memadam pengguna: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay(loadingToken);
    }
  });
}


// ------------------------------------------
// 7. PENUKARAN SUB-TAB PENTADBIR
// ------------------------------------------
function switchAdminTab(subtabId) {
  const sections = document.querySelectorAll('div[id^="admin-sec-"]');
  sections.forEach(sec => sec.classList.add('hidden'));

  const target = document.getElementById('admin-sec-' + subtabId);
  if (target) {
    target.classList.remove('hidden');
  }

  styleTabGroup('.admin-subtab-btn', 'admin-subtab-' + subtabId, TAB_STYLES.admin);

  if (subtabId === 'kelulusan') {
    renderAdminRequests();
  } else if (subtabId === 'katalog') {
    renderMasterTable();
  } else if (subtabId === 'reorder') {
    renderReorderTable();
  } else if (subtabId === 'pelulus') {
    renderApproversTable();
  } else if (subtabId === 'lpo') {
    renderMasterLpoTable();
  } else if (subtabId === 'pembekal') {
    renderMasterPembekalTable();
  } else if (subtabId === 'laporan') {
    renderKewPs14Table();
  } else if (subtabId === 'klinik') {
    renderAdminKlinik();
  } else if (subtabId === 'audit') {
    renderAuditTrail();
  }
}


// ------------------------------------------
// 8. LAPORAN KEW.PS-14 (SUKUAN) & PENERIMAAN / PENGELUARAN BULANAN
// ------------------------------------------
const KEWPS14_QUARTERS = [
  { key: 'q1', label: 'Suku Tahun Pertama', months: ['01', '02', '03'] },
  { key: 'q2', label: 'Suku Tahun Kedua', months: ['04', '05', '06'] },
  { key: 'q3', label: 'Suku Tahun Ketiga', months: ['07', '08', '09'] },
  { key: 'q4', label: 'Suku Tahun Keempat', months: ['10', '11', '12'] }
];

let kewps14ManualEdit = false;  // true selepas pengguna menyunting nilai; elak ditindih oleh kemas kini data langsung
let kewps14SelectedMonth = '';  // bulan yang sedang dipaparkan butirannya ('01'..'12')

function getKewPs14Selection() {
  return {
    year: document.getElementById('kewps14-year-select')?.value || String(new Date().getFullYear()),
    category: document.getElementById('kewps14-cat-select')?.value || 'Bahan Pergigian (Kontrak)'
  };
}

function findInventoryItem(i) {
  return items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
}

// Kadar Pusingan Stok = c / [(a + d) ÷ 2]
function stockTurnoverRate(a, c, d) {
  const avg = (a + d) / 2;
  return avg > 0 ? c / avg : 0;
}

function formatRM(val) {
  return (Number(val) || 0).toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Semua pergerakan stok (nilai RM) bagi satu kategori:
//   b = Penerimaan (LPO yang disahkan terima), c = Pengeluaran (item permohonan yang diluluskan)
// `dateFilter(tarikh)` menapis mengikut tarikh 'YYYY-MM-DD'.
function getStockMovements(category, dateFilter) {
  const moves = [];

  lpoList.forEach(lpo => {
    const tarikh = String(lpo.tarikhTerima || '');
    if (lpo.status !== 'Selesai' || !/^\d{4}-\d{2}/.test(tarikh) || !dateFilter(tarikh)) return;
    lpoReceivedLines(lpo).forEach(i => {
      const inv = findInventoryItem(i);
      if ((inv ? inv.kategori : i.kategori) !== category) return;
      const qty = toInt(i.qty);
      const harga = inv ? (parseFloat(inv.harga) || 0) : 0;
      moves.push({
        type: 'b', tarikh, month: tarikh.slice(5, 7), ref: lpo.no, pihak: lpo.pembekal,
        sku: i.sku, nama: i.nama || (inv && inv.nama), unit: i.unit || (inv && inv.unit), qty, harga, nilai: qty * harga
      });
    });
  });

  requests.forEach(r => {
    // Tarikh pengeluaran = tarikh kelulusan (stok keluar ketika diluluskan)
    const tarikh = String(r.tarikhLulus || r.tarikh || '');
    if (r.status !== 'Selesai' || !/^\d{4}-\d{2}/.test(tarikh) || !dateFilter(tarikh)) return;
    (r.items || []).forEach(i => {
      const qty = toInt(i.qtyLulus);
      if (i.status !== 'Lulus' || qty <= 0) return;
      const inv = findInventoryItem(i);
      if ((inv ? inv.kategori : i.kategori) !== category) return;
      const harga = inv ? (parseFloat(inv.harga) || 0) : 0;
      moves.push({
        type: 'c', tarikh, month: tarikh.slice(5, 7), ref: r.id, pihak: r.unit,
        sku: i.sku, nama: i.nama || (inv && inv.nama), unit: inv && inv.unit, qty, harga, nilai: qty * harga
      });
    });
  });

  return moves.sort((x, y) => x.tarikh.localeCompare(y.tarikh) || String(x.ref).localeCompare(String(y.ref)));
}

function sumMovementsByMonth(moves) {
  const totals = {};
  for (let m = 1; m <= 12; m++) totals[String(m).padStart(2, '0')] = { b: 0, c: 0, count: 0 };
  moves.forEach(mv => {
    const t = totals[mv.month];
    if (!t) return;
    t[mv.type] += mv.nilai;
    t.count++;
  });
  return totals;
}

// Anggaran Baki Bawa Hadapan (nilai stok pada 1 Januari):
// nilai stok semasa - penerimaan sejak 1 Jan + pengeluaran sejak 1 Jan.
// Tepat selagi semua pergerakan stok direkod melalui LPO & permohonan.
function estimateOpeningStockValue(year, category) {
  const currentValue = items
    .filter(i => i.kategori === category)
    .reduce((sum, i) => sum + toInt(i.baki) * (parseFloat(i.harga) || 0), 0);
  const since = getStockMovements(category, t => t >= `${year}-01-01`);
  const net = since.reduce((sum, mv) => sum + (mv.type === 'b' ? mv.nilai : -mv.nilai), 0);
  return Math.max(0, currentValue - net);
}

function renderKewPs14Table(forceAuto = false) {
  const { year, category } = getKewPs14Selection();
  const displayYear = document.getElementById('kewps14-display-year');
  if (displayYear) displayYear.innerText = year;

  if (forceAuto === true) kewps14ManualEdit = false;

  if (!kewps14ManualEdit) {
    const totals = sumMovementsByMonth(getStockMovements(category, t => t.startsWith(year + '-')));
    setInputValue('kewps14-baki-hadapan', estimateOpeningStockValue(year, category).toFixed(2));
    KEWPS14_QUARTERS.forEach(q => {
      setInputValue(`kewps14-${q.key}-b`, q.months.reduce((s, m) => s + totals[m].b, 0).toFixed(2));
      setInputValue(`kewps14-${q.key}-c`, q.months.reduce((s, m) => s + totals[m].c, 0).toFixed(2));
    });
  }

  document.getElementById('kewps14-manual-note')?.classList.toggle('hidden', !kewps14ManualEdit);
  recalculateKewPs14();
  renderMonthlyMovementTable();
}

function onKewPs14ManualEdit() {
  kewps14ManualEdit = true;
  document.getElementById('kewps14-manual-note')?.classList.remove('hidden');
  recalculateKewPs14();
  renderMonthlyMovementTable();
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function getInputValue(id) {
  const el = document.getElementById(id);
  return el ? parseFloat(el.value) || 0 : 0;
}

// Kira semula jadual sukuan: Sedia Ada (a) setiap suku = Stok Semasa (d) suku sebelumnya
function computeKewPs14Values() {
  const bakiHadapan = getInputValue('kewps14-baki-hadapan');
  let prevD = bakiHadapan;
  let totalB = 0;
  let totalC = 0;

  const quarters = KEWPS14_QUARTERS.map(q => {
    const a = prevD;
    const b = getInputValue(`kewps14-${q.key}-b`);
    const c = getInputValue(`kewps14-${q.key}-c`);
    const d = (a + b) - c;
    totalB += b;
    totalC += c;
    prevD = d;
    return { ...q, a, b, c, d, kadar: stockTurnoverRate(a, c, d) };
  });

  return { bakiHadapan, quarters, totalB, totalC, akhirTahun: prevD, kadarTahunan: stockTurnoverRate(bakiHadapan, totalC, prevD) };
}

function recalculateKewPs14() {
  const v = computeKewPs14Values();

  v.quarters.forEach(q => {
    setInputValue(`kewps14-${q.key}-a`, q.a.toFixed(2));
    setInputValue(`kewps14-${q.key}-d`, q.d.toFixed(2));
    const kadarEl = document.getElementById(`kewps14-${q.key}-kadar`);
    if (kadarEl) kadarEl.innerText = q.kadar.toFixed(2);
  });

  const totalBEl = document.getElementById('kewps14-total-b');
  const totalCEl = document.getElementById('kewps14-total-c');
  const kadarEl = document.getElementById('kewps14-kadar-pusingan');
  if (totalBEl) totalBEl.innerText = `RM ${v.totalB.toFixed(2)}`;
  if (totalCEl) totalCEl.innerText = `RM ${v.totalC.toFixed(2)}`;
  if (kadarEl) kadarEl.innerText = v.kadarTahunan.toFixed(2);
}

function generateAndPrintKewPs14() {
  const { year, category } = getKewPs14Selection();
  const jabatan = document.getElementById('kewps14-input-jabatan')?.value || '';
  const stor = document.getElementById('kewps14-input-stor')?.value || '';
  const v = computeKewPs14Values();

  const content = document.getElementById('kewps8-content');
  if (!content) return;

  const quarterRows = v.quarters.map(q => `
          <tr>
            <td class="p-2 border-r border-slate-900">${q.label}</td>
            <td class="p-2 border-r border-slate-900 text-right">${q.a.toFixed(2)}</td>
            <td class="p-2 border-r border-slate-900 text-right">${q.b.toFixed(2)}</td>
            <td class="p-2 border-r border-slate-900 text-right">${q.c.toFixed(2)}</td>
            <td class="p-2 border-r border-slate-900 text-right font-black">${q.d.toFixed(2)}</td>
            <td class="p-2 text-center">${q.kadar.toFixed(2)}</td>
          </tr>`).join('');

  content.innerHTML = `
    <div class="space-y-4 font-sans text-slate-900 p-2 max-w-[280mm] mx-auto">
      <div class="flex justify-between items-start text-[11px] font-semibold border-b border-slate-400 pb-2">
        <div><p class="font-bold">Pekeliling Perbendaharaan Malaysia</p></div>
        <div class="text-right"><p class="font-semibold">AM 6.3 Lampiran D</p></div>
      </div>

      <div class="text-center my-3">
        <h2 class="text-base font-black uppercase">LAPORAN KEDUDUKAN SEMASA STOK TAHUN ${escapeHtml(year)}</h2>
        <h3 class="text-xs font-black uppercase text-purple-900 mt-0.5">KEW.PS-14</h3>
      </div>

      <div class="text-xs font-bold space-y-1 my-3">
        <p>KEMENTERIAN/JABATAN : <u>${escapeHtml(jabatan)}</u></p>
        <p>KATEGORI STOR : <u>${escapeHtml(stor)}</u> (Kategori Stok: ${escapeHtml(category)})</p>
      </div>

      <table class="w-full text-left border-collapse border border-slate-900 text-xs">
        <thead>
          <tr class="border-b border-slate-900 text-center font-bold bg-slate-100">
            <th rowspan="3" class="p-2 border-r border-slate-900 w-36">TAHUN SEMASA</th>
            <th colspan="4" class="p-2 border-r border-slate-900 uppercase">KEDUDUKAN STOK</th>
            <th rowspan="3" class="p-2 w-40 uppercase">KADAR PUSINGAN STOK<br><br><span class="text-[10px] font-normal">c / [(a + d) ÷ 2]</span></th>
          </tr>
          <tr class="border-b border-slate-900 text-center font-bold bg-slate-50">
            <th class="p-1.5 border-r border-slate-900">Sedia Ada</th>
            <th class="p-1.5 border-r border-slate-900">Penerimaan</th>
            <th class="p-1.5 border-r border-slate-900">Pengeluaran</th>
            <th class="p-1.5 border-r border-slate-900">Stok Semasa</th>
          </tr>
          <tr class="border-b border-slate-900 text-center font-bold bg-slate-100">
            <th class="p-1 border-r border-slate-900 text-[10px]">Jumlah Nilai Stok (RM)<br>(a)</th>
            <th class="p-1 border-r border-slate-900 text-[10px]">Jumlah Nilai Stok (RM)<br>(b)</th>
            <th class="p-1 border-r border-slate-900 text-[10px]">Jumlah Nilai Stok (RM)<br>(c)</th>
            <th class="p-1 border-r border-slate-900 text-[10px]">Jumlah Nilai Stok (RM)<br>d = (a+b)-(c)</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-900 border-b border-slate-900 font-bold">
          <tr>
            <td class="p-2 border-r border-slate-900">Baki Bawa Hadapan</td>
            <td colspan="3" class="p-2 border-r border-slate-900 text-slate-500 italic text-center font-normal">Baki Stok Akhir Tahun Lepas :</td>
            <td class="p-2 border-r border-slate-900 text-right font-black">${v.bakiHadapan.toFixed(2)}</td>
            <td class="bg-slate-100"></td>
          </tr>
          ${quarterRows}
          <tr class="bg-slate-100 font-black">
            <td class="p-2.5 border-r border-slate-900 uppercase">Nilai Tahunan</td>
            <td class="bg-slate-200 border-r border-slate-900"></td>
            <td class="p-2 border-r border-slate-900 text-right">RM ${v.totalB.toFixed(2)}</td>
            <td class="p-2 border-r border-slate-900 text-right">RM ${v.totalC.toFixed(2)}</td>
            <td class="p-2 border-r border-slate-900 text-center uppercase text-slate-700">Kadar Pusingan Stok Tahunan</td>
            <td class="p-2 text-center text-base font-black text-purple-900">${v.kadarTahunan.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const modal = document.getElementById('kewps8-modal');
  if (modal) modal.classList.remove('hidden');
  setTimeout(() => window.print(), 300);
}

// ---- Penerimaan & Pengeluaran Bulanan ----
function computeMonthlyMovementRows(year, category) {
  const moves = getStockMovements(category, t => t.startsWith(year + '-'));
  const totals = sumMovementsByMonth(moves);
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let a = getInputValue('kewps14-baki-hadapan');
  const rows = BULAN_NAMA.map((nama, idx) => {
    const month = String(idx + 1).padStart(2, '0');
    const { b, c, count } = totals[month];
    const d = (a + b) - c;
    const row = { month, nama, a, b, c, d, count, kadar: stockTurnoverRate(a, c, d), future: `${year}-${month}` > currentYM };
    a = d;
    return row;
  });

  return { moves, rows, totalB: rows.reduce((s, r) => s + r.b, 0), totalC: rows.reduce((s, r) => s + r.c, 0) };
}

function renderMonthlyMovementTable() {
  const tbody = document.getElementById('kewps14-monthly-body');
  if (!tbody) return;

  const { year, category } = getKewPs14Selection();
  const { rows, totalB, totalC } = computeMonthlyMovementRows(year, category);

  tbody.innerHTML = rows.map(r => {
    const selected = r.month === kewps14SelectedMonth;
    return `
      <tr class="${selected ? 'bg-purple-50' : r.future ? 'text-slate-400' : 'hover:bg-slate-50'} border-b border-slate-200">
        <td class="p-2 font-bold">${escapeHtml(r.nama)}</td>
        <td class="p-2 text-right">${formatRM(r.a)}</td>
        <td class="p-2 text-right ${r.b ? 'text-emerald-700 font-bold' : ''}">${formatRM(r.b)}</td>
        <td class="p-2 text-right ${r.c ? 'text-rose-700 font-bold' : ''}">${formatRM(r.c)}</td>
        <td class="p-2 text-right font-black">${formatRM(r.d)}</td>
        <td class="p-2 text-center font-bold">${r.kadar.toFixed(2)}</td>
        <td class="p-2 text-center">${r.count}</td>
        <td class="p-2 text-center">
          <button type="button" data-month="${r.month}" onclick="showMonthMovementDetail(this.dataset.month)" ${r.count ? '' : 'disabled'} class="text-xs font-bold px-2.5 py-1 rounded-lg transition ${r.count ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}">Lihat</button>
        </td>
      </tr>`;
  }).join('') + `
      <tr class="bg-slate-100 font-black border-t-2 border-slate-400">
        <td class="p-2 uppercase">Jumlah ${escapeHtml(year)}</td>
        <td class="p-2"></td>
        <td class="p-2 text-right text-emerald-800">${formatRM(totalB)}</td>
        <td class="p-2 text-right text-rose-800">${formatRM(totalC)}</td>
        <td class="p-2 text-right">${formatRM(rows[11].d)}</td>
        <td class="p-2"></td>
        <td class="p-2 text-center">${rows.reduce((s, r) => s + r.count, 0)}</td>
        <td class="p-2"></td>
      </tr>`;

  renderMonthMovementDetail();
}

function showMonthMovementDetail(month) {
  kewps14SelectedMonth = month;
  renderMonthlyMovementTable();
  document.getElementById('kewps14-month-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMonthMovementDetail() {
  kewps14SelectedMonth = '';
  renderMonthlyMovementTable();
}

function buildMovementDetailTables(moves) {
  const table = (list, type) => {
    const isB = type === 'b';
    const total = list.reduce((s, mv) => s + mv.nilai, 0);
    const body = list.length
      ? list.map(mv => `
          <tr class="border-b border-slate-200">
            <td class="p-1.5 whitespace-nowrap">${escapeHtml(formatDate(mv.tarikh))}</td>
            <td class="p-1.5 font-bold whitespace-nowrap">${escapeHtml(mv.ref)}</td>
            <td class="p-1.5">${escapeHtml(mv.pihak || '-')}</td>
            <td class="p-1.5 font-bold">${escapeHtml(mv.sku)}</td>
            <td class="p-1.5">${escapeHtml(mv.nama)}</td>
            <td class="p-1.5 text-center">${mv.qty} ${escapeHtml(mv.unit || '')}</td>
            <td class="p-1.5 text-right">${formatRM(mv.harga)}</td>
            <td class="p-1.5 text-right font-bold">${formatRM(mv.nilai)}</td>
          </tr>`).join('')
      : `<tr><td colspan="8" class="p-3 text-center text-slate-400">Tiada ${isB ? 'penerimaan' : 'pengeluaran'} bulan ini.</td></tr>`;
    return `
      <div class="space-y-1">
        <h5 class="text-xs font-extrabold ${isB ? 'text-emerald-800' : 'text-rose-800'}">
          ${isB ? 'Penerimaan (b): LPO yang disahkan terima' : 'Pengeluaran (c): Permohonan yang diluluskan'}
        </h5>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse border border-slate-300 text-[11px]">
            <thead class="${isB ? 'bg-emerald-50' : 'bg-rose-50'} font-bold uppercase text-[10px]">
              <tr>
                <th class="p-1.5">Tarikh</th>
                <th class="p-1.5">${isB ? 'No. LPO' : 'No. BPSI'}</th>
                <th class="p-1.5">${isB ? 'Pembekal' : 'Unit / Klinik'}</th>
                <th class="p-1.5">SKU</th>
                <th class="p-1.5">Perihal Stok</th>
                <th class="p-1.5 text-center">Kuantiti</th>
                <th class="p-1.5 text-right">Harga Seunit (RM)</th>
                <th class="p-1.5 text-right">Nilai (RM)</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
            <tfoot class="font-black bg-slate-50">
              <tr><td colspan="7" class="p-1.5 text-right">JUMLAH ${isB ? 'PENERIMAAN' : 'PENGELUARAN'}:</td><td class="p-1.5 text-right">${formatRM(total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>`;
  };
  return table(moves.filter(mv => mv.type === 'b'), 'b') + table(moves.filter(mv => mv.type === 'c'), 'c');
}

function renderMonthMovementDetail() {
  const panel = document.getElementById('kewps14-month-detail');
  if (!panel) return;
  if (!kewps14SelectedMonth) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const { year, category } = getKewPs14Selection();
  const moves = getStockMovements(category, t => t.startsWith(`${year}-${kewps14SelectedMonth}`));
  const label = `${BULAN_NAMA[parseInt(kewps14SelectedMonth) - 1]} ${year}`;

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="border border-purple-200 bg-purple-50/40 rounded-xl p-3 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-sm font-extrabold text-purple-900"><i class="fa-solid fa-list mr-1"></i> Butiran ${escapeHtml(label)}: ${escapeHtml(category)}</h4>
        <button type="button" onclick="closeMonthMovementDetail()" class="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs px-3 py-1 rounded-lg">Tutup</button>
      </div>
      ${buildMovementDetailTables(moves)}
    </div>`;
}

function printMonthlyMovementReport() {
  const { year, category } = getKewPs14Selection();
  const jabatan = document.getElementById('kewps14-input-jabatan')?.value || '';
  const { rows, totalB, totalC } = computeMonthlyMovementRows(year, category);
  const content = document.getElementById('kewps8-content');
  if (!content) return;

  const detailMonth = kewps14SelectedMonth;
  const detailHtml = detailMonth
    ? `<div class="mt-6 space-y-3" style="page-break-before: always;">
         <h3 class="text-sm font-black uppercase">Butiran ${escapeHtml(BULAN_NAMA[parseInt(detailMonth) - 1])} ${escapeHtml(year)}</h3>
         ${buildMovementDetailTables(getStockMovements(category, t => t.startsWith(`${year}-${detailMonth}`)))}
       </div>`
    : '';

  content.innerHTML = `
    <div class="space-y-4 font-sans text-slate-900 p-2 max-w-[280mm] mx-auto">
      <div class="text-center border-b pb-3">
        <h2 class="text-base font-black uppercase">LAPORAN PENERIMAAN &amp; PENGELUARAN STOK BULANAN TAHUN ${escapeHtml(year)}</h2>
        <p class="text-xs font-bold text-slate-600">${escapeHtml(jabatan)} | Kategori Stok: ${escapeHtml(category)}</p>
      </div>
      <table class="w-full text-left border-collapse border border-slate-900 text-xs">
        <thead class="bg-slate-100 font-bold text-[10px] uppercase text-center">
          <tr>
            <th class="p-2 border border-slate-900">Bulan</th>
            <th class="p-2 border border-slate-900">Sedia Ada (a)</th>
            <th class="p-2 border border-slate-900">Penerimaan (b)</th>
            <th class="p-2 border border-slate-900">Pengeluaran (c)</th>
            <th class="p-2 border border-slate-900">Stok Semasa (d)</th>
            <th class="p-2 border border-slate-900">Kadar Pusingan</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="p-1.5 border border-slate-900 font-bold">${escapeHtml(r.nama)}</td>
              <td class="p-1.5 border border-slate-900 text-right">${formatRM(r.a)}</td>
              <td class="p-1.5 border border-slate-900 text-right">${formatRM(r.b)}</td>
              <td class="p-1.5 border border-slate-900 text-right">${formatRM(r.c)}</td>
              <td class="p-1.5 border border-slate-900 text-right font-bold">${formatRM(r.d)}</td>
              <td class="p-1.5 border border-slate-900 text-center">${r.kadar.toFixed(2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot class="bg-slate-100 font-black">
          <tr>
            <td class="p-1.5 border border-slate-900 uppercase">Jumlah</td>
            <td class="p-1.5 border border-slate-900"></td>
            <td class="p-1.5 border border-slate-900 text-right">${formatRM(totalB)}</td>
            <td class="p-1.5 border border-slate-900 text-right">${formatRM(totalC)}</td>
            <td class="p-1.5 border border-slate-900 text-right">${formatRM(rows[11].d)}</td>
            <td class="p-1.5 border border-slate-900"></td>
          </tr>
        </tfoot>
      </table>
      <p class="text-[10px] text-slate-500">Kadar Pusingan Stok = c / [(a + d) ÷ 2]. Nilai dikira berdasarkan harga seunit semasa dalam Stok Induk.</p>
      ${detailHtml}
    </div>`;

  const modal = document.getElementById('kewps8-modal');
  if (modal) modal.classList.remove('hidden');
  setTimeout(() => window.print(), 300);
}


// ------------------------------------------
// 9. FUNGSI UTILITI & NAVIGASI
// ------------------------------------------
function getItemCategoryGroup(item) {
  if (!item) return 'pergigian';
  const kat = (item.kategori || '').toLowerCase();

  if (kat.includes('promosi')) return 'promosi';
  if (kat.includes('alat tulis')) return 'alat_tulis';
  if (kat.includes('bekalan am')) return 'bekalan_am';
  return 'pergigian';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-800 text-white',
    error: 'bg-rose-800 text-white',
    info: 'bg-slate-900 text-amber-300'
  };

  toast.className = `p-3 rounded-xl shadow-xl text-xs font-bold flex items-center gap-2 transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span></span>`;
  toast.querySelector('span').textContent = msg;

  container.appendChild(toast);
  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function showConfirmModal(title, msg, onOk) {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return;
  document.getElementById('confirm-modal-title').innerText = title;
  document.getElementById('confirm-modal-msg').innerText = msg;

  const btnCancel = document.getElementById('confirm-btn-cancel');
  const btnOk = document.getElementById('confirm-btn-ok');

  modal.classList.remove('hidden');

  btnCancel.onclick = () => modal.classList.add('hidden');
  btnOk.onclick = () => {
    modal.classList.add('hidden');
    if (typeof onOk === 'function') onOk();
  };
}

// ---- Gaya tab (dikongsi) ----
const TAB_STYLES = {
  main: {
    base: 'main-tab-btn tab-pill relative shrink-0 flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-2xl text-sm font-bold transition-all duration-200 whitespace-nowrap',
    active: 'is-active bg-purple-600 text-white shadow-lg shadow-purple-600/30',
    inactive: 'text-slate-600 hover:text-purple-700 hover:bg-purple-50'
  },
  admin: {
    base: 'admin-subtab-btn tab-pill flex items-center justify-center sm:justify-start gap-2 px-4 sm:px-5 py-3 rounded-2xl text-xs sm:text-sm font-extrabold transition-all duration-200 border',
    active: 'is-active bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-600/25',
    inactive: 'bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50 hover:-translate-y-0.5'
  },
  pill: {
    base: 'tab-pill px-3.5 py-2 rounded-2xl text-xs font-extrabold transition-all duration-200 border',
    active: 'is-active bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-600/25',
    inactive: 'bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50'
  }
};

// Tetapkan kelas aktif/tidak aktif untuk satu kumpulan tab
function styleTabGroup(selector, activeId, style, extraClass = '') {
  document.querySelectorAll(selector).forEach(btn => {
    const isActive = btn.id === activeId;
    btn.className = [extraClass, style.base, isActive ? style.active : style.inactive].filter(Boolean).join(' ');
  });
}

function applyTabStyles() {
  const activeMain = document.querySelector('section[id^="content-"]:not(.hidden)');
  styleTabGroup('.main-tab-btn', activeMain ? 'main-tab-' + activeMain.id.replace('content-', '') : 'main-tab-dashboard', TAB_STYLES.main);
  const activeAdmin = document.querySelector('div[id^="admin-sec-"]:not(.hidden)');
  styleTabGroup('.admin-subtab-btn', activeAdmin ? 'admin-subtab-' + activeAdmin.id.replace('admin-sec-', '') : 'admin-subtab-kelulusan', TAB_STYLES.admin);
  styleTabGroup('.req-cat-subtab', 'req-subtab-' + currentReqCatTab, TAB_STYLES.pill, 'req-cat-subtab');
  styleTabGroup('.approval-cat-subtab', 'approval-subtab-' + currentApprovalCatTab, TAB_STYLES.pill, 'approval-cat-subtab');
}

function switchTab(tabId) {
  document.querySelectorAll('section[id^="content-"]').forEach(sec => sec.classList.add('hidden'));
  const target = document.getElementById('content-' + tabId);
  if (target) target.classList.remove('hidden');

  styleTabGroup('.main-tab-btn', 'main-tab-' + tabId, TAB_STYLES.main);

  renderAll();
}


// ------------------------------------------
// 10. RENDER JADUAL BAKI, MASTER & REORDER
// ------------------------------------------
function changeBakiPageSize(val) {
  bakiPageSize = val === 'all' ? 'all' : parseInt(val);
  bakiPage = 1;
  renderBakiTable();
}

function goToBakiPage(p) {
  bakiPage = p;
  renderBakiTable();
}

// Penapis kategori dashboard ('' = semua)
let dashboardCatFilter = '';

// Penapis kategori dashboard hanya menapis jadual Senarai Baki Stok (tempat bar penapis diletakkan);
// kad statistik & graf di atas sentiasa memaparkan semua kategori.
function setDashboardCatFilter(cat) {
  dashboardCatFilter = cat;
  bakiPage = 1;
  renderDashboardCategoryTabs();
  renderBakiTable();
}

function renderDashboardCategoryTabs() {
  const container = document.getElementById('dashboard-cat-tabs');
  if (!container) return;
  if (dashboardCatFilter && !items.some(i => itemCategoryName(i) === dashboardCatFilter)) dashboardCatFilter = '';
  container.innerHTML = buildCategoryTabsHtml(items, dashboardCatFilter, 'setDashboardCatFilter');
}

function renderBakiTable() {
  const tbody = document.getElementById('baki-table-body');
  const pagContainer = document.getElementById('baki-pagination-container');
  if (!tbody) return;

  const query = (document.getElementById('baki-search')?.value || '').toLowerCase();
  const catFilter = dashboardCatFilter;

  tbody.innerHTML = '';
  items.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: 'base' }));

  const filtered = items.filter(i => {
    const matchesQ = i.sku.toLowerCase().includes(query) || i.nama.toLowerCase().includes(query);
    const matchesCat = !catFilter || itemCategoryName(i) === catFilter;
    return matchesQ && matchesCat;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-400">Tiada rekod item dijumpai.</td></tr>`;
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  const totalItems = filtered.length;
  let displayItems = filtered;
  let totalPages = 1;

  if (bakiPageSize !== 'all') {
    totalPages = Math.ceil(totalItems / bakiPageSize) || 1;
    if (bakiPage > totalPages) bakiPage = totalPages;
    if (bakiPage < 1) bakiPage = 1;
    const start = (bakiPage - 1) * bakiPageSize;
    displayItems = filtered.slice(start, start + bakiPageSize);
  }

  displayItems.forEach((i, idx) => {
    const itemNumber = bakiPageSize === 'all' ? (idx + 1) : ((bakiPage - 1) * bakiPageSize) + (idx + 1);
    const isLow = i.baki <= i.reorder;
    const unitText = escapeHtml(i.unit || 'unit');
    const statusBadge = isLow
      ? `<span class="px-2.5 py-1 bg-rose-600 text-white rounded-lg text-[10px] font-black uppercase shadow-sm animate-pulse"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Perlu Reorder</span>`
      : `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-check mr-1"></i> Mencukupi</span>`;

    const tr = document.createElement('tr');
    tr.className = isLow ? 'bg-rose-50/90 hover:bg-rose-100/80 transition border-b border-rose-200 text-rose-950' : 'hover:bg-slate-50 transition border-b border-slate-100';

    tr.innerHTML = `
      <td class="p-3.5 text-center font-extrabold ${isLow ? 'text-rose-800' : 'text-slate-400'}">${itemNumber}</td>
      <td class="p-3.5 font-black ${isLow ? 'text-rose-900' : 'text-slate-900'}">${escapeHtml(i.sku)}</td>
      <td class="p-3.5 font-bold ${isLow ? 'text-rose-950' : 'text-slate-800'}">${escapeHtml(i.nama)}</td>
      <td class="p-3.5">
        <span class="${isLow ? 'bg-rose-200/80 text-rose-900' : 'bg-slate-100 text-slate-700'} px-2 py-0.5 rounded-md text-[11px] font-semibold">${escapeHtml(i.kategori)}</span>
        ${i.subkategori ? `<span class="ml-1 ${isLow ? 'bg-rose-300/80 text-rose-950' : 'bg-purple-50 text-purple-700'} px-2 py-0.5 rounded-md text-[10px] font-bold">${escapeHtml(i.subkategori)}</span>` : ''}
      </td>
      <td class="p-3.5 text-right font-bold ${isLow ? 'text-rose-900' : 'text-slate-800'}">RM ${(parseFloat(i.harga) || 0).toFixed(2)}</td>
      <td class="p-3.5 text-center font-black text-sm">${isLow ? `<span class="bg-rose-600 text-white px-2 py-1 rounded-lg shadow-sm font-extrabold">${i.baki} ${unitText}</span>` : `${i.baki} <span class="text-xs font-normal text-slate-500">${unitText}</span>`}</td>
      <td class="p-3.5 text-center font-bold ${isLow ? 'text-rose-800' : 'text-slate-500'}">${i.reorder} ${unitText}</td>
      <td class="p-3.5 text-center">${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationUI(pagContainer, bakiPage, totalPages, totalItems, bakiPageSize, 'goToBakiPage');
}

let reorderCatTab = '';

function setReorderCatTab(cat) {
  reorderCatTab = cat;
  renderReorderTable();
}

function renderReorderTable() {
  const tbody = document.getElementById('reorder-table-body');
  const countBadge = document.getElementById('reorder-count-badge');
  if (!tbody) return;

  const allLow = items.filter(isLowStock);
  if (countBadge) countBadge.innerText = `${allLow.length} ITEM`;

  const tabs = document.getElementById('reorder-cat-tabs');
  if (reorderCatTab && !allLow.some(i => itemCategoryName(i) === reorderCatTab)) reorderCatTab = '';
  if (tabs) {
    tabs.innerHTML = buildCategoryTabsHtml(allLow, reorderCatTab, 'setReorderCatTab', false);
    tabs.classList.toggle('hidden', allLow.length === 0);
  }

  tbody.innerHTML = '';

  if (allLow.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="p-6 text-center text-emerald-700 font-bold bg-emerald-50">
          <i class="fa-solid fa-circle-check text-emerald-600 text-lg mr-2"></i> Semua item mencukupi! Tiada item di bawah paras reorder.
        </td>
      </tr>`;
    return;
  }

  const categoryOrder = sortedCategoryNames(allLow);
  const lowStockItems = allLow
    .filter(i => !reorderCatTab || itemCategoryName(i) === reorderCatTab)
    .sort((a, b) =>
      categoryOrder.indexOf(itemCategoryName(a)) - categoryOrder.indexOf(itemCategoryName(b)) ||
      itemSubcategoryName(a).localeCompare(itemSubcategoryName(b)) ||
      String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true, sensitivity: 'base' })
    );

  let lastCategory = null;
  let lastSub = null;

  lowStockItems.forEach(i => {
    const cat = itemCategoryName(i);
    const sub = itemSubcategoryName(i);

    if (!reorderCatTab && cat !== lastCategory) {
      const n = lowStockItems.filter(x => itemCategoryName(x) === cat).length;
      const header = document.createElement('tr');
      header.innerHTML = `
        <td colspan="9" class="px-3 py-2.5 bg-rose-900 text-white text-xs font-black uppercase tracking-wide">
          <i class="fa-solid fa-layer-group mr-1.5 text-amber-300"></i>${escapeHtml(cat)}
          <span class="ml-2 bg-white/15 px-2 py-0.5 rounded-md text-[10px]">${n} item</span>
        </td>`;
      tbody.appendChild(header);
      lastCategory = cat;
      lastSub = null;
    }

    if (sub !== lastSub) {
      const n = lowStockItems.filter(x => itemCategoryName(x) === cat && itemSubcategoryName(x) === sub).length;
      const header = document.createElement('tr');
      header.innerHTML = `
        <td colspan="9" class="px-3 py-1.5 bg-rose-100 border-y border-rose-200 text-[11px] font-extrabold text-rose-900">
          <i class="fa-solid fa-folder-open mr-1.5"></i>${escapeHtml(sub)} <span class="ml-1 font-bold text-rose-700">${n} item</span>
        </td>`;
      tbody.appendChild(header);
      lastSub = sub;
    }

    // Cadangan pesanan: sehingga paras maksimum (atau paras menokok jika maksimum belum ditetapkan)
    const target = toInt(i.paraMaks) || toInt(i.reorder);
    const shortage = Math.max(0, target - toInt(i.baki));
    const belowMin = toInt(i.paraMin) > 0 && toInt(i.baki) <= toInt(i.paraMin);
    const unitText = escapeHtml(i.unit || 'unit');
    const level = (v) => toInt(v) > 0 ? `${toInt(v)} ${unitText}` : '<span class="text-rose-300">-</span>';
    const tr = document.createElement('tr');
    tr.className = 'bg-rose-50 hover:bg-rose-100/90 transition border-b border-rose-200 text-rose-950 font-medium';
    tr.innerHTML = `
      <td class="p-3.5 font-black text-rose-900 whitespace-nowrap">${escapeHtml(i.sku)}</td>
      <td class="p-3.5 font-extrabold text-rose-950">${escapeHtml(i.nama)}</td>
      <td class="p-3.5"><span class="bg-rose-200/80 text-rose-900 px-2 py-0.5 rounded-md text-[11px] font-bold">${escapeHtml(i.kategori)}</span></td>
      <td class="p-3.5 text-center font-black"><span class="bg-rose-600 text-white px-2.5 py-1 rounded-lg font-black text-xs shadow whitespace-nowrap">${toInt(i.baki)} ${unitText}</span></td>
      <td class="p-3.5 text-center font-bold text-rose-800 whitespace-nowrap">${level(i.paraMin)}</td>
      <td class="p-3.5 text-center font-bold text-rose-800 whitespace-nowrap">${toInt(i.reorder)} ${unitText}</td>
      <td class="p-3.5 text-center font-bold text-rose-800 whitespace-nowrap">${level(i.paraMaks)}</td>
      <td class="p-3.5 text-center font-black text-rose-700"><span class="bg-rose-200 text-rose-900 px-2 py-0.5 rounded-md text-xs font-black whitespace-nowrap">+${shortage} ${unitText}</span></td>
      <td class="p-3.5 text-center">${belowMin
        ? '<span class="px-2.5 py-1 bg-rose-900 text-white rounded-lg text-[10px] font-black uppercase shadow animate-pulse whitespace-nowrap"><i class="fa-solid fa-circle-exclamation mr-1"></i> Bawah Minimum</span>'
        : '<span class="px-2.5 py-1 bg-rose-600 text-white rounded-lg text-[10px] font-black uppercase shadow whitespace-nowrap"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Perlu Reorder</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function changeMasterPageSize(val) {
  masterPageSize = val === 'all' ? 'all' : parseInt(val);
  masterPage = 1;
  renderMasterTable();
}

function goToMasterPage(p) {
  masterPage = p;
  renderMasterTable();
}

// Kategori yang sedang dipaparkan dalam Stok Induk ('' = semua)
let masterCatTab = '';

function itemCategoryName(i) {
  return i.kategori || 'Tiada Kategori';
}

function itemSubcategoryName(i) {
  return i.subkategori || 'Lain-lain';
}

function isLowStock(i) {
  return toInt(i.baki) <= toInt(i.reorder);
}

// Susunan kategori: ikut senarai rasmi (subcategories) dahulu, kemudian abjad
function sortedCategoryNames(list) {
  const known = Object.keys(subcategories);
  const names = [...new Set(list.map(itemCategoryName))];
  return names.sort((x, y) => {
    const ix = known.indexOf(x), iy = known.indexOf(y);
    if (ix !== -1 || iy !== -1) return (ix === -1 ? 999 : ix) - (iy === -1 ? 999 : iy);
    return x.localeCompare(y);
  });
}

// Bina butang tab kategori: label, bilangan item & lencana merah bilangan perlu reorder
function buildCategoryTabsHtml(list, activeCat, onClickFn, showLowBadge = true) {
  const tab = (value, label, subset) => {
    const active = activeCat === value;
    const low = showLowBadge ? subset.filter(isLowStock).length : 0;
    return `
      <button type="button" data-cat="${escapeHtml(value)}" onclick="${onClickFn}(this.dataset.cat)"
        class="${TAB_STYLES.pill.base} flex items-center gap-1.5 ${active ? TAB_STYLES.pill.active : TAB_STYLES.pill.inactive}">
        <span>${escapeHtml(label)}</span>
        <span class="${active ? 'bg-white/20' : 'bg-slate-100'} px-1.5 py-0.5 rounded-md text-[10px] font-black">${subset.length}</span>
        ${low ? `<span class="bg-rose-600 text-white px-1.5 py-0.5 rounded-md text-[10px] font-black" title="Perlu reorder">${low} <i class="fa-solid fa-triangle-exclamation"></i></span>` : ''}
      </button>`;
  };
  return tab('', 'Semua Kategori', list) +
    sortedCategoryNames(list).map(cat => tab(cat, cat, list.filter(i => itemCategoryName(i) === cat))).join('');
}

function setMasterCatTab(cat) {
  masterCatTab = cat;
  masterPage = 1;
  renderMasterTable();
}

function renderMasterCategoryTabs() {
  const container = document.getElementById('master-cat-tabs');
  if (!container) return;
  if (masterCatTab && !items.some(i => itemCategoryName(i) === masterCatTab)) masterCatTab = '';
  container.innerHTML = buildCategoryTabsHtml(items, masterCatTab, 'setMasterCatTab');
  renderSplitCategoryBanner();
}

const COMBINED_STATIONERY_CATEGORY = 'Alat Tulis & Bekalan Am';
let splitCategoryProposals = [];

function combinedCategoryItems() {
  return items.filter(i => i.kategori === COMBINED_STATIONERY_CATEGORY);
}

// Cadangkan kategori baharu: (1) senarai asal data.js mengikut SKU, (2) sub-kategori, (3) awalan SKU
function proposeSplitCategory(i) {
  const sub = String(i.subkategori || '').trim();
  const ref = initialMasterItems.find(x => x.sku === i.sku && (x.kategori === 'Alat Tulis' || x.kategori === 'Bekalan Am'));
  let kategori = '';
  let asas = '';

  if (ref) {
    kategori = ref.kategori;
    asas = 'Senarai item asal';
  } else if ((subcategories['Alat Tulis'] || []).includes(sub) || /kertas|buku|tulis|pen\b|fail|folder|toner|dakwat|resit/i.test(sub)) {
    kategori = 'Alat Tulis';
    asas = `Sub-kategori "${sub}"`;
  } else if ((subcategories['Bekalan Am'] || []).includes(sub) || /bekalan am|kebersihan|pejabat/i.test(sub)) {
    kategori = 'Bekalan Am';
    asas = `Sub-kategori "${sub}"`;
  } else if (/^(AT|B|P|T|F|R)-/i.test(i.sku)) {
    kategori = 'Alat Tulis';
    asas = 'Kod SKU';
  } else if (/^(Bek|L)-/i.test(i.sku)) {
    kategori = 'Bekalan Am';
    asas = 'Kod SKU';
  }

  // Sub-kategori yang sama dengan nama kategori diganti dengan sub-kategori sebenar
  let subkategori = sub;
  if (!sub || ['Alat Tulis', 'Bekalan Am', COMBINED_STATIONERY_CATEGORY].includes(sub)) {
    subkategori = (ref && ref.subkategori) || (kategori === 'Bekalan Am' ? 'Lain-lain Bekalan Am' : sub);
  }

  return { id: String(i.id), sku: i.sku, nama: i.nama, subLama: sub, subkategori, kategori, asas: asas || 'Tiada padanan - sila pilih' };
}

function renderSplitCategoryBanner() {
  const banner = document.getElementById('split-cat-banner');
  if (!banner) return;
  const n = combinedCategoryItems().length;
  banner.classList.toggle('hidden', !(n > 0 && isAdminLoggedIn));
  const text = document.getElementById('split-cat-banner-text');
  if (text) text.textContent = `${n} item masih dalam kategori gabungan "${COMBINED_STATIONERY_CATEGORY}". Pisahkan kepada "Alat Tulis" dan "Bekalan Am".`;
}

function openSplitCategoryModal() {
  if (!isAdminLoggedIn) return;
  splitCategoryProposals = combinedCategoryItems()
    .map(proposeSplitCategory)
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true, sensitivity: 'base' }));
  renderSplitCategoryRows();
  document.getElementById('split-cat-modal')?.classList.remove('hidden');
}

function closeSplitCategoryModal() {
  document.getElementById('split-cat-modal')?.classList.add('hidden');
}

function onSplitCategoryChange(idx, value) {
  if (splitCategoryProposals[idx]) splitCategoryProposals[idx].kategori = value;
  renderSplitCategoryRows();
}

function renderSplitCategoryRows() {
  const tbody = document.getElementById('split-cat-body');
  if (!tbody) return;

  tbody.innerHTML = splitCategoryProposals.map((p, idx) => `
    <tr class="${p.kategori ? '' : 'bg-amber-50'}">
      <td class="p-2 font-black whitespace-nowrap">${escapeHtml(p.sku)}</td>
      <td class="p-2 font-semibold">${escapeHtml(p.nama)}</td>
      <td class="p-2 text-slate-600">${escapeHtml(p.subkategori || '-')}${p.subLama && p.subLama !== p.subkategori ? `<span class="block text-[10px] text-slate-400">asal: ${escapeHtml(p.subLama)}</span>` : ''}</td>
      <td class="p-2">
        <select data-idx="${idx}" onchange="onSplitCategoryChange(parseInt(this.dataset.idx), this.value)" class="border rounded-lg p-1.5 text-xs font-bold ${p.kategori === 'Alat Tulis' ? 'bg-blue-50 border-blue-300 text-blue-900' : p.kategori === 'Bekalan Am' ? 'bg-teal-50 border-teal-300 text-teal-900' : 'bg-amber-100 border-amber-400 text-amber-900'}">
          <option value="" ${p.kategori ? '' : 'selected'}>-- Pilih --</option>
          <option value="Alat Tulis" ${p.kategori === 'Alat Tulis' ? 'selected' : ''}>Alat Tulis</option>
          <option value="Bekalan Am" ${p.kategori === 'Bekalan Am' ? 'selected' : ''}>Bekalan Am</option>
        </select>
      </td>
      <td class="p-2 text-[10px] font-semibold ${p.kategori ? 'text-slate-500' : 'text-amber-800'}">${escapeHtml(p.asas)}</td>
    </tr>`).join('');

  const nAT = splitCategoryProposals.filter(p => p.kategori === 'Alat Tulis').length;
  const nBA = splitCategoryProposals.filter(p => p.kategori === 'Bekalan Am').length;
  const nNone = splitCategoryProposals.length - nAT - nBA;
  const summary = document.getElementById('split-cat-summary');
  if (summary) summary.textContent = `${splitCategoryProposals.length} item: ${nAT} Alat Tulis, ${nBA} Bekalan Am${nNone ? `, ${nNone} belum dipilih` : ''}.`;
  const saveBtn = document.getElementById('split-cat-save-btn');
  if (saveBtn) saveBtn.disabled = nNone > 0 || splitCategoryProposals.length === 0;
}

async function saveSplitCategories() {
  if (!isAdminLoggedIn || splitCategoryProposals.some(p => !p.kategori)) return;
  const byId = new Map(splitCategoryProposals.map(p => [p.id, p]));

  closeSplitCategoryModal();
  showLoadingOverlay('Menyimpan pengkategorian baharu...');
  try {
    let changed = 0;
    await runStockTransaction(async (tx, fresh) => {
      changed = 0;
      fresh.items.forEach(it => {
        const p = byId.get(String(it.id));
        if (p && it.kategori === COMBINED_STATIONERY_CATEGORY) {
          it.kategori = p.kategori;
          it.subkategori = p.subkategori;
          changed++;
        }
      });
    });
    const nAT = splitCategoryProposals.filter(p => p.kategori === 'Alat Tulis').length;
    addAuditLog('Pisah Kategori', `${changed} item "${COMBINED_STATIONERY_CATEGORY}" dipisahkan: ${nAT} Alat Tulis, ${splitCategoryProposals.length - nAT} Bekalan Am.`);
    showToast(`${changed} item berjaya dipisahkan kepada Alat Tulis & Bekalan Am.`, 'success');
  } catch (err) {
    showToast('Gagal menyimpan pengkategorian: ' + authErrorMessage(err), 'error');
  } finally {
    hideLoadingOverlay();
  }
}

// Item Stok Induk mengikut tab kategori & carian semasa, disusun kategori → sub-kategori → SKU
function getMasterFilteredItems() {
  const query = (document.getElementById('master-search')?.value || '').toLowerCase().trim();
  const categoryOrder = sortedCategoryNames(items);

  const sorted = [...items].sort((a, b) =>
    categoryOrder.indexOf(itemCategoryName(a)) - categoryOrder.indexOf(itemCategoryName(b)) ||
    itemSubcategoryName(a).localeCompare(itemSubcategoryName(b)) ||
    String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true, sensitivity: 'base' })
  );

  return sorted.filter(i => {
    const matchesQ = !query ||
      String(i.sku).toLowerCase().includes(query) ||
      String(i.nama).toLowerCase().includes(query) ||
      (i.kategori && i.kategori.toLowerCase().includes(query)) ||
      (i.subkategori && i.subkategori.toLowerCase().includes(query));
    const matchesCat = !masterCatTab || itemCategoryName(i) === masterCatTab;
    return matchesQ && matchesCat;
  });
}

// Cetak senarai Stok Induk (semua halaman, ikut tab kategori & carian semasa)
function printMasterCatalogue() {
  const list = getMasterFilteredItems();
  const content = document.getElementById('kewps8-content');
  if (!content) return;
  if (list.length === 0) {
    showToast('Tiada item untuk dicetak.', 'error');
    return;
  }

  const query = (document.getElementById('master-search')?.value || '').trim();
  const jabatan = document.getElementById('kewps14-input-jabatan')?.value || DEFAULT_JABATAN;
  const now = formatDateTime(new Date());
  const cell = 'border border-slate-400 p-1.5';
  const valueOf = (i) => toInt(i.baki) * (parseFloat(i.harga) || 0);

  let rows = '';
  let lastCat = null;
  let lastSub = null;
  list.forEach((i, idx) => {
    const cat = itemCategoryName(i);
    const sub = itemSubcategoryName(i);
    if (cat !== lastCat) {
      const catItems = list.filter(x => itemCategoryName(x) === cat);
      const catValue = catItems.reduce((s, x) => s + valueOf(x), 0);
      rows += `<tr><td colspan="9" class="${cell} bg-slate-800 text-white font-black uppercase">${escapeHtml(cat)} <span class="font-semibold normal-case">(${catItems.length} item · RM ${formatRM(catValue)})</span></td></tr>`;
      lastCat = cat;
      lastSub = null;
    }
    if (sub !== lastSub) {
      rows += `<tr><td colspan="9" class="${cell} bg-slate-100 font-bold">${escapeHtml(sub)}</td></tr>`;
      lastSub = sub;
    }
    const low = isLowStock(i);
    rows += `
      <tr${low ? ' class="bg-rose-50"' : ''}>
        <td class="${cell} text-center">${idx + 1}</td>
        <td class="${cell} font-bold break-words">${escapeHtml(i.sku)}</td>
        <td class="${cell} break-words">${escapeHtml(i.nama)}</td>
        <td class="${cell} text-center">${escapeHtml(i.unit || '')}</td>
        <td class="${cell} text-right">${formatRM(i.harga)}</td>
        <td class="${cell} text-center font-bold">${toInt(i.baki)}</td>
        <td class="${cell} text-center">${toInt(i.reorder)}</td>
        <td class="${cell} text-right">${formatRM(valueOf(i))}</td>
        <td class="${cell} text-center text-[10px] font-bold">${low ? 'PERLU REORDER' : 'Mencukupi'}</td>
      </tr>`;
  });

  const totalValue = list.reduce((s, i) => s + valueOf(i), 0);
  const lowCount = list.filter(isLowStock).length;
  const scope = [masterCatTab || 'Semua Kategori', query ? `carian "${query}"` : ''].filter(Boolean).join(' · ');

  content.innerHTML = `
    <div class="font-sans text-slate-900 text-[11px] space-y-3 max-w-[280mm] mx-auto">
      <div class="text-center border-b border-slate-400 pb-2">
        <h2 class="text-sm font-black uppercase">Senarai Katalog &amp; Stok Induk</h2>
        <p class="font-bold">${escapeHtml(jabatan)}</p>
        <p class="text-slate-600">${escapeHtml(scope)} · Dicetak: ${escapeHtml(now)}</p>
      </div>
      <div class="flex flex-wrap gap-4 font-bold">
        <span>Jumlah item: ${list.length}</span>
        <span>Perlu reorder: ${lowCount}</span>
        <span>Jumlah nilai stok: RM ${formatRM(totalValue)}</span>
      </div>
      <table class="w-full border-collapse table-fixed">
        <colgroup>
          <col style="width:5%"><col style="width:13%"><col style="width:32%"><col style="width:7%">
          <col style="width:10%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:9%">
        </colgroup>
        <thead>
          <tr class="bg-slate-200 font-bold text-center text-[10px] uppercase">
            <th class="${cell}">Bil.</th>
            <th class="${cell}">SKU</th>
            <th class="${cell}">Perihal Barang</th>
            <th class="${cell}">Unit</th>
            <th class="${cell}">Harga Seunit (RM)</th>
            <th class="${cell}">Baki</th>
            <th class="${cell}">Reorder</th>
            <th class="${cell}">Nilai Stok (RM)</th>
            <th class="${cell}">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="font-black bg-slate-100">
            <td colspan="7" class="${cell} text-right">JUMLAH NILAI STOK</td>
            <td class="${cell} text-right">${formatRM(totalValue)}</td>
            <td class="${cell}"></td>
          </tr>
        </tfoot>
      </table>
      <div class="grid grid-cols-2 gap-8 pt-8">
        <div><p>…………………………………</p><p>(Disediakan oleh)</p><p>Nama:</p><p>Tarikh:</p></div>
        <div><p>…………………………………</p><p>(Disemak oleh)</p><p>Nama:</p><p>Tarikh:</p></div>
      </div>
    </div>`;

  document.getElementById('kewps8-modal')?.classList.remove('hidden');
}

function renderMasterTable() {
  const tbody = document.getElementById('master-item-body');
  const pagContainer = document.getElementById('master-pagination-container');
  if (!tbody) return;

  renderMasterCategoryTabs();

  // Kekalkan susunan SKU pada senarai induk (digunakan oleh dropdown lain)
  items.sort((a, b) => String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true, sensitivity: 'base' }));

  const filtered = getMasterFilteredItems();

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-400">Tiada rekod item ditemui.</td></tr>`;
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  const totalItems = filtered.length;
  let displayItems = filtered;
  let totalPages = 1;
  let startIndex = 0;

  if (masterPageSize !== 'all') {
    totalPages = Math.ceil(totalItems / masterPageSize) || 1;
    if (masterPage > totalPages) masterPage = totalPages;
    if (masterPage < 1) masterPage = 1;
    startIndex = (masterPage - 1) * masterPageSize;
    displayItems = filtered.slice(startIndex, startIndex + masterPageSize);
  }

  // Ringkasan setiap kumpulan (dikira daripada semua item yang ditapis, bukan halaman ini sahaja)
  const groupKey = (i) => `${itemCategoryName(i)}|||${itemSubcategoryName(i)}`;
  const groupStats = {};
  filtered.forEach(i => {
    const k = groupKey(i);
    if (!groupStats[k]) groupStats[k] = { count: 0, low: 0 };
    groupStats[k].count++;
    if (isLowStock(i)) groupStats[k].low++;
  });

  let lastCategory = null;
  let lastGroup = null;

  displayItems.forEach((i, idx) => {
    const cat = itemCategoryName(i);
    const k = groupKey(i);

    // Baris tajuk kategori (hanya dalam paparan "Semua Kategori")
    if (!masterCatTab && cat !== lastCategory) {
      const catCount = filtered.filter(x => itemCategoryName(x) === cat).length;
      const header = document.createElement('tr');
      header.innerHTML = `
        <td colspan="9" class="px-3 py-2.5 bg-purple-900 text-white text-xs font-black uppercase tracking-wide">
          <i class="fa-solid fa-layer-group mr-1.5 text-amber-400"></i>${escapeHtml(cat)}
          <span class="ml-2 bg-white/15 px-2 py-0.5 rounded-md text-[10px]">${catCount} item</span>
        </td>`;
      tbody.appendChild(header);
      lastCategory = cat;
      lastGroup = null;
    }

    // Baris tajuk sub-kategori
    if (k !== lastGroup) {
      const st = groupStats[k];
      const continued = idx === 0 && startIndex > 0 && groupKey(filtered[startIndex - 1]) === k;
      const header = document.createElement('tr');
      header.innerHTML = `
        <td colspan="9" class="px-3 py-2 bg-slate-100 border-y border-slate-200 text-[11px] font-extrabold text-slate-700">
          <i class="fa-solid fa-folder-open mr-1.5 text-purple-600"></i>${escapeHtml(itemSubcategoryName(i))}${continued ? ' <span class="font-semibold text-slate-400">(sambungan)</span>' : ''}
          <span class="ml-2 text-slate-500 font-bold">${st.count} item</span>
          ${st.low ? `<span class="ml-2 bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md text-[10px] font-black">${st.low} perlu reorder</span>` : ''}
        </td>`;
      tbody.appendChild(header);
      lastGroup = k;
    }

    const itemNumber = startIndex + idx + 1;
    const isLow = isLowStock(i);
    const unitText = escapeHtml(i.unit || 'Box');
    const tr = document.createElement('tr');
    tr.className = isLow ? 'bg-rose-50 hover:bg-rose-100 transition border-b border-rose-200 text-rose-950' : 'hover:bg-slate-50 transition border-b border-slate-100';

    tr.innerHTML = `
      <td class="p-3 text-center font-extrabold ${isLow ? 'text-rose-800' : 'text-slate-400'}">${itemNumber}</td>
      <td class="p-3 font-black ${isLow ? 'text-rose-900' : 'text-slate-900'}">${escapeHtml(i.sku)}</td>
      <td class="p-3 font-bold ${isLow ? 'text-rose-950' : 'text-slate-800'}">${escapeHtml(i.nama)}</td>
      <td class="p-3">${escapeHtml(i.kategori)} ${i.subkategori ? `(${escapeHtml(i.subkategori)})` : ''}</td>
      <td class="p-3 text-center"><span class="bg-purple-100 text-purple-900 px-2 py-0.5 rounded-lg text-xs font-bold">${unitText}</span></td>
      <td class="p-3 text-right font-bold whitespace-nowrap">RM ${(parseFloat(i.harga) || 0).toFixed(2)}</td>
      <td class="p-3 text-center font-black whitespace-nowrap">${isLow ? `<span class="bg-rose-600 text-white px-2 py-1 rounded-lg text-xs font-black">${toInt(i.baki)} ${unitText}</span>` : `${toInt(i.baki)} ${unitText}`}</td>
      <td class="p-3 text-center font-bold whitespace-nowrap">${toInt(i.reorder)} ${unitText}</td>
      <td class="p-3 text-center whitespace-nowrap">
        <button type="button" data-id="${escapeHtml(i.id)}" onclick="openItemModal(this.dataset.id)" class="text-blue-600 hover:text-blue-800 font-bold mr-2"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
        <button type="button" data-id="${escapeHtml(i.id)}" onclick="deleteItem(this.dataset.id)" class="text-rose-600 hover:text-rose-800 font-bold"><i class="fa-solid fa-trash"></i> Padam</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationUI(pagContainer, masterPage, totalPages, totalItems, masterPageSize, 'goToMasterPage');
}

function renderMasterPembekalTable() {
  const tbody = document.getElementById('pembekal-master-body');
  if (!tbody) return;

  if (pembekalList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Tiada rekod pembekal dijumpai.</td></tr>`;
    return;
  }

  tbody.innerHTML = sortedPembekal().map(p => `
    <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
      <td class="p-3 font-bold text-slate-800">${escapeHtml(p.nama)}</td>
      <td class="p-3 font-semibold text-slate-700">${escapeHtml(p.telefon || '-')}</td>
      <td class="p-3 text-purple-700 font-medium">${escapeHtml(p.email || '-')}</td>
      <td class="p-3 text-slate-500">${escapeHtml(p.alamat || '-')}</td>
      <td class="p-3 text-center whitespace-nowrap">
        <button type="button" data-id="${escapeHtml(p.id)}" onclick="openPembekalModal(this.dataset.id)" class="text-blue-600 hover:text-blue-800 font-bold mr-2"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
        <button type="button" data-id="${escapeHtml(p.id)}" onclick="deletePembekal(this.dataset.id)" class="text-rose-600 hover:text-rose-800 font-bold"><i class="fa-solid fa-trash"></i> Padam</button>
      </td>
    </tr>
  `).join('');
}

function openPembekalModal(pembekalId = null) {
  const modal = document.getElementById('pembekal-modal');
  const title = document.getElementById('pembekal-modal-title');
  if (!modal || !isAdminLoggedIn) return;

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const p = pembekalId ? pembekalList.find(item => String(item.id) === String(pembekalId)) : null;
  if (pembekalId && !p) return;

  if (title) title.innerText = p ? 'Kemaskini Maklumat Pembekal' : 'Tambah Pembekal Baru';
  setVal('modal-pembekal-id', p ? p.id : '');
  setVal('modal-pembekal-nama', p ? p.nama || '' : '');
  setVal('modal-pembekal-telefon', p ? p.telefon || '' : '');
  setVal('modal-pembekal-email', p ? p.email || '' : '');
  setVal('modal-pembekal-alamat', p ? p.alamat || '' : '');

  modal.classList.remove('hidden');
}

function closePembekalModal() {
  const modal = document.getElementById('pembekal-modal');
  if (modal) modal.classList.add('hidden');
}

async function savePembekal() {
  if (!isAdminLoggedIn) return;

  const id = document.getElementById('modal-pembekal-id')?.value;
  const nama = document.getElementById('modal-pembekal-nama')?.value.trim();
  const tel = document.getElementById('modal-pembekal-telefon')?.value.trim();
  const email = document.getElementById('modal-pembekal-email')?.value.trim();
  const alamat = document.getElementById('modal-pembekal-alamat')?.value.trim();

  if (!nama) {
    showToast('Sila isi Nama Pembekal!', 'error');
    return;
  }

  const pembekalData = { id: id || String(Date.now()), nama, telefon: tel, email, alamat };

  const idx = id ? pembekalList.findIndex(p => String(p.id) === String(id)) : -1;
  if (idx !== -1) {
    pembekalList[idx] = pembekalData;
    addAuditLog("Kemaskini Pembekal", `Maklumat pembekal ${nama} dikemaskini.`);
  } else {
    pembekalList.push(pembekalData);
    addAuditLog("Tambah Pembekal", `Pembekal baru ${nama} ditambah.`);
  }

  const ok = await runWithLoading('Menyimpan maklumat pembekal...', () => saveState());
  closePembekalModal();
  renderMasterPembekalTable();
  populatePembekalDropdowns();
  if (ok) showToast('Maklumat pembekal berjaya disimpan!', 'success');
}

function deletePembekal(id) {
  if (!isAdminLoggedIn) return;
  showConfirmModal('Padam Pembekal', 'Adakah anda pasti mahu memadam pembekal ini?', async () => {
    const deleted = pembekalList.find(p => String(p.id) === String(id));
    pembekalList = pembekalList.filter(p => String(p.id) !== String(id));
    if (deleted) addAuditLog("Padam Pembekal", `Pembekal ${deleted.nama} dipadam.`);
    const ok = await runWithLoading('Memadam pembekal...', () => saveState());
    renderMasterPembekalTable();
    populatePembekalDropdowns();
    if (ok) showToast('Pembekal dipadam', 'info');
  });
}

function renderPaginationUI(container, curPage, totalPgs, totalItems, pageSize, changeFnName) {
  if (!container) return;
  if (pageSize === 'all' || totalPgs <= 1) {
    container.innerHTML = `
      <div class="text-slate-500 font-semibold">Memaparkan semua <b>${totalItems}</b> item.</div>
      <div class="text-[11px] text-slate-400 font-medium">Halaman penuh</div>
    `;
    return;
  }

  const startRange = ((curPage - 1) * pageSize) + 1;
  const endRange = Math.min(curPage * pageSize, totalItems);

  let buttons = `
    <button type="button" onclick="${changeFnName}(${curPage - 1})" ${curPage <= 1 ? 'disabled class="opacity-40 cursor-not-allowed"' : 'class="hover:bg-slate-200"'} class="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold">
      <i class="fa-solid fa-chevron-left mr-1"></i> Sblm
    </button>
  `;

  for (let p = 1; p <= totalPgs; p++) {
    if (p === 1 || p === totalPgs || (p >= curPage - 1 && p <= curPage + 1)) {
      const isActive = p === curPage;
      buttons += `
        <button type="button" onclick="${changeFnName}(${p})" class="px-3 py-1 rounded-lg text-xs font-extrabold transition ${isActive ? 'bg-purple-600 text-white shadow' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}">
          ${p}
        </button>
      `;
    } else if (p === curPage - 2 || p === curPage + 2) {
      buttons += `<span class="px-1 text-slate-400">...</span>`;
    }
  }

  buttons += `
    <button type="button" onclick="${changeFnName}(${curPage + 1})" ${curPage >= totalPgs ? 'disabled class="opacity-40 cursor-not-allowed"' : 'class="hover:bg-slate-200"'} class="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold">
      Seterusnya <i class="fa-solid fa-chevron-right ml-1"></i>
    </button>
  `;

  container.innerHTML = `
    <div class="text-slate-600 font-medium">
      Memaparkan <b>${startRange}</b> - <b>${endRange}</b> daripada <b>${totalItems}</b> item
    </div>
    <div class="flex items-center gap-1.5 overflow-x-auto">
      ${buttons}
    </div>
  `;
}


// ------------------------------------------
// 11. KELULUSAN & PEMBATALAN PERMOHONAN
// ------------------------------------------
function switchApprovalCategoryTab(catGroup) {
  currentApprovalCatTab = catGroup;

  styleTabGroup('.approval-cat-subtab', 'approval-subtab-' + catGroup, TAB_STYLES.pill, 'approval-cat-subtab');

  renderAdminRequests();
}

function renderAdminRequests() {
  const pendingCont = document.getElementById('admin-pending-container');
  const compCont = document.getElementById('admin-completed-container');

  if (!pendingCont || !compCont) return;

  pendingCont.innerHTML = '';
  compCont.innerHTML = '';

  const pending = requests.filter(r => r.status === 'Pending');
  const completed = requests.filter(r => r.status !== 'Pending');

  const filteredPending = pending.filter(r => {
    if (!r.items) return false;

    return r.items.some(i => {
      const inv = items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
      const itemKat = inv ? inv.kategori : (i.kategori || '');

      if (currentUserRole === 'pelulus' && currentUserAllowedCategories && !currentUserAllowedCategories.includes('all')) {
        if (!currentUserAllowedCategories.includes(itemKat)) {
          return false;
        }
      }

      if (currentApprovalCatTab === 'all') return true;
      return getItemCategoryGroup(inv || i) === currentApprovalCatTab;
    });
  });

  if (filteredPending.length === 0) {
    pendingCont.innerHTML = `<div class="p-4 bg-slate-50 text-slate-400 text-xs text-center rounded-xl">Tiada permohonan baharu untuk kelulusan di bawah kategori kuasa anda.</div>`;
  } else {
    filteredPending.forEach(r => {
      const card = document.createElement('div');
      card.className = 'bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-3';

      const rows = r.items.map((i, idx) => `
        <tr class="border-b border-slate-100">
          <td class="p-2 font-bold">${escapeHtml(i.sku)}</td>
          <td class="p-2">${escapeHtml(i.nama)}</td>
          <td class="p-2 text-center font-bold">${toInt(i.qtyMohon)}</td>
          <td class="p-2 text-center">
            <input type="number" id="admin-approve-qty-${r.id}-${idx}" min="0" max="${toInt(i.qtyMohon)}" value="${toInt(i.qtyMohon)}" class="w-16 p-1 border border-slate-300 rounded text-center text-xs font-bold">
          </td>
        </tr>
      `).join('');

      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <span class="font-black text-purple-900 mr-2">${escapeHtml(r.id)}</span>
            <span class="font-bold text-slate-700">${escapeHtml(r.nama)} (${escapeHtml(r.jawatan)} ${escapeHtml(r.gred)}) - ${escapeHtml(r.unit)}</span>
            <span class="text-slate-400 text-[10px] ml-2">${escapeHtml(formatDate(r.tarikh))}</span>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="bg-slate-200 text-slate-700 font-bold uppercase">
                <th class="p-2">SKU</th>
                <th class="p-2">Item</th>
                <th class="p-2 text-center">Mohon</th>
                <th class="p-2 text-center">Qty Diluluskan</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="button" data-id="${escapeHtml(r.id)}" onclick="rejectRequest(this.dataset.id)" class="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2 rounded-lg"><i class="fa-solid fa-xmark mr-1"></i> Tolak</button>
          <button type="button" data-id="${escapeHtml(r.id)}" onclick="approveRequest(this.dataset.id)" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg shadow"><i class="fa-solid fa-check mr-1"></i> Luluskan</button>
        </div>
      `;
      pendingCont.appendChild(card);
    });
  }

  renderRequestHistory('hist-admin', completed);
}

function approveRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || !isAdminLoggedIn) return;

  let pelulusNama = "SuperAdmin Utama";
  let pelulusJawatan = "Pentadbir Sistem";

  if (currentUserRole === 'pelulus' && currentApproverData) {
    pelulusNama = currentApproverData.nama;
    pelulusJawatan = currentApproverData.jawatan;
  }

  showConfirmModal('Luluskan Permohonan', `Luluskan permohonan ${req.id}? Stok fizikal akan ditolak secara automatik.`, async () => {
    const approvedInputs = req.items.map((i, idx) => {
      const inputEl = document.getElementById(`admin-approve-qty-${req.id}-${idx}`);
      return Math.max(0, inputEl ? parseInt(inputEl.value) || 0 : (i.qtyMohon || 0));
    });

    showLoadingOverlay(`Meluluskan permohonan ${req.id}...`);
    try {
      await runStockTransaction(async (tx, fresh) => {
        const rSnap = await tx.get(requestRef(req.id));
        if (!rSnap.exists) throw new Error('Permohonan tidak dijumpai.');
        const r = rSnap.data();
        if (r.status !== 'Pending') throw new Error(`Permohonan ini telah diproses (${r.status}).`);

        const newItems = (r.items || []).map((i, idx) => {
          let approvedQty = approvedInputs[idx] || 0;

          // Kuantiti lulus tidak boleh melebihi baki stok sebenar (elak stok "palsu" bila dibatalkan)
          const invItem = fresh.items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
          let bakiSediaAda = null;
          if (invItem) {
            bakiSediaAda = parseInt(invItem.baki) || 0;
            approvedQty = Math.min(approvedQty, Math.max(0, bakiSediaAda));
            invItem.baki = bakiSediaAda - approvedQty;
          }

          return { ...i, qtyLulus: approvedQty, bakiSediaAda, status: approvedQty > 0 ? 'Lulus' : 'Ditolak' };
        });

        tx.update(requestRef(req.id), {
          items: newItems,
          status: 'Selesai',
          pelulusNama: pelulusNama,
          pelulusJawatan: pelulusJawatan,
          pelulusEmail: currentUserEmail,
          tarikhLulus: todayISODate(),
          // Stok yang diluluskan menunggu pengesahan terima oleh penjaga stor klinik
          ...(r.unit && newItems.some(i => i.qtyLulus > 0) ? { terimaKlinik: 'Menunggu' } : {})
        });
      });

      addAuditLog("Kelulusan Permohonan", `Permohonan ${req.id} diluluskan oleh ${pelulusNama}.`);
      showToast('Permohonan diluluskan & stok dikemaskini!', 'success');
    } catch (err) {
      showToast('Kelulusan gagal: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay();
    }
  });
}

function rejectRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || !isAdminLoggedIn) return;

  showConfirmModal('Tolak Permohonan', `Adakah anda pasti mahu menolak permohonan ${req.id}?`, async () => {
    showLoadingOverlay(`Menolak permohonan ${req.id}...`);
    try {
      await db.runTransaction(async (tx) => {
        const rSnap = await tx.get(requestRef(req.id));
        if (!rSnap.exists) throw new Error('Permohonan tidak dijumpai.');
        const r = rSnap.data();
        if (r.status !== 'Pending') throw new Error(`Permohonan ini telah diproses (${r.status}).`);
        tx.update(requestRef(req.id), {
          items: (r.items || []).map(i => ({ ...i, qtyLulus: 0, status: 'Ditolak' })),
          status: 'Ditolak',
          pelulusNama: currentApproverData ? currentApproverData.nama : 'SuperAdmin Utama',
          pelulusJawatan: currentApproverData ? currentApproverData.jawatan : 'Pentadbir Sistem',
          pelulusEmail: currentUserEmail,
          tarikhLulus: todayISODate()
        });
      });
      addAuditLog("Tolak Permohonan", `Permohonan ${req.id} telah ditolak.`);
      showToast('Permohonan telah ditolak.', 'info');
    } catch (err) {
      showToast('Gagal menolak permohonan: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay();
    }
  });
}

// PEMBATALAN PERMOHONAN DILULUSKAN KHIUSUS SUPERADMIN (AUTO-REFUND STOK KE INVENTORI)
function cancelApprovedRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || currentUserRole !== 'superadmin') return;

  showConfirmModal('Batalkan Permohonan', `Adakah anda pasti mahu membatalkan permohonan ${req.id}? Kuantiti stok yang diluluskan akan dimasukkan semula ke dalam baki inventori secara automatik.`, async () => {
    showLoadingOverlay(`Membatalkan permohonan ${req.id} & memulangkan stok...`);
    try {
      await runStockTransaction(async (tx, fresh) => {
        const rSnap = await tx.get(requestRef(req.id));
        if (!rSnap.exists) throw new Error('Permohonan tidak dijumpai.');
        const r = rSnap.data();
        if (r.status !== 'Selesai') throw new Error('Hanya permohonan yang telah diluluskan boleh dibatalkan.');

        // Jika klinik telah sahkan terima, stok tersebut ditolak semula dari stor klinik
        const klinikSnap = r.terimaKlinik === 'Diterima' && r.unit ? await tx.get(klinikRef(r.unit)) : null;

        const newItems = (r.items || []).map(i => {
          if (i.status === 'Lulus' && (i.qtyLulus || 0) > 0) {
            const invItem = fresh.items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
            if (invItem) invItem.baki = (parseInt(invItem.baki) || 0) + i.qtyLulus; // Auto-Refund baki stok
          }
          return { ...i, status: 'Dibatalkan' };
        });

        if (klinikSnap && klinikSnap.exists) applyKlinikReversal(tx, klinikSnap, r);

        tx.update(requestRef(req.id), {
          items: newItems, status: 'Dibatalkan', tarikhBatal: todayISODate(),
          ...(r.terimaKlinik ? { terimaKlinik: 'Dibatalkan' } : {})
        });
      });

      addAuditLog("Batalkan Permohonan", `Permohonan ${req.id} dibatalkan oleh SuperAdmin. Stok dipulangkan ke inventori.`);
      showToast(`Permohonan ${req.id} dibatalkan & baki stok dipulangkan!`, 'success');
    } catch (err) {
      showToast('Pembatalan gagal: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay();
    }
  });
}

// PEMBATALAN PERMOHONAN OLEH PEMOHON (JIKA STATUS MASIH PENDING)
function cancelPendingRequest(reqId) {
  const req = requests.find(r => r.id === reqId);
  if (!req || req.status !== 'Pending') return;

  showConfirmModal('Batalkan Permohonan', `Adakah anda pasti mahu membatalkan permohonan ${req.id}?`, async () => {
    showLoadingOverlay(`Membatalkan permohonan ${req.id}...`);
    try {
      await requestRef(req.id).update({
        status: 'Dibatalkan',
        items: (req.items || []).map(i => ({ ...i, status: 'Dibatalkan' })),
        tarikhBatal: todayISODate()
      });
      addAuditLog("Batalkan Permohonan", `Pemohon membatalkan permohonan ${req.id}.`);
      showToast(`Permohonan ${req.id} telah dibatalkan.`, 'info');
    } catch (err) {
      showToast('Pembatalan gagal: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay();
    }
  });
}


// ------------------------------------------
// 12. ITEM STOK MODAL (CRUD DENGAN INPUT INLINE SUB-KAT & UNIT)
// ------------------------------------------
function openItemModal(itemId = null) {
  const modal = document.getElementById('item-modal');
  const title = document.getElementById('item-modal-title');
  if (!modal) return;

  hideInlineSubCatInput();
  hideInlineUnitInput();

  if (itemId) {
    const item = items.find(i => String(i.id) === String(itemId));
    if (!item) return;

    if (title) title.innerText = 'Kemaskini Item Stok';
    if (document.getElementById('modal-item-id')) document.getElementById('modal-item-id').value = item.id;
    if (document.getElementById('modal-item-sku')) document.getElementById('modal-item-sku').value = item.sku;
    if (document.getElementById('modal-item-nama')) document.getElementById('modal-item-nama').value = item.nama;
    const katSelect = document.getElementById('modal-item-kategori');
    if (katSelect) {
      const kat = item.kategori || 'Bahan Pergigian (Kontrak)';
      if (![...katSelect.options].some(o => o.value === kat)) {
        const opt = document.createElement('option');
        opt.value = kat;
        opt.textContent = kat;
        katSelect.appendChild(opt);
      }
      katSelect.value = kat;
    }

    populateModalSubCategories(item.kategori || 'Bahan Pergigian (Kontrak)', item.subkategori || '');
    populateModalUnits(item.unit || 'Box');

    if (document.getElementById('modal-item-harga')) document.getElementById('modal-item-harga').value = item.harga;
    if (document.getElementById('modal-item-reorder')) document.getElementById('modal-item-reorder').value = item.reorder;
    if (document.getElementById('modal-item-min')) document.getElementById('modal-item-min').value = toInt(item.paraMin);
    if (document.getElementById('modal-item-max')) document.getElementById('modal-item-max').value = toInt(item.paraMaks);
    if (document.getElementById('modal-item-baki')) document.getElementById('modal-item-baki').value = item.baki;
  } else {
    if (title) title.innerText = 'Tambah Item Stok Baru';
    if (document.getElementById('modal-item-id')) document.getElementById('modal-item-id').value = '';
    if (document.getElementById('modal-item-sku')) document.getElementById('modal-item-sku').value = '';
    if (document.getElementById('modal-item-nama')) document.getElementById('modal-item-nama').value = '';
    if (document.getElementById('modal-item-kategori')) document.getElementById('modal-item-kategori').value = 'Bahan Pergigian (Kontrak)';

    populateModalSubCategories('Bahan Pergigian (Kontrak)', '');
    populateModalUnits('Box');

    if (document.getElementById('modal-item-harga')) document.getElementById('modal-item-harga').value = '0.00';
    if (document.getElementById('modal-item-reorder')) document.getElementById('modal-item-reorder').value = '5';
    if (document.getElementById('modal-item-min')) document.getElementById('modal-item-min').value = '0';
    if (document.getElementById('modal-item-max')) document.getElementById('modal-item-max').value = '0';
    if (document.getElementById('modal-item-baki')) document.getElementById('modal-item-baki').value = '0';
  }

  updateItemUsageNote(itemId ? items.find(i => String(i.id) === String(itemId)) : null);
  modal.classList.remove('hidden');
}

function closeItemModal() {
  hideInlineSubCatInput();
  hideInlineUnitInput();
  const modal = document.getElementById('item-modal');
  if (modal) modal.classList.add('hidden');
}

function populateModalSubCategories(mainCat, selectedSub = '') {
  const select = document.getElementById('modal-item-subkategori');
  if (!select) return;

  const subs = subcategories[mainCat] || [];
  select.innerHTML = '<option value="">-- Pilih Sub-Kategori --</option>' +
    subs.map(s => `<option value="${escapeHtml(s)}" ${s === selectedSub ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');

  if (selectedSub && !subs.includes(selectedSub)) {
    subs.push(selectedSub);
    if (!subcategories[mainCat]) subcategories[mainCat] = [];
    populateModalSubCategories(mainCat, selectedSub);
  } else if (selectedSub) {
    select.value = selectedSub;
  }
}

function populateModalUnits(selectedUnit) {
  const select = document.getElementById('modal-item-unit');
  if (!select) return;

  select.innerHTML = packagingUnits.map(u => `<option value="${escapeHtml(u)}" ${u === selectedUnit ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('');

  if (selectedUnit && !packagingUnits.includes(selectedUnit)) {
    packagingUnits.push(selectedUnit);
    populateModalUnits(selectedUnit);
  } else if (selectedUnit) {
    select.value = selectedUnit;
  }
}

function showInlineSubCatInput() {
  const box = document.getElementById('inline-subcat-box');
  const input = document.getElementById('inline-subcat-input');
  if (box && input) {
    box.classList.remove('hidden');
    input.value = '';
    input.focus();
  }
}

function hideInlineSubCatInput() {
  const box = document.getElementById('inline-subcat-box');
  if (box) box.classList.add('hidden');
}

function saveInlineSubCategory() {
  const input = document.getElementById('inline-subcat-input');
  const mainCat = document.getElementById('modal-item-kategori')?.value || 'Bahan Pergigian (Kontrak)';
  if (!input) return;

  const newSub = input.value.trim();
  if (!newSub) {
    showToast('Sila masukkan nama sub-kategori!', 'error');
    return;
  }

  if (!subcategories[mainCat]) subcategories[mainCat] = [];
  if (!subcategories[mainCat].includes(newSub)) {
    subcategories[mainCat].push(newSub);
    saveState();
  }

  populateModalSubCategories(mainCat, newSub);
  hideInlineSubCatInput();
  showToast(`Sub-kategori "${newSub}" berjaya ditambah!`, 'success');
}

function showInlineUnitInput() {
  const box = document.getElementById('inline-unit-box');
  const input = document.getElementById('inline-unit-input');
  if (box && input) {
    box.classList.remove('hidden');
    input.value = '';
    input.focus();
  }
}

function hideInlineUnitInput() {
  const box = document.getElementById('inline-unit-box');
  if (box) box.classList.add('hidden');
}

function saveInlineUnit() {
  const input = document.getElementById('inline-unit-input');
  if (!input) return;

  const newUnit = input.value.trim();
  if (!newUnit) {
    showToast('Sila masukkan nama unit pembungkusan!', 'error');
    return;
  }

  if (!packagingUnits.includes(newUnit)) {
    packagingUnits.push(newUnit);
    saveState();
  }

  populateModalUnits(newUnit);
  hideInlineUnitInput();
  showToast(`Unit pembungkusan "${newUnit}" berjaya ditambah!`, 'success');
}

function onModalCategoryChange() {
  const mainCat = document.getElementById('modal-item-kategori')?.value || 'Bahan Pergigian (Kontrak)';
  hideInlineSubCatInput();
  populateModalSubCategories(mainCat, '');
}

async function saveItem() {
  const id = document.getElementById('modal-item-id')?.value;
  const sku = document.getElementById('modal-item-sku')?.value.trim();
  const nama = document.getElementById('modal-item-nama')?.value.trim();
  const kat = document.getElementById('modal-item-kategori')?.value || 'Bahan Pergigian (Kontrak)';
  const subkat = document.getElementById('modal-item-subkategori')?.value || '';
  const unit = document.getElementById('modal-item-unit')?.value || 'Box';
  const harga = parseFloat(document.getElementById('modal-item-harga')?.value) || 0;
  const reorder = parseInt(document.getElementById('modal-item-reorder')?.value) || 5;
  const paraMin = Math.max(0, toInt(document.getElementById('modal-item-min')?.value));
  const paraMaks = Math.max(0, toInt(document.getElementById('modal-item-max')?.value));
  const baki = parseInt(document.getElementById('modal-item-baki')?.value) || 0;

  if (!sku || !nama) {
    showToast('Sila isi SKU dan Nama Item!', 'error');
    return;
  }
  if (paraMin > reorder) {
    showToast('Paras Minimum tidak boleh melebihi paras Menokok (Reorder).', 'error');
    return;
  }
  if (paraMaks && paraMaks < reorder) {
    showToast('Paras Maksimum tidak boleh kurang daripada paras Menokok (Reorder).', 'error');
    return;
  }

  const itemData = {
    id: id || String(Date.now()),
    sku, nama, kategori: kat, subkategori: subkat, unit, harga, reorder, paraMin, paraMaks, baki
  };

  if (id) {
    const item = items.find(i => String(i.id) === String(id));
    if (item) Object.assign(item, itemData);
    addAuditLog("Kemaskini Item", `Item [${sku}] ${nama} dikemaskini.`);
  } else {
    items.push(itemData);
    addAuditLog("Tambah Item Baru", `Item baru [${sku}] ${nama} ditambah.`);
  }

  const ok = await runWithLoading('Menyimpan item...', () => saveState());
  closeItemModal();
  renderAll();
  if (ok) showToast('Item berjaya disimpan!', 'success');
}

// ---- Paras stok automatik: Minimum = 1 bulan, Menokok = 2 bulan, Maksimum = 3 bulan purata penggunaan ----
// Penggunaan = kuantiti diluluskan dalam permohonan (stok keluar dari stor daerah).
// Tempoh: 12 bulan terakhir, atau sejak kelulusan pertama jika rekod kurang daripada 12 bulan.
const STOCK_LEVEL_MONTHS = { min: 1, reorder: 2, maks: 3 };

function usageWindow() {
  const today = todayISODate();
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - 12);
  let start = d.toISOString().slice(0, 10);
  const first = requests.filter(r => r.status === 'Selesai' && r.tarikhLulus).map(r => String(r.tarikhLulus)).sort()[0];
  if (first && first > start) start = first;
  const days = (Date.parse(today) - Date.parse(start)) / 86400000 + 1;
  return { start, months: Math.min(12, Math.max(1, days / 30.44)) };
}

function usageTotalsSince(start) {
  const totals = {};
  requests.forEach(r => {
    if (r.status !== 'Selesai' || !(String(r.tarikhLulus || '') >= start)) return;
    (r.items || []).forEach(i => {
      if (i.status !== 'Lulus' || toInt(i.qtyLulus) <= 0) return;
      const inv = findInventoryItem(i);
      if (inv) totals[String(inv.id)] = (totals[String(inv.id)] || 0) + toInt(i.qtyLulus);
    });
  });
  return totals;
}

function suggestedStockLevels(avgPerMonth) {
  return {
    min: Math.ceil(avgPerMonth * STOCK_LEVEL_MONTHS.min),
    reorder: Math.ceil(avgPerMonth * STOCK_LEVEL_MONTHS.reorder),
    maks: Math.ceil(avgPerMonth * STOCK_LEVEL_MONTHS.maks)
  };
}

function itemMonthlyUsage(item) {
  const win = usageWindow();
  const total = item ? (usageTotalsSince(win.start)[String(item.id)] || 0) : 0;
  return { win, total, avg: total / win.months };
}

function updateItemUsageNote(item) {
  const el = document.getElementById('modal-item-usage-note');
  if (!el) return;
  if (!item) {
    el.textContent = 'Item baharu: isi paras secara manual. Paras boleh dikira automatik selepas ada rekod penggunaan.';
    return;
  }
  const { win, total, avg } = itemMonthlyUsage(item);
  el.textContent = total > 0
    ? `Purata penggunaan: ${avg.toFixed(1)} ${item.unit || 'unit'} sebulan (${total} dikeluarkan dalam ${win.months.toFixed(1)} bulan sejak ${formatDate(win.start)}).`
    : `Tiada rekod penggunaan sejak ${formatDate(win.start)}. Isi paras secara manual.`;
}

function fillItemLevelsFromUsage() {
  const id = document.getElementById('modal-item-id')?.value;
  const item = id ? items.find(i => String(i.id) === String(id)) : null;
  const { avg } = itemMonthlyUsage(item);
  if (!item || avg <= 0) {
    showToast('Tiada rekod penggunaan untuk item ini. Sila isi paras secara manual.', 'info');
    return;
  }
  const s = suggestedStockLevels(avg);
  document.getElementById('modal-item-min').value = s.min;
  document.getElementById('modal-item-reorder').value = s.reorder;
  document.getElementById('modal-item-max').value = s.maks;
  showToast(`Paras dikira: Min ${s.min}, Menokok ${s.reorder}, Maks ${s.maks}. Tekan Simpan untuk menyimpan.`, 'success');
}

// Kira semula paras stok bagi item dalam paparan Stok Induk semasa (ikut kategori / carian)
function openAutoStockLevels() {
  if (!isAdminLoggedIn) return;
  const list = getMasterFilteredItems();
  const win = usageWindow();
  const totals = usageTotalsSince(win.start);
  const changes = list.map(i => {
    const total = totals[String(i.id)] || 0;
    if (total <= 0) return null;
    const s = suggestedStockLevels(total / win.months);
    if (s.min === toInt(i.paraMin) && s.reorder === toInt(i.reorder) && s.maks === toInt(i.paraMaks)) return null;
    return { id: String(i.id), ...s };
  }).filter(Boolean);
  const noUsage = list.filter(i => !(totals[String(i.id)] > 0)).length;
  const scope = [masterCatTab || 'Semua Kategori', (document.getElementById('master-search')?.value || '').trim()].filter(Boolean).join(' · ');

  if (changes.length === 0) {
    showToast(`Tiada perubahan: paras stok sudah sepadan dengan penggunaan, atau tiada rekod penggunaan (${scope}).`, 'info');
    return;
  }

  showConfirmModal('Kira Paras Stok Automatik',
    `Berdasarkan purata penggunaan ${win.months.toFixed(1)} bulan (${formatDate(win.start)} hingga hari ini):\n` +
    `• Minimum = 1 bulan penggunaan\n• Menokok (Reorder) = 2 bulan penggunaan\n• Maksimum = 3 bulan penggunaan\n\n` +
    `Paparan: ${scope}\n${changes.length} item akan dikemas kini. ${noUsage} item tiada rekod penggunaan dan tidak diubah.`,
    async () => {
      const token = showLoadingOverlay('Mengemas kini paras stok...');
      try {
        await runStockTransaction(async (tx, fresh) => {
          changes.forEach(c => {
            const it = fresh.items.find(x => String(x.id) === c.id);
            if (it) { it.paraMin = c.min; it.reorder = c.reorder; it.paraMaks = c.maks; }
          });
        });
        addAuditLog('Kira Paras Stok', `${changes.length} item (${scope}): paras Min/Menokok/Maks dikira semula daripada purata penggunaan ${win.months.toFixed(1)} bulan.`);
        showToast(`Paras stok ${changes.length} item dikemas kini.`, 'success');
      } catch (err) {
        showToast('Gagal mengemas kini paras stok: ' + authErrorMessage(err), 'error');
      } finally {
        hideLoadingOverlay(token);
      }
    });
}

function deleteItem(id) {
  showConfirmModal('Padam Item', 'Adakah anda pasti mahu memadam item ini?', async () => {
    const deletedItem = items.find(i => String(i.id) === String(id));
    items = items.filter(i => String(i.id) !== String(id));
    if (deletedItem) addAuditLog("Padam Item", `Item [${deletedItem.sku}] ${deletedItem.nama} dipadam.`);
    const ok = await runWithLoading('Memadam item...', () => saveState());
    renderAll();
    if (ok) showToast('Item telah dipadam.', 'info');
  });
}


// ------------------------------------------
// 13. BORANG PERMOHONAN STOK & NOTIFIKASI E-MEL AUTOMATIK PELULUS
// ------------------------------------------
function switchReqCategoryTab(catGroup) {
  currentReqCatTab = catGroup;

  styleTabGroup('.req-cat-subtab', 'req-subtab-' + catGroup, TAB_STYLES.pill, 'req-cat-subtab');

  populatePemohonDropdown();
}

function filterReqItemDropdown() {
  populatePemohonDropdown();
}

function clearReqItemSearch() {
  if (document.getElementById('req-item-search-input')) {
    document.getElementById('req-item-search-input').value = '';
  }
  populatePemohonDropdown();
}

function populatePemohonDropdown() {
  const select = document.getElementById('req-item-select');
  const searchInput = document.getElementById('req-item-search-input')?.value.toLowerCase().trim() || '';
  const searchCount = document.getElementById('req-item-search-count');
  if (!select) return;

  const filteredItems = items.filter(i => {
    const itemGroup = getItemCategoryGroup(i);
    const matchesTab = currentReqCatTab === 'all' || itemGroup === currentReqCatTab;
    const matchesSearch = !searchInput ||
      i.sku.toLowerCase().includes(searchInput) ||
      i.nama.toLowerCase().includes(searchInput) ||
      (i.kategori && i.kategori.toLowerCase().includes(searchInput));

    return matchesTab && matchesSearch;
  });

  if (searchCount) {
    searchCount.innerText = searchInput ? `Ditemui ${filteredItems.length} item sepadan.` : '';
  }

  if (filteredItems.length === 0) {
    select.innerHTML = '<option value="">-- Tiada item sepadan --</option>';
    return;
  }

  select.innerHTML = '<option value="">-- Pilih Item Stok --</option>' +
    filteredItems.map(i => `<option value="${escapeHtml(i.id)}">[${escapeHtml(i.sku)}] ${escapeHtml(i.nama)} (Baki: ${toInt(i.baki)})</option>`).join('');
}

function addDraftItem() {
  const selectEl = document.getElementById('req-item-select');
  const itemId = selectEl ? selectEl.value : '';
  const qtyInput = document.getElementById('req-item-qty');
  const qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;

  if (!itemId) {
    showToast('Sila pilih item terlebih dahulu!', 'error');
    return;
  }

  const invItem = items.find(i => String(i.id) === String(itemId));
  if (!invItem) return;

  const newItemGroup = getItemCategoryGroup(invItem);

  if (draftReqItems.length > 0) {
    const existingGroup = draftReqItems[0].categoryGroup;
    if (existingGroup !== newItemGroup) {
      showToast('PERMOHONAN BERASINGAN! Sila hantar permohonan sedia ada sebelum memohon kategori lain.', 'error');
      return;
    }
  }

  const existing = draftReqItems.find(d => String(d.itemId) === String(invItem.id));
  if (existing) {
    existing.qtyMohon += qty;
  } else {
    draftReqItems.push({
      itemId: invItem.id,
      sku: invItem.sku,
      nama: invItem.nama,
      kategori: invItem.kategori,
      baki: invItem.baki,
      qtyMohon: qty,
      categoryGroup: newItemGroup
    });
  }

  renderDraftTable();
  showToast(`Menambah ${invItem.nama} ke borang.`, 'success');
}

function renderDraftTable() {
  const tbody = document.getElementById('draft-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (draftReqItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Belum ada item ditambah.</td></tr>`;
    return;
  }

  draftReqItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-100';
    tr.innerHTML = `
      <td class="p-3 font-bold text-slate-800">${escapeHtml(item.sku)}</td>
      <td class="p-3 font-medium">${escapeHtml(item.nama)}</td>
      <td class="p-3 text-slate-500"><span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold">${escapeHtml(item.kategori || '')}</span></td>
      <td class="p-3 text-center font-bold">${toInt(item.baki)}</td>
      <td class="p-3 text-center font-bold text-purple-700">${toInt(item.qtyMohon)}</td>
      <td class="p-3 text-center">
        <button type="button" onclick="draftReqItems.splice(${index}, 1); renderDraftTable();" class="text-rose-600 hover:text-rose-800 font-bold"><i class="fa-solid fa-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Popup loading - menghalang pengguna menekan butang berulang kali semasa proses berjalan
let loadingOverlayToken = 0;

// Papar popup loading; pulangkan token supaya hanya pemanggil yang sama boleh menutupnya
function showLoadingOverlay(msg) {
  const overlay = document.getElementById('loading-overlay');
  const text = document.getElementById('loading-overlay-text');
  if (text) text.textContent = msg || 'Sila tunggu...';
  if (overlay) overlay.classList.remove('hidden');
  return ++loadingOverlayToken;
}

// Tanpa token: tutup terus. Dengan token: tutup hanya jika tiada popup lebih baharu dibuka
function hideLoadingOverlay(token) {
  if (token !== undefined && token !== loadingOverlayToken) return;
  document.getElementById('loading-overlay')?.classList.add('hidden');
}

const SLOW_OPERATION_MS = 20000;

// Jalankan tugas dengan popup loading. Jika sambungan terlalu perlahan, popup ditutup selepas 20 saat
// (Firestore akan terus menyimpan di latar belakang apabila sambungan pulih).
async function runWithLoading(message, task) {
  const token = showLoadingOverlay(message);
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(() => resolve('__perlahan__'), SLOW_OPERATION_MS); });
  try {
    const result = await Promise.race([Promise.resolve().then(task), slow]);
    if (result === '__perlahan__') {
      showToast('Sambungan perlahan. Perubahan akan disimpan ke Cloud apabila sambungan pulih.', 'info');
      return true;
    }
    return result;
  } finally {
    clearTimeout(timer);
    hideLoadingOverlay(token);
  }
}

let isSubmittingRequest = false;

async function submitRequest() {
  if (isSubmittingRequest) return; // abaikan klik berulang semasa permohonan sedang dihantar

  const nama = document.getElementById('req-nama')?.value.trim();
  const jawatan = document.getElementById('req-jawatan')?.value.trim();
  const gred = document.getElementById('req-gred')?.value.trim();
  const unit = document.getElementById('req-unit')?.value;

  if (!nama || !jawatan || !gred || !unit) {
    showToast('Sila isi Nama, Jawatan, Gred, dan Unit / Klinik!', 'error');
    return;
  }

  if (draftReqItems.length === 0) {
    showToast('Sila tambah sekurang-kurangnya 1 item!', 'error');
    return;
  }

  if (!db || !currentUserEmail) {
    showToast('Sila log masuk semula.', 'error');
    return;
  }

  const submittedItems = [...draftReqItems];
  const year = new Date().getFullYear();
  const counterRef = db.collection('kraipro_counters').doc(`bpsi_${year}`);
  let reqId = '';
  let newReq = null;

  isSubmittingRequest = true;
  const submitBtn = document.getElementById('req-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  showLoadingOverlay('Menghantar permohonan anda...');

  try {
    await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const seq = counterSnap.exists ? (counterSnap.data().seq || 0) + 1 : 1;
      reqId = 'BPSI-' + year + '-' + String(seq).padStart(3, '0');

      const existing = await tx.get(requestRef(reqId));
      if (existing.exists) throw new Error(`No. permohonan ${reqId} telah wujud. Sila hubungi SuperAdmin.`);

      newReq = {
        id: reqId,
        ownerEmail: currentUserEmail,
        createdAt: new Date().toISOString(),
        nama: nama,
        jawatan: jawatan,
        gred: gred,
        unit: unit,
        tarikh: todayISODate(),
        status: 'Pending',
        items: submittedItems.map(d => ({
          itemId: d.itemId,
          sku: d.sku,
          nama: d.nama,
          kategori: d.kategori,
          qtyMohon: d.qtyMohon,
          qtyLulus: 0,
          status: 'Menunggu'
        }))
      };

      tx.set(counterRef, { seq: seq });
      tx.set(requestRef(reqId), newReq);
    });
  } catch (err) {
    showToast('Permohonan gagal dihantar: ' + authErrorMessage(err), 'error');
    return;
  } finally {
    isSubmittingRequest = false;
    if (submitBtn) submitBtn.disabled = false;
    hideLoadingOverlay();
  }

  addAuditLog("Permohonan Baru", `Permohonan ${reqId} dihantar oleh ${nama} (${unit}).`);

  const reqCategory = submittedItems.length > 0 ? submittedItems[0].kategori : '';
  const matchingApprovers = approverUsers.filter(a => 
    a.allowedCategories && (a.allowedCategories.includes(reqCategory) || a.allowedCategories.includes('all'))
  );

  let targetEmailsList = matchingApprovers.map(a => a.email).filter(e => e);
  if (targetEmailsList.length === 0) {
    targetEmailsList.push(SUPERADMIN_EMAIL);
  }

  const targetEmailStr = targetEmailsList.join(', ');
  const itemListFormatted = submittedItems.map(i => `- ${i.nama} (${i.sku}): ${i.qtyMohon} kuantiti`).join('\n');
  const fullMessageBody = `PERMOHONAN STOK BARU\n\nNo. Permohonan: ${reqId}\nNama Pemohon: ${nama}\nJawatan/Gred: ${jawatan} (${gred})\nUnit/Klinik: ${unit}\nKategori Item: ${reqCategory}\nTarikh: ${formatDate(newReq.tarikh)}\n\nSENARAI ITEM:\n${itemListFormatted}`;

  if (window.emailjs) {
    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: targetEmailStr,
      req_id: reqId,
      applicant_name: nama,
      applicant_jawatan: `${jawatan} (${gred})`,
      applicant_unit: unit,
      request_date: formatDate(newReq.tarikh),
      item_list: itemListFormatted,
      from_name: `${nama} (${unit})`,
      message: fullMessageBody,
      reply_to: targetEmailStr
    }, EMAILJS_PUBLIC_KEY).then(() => {
      showToast('Permohonan & Notifikasi E-mel Automatik Berjaya Dihantar ke Pelulus!', 'success');
    }).catch((err) => {
      console.warn("Gagal hantar e-mel automatik:", err);
      showToast('Permohonan berjaya dihantar ke Cloud Firestore!', 'info');
    });
  } else {
    showToast('Permohonan stok berjaya dihantar!', 'success');
  }

  draftReqItems = [];
  const namaInput = document.getElementById('req-nama');
  if (namaInput && !namaInput.readOnly) namaInput.value = '';
  prefillRequesterForm();
  renderAll();
}

function renderSejarahPermohonan() {
  const pendingContainer = document.getElementById('pending-history-container');
  const completedContainer = document.getElementById('completed-history-container');

  if (!pendingContainer || !completedContainer) return;

  pendingContainer.innerHTML = '';
  completedContainer.innerHTML = '';

  // Sejarah peribadi: hanya permohonan yang dibuat menggunakan akaun ini
  // (Pelulus/SuperAdmin menyemak semua permohonan di tab Pentadbir → Kelulusan Permohonan)
  const myRequests = requests.filter(r => r.ownerEmail && r.ownerEmail === currentUserEmail);
  const pendingList = myRequests.filter(r => r.status === 'Pending');
  const completedList = myRequests.filter(r => r.status !== 'Pending');

  if (pendingList.length === 0) {
    pendingContainer.innerHTML = `<div class="p-4 bg-slate-50 text-slate-400 text-xs text-center rounded-xl">Tiada permohonan belum selesai.</div>`;
  } else {
    pendingList.forEach(r => pendingContainer.appendChild(createReqCard(r, false, false)));
  }

  renderRequestHistory('hist-pemohon', completedList);
}


// ------------------------------------------
// 14. REKOD PERMOHONAN DIPROSES: PENAPIS & KUMPULAN MENGIKUT BULAN
// ------------------------------------------
const BULAN_NAMA = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

const historyViews = {
  'hist-admin': { containerId: 'admin-completed-container', isAdminView: true, emptyText: 'Tiada permohonan selesai diproses.', rerender: () => renderAdminRequests() },
  'hist-pemohon': { containerId: 'completed-history-container', isAdminView: false, emptyText: 'Tiada sejarah permohonan selesai.', rerender: () => renderSejarahPermohonan() }
};

// Bulan yang sedang dibuka bagi setiap paparan (null = belum ditetapkan; bulan terkini dibuka secara lalai)
const historyOpenMonths = { 'hist-admin': null, 'hist-pemohon': null };

function requestMonthKey(r) {
  const d = String(r.tarikh || r.createdAt || '');
  return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : 'tiada-tarikh';
}

function monthKeyLabel(key) {
  if (key === 'tiada-tarikh') return 'Tiada Tarikh';
  const [y, m] = key.split('-');
  return `${BULAN_NAMA[parseInt(m) - 1] || m} ${y}`;
}

function getHistoryFilters(prefix) {
  const val = (suffix) => document.getElementById(`${prefix}-${suffix}`)?.value || '';
  return {
    search: val('search').trim().toLowerCase(),
    year: val('year'),
    month: val('month'),
    status: val('status')
  };
}

function matchesHistoryFilters(r, f) {
  const key = requestMonthKey(r);
  if (f.year && !key.startsWith(f.year + '-')) return false;
  if (f.month && key.slice(5, 7) !== f.month) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.search) {
    const haystack = [r.id, r.nama, r.jawatan, r.unit, r.pelulusNama, ...(r.items || []).flatMap(i => [i.sku, i.nama])]
      .join(' ').toLowerCase();
    if (!haystack.includes(f.search)) return false;
  }
  return true;
}

function populateHistoryYearOptions(prefix, list) {
  const select = document.getElementById(`${prefix}-year`);
  if (!select) return;
  const years = [...new Set(list.map(r => requestMonthKey(r).slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
  const signature = years.join(',');
  if (select.dataset.sig === signature) return; // elak bina semula (kekalkan pilihan pengguna)
  const current = select.value;
  select.innerHTML = '<option value="">Semua Tahun</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  select.value = years.includes(current) ? current : '';
  select.dataset.sig = signature;
}

function onHistoryFilterChange(prefix) {
  historyViews[prefix]?.rerender();
}

function resetHistoryFilter(prefix) {
  ['search', 'year', 'month', 'status'].forEach(suffix => {
    const el = document.getElementById(`${prefix}-${suffix}`);
    if (el) el.value = '';
  });
  historyOpenMonths[prefix] = null;
  onHistoryFilterChange(prefix);
}

function renderRequestHistory(prefix, list) {
  const view = historyViews[prefix];
  const container = document.getElementById(view.containerId);
  if (!container) return;

  populateHistoryYearOptions(prefix, list);
  const f = getHistoryFilters(prefix);
  const filtered = list.filter(r => matchesHistoryFilters(r, f));
  const isFiltered = !!(f.search || f.year || f.month || f.status);

  if (prefix === 'hist-admin') {
    const olderBtn = document.getElementById('hist-admin-load-older');
    const olderText = document.getElementById('hist-admin-load-older-text');
    if (olderBtn) olderBtn.classList.toggle('hidden', olderRequestsLoaded || !isAdminLoggedIn);
    if (olderText) olderText.textContent = `Papar permohonan sebelum ${requestWindowStart().slice(0, 4)}`;
  }

  const summary = document.getElementById(`${prefix}-summary`);
  if (summary) {
    summary.textContent = isFiltered
      ? `Memaparkan ${filtered.length} daripada ${list.length} permohonan.`
      : `${list.length} permohonan keseluruhan. Klik pada bulan untuk buka / tutup.`;
  }

  container.innerHTML = '';
  if (list.length === 0 || filtered.length === 0) {
    const msg = list.length === 0 ? view.emptyText : 'Tiada permohonan sepadan dengan carian / penapis.';
    container.innerHTML = `<div class="p-4 bg-slate-50 text-slate-400 text-xs text-center rounded-xl">${escapeHtml(msg)}</div>`;
    return;
  }

  // Kumpulkan mengikut bulan (terkini dahulu; "Tiada Tarikh" paling bawah)
  const groups = new Map();
  filtered.forEach(r => {
    const key = requestMonthKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const keys = [...groups.keys()].sort((a, b) =>
    a === 'tiada-tarikh' ? 1 : b === 'tiada-tarikh' ? -1 : b.localeCompare(a)
  );

  if (historyOpenMonths[prefix] === null) {
    const latest = list.map(requestMonthKey).filter(k => k !== 'tiada-tarikh').sort().reverse()[0];
    historyOpenMonths[prefix] = new Set(latest ? [latest] : []);
  }
  // Semasa mencari atau memilih bulan tertentu, buka semua kumpulan yang dipaparkan
  const openAll = !!(f.search || f.month);

  keys.forEach(key => {
    const groupItems = groups.get(key);
    const count = (status) => groupItems.filter(r => r.status === status).length;
    const nLulus = count('Selesai'), nTolak = count('Ditolak'), nBatal = count('Dibatalkan');

    const details = document.createElement('details');
    details.className = 'group bg-white border border-slate-200 rounded-2xl overflow-hidden';
    details.open = openAll || historyOpenMonths[prefix].has(key);
    details.innerHTML = `
      <summary class="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition">
        <span class="flex items-center gap-2 text-sm font-extrabold text-slate-800">
          <i class="fa-solid fa-chevron-right text-[10px] text-slate-400 transition-transform group-open:rotate-90"></i>
          <i class="fa-regular fa-calendar text-purple-600"></i> ${escapeHtml(monthKeyLabel(key))}
        </span>
        <span class="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
          <span class="bg-slate-900 text-white px-2 py-0.5 rounded-full">${groupItems.length} permohonan</span>
          ${nLulus ? `<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">${nLulus} diluluskan</span>` : ''}
          ${nTolak ? `<span class="bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">${nTolak} ditolak</span>` : ''}
          ${nBatal ? `<span class="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">${nBatal} dibatalkan</span>` : ''}
        </span>
      </summary>
      <div class="p-3 space-y-3 border-t border-slate-200" data-body></div>`;

    // Kad hanya dibina apabila kumpulan dibuka (laju walaupun rekod banyak)
    const body = details.querySelector('[data-body]');
    const fill = () => {
      if (body.childElementCount) return;
      groupItems.forEach(r => body.appendChild(createReqCard(r, true, view.isAdminView)));
    };
    if (details.open) fill();

    details.addEventListener('toggle', () => {
      if (details.open) fill();
      if (openAll) return; // jangan ubah pilihan lalai semasa carian
      if (details.open) historyOpenMonths[prefix].add(key);
      else historyOpenMonths[prefix].delete(key);
    });

    container.appendChild(details);
  });
}

function createReqCard(r, isCompleted, showDelete = false) {
  const card = document.createElement('div');
  card.className = 'bg-slate-50 border border-slate-200/80 p-4 rounded-xl space-y-3';

  const itemsHtml = r.items.map(i => `
    <tr class="border-b border-slate-100">
      <td class="p-2 font-bold">${escapeHtml(i.sku)}</td>
      <td class="p-2">${escapeHtml(i.nama)}</td>
      <td class="p-2 text-center font-bold">${toInt(i.qtyMohon)}</td>
      <td class="p-2 text-center font-bold text-purple-900">${toInt(i.qtyLulus)}</td>
      <td class="p-2 text-center">${escapeHtml(i.status || '-')}</td>
    </tr>
  `).join('');

  // Penentuan Butang Tindakan mengikut Peranan & Status
  let actionButtonsHtml = '';

  if (isCompleted) {
    actionButtonsHtml += `<button type="button" data-id="${escapeHtml(r.id)}" onclick="previewKewPs8(this.dataset.id)" class="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-3 py-1 rounded-lg shadow"><i class="fa-solid fa-file-pdf mr-1"></i> Cetak KEW.PS-8</button>`;
    if (isAdminLoggedIn && currentUserRole === 'superadmin' && r.status === 'Selesai') {
      actionButtonsHtml += `<button type="button" data-id="${escapeHtml(r.id)}" onclick="cancelApprovedRequest(this.dataset.id)" class="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-2.5 py-1 rounded-lg shadow transition flex items-center gap-1"><i class="fa-solid fa-ban"></i> Batalkan Permohonan</button>`;
    }
  } else {
    // Permohonan Pending
    actionButtonsHtml += `<span class="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-lg text-xs font-bold mr-1">Menunggu Kelulusan</span>`;
    if (isAdminLoggedIn || r.ownerEmail === currentUserEmail) actionButtonsHtml += `<button type="button" data-id="${escapeHtml(r.id)}" onclick="cancelPendingRequest(this.dataset.id)" class="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-2.5 py-1 rounded-lg shadow transition flex items-center gap-1"><i class="fa-solid fa-xmark"></i> Batalkan Permohonan</button>`;
  }

  card.innerHTML = `
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
      <div>
        <span class="text-xs font-black text-purple-900 mr-2">${escapeHtml(r.id)}</span>
        <span class="text-xs font-bold text-slate-700">${escapeHtml(r.nama)} (${escapeHtml(r.jawatan)} ${escapeHtml(r.gred)}) - ${escapeHtml(r.unit)}</span>
        <span class="text-[10px] text-slate-400 block sm:inline sm:ml-2">${escapeHtml(formatDate(r.tarikh))}</span>
      </div>
      <div class="flex items-center gap-2">
        ${actionButtonsHtml}
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs">
        <thead>
          <tr class="bg-slate-200 text-slate-700 font-bold uppercase">
            <th class="p-2">SKU</th>
            <th class="p-2">Item</th>
            <th class="p-2 text-center">Mohon</th>
            <th class="p-2 text-center">Lulus</th>
            <th class="p-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>
  `;
  return card;
}


// ------------------------------------------
// 15. PENGURUSAN LPO
// ------------------------------------------
function populateLpoItemDropdown() {
  const select = document.getElementById('lpo-item-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Pilih Item --</option>' +
    items.map(i => `<option value="${escapeHtml(i.id)}">[${escapeHtml(i.sku)}] ${escapeHtml(i.nama)}</option>`).join('');
}

// Direktori pembekal disusun A-Z (paparan sahaja; susunan simpanan tidak berubah)
function sortedPembekal() {
  return [...pembekalList].sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'ms', { sensitivity: 'base', numeric: true }));
}

function populatePembekalDropdowns() {
  const select = document.getElementById('lpo-pembekal');
  if (!select) return;
  const current = select.value; // kekalkan pilihan pengguna apabila data dikemas kini
  select.innerHTML = '<option value="">-- Pilih Pembekal --</option>' +
    sortedPembekal().map(p => `<option value="${escapeHtml(p.nama)}">${escapeHtml(p.nama)}</option>`).join('');
  if (current && pembekalList.some(p => p.nama === current)) select.value = current;
}

function addLpoDraftItem() {
  const itemId = document.getElementById('lpo-item-select')?.value;
  const qty = parseInt(document.getElementById('lpo-item-qty')?.value) || 1;

  if (!itemId) {
    showToast('Sila pilih item terlebih dahulu!', 'error');
    return;
  }

  const invItem = items.find(i => String(i.id) === String(itemId));
  if (!invItem) return;

  const existing = draftLpoItems.find(d => String(d.itemId) === String(invItem.id));
  if (existing) {
    existing.qty += qty;
  } else {
    draftLpoItems.push({
      itemId: invItem.id,
      sku: invItem.sku,
      nama: invItem.nama,
      unit: invItem.unit || 'Box',
      qty: qty
    });
  }
  renderLpoDraftTable();
}

function renderLpoDraftTable() {
  const tbody = document.getElementById('lpo-draft-body');
  if (!tbody) return;

  if (draftLpoItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-400">Belum ada item pesanan ditambah.</td></tr>`;
    return;
  }

  tbody.innerHTML = draftLpoItems.map((i, idx) => `
    <tr class="border-b border-slate-100">
      <td class="p-2 font-bold">${escapeHtml(i.sku)}</td>
      <td class="p-2">${escapeHtml(i.nama)}</td>
      <td class="p-2 text-center font-bold text-blue-700">${toInt(i.qty)} ${escapeHtml(i.unit)}</td>
      <td class="p-2 text-center">
        <button type="button" onclick="draftLpoItems.splice(${idx}, 1); renderLpoDraftTable();" class="text-rose-600 font-bold hover:text-rose-800"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

async function submitLpoOrder() {
  const lpoNo = document.getElementById('lpo-no')?.value.trim();
  const pembekal = document.getElementById('lpo-pembekal')?.value;
  const tarikh = document.getElementById('lpo-tarikh')?.value;

  if (!lpoNo || !pembekal || !tarikh) {
    showToast('Sila lengkapkan No. LPO, Pembekal dan Tarikh!', 'error');
    return;
  }

  if (draftLpoItems.length === 0) {
    showToast('Sila tambah sekurang-kurangnya satu item pesanan!', 'error');
    return;
  }

  if (lpoList.some(l => String(l.no).trim().toLowerCase() === lpoNo.toLowerCase())) {
    showToast(`No. LPO ${lpoNo} telah wujud. Sila semak semula nombor LPO.`, 'error');
    return;
  }

  const lpoRef = db.collection('kraipro_lpo').doc();
  const newLpo = {
    id: lpoRef.id,
    no: lpoNo,
    pembekal: pembekal,
    tarikh: tarikh,
    status: 'Dalam Proses',
    items: [...draftLpoItems],
    createdAt: new Date().toISOString(),
    dibuatOleh: currentUserEmail
  };

  const ok = await runWithLoading(`Merekod pesanan LPO ${lpoNo}...`, () => lpoRef.set(newLpo).then(() => true).catch(err => {
    showToast('Gagal merekod LPO: ' + authErrorMessage(err), 'error');
    return false;
  }));
  if (!ok) return;
  addAuditLog("Pesanan LPO Baru", `Pesanan LPO ${lpoNo} dihantar kepada ${pembekal}.`);

  draftLpoItems = [];
  if (document.getElementById('lpo-no')) document.getElementById('lpo-no').value = '';
  renderLpoDraftTable();
  renderMasterLpoTable();
  renderAll();
  if (ok) showToast(`Pesanan LPO ${lpoNo} berjaya direkodkan!`, 'success');
}

// ---- KEW.PS-1: Borang Terimaan Barang-Barang (BTB) ----
const BTB_JENIS_PENERIMAAN = ['Pembelian', 'Kontrak', 'Pindahan', 'Hadiah / Sumbangan', 'Pulangan', 'Lain-lain'];
const DEFAULT_JABATAN = 'PERKHIDMATAN PERGIGIAN DAERAH KUALA KRAI';
let btbPendingLpoId = '';

// Baris yang benar-benar diterima: ikut BTB jika ada, jika tidak ikut kuantiti LPO
function lpoReceivedLines(lpo) {
  if (lpo.btb && Array.isArray(lpo.btb.items)) {
    return lpo.btb.items.map(b => ({ itemId: b.itemId, sku: b.sku, nama: b.nama, unit: b.unit, qty: toInt(b.diterima) }));
  }
  return lpo.items || [];
}

function findPembekal(nama) {
  return pembekalList.find(p => String(p.nama || '').trim().toLowerCase() === String(nama || '').trim().toLowerCase());
}

function confirmLpoReceipt(lpoId) {
  const lpo = lpoList.find(l => l.id === lpoId);
  if (!lpo || lpo.status === 'Selesai' || !isAdminLoggedIn) return;
  btbPendingLpoId = lpoId;

  const today = todayISODate();
  const nama = (currentUserProfile && currentUserProfile.nama) || (currentUserRole === 'superadmin' ? 'SuperAdmin' : currentUserEmail);
  const jawatan = (currentUserProfile && currentUserProfile.jawatan) || '';
  const jabatan = document.getElementById('kewps14-input-jabatan')?.value || DEFAULT_JABATAN;
  const pb = findPembekal(lpo.pembekal);
  const input = 'w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-semibold focus:ring-2 focus:ring-emerald-500';

  const subtitle = document.getElementById('btb-modal-subtitle');
  if (subtitle) subtitle.textContent = `LPO ${lpo.no} · ${lpo.pembekal}`;

  const rows = (lpo.items || []).map((i, idx) => {
    const inv = findInventoryItem(i);
    const harga = inv ? (parseFloat(inv.harga) || 0) : 0;
    const qty = toInt(i.qty);
    return `
      <tr class="border-b border-slate-100" data-idx="${idx}">
        <td class="p-2 font-black whitespace-nowrap">${escapeHtml(i.sku)}</td>
        <td class="p-2 font-semibold">${escapeHtml(i.nama)}</td>
        <td class="p-2 text-center">${escapeHtml(i.unit || (inv && inv.unit) || '')}</td>
        <td class="p-2 text-center font-bold">${qty}</td>
        <td class="p-2"><input type="number" min="0" value="${qty}" class="btb-qty-do w-20 text-center ${input}"></td>
        <td class="p-2"><input type="number" min="0" value="${qty}" data-harga="${harga}" oninput="updateBtbRowTotal(this)" class="btb-qty-terima w-20 text-center ${input} bg-emerald-50 border-emerald-300"></td>
        <td class="p-2 text-right whitespace-nowrap">${formatRM(harga)}</td>
        <td class="p-2 text-right font-bold whitespace-nowrap btb-row-total">${formatRM(harga * qty)}</td>
        <td class="p-2"><input type="text" class="btb-catatan w-32 ${input}" placeholder="-"></td>
      </tr>`;
  }).join('');

  const body = document.getElementById('btb-modal-body');
  body.innerHTML = `
    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
      <div><span class="text-slate-500 font-bold block">Pembekal</span><b>${escapeHtml(lpo.pembekal)}</b>${pb && pb.alamat ? `<span class="block text-slate-500">${escapeHtml(pb.alamat)}</span>` : ''}</div>
      <div><span class="text-slate-500 font-bold block">Pesanan Kerajaan (PK) / LPO</span><b>${escapeHtml(lpo.no)}</b> · ${escapeHtml(formatDate(lpo.tarikh))}</div>
      <div><span class="text-slate-500 font-bold block">No. Rujukan BTB</span><b class="text-emerald-700">Dijana automatik semasa disahkan</b></div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Jenis Penerimaan <span class="text-rose-500">*</span></label>
        <select id="btb-jenis" class="${input}">${BTB_JENIS_PENERIMAAN.map(j => `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`).join('')}</select>
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">No. Nota Hantaran (DO)</label>
        <input type="text" id="btb-do-no" class="${input}" placeholder="Cth: DO-12345">
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">Tarikh Nota Hantaran</label>
        <input type="date" id="btb-do-tarikh" value="${today}" class="${input}">
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">Tarikh Terima <span class="text-rose-500">*</span></label>
        <input type="date" id="btb-tarikh-terima" value="${today}" max="${today}" class="${input}">
      </div>
      <div class="sm:col-span-2 lg:col-span-4">
        <label class="block font-bold text-slate-700 mb-1">Maklumat Pengangkutan</label>
        <input type="text" id="btb-pengangkutan" class="${input}" placeholder="Cth: Lori syarikat (No. Pend. ABC 1234) / Pos Laju / Diambil sendiri">
      </div>
    </div>

    <div class="overflow-x-auto border border-slate-200 rounded-2xl">
      <table class="w-full min-w-[820px] text-left border-collapse">
        <thead class="bg-slate-900 text-amber-400 font-bold uppercase text-[10px]">
          <tr>
            <th class="p-2">No. Kod</th><th class="p-2">Perihal Barang</th><th class="p-2 text-center">Unit</th>
            <th class="p-2 text-center">Dipesan (PK)</th><th class="p-2 text-center">Nota Hantaran (DO)</th><th class="p-2 text-center">Diterima</th>
            <th class="p-2 text-right">Seunit (RM)</th><th class="p-2 text-right">Jumlah (RM)</th><th class="p-2">Catatan</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="text-[11px] text-slate-500 -mt-3"><i class="fa-solid fa-circle-info mr-1"></i> Stok akan ditambah mengikut kuantiti <b>Diterima</b>. Jika kurang daripada dipesan, nyatakan sebab dalam Catatan.</p>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="border border-slate-200 rounded-2xl p-3 space-y-2">
        <p class="font-extrabold text-slate-800">Pegawai Penerima <span class="text-rose-500">*</span></p>
        <input type="text" id="btb-penerima-nama" value="${escapeHtml(nama)}" class="${input}" placeholder="Nama">
        <input type="text" id="btb-penerima-jawatan" value="${escapeHtml(jawatan)}" class="${input}" placeholder="Jawatan">
        <input type="text" id="btb-penerima-jabatan" value="${escapeHtml(jabatan)}" class="${input}" placeholder="Jabatan">
      </div>
      <div class="border border-slate-200 rounded-2xl p-3 space-y-2">
        <p class="font-extrabold text-slate-800">Pegawai Teknikal <span class="text-slate-400 font-semibold">(jika perlu)</span></p>
        <input type="text" id="btb-teknikal-nama" class="${input}" placeholder="Nama">
        <input type="text" id="btb-teknikal-jawatan" class="${input}" placeholder="Jawatan">
        <input type="text" id="btb-teknikal-jabatan" class="${input}" placeholder="Jabatan">
      </div>
    </div>`;

  document.getElementById('btb-modal')?.classList.remove('hidden');
}

function updateBtbRowTotal(input) {
  const row = input.closest('tr');
  const harga = parseFloat(input.dataset.harga) || 0;
  const cell = row && row.querySelector('.btb-row-total');
  if (cell) cell.textContent = formatRM(harga * Math.max(0, toInt(input.value)));
}

function closeBtbModal() {
  document.getElementById('btb-modal')?.classList.add('hidden');
  btbPendingLpoId = '';
}

async function confirmBtbReceipt() {
  const lpoId = btbPendingLpoId;
  const lpo = lpoList.find(l => l.id === lpoId);
  if (!lpo || !isAdminLoggedIn) return;
  if (lpo._legacy) {
    showToast('LPO ini sedang dipindahkan ke format baharu. Sila muat semula halaman dan cuba lagi.', 'error');
    return;
  }

  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const tarikhTerima = val('btb-tarikh-terima');
  const penerimaNama = val('btb-penerima-nama');

  const lines = [...document.querySelectorAll('#btb-modal-body tbody tr')].map(tr => {
    const i = lpo.items[parseInt(tr.dataset.idx)];
    return {
      itemId: i.itemId, sku: i.sku, nama: i.nama, unit: i.unit || '',
      dipesan: toInt(i.qty),
      qtyDO: Math.max(0, toInt(tr.querySelector('.btb-qty-do').value)),
      diterima: Math.max(0, toInt(tr.querySelector('.btb-qty-terima').value)),
      catatan: tr.querySelector('.btb-catatan').value.trim()
    };
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikhTerima)) { showToast('Sila isi Tarikh Terima.', 'error'); return; }
  if (!penerimaNama) { showToast('Sila isi nama Pegawai Penerima.', 'error'); return; }
  if (!lines.some(l => l.diterima > 0)) { showToast('Sekurang-kurangnya satu item mesti mempunyai kuantiti diterima.', 'error'); return; }
  const shortNoNote = lines.find(l => l.diterima < l.dipesan && !l.catatan);
  if (shortNoNote) { showToast(`Kuantiti diterima ${shortNoNote.sku} kurang daripada dipesan. Sila nyatakan sebab dalam Catatan.`, 'error'); return; }

  const pb = findPembekal(lpo.pembekal);
  const teknikalNama = val('btb-teknikal-nama');
  const btbBase = {
    jenis: val('btb-jenis') || BTB_JENIS_PENERIMAAN[0],
    pkNo: lpo.no,
    pkTarikh: lpo.tarikh || '',
    doNo: val('btb-do-no'),
    doTarikh: val('btb-do-tarikh'),
    tarikhTerima,
    pengangkutan: val('btb-pengangkutan'),
    pembekalNama: lpo.pembekal || '',
    pembekalAlamat: (pb && pb.alamat) || '',
    penerima: { nama: penerimaNama, jawatan: val('btb-penerima-jawatan'), jabatan: val('btb-penerima-jabatan'), tarikh: tarikhTerima },
    teknikal: teknikalNama ? { nama: teknikalNama, jawatan: val('btb-teknikal-jawatan'), jabatan: val('btb-teknikal-jabatan'), tarikh: tarikhTerima } : null,
    direkodOleh: currentUserEmail,
    direkodPada: new Date().toISOString()
  };

  closeBtbModal();
  showLoadingOverlay(`Merekod penerimaan stok LPO ${lpo.no}...`);
  let btbNo = '';
  try {
    const year = tarikhTerima.slice(0, 4);
    const counterRef = db.collection('kraipro_counters').doc(`btb_${year}`);

    const lpoRef = db.collection('kraipro_lpo').doc(lpoId);
    await runStockTransaction(async (tx, fresh) => {
      const counterSnap = await tx.get(counterRef);
      const lpoSnap = await tx.get(lpoRef);
      const seq = counterSnap.exists ? (counterSnap.data().seq || 0) + 1 : 1;
      btbNo = `BTB-${year}-${String(seq).padStart(3, '0')}`;

      if (!lpoSnap.exists) throw new Error('LPO tidak dijumpai.');
      const freshLpo = lpoSnap.data();
      if (freshLpo.status === 'Selesai') throw new Error('Stok bagi LPO ini telah diterima.');

      // Harga direkod pada tarikh terima (untuk rekod KEW.PS-1)
      const btbItems = lines.map(l => {
        const inv = fresh.items.find(it => String(it.id) === String(l.itemId) || it.sku === l.sku);
        const harga = inv ? (parseFloat(inv.harga) || 0) : 0;
        if (inv) inv.baki = (parseInt(inv.baki) || 0) + l.diterima;
        return { ...l, unit: l.unit || (inv && inv.unit) || '', harga, jumlah: Math.round(harga * l.diterima * 100) / 100 };
      });

      tx.update(lpoRef, { status: 'Selesai', tarikhTerima, btb: { ...btbBase, no: btbNo, items: btbItems } });
      tx.set(counterRef, { seq });
    });

    const totalDiterima = lines.reduce((s, l) => s + l.diterima, 0);
    addAuditLog("Penerimaan LPO", `Penerimaan stok LPO ${lpo.no} disahkan (${btbNo}, ${totalDiterima} unit diterima).`);
    showToast(`Stok ${lpo.no} diterima. KEW.PS-1 ${btbNo} dijana.`, 'success');
    setTimeout(() => previewKewPs1(lpoId), 600); // tunggu data dikemas kini
  } catch (err) {
    showToast('Penerimaan LPO gagal: ' + authErrorMessage(err), 'error');
  } finally {
    hideLoadingOverlay();
  }
}

// Pratonton & cetak KEW.PS-1 (format AM 6.2 Lampiran A)
function previewKewPs1(lpoId) {
  const lpo = lpoList.find(l => l.id === lpoId);
  const content = document.getElementById('kewps8-content');
  if (!lpo || !content) return;

  // LPO lama tanpa rekod BTB: bina daripada data LPO (medan yang tiada dibiarkan kosong)
  const b = lpo.btb || {
    no: '', jenis: '', pkNo: lpo.no, pkTarikh: lpo.tarikh || '', doNo: '', doTarikh: '', tarikhTerima: lpo.tarikhTerima || '',
    pengangkutan: '', pembekalNama: lpo.pembekal || '', pembekalAlamat: (findPembekal(lpo.pembekal) || {}).alamat || '',
    penerima: null, teknikal: null,
    items: (lpo.items || []).map(i => {
      const inv = findInventoryItem(i);
      const harga = inv ? (parseFloat(inv.harga) || 0) : 0;
      return { sku: i.sku, nama: i.nama, unit: i.unit, dipesan: toInt(i.qty), qtyDO: '', diterima: toInt(i.qty), harga, jumlah: harga * toInt(i.qty), catatan: '' };
    })
  };

  const dash = '…………………………………';
  const cell = 'border border-slate-900 p-1.5';
  const head = 'border border-slate-900 p-1.5 bg-slate-100 font-bold text-center';
  const fmtDate = formatDate;
  const sign = (title, p, note) => `
    <div class="p-3 space-y-0.5 ${note ? '' : 'border-r border-slate-900'}">
      <div class="h-10"></div>
      <p>${dash}</p>
      <p>(${title})</p>
      <p><b>Nama:</b> ${escapeHtml((p && p.nama) || '')}</p>
      <p><b>Jawatan:</b> ${escapeHtml((p && p.jawatan) || '')}</p>
      <p><b>Jabatan:</b> ${escapeHtml((p && p.jabatan) || '')}</p>
      <p><b>Tarikh:</b> ${escapeHtml(fmtDate(p && p.tarikh))}</p>
      ${note ? '<p class="italic">* Jika Perlu.</p>' : ''}
    </div>`;

  const itemRows = (b.items || []).map(i => `
    <tr>
      <td class="${cell} text-center font-bold">${escapeHtml(i.sku)}</td>
      <td class="${cell}">${escapeHtml(i.nama)}</td>
      <td class="${cell} text-center">${escapeHtml(i.unit || '')}</td>
      <td class="${cell} text-center">${i.dipesan === '' ? '' : toInt(i.dipesan)}</td>
      <td class="${cell} text-center">${i.qtyDO === '' ? '' : toInt(i.qtyDO)}</td>
      <td class="${cell} text-center font-bold">${toInt(i.diterima)}</td>
      <td class="${cell} text-right">${formatRM(i.harga)}</td>
      <td class="${cell} text-right font-bold">${formatRM(i.jumlah)}</td>
      <td class="${cell}">${escapeHtml(i.catatan || '')}</td>
    </tr>`).join('');
  const total = (b.items || []).reduce((s, i) => s + (Number(i.jumlah) || 0), 0);

  content.innerHTML = `
    <div class="font-sans text-slate-900 text-[11px] space-y-4 max-w-[280mm] mx-auto">
      <div class="flex justify-between">
        <p>Pekeliling Perbendaharaan Malaysia</p>
        <p>AM 6.2 Lampiran A</p>
      </div>
      <p class="text-right font-black text-xs">KEW.PS-1</p>
      <p class="text-right">No. Rujukan BTB: <b>${escapeHtml(b.no || dash)}</b></p>
      <h2 class="text-center font-black text-sm">BORANG TERIMAAN BARANG-BARANG (BTB)</h2>

      <table class="w-full border-collapse">
        <tr>
          <th rowspan="2" class="${head}">Nama dan Alamat Pembekal/<br>Agen Penghantaran/ Pemberi</th>
          <th rowspan="2" class="${head}">Jenis<br>Penerimaan*</th>
          <th colspan="2" class="${head}">Pesanan Kerajaan (PK)/ Kontrak/ Surat Kelulusan</th>
          <th colspan="2" class="${head}">Nota Hantaran (DO)</th>
          <th rowspan="2" class="${head}">Maklumat Pengangkutan</th>
        </tr>
        <tr>
          <th class="${head}">Nombor/ Rujukan</th><th class="${head}">Tarikh</th>
          <th class="${head}">Nombor</th><th class="${head}">Tarikh</th>
        </tr>
        <tr>
          <td class="${cell}"><b>${escapeHtml(b.pembekalNama)}</b>${b.pembekalAlamat ? `<br>${escapeHtml(b.pembekalAlamat)}` : ''}</td>
          <td class="${cell} text-center">${escapeHtml(b.jenis || '')}</td>
          <td class="${cell} text-center">${escapeHtml(b.pkNo || '')}</td>
          <td class="${cell} text-center">${escapeHtml(fmtDate(b.pkTarikh))}</td>
          <td class="${cell} text-center">${escapeHtml(b.doNo || '')}</td>
          <td class="${cell} text-center">${escapeHtml(b.doNo ? fmtDate(b.doTarikh) : '')}</td>
          <td class="${cell}">${escapeHtml(b.pengangkutan || '')}</td>
        </tr>
      </table>

      <table class="w-full border-collapse">
        <tr>
          <th rowspan="2" class="${head}">No. Kod</th>
          <th rowspan="2" class="${head}">Perihal<br>Barang-Barang</th>
          <th rowspan="2" class="${head}">Unit<br>Pengukuran</th>
          <th colspan="3" class="${head}">Kuantiti</th>
          <th colspan="2" class="${head}">Harga (RM)</th>
          <th rowspan="2" class="${head}">Catatan</th>
        </tr>
        <tr>
          <th class="${head}">Dipesan<br>(PK)</th><th class="${head}">Nota Hantaran<br>(DO)</th><th class="${head}">Diterima</th>
          <th class="${head}">Seunit</th><th class="${head}">Jumlah</th>
        </tr>
        ${itemRows}
        <tr>
          <td colspan="7" class="${cell} text-right font-bold">JUMLAH</td>
          <td class="${cell} text-right font-black">${formatRM(total)}</td>
          <td class="${cell}"></td>
        </tr>
      </table>

      <div class="grid grid-cols-2 border border-slate-900">
        ${sign('Tandatangan Pegawai Penerima', b.penerima, false)}
        ${sign('*Tandatangan Pegawai Teknikal', b.teknikal, true)}
      </div>
      ${lpo.btb ? '' : '<p class="text-[10px] text-amber-700 no-print">Nota: LPO ini diterima sebelum KEW.PS-1 diperkenalkan. Medan yang tiada dalam rekod dibiarkan kosong untuk diisi secara manual.</p>'}
    </div>`;

  const modal = document.getElementById('kewps8-modal');
  if (modal) modal.classList.remove('hidden');
}

function renderMasterLpoTable() {
  const tbody = document.getElementById('lpo-master-body');
  if (!tbody) return;

  if (lpoList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Tiada pesanan LPO direkodkan buat masa ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = lpoList.map(l => {
    const isCompleted = l.status === 'Selesai';
    const statusBadge = isCompleted
      ? `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-circle-check mr-1"></i> Selesai</span>`
      : `<span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-clock mr-1"></i> Dalam Proses</span>`;

    const actionBtn = isCompleted
      ? `<div class="flex flex-col items-center gap-1">
           <span class="text-[10px] text-slate-500 font-bold"><i class="fa-solid fa-calendar-check mr-1 text-emerald-600"></i> Diterima (${escapeHtml(formatDate(l.tarikhTerima || l.tarikh))})</span>
           <button type="button" data-id="${escapeHtml(l.id)}" onclick="previewKewPs1(this.dataset.id)" class="bg-purple-600 hover:bg-purple-700 text-white font-bold text-[11px] px-2.5 py-1 rounded-lg shadow whitespace-nowrap"><i class="fa-solid fa-file-pdf mr-1"></i> KEW.PS-1${l.btb && l.btb.no ? ` · ${escapeHtml(l.btb.no)}` : ''}</button>
         </div>`
      : `<button type="button" data-id="${escapeHtml(l.id)}" onclick="confirmLpoReceipt(this.dataset.id)" class="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-3 py-1.5 rounded-xl transition shadow"><i class="fa-solid fa-box-open mr-1"></i> Sah Terima</button>`;

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
        <td class="p-3 font-black text-purple-900">${escapeHtml(l.no)}</td>
        <td class="p-3 font-semibold text-slate-800">${escapeHtml(l.pembekal)}</td>
        <td class="p-3 text-slate-600 font-medium">${escapeHtml(formatDate(l.tarikh))}</td>
        <td class="p-3 font-medium">${l.items.map(i => `<span class="inline-block bg-slate-100 px-2 py-0.5 rounded-md text-[11px] mr-1 mb-1 font-bold text-slate-700">${escapeHtml(i.nama)} (+${toInt(i.qty)}${escapeHtml(i.unit)})</span>`).join('')}</td>
        <td class="p-3 text-center">${statusBadge}</td>
        <td class="p-3 text-center">${actionBtn}</td>
      </tr>`;
  }).join('');
}


// ------------------------------------------
// 16. PRATINJAU KEW.PS-8 (DIBERSIHKAN DARIPADA 3 TEXT BOTTOM), LAPORAN BULANAN & CETAK
// ------------------------------------------
// KEW.PS-8 (AM 6.5 Lampiran B): tepat 3 item setiap borang; permohonan lebih 3 item dicetak sebagai beberapa borang
const KEWPS8_ROWS_PER_FORM = 3;

function previewKewPs8(reqId) {
  const req = requests.find(r => r.id === reqId);
  const content = document.getElementById('kewps8-content');
  if (!req || !content) return;

  const fmtDate = formatDate;
  const reqItems = req.items || [];
  const chunks = [];
  for (let i = 0; i < Math.max(1, reqItems.length); i += KEWPS8_ROWS_PER_FORM) {
    chunks.push(reqItems.slice(i, i + KEWPS8_ROWS_PER_FORM));
  }

  const processed = req.status !== 'Pending';
  const pemohonJawatan = [req.jawatan, req.gred].filter(Boolean).join(' ');
  // Rekod lama mungkin hanya ada e-mel pelulus: cari nama/jawatan dalam senarai pengguna
  const pelulusUser = req.pelulusEmail ? appUsers.find(u => u.id === String(req.pelulusEmail).toLowerCase()) : null;
  const pelulusIsSuper = req.pelulusEmail && String(req.pelulusEmail).toLowerCase() === SUPERADMIN_EMAIL.toLowerCase();
  const pelulusNama = processed ? (req.pelulusNama || (pelulusUser && pelulusUser.nama) || (pelulusIsSuper ? 'SuperAdmin Utama' : '')) : '';
  const pelulusJawatan = processed ? (req.pelulusJawatan || (pelulusUser && pelulusUser.jawatan) || (pelulusIsSuper ? 'Pentadbir Sistem' : '')) : '';
  const pelulusTarikh = processed ? fmtDate(req.tarikhLulus || '') : '';

  // Perakuan Penerimaan: diisi apabila penjaga stor klinik telah mengesahkan terima
  const received = req.terimaKlinik === 'Diterima';
  const terimaQty = received && Array.isArray(req.terimaKlinikQty) ? req.terimaKlinikQty : [];
  const penerimaEmail = String(req.terimaKlinikOleh || '').toLowerCase();
  const penerimaUser = penerimaEmail
    ? (appUsers.find(u => u.id === penerimaEmail) || (penerimaEmail === currentUserEmail ? currentUserProfile : null))
    : null;
  const penerimaNama = received ? (req.terimaKlinikNama || (penerimaUser && penerimaUser.nama) || req.terimaKlinikOleh || '') : '';
  const penerimaJawatan = received && penerimaUser ? [penerimaUser.jawatan, penerimaUser.gred].filter(Boolean).join(' ') : '';
  const penerimaTarikh = received && req.terimaKlinikPada ? fmtDate(todayISODateOf(req.terimaKlinikPada)) : '';

  // Gaya: garis biasa & garis tebal pemisah bahagian; fon pengisian kecil
  const b = 'border border-black';
  const thick = 'border-r-[3px] border-r-black';
  const th = `${b} bg-[#d9d9d9] font-bold text-center align-middle px-1.5 py-2 text-[10.5pt] leading-tight`;
  const td = `${b} px-1.5 py-1 text-[10pt] leading-snug align-middle`;
  const rowStyle = 'height:16mm';

  const signBlock = (title, nama, jawatan, tarikh) => `
    <p class="font-bold text-[11.5pt]">${title}</p>
    <div style="height:15mm"></div>
    <p class="text-[11pt]">……………………………………………</p>
    <p class="text-[11pt]">(Tandatangan)</p>
    <table class="mt-2 text-[11pt] w-full">
      <tr><td class="font-bold py-1 align-top" style="width:20mm">Nama</td><td class="pr-1.5 align-top">:</td><td class="text-[10pt] align-top">${escapeHtml(nama)}</td></tr>
      <tr><td class="font-bold py-1 align-top">Jawatan</td><td class="pr-1.5 align-top">:</td><td class="text-[10pt] align-top">${escapeHtml(jawatan)}</td></tr>
      <tr><td class="font-bold py-1 align-top">Tarikh</td><td class="pr-1.5 align-top">:</td><td class="text-[10pt] align-top">${escapeHtml(tarikh)}</td></tr>
    </table>`;

  const forms = chunks.map((chunk, formIdx) => {
    const rows = [];
    for (let r = 0; r < KEWPS8_ROWS_PER_FORM; r++) {
      const i = chunk[r];
      if (!i) {
        rows.push(`<tr style="${rowStyle}">${`<td class="${td}"></td>`.repeat(3)}<td class="${td} ${thick}"></td><td class="${td}"></td><td class="${td}"></td><td class="${td} ${thick}"></td><td class="${td}"></td><td class="${td}"></td></tr>`);
        continue;
      }
      const inv = items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
      // Baki sedia ada: nilai semasa kelulusan jika direkod; jika tiada, anggaran (baki semasa + kuantiti lulus)
      const baki = (i.bakiSediaAda !== undefined && i.bakiSediaAda !== null)
        ? toInt(i.bakiSediaAda)
        : (inv ? toInt(inv.baki) + (i.status === 'Lulus' ? toInt(i.qtyLulus) : 0) : '');
      const lulus = processed && i.status !== 'Dibatalkan' ? toInt(i.qtyLulus) : '';
      const catatanPelulus = !processed ? '' :
        i.status === 'Ditolak' ? 'Tidak diluluskan' :
        i.status === 'Dibatalkan' ? 'Dibatalkan' :
        toInt(i.qtyLulus) < toInt(i.qtyMohon) ? 'Lulus sebahagian' : '';
      // Kuantiti diterima ikut indeks asal item dalam permohonan
      const itemIdx = formIdx * KEWPS8_ROWS_PER_FORM + r;
      const approvedQty = i.status === 'Lulus' ? toInt(i.qtyLulus) : 0;
      const diterima = received && approvedQty > 0 ? toInt(terimaQty[itemIdx]) : '';
      const catatanTerima = diterima === '' ? '' :
        diterima === 0 ? 'Tidak diterima' :
        diterima < approvedQty ? `Kurang ${approvedQty - diterima}` : '';
      rows.push(`
        <tr style="${rowStyle}">
          <td class="${td} text-center text-[9pt] [overflow-wrap:anywhere]">${escapeHtml(i.sku)}</td>
          <td class="${td} [overflow-wrap:anywhere]">${escapeHtml(i.nama)}</td>
          <td class="${td} text-center">${toInt(i.qtyMohon)}</td>
          <td class="${td} ${thick}"></td>
          <td class="${td} text-center">${processed ? baki : ''}</td>
          <td class="${td} text-center">${lulus}</td>
          <td class="${td} ${thick}">${escapeHtml(catatanPelulus)}</td>
          <td class="${td} text-center">${diterima}</td>
          <td class="${td}">${escapeHtml(catatanTerima)}</td>
        </tr>`);
    }

    const formLabel = chunks.length > 1 ? ` <span class="text-[10pt] font-normal">(Borang ${formIdx + 1}/${chunks.length})</span>` : '';
    return `
      <div class="kewps8-form text-black font-sans" style="${formIdx < chunks.length - 1 ? 'page-break-after: always; break-after: page;' : ''}">
        <div class="flex justify-between text-[11pt]">
          <p>Pekeliling Perbendaharaan Malaysia</p>
          <p>AM 6.5 Lampiran B</p>
        </div>
        <div class="text-right mt-5">
          <p class="font-bold text-[14pt]">KEW.PS-8</p>
          <p class="text-[12pt]">No. BPSI : <span class="font-semibold">${escapeHtml(req.id)}</span>${formLabel}</p>
        </div>
        <div class="text-center font-bold text-[14pt] leading-snug mt-3 mb-4">
          <p>BORANG PERMOHONAN STOK</p>
          <p>(INDIVIDU KEPADA STOR)</p>
        </div>

        <table class="w-full border-collapse table-fixed border-2 border-black">
          <colgroup>
            <col style="width:9%"><col style="width:15%"><col style="width:7.5%"><col style="width:7.5%">
            <col style="width:9.5%"><col style="width:9.5%"><col style="width:11%">
            <col style="width:12.5%"><col style="width:18.5%">
          </colgroup>
          <tr>
            <th colspan="4" class="${th} ${thick}">Permohonan</th>
            <th colspan="3" class="${th} ${thick}">Pegawai Pelulus</th>
            <th colspan="2" class="${th}">Perakuan Penerimaan</th>
          </tr>
          <tr>
            <th class="${th}">No.<br>Kod</th>
            <th class="${th}">Perihal Stok</th>
            <th class="${th}">Kuantiti<br>Dimohon</th>
            <th class="${th} ${thick}">Catatan</th>
            <th class="${th}">Baki Sedia<br>Ada</th>
            <th class="${th}">Kuantiti<br>Diluluskan</th>
            <th class="${th} ${thick}">Catatan</th>
            <th class="${th}">Kuantiti Diterima</th>
            <th class="${th}">Catatan</th>
          </tr>
          ${rows.join('')}
          <tr class="align-top">
            <td colspan="4" class="${b} ${thick} px-3 py-2.5">${signBlock('Pemohon:', req.nama || '', pemohonJawatan, fmtDate(req.tarikh))}</td>
            <td colspan="3" class="${b} ${thick} px-3 py-2.5">${signBlock('Pegawai Pelulus:', pelulusNama, pelulusJawatan, pelulusTarikh)}</td>
            <td colspan="2" class="${b} px-3 py-2.5">${signBlock('Pemohon/ Wakil:', penerimaNama, penerimaJawatan, penerimaTarikh)}</td>
          </tr>
        </table>
        <div class="border-t border-slate-500 mt-5"></div>
      </div>`;
  });

  // Jarak antara borang hanya di skrin; semasa cetak setiap borang bermula di halaman baharu tanpa margin tambahan
  content.innerHTML = `<div class="max-w-[280mm] mx-auto space-y-10 print:space-y-0">${forms.join('')}</div>`;

  const modal = document.getElementById('kewps8-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeKewPs8Modal() {
  const modal = document.getElementById('kewps8-modal');
  if (modal) modal.classList.add('hidden');
}

function generateMonthlyReport() {
  const month = document.getElementById('monthly-report-month')?.value || '09';
  const year = document.getElementById('monthly-report-year')?.value || '2026';
  const unit = document.getElementById('monthly-report-unit')?.value || '';

  const content = document.getElementById('kewps8-content');
  if (!content) return;

  const datePrefix = `${year}-${month}`;
  let issuedRows = [];
  let totalValue = 0;

  requests.forEach(r => {
    if (r.tarikh && r.tarikh.startsWith(datePrefix)) {
      if (!unit || r.unit === unit) {
        r.items.forEach(i => {
          if (i.status === 'Lulus' && (i.qtyLulus || 0) > 0) {
            const invItem = items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
            const price = invItem ? (parseFloat(invItem.harga) || 0) : 0;
            const subtotal = price * i.qtyLulus;
            totalValue += subtotal;

            issuedRows.push(`
              <tr class="border-b border-slate-200">
                <td class="p-2">${escapeHtml(r.id)}</td>
                <td class="p-2 font-bold">${escapeHtml(i.sku)}</td>
                <td class="p-2">${escapeHtml(i.nama)}</td>
                <td class="p-2">${escapeHtml(r.unit)}</td>
                <td class="p-2 text-center font-bold">${toInt(i.qtyLulus)}</td>
                <td class="p-2 text-right">RM ${price.toFixed(2)}</td>
                <td class="p-2 text-right font-black">RM ${subtotal.toFixed(2)}</td>
              </tr>
            `);
          }
        });
      }
    }
  });

  content.innerHTML = `
    <div class="space-y-4 font-sans text-slate-900 p-2">
      <div class="text-center border-b pb-3">
        <h2 class="text-base font-black uppercase">LAPORAN RINGKASAN PENGELUARAN STOK BULANAN</h2>
        <p class="text-xs font-bold text-slate-600">Bulan: ${month}/${year} | Unit: ${escapeHtml(unit || 'Semua Unit')}</p>
      </div>

      <table class="w-full text-left text-xs border border-slate-300">
        <thead class="bg-slate-100 font-bold uppercase text-[10px]">
          <tr>
            <th class="p-2">No. BPSI</th>
            <th class="p-2">SKU</th>
            <th class="p-2">Perihal Stok</th>
            <th class="p-2">Klinik/Unit</th>
            <th class="p-2 text-center">Kuantiti</th>
            <th class="p-2 text-right">Harga Seunit</th>
            <th class="p-2 text-right">Jumlah (RM)</th>
          </tr>
        </thead>
        <tbody>
          ${issuedRows.length > 0 ? issuedRows.join('') : `<tr><td colspan="7" class="p-4 text-center text-slate-400">Tiada pengeluaran direkodkan bagi bulan ini.</td></tr>`}
        </tbody>
        <tfoot class="bg-slate-50 font-black">
          <tr>
            <td colspan="6" class="p-2 text-right">JUMLAH KESELURUHAN PENGELUARAN:</td>
            <td class="p-2 text-right text-emerald-700">RM ${totalValue.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  const modal = document.getElementById('kewps8-modal');
  if (modal) modal.classList.remove('hidden');
}

function printMonthlyReport() {
  generateMonthlyReport();
  setTimeout(() => window.print(), 300);
}


// ------------------------------------------
// 17. DASHBOARD & MONITORING STATS
// ------------------------------------------
function calculateIssuanceReport() {
  const selectedUnit = document.getElementById('report-unit-filter')?.value || '';
  const selectedYear = document.getElementById('report-year-filter')?.value || '';

  let valAlatTulis = 0, qtyAlatTulis = 0;
  let valBekalanAm = 0, qtyBekalanAm = 0;
  let valDentKontrak = 0, qtyDentKontrak = 0;
  let valDentBukanKontrak = 0, qtyDentBukanKontrak = 0;

  requests.forEach(r => {
    if (selectedUnit && r.unit !== selectedUnit) return;
    if (selectedYear && (!r.tarikh || !r.tarikh.startsWith(selectedYear))) return;

    if (r.items) {
      r.items.forEach(reqItem => {
        if (reqItem.status === 'Lulus') {
          const qty = reqItem.qtyLulus || 0;
          const invItem = items.find(i => String(i.id) === String(reqItem.itemId) || i.sku === reqItem.sku);
          const harga = invItem ? (parseFloat(invItem.harga) || 0) : 0;
          const kat = (invItem ? invItem.kategori : (reqItem.kategori || '')).toLowerCase();
          const subtotal = qty * harga;

          if (kat.includes('alat tulis')) {
            valAlatTulis += subtotal;
            qtyAlatTulis += qty;
          } else if (kat.includes('bekalan am')) {
            valBekalanAm += subtotal;
            qtyBekalanAm += qty;
          } else if (kat.includes('bukan kontrak')) {
            valDentBukanKontrak += subtotal;
            qtyDentBukanKontrak += qty;
          } else {
            valDentKontrak += subtotal;
            qtyDentKontrak += qty;
          }
        }
      });
    }
  });

  const totalVal = valAlatTulis + valBekalanAm + valDentKontrak + valDentBukanKontrak;
  const totalQty = qtyAlatTulis + qtyBekalanAm + qtyDentKontrak + qtyDentBukanKontrak;

  if (document.getElementById('report-val-alat-tulis')) document.getElementById('report-val-alat-tulis').innerText = 'RM ' + valAlatTulis.toFixed(2);
  if (document.getElementById('report-qty-alat-tulis')) document.getElementById('report-qty-alat-tulis').innerText = qtyAlatTulis + ' unit';
  if (document.getElementById('report-val-bekalan-am')) document.getElementById('report-val-bekalan-am').innerText = 'RM ' + valBekalanAm.toFixed(2);
  if (document.getElementById('report-qty-bekalan-am')) document.getElementById('report-qty-bekalan-am').innerText = qtyBekalanAm + ' unit';
  if (document.getElementById('report-val-dent-kontrak')) document.getElementById('report-val-dent-kontrak').innerText = 'RM ' + valDentKontrak.toFixed(2);
  if (document.getElementById('report-qty-dent-kontrak')) document.getElementById('report-qty-dent-kontrak').innerText = qtyDentKontrak + ' unit';
  if (document.getElementById('report-val-dent-bukan-kontrak')) document.getElementById('report-val-dent-bukan-kontrak').innerText = 'RM ' + valDentBukanKontrak.toFixed(2);
  if (document.getElementById('report-qty-dent-bukan-kontrak')) document.getElementById('report-qty-dent-bukan-kontrak').innerText = qtyDentBukanKontrak + ' unit';
  if (document.getElementById('report-val-total')) document.getElementById('report-val-total').innerText = 'RM ' + totalVal.toFixed(2);
  if (document.getElementById('report-qty-total')) document.getElementById('report-qty-total').innerText = totalQty + ' kuantiti';
}

function updateDashboardStats() {
  renderDashboardCategoryTabs();
  const catItems = items;

  if (document.getElementById('stat-total-items')) document.getElementById('stat-total-items').innerText = catItems.length;

  const lowStockCount = catItems.filter(isLowStock).length;
  if (document.getElementById('stat-low-stock')) document.getElementById('stat-low-stock').innerText = lowStockCount;

  // Permohonan bulan ini yang mengandungi sekurang-kurangnya satu item dalam kategori dipilih
  const currentMonth = todayISODate().substring(0, 7);
  const monthReqs = requests.filter(r => r.tarikh && r.tarikh.startsWith(currentMonth) && (r.items || []).length > 0);
  if (document.getElementById('stat-month-requests')) document.getElementById('stat-month-requests').innerText = monthReqs.length;

  let totalVal = 0;
  requests.forEach(r => {
    (r.items || []).forEach(i => {
      if (i.status === 'Lulus') {
        const invItem = items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
        const price = invItem ? (parseFloat(invItem.harga) || 0) : 0;
        totalVal += toInt(i.qtyLulus) * price;
      }
    });
  });
  if (document.getElementById('stat-total-value')) document.getElementById('stat-total-value').innerText = 'RM ' + totalVal.toFixed(2);
}

function updateAdminTaskBadges() {
  const pendingRequests = requests.filter(r => r.status === 'Pending').length;
  const pendingLpo = lpoList.filter(l => l.status === 'Dalam Proses').length;
  const lowStock = items.filter(i => i.baki <= i.reorder).length;

  if (document.getElementById('card-count-req')) document.getElementById('card-count-req').innerText = pendingRequests;
  if (document.getElementById('card-count-low')) document.getElementById('card-count-low').innerText = lowStock;
}

function renderPieChartAndTopTable() {
  const canvas = document.getElementById('topItemsChart');
  if (!canvas) return;

  const unitFilter = document.getElementById('top-chart-unit-filter')?.value || '';
  const itemTotals = {};

  requests.forEach(r => {
    if (unitFilter && r.unit !== unitFilter) return;
    if (r.items) {
      r.items.forEach(i => {
        if (i.status === 'Lulus') {
          itemTotals[i.nama] = (itemTotals[i.nama] || 0) + toInt(i.qtyLulus);
        }
      });
    }
  });

  const sorted = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(s => s[0]);
  const data = sorted.map(s => s[1]);

  if (topChartInstance) topChartInstance.destroy();

  const ctx = canvas.getContext('2d');
  topChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['Tiada Data'],
      datasets: [{
        label: 'Kuantiti Dikeluarkan',
        data: data.length > 0 ? data : [0],
        backgroundColor: '#9333ea',
        borderRadius: 8
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } }
    }
  });
}


// ------------------------------------------
// 17b. STOR KLINIK (PENJAGA STOR KLINIK & PEMANTAUAN STOR DAERAH)
//   kraipro_klinik/{klinikId}  : { unit, items: { [itemId]: { sku, nama, unitBungkus, kategori, baki } }, bakiAwalDikunci }
//   kraipro_klinik_log/{auto}  : pergerakan stok klinik (terima / keluar / baki_awal / pelarasan), ditapis ikut 'bulan'
// ------------------------------------------
let klinikDocs = [];             // pentadbir: semua klinik; penjaga: klinik sendiri
let klinikPendingReceipts = [];  // permohonan diluluskan yang menunggu sah terima (penjaga)
let klinikLogs = [];             // log bulan semasa / bulan dipilih
let klinikLogUnsub = null;
let klinikDraftQty = {};         // itemId -> kuantiti keluar dipilih
let klinikSetupDraft = {};       // itemId -> baki awal
let klinikSetupCat = '';         // penapis kategori ('' = semua)
let klinikStockCat = '';
let adminKlinikMonth = '';
let adminKlinikSelected = '';

const KLINIK_LOG_STYLE = {
  terima: { label: 'Terima', cls: 'bg-emerald-100 text-emerald-800', icon: 'fa-truck-ramp-box', sign: '+' },
  keluar: { label: 'Keluar', cls: 'bg-purple-100 text-purple-800', icon: 'fa-arrow-right-from-bracket', sign: '−' },
  baki_awal: { label: 'Baki Awal', cls: 'bg-amber-100 text-amber-800', icon: 'fa-clipboard-list', sign: '' },
  pelarasan: { label: 'Pelarasan', cls: 'bg-rose-100 text-rose-800', icon: 'fa-scale-balanced', sign: '−' }
};

function resetKlinikState() {
  if (klinikLogUnsub) { try { klinikLogUnsub(); } catch (e) {} }
  klinikLogUnsub = null;
  klinikDocs = [];
  klinikPendingReceipts = [];
  klinikLogs = [];
  klinikDraftQty = {};
  klinikSetupDraft = {};
  klinikSetupCat = '';
  klinikStockCat = '';
  adminKlinikMonth = '';
  adminKlinikSelected = '';
}

function klinikIdFor(unit) {
  const slug = String(unit || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return 'klinik_' + (slug || 'tiada');
}

function klinikRef(unit) {
  return db.collection('kraipro_klinik').doc(klinikIdFor(unit));
}

function isKlinikPenjaga() {
  return !!(currentUserProfile && currentUserProfile.penjagaStor && currentUserProfile.unit);
}

function myKlinikUnit() {
  return isKlinikPenjaga() ? String(currentUserProfile.unit) : '';
}

function klinikDocFor(unit) {
  return klinikDocs.find(k => k.unit === unit) || null;
}

function sanitizeKlinik(d) {
  const out = {};
  Object.entries(d.items && typeof d.items === 'object' ? d.items : {}).forEach(([id, it]) => {
    if (it && typeof it === 'object') out[id] = { ...it, baki: toInt(it.baki) };
  });
  return { ...d, unit: String(d.unit || ''), items: out };
}

function klinikItemList(doc) {
  return doc ? Object.entries(doc.items).map(([id, it]) => ({ ...it, id })) : [];
}

// Kunci item stor klinik bagi satu baris permohonan (ID item stok induk)
function klinikItemKey(reqItem) {
  if (reqItem.itemId) return String(reqItem.itemId);
  const inv = items.find(it => it.sku === reqItem.sku);
  return String(inv ? inv.id : (reqItem.sku || ''));
}

function klinikMatches(it, q) {
  return !q || String(it.nama || '').toLowerCase().includes(q) || String(it.sku || '').toLowerCase().includes(q);
}

function currentMonthKey() {
  return todayISODate().slice(0, 7);
}

function klinikLogEntry(jenis, unit, logItems, extra = {}) {
  return {
    jenis,
    unit,
    klinikId: klinikIdFor(unit),
    items: logItems,
    tarikh: todayISODate(),
    bulan: currentMonthKey(),
    createdAt: new Date().toISOString(),
    userEmail: currentUserEmail,
    userNama: (currentUserProfile && currentUserProfile.nama) || (currentUserRole === 'superadmin' ? 'SuperAdmin' : currentUserEmail),
    ...extra
  };
}

function renderKlinikAll() {
  renderKlinikView();
  renderAdminKlinik();
  renderDaftarPanels();
}

function startKlinikListeners() {
  if (isAdminLoggedIn) {
    firestoreUnsubscribers.push(db.collection('kraipro_klinik').onSnapshot((qs) => {
      klinikDocs = qs.docs.map(d => sanitizeKlinik({ ...d.data(), id: d.id }));
      renderKlinikAll();
    }, onFirestoreError('stor klinik')));
  } else if (isKlinikPenjaga()) {
    firestoreUnsubscribers.push(klinikRef(myKlinikUnit()).onSnapshot((snap) => {
      klinikDocs = snap.exists ? [sanitizeKlinik({ ...snap.data(), id: snap.id })] : [];
      renderKlinikAll();
    }, onFirestoreError('stor klinik')));
  }

  if (isKlinikPenjaga()) {
    firestoreUnsubscribers.push(db.collection('kraipro_requests')
      .where('unit', '==', myKlinikUnit())
      .where('terimaKlinik', '==', 'Menunggu')
      .onSnapshot((qs) => {
        klinikPendingReceipts = qs.docs.map(d => sanitizeRequest(d.data())).filter(Boolean)
          .sort((a, b) => String(a.tarikhLulus || '').localeCompare(String(b.tarikhLulus || '')) || String(a.id).localeCompare(String(b.id)));
        renderKlinikAll();
      }, onFirestoreError('penerimaan klinik')));
  }

  subscribeKlinikLogs();
}

// Log satu bulan sahaja (jimat bacaan): pentadbir = semua klinik bagi bulan dipilih; penjaga = klinik sendiri bulan ini
function subscribeKlinikLogs() {
  if (klinikLogUnsub) { try { klinikLogUnsub(); } catch (e) {} }
  klinikLogUnsub = null;
  klinikLogs = [];
  if (!db || (!isAdminLoggedIn && !isKlinikPenjaga())) return;

  let q = db.collection('kraipro_klinik_log').where('bulan', '==', isAdminLoggedIn ? (adminKlinikMonth || currentMonthKey()) : currentMonthKey());
  if (!isAdminLoggedIn) q = q.where('unit', '==', myKlinikUnit());
  klinikLogUnsub = q.onSnapshot((qs) => {
    klinikLogs = qs.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    renderKlinikAll();
  }, onFirestoreError('log klinik'));
}

// ---- Paparan penjaga stor klinik (telefon) ----
function renderKlinikView() {
  if (!isKlinikPenjaga() || !document.getElementById('content-klinik')) return;
  const unit = myKlinikUnit();
  const doc = klinikDocFor(unit);
  const locked = !!(doc && doc.bakiAwalDikunci);
  const list = klinikItemList(doc);
  const month = currentMonthKey();
  const keluarTotal = klinikLogs
    .filter(l => l.unit === unit && l.bulan === month && l.jenis === 'keluar')
    .reduce((s, l) => s + (l.items || []).reduce((t, i) => t + toInt(i.qty), 0), 0);

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('klinik-title', unit);
  setText('klinik-stat-items', list.filter(i => i.baki > 0).length);
  setText('klinik-stat-keluar', keluarTotal);
  setText('klinik-stat-habis', list.filter(i => i.baki <= 0).length);

  const badge = document.getElementById('main-tab-klinik-badge');
  if (badge) {
    badge.textContent = klinikPendingReceipts.length;
    badge.classList.toggle('hidden', klinikPendingReceipts.length === 0);
  }

  document.getElementById('klinik-setup-card')?.classList.toggle('hidden', locked);
  document.getElementById('klinik-stock-card')?.classList.toggle('hidden', !locked);
  if (!locked) renderKlinikSetupList();
  renderKlinikReceipts();
  renderKlinikStockList();
  renderKlinikHistory();
}

function renderKlinikSetupList() {
  const box = document.getElementById('klinik-setup-list');
  if (!box) return;
  updateKlinikSetupCount();
  // Jangan bina semula senarai semasa pengguna sedang menaip kuantiti
  if (box.contains(document.activeElement)) return;

  // Baki awal dibuka semula oleh SuperAdmin: mulakan dengan baki sedia ada
  const doc = klinikDocFor(myKlinikUnit());
  if (doc && Object.keys(klinikSetupDraft).length === 0) {
    Object.entries(doc.items).forEach(([id, it]) => { if (it.baki > 0) klinikSetupDraft[id] = it.baki; });
    updateKlinikSetupCount();
  }

  if (klinikSetupCat && !items.some(i => itemCategoryName(i) === klinikSetupCat)) klinikSetupCat = '';
  const tabs = document.getElementById('klinik-setup-cat-tabs');
  if (tabs) tabs.innerHTML = buildCategoryTabsHtml(items, klinikSetupCat, 'setKlinikSetupCat', false);

  const q = (document.getElementById('klinik-setup-search')?.value || '').trim().toLowerCase();
  const list = items.filter(i => klinikMatches(i, q) && (!klinikSetupCat || itemCategoryName(i) === klinikSetupCat));
  if (list.length === 0) {
    box.innerHTML = '<p class="text-center text-sm text-slate-400 py-6">Tiada item dijumpai.</p>';
    return;
  }
  box.innerHTML = sortedCategoryNames(list).map(cat => {
    const rows = list.filter(i => itemCategoryName(i) === cat)
      .sort((a, b) => String(a.nama).localeCompare(String(b.nama)))
      .map(i => {
        const v = klinikSetupDraft[String(i.id)];
        return `
        <div class="flex items-center gap-3 rounded-xl px-3 py-2 ${v ? 'bg-purple-50 border border-purple-200' : 'bg-slate-50 border border-transparent'}">
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-bold text-slate-800 leading-snug">${escapeHtml(i.nama)}</p>
            <p class="text-[11px] text-slate-500">${escapeHtml(i.sku)} · ${escapeHtml(i.unit || '')}</p>
          </div>
          <input type="number" min="0" inputmode="numeric" placeholder="0" data-id="${escapeHtml(i.id)}" value="${v ? v : ''}"
            oninput="setKlinikSetupQty(this.dataset.id, this.value)" aria-label="Baki awal ${escapeHtml(i.nama)}"
            class="w-20 shrink-0 bg-white border border-slate-300 rounded-xl px-2 py-2.5 text-center text-sm font-extrabold focus:ring-2 focus:ring-purple-500">
        </div>`;
      }).join('');
    return `<p class="text-[11px] font-extrabold uppercase tracking-wider text-purple-700 pt-2">${escapeHtml(cat)}</p>${rows}`;
  }).join('');
}

function setKlinikSetupCat(cat) {
  klinikSetupCat = cat;
  renderKlinikSetupList();
}

function setKlinikStockCat(cat) {
  klinikStockCat = cat;
  renderKlinikStockList();
}

function setKlinikSetupQty(id, value) {
  const n = toInt(value);
  if (n > 0) klinikSetupDraft[id] = n;
  else delete klinikSetupDraft[id];
  updateKlinikSetupCount();
}

function updateKlinikSetupCount() {
  const el = document.getElementById('klinik-setup-count');
  if (el) el.textContent = `${Object.keys(klinikSetupDraft).length} item diisi`;
}

function saveKlinikBakiAwal() {
  const unit = myKlinikUnit();
  if (!unit) return;
  const entries = Object.entries(klinikSetupDraft)
    .map(([id, qty]) => ({ inv: items.find(i => String(i.id) === String(id)), qty: toInt(qty) }))
    .filter(e => e.inv && e.qty > 0);
  const msg = entries.length
    ? `Simpan baki awal ${entries.length} item untuk ${unit}? Selepas disimpan, baki awal akan dikunci.`
    : `Tiada item diisi. Simpan stor ${unit} sebagai kosong dan kunci baki awal?`;

  showConfirmModal('Simpan Baki Awal', msg, async () => {
    const token = showLoadingOverlay('Menyimpan baki awal stor klinik...');
    try {
      const itemsMap = {};
      const logItems = [];
      entries.forEach(({ inv, qty }) => {
        const id = String(inv.id);
        itemsMap[id] = { sku: inv.sku || '', nama: inv.nama || '', unitBungkus: inv.unit || '', kategori: inv.kategori || '', baki: qty };
        logItems.push({ itemId: id, sku: inv.sku || '', nama: inv.nama || '', unit: inv.unit || '', qty, bakiSelepas: qty });
      });
      const now = new Date().toISOString();
      await db.runTransaction(async (tx) => {
        const ref = klinikRef(unit);
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().bakiAwalDikunci) throw new Error('Baki awal telah dikunci. Hubungi SuperAdmin untuk membukanya semula.');
        tx.set(ref, { unit, items: itemsMap, bakiAwalDikunci: true, bakiAwalPada: now, bakiAwalOleh: currentUserEmail, dikemaskiniPada: now });
        tx.set(db.collection('kraipro_klinik_log').doc(), klinikLogEntry('baki_awal', unit, logItems));
      });
      klinikSetupDraft = {};
      addAuditLog('Baki Awal Stor Klinik', `${unit}: baki awal ${logItems.length} item disimpan & dikunci.`);
      showToast('Baki awal stor klinik disimpan & dikunci.', 'success');
    } catch (err) {
      showToast('Gagal menyimpan baki awal: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay(token);
    }
  });
}

function renderKlinikReceipts() {
  const card = document.getElementById('klinik-receipts-card');
  const box = document.getElementById('klinik-receipts-list');
  if (!card || !box) return;
  card.classList.toggle('hidden', klinikPendingReceipts.length === 0);
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;

  const doc = klinikDocFor(myKlinikUnit());
  const locked = !!(doc && doc.bakiAwalDikunci);
  box.innerHTML = klinikPendingReceipts.map(r => {
    const lines = (r.items || []).map((i, idx) => ({ i, idx })).filter(x => x.i.status === 'Lulus' && toInt(x.i.qtyLulus) > 0);
    return `
      <div class="border border-slate-200 rounded-2xl p-3 space-y-2">
        <div>
          <p class="text-sm font-extrabold text-slate-900">${escapeHtml(r.id)}</p>
          <p class="text-[11px] text-slate-500">Diluluskan ${escapeHtml(formatDate(r.tarikhLulus))} · Pemohon: ${escapeHtml(r.nama)}</p>
        </div>
        ${lines.map(({ i, idx }) => {
          const inv = items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
          return `
          <div class="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-bold text-slate-800 leading-snug">${escapeHtml(i.nama)}</p>
              <p class="text-[11px] text-slate-500">Diluluskan: <b>${toInt(i.qtyLulus)}</b> ${escapeHtml((inv && inv.unit) || '')}</p>
            </div>
            <label class="text-[10px] font-bold text-slate-500 text-center shrink-0">Diterima
              <input type="number" min="0" max="${toInt(i.qtyLulus)}" inputmode="numeric" id="klinik-terima-${escapeHtml(r.id)}-${idx}" value="${toInt(i.qtyLulus)}"
                class="block w-20 mt-0.5 bg-white border border-slate-300 rounded-xl px-2 py-2 text-center text-sm font-extrabold text-slate-900 focus:ring-2 focus:ring-emerald-500">
            </label>
          </div>`;
        }).join('')}
        <button type="button" data-id="${escapeHtml(r.id)}" onclick="confirmKlinikReceipt(this.dataset.id)" ${locked ? '' : 'disabled'}
          class="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-extrabold text-sm py-3 rounded-2xl shadow">
          <i class="fa-solid fa-check-double mr-1"></i> Sahkan Terima
        </button>
        ${locked ? '' : '<p class="text-[11px] font-bold text-amber-700 text-center">Isi baki awal stor klinik dahulu sebelum mengesahkan penerimaan.</p>'}
      </div>`;
  }).join('');
}

function confirmKlinikReceipt(reqId) {
  const req = klinikPendingReceipts.find(r => r.id === reqId);
  const unit = myKlinikUnit();
  if (!req || !unit) return;

  const qtyByIdx = {};
  let lines = 0, shortLines = 0;
  (req.items || []).forEach((i, idx) => {
    const lulus = toInt(i.qtyLulus);
    if (i.status !== 'Lulus' || lulus <= 0) return;
    const el = document.getElementById(`klinik-terima-${req.id}-${idx}`);
    const qty = Math.min(lulus, Math.max(0, el ? toInt(el.value) : lulus));
    qtyByIdx[idx] = qty;
    lines++;
    if (qty < lulus) shortLines++;
  });

  const msg = `Sahkan penerimaan ${req.id} (${lines} item) ke stor ${unit}?` +
    (shortLines ? ` ${shortLines} item diterima KURANG daripada kuantiti diluluskan.` : '');
  showConfirmModal('Sahkan Terima Stok', msg, async () => {
    const token = showLoadingOverlay(`Merekod penerimaan ${req.id}...`);
    try {
      await db.runTransaction(async (tx) => {
        const rRef = requestRef(req.id);
        const kRef = klinikRef(unit);
        const rSnap = await tx.get(rRef);
        const kSnap = await tx.get(kRef);
        if (!rSnap.exists) throw new Error('Permohonan tidak dijumpai.');
        const r = rSnap.data();
        if (r.status !== 'Selesai' || r.terimaKlinik !== 'Menunggu') throw new Error('Penerimaan ini telah direkodkan atau dibatalkan.');
        if (!kSnap.exists || !kSnap.data().bakiAwalDikunci) throw new Error('Sila isi baki awal stor klinik dahulu.');

        const kItems = sanitizeKlinik(kSnap.data()).items;
        const changes = {};
        const logItems = [];
        const terimaQty = (r.items || []).map((i, idx) => {
          const qty = toInt(qtyByIdx[idx]);
          if (qty <= 0) return 0;
          const inv = items.find(it => String(it.id) === String(i.itemId) || it.sku === i.sku);
          const id = klinikItemKey(i);
          const cur = changes[id] || kItems[id] || {
            sku: i.sku || '', nama: i.nama || (inv && inv.nama) || '', unitBungkus: (inv && inv.unit) || '', kategori: i.kategori || (inv && inv.kategori) || '', baki: 0
          };
          changes[id] = { ...cur, baki: toInt(cur.baki) + qty };
          logItems.push({ itemId: id, sku: i.sku || '', nama: i.nama || cur.nama || '', unit: cur.unitBungkus || '', qty, bakiSelepas: changes[id].baki });
          return qty;
        });

        const now = new Date().toISOString();
        tx.set(kRef, { items: changes, dikemaskiniPada: now }, { merge: true });
        tx.update(rRef, {
          terimaKlinik: 'Diterima',
          terimaKlinikPada: now,
          terimaKlinikOleh: currentUserEmail,
          terimaKlinikNama: (currentUserProfile && currentUserProfile.nama) || currentUserEmail,
          terimaKlinikQty: terimaQty
        });
        tx.set(db.collection('kraipro_klinik_log').doc(), klinikLogEntry('terima', unit, logItems, { ref: req.id }));
      });
      addAuditLog('Sah Terima Stor Klinik', `${unit}: penerimaan ${req.id} disahkan${shortLines ? ` (${shortLines} item kurang diterima)` : ''}.`);
      showToast(`Penerimaan ${req.id} disahkan. Stok klinik dikemaskini.`, 'success');
    } catch (err) {
      showToast('Gagal mengesahkan penerimaan: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay(token);
    }
  });
}

// Pembatalan permohonan oleh SuperAdmin selepas klinik sahkan terima: tolak semula dari stor klinik
// (dipanggil dalam transaksi; klinikSnap mesti dibaca sebelum sebarang penulisan)
function applyKlinikReversal(tx, klinikSnap, r) {
  const kItems = sanitizeKlinik(klinikSnap.data()).items;
  const qtys = Array.isArray(r.terimaKlinikQty) ? r.terimaKlinikQty : [];
  const changes = {};
  const logItems = [];
  (r.items || []).forEach((i, idx) => {
    const qty = toInt(qtys[idx]);
    if (qty <= 0) return;
    const id = klinikItemKey(i);
    const cur = changes[id] || kItems[id];
    if (!cur) return;
    const baki = Math.max(0, toInt(cur.baki) - qty);
    changes[id] = { ...cur, baki };
    logItems.push({ itemId: id, sku: i.sku || '', nama: i.nama || cur.nama || '', unit: cur.unitBungkus || '', qty, bakiSelepas: baki });
  });
  if (logItems.length === 0) return;
  tx.set(klinikSnap.ref, { items: changes, dikemaskiniPada: new Date().toISOString() }, { merge: true });
  tx.set(db.collection('kraipro_klinik_log').doc(), klinikLogEntry('pelarasan', r.unit, logItems, { ref: r.id, catatan: 'Permohonan dibatalkan oleh SuperAdmin' }));
}

function renderKlinikStockList() {
  const box = document.getElementById('klinik-stock-list');
  if (!box) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;

  const doc = klinikDocFor(myKlinikUnit());
  const tabs = document.getElementById('klinik-stock-cat-tabs');
  if (!doc || !doc.bakiAwalDikunci) {
    box.innerHTML = '';
    if (tabs) tabs.innerHTML = '';
    return;
  }
  const q = (document.getElementById('klinik-search')?.value || '').trim().toLowerCase();
  const all = klinikItemList(doc);
  if (klinikStockCat && !all.some(i => itemCategoryName(i) === klinikStockCat)) klinikStockCat = '';
  if (tabs) tabs.innerHTML = all.length ? buildCategoryTabsHtml(all, klinikStockCat, 'setKlinikStockCat', false) : '';
  const list = all.filter(it => klinikMatches(it, q) && (!klinikStockCat || itemCategoryName(it) === klinikStockCat))
    .sort((a, b) => (b.baki > 0) - (a.baki > 0) || String(a.nama).localeCompare(String(b.nama)));

  if (list.length === 0) {
    box.innerHTML = `<p class="text-center text-sm text-slate-400 py-6">${all.length ? 'Tiada item dijumpai.' : 'Tiada stok di klinik lagi. Stok akan bertambah apabila anda sahkan terima stok daripada stor daerah.'}</p>`;
    return;
  }

  box.innerHTML = list.map(it => {
    const id = escapeHtml(it.id);
    const habis = it.baki <= 0;
    const qty = Math.min(Math.max(1, toInt(klinikDraftQty[it.id]) || 1), Math.max(1, it.baki));
    return `
      <div class="flex items-center gap-3 border border-slate-200 rounded-2xl p-3 ${habis ? 'bg-slate-50' : 'bg-white'}">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-extrabold ${habis ? 'text-slate-400' : 'text-slate-900'} leading-snug">${escapeHtml(it.nama)}</p>
          <p class="text-[11px] text-slate-400">${escapeHtml(it.sku)}</p>
          <p class="text-xs font-extrabold mt-1 ${habis ? 'text-rose-600' : 'text-emerald-700'}">Baki: ${it.baki} ${escapeHtml(it.unitBungkus || '')}</p>
        </div>
        ${habis ? '<span class="shrink-0 text-xs font-black text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">Habis</span>' : `
        <div class="shrink-0 flex flex-col items-stretch gap-2 w-[8.5rem]">
          <div class="flex items-center justify-between bg-slate-100 rounded-xl">
            <button type="button" data-id="${id}" onclick="stepKlinikQty(this.dataset.id, -1)" aria-label="Kurangkan" class="w-10 h-10 text-xl font-black text-slate-600 rounded-xl active:bg-slate-200">−</button>
            <input type="number" min="1" max="${it.baki}" inputmode="numeric" data-id="${id}" value="${qty}" onchange="setKlinikQty(this.dataset.id, this.value)" aria-label="Kuantiti keluar"
              class="w-12 h-10 bg-transparent text-center text-base font-extrabold text-slate-900 focus:outline-none">
            <button type="button" data-id="${id}" onclick="stepKlinikQty(this.dataset.id, 1)" aria-label="Tambah" class="w-10 h-10 text-xl font-black text-slate-600 rounded-xl active:bg-slate-200">+</button>
          </div>
          <button type="button" data-id="${id}" onclick="recordKlinikUsage(this.dataset.id)" class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-extrabold text-sm py-2.5 rounded-xl shadow shadow-purple-600/25">
            <i class="fa-solid fa-arrow-right-from-bracket mr-1"></i> Keluar
          </button>
        </div>`}
      </div>`;
  }).join('');
}

function klinikItemBaki(itemId) {
  const doc = klinikDocFor(myKlinikUnit());
  const it = doc && doc.items[itemId];
  return it ? it.baki : 0;
}

function setKlinikQty(itemId, value) {
  klinikDraftQty[itemId] = Math.min(Math.max(1, toInt(value)), Math.max(1, klinikItemBaki(itemId)));
}

function stepKlinikQty(itemId, delta) {
  const cur = toInt(klinikDraftQty[itemId]) || 1;
  klinikDraftQty[itemId] = Math.min(Math.max(1, cur + delta), Math.max(1, klinikItemBaki(itemId)));
  renderKlinikStockList();
}

async function recordKlinikUsage(itemId) {
  const unit = myKlinikUnit();
  const doc = klinikDocFor(unit);
  const it = doc && doc.items[itemId];
  if (!it) return;
  // Ambil nilai terkini dari kotak kuantiti (jika pengguna menaip tanpa keluar dari kotak)
  const input = [...document.querySelectorAll('#klinik-stock-list input[data-id]')].find(el => el.dataset.id === itemId);
  if (input) setKlinikQty(itemId, input.value);
  const qty = Math.max(1, toInt(klinikDraftQty[itemId]) || 1);
  if (qty > it.baki) {
    showToast(`Baki ${it.nama} tidak mencukupi (baki ${it.baki}).`, 'error');
    return;
  }

  const token = showLoadingOverlay(`Merekod ${qty} ${it.unitBungkus || ''} ${it.nama} keluar...`);
  try {
    let bakiBaru = 0;
    await db.runTransaction(async (tx) => {
      const ref = klinikRef(unit);
      const snap = await tx.get(ref);
      const cur = snap.exists ? sanitizeKlinik(snap.data()).items[itemId] : null;
      if (!cur) throw new Error('Item tidak dijumpai dalam stor klinik.');
      if (qty > cur.baki) throw new Error(`Baki tidak mencukupi (baki ${cur.baki}).`);
      bakiBaru = cur.baki - qty;
      tx.set(ref, { items: { [itemId]: { ...cur, baki: bakiBaru } }, dikemaskiniPada: new Date().toISOString() }, { merge: true });
      tx.set(db.collection('kraipro_klinik_log').doc(), klinikLogEntry('keluar', unit, [
        { itemId, sku: cur.sku || '', nama: cur.nama || '', unit: cur.unitBungkus || '', qty, bakiSelepas: bakiBaru }
      ]));
    });
    delete klinikDraftQty[itemId];
    showToast(`${qty} ${it.unitBungkus || ''} ${it.nama} direkod keluar. Baki: ${bakiBaru}.`, 'success');
  } catch (err) {
    showToast('Gagal merekod stok keluar: ' + authErrorMessage(err), 'error');
  } finally {
    hideLoadingOverlay(token);
  }
}

function klinikLogRowHtml(l) {
  const st = KLINIK_LOG_STYLE[l.jenis] || { label: l.jenis, cls: 'bg-slate-100 text-slate-700', icon: 'fa-circle', sign: '' };
  const itemsText = (l.items || []).slice(0, 6)
    .map(i => `${escapeHtml(i.nama)} <b>${st.sign}${toInt(i.qty)}</b>`).join(', ') +
    ((l.items || []).length > 6 ? ` <span class="text-slate-400">+${l.items.length - 6} lagi</span>` : '');
  return `
    <div class="flex items-start gap-3 border-b border-slate-100 pb-2 last:border-0">
      <span class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${st.cls}"><i class="fa-solid ${st.icon} text-sm"></i></span>
      <div class="min-w-0 flex-1">
        <p class="text-xs"><span class="font-extrabold">${escapeHtml(st.label)}</span>${l.ref ? ` · ${escapeHtml(l.ref)}` : ''}
          <span class="text-slate-400">· ${escapeHtml(formatDateTime(l.createdAt))}</span></p>
        <p class="text-[13px] text-slate-700 leading-snug">${itemsText || '<span class="text-slate-400">Tiada item</span>'}</p>
        <p class="text-[11px] text-slate-400">${escapeHtml(l.userNama || l.userEmail || '')}${l.catatan ? ` · ${escapeHtml(l.catatan)}` : ''}</p>
      </div>
    </div>`;
}

function renderKlinikHistory() {
  const box = document.getElementById('klinik-history-list');
  if (!box) return;
  const unit = myKlinikUnit();
  const month = currentMonthKey();
  const logs = klinikLogs.filter(l => l.unit === unit && l.bulan === month).slice(0, 50);
  box.innerHTML = logs.length
    ? logs.map(klinikLogRowHtml).join('')
    : '<p class="text-center text-sm text-slate-400 py-4">Tiada rekod bulan ini.</p>';
}

// ---- Pemantauan stor klinik (Pentadbir) ----
function setAdminKlinikMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return;
  adminKlinikMonth = value;
  subscribeKlinikLogs();
  renderAdminKlinik();
}

function selectAdminKlinik(unit) {
  adminKlinikSelected = adminKlinikSelected === unit ? '' : unit;
  renderAdminKlinik();
  if (adminKlinikSelected) document.getElementById('admin-klinik-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function adminKlinikUnits() {
  const units = new Set(klinikDocs.map(k => k.unit));
  appUsers.forEach(u => { if (u.penjagaStor && u.unit) units.add(u.unit); });
  return [...units].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// Jumlah mengikut item bagi satu klinik & bulan: diluluskan (permohonan), diterima & keluar (log klinik)
function klinikMonthStats(unit, month) {
  const sumLogs = (jenis) => {
    const m = {};
    klinikLogs.filter(l => l.unit === unit && l.bulan === month && l.jenis === jenis)
      .forEach(l => (l.items || []).forEach(i => {
        const k = String(i.itemId || i.sku || '');
        m[k] = (m[k] || 0) + toInt(i.qty);
      }));
    return m;
  };
  const lulus = {};
  requests.filter(r => r.unit === unit && r.status === 'Selesai' && String(r.tarikhLulus || '').slice(0, 7) === month)
    .forEach(r => (r.items || []).forEach(i => {
      if (i.status === 'Lulus' && toInt(i.qtyLulus) > 0) {
        const k = klinikItemKey(i);
        lulus[k] = (lulus[k] || 0) + toInt(i.qtyLulus);
      }
    }));
  return {
    lulus,
    terima: sumLogs('terima'),
    keluar: sumLogs('keluar'),
    menunggu: requests.filter(r => r.unit === unit && r.terimaKlinik === 'Menunggu').length
  };
}

function sumValues(obj) {
  return Object.values(obj).reduce((s, v) => s + v, 0);
}

// Status item klinik: habis, hampir habis (baki < penggunaan bulan dipilih) atau mencukupi
function klinikItemStatus(baki, keluar) {
  if (baki <= 0) return 'habis';
  if (keluar > 0 && baki < keluar) return 'hampir';
  return 'ok';
}

function renderAdminKlinik() {
  const body = document.getElementById('admin-klinik-summary-body');
  if (!body || !isAdminLoggedIn) return;
  const month = adminKlinikMonth || currentMonthKey();
  const monthInput = document.getElementById('admin-klinik-month');
  if (monthInput && monthInput.value !== month) monthInput.value = month;

  const units = adminKlinikUnits();
  if (units.length === 0) {
    body.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400">Tiada stor klinik lagi. Tandakan pengguna sebagai <b>Penjaga Stor Klinik</b> di Pengurusan Pengguna.</td></tr>';
    renderAdminKlinikDetail(month);
    return;
  }

  body.innerHTML = units.map(unit => {
    const doc = klinikDocFor(unit);
    const s = klinikMonthStats(unit, month);
    const list = klinikItemList(doc);
    const habis = list.filter(i => klinikItemStatus(i.baki, s.keluar[i.id] || 0) === 'habis').length;
    const hampir = list.filter(i => klinikItemStatus(i.baki, s.keluar[i.id] || 0) === 'hampir').length;
    const penjaga = appUsers.filter(u => u.penjagaStor && u.unit === unit).map(u => escapeHtml(u.nama || u.email)).join(', ');
    const bakiAwal = !doc ? '<span class="text-rose-600 font-bold">Belum diisi</span>'
      : doc.bakiAwalDikunci ? '<span class="text-emerald-700 font-bold"><i class="fa-solid fa-lock mr-0.5"></i>Dikunci</span>'
      : '<span class="text-amber-700 font-bold"><i class="fa-solid fa-lock-open mr-0.5"></i>Dibuka</span>';
    const active = adminKlinikSelected === unit;
    return `
      <tr data-unit="${escapeHtml(unit)}" onclick="selectAdminKlinik(this.dataset.unit)" class="cursor-pointer transition ${active ? 'bg-purple-50' : 'hover:bg-slate-50'}">
        <td class="p-3 font-extrabold text-purple-800"><i class="fa-solid fa-chevron-${active ? 'down' : 'right'} text-[10px] mr-1"></i>${escapeHtml(unit)}</td>
        <td class="p-3">${penjaga || '<span class="text-rose-600 font-bold">Tiada</span>'}</td>
        <td class="p-3 text-center">${bakiAwal}</td>
        <td class="p-3 text-center font-bold">${list.filter(i => i.baki > 0).length}</td>
        <td class="p-3 text-center">${sumValues(s.lulus)}</td>
        <td class="p-3 text-center text-emerald-700 font-bold">${sumValues(s.terima)}</td>
        <td class="p-3 text-center text-purple-700 font-bold">${sumValues(s.keluar)}</td>
        <td class="p-3 text-center">${s.menunggu ? `<span class="bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded-full">${s.menunggu}</span>` : '0'}</td>
        <td class="p-3 text-center">${habis ? `<span class="bg-rose-100 text-rose-700 font-black px-2 py-0.5 rounded-full mr-1">${habis} habis</span>` : ''}${hampir ? `<span class="bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded-full">${hampir} hampir</span>` : ''}${!habis && !hampir ? '<span class="text-slate-400">-</span>' : ''}</td>
      </tr>`;
  }).join('');

  renderAdminKlinikDetail(month);
}

function renderAdminKlinikDetail(month) {
  const box = document.getElementById('admin-klinik-detail');
  if (!box) return;
  const unit = adminKlinikSelected;
  if (!unit || !adminKlinikUnits().includes(unit)) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const doc = klinikDocFor(unit);
  const s = klinikMonthStats(unit, month);
  const keys = new Set([...Object.keys(doc ? doc.items : {}), ...Object.keys(s.lulus), ...Object.keys(s.terima), ...Object.keys(s.keluar)]);
  const statusOrder = { habis: 0, hampir: 1, ok: 2 };
  const rows = [...keys].map(k => {
    const it = (doc && doc.items[k]) || null;
    const inv = items.find(i => String(i.id) === k || i.sku === k);
    const baki = it ? it.baki : 0;
    const keluar = s.keluar[k] || 0;
    return {
      sku: (it && it.sku) || (inv && inv.sku) || k,
      nama: (it && it.nama) || (inv && inv.nama) || k,
      unitBungkus: (it && it.unitBungkus) || (inv && inv.unit) || '',
      baki, lulus: s.lulus[k] || 0, terima: s.terima[k] || 0, keluar,
      status: klinikItemStatus(baki, keluar)
    };
  }).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.nama.localeCompare(b.nama));

  const statusHtml = {
    habis: '<span class="bg-rose-100 text-rose-700 font-black px-2 py-0.5 rounded-full text-[10px]">Habis</span>',
    hampir: '<span class="bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded-full text-[10px]">Hampir habis</span>',
    ok: '<span class="bg-emerald-100 text-emerald-700 font-black px-2 py-0.5 rounded-full text-[10px]">Mencukupi</span>'
  };
  const logs = klinikLogs.filter(l => l.unit === unit && l.bulan === month);
  const canUnlock = currentUserRole === 'superadmin' && doc && doc.bakiAwalDikunci;

  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
      <div>
        <h3 class="text-lg font-extrabold text-slate-800">${escapeHtml(unit)}</h3>
        <p class="text-xs text-slate-500">Butiran item bagi bulan ${escapeHtml(formatDate(month + '-01').slice(3))}${doc && doc.bakiAwalPada ? ` · Baki awal diisi ${escapeHtml(formatDateTime(doc.bakiAwalPada))}` : ''}</p>
      </div>
      <div class="flex gap-2">
        ${canUnlock ? `<button type="button" data-unit="${escapeHtml(unit)}" onclick="unlockKlinikBakiAwal(this.dataset.unit)" class="bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold text-xs px-3 py-2 rounded-xl"><i class="fa-solid fa-lock-open mr-1"></i>Buka Kunci Baki Awal</button>` : ''}
        <button type="button" onclick="selectAdminKlinik('')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-2 rounded-xl">Tutup</button>
      </div>
    </div>
    <div class="overflow-x-auto border border-slate-200 rounded-xl">
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="bg-slate-100 text-slate-700 font-bold uppercase">
            <th class="p-2.5">Kod</th>
            <th class="p-2.5">Nama Item</th>
            <th class="p-2.5 text-center">Baki Klinik</th>
            <th class="p-2.5 text-center">Diluluskan</th>
            <th class="p-2.5 text-center">Diterima</th>
            <th class="p-2.5 text-center">Keluar</th>
            <th class="p-2.5 text-center">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${rows.length ? rows.map(r => `
            <tr>
              <td class="p-2.5 font-semibold text-slate-500 whitespace-nowrap">${escapeHtml(r.sku)}</td>
              <td class="p-2.5 font-bold text-slate-800">${escapeHtml(r.nama)}</td>
              <td class="p-2.5 text-center font-extrabold">${r.baki} <span class="font-medium text-slate-400">${escapeHtml(r.unitBungkus)}</span></td>
              <td class="p-2.5 text-center">${r.lulus || '-'}</td>
              <td class="p-2.5 text-center text-emerald-700 font-bold">${r.terima || '-'}</td>
              <td class="p-2.5 text-center text-purple-700 font-bold">${r.keluar || '-'}</td>
              <td class="p-2.5 text-center">${statusHtml[r.status]}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Tiada item dalam stor klinik ini.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div id="ds-admin-panel" class="border-t border-slate-100 pt-4"></div>
    <div>
      <h4 class="text-sm font-extrabold text-slate-800 mb-2">Rekod Pergerakan (${logs.length})</h4>
      <div class="space-y-2 max-h-96 overflow-y-auto pr-1">
        ${logs.length ? logs.map(klinikLogRowHtml).join('') : '<p class="text-xs text-slate-400">Tiada rekod bagi bulan ini.</p>'}
      </div>
    </div>`;
  renderDaftarPanel('ds-admin');
}

function unlockKlinikBakiAwal(unit) {
  if (currentUserRole !== 'superadmin') return;
  showConfirmModal('Buka Kunci Baki Awal', `Buka semula baki awal ${unit}? Penjaga stor klinik boleh membetulkan baki semua item, kemudian menguncinya semula.`, async () => {
    const token = showLoadingOverlay('Membuka kunci baki awal...');
    try {
      await klinikRef(unit).update({ bakiAwalDikunci: false, bakiAwalDibukaPada: new Date().toISOString(), bakiAwalDibukaOleh: currentUserEmail });
      addAuditLog('Buka Kunci Baki Awal Klinik', `Baki awal stor ${unit} dibuka semula untuk pembetulan.`);
      showToast(`Baki awal ${unit} dibuka. Penjaga stor boleh membetulkannya.`, 'success');
    } catch (err) {
      showToast('Gagal membuka kunci: ' + authErrorMessage(err), 'error');
    } finally {
      hideLoadingOverlay(token);
    }
  });
}


// ------------------------------------------
// 17c. DAFTAR STOK (KEW.PS-3) & SENARAI DAFTAR STOK (KEW.PS-4)
//   Panel: 'ds-daerah' (stor daerah, Laporan), 'ds-klinik' (penjaga, klinik sendiri), 'ds-admin' (pentadbir, klinik dipilih)
//   Stor daerah: pergerakan = LPO diterima (masuk) & permohonan diluluskan (keluar);
//                baki awal tahun dikira ke belakang daripada baki semasa.
//   Stor klinik: pergerakan = log kraipro_klinik_log (baki selepas setiap transaksi direkod).
// ------------------------------------------
const DS_PANELS = ['ds-daerah', 'ds-klinik', 'ds-admin'];
const DS_DISTRICT_STORE = 'Stor Daerah, PKPD Kuala Krai';
const dsSelection = {}; // prefix -> { year, cat, item }

function dsUnit(prefix) {
  if (prefix === 'ds-klinik') return myKlinikUnit();
  if (prefix === 'ds-admin') return adminKlinikSelected;
  return '';
}

function dsStoreName(prefix) {
  return prefix === 'ds-daerah' ? DS_DISTRICT_STORE : `Stor Klinik, ${dsUnit(prefix)}`;
}

function dsPriceOf(id, sku) {
  const inv = items.find(i => String(i.id) === String(id)) || items.find(i => i.sku === sku);
  return inv ? (parseFloat(inv.harga) || 0) : 0;
}

// Senarai item bagi panel, disusun ikut kategori & kod; No. Kad = nombor turutan dalam senarai ini
function dsItemList(prefix) {
  let list;
  if (prefix === 'ds-daerah') {
    list = items.map(i => ({ id: String(i.id), sku: i.sku, nama: i.nama, unit: i.unit || '', kategori: i.kategori, subkategori: i.subkategori, baki: toInt(i.baki), harga: parseFloat(i.harga) || 0, reorder: toInt(i.reorder), paraMin: toInt(i.paraMin), paraMaks: toInt(i.paraMaks) }));
  } else {
    const doc = klinikDocFor(dsUnit(prefix));
    list = klinikItemList(doc).map(it => {
      const inv = items.find(i => String(i.id) === String(it.id));
      return {
        id: String(it.id), sku: it.sku || (inv && inv.sku) || '', nama: it.nama || (inv && inv.nama) || '', unit: it.unitBungkus || (inv && inv.unit) || '',
        kategori: it.kategori || (inv && inv.kategori) || '', subkategori: inv ? inv.subkategori : '', baki: toInt(it.baki), harga: dsPriceOf(it.id, it.sku), reorder: null, paraMin: null, paraMaks: null
      };
    });
  }
  const catOrder = sortedCategoryNames(list);
  return list
    .sort((a, b) => catOrder.indexOf(itemCategoryName(a)) - catOrder.indexOf(itemCategoryName(b))
      || String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true, sensitivity: 'base' }))
    .map((it, idx) => ({ ...it, noKad: String(idx + 1).padStart(3, '0') }));
}

function renderDaftarPanels() {
  DS_PANELS.forEach(renderDaftarPanel);
}

function renderDaftarPanel(prefix) {
  const box = document.getElementById(prefix + '-panel');
  if (!box) return;
  const visible = prefix === 'ds-daerah' ? isAdminLoggedIn
    : prefix === 'ds-klinik' ? isKlinikPenjaga() && !!(klinikDocFor(myKlinikUnit()) || {}).bakiAwalDikunci
    : isAdminLoggedIn && !!adminKlinikSelected;
  box.classList.toggle('hidden', !visible);
  if (!visible) return;
  if (box.contains(document.activeElement)) return; // jangan ganggu semasa memilih

  const list = dsItemList(prefix);
  const thisYear = parseInt(todayISODate().slice(0, 4));
  const sel = dsSelection[prefix] || (dsSelection[prefix] = { year: String(thisYear), cat: '', item: '' });
  const cats = sortedCategoryNames(list);
  if (sel.cat && !cats.includes(sel.cat)) sel.cat = '';
  const catItems = list.filter(i => !sel.cat || itemCategoryName(i) === sel.cat);
  if (sel.item && !catItems.some(i => i.id === sel.item)) sel.item = '';

  const opt = (v, label, cur) => `<option value="${escapeHtml(v)}"${v === cur ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const years = [thisYear, thisYear - 1, thisYear - 2].map(String);
  const field = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold focus:ring-2 focus:ring-purple-500';
  const compact = prefix === 'ds-klinik';

  box.innerHTML = `
    <div class="space-y-3">
      <div>
        <h3 class="${compact ? 'text-base' : 'text-lg'} font-extrabold text-slate-800 flex items-center gap-2">
          <i class="fa-solid fa-book text-purple-600"></i> Daftar Stok (KEW.PS-3) &amp; Senarai Daftar Stok (KEW.PS-4)
        </h3>
        <p class="text-xs text-slate-500">${escapeHtml(dsStoreName(prefix))} · Dijana daripada rekod ${prefix === 'ds-daerah' ? 'LPO yang diterima dan permohonan yang diluluskan' : 'penerimaan dan stok keluar klinik'}.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label class="text-[11px] font-bold text-slate-600">Tahun
          <select onchange="setDaftarSelection('${prefix}', 'year', this.value)" class="${field} mt-0.5">${years.map(y => opt(y, y, sel.year)).join('')}</select>
        </label>
        <label class="text-[11px] font-bold text-slate-600">Kategori
          <select onchange="setDaftarSelection('${prefix}', 'cat', this.value)" class="${field} mt-0.5">${opt('', `Semua Kategori (${list.length})`, sel.cat)}${cats.map(c => opt(c, `${c} (${list.filter(i => itemCategoryName(i) === c).length})`, sel.cat)).join('')}</select>
        </label>
        <label class="text-[11px] font-bold text-slate-600">Item (KEW.PS-3)
          <select onchange="setDaftarSelection('${prefix}', 'item', this.value)" class="${field} mt-0.5">${opt('', `Semua item dipilih (${catItems.length})`, sel.item)}${catItems.map(i => opt(i.id, `${i.noKad} · ${i.sku} · ${i.nama}`, sel.item)).join('')}</select>
        </label>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" onclick="generateKewPs3('${prefix}')" class="flex-1 sm:flex-initial bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow"><i class="fa-solid fa-file-lines mr-1"></i> Jana KEW.PS-3 (Daftar Stok)</button>
        <button type="button" onclick="generateKewPs4('${prefix}')" class="flex-1 sm:flex-initial bg-white border-2 border-purple-300 hover:bg-purple-50 text-purple-800 font-extrabold text-xs px-4 py-2 rounded-xl"><i class="fa-solid fa-list-ol mr-1"></i> Jana KEW.PS-4 (Senarai)</button>
      </div>
    </div>`;
}

function setDaftarSelection(prefix, key, value) {
  const sel = dsSelection[prefix] || (dsSelection[prefix] = { year: todayISODate().slice(0, 4), cat: '', item: '' });
  sel[key] = value;
  if (key === 'cat') sel.item = '';
  document.activeElement && document.activeElement.blur();
  renderDaftarPanel(prefix);
}

// ---- Pergerakan stok setiap item ----
// Stor daerah: semua pergerakan (semua tarikh) bagi satu item
function dsDistrictMoves(item) {
  const same = (i) => {
    const inv = findInventoryItem(i);
    return inv ? String(inv.id) === item.id : i.sku === item.sku;
  };
  const moves = [];
  lpoList.forEach(lpo => {
    const tarikh = String(lpo.tarikhTerima || '');
    if (lpo.status !== 'Selesai' || !/^\d{4}-\d{2}-\d{2}/.test(tarikh)) return;
    lpoReceivedLines(lpo).forEach(i => {
      if (!same(i) || toInt(i.qty) <= 0) return;
      moves.push({
        tarikh, sortKey: tarikh + (lpo.createdAt || ''), ref: (lpo.btb && lpo.btb.no) || lpo.no, pihak: lpo.pembekal || '',
        masuk: toInt(i.qty), keluar: 0, pegawai: (lpo.btb && lpo.btb.penerima && lpo.btb.penerima.nama) || ''
      });
    });
  });
  requests.forEach(r => {
    const tarikh = String(r.tarikhLulus || r.tarikh || '');
    if (r.status !== 'Selesai' || !/^\d{4}-\d{2}-\d{2}/.test(tarikh)) return;
    (r.items || []).forEach(i => {
      if (i.status !== 'Lulus' || toInt(i.qtyLulus) <= 0 || !same(i)) return;
      moves.push({ tarikh, sortKey: tarikh + (r.createdAt || ''), ref: r.id, pihak: r.unit || '', masuk: 0, keluar: toInt(i.qtyLulus), pegawai: r.pelulusNama || '' });
    });
  });
  return moves.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || String(a.ref).localeCompare(String(b.ref)));
}

function dsDistrictLedger(item, year) {
  const moves = dsDistrictMoves(item);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const netSince = moves.filter(m => m.tarikh >= start).reduce((s, m) => s + m.masuk - m.keluar, 0);
  const opening = Math.max(0, item.baki - netSince);
  let baki = opening;
  const rows = moves.filter(m => m.tarikh >= start && m.tarikh <= end).map(m => {
    baki += m.masuk - m.keluar;
    return { ...m, baki };
  });
  return { opening, rows };
}

const DS_KLINIK_PIHAK = { terima: 'Stor Daerah (PKPD Kuala Krai)', keluar: 'Kegunaan klinik', baki_awal: 'Baki awal (kiraan stok)', pelarasan: 'Pelarasan' };

function dsKlinikLedger(item, logs) {
  const lines = [];
  logs.forEach(l => (l.items || []).forEach(i => {
    if (String(i.itemId) === item.id) lines.push({ l, i });
  }));
  let prev = null;
  let opening = 0;
  const rows = lines.map(({ l, i }, idx) => {
    const qty = toInt(i.qty);
    const after = toInt(i.bakiSelepas);
    let masuk = 0, keluar = 0;
    if (l.jenis === 'terima') masuk = qty;
    else if (l.jenis === 'keluar' || l.jenis === 'pelarasan') keluar = qty;
    if (idx === 0) opening = l.jenis === 'baki_awal' ? 0 : Math.max(0, after - masuk + keluar);
    if (l.jenis === 'baki_awal') {
      // Baki awal menetapkan baki; bezanya direkod sebagai terimaan / keluaran
      const delta = after - (prev === null ? opening : prev);
      if (delta >= 0) masuk = delta; else keluar = -delta;
    }
    prev = after;
    return {
      tarikh: l.tarikh || String(l.createdAt || '').slice(0, 10), ref: l.ref || '-',
      pihak: l.jenis === 'pelarasan' && l.catatan ? l.catatan : (DS_KLINIK_PIHAK[l.jenis] || l.jenis),
      masuk, keluar, baki: after, pegawai: l.userNama || l.userEmail || ''
    };
  });
  return { opening, rows };
}

async function fetchKlinikYearLogs(unit, year) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const qs = await db.collection('kraipro_klinik_log').where('unit', '==', unit).where('bulan', 'in', months).get();
  return qs.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

// Sediakan data (dengan popup loading bagi data yang perlu dimuat)
async function dsPrepare(prefix) {
  const sel = dsSelection[prefix] || { year: todayISODate().slice(0, 4), cat: '', item: '' };
  const year = sel.year;
  const list = dsItemList(prefix).filter(i => !sel.cat || itemCategoryName(i) === sel.cat);
  let ledgerOf;
  if (prefix === 'ds-daerah') {
    if (year < requestWindowStart().slice(0, 4) && !olderRequestsLoaded) await loadOlderRequests();
    ledgerOf = (item) => dsDistrictLedger(item, year);
  } else {
    const unit = dsUnit(prefix);
    const token = showLoadingOverlay('Memuatkan rekod stor klinik...');
    let logs;
    try {
      logs = await fetchKlinikYearLogs(unit, year);
    } finally {
      hideLoadingOverlay(token);
    }
    ledgerOf = (item) => dsKlinikLedger(item, logs);
  }
  return { sel, year, list, ledgerOf };
}

function dsOpenPreview(html) {
  const content = document.getElementById('kewps8-content');
  if (!content) return;
  content.innerHTML = html;
  document.getElementById('kewps8-modal')?.classList.remove('hidden');
}

// ---- KEW.PS-3 ----
async function generateKewPs3(prefix) {
  let data;
  try {
    data = await dsPrepare(prefix);
  } catch (err) {
    showToast('Gagal menyediakan Daftar Stok: ' + authErrorMessage(err), 'error');
    return;
  }
  const { sel, year, ledgerOf } = data;
  const targets = sel.item ? data.list.filter(i => i.id === sel.item) : data.list;
  if (targets.length === 0) {
    showToast('Tiada item untuk dijana.', 'error');
    return;
  }
  const storeName = dsStoreName(prefix);
  const forms = targets.map((item, idx) => kewPs3FormHtml(item, ledgerOf(item), year, storeName, idx === targets.length - 1)).join('');
  dsOpenPreview(`<div class="print-portrait text-black font-sans">${forms}</div>`);
}

function kewPs3FormHtml(item, ledger, year, storeName, isLast) {
  const c = 'border border-black px-1.5 py-1';
  const h = `${c} bg-slate-200 font-bold text-center`;
  const blank = (n) => Array.from({ length: n }, () => `<td class="${c}">&nbsp;</td>`).join('');
  const harga = item.harga;
  const rm = (v) => formatRM(v);

  // Jumlah suku tahun & tahunan (kuantiti & nilai pada harga seunit semasa)
  const q = [0, 1, 2, 3].map(() => ({ inQ: 0, outQ: 0 }));
  ledger.rows.forEach(r => {
    const qi = Math.floor((parseInt(String(r.tarikh).slice(5, 7)) - 1) / 3);
    if (q[qi]) { q[qi].inQ += r.masuk; q[qi].outQ += r.keluar; }
  });
  const totIn = q.reduce((s, x) => s + x.inQ, 0);
  const totOut = q.reduce((s, x) => s + x.outQ, 0);
  const qCells = (key) => q.map(x => `<td class="${c} text-center">${x[key] || ''}</td><td class="${c} text-right">${x[key] ? rm(x[key] * harga) : ''}</td>`).join('');

  const header = (lampiran) => `
    <div class="flex justify-between text-[10px]"><span>Pekeliling Perbendaharaan Malaysia</span><span>AM 6.3 ${lampiran}</span></div>`;

  const partA = `
    <div style="break-after: page; page-break-after: always;" class="text-[11px] space-y-3">
      ${header('Lampiran A')}
      <div class="text-right font-bold">
        <p class="text-xs">KEW.PS-3</p>
        <p>No.Kad: <span class="underline">${escapeHtml(item.noKad)}</span></p>
      </div>
      <h2 class="text-center font-bold text-xs">DAFTAR STOK</h2>
      <table class="text-[11px] font-bold">
        <tr><td class="pr-3 py-0.5">Nama Stor</td><td class="px-1">:</td><td class="font-semibold">${escapeHtml(storeName)}</td></tr>
        <tr><td class="pr-3 py-0.5">Perihal Stok</td><td class="px-1">:</td><td class="font-semibold">${escapeHtml(item.nama)}</td></tr>
      </table>
      <h3 class="text-center font-bold">BAHAGIAN A</h3>
      <table class="w-full border-collapse table-fixed">
        <colgroup><col style="width:20%"><col style="width:14%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:22%"></colgroup>
        <tr><td class="${h} text-left">No. Kod</td><td colspan="4" class="${c} font-bold">${escapeHtml(item.sku)}</td><td class="${h} text-left">Kumpulan</td><td class="${c}">${escapeHtml(itemCategoryName(item))}</td></tr>
        <tr><td class="${h} text-left">Unit Pengukuran</td><td colspan="4" class="${c}">${escapeHtml(item.unit)}</td><td class="${h} text-left">Pergerakan</td><td class="${c}">&nbsp;</td></tr>
        <tr><td rowspan="2" class="${h} text-left">Lokasi Penyimpanan Stok</td><td class="${h}">Gudang/ Seksyen</td><td class="${h}">Baris</td><td class="${h}">Rak</td><td class="${h}">Tingkat</td><td class="${h}">Petak</td><td class="${h}">Kod Lokasi Penuh</td></tr>
        <tr>${blank(6)}</tr>
      </table>

      <table class="w-full border-collapse">
        <tr><td colspan="4" class="${h}">PARAS STOK</td></tr>
        <tr><td class="${h}">TAHUN</td><td class="${h}">MAKSIMUM<br>(Kuantiti)</td><td class="${h}">MENOKOK<br>(Kuantiti)</td><td class="${h}">MINIMUM<br>(Kuantiti)</td></tr>
        <tr><td class="${c} text-center">${escapeHtml(year)}</td><td class="${c} text-center">${item.paraMaks || ''}</td><td class="${c} text-center">${item.reorder === null ? '' : item.reorder}</td><td class="${c} text-center">${item.paraMin || ''}</td></tr>
        <tr>${blank(4)}</tr>
      </table>

      <table class="w-full border-collapse table-fixed">
        <colgroup><col style="width:12%">${'<col style="width:11%">'.repeat(8)}</colgroup>
        <tr><td colspan="9" class="${h}">TERIMAAN STOK SUKU TAHUN</td></tr>
        <tr><td rowspan="2" class="${h}">TAHUN</td><td colspan="2" class="${h}">PERTAMA</td><td colspan="2" class="${h}">KEDUA</td><td colspan="2" class="${h}">KETIGA</td><td colspan="2" class="${h}">KEEMPAT</td></tr>
        <tr>${('<td class="' + h + ' font-normal">Kuantiti</td><td class="' + h + ' font-normal">Nilai (RM)</td>').repeat(4)}</tr>
        <tr><td class="${c} text-center">${escapeHtml(year)}</td>${qCells('inQ')}</tr>
        <tr>${blank(9)}</tr>
        <tr><td colspan="9" class="${h}">KELUARAN STOK SUKU TAHUN</td></tr>
        <tr><td rowspan="2" class="${h}">TAHUN</td><td colspan="2" class="${h}">PERTAMA</td><td colspan="2" class="${h}">KEDUA</td><td colspan="2" class="${h}">KETIGA</td><td colspan="2" class="${h}">KEEMPAT</td></tr>
        <tr>${('<td class="' + h + ' font-normal">Kuantiti</td><td class="' + h + ' font-normal">Nilai (RM)</td>').repeat(4)}</tr>
        <tr><td class="${c} text-center">${escapeHtml(year)}</td>${qCells('outQ')}</tr>
        <tr>${blank(9)}</tr>
      </table>

      <table class="w-full border-collapse table-fixed">
        <tr><td rowspan="2" class="${h}">TAHUN</td><td colspan="2" class="${h}">TERIMAAN STOK TAHUNAN</td><td colspan="2" class="${h}">KELUARAN STOK TAHUNAN</td></tr>
        <tr><td class="${h} font-normal">Kuantiti</td><td class="${h} font-normal">Nilai (RM)</td><td class="${h} font-normal">Kuantiti</td><td class="${h} font-normal">Nilai (RM)</td></tr>
        <tr><td class="${c} text-center">${escapeHtml(year)}</td><td class="${c} text-center">${totIn}</td><td class="${c} text-right">${rm(totIn * harga)}</td><td class="${c} text-center">${totOut}</td><td class="${c} text-right">${rm(totOut * harga)}</td></tr>
        <tr>${blank(5)}</tr>
      </table>
    </div>`;

  const MIN_ROWS = 28;
  const txRows = ledger.rows.map(r => `
    <tr>
      <td class="${c} text-center whitespace-nowrap">${escapeHtml(formatDate(r.tarikh))}</td>
      <td class="${c} text-center break-words">${escapeHtml(r.ref)}</td>
      <td class="${c} break-words">${escapeHtml(r.pihak)}</td>
      <td class="${c} text-center">${r.masuk || ''}</td>
      <td class="${c} text-right">${r.masuk ? rm(harga) : ''}</td>
      <td class="${c} text-right">${r.masuk ? rm(r.masuk * harga) : ''}</td>
      <td class="${c} text-center">${r.keluar || ''}</td>
      <td class="${c} text-right">${r.keluar ? rm(r.keluar * harga) : ''}</td>
      <td class="${c} text-center font-bold">${r.baki}</td>
      <td class="${c} text-right">${rm(r.baki * harga)}</td>
      <td class="${c} break-words">${escapeHtml(r.pegawai)}</td>
    </tr>`).join('');
  const padRows = Array.from({ length: Math.max(0, MIN_ROWS - ledger.rows.length) }, () => `<tr>${blank(11)}</tr>`).join('');

  const partB = `
    <div style="${isLast ? '' : 'break-after: page; page-break-after: always;'}" class="text-[10px] space-y-2">
      ${header('Lampiran A')}
      <div class="flex justify-between items-end">
        <p class="font-bold text-[11px]">Transaksi Stok</p>
        <p class="font-bold text-center text-[11px]">BAHAGIAN B</p>
        <p class="text-right">No.Kad: <b>${escapeHtml(item.noKad)}</b> · ${escapeHtml(item.sku)}</p>
      </div>
      <table class="w-full border-collapse table-fixed">
        <colgroup>
          <col style="width:10%"><col style="width:12%"><col style="width:13%"><col style="width:7%"><col style="width:7%"><col style="width:8%">
          <col style="width:7%"><col style="width:8%"><col style="width:7%"><col style="width:9%"><col style="width:12%">
        </colgroup>
        <thead>
          <tr><th rowspan="2" class="${h}">Tarikh</th><th rowspan="2" class="${h}">No. PK/ BTB/ BPSS/ BPSI/ BPIN</th><th rowspan="2" class="${h}">Terima Daripada/ Keluar Kepada</th>
            <th colspan="3" class="${h}">TERIMAAN</th><th colspan="2" class="${h}">KELUARAN</th><th colspan="2" class="${h}">BAKI</th><th rowspan="2" class="${h}">Nama Pegawai</th></tr>
          <tr><th class="${h} font-normal">Kuantiti</th><th class="${h} font-normal">Seunit (RM)</th><th class="${h} font-normal">Jumlah (RM)</th>
            <th class="${h} font-normal">Kuantiti</th><th class="${h} font-normal">Jumlah (RM)</th><th class="${h} font-normal">Kuantiti</th><th class="${h} font-normal">Jumlah (RM)</th></tr>
        </thead>
        <tbody>
          <tr><td class="${c} text-center whitespace-nowrap">${escapeHtml(formatDate(`${year}-01-01`))}</td><td class="${c}"></td><td colspan="6" class="${c} italic">Baki dibawa ke hadapan</td>
            <td class="${c} text-center font-bold">${ledger.opening}</td><td class="${c} text-right">${rm(ledger.opening * harga)}</td><td class="${c}"></td></tr>
          ${txRows}${padRows}
        </tbody>
      </table>
      <div class="text-[9px] italic font-bold leading-tight pt-1">
        <p>Nota:</p><p>PK = Pesanan Kerajaan</p><p>BTB = Borang Terimaan Barang-barang</p><p>BPSS = Borang Permohonan Stok (KEW.PS-7)</p><p>BPSI= Borang Permohonan Stok (KEW.PS-8)</p><p>BPIN = Borang Pindahan Stok (KEW.PS-17)</p>
      </div>
    </div>`;

  return partA + partB;
}

// ---- KEW.PS-4 ----
async function generateKewPs4(prefix) {
  let data;
  try {
    data = await dsPrepare(prefix);
  } catch (err) {
    showToast('Gagal menyediakan Senarai Daftar Stok: ' + authErrorMessage(err), 'error');
    return;
  }
  const { sel, year, list, ledgerOf } = data;
  if (list.length === 0) {
    showToast('Tiada item untuk dijana.', 'error');
    return;
  }
  const c = 'border border-black px-1.5 py-1';
  const h = `${c} bg-slate-200 font-bold text-center`;
  // Aktif: ada baki atau ada pergerakan dalam tahun dipilih
  const rows = list.map((i, idx) => {
    const aktif = i.baki > 0 || ledgerOf(i).rows.length > 0;
    const nilai = i.baki * i.harga;
    return { ...i, bil: idx + 1, nilai, status: aktif ? 'Aktif' : 'Tidak Aktif' };
  });
  const total = rows.reduce((s, r) => s + r.nilai, 0);
  const MIN_ROWS = 30;
  const pad = Array.from({ length: Math.max(0, MIN_ROWS - rows.length) }, () => `<tr>${`<td class="${c}">&nbsp;</td>`.repeat(6)}</tr>`).join('');

  dsOpenPreview(`
    <div class="print-portrait text-black font-sans text-[11px] space-y-3">
      <div class="flex justify-between text-[10px]"><span>Pekeliling Perbendaharaan Malaysia</span><span>AM 6.3 Lampiran B</span></div>
      <p class="text-right font-bold text-xs">KEW.PS-4</p>
      <h2 class="text-center font-bold text-xs">SENARAI DAFTAR STOK</h2>
      <p class="text-center">${escapeHtml(dsStoreName(prefix))}${sel.cat ? ` · ${escapeHtml(sel.cat)}` : ''} · Tahun ${escapeHtml(year)} · Setakat ${escapeHtml(formatDate(todayISODate()))}</p>
      <table class="w-full border-collapse table-fixed">
        <colgroup><col style="width:7%"><col style="width:10%"><col style="width:16%"><col style="width:39%"><col style="width:13%"><col style="width:15%"></colgroup>
        <thead>
          <tr><th class="${h}">Bil.</th><th class="${h}">No. Kad</th><th class="${h}">No. Kod</th><th class="${h}">Perihal Stok</th><th class="${h}">Nilai Baki Semasa (RM)</th><th class="${h}">Status Stok (Aktif/ Tidak Aktif/ Kad Dibatalkan)</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="${c} text-center">${r.bil}</td>
              <td class="${c} text-center">${escapeHtml(r.noKad)}</td>
              <td class="${c} break-words">${escapeHtml(r.sku)}</td>
              <td class="${c} break-words">${escapeHtml(r.nama)}</td>
              <td class="${c} text-right">${formatRM(r.nilai)}</td>
              <td class="${c} text-center">${r.status}</td>
            </tr>`).join('')}
          ${pad}
        </tbody>
        <tfoot>
          <tr><td colspan="4" class="${h}">JUMLAH KESELURUHAN</td><td class="${c} text-right font-bold">${formatRM(total)}</td><td class="${c} bg-black"></td></tr>
        </tfoot>
      </table>
    </div>`);
}


// ------------------------------------------
// 18. PERMULAAN SISTEM
// ------------------------------------------
function renderAll() {
  updateAdminStatusUI();
  updateDashboardStats();
  renderBakiTable();
  renderReorderTable();
  renderPieChartAndTopTable();
  calculateIssuanceReport();

  populatePemohonDropdown();
  renderDraftTable();
  renderSejarahPermohonan();

  populateLpoItemDropdown();
  populatePembekalDropdowns();
  renderLpoDraftTable();
  renderMasterLpoTable();

  renderAdminRequests();
  renderMasterTable();
  renderApproversTable();
  renderMasterPembekalTable();
  renderKewPs14Table();
  renderKlinikView();
  renderAdminKlinik();
  renderDaftarPanels();
  updateAdminTaskBadges();
}

window.onload = function() {
  applyTabStyles();
  initFirebase();
};