/* RDV Événement · app.js · Firebase Firestore */

import { initializeApp }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, writeBatch, query, orderBy, enableIndexedDbPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Firebase ─────────────────────────────────────────────────── */

const app = initializeApp({
  apiKey:            'AIzaSyDcEFrfTfDOlgGy7e7JzZjeGXMsr5O4LIY',
  authDomain:        'rdv-perso-entreprends-demain.firebaseapp.com',
  projectId:         'rdv-perso-entreprends-demain',
  storageBucket:     'rdv-perso-entreprends-demain.firebasestorage.app',
  messagingSenderId: '303753000581',
  appId:             '1:303753000581:web:ef789f95513debcfac1bec',
});
const db = getFirestore(app);

// Cache local pour accélerer les chargements suivants
enableIndexedDbPersistence(db).catch(() => {});

/* ── Créneaux ─────────────────────────────────────────────────── */

function fmt(h, m) {
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

function buildSlots(sh, sm, eh, em) {
  const list = [];
  let h = sh, m = sm;
  while (h * 60 + m + 20 <= eh * 60 + em) {
    const start = fmt(h, m);
    m += 20; if (m >= 60) { h += Math.floor(m/60); m %= 60; }
    list.push({ start, end: fmt(h, m) });
    m += 10; if (m >= 60) { h += Math.floor(m/60); m %= 60; }
  }
  return list;
}

const MATIN = buildSlots(10,0,13,0);
const APREM = buildSlots(14,0,17,0);

function slotsForPeriod(period) {
  const ms = period !== 'aprem' ? MATIN.map(s => ({ ...s, period: 'matin' })) : [];
  const ps = period !== 'matin' ? APREM.map(s => ({ ...s, period: 'aprem' })) : [];
  return [...ms, ...ps];
}

/* ── État ─────────────────────────────────────────────────────── */

const DATA = {
  exposants: [],
  slots:     {},
  bookings:  [],
  visitors:  [],   // [{id, email, code}]
};

let selId        = null;
let periodFilter  = '';
let pendingExp    = null;
let pendingSlot   = null;
let visitorCode   = null;  // code du visiteur courant (si saisi)
let visitorEmail  = null;  // email du visiteur courant



/* ── Utilitaires ─────────────────────────────────────────────── */

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getBooking(expId, start) {
  return DATA.bookings.find(b => b.exposantId === expId && b.slotStart === start);
}

function getSlots(expId) {
  return (DATA.slots[expId] || []).slice().sort((a, b) => a.start.localeCompare(b.start));
}

function el(id) { return document.getElementById(id); }

function loader(show) {
  const l = el('loader');
  if (l) { if (show) l.classList.add('on'); else l.classList.remove('on'); }
}

let toastT;
function toast(msg) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ── Firebase : charger les données ─────────────────────────── */

async function loadData() {
  loader(true);
  try {
    const [eSnap, sSnap, bSnap, vSnap] = await Promise.all([
      getDocs(query(collection(db, 'exposants'), orderBy('createdAt'))),
      getDocs(query(collection(db, 'slots'),     orderBy('start'))),
      getDocs(query(collection(db, 'bookings'),  orderBy('slotStart'))),
      getDocs(collection(db, 'visitors')),
    ]);
    DATA.exposants = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    DATA.bookings  = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    DATA.visitors  = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    DATA.slots = {};
    sSnap.docs.forEach(d => {
      const s = { id: d.id, ...d.data() };
      if (!DATA.slots[s.exposantId]) DATA.slots[s.exposantId] = [];
      DATA.slots[s.exposantId].push(s);
    });
  } catch (e) {
    console.error(e);
    toast('Erreur de connexion à Firebase.');
  }
  loader(false);
}

/* ── VISITEUR ─────────────────────────────────────────────────── */

function renderGrid() {
  const search = (el('vis-search') ? el('vis-search').value : '').toLowerCase();
  const catF   = el('vis-cat') ? el('vis-cat').value : '';
  const grid   = el('grid');
  if (!grid) return;

  // Mise à jour du select catégories
  const catSel = el('vis-cat');
  if (catSel) {
    const cur  = catSel.value;
    const cats = [...new Set(DATA.exposants.map(e => e.cat))];
    catSel.innerHTML = '<option value="">Toutes catégories</option>' +
      cats.map(c => `<option value="${c}"${c === cur ? ' selected' : ''}>${c}</option>`).join('');
  }

  if (!DATA.exposants.length) {
    grid.innerHTML = '<div class="empty-state"><i class="ti ti-calendar-off"></i><p>Aucun exposant disponible.</p></div>';
    return;
  }

  const list = DATA.exposants.filter(exp => {
    const ms = !search || exp.name.toLowerCase().includes(search) || exp.cat.toLowerCase().includes(search);
    const mc = !catF   || exp.cat === catF;
    const mp = !periodFilter || exp.period === periodFilter || exp.period === 'jour';
    return ms && mc && mp;
  });

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><i class="ti ti-search"></i><p>Aucun exposant trouvé.</p></div>';
    return;
  }

  grid.innerHTML = list.map(exp => {
    const slots  = getSlots(exp.id);
    const amFree = slots.filter(s => s.period === 'matin' && s.enabled && !getBooking(exp.id, s.start)).length;
    const pmFree = slots.filter(s => s.period === 'aprem' && s.enabled && !getBooking(exp.id, s.start)).length;
    const pills = [
      amFree > 0 ? `<span class="pill pill-am">${amFree} matin</span>` : '',
      pmFree > 0 ? `<span class="pill pill-pm">${pmFree} ap-m</span>` : '',
      amFree === 0 && pmFree === 0 ? '<span class="pill pill-none">Complet</span>' : '',
    ].filter(Boolean).join('');
    return `<div class="exp-card" data-id="${exp.id}">
      <div class="exp-card-top">
        <div class="avatar">${initials(exp.name)}</div>
        <div><div class="exp-name">${exp.name}</div><div class="exp-cat">${exp.cat}${exp.expertise ? ' · <span style="color:var(--ink3)">' + exp.expertise + '</span>' : ''}</div></div>
        <i class="ti ti-chevron-right exp-arrow"></i>
      </div>
      <div class="pills">${pills}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.exp-card').forEach(card => {
    card.addEventListener('click', () => openDrawer(card.dataset.id));
  });
}

function openDrawer(expId) {
  pendingExp = expId;
  const exp    = DATA.exposants.find(e => e.id === expId);
  const slots  = getSlots(expId);
  const mSlots = slots.filter(s => s.period === 'matin');
  const pSlots = slots.filter(s => s.period === 'aprem');

  el('d-name').textContent = exp.name;
  el('d-cat').textContent  = exp.cat + (exp.expertise ? ' · ' + exp.expertise : '');
  el('d-confirm').innerHTML = '';

  function fillSlots(list, containerId, freeCls) {
    const container = el(containerId);
    if (!list.length) { container.innerHTML = '<span style="font-size:12px;color:var(--ink3)">Non disponible</span>'; return; }
    container.innerHTML = list.map(s => {
      const booked = getBooking(expId, s.start);
      const free   = s.enabled && !booked;
      const icon   = booked ? ' <i class="ti ti-lock" style="font-size:10px"></i>' : '';
      return `<button class="slot-btn ${free ? freeCls : 'slot-taken'}" data-start="${s.start}" data-end="${s.end}" ${!free ? 'disabled' : ''}>${s.start}–${s.end}${icon}</button>`;
    }).join('');
    container.querySelectorAll('.slot-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.start, btn.dataset.end));
    });
  }

  const amFree = mSlots.filter(s => s.enabled && !getBooking(expId, s.start)).length;
  const pmFree = pSlots.filter(s => s.enabled && !getBooking(expId, s.start)).length;
  el('d-am-count').textContent = amFree ? `${amFree} libre${amFree > 1 ? 's' : ''}` : 'Complet';
  el('d-pm-count').textContent = pmFree ? `${pmFree} libre${pmFree > 1 ? 's' : ''}` : 'Complet';
  el('d-matin').style.display = mSlots.length ? 'flex' : 'none';
  el('d-aprem').style.display = pSlots.length ? 'flex' : 'none';

  fillSlots(mSlots, 'd-am-slots', 'slot-free-am');
  fillSlots(pSlots, 'd-pm-slots', 'slot-free-pm');

  el('overlay').classList.add('open');
  el('drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  el('overlay')?.classList.remove('open');
  el('drawer')?.classList.remove('open');
  document.body.style.overflow = '';
}

function applyQuickCode() {
  const code   = (el('m-code-rapide')?.value || '').trim();
  const status = el('m-code-status');
  if (!/^\d{6}$/.test(code)) {
    if (status) { status.textContent = '⚠️ Le code doit contenir 6 chiffres.'; status.style.color = 'var(--red)'; }
    return;
  }
  const visitor = DATA.visitors.find(v => v.code === code);
  if (!visitor) {
    if (status) { status.textContent = '❌ Code introuvable. Vérifiez votre code.'; status.style.color = 'var(--red)'; }
    return;
  }
  // Trouver les infos du visiteur depuis ses bookings précédents
  const prevBooking = DATA.bookings.find(b => (b.email||'').toLowerCase() === visitor.email);
  if (prevBooking) {
    if (el('m-prenom'))  el('m-prenom').value  = prevBooking.prenom  || '';
    if (el('m-nom'))     el('m-nom').value      = prevBooking.nom     || '';
    if (el('m-email'))   el('m-email').value    = prevBooking.email   || '';
    if (el('m-societe')) el('m-societe').value  = prevBooking.societe || '';
    // Verrouiller les champs pour éviter modification
    ['m-prenom','m-nom','m-email','m-societe'].forEach(id => {
      const field = el(id);
      if (field) { field.readOnly = true; field.style.background = 'var(--cyan-l)'; field.style.color = 'var(--cyan-d)'; }
    });
    if (status) { status.textContent = '✓ Informations pré-remplies — il ne vous reste qu\'à décrire votre problématique.'; status.style.color = 'var(--green)'; }
    setTimeout(() => el('m-problematique')?.focus(), 100);
  } else {
    if (el('m-email')) el('m-email').value = visitor.email;
    if (status) { status.textContent = '✓ Code reconnu. Complétez les champs manquants.'; status.style.color = 'var(--green)'; }
  }
}

function openModal(start, end) {
  pendingSlot = start;
  const exp = DATA.exposants.find(e => e.id === pendingExp);
  el('m-info').textContent = `${exp.name} · ${start}–${end} · ${start >= '14:00' ? 'Après-midi' : 'Matin'} · 22 sept. 2026`;
  // Reset champs
  ['m-prenom','m-nom','m-email','m-societe','m-problematique','m-code-rapide'].forEach(id => {
    const e = el(id); if(e) { e.value = ''; e.readOnly = false; e.style.background = ''; e.style.color = ''; }
  });
  if (el('m-code-status')) { el('m-code-status').textContent = 'Vos informations seront pré-remplies automatiquement.'; el('m-code-status').style.color = 'var(--ink3)'; }
  el('modal').classList.add('open');
  setTimeout(() => el('m-code-rapide')?.focus(), 80);

  // Brancher le bouton appliquer code
  const applyBtn = el('m-code-apply');
  if (applyBtn) {
    applyBtn.onclick = applyQuickCode;
  }
  const codeInput = el('m-code-rapide');
  if (codeInput) {
    codeInput.onkeydown = e => { if (e.key === 'Enter') applyQuickCode(); };
  }
}

function closeModal() {
  el('modal')?.classList.remove('open');
}

/* ── Système de code visiteur ─────────────────────────────────── */

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function getOrCreateVisitorCode(email) {
  const emailLow = email.toLowerCase();
  const existing = DATA.visitors.find(v => v.email === emailLow);
  if (existing) return { code: existing.code, isNew: false };
  const code = genCode();
  const ref  = await addDoc(collection(db, 'visitors'), { email: emailLow, code, createdAt: Date.now() });
  DATA.visitors.push({ id: ref.id, email: emailLow, code });
  return { code, isNew: true };
}

function showCodeModal(code, prenom, expName, start, end) {
  navigator.clipboard.writeText(code).catch(() => {});
  const overlay = document.createElement('div');
  overlay.id = 'code-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:2rem;max-width:440px;width:100%;text-align:center;border:2px solid var(--cyan);box-shadow:0 20px 60px rgba(0,0,0,.2)">
      <i class="ti ti-circle-check" style="font-size:40px;color:var(--cyan);display:block;margin-bottom:.75rem"></i>
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:.25rem">RDV confirmé !</div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:1.5rem">${start}–${end} chez ${expName}</div>

      <div style="background:var(--cyan-l);border:2px solid var(--cyan);border-radius:14px;padding:1.25rem;margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--cyan-d);margin-bottom:.5rem">🔑 Votre code personnel</div>
        <div style="font-size:52px;font-weight:700;color:var(--cyan);letter-spacing:.2em;font-family:monospace">${code}</div>
        <div style="font-size:12px;color:#2E6B12;margin-top:.5rem;font-weight:600">✓ Copié automatiquement dans votre presse-papier</div>
      </div>

      <div style="background:#FFF8E6;border:2px solid #FFD82B;border-radius:12px;padding:1rem;margin-bottom:1.25rem;text-align:left">
        <div style="font-size:12px;font-weight:700;color:#B8940A;margin-bottom:.5rem">⚠️ Notez ce code — il ne pourra pas être modifié</div>
        <div style="font-size:12px;color:#5A4A00;line-height:1.6">
          Ce code est <strong>unique et définitif</strong>. Avec lui, vous pouvez :<br>
          • Accéder rapidement à votre planning<br>
          • <strong>Annuler vos RDV</strong> si besoin<br><br>
          <strong>Avec ce code lors de vos prochaines réservations</strong>, vous n'aurez plus besoin de renseigner vos informations personnelles déjà enregistrées — elles seront pré-remplies automatiquement.<br><br>
          <strong>Sans ce code</strong>, vous pouvez toujours consulter votre planning avec votre email, mais vous ne pourrez pas annuler vos RDV. Pour toute modification, contactez l'équipe communication de PIE par email.
        </div>
      </div>

      <button id="code-ok-btn" style="background:var(--cyan);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-family:var(--font);font-size:14px;font-weight:700;cursor:pointer;width:100%">
        J'ai noté mon code → Continuer
      </button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('code-ok-btn').addEventListener('click', () => {
    overlay.remove();
    openDrawer(pendingExp);
  });
}

async function confirmBooking() {
  const prenom        = el('m-prenom').value.trim();
  const nom           = el('m-nom').value.trim();
  const email         = el('m-email').value.trim();
  const societe       = el('m-societe').value.trim();
  const problematique = el('m-problematique').value.trim();
  if (!prenom || !nom) { toast('Merci de renseigner votre prénom et nom.'); return; }
  if (!email) { toast('Merci de renseigner votre email.'); return; }
  if (!problematique) { toast('Merci de décrire votre problématique.'); return; }

  const doublon = DATA.bookings.find(b =>
    b.exposantId === pendingExp &&
    (b.email || '').toLowerCase() === email.toLowerCase()
  );
  if (doublon) {
    const exp2 = DATA.exposants.find(e => e.id === pendingExp);
    toast(`Vous avez déjà un RDV avec ${exp2?.name} à ${doublon.slotStart}.`);
    closeModal();
    return;
  }

  const slot = getSlots(pendingExp).find(s => s.start === pendingSlot);
  const exp  = DATA.exposants.find(e => e.id === pendingExp);
  loader(true);
  try {
    const { code, isNew } = await getOrCreateVisitorCode(email);
    const ref = await addDoc(collection(db, 'bookings'), {
      exposantId: pendingExp,
      slotStart:  pendingSlot,
      slotEnd:    slot?.end || '',
      period:     slot?.period || '',
      prenom, nom, email, societe, problematique,
      createdAt:  Date.now(),
    });
    DATA.bookings.push({ id: ref.id, exposantId: pendingExp, slotStart: pendingSlot, slotEnd: slot?.end, period: slot?.period, prenom, nom, email, societe, problematique });
    closeModal();
    if (isNew) {
      showCodeModal(code, prenom, exp?.name, pendingSlot, slot?.end);
    } else {
      el('d-confirm').innerHTML = `<div class="confirm-ok"><i class="ti ti-circle-check"></i><div>RDV confirmé — ${prenom} ${nom}<br><span style="font-weight:400;font-size:12px">${pendingSlot}–${slot?.end} chez ${exp?.name}</span></div></div>`;
      openDrawer(pendingExp);
    }
    renderStats();
    toast('RDV confirmé !');
  } catch(e) {
    console.error(e);
    toast('Erreur lors de la réservation.');
  }
  loader(false);
}

/* ── ADMIN ───────────────────────────────────────────────────── */

function renderStats() {
  // Met à jour le badge RDV
  const badge = el('rdv-badge');
  if (badge) badge.textContent = DATA.bookings.length || '';

  const statsEl = el('stats');
  if (!statsEl) return;
  const total  = Object.values(DATA.slots).flat().filter(s => s.enabled).length;
  const booked = DATA.bookings.length;
  statsEl.innerHTML =
    `<div class="stat"><div class="stat-v">${DATA.exposants.length}</div><div class="stat-l">Exposants</div></div>` +
    `<div class="stat"><div class="stat-v">${total}</div><div class="stat-l">Créneaux</div></div>` +
    `<div class="stat"><div class="stat-v">${booked}</div><div class="stat-l">RDV</div></div>`;
}

function renderExpList() {
  const listEl = el('exp-list');
  if (!listEl) return;
  if (!DATA.exposants.length) {
    listEl.innerHTML = '<div style="padding:.9rem;font-size:12px;color:var(--ink3);text-align:center">Aucun exposant.<br>Cliquez + pour en ajouter.</div>';
    return;
  }
  listEl.innerHTML = DATA.exposants.map(exp => `
    <div class="exp-item${selId === exp.id ? ' active' : ''}" data-id="${exp.id}">
      <div class="avatar" style="font-size:12px">${initials(exp.name)}</div>
      <div style="flex:1"><div class="ei-name">${exp.name}</div><div class="ei-cat">${exp.cat}${exp.expertise ? ' · '+exp.expertise : ''}</div></div>
      <button class="edit-exp-btn" data-id="${exp.id}" title="Modifier"><i class="ti ti-pencil" style="font-size:13px"></i></button>
      <button class="del-exp-btn" data-id="${exp.id}" title="Supprimer"><i class="ti ti-trash" style="font-size:13px"></i></button>
    </div>`).join('');

  listEl.querySelectorAll('.exp-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.del-exp-btn') || e.target.closest('.edit-exp-btn')) return;
      selId = item.dataset.id;
      renderExpList();
      el('cal-empty').style.display = 'none';
      el('cal-panel').style.display = 'block';
      el('edit-panel').style.display = 'none';
      renderCal();
    });
  });
  listEl.querySelectorAll('.del-exp-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteExposant(btn.dataset.id); });
  });
  listEl.querySelectorAll('.edit-exp-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditPanel(btn.dataset.id); });
  });
}

function renderCal() {
  const exp = DATA.exposants.find(e => e.id === selId);
  if (!exp) return;

  el('cal-name').textContent = exp.name;
  el('cal-meta').textContent = exp.cat + ' · 22 septembre 2026';

  const switcher = el('cal-periods');
  switcher.innerHTML = [
    { val: 'matin', label: 'Matin',        cls: 'sel-matin' },
    { val: 'aprem', label: 'Après-midi',   cls: 'sel-aprem' },
    { val: 'jour',  label: 'Journée complète',                       cls: 'sel-jour'  },
  ].map(o => `<button class="psw${exp.period === o.val ? ' ' + o.cls : ''}" data-p="${o.val}">${o.label}</button>`).join('');

  switcher.querySelectorAll('.psw').forEach(btn => {
    btn.addEventListener('click', () => setPeriod(btn.dataset.p));
  });

  const slots  = getSlots(exp.id);
  const mSlots = slots.filter(s => s.period === 'matin');
  const pSlots = slots.filter(s => s.period === 'aprem');

  function block(list, cls) {
    if (!list.length) return '';
    const free = list.filter(s => s.enabled && !getBooking(exp.id, s.start)).length;
    const head = cls === 'am'
      ? 'Matin · 10h–13h'
      : 'Après-midi · 14h–17h';
    const btns = list.map(s => {
      const b = getBooking(exp.id, s.start);
      let c, icon = '';
      if (b)             { c = 'aslot aslot-booked' + (cls === 'pm' ? ' pm' : ''); }
      else if (s.enabled){ c = 'aslot aslot-on-' + cls; }
      else               { c = 'aslot aslot-off'; icon = '<i class="ti ti-minus" style="font-size:10px"></i> '; }
      const label = b
        ? `<i class="ti ti-user" style="font-size:10px"></i> ${b.prenom} ${b.nom}`
        : `${icon}${s.start}–${s.end}`;
      return `<button class="${c}" data-sid="${s.id}" data-start="${s.start}" data-bid="${b ? b.id : ''}"
        title="${b ? b.prenom+' '+b.nom+(b.societe?' · '+b.societe:'')+(b.email?' · '+b.email:'') : (s.enabled?'Désactiver':'Activer')}"
        ${b ? '' : ''}>${label}</button>`;
    }).join('');
    return `<div class="cal-block">
      <div class="cal-block-head ${cls}">${head}<span class="hcount">${free} libre${free > 1 ? 's' : ''}</span></div>
      <div class="cal-slots">${btns}</div>
    </div>`;
  }

  const body = el('cal-body');
  body.innerHTML = block(mSlots, 'am') + block(pSlots, 'pm') || '<div style="padding:1rem;font-size:13px;color:var(--ink3)">Aucun créneau.</div>';

  body.querySelectorAll('.aslot').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.bid) {
        // Créneau réservé → proposer désinscription
        deleteBooking(btn.dataset.bid);
      } else {
        toggleSlot(btn.dataset.sid, btn.dataset.start);
      }
    });
  });
}

async function toggleSlot(slotId, start) {
  const slot = (DATA.slots[selId] || []).find(s => s.id === slotId);
  if (!slot || getBooking(selId, start)) return;
  const next = !slot.enabled;
  slot.enabled = next;
  renderCal(); renderStats();
  try {
    await updateDoc(doc(db, 'slots', slotId), { enabled: next });
  } catch (e) {
    slot.enabled = !next;
    renderCal();
    toast('Erreur de mise à jour.');
  }
}

async function setPeriod(period) {
  const exp = DATA.exposants.find(e => e.id === selId);
  if (!exp) return;
  loader(true);
  try {
    await updateDoc(doc(db, 'exposants', exp.id), { period });
    exp.period = period;
    const batch = writeBatch(db);
    (DATA.slots[exp.id] || []).forEach(s => batch.delete(doc(db, 'slots', s.id)));
    await batch.commit();
    const created = [];
    for (const s of slotsForPeriod(period)) {
      const ref = await addDoc(collection(db, 'slots'), { exposantId: exp.id, start: s.start, end: s.end, period: s.period, enabled: true });
      created.push({ id: ref.id, exposantId: exp.id, start: s.start, end: s.end, period: s.period, enabled: true });
    }
    DATA.slots[exp.id] = created;
    renderCal(); renderStats();
    toast('Disponibilité mise à jour');
  } catch (e) {
    console.error(e); toast('Erreur.');
  }
  loader(false);
}

function toggleForm() {
  el('add-form').classList.toggle('open');
}

async function addExposant() {
  const name     = el('f-name').value.trim();
  const cat      = el('f-cat').value || 'Autre';
  const expertise = el('f-expertise') ? el('f-expertise').value.trim() : '';
  const period   = el('f-period').value;
  if (!name) { toast('Merci de saisir un nom.'); return; }
  if (!cat || cat === 'Autre') { toast('Merci de choisir une catégorie.'); return; }
  loader(true);
  try {
    const ref = await addDoc(collection(db, 'exposants'), { name, cat, expertise, period, createdAt: Date.now() });
    const exp = { id: ref.id, name, cat, expertise, period };
    DATA.exposants.push(exp);
    const created = [];
    for (const s of slotsForPeriod(period)) {
      const sref = await addDoc(collection(db, 'slots'), { exposantId: exp.id, start: s.start, end: s.end, period: s.period, enabled: true });
      created.push({ id: sref.id, exposantId: exp.id, start: s.start, end: s.end, period: s.period, enabled: true });
    }
    DATA.slots[exp.id] = created;
    el('f-name').value = '';
    if(el('f-expertise')) el('f-expertise').value = '';
    toggleForm();
    renderExpList(); renderStats();
    toast(name + ' ajouté !');
  } catch (e) {
    console.error(e); toast('Erreur lors de la création.');
  }
  loader(false);
}

/* ── Modifier un exposant ─────────────────────────────────────── */

const CATS = [
  'Droit immobilier, architecture, aménagement',
  'E-commerce, développement web',
  'Marketing, communication, image',
  'Stratégie et développement commercial',
  'Droit des affaires et des sociétés',
  'Conseil financier, expertise comptable, direction financière',
  'Courtier, banque, assurance',
];

function openEditPanel(expId) {
  const exp = DATA.exposants.find(e => e.id === expId);
  if (!exp) return;
  selId = expId;
  renderExpList();

  el('cal-panel').style.display  = 'none';
  el('cal-empty').style.display  = 'none';
  el('edit-panel').style.display = 'block';

  el('edit-panel').innerHTML = `
    <div class="edit-panel-inner">
      <div class="edit-panel-title"><i class="ti ti-pencil"></i> Modifier — ${exp.name}</div>
      <div class="edit-form">
        <div class="field"><label>Nom</label><input id="e-name" value="${exp.name}" /></div>
        <div class="field"><label>Catégorie</label>
          <select id="e-cat">
            ${CATS.map(c => `<option value="${c}" ${exp.cat === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Expertise</label><input id="e-expertise" value="${exp.expertise || ''}" placeholder="ex: Avocat, Architecte…" /></div>
        <div class="field"><label>Disponibilité</label>
          <select id="e-period">
            <option value="jour"  ${exp.period==='jour'  ? 'selected':''}>Journée complète (10h–17h)</option>
            <option value="matin" ${exp.period==='matin' ? 'selected':''}>Matin uniquement (10h–13h)</option>
            <option value="aprem" ${exp.period==='aprem' ? 'selected':''}>Après-midi uniquement (14h–17h)</option>
          </select>
        </div>
        <div class="edit-actions">
          <button id="edit-cancel" class="btn-ghost"><i class="ti ti-x"></i> Annuler</button>
          <button id="edit-save"   class="btn-primary"><i class="ti ti-check"></i> Enregistrer</button>
        </div>
      </div>
    </div>`;

  el('edit-cancel').addEventListener('click', () => {
    el('edit-panel').style.display = 'none';
    el('cal-empty').style.display  = 'block';
  });
  el('edit-save').addEventListener('click', () => saveEditExposant(expId));
}

async function saveEditExposant(expId) {
  const exp      = DATA.exposants.find(e => e.id === expId);
  const name     = el('e-name').value.trim();
  const cat      = el('e-cat').value;
  const expertise = el('e-expertise').value.trim();
  const period   = el('e-period').value;
  if (!name) { toast('Merci de saisir un nom.'); return; }

  loader(true);
  try {
    const periodChanged = period !== exp.period;
    await updateDoc(doc(db, 'exposants', expId), { name, cat, expertise, period });
    exp.name     = name;
    exp.cat      = cat;
    exp.expertise = expertise;
    exp.period   = period;

    if (periodChanged) {
      // Recréer les créneaux si la période a changé
      const batch = writeBatch(db);
      (DATA.slots[expId] || []).forEach(s => batch.delete(doc(db, 'slots', s.id)));
      await batch.commit();
      const created = [];
      for (const s of slotsForPeriod(period)) {
        const ref = await addDoc(collection(db, 'slots'), { exposantId: expId, start: s.start, end: s.end, period: s.period, enabled: true });
        created.push({ id: ref.id, exposantId: expId, start: s.start, end: s.end, period: s.period, enabled: true });
      }
      DATA.slots[expId] = created;
    }

    el('edit-panel').style.display = 'none';
    el('cal-empty').style.display  = 'block';
    renderExpList();
    renderStats();
    toast(`${name} mis à jour !`);
  } catch(e) {
    console.error(e);
    toast('Erreur lors de la modification.');
  }
  loader(false);
}

/* ── Supprimer un exposant ────────────────────────────────────── */

async function deleteExposant(expId) {
  if (!confirm('Supprimer cet exposant et tous ses créneaux / RDV ?')) return;
  loader(true);
  try {
    const batch = writeBatch(db);
    // Delete slots
    (DATA.slots[expId] || []).forEach(s => batch.delete(doc(db, 'slots', s.id)));
    // Delete bookings
    DATA.bookings.filter(b => b.exposantId === expId).forEach(b => batch.delete(doc(db, 'bookings', b.id)));
    // Delete exposant
    batch.delete(doc(db, 'exposants', expId));
    await batch.commit();


    DATA.exposants = DATA.exposants.filter(e => e.id !== expId);
    DATA.bookings  = DATA.bookings.filter(b => b.exposantId !== expId);
    delete DATA.slots[expId];

    if (selId === expId) {
      selId = null;
      el('cal-empty').style.display = 'block';
      el('cal-panel').style.display = 'none';
    }
    renderExpList(); renderStats();
    toast('Exposant supprimé.');
  } catch (e) {
    console.error(e); toast('Erreur lors de la suppression.');
  }
  loader(false);
}

/* ── Supprimer un RDV ─────────────────────────────────────────── */

async function deleteBooking(bookingId) {
  if (!confirm('Désinscrire ce visiteur ?')) return;
  loader(true);
  try {
    await deleteDoc(doc(db, 'bookings', bookingId));
    DATA.bookings = DATA.bookings.filter(b => b.id !== bookingId);
    renderRdvList(); renderStats();
    if (selId) renderCal();
    toast('Visiteur désinscrit.');
  } catch (e) {
    console.error(e); toast('Erreur lors de la désinscription.');
  }
  loader(false);
}

/* ── Auth admin ───────────────────────────────────────────────── */

const PWD = 'Fredtunousmanques';
const SK  = 'rdv-admin-ok';

async function initLogin() {
  async function doUnlock() {
    el('login-screen').style.display = 'none';
    el('admin-app').style.display    = 'block';
    await loadData();
    renderExpList();
    renderStats();
  }

  if (sessionStorage.getItem(SK) === '1') { await doUnlock(); return; }

  el('pwd-btn').addEventListener('click', async () => {
    if ((el('pwd')?.value || '') === PWD) {
      sessionStorage.setItem(SK, '1');
      await doUnlock();
    } else {
      el('pwd-error').classList.add('show');
      if (el('pwd')) { el('pwd').value = ''; el('pwd').focus(); }
    }
  });
  el('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') el('pwd-btn').click(); });
  el('logout-btn').addEventListener('click', () => { sessionStorage.removeItem(SK); location.reload(); });
}

/* ── Init ─────────────────────────────────────────────────────── */

const IS_ADMIN   = !!el('admin-app');
const IS_VISITOR = !!el('grid');

/* ── Onglets admin ─────────────────────────────────────────────── */

function switchAdminTab(tab) {
  document.querySelectorAll('.atab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  el('tab-calendrier').style.display  = tab === 'calendrier'  ? 'flex'  : 'none';
  el('tab-rdvs').style.display        = tab === 'rdvs'        ? 'block' : 'none';
  el('tab-visiteurs').style.display   = tab === 'visiteurs'   ? 'block' : 'none';
  if (tab === 'rdvs')      renderRdvList();
  if (tab === 'visiteurs') renderVisiteursList();
}

function renderRdvList() {
  const expF    = el('rdv-filter-exp')?.value || '';
  const periodF = el('rdv-filter-period')?.value || '';

  // Populate exposant filter
  const expSel = el('rdv-filter-exp');
  if (expSel) {
    const cur = expSel.value;
    expSel.innerHTML = '<option value="">Tous les exposants</option>' +
      DATA.exposants.map(e => `<option value="${e.id}"${e.id === cur ? ' selected' : ''}>${e.name}</option>`).join('');
  }

  let bookings = DATA.bookings.slice().sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  if (expF)    bookings = bookings.filter(b => b.exposantId === expF);
  if (periodF) bookings = bookings.filter(b => b.period === periodF);

  // Update badge
  const badge = el('rdv-badge');
  if (badge) badge.textContent = DATA.bookings.length || '';

  const listEl = el('rdv-list');
  if (!listEl) return;

  if (!bookings.length) {
    listEl.innerHTML = '<div class="empty-state"><i class="ti ti-calendar-off"></i><p>Aucun rendez-vous pour le moment.</p></div>';
    return;
  }

  listEl.innerHTML = `<table class="rdv-table">
    <thead><tr>
      <th>Horaire</th>
      <th>Période</th>
      <th>Exposant</th>
      <th>Visiteur</th>
      <th>Email</th>
      <th>Société</th>
      <th>Problématique</th>
      <th></th>
    </tr></thead>
    <tbody>
      ${bookings.map(b => {
        const exp = DATA.exposants.find(e => e.id === b.exposantId);
        const isPm = b.period === 'aprem';
        const tag  = isPm
          ? '<span class="tag-pm">Après-midi</span>'
          : '<span class="tag-am">Matin</span>';
        return `<tr data-bid="${b.id}">
          <td><strong>${b.slotStart}–${b.slotEnd}</strong></td>
          <td>${tag}</td>
          <td>${exp?.name || '–'}</td>
          <td>${b.prenom} ${b.nom}</td>
          <td>${b.email || '–'}</td>
          <td>${b.societe || '–'}</td>
          <td style="max-width:200px;font-size:12px;color:var(--ink2)">${b.problematique || '–'}</td>
          <td><button class="del-booking-btn" data-id="${b.id}" title="Désinscrire"><i class="ti ti-user-minus"></i></button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  listEl.querySelectorAll('.del-booking-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBooking(btn.dataset.id));
  });
}

function exportCsv() {
  const rows = [['Horaire','Période','Exposant','Prénom','Nom','Email','Société']];
  DATA.bookings.slice().sort((a,b) => a.slotStart.localeCompare(b.slotStart)).forEach(b => {
    const exp = DATA.exposants.find(e => e.id === b.exposantId);
    rows.push([
      `${b.slotStart}–${b.slotEnd}`,
      b.period === 'aprem' ? 'Après-midi' : 'Matin',
      exp?.name || '',
      b.prenom, b.nom, b.email || '', b.societe || ''
    ]);
  });
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'rdv-evenement.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* ── Visiteurs admin ──────────────────────────────────────────── */

function renderVisiteursList() {
  const search  = (el('vis-admin-search')?.value || '').toLowerCase();
  const listEl  = el('visiteurs-list');
  if (!listEl) return;

  // Badge
  const badge = el('vis-badge');
  if (badge) badge.textContent = DATA.visitors.length || '';

  // Construire liste unique par email avec infos du dernier booking
  const visiteurs = DATA.visitors.map(v => {
    const bookings = DATA.bookings.filter(b => (b.email||'').toLowerCase() === v.email).sort((a,b) => a.slotStart.localeCompare(b.slotStart));
    const first    = bookings[0];
    return { ...v, bookings, prenom: first?.prenom||'', nom: first?.nom||'', societe: first?.societe||'' };
  }).filter(v => {
    if (!search) return true;
    return (v.prenom+' '+v.nom+' '+v.email+' '+(v.societe||'')).toLowerCase().includes(search);
  }).sort((a,b) => (a.nom||'').localeCompare(b.nom||''));

  if (!visiteurs.length) {
    listEl.innerHTML = '<div class="empty-state"><i class="ti ti-users"></i><p>Aucun visiteur inscrit pour le moment.</p></div>';
    return;
  }

  listEl.innerHTML = `<table class="rdv-table">
    <thead><tr>
      <th>Visiteur</th>
      <th>Email</th>
      <th>Société</th>
      <th>Code</th>
      <th>RDV</th>
      <th></th>
    </tr></thead>
    <tbody>
    ${visiteurs.map(v => `<tr>
      <td><strong>${v.prenom} ${v.nom}</strong></td>
      <td>${v.email}</td>
      <td>${v.societe || '–'}</td>
      <td>
        <span style="font-family:monospace;font-size:15px;font-weight:700;color:var(--cyan);background:var(--cyan-l);padding:3px 10px;border-radius:6px;letter-spacing:.1em">${v.code}</span>
      </td>
      <td><span style="font-weight:600;color:var(--cyan)">${v.bookings.length}</span></td>
      <td><button class="btn-primary" style="padding:5px 12px;font-size:12px" data-vid="${v.id}">
        <i class="ti ti-eye"></i> Voir
      </button></td>
    </tr>`).join('')}
    </tbody>
  </table>`;

  listEl.querySelectorAll('[data-vid]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = visiteurs.find(x => x.id === btn.dataset.vid);
      if (v) openVisiteurDetail(v);
    });
  });
}

function openVisiteurDetail(v) {
  const detail = el('visiteur-detail');
  if (!detail) return;

  el('vd-title').innerHTML = `<i class="ti ti-user-circle" style="color:var(--cyan);font-size:20px;vertical-align:-3px;margin-right:6px"></i>${v.prenom} ${v.nom}`;

  const rdvsSorted = v.bookings.sort((a,b) => a.slotStart.localeCompare(b.slotStart));

  el('vd-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:1.25rem">
      <div style="background:var(--surf2);border-radius:10px;padding:.9rem">
        <div style="font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem">Informations</div>
        <div style="font-size:13px;color:var(--ink);margin-bottom:3px"><strong>Email :</strong> ${v.email}</div>
        <div style="font-size:13px;color:var(--ink);margin-bottom:3px"><strong>Société :</strong> ${v.societe||'–'}</div>
        <div style="font-size:13px;color:var(--ink)"><strong>RDV confirmés :</strong> ${v.bookings.length}</div>
      </div>
      <div style="background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:10px;padding:.9rem;text-align:center">
        <div style="font-size:11px;font-weight:600;color:var(--cyan-d);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem">Code personnel</div>
        <div style="font-size:36px;font-weight:700;color:var(--cyan);font-family:monospace;letter-spacing:.15em">${v.code}</div>
      </div>
    </div>

    <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:.6rem">Planning du 22 septembre 2026</div>
    ${rdvsSorted.length ? rdvsSorted.map(b => {
      const exp  = DATA.exposants.find(e => e.id === b.exposantId);
      const isPm = b.period === 'aprem';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:${isPm?'#FFFBE6':'var(--cyan-l)'};border:1.5px solid ${isPm?'#FFD82B':'var(--brd2)'};margin-bottom:8px">
        <div style="font-family:monospace;font-size:16px;font-weight:700;color:${isPm?'#B8940A':'var(--cyan)'};min-width:100px">${b.slotStart}–${b.slotEnd}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--ink)">${exp?.name||'–'}</div>
          <div style="font-size:11px;color:var(--ink3)">${exp?.cat||''}${exp?.expertise?' · '+exp.expertise:''}</div>
          ${b.problematique ? `<div style="font-size:11px;color:var(--ink2);margin-top:3px;font-style:italic">"${b.problematique}"</div>` : ''}
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;background:${isPm?'#FFD82B':'var(--cyan)'};color:${isPm?'#5A4A00':'#fff'}">${isPm?'Après-midi':'Matin'}</span>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:var(--ink3);text-align:center;padding:1rem">Aucun RDV pour ce visiteur.</div>'}
  `;

  detail.style.display = 'block';
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  el('vd-close').onclick = () => { detail.style.display = 'none'; };
}

if (IS_ADMIN) {
  el('add-btn').addEventListener('click', toggleForm);
  el('form-cancel').addEventListener('click', toggleForm);
  el('form-submit').addEventListener('click', addExposant);

  document.querySelectorAll('.atab').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
  });
  el('rdv-filter-exp')?.addEventListener('change', renderRdvList);
  el('rdv-filter-period')?.addEventListener('change', renderRdvList);
  el('export-csv')?.addEventListener('click', exportCsv);
  el('vis-admin-search')?.addEventListener('input', renderVisiteursList);

  initLogin();
}

/* ── Onglets visiteur ─────────────────────────────────────────── */

function switchVisitorTab(tab) {
  document.querySelectorAll('.vtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  el('tab-prendre').style.display  = tab === 'prendre'  ? 'block' : 'none';
  el('tab-mesrdvs').style.display  = tab === 'mesrdvs'  ? 'block' : 'none';
}

function searchMesRdvs() {
  const input  = (el('mes-search-input')?.value || '').trim();
  const result = el('mes-result');
  if (!result || !input) {
    if (result) result.innerHTML = '<div class="rdv-empty"><i class="ti ti-id-badge"></i><p>Saisissez votre code ou votre email.</p></div>';
    return;
  }

  const isCode    = /^\d{6}$/.test(input);
  const emailLow  = input.toLowerCase();
  let found, hasCode = false, visitorCode = null;

  if (isCode) {
    // Recherche par code → peut annuler
    const visitor = DATA.visitors.find(v => v.code === input);
    if (!visitor) {
      result.innerHTML = '<div class="rdv-empty"><i class="ti ti-x"></i><p>Code introuvable. Vérifiez votre code ou utilisez votre email.</p></div>';
      return;
    }
    found     = DATA.bookings.filter(b => (b.email||'').toLowerCase() === visitor.email).sort((a,b) => a.slotStart.localeCompare(b.slotStart));
    hasCode   = true;
    visitorCode = input;
  } else {
    // Recherche par email → lecture seule
    found = DATA.bookings.filter(b => (b.email||'').toLowerCase() === emailLow).sort((a,b) => a.slotStart.localeCompare(b.slotStart));
    hasCode = false;
  }

  if (!found.length) {
    result.innerHTML = '<div class="rdv-empty"><i class="ti ti-calendar-off"></i><p>Aucun rendez-vous trouvé.</p></div>';
    return;
  }

  const firstB = found[0];
  result.innerHTML = `
    <div class="mes-rdv-header">
      <div style="font-size:14px;font-weight:600;color:var(--ink)">${firstB.prenom} ${firstB.nom}</div>
      <div style="font-size:13px;color:var(--ink3);margin-top:2px">${found.length} RDV confirmé${found.length>1?'s':''} · 22 septembre 2026</div>
      ${!hasCode ? `<div style="font-size:12px;color:#B8940A;background:#FFF8E6;border:1px solid #FFD82B;border-radius:6px;padding:6px 10px;margin-top:8px">
        <i class="ti ti-lock" style="font-size:12px"></i> Mode lecture seule — saisissez votre code à 6 chiffres pour pouvoir annuler vos RDV.
      </div>` : `<div style="font-size:12px;color:#2E6B12;background:#EAF3DE;border:1px solid #6BAA38;border-radius:6px;padding:6px 10px;margin-top:8px">
        <i class="ti ti-lock-open" style="font-size:12px"></i> Accès complet — vous pouvez annuler vos RDV.
      </div>`}
    </div>` +
    found.map(b => {
      const exp = DATA.exposants.find(e => e.id === b.exposantId);
      const tag = b.period === 'aprem' ? '<span class="tag-pm">Après-midi</span>' : '<span class="tag-am">Matin</span>';
      return `<div class="rdv-card">
        <div class="rdv-card-time">${b.slotStart}<span style="font-size:12px;color:var(--ink3)">–${b.slotEnd}</span></div>
        <div class="rdv-card-info">
          <div class="rdv-card-exp">${exp?.name || '–'}</div>
          <div class="rdv-card-meta">${exp?.cat||''}${exp?.expertise?' · '+exp.expertise:''}</div>
        </div>
        ${tag}
        ${hasCode ? `<button class="cancel-rdv-btn" data-id="${b.id}" data-exp="${exp?.name||''}" data-time="${b.slotStart}"><i class="ti ti-trash"></i> Annuler</button>` : ''}
      </div>`;
    }).join('');

  if (hasCode) {
    result.querySelectorAll('.cancel-rdv-btn').forEach(btn => {
      btn.addEventListener('click', () => cancelVisitorRdv(btn.dataset.id, btn.dataset.exp, btn.dataset.time));
    });
  }
}

async function cancelVisitorRdv(bookingId, expName, slotTime) {
  if (!confirm(`Annuler votre RDV de ${slotTime} avec ${expName} ?`)) return;
  loader(true);
  try {
    await deleteDoc(doc(db, 'bookings', bookingId));
    DATA.bookings = DATA.bookings.filter(b => b.id !== bookingId);
    toast('RDV annulé.');
    searchMesRdvs(); // rafraîchir la liste
    renderGrid();    // rafraîchir les créneaux
  } catch(e) {
    console.error(e);
    toast(`Erreur lors de l'annulation.`);
  }
  loader(false);
}

if (IS_VISITOR) {
  // Page visiteur : charger et afficher
  // Onglets visiteur
  document.querySelectorAll('.vtab').forEach(btn => {
    btn.addEventListener('click', () => switchVisitorTab(btn.dataset.tab));
  });

  // Mes RDV
  el('mes-search-btn')?.addEventListener('click', searchMesRdvs);
  el('mes-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchMesRdvs(); });

  el('vis-search').addEventListener('input', renderGrid);
  el('vis-cat').addEventListener('change', renderGrid);
  el('vis-expertise')?.addEventListener('change', renderGrid);

  document.querySelectorAll('.pf').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pf').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      periodFilter = btn.dataset.p;
      renderGrid();
    });
  });

  el('overlay').addEventListener('click', closeDrawer);
  el('drawer-close').addEventListener('click', closeDrawer);
  el('modal-close').addEventListener('click', closeModal);
  el('modal-cancel').addEventListener('click', closeModal);
  el('modal-confirm').addEventListener('click', confirmBooking);
  el('modal').addEventListener('click', e => { if (e.target === el('modal')) closeModal(); });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

  loadData().then(() => renderGrid());
}
