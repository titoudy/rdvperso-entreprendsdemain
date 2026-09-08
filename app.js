/* v=1780925827 */
/* ── RDV Entreprends Demain · app.js ── */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore,
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc, writeBatch, query, orderBy }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const fbApp = initializeApp({
  apiKey:            'AIzaSyAnQJz8hPP3T4QHWuwD0J6A-xUoBSt5z1w',
  authDomain:        'entreprends-demain.firebaseapp.com',
  projectId:         'entreprends-demain',
  storageBucket:     'entreprends-demain.firebasestorage.app',
  messagingSenderId: '808938356246',
  appId:             '1:808938356246:web:3a7a8ef517be870298bf37',
});

const db = getFirestore(fbApp);

/* ── Mode de la plateforme ────────────────────────────────────── */
// Modes : 'lecture' | 'preinscription' | 'inscription'
let PLATFORM_MODE = 'inscription'; // valeur par défaut, rechargée depuis Firebase

async function loadPlatformMode() {
  try {
    const snap = await getDocs(collection(db, 'config'));
    const cfg = snap.docs.find(d => d.id === 'platform');
    if (cfg) {
      PLATFORM_MODE = cfg.data().mode || 'inscription';
      DATA.config.mode = PLATFORM_MODE;
      DATA.config.lectureDate = cfg.data().lectureDate || '1er juillet 2026';
    } else {
      // Créer le doc config avec valeur par défaut
      await setDoc(doc(db,'config','platform'), { mode: 'inscription', updatedAt: Date.now() });
      PLATFORM_MODE = 'inscription';
    }
  } catch(e) { console.error(e); }
}

async function setPlatformMode(mode) {
  try {
    await setDoc(doc(db, 'config', 'platform'), { mode, updatedAt: Date.now() });
    PLATFORM_MODE = mode;
    DATA.config.mode = mode;
    console.log('Mode saved:', mode);
  } catch(e) { console.error(e); toast('Erreur sauvegarde mode.'); }
}

/* ── Créneaux RDV ─────────────────────────────────────────────── */
function fmt(h, m) { return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
function buildRdvSlots(sh, sm, eh, em) {
  const list = []; let h=sh, m=sm;
  while(h*60+m+20 <= eh*60+em) {
    const start=fmt(h,m); m+=20; if(m>=60){h+=Math.floor(m/60);m%=60;}
    list.push({start, end:fmt(h,m)}); m+=10; if(m>=60){h+=Math.floor(m/60);m%=60;}
  }
  return list;
}
const MATIN_SLOTS = buildRdvSlots(10,0,13,0);
const APREM_SLOTS = buildRdvSlots(14,0,17,0);
function slotsForPeriod(period) {
  const ms = period!=='aprem' ? MATIN_SLOTS.map(s=>({...s,period:'matin'})) : [];
  const ps = period!=='matin' ? APREM_SLOTS.map(s=>({...s,period:'aprem'})) : [];
  return [...ms,...ps];
}

/* ── Créneaux Ateliers ────────────────────────────────────────── */
const ATELIERS_SLOTS = [
  {value:'10:00-10:45', start:'10:00', end:'10:45', period:'matin'},
  {value:'11:00-11:45', start:'11:00', end:'11:45', period:'matin'},
  {value:'12:00-12:45', start:'12:00', end:'12:45', period:'matin'},
  {value:'14:00-14:45', start:'14:00', end:'14:45', period:'aprem'},
  {value:'15:00-15:45', start:'15:00', end:'15:45', period:'aprem'},
  {value:'16:00-16:45', start:'16:00', end:'16:45', period:'aprem'},
];

const ALL_CATS = [
  'Droit immobilier, architecture, aménagement',
  'E-commerce, développement web',
  'Marketing, communication, image',
  'Stratégie et développement commercial',
  'Droit des affaires et des sociétés',
  'Conseil financier, expertise comptable, direction financière',
  'Courtier, banque, assurance',
  "Développement personnel de l'entrepreneur",
  'Accompagnement',
  'Créer son activité',
];

/* ── État ─────────────────────────────────────────────────────── */
const DATA = {
  exposants: [], slots: {}, bookings: [],
  visitors: [], ateliers: [], inscriptions: [],
  waitlist: [], villages: [], planZones: [],
  flashTalks: [], categories: [],
  config: { mode: 'inscription', lectureDate: '1er juillet 2026', planPublic: false },
};
let selId=null, periodFilter='', atPeriodFilter='';
let pendingExp=null, pendingSlot=null, pendingAtelierId=null;
const _submitting = new Set(); // verrou anti-doublon soumission
let editAtelier=null;

function initials(n) { return n.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function getBooking(expId,start) { return DATA.bookings.find(b=>b.exposantId===expId&&b.slotStart===start); }
function getSlots(expId) { return (DATA.slots[expId]||[]).slice().sort((a,b)=>a.start.localeCompare(b.start)); }
function el(id) { return document.getElementById(id); }
function loader(on) { const l=el('loader'); if(l){if(on)l.classList.add('on');else l.classList.remove('on');} }
let toastT;
function toast(msg) {
  const t=el('toast'); if(!t)return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2800);
}

/* ── Chargement Firebase ──────────────────────────────────────── */
async function loadAll() {
  loader(true);
  try {
    const [eS,sS,bS,vS,aS,iS,wS,cS,vlS,pzS,ftS,catS] = await Promise.all([
      getDocs(query(collection(db,'exposants'), orderBy('createdAt'))),
      getDocs(query(collection(db,'slots'),     orderBy('start'))),
      getDocs(query(collection(db,'bookings'),  orderBy('slotStart'))),
      getDocs(collection(db,'visitors')),
      getDocs(query(collection(db,'ateliers'),  orderBy('start'))),
      getDocs(collection(db,'inscriptions')),
      getDocs(query(collection(db,'waitlist'),  orderBy('createdAt'))),
      getDocs(collection(db,'config')),
      getDocs(collection(db,'villages')),
      getDocs(collection(db,'planZones')),
      getDocs(query(collection(db,'flashTalks'), orderBy('start'))),
      getDocs(collection(db,'categories')),
    ]);
    DATA.exposants    = eS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.bookings     = bS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.visitors     = vS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.ateliers     = aS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.inscriptions = iS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.waitlist     = wS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.villages     = vlS.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    DATA.planZones    = pzS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.flashTalks   = ftS.docs.map(d=>({id:d.id,...d.data()}));
    {
      const fromFs = catS.docs.map(d=>({id:d.id,...d.data()}));
      const existingNames = new Set(fromFs.map(c=>(c.name||'').toLowerCase()));
      const missing = ALL_CATS.filter(c=>!existingNames.has(c.toLowerCase())).map((c,i)=>({id:'default-'+i,name:c,order:1000+i}));
      DATA.categories = [...fromFs, ...missing].sort((a,b)=>(a.order||0)-(b.order||0));
    }
    const cfgDoc = cS.docs.find(d=>d.id==='platform') || cS.docs.find(d=>d.id==='siteConfig');
    if(cfgDoc){ const c=cfgDoc.data(); PLATFORM_MODE=c.mode||'inscription'; DATA.config={mode:PLATFORM_MODE,lectureDate:c.lectureDate||'1er juillet 2026',planPublic:c.planPublic||false,ghostMode:c.ghostMode||false,ghostMessage:c.ghostMessage||'',lectureMsg:c.lectureMsg||'',preinscriptionMsg:c.preinscriptionMsg||''}; } else { DATA.config={mode:'inscription',lectureDate:'1er juillet 2026',planPublic:false,ghostMode:false,ghostMessage:'',lectureMsg:'',preinscriptionMsg:''}; }
    DATA.slots = {};
    sS.docs.forEach(d=>{ const s={id:d.id,...d.data()}; if(!DATA.slots[s.exposantId])DATA.slots[s.exposantId]=[]; DATA.slots[s.exposantId].push(s); });
  } catch(e) { console.error(e); toast('Erreur de connexion Firebase.'); }
  loader(false);
}

/* ── Auth admin ───────────────────────────────────────────────── */
const SUPER_ADMIN_EMAIL = 'entreprends.demain@paris-initiative.org';
let currentAdmin = null;

async function logAction(action, details='') {
  if(!currentAdmin) return;
  try {
    await addDoc(collection(db,'logs'), {
      adminEmail: currentAdmin.email,
      adminRole:  currentAdmin.role||'admin',
      action, details,
      timestamp: Date.now(),
      date: new Date().toISOString(),
    });
  } catch(e) { console.error('Log:', e); }
}

async function loadCurrentAdmin(email) {
  const snap = await getDocs(collection(db,'admins'));
  const adminDoc = snap.docs.find(d => d.data().email === email);
  if (adminDoc) {
    const d = adminDoc.data();
    console.log('Admin trouvé:', d.email, 'role:', d.role);
    currentAdmin = { id: adminDoc.id, email, role: (d.role||'admin').toLowerCase(), droits: d.droits || {} };
  } else if (email === SUPER_ADMIN_EMAIL) {
    // Créer le super-admin automatiquement
    const ref = await addDoc(collection(db,'admins'), {
      email, role: 'superadmin',
      droits: { exposants:true, ateliers:true, rdvs:true, visiteurs:true, mode:true, equipe:true, historique:true },
      createdAt: Date.now(), createdBy: 'system'
    });
    currentAdmin = { id: ref.id, email, role: 'superadmin',
      droits: { exposants:true, ateliers:true, rdvs:true, visiteurs:true, mode:true, equipe:true, historique:true }};
  } else {
    return false; // non autorisé
  }
  return true;
}

function applyDroits() {
  if(!currentAdmin) return;
  const isSA = currentAdmin.role?.toLowerCase() === 'superadmin' || currentAdmin.email === SUPER_ADMIN_EMAIL;
  document.querySelectorAll('.atab').forEach(btn => {
    const tab = btn.dataset.tab;
    const allowed = isSA || currentAdmin.droits[tab] !== false;
    btn.style.display = allowed ? '' : 'none';
  });
  const emailEl = el('admin-email-display');
  if(emailEl) emailEl.textContent = currentAdmin.email + (isSA ? ' 👑' : '');
}

const ADMIN_SK = 'rdv-admin-session';

function initLogin() {
  async function doUnlock(email) {
    el('login-screen').style.display='none';
    el('admin-app').style.display='block';
    sessionStorage.setItem(ADMIN_SK, email);
    await loadAll();
    renderAdminExpList(); renderStats(); updateBadges(); renderModeAdmin();
    applyDroits();
    await logAction('CONNEXION');
  }

  // Restaurer session si déjà connecté
  const savedEmail = sessionStorage.getItem(ADMIN_SK);
  if(savedEmail){
    loadCurrentAdmin(savedEmail).then(ok => {
      if(ok) doUnlock(savedEmail);
      else sessionStorage.removeItem(ADMIN_SK);
    });
  }

  el('pwd-btn').addEventListener('click', async () => {
    const email = (el('pwd-email')?.value || '').trim();
    const pwd   = (el('pwd')?.value || '').trim();
    if(!email || !pwd) { el('pwd-error').textContent='Renseignez email et mot de passe.'; el('pwd-error').classList.add('show'); return; }
    try {
      const snap = await getDocs(collection(db,'admins'));
      const adminDoc = snap.docs.find(d => d.data().email === email);
      // Si pas de doc et pas super admin → refusé
      if(!adminDoc && email !== SUPER_ADMIN_EMAIL) {
        el('pwd-error').textContent='Email non autorisé.'; el('pwd-error').classList.add('show'); return;
      }
      // Mot de passe : celui en base, ou Fredtunousmanques pour le super admin sans doc
      const storedPwd = adminDoc?.data().password || (email === SUPER_ADMIN_EMAIL ? 'Fredtunousmanques' : '');
      if(pwd !== storedPwd) {
        el('pwd-error').textContent='Mot de passe incorrect.'; el('pwd-error').classList.add('show');
        el('pwd').value=''; el('pwd').focus(); return;
      }
      const ok = await loadCurrentAdmin(email);
      if(!ok) { el('pwd-error').textContent='Accès refusé.'; el('pwd-error').classList.add('show'); return; }
      await doUnlock(email);
    } catch(e) { console.error(e); el('pwd-error').textContent='Erreur de connexion.'; el('pwd-error').classList.add('show'); }
  });

  el('pwd')?.addEventListener('keydown', e => { if(e.key==='Enter') el('pwd-btn').click(); });
  el('pwd-email')?.addEventListener('keydown', e => { if(e.key==='Enter') el('pwd')?.focus(); });

  el('logout-btn').addEventListener('click', async () => {
    await logAction('DÉCONNEXION');
    currentAdmin = null;
    sessionStorage.removeItem(ADMIN_SK);
    el('admin-app').style.display='none';
    el('login-screen').style.display='flex';
    if(el('pwd')) el('pwd').value='';
    if(el('pwd-email')) el('pwd-email').value='';
    if(el('pwd-error')) el('pwd-error').classList.remove('show');
  });
}

function updateBadges() {
  const rb=el('rdv-badge'); if(rb)rb.textContent=DATA.bookings.length||'';
  const ab=el('at-badge');  if(ab)ab.textContent=DATA.ateliers.length||'';
  const vb=el('vis-badge'); if(vb)vb.textContent=DATA.visitors.length||'';
  updateWaitBadges();
}

/* ── Stats sidebar ────────────────────────────────────────────── */
function renderStats() {
  const e=el('stats'); if(!e)return;
  const total=Object.values(DATA.slots).flat().filter(s=>s.enabled).length;
  e.innerHTML=
    `<div class="stat"><div class="stat-v">${DATA.exposants.length}</div><div class="stat-l">Experts</div></div>`+
    `<div class="stat"><div class="stat-v">${total}</div><div class="stat-l">Créneaux</div></div>`+
    `<div class="stat"><div class="stat-v">${DATA.bookings.length}</div><div class="stat-l">RDV</div></div>`;
}

/* ── Admin tabs ───────────────────────────────────────────────── */

/* ── Listes d'attente admin ──────────────────────────────────── */

function updateWaitBadges() {
  const rdvWaits = DATA.waitlist.filter(w=>w.expId&&!w.atelierId).length;
  const atWaits  = DATA.waitlist.filter(w=>w.atelierId&&!w.expId).length;
  const wb1=el('wrdv-badge'); if(wb1)wb1.textContent=rdvWaits||'';
  const wb2=el('wat-badge');  if(wb2)wb2.textContent=atWaits||'';
}

async function renderWaitlistRdvs() {
  const listEl=el('waitlist-rdvs-list'); if(!listEl)return;
  try{const wS=await getDocs(query(collection(db,'waitlist'),orderBy('createdAt')));DATA.waitlist=wS.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error(e);}
  updateWaitBadges();
  const waits=DATA.waitlist.filter(w=>w.expId&&!w.atelierId).sort((a,b)=>a.createdAt-b.createdAt);
  if(!waits.length){
    listEl.innerHTML=`<div class="empty-state"><i class="ti ti-clock" style="color:#B85C1A"></i><p>Aucune liste d'attente pour les RDV.</p></div>`;
    return;
  }
  const groups={};
  waits.forEach(w=>{
    const key=w.expId+'__'+w.slotStart;
    if(!groups[key])groups[key]={expId:w.expId,slotStart:w.slotStart,slotEnd:w.slotEnd,period:w.period,list:[]};
    groups[key].list.push(w);
  });
  listEl.innerHTML=Object.values(groups).map(g=>{
    const exp=DATA.exposants.find(e=>e.id===g.expId);
    const isPm=g.period==='aprem';
    return`<div style="background:#fff;border:1.5px solid #F0C8A0;border-radius:var(--rl);margin-bottom:1rem;overflow:hidden">
      <div style="background:#FEF3EB;padding:.9rem 1.1rem;display:flex;align-items:center;gap:12px;border-bottom:1px solid #F0C8A0">
        <div style="font-family:monospace;font-size:16px;font-weight:700;color:#B85C1A;min-width:110px">${g.slotStart}–${g.slotEnd}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--ink)">${exp?.name||'–'}</div>
          <div style="font-size:12px;color:var(--ink3)">${exp?.cat||''}${exp?.expertise?' · '+exp.expertise:''}</div>
        </div>
        <span style="font-size:11px;padding:3px 10px;border-radius:100px;font-weight:700;background:${isPm?'#FFD82B':'var(--cyan)'};color:${isPm?'var(--ink)':'#fff'}">${isPm?'Ap-m':'Matin'}</span>
        <span style="font-size:12px;font-weight:700;color:#B85C1A;background:#FEE0C8;padding:3px 10px;border-radius:100px">${g.list.length} en attente</span>
      </div>
      <table class="rdv-table" style="border:none;border-radius:0">
        <thead><tr>
          <th style="background:#FEF3EB;color:#B85C1A">#</th>
          <th style="background:#FEF3EB;color:#B85C1A">Visiteur</th>
          <th style="background:#FEF3EB;color:#B85C1A">Email</th>
          <th style="background:#FEF3EB;color:#B85C1A">Société</th>
          <th style="background:#FEF3EB;color:#B85C1A">Problématique</th>
          <th style="background:#FEF3EB;color:#B85C1A">Inscrit le</th>
          <th style="background:#FEF3EB;color:#B85C1A"></th>
        </tr></thead>
        <tbody>${g.list.map((w,i)=>`<tr>
          <td><strong style="color:#B85C1A">#${i+1}</strong></td>
          <td><strong>${w.prenom} ${w.nom}</strong></td>
          <td>${w.email||'–'}</td>
          <td>${w.societe||'–'}</td>
          <td style="font-size:12px;max-width:180px">${w.problematique||'–'}</td>
          <td style="font-size:11px;color:var(--ink3)">${w.createdAt?new Date(w.createdAt).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–'}</td>
          <td><button class="del-booking-btn" data-wid="${w.id}" title="Retirer"><i class="ti ti-trash"></i></button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
  listEl.querySelectorAll('[data-wid]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!confirm(`Retirer ce visiteur de la liste d'attente ?`))return;
    loader(true);
    try{await deleteDoc(doc(db,'waitlist',btn.dataset.wid));DATA.waitlist=DATA.waitlist.filter(w=>w.id!==btn.dataset.wid);renderWaitlistRdvs();updateWaitBadges();}
    catch(e){console.error(e);toast('Erreur.');}
    loader(false);
  }));
}

async function renderWaitlistAteliers() {
  const listEl=el('waitlist-ateliers-list'); if(!listEl)return;
  try{const wS=await getDocs(query(collection(db,'waitlist'),orderBy('createdAt')));DATA.waitlist=wS.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error(e);}
  updateWaitBadges();
  const waits=DATA.waitlist.filter(w=>w.atelierId&&!w.expId).sort((a,b)=>a.createdAt-b.createdAt);
  if(!waits.length){
    listEl.innerHTML=`<div class="empty-state"><i class="ti ti-clock" style="color:#B85C1A"></i><p>Aucune liste d'attente pour les ateliers.</p></div>`;
    return;
  }
  const groups={};
  waits.forEach(w=>{
    if(!groups[w.atelierId])groups[w.atelierId]={atelierId:w.atelierId,list:[]};
    groups[w.atelierId].list.push(w);
  });
  listEl.innerHTML=Object.values(groups).map(g=>{
    const at=DATA.ateliers.find(a=>a.id===g.atelierId);
    const isPm=at?.period==='aprem';
    const inscrits=DATA.inscriptions.filter(i=>i.atelierId===g.atelierId).length;
    return`<div style="background:#fff;border:1.5px solid #F0C8A0;border-radius:var(--rl);margin-bottom:1rem;overflow:hidden">
      <div style="background:#FEF3EB;padding:.9rem 1.1rem;display:flex;align-items:center;gap:12px;border-bottom:1px solid #F0C8A0">
        <div style="font-family:monospace;font-size:16px;font-weight:700;color:#B85C1A;min-width:110px">${at?.start||'–'}–${at?.end||''}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--ink)">${at?.titre||'–'}</div>
          <div style="font-size:12px;color:var(--ink3)"><i class="ti ti-map-pin" style="font-size:11px"></i> ${at?.salle||''} · ${inscrits}/${at?.places||'∞'} inscrits</div>
        </div>
        <span style="font-size:11px;padding:3px 10px;border-radius:100px;font-weight:700;background:${isPm?'#FFD82B':'var(--cyan)'};color:${isPm?'var(--ink)':'#fff'}">${isPm?'Ap-m':'Matin'}</span>
        <span style="font-size:12px;font-weight:700;color:#B85C1A;background:#FEE0C8;padding:3px 10px;border-radius:100px">${g.list.length} en attente</span>
      </div>
      <table class="rdv-table" style="border:none;border-radius:0">
        <thead><tr>
          <th style="background:#FEF3EB;color:#B85C1A">#</th>
          <th style="background:#FEF3EB;color:#B85C1A">Visiteur</th>
          <th style="background:#FEF3EB;color:#B85C1A">Email</th>
          <th style="background:#FEF3EB;color:#B85C1A">Société</th>
          <th style="background:#FEF3EB;color:#B85C1A">Inscrit le</th>
          <th style="background:#FEF3EB;color:#B85C1A"></th>
        </tr></thead>
        <tbody>${g.list.map((w,i)=>`<tr>
          <td><strong style="color:#B85C1A">#${i+1}</strong></td>
          <td><strong>${w.prenom} ${w.nom}</strong></td>
          <td>${w.email||'–'}</td>
          <td>${w.societe||'–'}</td>
          <td style="font-size:11px;color:var(--ink3)">${w.createdAt?new Date(w.createdAt).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–'}</td>
          <td><button class="del-booking-btn" data-wid="${w.id}" title="Retirer"><i class="ti ti-trash"></i></button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
  listEl.querySelectorAll('[data-wid]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!confirm(`Retirer ce visiteur de la liste d'attente ?`))return;
    loader(true);
    try{await deleteDoc(doc(db,'waitlist',btn.dataset.wid));DATA.waitlist=DATA.waitlist.filter(w=>w.id!==btn.dataset.wid);renderWaitlistAteliers();updateWaitBadges();}
    catch(e){console.error(e);toast('Erreur.');}
    loader(false);
  }));
}

function switchAdminTab(tab) {
  document.querySelectorAll('.atab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  ['exposants','ateliers-admin','flashtalks-admin','rdvs','visiteurs','waitlist-rdvs','waitlist-ateliers','parametres','equipe','historique','plan','retroplanning'].forEach(t=>{
    const el2=el('tab-'+t); if(el2)el2.style.display=t===tab?(t==='exposants'?'flex':'block'):'none';
  });
  loadAll().then(()=>{
    updateBadges(); renderStats();
    if(tab==='exposants')        renderAdminExpList();
    if(tab==='rdvs')             renderRdvList();
    if(tab==='visiteurs')        renderVisiteursList();
    if(tab==='ateliers-admin')   renderAteliersAdmin();
    if(tab==='flashtalks-admin') renderFlashTalksAdmin();
    if(tab==='waitlist-rdvs')    renderWaitlistRdvs();
    if(tab==='waitlist-ateliers')renderWaitlistAteliers();
    if(tab==='parametres')       { initParametres(); renderModeAdmin(); }
    if(tab==='equipe')           renderEquipe();
    if(tab==='historique')       renderHistorique();
    if(tab==='plan')             renderPlan();
    if(tab==='retroplanning')    renderRetroPlanning();
  });
}

/* ── Admin exposants ──────────────────────────────────────────── */
function renderAdminExpList() {
  const listEl=el('exp-list'); if(!listEl)return;
  if(!DATA.exposants.length){listEl.innerHTML='<div style="padding:1rem;font-size:12px;color:var(--ink3);text-align:center">Aucun exposant. Cliquez + pour ajouter.</div>';return;}
  listEl.innerHTML=DATA.exposants.map(exp=>`
    <div class="exp-item${selId===exp.id?' active':''}" data-id="${exp.id}">
      <div class="avatar" style="font-size:12px">${initials(exp.name)}</div>
      <div style="flex:1"><div class="ei-name">${exp.name}</div><div class="ei-cat">${exp.cat||''}</div></div>
      <button class="edit-exp-btn" data-id="${exp.id}" title="Modifier"><i class="ti ti-pencil" style="font-size:13px"></i></button>
      <button class="del-exp-btn"  data-id="${exp.id}" title="Supprimer"><i class="ti ti-trash"  style="font-size:13px"></i></button>
    </div>`).join('');
  listEl.querySelectorAll('.exp-item').forEach(item=>{
    item.addEventListener('click',e=>{
      if(e.target.closest('.del-exp-btn')||e.target.closest('.edit-exp-btn'))return;
      selId=item.dataset.id; renderAdminExpList();
      el('cal-empty').style.display='none'; el('cal-panel').style.display='block'; el('edit-panel').style.display='none';
      renderCal();
    });
  });
  listEl.querySelectorAll('.del-exp-btn').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();deleteExposant(btn.dataset.id);}));
  listEl.querySelectorAll('.edit-exp-btn').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();openEditPanel(btn.dataset.id);}));
}

function toggleAddForm(){ el('add-form').classList.toggle('open'); }

async function addExposant() {
  const name=el('f-name').value.trim(), email=el('f-email').value.trim(),
    website=el('f-website')?.value.trim()||'', cat=el('f-cat').value,
    expertise=el('f-expertise').value.trim(), period=el('f-period').value,
    stand=el('f-stand')?.value||'jour';
  if(!name){toast('Merci de saisir un nom.');return;}
  loader(true);
  try {
    const ref=await addDoc(collection(db,'exposants'),{name,email,website,cat,expertise,period,stand,createdAt:Date.now()});
    const exp={id:ref.id,name,email,website,cat,expertise,period,stand};
    DATA.exposants.push(exp);
    const created=[];
    if(period!=='aucun') for(const s of slotsForPeriod(period)){
      const r=await addDoc(collection(db,'slots'),{exposantId:exp.id,start:s.start,end:s.end,period:s.period,enabled:true});
      created.push({id:r.id,exposantId:exp.id,...s,enabled:true});
    }
    if(period==='aucun'){} // pas de slots
    DATA.slots[exp.id]=created;
    ['f-name','f-email','f-website','f-expertise'].forEach(id=>{if(el(id))el(id).value='';});
    toggleAddForm(); renderAdminExpList(); renderStats();
    toast(name+' ajouté !');
  } catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteExposant(expId) {
  if(!confirm('Supprimer cet exposant et tous ses RDV ?'))return;
  loader(true);
  try {
    const batch=writeBatch(db);
    (DATA.slots[expId]||[]).forEach(s=>batch.delete(doc(db,'slots',s.id)));
    DATA.bookings.filter(b=>b.exposantId===expId).forEach(b=>batch.delete(doc(db,'bookings',b.id)));
    batch.delete(doc(db,'exposants',expId));
    await batch.commit();
    DATA.exposants=DATA.exposants.filter(e=>e.id!==expId);
    DATA.bookings=DATA.bookings.filter(b=>b.exposantId!==expId);
    delete DATA.slots[expId];
    if(selId===expId){selId=null;el('cal-empty').style.display='block';el('cal-panel').style.display='none';}
    renderAdminExpList();renderStats();toast('Exposant supprimé.');
  } catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

function openEditPanel(expId) {
  const exp=DATA.exposants.find(e=>e.id===expId); if(!exp)return;
  selId=expId; renderAdminExpList();
  el('cal-panel').style.display='none'; el('cal-empty').style.display='none'; el('edit-panel').style.display='block';
  el('edit-panel').innerHTML=`<div class="edit-panel-inner">
    <div class="edit-panel-title"><i class="ti ti-pencil"></i> Modifier — ${exp.name}</div>
    <div class="edit-form">
      <div class="field"><label>Nom</label><input id="e-name" value="${exp.name||''}" /></div>
      <div class="field"><label>Email</label><input id="e-email" type="email" value="${exp.email||''}" /></div>
      <div class="field"><label>Site internet</label><input id="e-website" value="${exp.website||''}" placeholder="https://..." /></div>
      <div class="field"><label>Catégorie</label><select id="e-cat">${(DATA.categories.length?DATA.categories.map(c=>c.name):ALL_CATS).map(c=>`<option value="${c}"${exp.cat===c?' selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Expertise</label><input id="e-expertise" value="${exp.expertise||''}" /></div>
      <div class="field"><label>Disponibilité RDV</label><select id="e-period">
        <option value="jour"${exp.period==='jour'?' selected':''}>Journée complète</option>
        <option value="matin"${exp.period==='matin'?' selected':''}>Matin uniquement</option>
        <option value="aprem"${exp.period==='aprem'?' selected':''}>Après-midi uniquement</option>
        <option value="aucun"${exp.period==='aucun'?' selected':''}>Pas de RDV</option>
      </select></div>
      <div class="field"><label>Stand</label><select id="e-stand">
        <option value="jour"${(exp.stand||'jour')==='jour'?' selected':''}>Toute la journée</option>
        <option value="matin"${exp.stand==='matin'?' selected':''}>Matin uniquement</option>
        <option value="aprem"${exp.stand==='aprem'?' selected':''}>Après-midi uniquement</option>
      </select></div>
      <div class="edit-actions">
        <button id="edit-cancel" class="btn-ghost"><i class="ti ti-x"></i> Annuler</button>
        <button id="edit-save" class="btn-primary"><i class="ti ti-check"></i> Enregistrer</button>
      </div>
    </div></div>`;
  el('edit-cancel').addEventListener('click',()=>{el('edit-panel').style.display='none';el('cal-empty').style.display='block';});
  el('edit-save').addEventListener('click',()=>saveEditExposant(expId));
}

async function saveEditExposant(expId) {
  const exp=DATA.exposants.find(e=>e.id===expId);
  const name=el('e-name').value.trim(), email=el('e-email').value.trim(),
    website=el('e-website')?.value.trim()||'', cat=el('e-cat').value,
    expertise=el('e-expertise').value.trim(), period=el('e-period').value,
    stand=el('e-stand')?.value||'jour';
  if(!name){toast('Merci de saisir un nom.');return;}
  loader(true);
  try {
    const changed=period!==exp.period;
    await updateDoc(doc(db,'exposants',expId),{name,email,website,cat,expertise,period,stand});
    Object.assign(exp,{name,email,website,cat,expertise,period,stand});
    if(changed){
      const batch=writeBatch(db);
      (DATA.slots[expId]||[]).forEach(s=>batch.delete(doc(db,'slots',s.id)));
      await batch.commit();
      const created=[];
      for(const s of slotsForPeriod(period)){
        const r=await addDoc(collection(db,'slots'),{exposantId:expId,start:s.start,end:s.end,period:s.period,enabled:true});
        created.push({id:r.id,exposantId:expId,...s,enabled:true});
      }
      DATA.slots[expId]=created;
    }
    el('edit-panel').style.display='none';el('cal-empty').style.display='block';
    renderAdminExpList();renderStats();toast(name+' mis à jour !');
  } catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Calendrier admin ─────────────────────────────────────────── */
function renderCal() {
  const exp=DATA.exposants.find(e=>e.id===selId); if(!exp)return;
  el('cal-name').textContent=exp.name;
  el('cal-meta').textContent=exp.cat+(exp.expertise?' · '+exp.expertise:'')+'  · 22 sept. 2026';
  const opts=[{val:'matin',label:'Matin',cls:'active-matin'},{val:'aprem',label:'Après-midi',cls:'active-aprem'},{val:'jour',label:'Journée',cls:'active-jour'}];
  el('cal-periods').innerHTML=opts.map(o=>`<button class="psw${exp.period===o.val?' '+o.cls:''}" data-p="${o.val}">${o.label}</button>`).join('');
  el('cal-periods').querySelectorAll('.psw').forEach(b=>b.addEventListener('click',()=>setPeriod(b.dataset.p)));
  const slots=getSlots(exp.id), ms=slots.filter(s=>s.period==='matin'), ps=slots.filter(s=>s.period==='aprem');
  const block = (list,cls) => {
    if(!list.length)return '';
    const free=list.filter(s=>s.enabled&&!getBooking(exp.id,s.start)).length;
    const head=cls==='am'?'Matin · 10h–13h':'Après-midi · 14h–17h';
    const btns=list.map(s=>{
      const b=getBooking(exp.id,s.start); let c,icon='';
      if(b){c='aslot aslot-booked'+(cls==='pm'?' pm':'');icon='<i class="ti ti-user" style="font-size:10px"></i> ';}
      else if(s.enabled){c='aslot aslot-on-'+cls;}
      else{c='aslot aslot-off';icon='<i class="ti ti-minus" style="font-size:10px"></i> ';}
      const label=b?`${icon}${b.prenom} ${b.nom}`:`${icon}${s.start}–${s.end}`;
      return`<button class="${c}" data-sid="${s.id}" data-start="${s.start}" data-bid="${b?b.id:''}" title="${b?b.prenom+' '+b.nom+(b.email?' · '+b.email:''):(s.enabled?'Désactiver':'Activer')}">${label}</button>`;
    }).join('');
    return`<div class="cal-block"><div class="cal-block-head ${cls}">${head}<span class="hcount">${free} libre${free>1?'s':''}</span></div><div class="cal-slots">${btns}</div></div>`;
  }
  el('cal-body').innerHTML=block(ms,'am')+block(ps,'pm')||'<div style="padding:1rem;font-size:13px;color:var(--ink3)">Aucun créneau.</div>';
  el('cal-body').querySelectorAll('.aslot').forEach(btn=>{
    btn.addEventListener('click',()=>{if(btn.dataset.bid)deleteBooking(btn.dataset.bid);else toggleSlot(btn.dataset.sid,btn.dataset.start);});
  });
}

async function toggleSlot(slotId,start){
  const slot=(DATA.slots[selId]||[]).find(s=>s.id===slotId);
  if(!slot||getBooking(selId,start))return;
  const next=!slot.enabled; slot.enabled=next; renderCal();renderStats();
  try{await updateDoc(doc(db,'slots',slotId),{enabled:next});}
  catch(e){slot.enabled=!next;renderCal();toast('Erreur.');}
}

async function setPeriod(period){
  const exp=DATA.exposants.find(e=>e.id===selId); if(!exp)return;
  loader(true);
  try{
    await updateDoc(doc(db,'exposants',exp.id),{period});exp.period=period;
    const batch=writeBatch(db);(DATA.slots[exp.id]||[]).forEach(s=>batch.delete(doc(db,'slots',s.id)));await batch.commit();
    const created=[];
    if(period!=='aucun') for(const s of slotsForPeriod(period)){
      const r=await addDoc(collection(db,'slots'),{exposantId:exp.id,start:s.start,end:s.end,period:s.period,enabled:true});
      created.push({id:r.id,exposantId:exp.id,...s,enabled:true});
    }
    if(period==='aucun'){} // pas de slots
    DATA.slots[exp.id]=created; renderCal();renderStats();toast('Disponibilité mise à jour');
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteBooking(bookingId){
  if(!confirm(`Supprimer ce RDV et promouvoir le premier en liste d'attente si applicable ?`))return;
  loader(true);
  try{
    const item=DATA.bookings.find(b=>b.id===bookingId);
    await deleteDoc(doc(db,'bookings',bookingId));
    DATA.bookings=DATA.bookings.filter(b=>b.id!==bookingId);
    // Supprimer aussi les entrées de liste d'attente liées à ce visiteur pour ce créneau ? Non — on promeut
    if(item) await promoteWaitlistRdv(item.exposantId, item.slotStart);
    renderCal();renderRdvList();renderStats();updateWaitBadges();
    toast('RDV supprimé.');
  }
  catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Admin RDV list ───────────────────────────────────────────── */
function renderRdvList(){
  const expF=el('rdv-filter-exp')?.value||'', perF=el('rdv-filter-period')?.value||'';
  const expSel=el('rdv-filter-exp');
  if(expSel){const cur=expSel.value;expSel.innerHTML='<option value="">Tous les exposants</option>'+DATA.exposants.map(e=>`<option value="${e.id}"${e.id===cur?' selected':''}>${e.name}</option>`).join('');}
  const rb=el('rdv-badge');if(rb)rb.textContent=DATA.bookings.length||'';
  let list=[...DATA.bookings].sort((a,b)=>a.slotStart.localeCompare(b.slotStart));
  if(expF)list=list.filter(b=>b.exposantId===expF);
  if(perF)list=list.filter(b=>b.period===perF);
  const listEl=el('rdv-list');if(!listEl)return;
  if(!list.length){listEl.innerHTML='<div class="empty-state"><i class="ti ti-calendar-off"></i><p>Aucun RDV.</p></div>';return;}
  listEl.innerHTML=`<table class="rdv-table"><thead><tr><th>Horaire</th><th>Période</th><th>Exposant</th><th>Visiteur</th><th>Email</th><th>Société</th><th>Problématique</th><th></th></tr></thead><tbody>
  ${list.map(b=>{const exp=DATA.exposants.find(e=>e.id===b.exposantId);const pm=b.period==='aprem';
    return`<tr><td><strong>${b.slotStart}–${b.slotEnd}</strong></td><td><span class="${pm?'tag-pm':'tag-am'}">${pm?'Ap-m':'Matin'}</span></td><td>${exp?.name||'–'}</td><td>${b.prenom} ${b.nom}</td><td>${b.email||'–'}</td><td>${b.societe||'–'}</td><td style="font-size:12px;max-width:160px">${b.problematique||'–'}</td><td><button class="del-booking-btn" data-id="${b.id}"><i class="ti ti-user-minus"></i></button></td></tr>`;
  }).join('')}</tbody></table>`;
  listEl.querySelectorAll('.del-booking-btn').forEach(btn=>btn.addEventListener('click',()=>deleteBooking(btn.dataset.id)));
}

function exportCsv(){
  const rows=[['Horaire','Période','Exposant','Prénom','Nom','Email','Société','Problématique']];
  DATA.bookings.forEach(b=>{const exp=DATA.exposants.find(e=>e.id===b.exposantId);rows.push([`${b.slotStart}–${b.slotEnd}`,b.period==='aprem'?'Après-midi':'Matin',exp?.name||'',b.prenom,b.nom,b.email||'',b.societe||'',b.problematique||'']);});
  const csv=rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='rdv.csv';a.click();
}

/* ── Ateliers admin ───────────────────────────────────────────── */
function renderAteliersAdmin(){
  // Populate animateurs checkboxes
  const animDiv=el('at-animateurs-check');
  if(animDiv)animDiv.innerHTML=DATA.exposants.map(exp=>`<label class="cat-check"><input type="checkbox" value="${exp.id}" /> ${exp.name}</label>`).join('');
  const ab=el('at-badge');if(ab)ab.textContent=DATA.ateliers.length||'';
  renderAteliersAdminList();
}

function renderAteliersAdminList(){
  const listEl=el('ateliers-admin-list');if(!listEl)return;
  if(!DATA.ateliers.length){listEl.innerHTML='<div class="empty-state"><i class="ti ti-school"></i><p>Aucun atelier. Créez-en un.</p></div>';return;}
  const sorted=[...DATA.ateliers].sort((a,b)=>a.start.localeCompare(b.start));
  listEl.innerHTML=sorted.map(at=>{
    const inscrits=DATA.inscriptions.filter(i=>i.atelierId===at.id).length;
    const animNames=(at.animateurs||[]).map(id=>DATA.exposants.find(e=>e.id===id)?.name||'').filter(Boolean).join(', ');
    const full=at.places&&inscrits>=at.places;
    const cats=(at.categories||[]).map(c=>`<span class="at-cat-tag">${c.split(',')[0].trim()}</span>`).join(' ');
    return`<div class="atelier-card">
      <div class="at-header">
        <div class="at-time-badge${at.start>='14:00'?' pm':''}">${at.start}–${at.end}</div>
        <div style="flex:1">
          <div class="at-title">${at.titre}</div>
          <div class="at-salle"><i class="ti ti-map-pin" style="font-size:11px"></i> ${at.salle}</div>
        </div>
        <button class="edit-exp-btn" data-atid="${at.id}" title="Modifier"><i class="ti ti-pencil" style="font-size:13px"></i></button>
        <button class="del-exp-btn"  data-atid="${at.id}" title="Supprimer"><i class="ti ti-trash"  style="font-size:13px"></i></button>
      </div>
      ${at.description?`<div class="at-desc">${at.description}</div>`:''}
      ${animNames?`<div class="at-animateurs"><i class="ti ti-user-star" style="font-size:12px"></i> ${animNames}</div>`:''}
      <div class="at-cats">${cats}</div>
      <div class="at-footer">
        <div class="at-places${full?' full':''}">
          <strong>${inscrits}</strong> / ${at.places||'∞'} inscrits${full?' · COMPLET':''}
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-ghost" style="padding:4px 10px;font-size:12px" data-atid-view="${at.id}"><i class="ti ti-users"></i> Inscrits</button>
        </div>
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('[data-atid-view]').forEach(btn=>btn.addEventListener('click',()=>showAtelierInscrits(btn.dataset.atidView)));
  listEl.querySelectorAll('.edit-exp-btn[data-atid]').forEach(btn=>btn.addEventListener('click',()=>openAtelierForm(btn.dataset.atid)));
  listEl.querySelectorAll('.del-exp-btn[data-atid]').forEach(btn=>btn.addEventListener('click',()=>deleteAtelier(btn.dataset.atid)));
  listEl.querySelectorAll('.edit-exp-btn[data-atid]').forEach(btn=>btn.addEventListener('click',()=>openAtelierForm(btn.dataset.atid)));
}

function showAtelierInscrits(atId){
  const at=DATA.ateliers.find(a=>a.id===atId);if(!at)return;
  const ins=DATA.inscriptions.filter(i=>i.atelierId===atId);

  // Créer une modal d'affichage
  const existing=document.getElementById('inscrits-modal');
  if(existing)existing.remove();

  const overlay=document.createElement('div');
  overlay.id='inscrits-modal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';

  const rows = ins.length
    ? ins.map((i,idx)=>`<tr>
        <td>${idx+1}</td>
        <td><strong>${i.prenom} ${i.nom}</strong></td>
        <td>${i.email||'–'}</td>
        <td>${i.societe||'–'}</td>
        <td><button class="del-booking-btn del-inscrit-btn" data-iid="${i.id}" data-atid="${atId}" title="Supprimer"><i class="ti ti-user-minus"></i></button></td>
      </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:var(--ink3);padding:1rem">Aucun inscrit</td></tr>`;

  overlay.innerHTML=`<div style="background:#fff;border-radius:16px;width:100%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;border:2px solid var(--brd2);overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.25rem;background:var(--cyan-l);border-bottom:1.5px solid var(--brd2)">
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--ink)">${at.titre}</div>
        <div style="font-size:12px;color:var(--ink3)">${at.start}–${at.end} · ${at.salle} · ${ins.length}/${at.places||'∞'} inscrits</div>
      </div>
      <button onclick="document.getElementById('inscrits-modal').remove()" class="icon-btn"><i class="ti ti-x"></i></button>
    </div>
    <div style="overflow-y:auto;flex:1;padding:1rem">
      <table class="rdv-table">
        <thead><tr><th>#</th><th>Visiteur</th><th>Email</th><th>Société</th><th></th></tr></thead>
        <tbody id="inscrits-tbody">${rows}</tbody>
      </table>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  // Brancher les boutons supprimer
  overlay.querySelectorAll('.del-inscrit-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!confirm('Supprimer cette inscription ?'))return;
      loader(true);
      try{
        const iid=btn.dataset.iid, aid=btn.dataset.atid;
        await deleteDoc(doc(db,'inscriptions',iid));
        DATA.inscriptions=DATA.inscriptions.filter(i=>i.id!==iid);
        // Promouvoir le 1er en liste d'attente
        await promoteWaitlistAtelier(aid);
        toast('Inscription supprimée.');
        overlay.remove();
        renderAteliersAdmin();
        renderWaitlistAteliers();
        updateWaitBadges();
      }catch(e){console.error(e);toast('Erreur.');}
      loader(false);
    });
  });
}

function openAtelierForm(atId=null){
  const form=el('atelier-form');
  form.classList.add('open');
  editAtelier=atId;
  if(atId){
    const at=DATA.ateliers.find(a=>a.id===atId);if(!at)return;
    el('at-titre').value=at.titre||'';el('at-salle').value=at.salle||'';
    el('at-desc').value=at.description||'';
    if(el('at-start'))el('at-start').value=at.start||'';
    if(el('at-end'))el('at-end').value=at.end||'';
    if(el('at-period'))el('at-period').value=at.period||'matin';
    el('at-places').value=at.places||'';
    form.querySelectorAll('#at-cats-check input[type=checkbox]').forEach(cb=>{cb.checked=(at.categories||[]).includes(cb.value);});
    form.querySelectorAll('#at-animateurs-check input[type=checkbox]').forEach(cb=>{cb.checked=(at.animateurs||[]).includes(cb.value);});
  } else {
    el('at-titre').value='';el('at-salle').value='';el('at-desc').value='';el('at-places').value='';
    if(el('at-start'))el('at-start').value='';
    if(el('at-end'))el('at-end').value='';
    if(el('at-period'))el('at-period').value='matin';
    form.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.checked=false);
  }
  form.scrollIntoView({behavior:'smooth',block:'start'});
}

async function saveAtelier(){
  const titre=el('at-titre').value.trim(),salle=el('at-salle').value.trim();
  const start=el('at-start').value,end=el('at-end').value,period=el('at-period')?.value||'matin';
  const places=parseInt(el('at-places').value)||0;
  if(!titre||!salle||!start||!end){toast('Merci de remplir titre, salle, heure de début et de fin.');return;}
  if(start>=end){toast('L\'heure de fin doit être après l\'heure de début.');return;}
  const categories=[...document.querySelectorAll('#at-cats-check input:checked')].map(c=>c.value);
  const animateurs=[...document.querySelectorAll('#at-animateurs-check input:checked')].map(c=>c.value);
  const description=el('at-desc').value.trim();
  const value=`${start}-${end}`;
  const data={titre,salle,description,start,end,period,value,places,categories,animateurs,createdAt:Date.now()};
  loader(true);
  try{
    if(editAtelier){
      await updateDoc(doc(db,'ateliers',editAtelier),data);
      const idx=DATA.ateliers.findIndex(a=>a.id===editAtelier);
      if(idx>=0)DATA.ateliers[idx]={id:editAtelier,...data};
      toast('Atelier mis à jour !');
    } else {
      const ref=await addDoc(collection(db,'ateliers'),data);
      DATA.ateliers.push({id:ref.id,...data});
      toast('Atelier créé !');
    }
    el('atelier-form').classList.remove('open');editAtelier=null;
    renderAteliersAdminList();updateBadges();
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteAtelier(atId){
  if(!confirm('Supprimer cet atelier et toutes ses inscriptions ?'))return;
  loader(true);
  try{
    const batch=writeBatch(db);
    DATA.inscriptions.filter(i=>i.atelierId===atId).forEach(i=>batch.delete(doc(db,'inscriptions',i.id)));
    batch.delete(doc(db,'ateliers',atId));await batch.commit();
    DATA.ateliers=DATA.ateliers.filter(a=>a.id!==atId);
    DATA.inscriptions=DATA.inscriptions.filter(i=>i.atelierId!==atId);
    renderAteliersAdminList();updateBadges();toast('Atelier supprimé.');
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Flash Talks (admin) ─────────────────────────────────────────── */
let editFlashTalk=null;

function renderFlashTalksAdmin(){
  renderFlashTalksAdminList();
  const ftb=el('ft-badge');if(ftb)ftb.textContent=DATA.flashTalks.length||'';
}

function renderFlashTalksAdminList(){
  const listEl=el('flashtalks-admin-list');if(!listEl)return;
  if(!DATA.flashTalks.length){listEl.innerHTML='<div class="empty-state"><i class="ti ti-bolt"></i><p>Aucun flash talk. Créez-en un.</p></div>';return;}
  const sorted=[...DATA.flashTalks].sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  listEl.innerHTML=sorted.map(ft=>`
    <div class="atelier-admin-item" style="border-left:4px solid #B8940A">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="background:#FFF8E6;color:#B8940A;border:1px solid #FFD82B;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700">${ft.start||'–'}${ft.end?'–'+ft.end:''}</span>
          <strong style="font-size:14px">${ft.sujet||'–'}</strong>
        </div>
        <div style="font-size:12px;color:var(--ink3)">
          ${ft.thematique?`<i class="ti ti-tag" style="font-size:11px"></i> ${ft.thematique} · `:''}
          <i class="ti ti-user-star" style="font-size:11px"></i> ${ft.intervenant||'–'}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-ghost edit-ft-btn" style="padding:6px 10px" data-id="${ft.id}"><i class="ti ti-pencil" style="font-size:13px"></i></button>
        <button class="btn-ghost del-ft-btn" style="padding:6px 10px;color:var(--red)" data-id="${ft.id}"><i class="ti ti-trash" style="font-size:13px"></i></button>
      </div>
    </div>`).join('');
  listEl.querySelectorAll('.edit-ft-btn').forEach(btn=>btn.addEventListener('click',()=>openFlashTalkForm(btn.dataset.id)));
  listEl.querySelectorAll('.del-ft-btn').forEach(btn=>btn.addEventListener('click',()=>deleteFlashTalk(btn.dataset.id)));
}

function openFlashTalkForm(ftId=null){
  const form=el('flashtalk-form');
  form.classList.add('open');
  editFlashTalk=ftId;
  if(ftId){
    const ft=DATA.flashTalks.find(f=>f.id===ftId);if(!ft)return;
    el('ft-start').value=ft.start||'';el('ft-end').value=ft.end||'';
    el('ft-thematique').value=ft.thematique||'';el('ft-sujet').value=ft.sujet||'';
    el('ft-intervenant').value=ft.intervenant||'';
  } else {
    el('ft-start').value='';el('ft-end').value='';el('ft-thematique').value='';
    el('ft-sujet').value='';el('ft-intervenant').value='';
  }
  form.scrollIntoView({behavior:'smooth',block:'start'});
}

async function saveFlashTalk(){
  const start=el('ft-start').value,end=el('ft-end').value;
  const thematique=el('ft-thematique').value.trim(),sujet=el('ft-sujet').value.trim(),intervenant=el('ft-intervenant').value.trim();
  if(!start||!sujet||!intervenant){toast("Merci de remplir au minimum l'heure de début, le sujet et l'intervenant.");return;}
  const data={start,end,thematique,sujet,intervenant,createdAt:Date.now()};
  loader(true);
  try{
    if(editFlashTalk){
      await updateDoc(doc(db,'flashTalks',editFlashTalk),data);
      const idx=DATA.flashTalks.findIndex(f=>f.id===editFlashTalk);
      if(idx>=0)DATA.flashTalks[idx]={id:editFlashTalk,...data};
      toast('Flash talk mis à jour !');
    } else {
      const ref=await addDoc(collection(db,'flashTalks'),data);
      DATA.flashTalks.push({id:ref.id,...data});
      toast('Flash talk créé !');
    }
    el('flashtalk-form').classList.remove('open');editFlashTalk=null;
    renderFlashTalksAdminList();updateBadges();
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteFlashTalk(ftId){
  if(!confirm('Supprimer ce flash talk ?'))return;
  loader(true);
  try{
    await deleteDoc(doc(db,'flashTalks',ftId));
    DATA.flashTalks=DATA.flashTalks.filter(f=>f.id!==ftId);
    renderFlashTalksAdminList();updateBadges();toast('Flash talk supprimé.');
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Import automatique programme Forum Créa (ateliers + flash talks) ── */
const PROGRAMME_ATELIERS = [{"start": "11:00", "end": "11:45", "thematique": "Communication", "sujet": "Les bases d'un plan de communication", "structure": "GERMINAL"}, {"start": "11:50", "end": "12:35", "thematique": "Statuts juridiques", "sujet": "Les différents statuts juridiques", "structure": "PIVOD"}, {"start": "12:45", "end": "13:30", "thematique": "IA", "sujet": "Entrepreneurs : améliorez votre productivité avec l'IA", "structure": "THARGO"}, {"start": "14:00", "end": "14:45", "thematique": "Emergence", "sujet": "Les différentes étapes de la création d'entreprise", "structure": "RESSAC"}, {"start": "15:00", "end": "15:45", "thematique": "ESS", "sujet": "Faire entreprise autrement : de l'intention floue à l'impact réel", "structure": "BGE"}, {"start": "16:00", "end": "16:45", "thematique": "Etude de marché", "sujet": "L'étude de marché: Identifier son prix de vente", "structure": "ADIE"}, {"start": "11:00", "end": "11:45", "thematique": "Responsabilité Juridique", "sujet": "Ma protection sociale / Ma rémunération", "structure": "AXA"}, {"start": "11:50", "end": "12:35", "thematique": "Financement", "sujet": "Financer ma création / ma croissance", "structure": "CIC et InExtenso"}, {"start": "12:45", "end": "13:30", "thematique": "Communication", "sujet": "Stratégie de contenus et d'image durables", "structure": "Yaitso et Yes for Comm"}, {"start": "14:00", "end": "14:45", "thematique": "Juridique", "sujet": "Le régime juridique du bail commercial", "structure": "HGI et Make Office"}, {"start": "15:00", "end": "15:45", "thematique": "Stratégie", "sujet": "Trouver son associé - facteur clés du succès", "structure": "FL et JL"}, {"start": "16:00", "end": "16:45", "thematique": "Transition", "sujet": "Mon parcours économie d'énergie", "structure": "CRESS"}];

const PROGRAMME_FLASHTALKS = [{"start": "11:00", "end": "11:15", "thematique": "Acteur de la création d'entreprise", "sujet": "Passionné/e par la cosmétique durable ?", "intervenant": "LMCE"}, {"start": "11:30", "end": "11:45", "thematique": "Actualité chaude", "sujet": "La facturation électronique : l'essentiel à savoir !", "intervenant": "COGEDIS"}, {"start": "11:55", "end": "12:10", "thematique": "Acteur de la création d'entreprise", "sujet": "Intervention BGE", "intervenant": "BGE"}, {"start": "12:15", "end": "12:30", "thematique": "Acteur de la création d'entreprise", "sujet": "Le portage salarial : l'alternative à l'entrepreneuriat classique !", "intervenant": "Performus"}, {"start": "13:30", "end": "13:45", "thematique": "Actualité chaude", "sujet": "Bon à savoir avant d'ouvrir votre local : la réglementation hygiène et sécurité", "intervenant": "Coeur de Cible"}, {"start": "13:45", "end": "14:00", "thematique": "Acteur de la création d'entreprise", "sujet": "Le prêt d'honneur pour soutenir vos fonds propres !", "intervenant": "PIE"}, {"start": "14:15", "end": "14:30", "thematique": "Actualité chaude", "sujet": "Comment maîtriser le volet travaux de votre projet !", "intervenant": "Y Y Studio"}, {"start": "14:45", "end": "15:00", "thematique": "Témoignage", "sujet": "L'importance de l'image pour la réussite", "intervenant": "Maria Look Conseil"}, {"start": "15:15", "end": "15:30", "thematique": "Témoignage", "sujet": "Témoignage entrepreneur", "intervenant": "Entrepreneur du Département 93"}];

async function importProgramme(){
  if(DATA.ateliers.length||DATA.flashTalks.length){
    if(!confirm(`Le programme contient déjà ${DATA.ateliers.length} atelier(s) et ${DATA.flashTalks.length} flash talk(s).\\n\\nImporter ajoutera ${PROGRAMME_ATELIERS.length} nouveaux ateliers et ${PROGRAMME_FLASHTALKS.length} nouveaux flash talks (sans dupliquer ceux déjà présents avec le même horaire+sujet).\\n\\nContinuer ?`)) return;
  } else {
    if(!confirm(`Importer ${PROGRAMME_ATELIERS.length} ateliers et ${PROGRAMME_FLASHTALKS.length} flash talks issus du programme Forum Créa 22/09/2026 ?`)) return;
  }
  loader(true);
  try{
    const batch=writeBatch(db);
    let countAt=0, countFt=0;
    PROGRAMME_ATELIERS.forEach(a=>{
      const exists=DATA.ateliers.some(x=>x.start===a.start&&x.sujet===a.sujet);
      if(exists) return;
      const period=a.start<'13:00'?'matin':'aprem';
      const titre=a.sujet;
      const ref=doc(collection(db,'ateliers'));
      const data={titre,salle:a.structure||'',description:a.thematique?`Thématique : ${a.thematique}`:'',start:a.start,end:a.end,period,value:`${a.start}-${a.end}`,places:0,categories:[],animateurs:[],intervenantLibre:a.structure||'',createdAt:Date.now()};
      batch.set(ref,data);
      DATA.ateliers.push({id:ref.id,...data});
      countAt++;
    });
    PROGRAMME_FLASHTALKS.forEach(f=>{
      const exists=DATA.flashTalks.some(x=>x.start===f.start&&x.sujet===f.sujet);
      if(exists) return;
      const ref=doc(collection(db,'flashTalks'));
      const data={start:f.start,end:f.end,thematique:f.thematique||'',sujet:f.sujet,intervenant:f.intervenant||'',createdAt:Date.now()};
      batch.set(ref,data);
      DATA.flashTalks.push({id:ref.id,...data});
      countFt++;
    });
    await batch.commit();
    renderAteliersAdminList?.();renderFlashTalksAdminList?.();updateBadges?.();
    toast(`Import terminé : ${countAt} atelier(s) + ${countFt} flash talk(s) ajoutés.`);
  }catch(e){console.error(e);toast("Erreur lors de l'import.");}
  loader(false);
}

/* ── Visiteurs admin ──────────────────────────────────────────── */
async function renderVisiteursList(){
  const listEl=el('visiteurs-list');if(!listEl)return;
  // Recharger visitors depuis Firebase à chaque fois
  try{
    const vS=await getDocs(collection(db,'visitors'));
    DATA.visitors=vS.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){console.error(e);}

  const search=(el('vis-admin-search')?.value||'').toLowerCase();
  const vb=el('vis-badge');if(vb)vb.textContent=DATA.visitors.length||'';

  // Construire la liste depuis visitors + bookings/inscriptions sans code
  const emailsWithCode = new Set(DATA.visitors.map(v=>v.email.toLowerCase()));

  // Visiteurs avec code
  const withCode = DATA.visitors.map(v=>{
    const bk=DATA.bookings.filter(b=>(b.email||'').toLowerCase()===v.email).sort((a,b)=>a.slotStart.localeCompare(b.slotStart));
    const ins=DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===v.email);
    const first=bk[0]||ins[0];
    return{...v,bookings:bk,inscriptions:ins,prenom:first?.prenom||'',nom:first?.nom||'',societe:first?.societe||''};
  });

  // Visiteurs sans code (ont des bookings/inscriptions mais pas dans visitors)
  const allEmails = new Set([
    ...DATA.bookings.map(b=>(b.email||'').toLowerCase()),
    ...DATA.inscriptions.map(i=>(i.email||'').toLowerCase()),
  ]);
  const withoutCode = [...allEmails].filter(e=>e&&!emailsWithCode.has(e)).map(emailLow=>{
    const bk=DATA.bookings.filter(b=>(b.email||'').toLowerCase()===emailLow).sort((a,b)=>a.slotStart.localeCompare(b.slotStart));
    const ins=DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===emailLow);
    const first=bk[0]||ins[0];
    return{id:'nocode-'+emailLow,email:emailLow,code:'–',bookings:bk,inscriptions:ins,prenom:first?.prenom||'',nom:first?.nom||'',societe:first?.societe||''};
  });

  const visiteurs=[...withCode,...withoutCode]
    .filter(v=>!search||(v.prenom+' '+v.nom+' '+v.email).toLowerCase().includes(search))
    .sort((a,b)=>(a.nom||'').localeCompare(b.nom||''));

  if(!visiteurs.length){listEl.innerHTML='<div class="empty-state"><i class="ti ti-users"></i><p>Aucun visiteur.</p></div>';return;}
  listEl.innerHTML=`<table class="rdv-table"><thead><tr><th>Visiteur</th><th>Email</th><th>Société</th><th>Code</th><th>RDV</th><th>Ateliers</th><th></th></tr></thead><tbody>
  ${visiteurs.map(v=>`<tr>
    <td><strong>${v.prenom} ${v.nom}</strong></td><td>${v.email}</td><td>${v.societe||'–'}</td>
    <td><span style="font-family:monospace;font-size:15px;font-weight:700;color:var(--cyan);background:var(--cyan-l);padding:3px 10px;border-radius:6px;letter-spacing:.1em">${v.code}</span></td>
    <td><strong style="color:var(--cyan)">${v.bookings.length}</strong></td>
    <td><strong style="color:#3B6D11">${v.inscriptions.length}</strong></td>
    <td style="display:flex;gap:6px">
      <button class="btn-primary" style="padding:5px 12px;font-size:12px" data-vid="${v.id}"><i class="ti ti-eye"></i> Planning</button>
      <button class="del-booking-btn" style="padding:5px 10px" data-del-vid="${v.id}" data-del-email="${v.email}" title="Supprimer ce visiteur et toutes ses données"><i class="ti ti-trash"></i></button>
      ${(currentAdmin?.role?.toLowerCase()==='superadmin'||currentAdmin?.email===SUPER_ADMIN_EMAIL)?`<button class="btn-ghost" style="padding:5px 10px;font-size:12px" data-rgpd-vid="${v.id}" title="Télécharger le document RGPD accepté"><i class="ti ti-file-download"></i></button>`:''}
    </td>
  </tr>`).join('')}</tbody></table>`;
  listEl.querySelectorAll('[data-vid]').forEach(btn=>{
    const v=visiteurs.find(x=>x.id===btn.dataset.vid);
    if(v)btn.addEventListener('click',()=>openVisiteurDetail(v));
  });
  listEl.querySelectorAll('[data-del-vid]').forEach(btn=>{
    btn.addEventListener('click',()=>deleteVisiteur(btn.dataset.delVid, btn.dataset.delEmail));
  });
  // Bouton doc RGPD superadmin
  listEl.querySelectorAll('[data-rgpd-vid]').forEach(btn=>{
    const v = visiteurs.find(x=>x.id===btn.dataset.rgpdVid);
    if(v) btn.addEventListener('click',()=>downloadRgpdDoc(v));
  });
}

function downloadRgpdDoc(v) {
  const bks = v.bookings||[];
  const ins = v.inscriptions||[];
  const now = new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const registDate = v.createdAt ? new Date(v.createdAt).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Date inconnue';
  const rdvLines = bks.map(b=>`  - RDV avec ${b.exposantId||'–'} · ${b.slotStart||'–'} (${b.mode||'inscription'})`).join('\n')||'  Aucun RDV enregistré';
  const atLines  = ins.map(i=>`  - Atelier : ${i.atelierId||'–'} (${i.mode||'inscription'})`).join('\n')||'  Aucun atelier enregistré';
  const txt = `DOCUMENT DE CONSENTEMENT RGPD
Généré le : ${now}
Plateforme : Entreprends Demain ! — entrprends-demain.github.io/planning.rdv-ateliers/
Organisateur : Paris Initiative Entreprise (PIE) — 68 Bd Malesherbes, 75008 Paris

═══════════════════════════════════════════════════════
DONNÉES DE L'INSCRIT
═══════════════════════════════════════════════════════
Prénom : ${v.prenom||bks[0]?.prenom||'–'}
Nom    : ${v.nom||bks[0]?.nom||'–'}
Email  : ${v.email||'–'}
Société: ${v.societe||bks[0]?.societe||'–'}
Code personnel : ${v.code||'–'}
Date d'inscription : ${registDate}

═══════════════════════════════════════════════════════
CONSENTEMENT RECUEILLI
═══════════════════════════════════════════════════════
✓ L'inscrit a coché la case de consentement lors de son inscription :

  « J'accepte que mes données soient utilisées dans le cadre de cet
  événement et conservées dans la base de données de PIE conformément
  à la politique de confidentialité (rgpd.html). »

Base légale : Consentement explicite (art. 6.1.a RGPD)

═══════════════════════════════════════════════════════
INSCRIPTIONS
═══════════════════════════════════════════════════════
RDV individuels :
${rdvLines}

Ateliers :
${atLines}

═══════════════════════════════════════════════════════
DROITS DE L'INSCRIT
═══════════════════════════════════════════════════════
L'inscrit dispose des droits d'accès, rectification, effacement,
opposition et portabilité. Contact : communication@paris-initiative.org

Durée de conservation : jusqu'au 31 décembre 2026.
═══════════════════════════════════════════════════════
Document généré automatiquement par la plateforme PIE.
`;
  const blob = new Blob([txt],{type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RGPD_${(v.nom||'visiteur').replace(/\s+/g,'-')}_${(v.prenom||'').replace(/\s+/g,'-')}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast(`Document RGPD téléchargé pour ${v.prenom} ${v.nom}`);
}

async function exportVisiteursXlsx(){
  if(typeof XLSX==='undefined'){toast("La librairie d'export n'a pas pu se charger. Vérifiez votre connexion internet.");return;}
  loader(true);
  try{
    // Même logique de reconstruction que renderVisiteursList
    const vS=await getDocs(collection(db,'visitors'));
    const visitorsFresh=vS.docs.map(d=>({id:d.id,...d.data()}));
    const emailsWithCode=new Set(visitorsFresh.map(v=>(v.email||'').toLowerCase()));

    const withCode=visitorsFresh.map(v=>{
      const emailLow=(v.email||'').toLowerCase();
      const bk=DATA.bookings.filter(b=>(b.email||'').toLowerCase()===emailLow).sort((a,b)=>(a.slotStart||'').localeCompare(b.slotStart||''));
      const ins=DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===emailLow);
      const first=bk[0]||ins[0];
      return{...v,bookings:bk,inscriptions:ins,prenom:first?.prenom||v.prenom||'',nom:first?.nom||v.nom||'',societe:first?.societe||v.societe||''};
    });

    const allEmails=new Set([
      ...DATA.bookings.map(b=>(b.email||'').toLowerCase()),
      ...DATA.inscriptions.map(i=>(i.email||'').toLowerCase()),
    ]);
    const withoutCode=[...allEmails].filter(e=>e&&!emailsWithCode.has(e)).map(emailLow=>{
      const bk=DATA.bookings.filter(b=>(b.email||'').toLowerCase()===emailLow).sort((a,b)=>(a.slotStart||'').localeCompare(b.slotStart||''));
      const ins=DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===emailLow);
      const first=bk[0]||ins[0];
      return{id:'nocode-'+emailLow,email:emailLow,code:'–',bookings:bk,inscriptions:ins,prenom:first?.prenom||'',nom:first?.nom||'',societe:first?.societe||''};
    });

    const visiteurs=[...withCode,...withoutCode].sort((a,b)=>(a.nom||'').localeCompare(b.nom||''));

    if(!visiteurs.length){toast('Aucun visiteur à exporter.');loader(false);return;}

    const overviewRows=visiteurs.map(v=>({
      'Prénom':v.prenom||'',
      'Nom':v.nom||'',
      'Email':v.email||'',
      'Société':v.societe||'',
      'Code personnel':v.code||'–',
      'Nb RDV':v.bookings.length,
      'Nb Ateliers':v.inscriptions.length,
      "Date d'inscription":v.createdAt?new Date(v.createdAt).toLocaleString('fr-FR'):'',
    }));

    // ── Feuille RDV : un tableau par créneau horaire ──
    const rdvByCreneau = {};
    visiteurs.forEach(v=>{
      v.bookings.forEach(b=>{
        const key = `${b.slotStart||'?'}–${b.slotEnd||'?'}`;
        if(!rdvByCreneau[key]) rdvByCreneau[key]=[];
        const exp=DATA.exposants.find(e=>e.id===b.exposantId);
        rdvByCreneau[key].push({
          'Expert':exp?.name||b.exposantId||'',
          'Prénom':v.prenom||'',
          'Nom':v.nom||'',
          'Email':v.email||'',
          'Société':v.societe||'',
          'Problématique':b.problematique||'',
          'Mode':b.mode||'inscription',
        });
      });
    });
    const creneauxTries = Object.keys(rdvByCreneau).sort();
    const rdvSheetData = [];
    if(!creneauxTries.length){
      rdvSheetData.push(['Aucun RDV enregistré']);
    } else {
      creneauxTries.forEach(creneau=>{
        rdvSheetData.push([`Créneau ${creneau}`]);
        rdvSheetData.push(['Expert','Prénom','Nom','Email','Société','Problématique','Mode']);
        rdvByCreneau[creneau].forEach(r=>{
          rdvSheetData.push([r['Expert'],r['Prénom'],r['Nom'],r['Email'],r['Société'],r['Problématique'],r['Mode']]);
        });
        rdvSheetData.push([]);
      });
    }

    // ── Feuille Ateliers : un tableau par atelier ──
    const atByAtelier = {};
    visiteurs.forEach(v=>{
      v.inscriptions.forEach(i=>{
        const at=DATA.ateliers.find(a=>a.id===i.atelierId);
        const key = at?.titre || i.atelierId || 'Atelier inconnu';
        if(!atByAtelier[key]) atByAtelier[key]={meta:at,rows:[]};
        atByAtelier[key].rows.push({
          'Prénom':v.prenom||'',
          'Nom':v.nom||'',
          'Email':v.email||'',
          'Société':v.societe||'',
          'Mode':i.mode||'inscription',
        });
      });
    });
    const ateliersTries = Object.keys(atByAtelier).sort();
    const atSheetData = [];
    if(!ateliersTries.length){
      atSheetData.push(['Aucun atelier enregistré']);
    } else {
      ateliersTries.forEach(titre=>{
        const meta=atByAtelier[titre].meta;
        const horaire = meta ? `${meta.start||'?'}–${meta.end||'?'} · ${meta.salle||''}` : '';
        atSheetData.push([`${titre}${horaire?' — '+horaire:''}`]);
        atSheetData.push(['Prénom','Nom','Email','Société','Mode']);
        atByAtelier[titre].rows.forEach(r=>{
          atSheetData.push([r['Prénom'],r['Nom'],r['Email'],r['Société'],r['Mode']]);
        });
        atSheetData.push([]);
      });
    }

    const wb=XLSX.utils.book_new();
    const wsOverview=XLSX.utils.json_to_sheet(overviewRows);
    const wsRdv=XLSX.utils.aoa_to_sheet(rdvSheetData);
    const wsAt=XLSX.utils.aoa_to_sheet(atSheetData);
    XLSX.utils.book_append_sheet(wb,wsOverview,'Visiteurs');
    XLSX.utils.book_append_sheet(wb,wsRdv,'RDV par créneau');
    XLSX.utils.book_append_sheet(wb,wsAt,'Ateliers');

    const dateStr=new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb,`Visiteurs_EntreprendsDemain_${dateStr}.xlsx`);
    toast(`Export Excel généré : ${visiteurs.length} visiteur(s).`);
  }catch(e){console.error(e);toast("Erreur lors de l'export Excel.");}
  loader(false);
}

async function deleteVisiteur(visitorId, email) {
  // Si pas de vrai ID visitor (visiteur sans code), pas de doc à supprimer dans visitors
  const emailLow = (email||'').toLowerCase();
  const bkCount  = DATA.bookings.filter(b=>(b.email||'').toLowerCase()===emailLow).length;
  const insCount = DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===emailLow).length;
  const wCount   = DATA.waitlist.filter(w=>(w.email||'').toLowerCase()===emailLow).length;
  if(!confirm(`Supprimer ce visiteur et toutes ses données ?

• ${bkCount} RDV
• ${insCount} inscription${insCount>1?'s':''} atelier
• ${wCount} liste${wCount>1?'s':""} d'attente

Cette action est irréversible.`))return;
  loader(true);
  try{
    const batch=writeBatch(db);
    // Supprimer bookings
    DATA.bookings.filter(b=>(b.email||'').toLowerCase()===emailLow).forEach(b=>batch.delete(doc(db,'bookings',b.id)));
    // Supprimer inscriptions
    DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===emailLow).forEach(i=>batch.delete(doc(db,'inscriptions',i.id)));
    // Supprimer waitlist
    DATA.waitlist.filter(w=>(w.email||'').toLowerCase()===emailLow).forEach(w=>batch.delete(doc(db,'waitlist',w.id)));
    // Supprimer visitor si existe
    if(!visitorId.startsWith('nocode-')) batch.delete(doc(db,'visitors',visitorId));
    await batch.commit();
    // Mettre à jour DATA
    DATA.bookings     = DATA.bookings.filter(b=>(b.email||'').toLowerCase()!==emailLow);
    DATA.inscriptions = DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()!==emailLow);
    DATA.waitlist     = DATA.waitlist.filter(w=>(w.email||'').toLowerCase()!==emailLow);
    DATA.visitors     = DATA.visitors.filter(v=>v.id!==visitorId&&v.email.toLowerCase()!==emailLow);
    el('visiteur-detail')?.style && (el('visiteur-detail').style.display='none');
    renderVisiteursList();renderStats();updateBadges();
    toast('Visiteur et toutes ses données supprimés.');
  }catch(e){console.error(e);toast('Erreur lors de la suppression.');}
  loader(false);
}

function openVisiteurDetail(v){
  const detail=el('visiteur-detail');if(!detail)return;
  el('vd-title').innerHTML=`<i class="ti ti-user-circle" style="color:var(--cyan);font-size:20px;vertical-align:-3px;margin-right:6px"></i>${v.prenom} ${v.nom}`;
  const allItems=[
    ...v.bookings.map(b=>{const exp=DATA.exposants.find(e=>e.id===b.exposantId);return{time:b.slotStart,end:b.slotEnd,title:exp?.name||'–',sub:exp?.cat||'',prob:b.problematique||'',type:'rdv',period:b.period};}),
    ...v.inscriptions.map(i=>{const at=DATA.ateliers.find(a=>a.id===i.atelierId);return{time:at?.start||'',end:at?.end||'',title:at?.titre||'–',sub:at?.salle||'',type:'atelier',period:at?.period||''};}),
  ].sort((a,b)=>a.time.localeCompare(b.time));
  el('vd-body').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:1.25rem">
      <div style="background:var(--surf2);border-radius:10px;padding:.9rem">
        <div style="font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;margin-bottom:.4rem">Informations</div>
        <div style="font-size:13px;margin-bottom:3px"><strong>Email :</strong> ${v.email}</div>
        <div style="font-size:13px;margin-bottom:3px"><strong>Société :</strong> ${v.societe||'–'}</div>
        <div style="font-size:13px"><strong>RDV :</strong> ${v.bookings.length} · <strong>Ateliers :</strong> ${v.inscriptions.length}</div>
      </div>
      <div style="background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:10px;padding:.9rem;text-align:center">
        <div style="font-size:11px;font-weight:600;color:var(--cyan-d);text-transform:uppercase;margin-bottom:.4rem">Code personnel</div>
        <div style="font-size:36px;font-weight:700;color:var(--cyan);font-family:monospace;letter-spacing:.15em">${v.code}</div>
      </div>
    </div>
    <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:.6rem">Planning complet — 22 septembre 2026</div>
    ${buildPlanningHTML(allItems)||'<div style="font-size:13px;color:var(--ink3);text-align:center;padding:1rem">Aucun élément.</div>'}`;
  detail.style.display='block';detail.scrollIntoView({behavior:'smooth',block:'nearest'});
  el('vd-close').onclick=()=>{detail.style.display='none';};
}

function buildPlanningHTML(items){
  return items.map(item=>{
    const isAt=item.type==='atelier', isPm=item.period==='aprem';
    const isWait=item.isWait||false;
    const cls=isWait?'wait-item-red':(isAt?(isPm?'at-pm':'at-am'):(isPm?'rdv-pm':'rdv-am'));
    const typeTag=isWait
      ?`<span class="pi-type" style="background:var(--am);color:#fff">Attente #${item.waitPos}</span>`
      :(isAt?'<span class="pi-type type-at">Atelier</span>':'<span class="pi-type type-rdv">RDV</span>');
    const cancelBtn=item.canCancel?`<button class="cancel-rdv-btn" data-id="${item.id}" data-type="${isWait?'wait-'+(isAt?'atelier':'rdv'):item.type}" data-title="${item.title}" data-time="${item.time}"><i class="ti ti-trash"></i></button>`:'';
    return`<div class="planning-item ${cls}">
      <div class="pi-time" style="color:${isWait?'var(--am)':(isAt?'#3B6D11':(isPm?'#B8940A':'var(--cyan)'))}">
        ${item.time}–${item.end}
      </div>
      <div class="pi-info">
        <div class="pi-title">${item.title}${isWait?' <span style="font-size:11px;color:var(--am)">(liste d\'attente)</span>':''}</div>
        <div class="pi-sub">${item.sub}${item.prob?` · "${item.prob}"`:''}</div>
      </div>
      ${typeTag}
      ${cancelBtn}
    </div>`;
  }).join('');
}

/* ── Visiteur : grille exposants ──────────────────────────────── */
function renderGrid(){
  const search=(el('vis-search')?.value||'').toLowerCase();
  const catF=el('vis-cat')?.value||'', expertF=el('vis-expertise')?.value||'';
  const catSel=el('vis-cat');
  if(catSel){const cur=catSel.value;const cats=[...new Set(DATA.exposants.map(e=>e.cat))].sort();catSel.innerHTML='<option value="">Toutes catégories</option>'+cats.map(c=>`<option value="${c}"${c===cur?' selected':''}>${c}</option>`).join('');}
  const expSel=el('vis-expertise');
  if(expSel){const cur=expSel.value;const xs=[...new Set(DATA.exposants.map(e=>e.expertise).filter(Boolean))].sort();expSel.innerHTML='<option value="">Toutes expertises</option>'+xs.map(x=>`<option value="${x}"${x===cur?' selected':''}>${x}</option>`).join('');}
  const grid=el('grid');if(!grid)return;
  if(!DATA.exposants.length){grid.innerHTML='<div class="empty-state"><i class="ti ti-calendar-off"></i><p>Aucun expert disponible.</p></div>';return;}
  // Exclure les exposants sans RDV (period='aucun')
  const list=DATA.exposants.filter(exp=>{
    if(exp.period==='aucun') return false;
    const ms=!search||exp.name.toLowerCase().includes(search)||exp.cat.toLowerCase().includes(search)||(exp.expertise||'').toLowerCase().includes(search);
    const mc=!catF||exp.cat===catF, me=!expertF||exp.expertise===expertF;
    const mp=!periodFilter||exp.period===periodFilter||exp.period==='jour';
    return ms&&mc&&me&&mp;
  });
  if(!list.length){grid.innerHTML='<div class="empty-state"><i class="ti ti-search"></i><p>Aucun expert trouvé.</p></div>';return;}
  grid.innerHTML=list.map(exp=>{
    const slots=getSlots(exp.id);
    const amFree=slots.filter(s=>s.period==='matin'&&s.enabled&&!getBooking(exp.id,s.start)).length;
    const pmFree=slots.filter(s=>s.period==='aprem'&&s.enabled&&!getBooking(exp.id,s.start)).length;
    const pills=[amFree>0?`<span class="pill pill-am">${amFree} matin</span>`:'',pmFree>0?`<span class="pill pill-pm">${pmFree} ap-m</span>`:'',amFree===0&&pmFree===0?'<span class="pill pill-none">Complet</span>':''].filter(Boolean).join('');
    return`<div class="exp-card" data-id="${exp.id}">
      <div class="exp-card-top">
        <div class="avatar">${initials(exp.name)}</div>
        <div><div class="exp-name">${exp.name}</div><div class="exp-cat">${exp.cat}${exp.expertise?' · '+exp.expertise:''}</div></div>
        <i class="ti ti-chevron-right exp-arrow"></i>
      </div>
      <div class="pills">${pills}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.exp-card').forEach(c=>c.addEventListener('click',()=>openDrawer(c.dataset.id)));
}

/* ── Helpers liste d'attente ─────────────────────────────────── */

function getWaitRdv(expId, start, email) {
  return DATA.waitlist.find(w => w.expId===expId && w.slotStart===start && !w.atelierId && (email?(w.email||'').toLowerCase()===email.toLowerCase():true));
}
function getWaitAtelier(atId, email) {
  return DATA.waitlist.find(w => w.atelierId===atId && !w.expId && (email?(w.email||'').toLowerCase()===email.toLowerCase():true));
}
function waitPosRdv(expId, start) {
  return DATA.waitlist.filter(w=>w.expId===expId&&w.slotStart===start&&!w.atelierId).sort((a,b)=>a.createdAt-b.createdAt);
}
function waitPosAtelier(atId) {
  return DATA.waitlist.filter(w=>w.atelierId===atId&&!w.expId).sort((a,b)=>a.createdAt-b.createdAt);
}

async function promoteWaitlistRdv(expId, slotStart) {
  const queue = waitPosRdv(expId, slotStart);
  if (!queue.length) return;
  const next = queue[0];
  loader(true);
  try {
    // Créer la réservation pour le premier en liste
    const ref = await addDoc(collection(db,'bookings'), {
      exposantId: expId, slotStart, slotEnd: next.slotEnd||'', period: next.period||'',
      prenom: next.prenom, nom: next.nom, email: next.email, societe: next.societe||'',
      problematique: next.problematique||'', structure: next.structure||'',
      consentRgpd: true, consentDate: new Date().toISOString(), createdAt: Date.now(),
      promotedFromWaitlist: true,
    });
    DATA.bookings.push({id:ref.id, exposantId:expId, slotStart, slotEnd:next.slotEnd, period:next.period, prenom:next.prenom, nom:next.nom, email:next.email, societe:next.societe, problematique:next.problematique});
    // Supprimer de la liste d'attente
    await deleteDoc(doc(db,'waitlist',next.id));
    DATA.waitlist = DATA.waitlist.filter(w=>w.id!==next.id);
    toast(`${next.prenom} ${next.nom} promu(e) depuis la liste d'attente !`);
  } catch(e) { console.error(e); }
  loader(false);
}

async function promoteWaitlistAtelier(atId) {
  const queue = waitPosAtelier(atId);
  if (!queue.length) return;
  const next = queue[0];
  const at = DATA.ateliers.find(a=>a.id===atId);
  loader(true);
  try {
    const ref = await addDoc(collection(db,'inscriptions'), {
      atelierId: atId, prenom: next.prenom, nom: next.nom, email: next.email,
      societe: next.societe||'', consentRgpd: true, consentDate: new Date().toISOString(), createdAt: Date.now(),
      promotedFromWaitlist: true,
    });
    DATA.inscriptions.push({id:ref.id, atelierId:atId, prenom:next.prenom, nom:next.nom, email:next.email});
    await deleteDoc(doc(db,'waitlist',next.id));
    DATA.waitlist = DATA.waitlist.filter(w=>w.id!==next.id);
    toast(`${next.prenom} ${next.nom} promu(e) depuis la liste d'attente !`);
  } catch(e) { console.error(e); }
  loader(false);
}

/* ── Drawer RDV ───────────────────────────────────────────────── */
async function openDrawer(expId){
  if(PLATFORM_MODE === 'lecture'){
    // Mode lecture : afficher infos sans bouton d'inscription
    const exp=DATA.exposants.find(e=>e.id===expId);
    const slots=getSlots(expId);
    el('d-name').textContent=exp?.name||'–';
    el('d-cat').textContent=(exp?.cat||'')+(exp?.expertise?' · '+exp.expertise:'');
    el('d-confirm').innerHTML='';
    const ms=slots.filter(s=>s.period==='matin'), ps=slots.filter(s=>s.period==='aprem');
    const fill=(list,cid)=>{const c=el(cid);if(!list.length){c.innerHTML='';return;}c.innerHTML=list.map(s=>`<span class="slot-btn ${s.period==='matin'?'slot-free-am':'slot-free-pm'}" style="cursor:default;opacity:.7">${s.start}–${s.end}</span>`).join('');};
    el('d-am-count').textContent=ms.length?ms.length+` créneau${ms.length>1?'x':''}`:'' ;
    el('d-pm-count').textContent=ps.length?ps.length+` créneau${ps.length>1?'x':''}`:'' ;
    el('d-matin').style.display=ms.length?'flex':'none';
    el('d-aprem').style.display=ps.length?'flex':'none';
    fill(ms,'d-am-slots');fill(ps,'d-pm-slots');
    el('overlay').classList.add('open');el('drawer').classList.add('open');document.body.style.overflow='hidden';
    return;
  }
  // Recharger les bookings pour avoir l'état le plus récent
  try{
    const bS=await getDocs(query(collection(db,'bookings'),orderBy('slotStart')));
    DATA.bookings=bS.docs.map(d=>({id:d.id,...d.data()}));
    const wS=await getDocs(query(collection(db,'waitlist'),orderBy('createdAt')));
    DATA.waitlist=wS.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){console.error(e);}
  pendingExp=expId;
  const exp=DATA.exposants.find(e=>e.id===expId);
  const slots=getSlots(expId), ms=slots.filter(s=>s.period==='matin'), ps=slots.filter(s=>s.period==='aprem');
  el('d-name').textContent=exp.name; el('d-cat').textContent=exp.cat+(exp.expertise?' · '+exp.expertise:'');
  el('d-confirm').innerHTML='';
  const fillSlots = (list,cid,fcls) => {
    const c=el(cid);if(!list.length){c.innerHTML='<span style="font-size:12px;color:var(--ink3)">Non disponible</span>';return;}
    c.innerHTML=list.map(s=>{
      const b=getBooking(expId,s.start);
      const myWait=getWaitRdv(expId,s.start,null); // on check après avec email
      const free=s.enabled&&!b;
      const waitCount=waitPosRdv(expId,s.start).length;
      if(free) return`<button class="slot-btn ${fcls}" data-start="${s.start}" data-end="${s.end}">${s.start}–${s.end}</button>`;
      if(b) return`<button class="slot-btn slot-booked" data-start="${s.start}" data-end="${s.end}" data-waitcount="${waitCount}">${s.start}–${s.end}<span class="slot-tag">Pris</span>${waitCount?`<span class="slot-wait-badge">${waitCount} att.</span>`:''}</button>`;
      return`<button class="slot-btn slot-disabled" disabled>${s.start}–${s.end}<span class="slot-tag">Indispo</span></button>`;
    }).join('');
    // Slots libres → réserver
    c.querySelectorAll('.slot-btn.'+fcls).forEach(btn=>btn.addEventListener('click',()=>openModal(btn.dataset.start,btn.dataset.end)));
    // Slots pris → liste d'attente
    c.querySelectorAll('.slot-btn.slot-booked').forEach(btn=>btn.addEventListener('click',()=>openModalWait('rdv',btn.dataset.start,btn.dataset.end,expId,null)));
  }
  const amFree=ms.filter(s=>s.enabled&&!getBooking(expId,s.start)).length;
  const pmFree=ps.filter(s=>s.enabled&&!getBooking(expId,s.start)).length;
  el('d-am-count').textContent=amFree?`${amFree} libre${amFree>1?'s':''}`:'Complet';
  el('d-pm-count').textContent=pmFree?`${pmFree} libre${pmFree>1?'s':''}`:'Complet';
  el('d-matin').style.display=ms.length?'flex':'none';
  el('d-aprem').style.display=ps.length?'flex':'none';
  fillSlots(ms,'d-am-slots','slot-free-am');fillSlots(ps,'d-pm-slots','slot-free-pm');
  el('overlay').classList.add('open');el('drawer').classList.add('open');document.body.style.overflow='hidden';
}
function closeDrawer(){el('overlay')?.classList.remove('open');el('drawer')?.classList.remove('open');document.body.style.overflow='';}

/* ── Code visiteur ────────────────────────────────────────────── */
function genCode(){return String(Math.floor(100000+Math.random()*900000));}
async function getOrCreateVisitorCode(email){
  const emailLow=email.toLowerCase();
  const existing=DATA.visitors.find(v=>v.email===emailLow);
  if(existing)return{code:existing.code,isNew:false};
  const code=genCode();
  const ref=await addDoc(collection(db,'visitors'),{email:emailLow,code,createdAt:Date.now()});
  DATA.visitors.push({id:ref.id,email:emailLow,code});
  return{code,isNew:true};
}

function generateIcsBlob() {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Entreprends Demain//FR',
    'BEGIN:VEVENT',
    'DTSTART:20260922T100000',
    'DTEND:20260922T170000',
    'SUMMARY:Entreprends Demain !',
    'DESCRIPTION:Salon entrepreneuriat durable - Cite des Metiers de Paris\nhttps://entrprends-demain.github.io/planning.rdv-ateliers/',
    'LOCATION:Cite des Metiers de Paris\\, 30 Av. Corentin Cariou\\, 75019 Paris',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  return new Blob([ics], {type:'text/calendar;charset=utf-8'});
}

function generateGoogleCalLink() {
  const text    = encodeURIComponent('Entreprends Demain !');
  const dates   = '20260922T100000%2F20260922T170000';
  const details = encodeURIComponent(`Salon de l’entrepreneuriat durable – Cité des Métiers de Paris\nhttps://entrprends-demain.github.io/planning.rdv-ateliers/`);
  const loc     = encodeURIComponent(`Cité des Métiers de Paris, 30 Av. Corentin Cariou, 75019 Paris`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${loc}&sf=true`;
}

function showCodeModal(code,prenom,expName,start,end,isPreinscription=false){
  navigator.clipboard.writeText(code).catch(()=>{});
  const overlay=document.createElement('div');
  overlay.id='code-modal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';
  // Pré-générer URLs calendrier avant injection innerHTML
  const _googleCalUrl = generateGoogleCalLink();
  const _icsUrl = URL.createObjectURL(generateIcsBlob());
    overlay.innerHTML=`<div style="background:#fff;border-radius:20px;padding:2rem;max-width:440px;width:100%;text-align:center;border:2px solid var(--cyan);box-shadow:0 20px 60px rgba(0,0,0,.2)">
    <i class="ti ti-circle-check" style="font-size:40px;color:var(--cyan);display:block;margin-bottom:.75rem"></i>
    <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:.25rem">${isPreinscription?'Préinscription enregistrée !':'Inscription confirmée !'}</div>
    <div style="font-size:13px;color:var(--ink3);margin-bottom:1.5rem">${start}–${end} chez ${expName}</div>
    <div style="background:var(--cyan-l);border:2px solid var(--cyan);border-radius:14px;padding:1.25rem;margin-bottom:1rem">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--cyan-d);margin-bottom:.5rem">🔑 Votre code personnel</div>
      <div style="font-size:52px;font-weight:700;color:var(--cyan);letter-spacing:.2em;font-family:monospace">${code}</div>
      <div style="font-size:12px;color:#2E6B12;margin-top:.5rem;font-weight:600">✓ Copié automatiquement dans votre presse-papier</div>
    </div>
    <div style="background:#FFF8E6;border:2px solid #FFD82B;border-radius:12px;padding:1rem;margin-bottom:1.25rem;text-align:left">
      <div style="font-size:12px;font-weight:700;color:#B8940A;margin-bottom:.5rem">⚠️ Notez ce code — il ne pourra pas être modifié</div>
      <div style="font-size:12px;color:#5A4A00;line-height:1.6">
        Avec ce code, vous pouvez :<br>• Accéder rapidement à votre planning<br>• <strong>Annuler vos RDV et inscriptions</strong><br>• <strong>Pré-remplir vos informations</strong> lors de vos prochaines réservations<br><br>
        <strong>Sans ce code</strong> : consultation uniquement. Pour modification, contactez l'équipe PIE.
      </div>
    </div>
    ${isPreinscription?`<div style="background:#EAF3DE;border:1.5px solid #6BAA38;border-radius:10px;padding:.9rem;margin-bottom:1rem;font-size:12px;color:#2E5A00;text-align:left;line-height:1.6">
      <strong><i class="ti ti-pencil"></i> Préinscription</strong> — Votre inscription est enregistrée mais reste provisoire. Elle sera confirmée définitivement à l'ouverture officielle des inscriptions.
    </div>`:''}
        <!-- Bloc calendrier -->
    <div style="background:#F0FFF4;border:1.5px solid #6BAA38;border-radius:12px;padding:1rem;margin-bottom:1rem;text-align:left">
      <div style="font-size:12px;font-weight:700;color:#2E6B12;margin-bottom:.5rem"><i class="ti ti-calendar-plus" style="font-size:14px;vertical-align:-2px"></i> Ajouter l’événement à votre agenda</div>
      <div style="font-size:12px;color:#3B6D11;margin-bottom:.75rem">Entreprends Demain ! · Mardi 22 sept. 2026 · 10h–17h · Cité des Métiers de Paris</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="${_googleCalUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;background:#4285F4;color:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;text-decoration:none;font-family:var(--font)"><i class="ti ti-brand-google"></i> Google Calendar</a>
        <a href="${_icsUrl}" download="entreprends-demain-2026.ics" style="display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;text-decoration:none;font-family:var(--font)"><i class="ti ti-calendar-down"></i> Apple / Outlook (.ics)</a>
      </div>
    </div>
    <button id="code-ok-btn" style="background:var(--cyan);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-family:var(--font);font-size:14px;font-weight:700;cursor:pointer;width:100%">J'ai noté mon code → Continuer</button>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('code-ok-btn').addEventListener('click',()=>{
    URL.revokeObjectURL(_icsUrl);
    overlay.remove();
    if(pendingExp)openDrawer(pendingExp);
  });
}
async function applyQuickCode(codeInputId,statusId,fieldPrefix){
  const code=(el(codeInputId)?.value||'').trim();
  const status=el(statusId);
  if(!/^\d{6}$/.test(code)){if(status){status.textContent='⚠️ Le code doit contenir 6 chiffres.';status.style.color='var(--red)';}return;}
  if(status){status.textContent='Recherche…';status.style.color='var(--ink3)';}
  let visitor=DATA.visitors.find(v=>v.code===code);
  if(!visitor){
    try{const snap=await getDocs(collection(db,'visitors'));DATA.visitors=snap.docs.map(d=>({id:d.id,...d.data()}));visitor=DATA.visitors.find(v=>v.code===code);}catch(e){console.error(e);}
  }
  if(!visitor){if(status){status.textContent='❌ Code introuvable.';status.style.color='var(--red)';}return;}
  let prev=DATA.bookings.find(b=>(b.email||'').toLowerCase()===visitor.email);
  if(!prev){try{const snap=await getDocs(query(collection(db,'bookings'),orderBy('slotStart')));DATA.bookings=snap.docs.map(d=>({id:d.id,...d.data()}));prev=DATA.bookings.find(b=>(b.email||'').toLowerCase()===visitor.email);}catch(e){console.error(e);}}
  if(!prev){const ins=DATA.inscriptions.find(i=>(i.email||'').toLowerCase()===visitor.email);if(ins)prev=ins;}
  const fillLock = (prenom,nom,email,societe,structure) => {
    ['prenom','nom','email','societe'].forEach(f=>{
      const e=el(fieldPrefix+'-'+f);
      if(e){e.value=f==='prenom'?prenom:f==='nom'?nom:f==='email'?email:societe;e.readOnly=true;e.style.background='var(--cyan-l)';e.style.color='var(--cyan-d)';e.style.fontWeight='600';}
    });
    // Préremplir le champ structure si société renseignée
    if(societe && structure){
      const sw=el(fieldPrefix+'-structure-wrap');
      const ss=el(fieldPrefix+'-structure-search');
      const sh=el(fieldPrefix+'-structure');
      if(sw) sw.style.display='block';
      if(ss){ ss.value=structure; ss.readOnly=true; ss.style.background='var(--cyan-l)'; ss.style.color='var(--cyan-d)'; ss.style.fontWeight='600'; }
      if(sh) sh.value=structure;
    }
    if(status){status.textContent='✓ Informations pré-remplies.';status.style.color='#2E6B12';}
    setTimeout(()=>{
      const focus = fieldPrefix==='m' ? el('m-problematique') : el(fieldPrefix+'-prenom');
      if(focus&&!focus.value) focus.focus();
    },100);
  }
  if(prev){fillLock(prev.prenom||'',prev.nom||'',prev.email||visitor.email,prev.societe||'',prev.structure||'');}
  else{const e=el(fieldPrefix+'-email');if(e){e.value=visitor.email;e.readOnly=true;}if(status){status.textContent='✓ Code reconnu.';status.style.color='#2E6B12';}}
  setTimeout(()=>el(fieldPrefix==='m'?'m-problematique':fieldPrefix+'-prenom')?.focus(),100);
}

/* ── Modal RDV ────────────────────────────────────────────────── */
function openModal(start,end){
  pendingSlot=start;
  const exp=DATA.exposants.find(e=>e.id===pendingExp);
  el('m-info').textContent=`${exp.name} · ${start}–${end} · ${start>='14:00'?'Après-midi':'Matin'} · 22 sept. 2026`;
  ['m-prenom','m-nom','m-email','m-societe','m-problematique','m-code-rapide','m-structure-search'].forEach(id=>{const e=el(id);if(e){e.value='';e.readOnly=false;e.style.background='';e.style.color='';e.style.fontWeight='';}});
  if(el('m-rgpd'))el('m-rgpd').checked=false;
  if(el('m-structure-search'))el('m-structure-search').value='';
  if(el('m-structure'))el('m-structure').value='';
  if(el('m-structure-wrap'))el('m-structure-wrap').style.display='none';
  if(el('m-code-status')){el('m-code-status').textContent='Vos informations seront pré-remplies automatiquement.';el('m-code-status').style.color='var(--ink3)';}
  el('modal').classList.add('open');
  el('m-code-apply').onclick=()=>applyQuickCode('m-code-rapide','m-code-status','m');
  el('m-code-rapide').onkeydown=e=>{if(e.key==='Enter')applyQuickCode('m-code-rapide','m-code-status','m');};
  setTimeout(()=>el('m-code-rapide')?.focus(),80);
}
/* ── Modal liste d'attente ────────────────────────────────────── */

function openModalWait(type, slotStart, slotEnd, expId, atId) {
  // Réutilise le modal existant en changeant le titre
  const at = atId ? DATA.ateliers.find(a=>a.id===atId) : null;
  const exp = expId ? DATA.exposants.find(e=>e.id===expId) : null;
  const waitQueue = type==='rdv' ? waitPosRdv(expId,slotStart) : waitPosAtelier(atId);

  pendingSlot = slotStart;
  if(expId) pendingExp = expId;
  if(atId) pendingAtelierId = atId;

  const infoText = type==='rdv'
    ? `${exp?.name} · ${slotStart}–${slotEnd} · Créneau complet`
    : `${at?.titre} · ${at?.start}–${at?.end} · Atelier complet`;

  el('m-info').innerHTML = `<span style="color:var(--am);font-weight:600"><i class="ti ti-clock" style="font-size:12px"></i> Liste d'attente — position ${waitQueue.length+1}</span><br><span style="font-size:11px">${infoText}</span>`;
  document.querySelector('#modal .modal-title').textContent = "S'inscrire en liste d'attente";
  document.querySelector('#modal-confirm').innerHTML = '<i class="ti ti-clock"></i> Rejoindre la liste d\'attente';
  document.querySelector('#modal-confirm').style.background = '#B85C1A';
  document.querySelector('#modal-confirm').style.border = 'none';
  document.querySelector('#modal-confirm').style.fontSize = '14px';
  document.querySelector('#modal-confirm').style.padding = '12px 20px';

  ['m-prenom','m-nom','m-email','m-societe','m-problematique','m-code-rapide','m-structure-search'].forEach(id=>{const e=el(id);if(e){e.value='';e.readOnly=false;e.style.background='';e.style.color='';e.style.fontWeight='';}});
  if(el('m-rgpd'))el('m-rgpd').checked=false;
  if(el('m-structure-search'))el('m-structure-search').value='';
  if(el('m-structure'))el('m-structure').value='';
  if(el('m-structure-wrap'))el('m-structure-wrap').style.display='none';

  // Surcharger le confirm pour liste d'attente
  el('modal-confirm').onclick = () => confirmWaitlist(type, expId, atId, slotStart, slotEnd);
  el('modal').classList.add('open');
  setTimeout(()=>el('m-code-rapide')?.focus(),80);
  el('m-code-apply').onclick=()=>applyQuickCode('m-code-rapide','m-code-status','m');
  el('m-code-rapide').onkeydown=e=>{if(e.key==='Enter')applyQuickCode('m-code-rapide','m-code-status','m');};
}

async function confirmWaitlist(type, expId, atId, slotStart, slotEnd) {
  const prenom=el('m-prenom').value.trim(), nom=el('m-nom').value.trim();
  const email=el('m-email').value.trim(), societe=el('m-societe').value.trim();
  const problematique=el('m-problematique')?.value.trim()||'';
  const structure=el('m-structure')?.value||'';
  if(!prenom||!nom){toast('Merci de renseigner prénom et nom.');return;}
  if(!email){toast('Merci de renseigner votre email.');return;}
  if(!el('m-rgpd')?.checked){toast(`Merci d'accepter la politique de confidentialité.`);return;}

  // Vérifier pas déjà en liste d'attente
  const alreadyWait = type==='rdv'
    ? getWaitRdv(expId, slotStart, email)
    : getWaitAtelier(atId, email);
  if(alreadyWait){toast(`Vous êtes déjà sur la liste d'attente pour ce créneau.`);closeModal();return;}

  // Vérifier pas déjà inscrit
  if(type==='rdv'){
    const already=DATA.bookings.find(b=>b.exposantId===expId&&b.slotStart===slotStart&&(b.email||'').toLowerCase()===email.toLowerCase());
    if(already){toast('Vous avez déjà ce RDV.');closeModal();return;}
  } else {
    const already=DATA.inscriptions.find(i=>i.atelierId===atId&&(i.email||'').toLowerCase()===email.toLowerCase());
    if(already){toast('Vous êtes déjà inscrit à cet atelier.');closeModal();return;}
  }

  const slot = type==='rdv' ? getSlots(expId).find(s=>s.start===slotStart) : null;
  loader(true);
  try {
    const {code,isNew} = await getOrCreateVisitorCode(email);
    const ref = await addDoc(collection(db,'waitlist'),{
      ...(type==='rdv' ? {expId, slotStart, slotEnd: slotEnd||slot?.end||'', period: slot?.period||''} : {atelierId: atId}),
      type, prenom, nom, email, societe, problematique, structure,
      consentRgpd: true, consentDate: new Date().toISOString(), createdAt: Date.now(),
    });
    DATA.waitlist.push({id:ref.id, ...(type==='rdv'?{expId,slotStart,slotEnd:slot?.end,period:slot?.period}:{atelierId:atId}), type, prenom, nom, email, societe});

    // Reset le bouton confirm
    el('modal-confirm').onclick = confirmBooking;
    el('modal-confirm').innerHTML = '<i class="ti ti-calendar-check"></i> Confirmer';
    el('modal-confirm').style.background = '';
    document.querySelector('#modal .modal-title').textContent = 'Confirmer votre RDV';
    closeModal();

    const pos = type==='rdv' ? waitPosRdv(expId,slotStart).length : waitPosAtelier(atId).length;
    const name = type==='rdv' ? DATA.exposants.find(e=>e.id===expId)?.name : DATA.ateliers.find(a=>a.id===atId)?.titre;

    if(isNew) showCodeModal(code,prenom,name,slotStart||'',slotEnd||'');
    else {
      // Afficher confirmation liste d'attente
      const overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';
      overlay.innerHTML=`<div style="background:#fff;border-radius:20px;padding:2rem;max-width:400px;width:100%;text-align:center;border:2px solid var(--am);box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <i class="ti ti-clock" style="font-size:40px;color:var(--am);display:block;margin-bottom:.75rem"></i>
        <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:.5rem">Inscrit en liste d'attente !</div>
        <div style="font-size:13px;color:var(--ink3);margin-bottom:1rem">${name} · Position <strong style="color:var(--am);font-size:18px">${pos}</strong></div>
        <div style="background:#FEF3EB;border:1.5px solid var(--am-brd);border-radius:10px;padding:.9rem;margin-bottom:1.25rem;font-size:12px;color:#5A2D00;text-align:left;line-height:1.6">
          En cas de désistement, vous serez automatiquement inscrit(e) et votre place confirmée. Vous pouvez retrouver et annuler votre inscription en liste d'attente depuis "Mon Planning".
        </div>
        <button onclick="this.closest('div[style]').remove()" style="background:var(--am);color:#fff;border:none;border-radius:10px;padding:10px 24px;font-family:var(--font);font-size:14px;font-weight:700;cursor:pointer;width:100%">Compris !</button>
      </div>`;
      document.body.appendChild(overlay);
    }
    if(type==='rdv') openDrawer(expId);
    else renderAteliersGrid();
  } catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

function closeModal(){
  el('modal')?.classList.remove('open');
  // Remettre le bouton confirm à son état normal
  const btn=el('modal-confirm');
  if(btn){
    btn.onclick=confirmBooking;
    btn.innerHTML='<i class="ti ti-calendar-check"></i> Confirmer';
    btn.style.background='';
    btn.style.border='';
    btn.style.fontSize='';
    btn.style.padding='';
  }
  const title=document.querySelector('#modal .modal-title');
  if(title)title.textContent='Confirmer votre RDV';
}

async function confirmBooking(){
  const prenom=el('m-prenom').value.trim(),nom=el('m-nom').value.trim(),email=el('m-email').value.trim();
  const societe=el('m-societe').value.trim(),problematique=el('m-problematique').value.trim();
  if(!prenom||!nom){toast('Merci de renseigner prénom et nom.');return;}
  if(!email){toast('Merci de renseigner votre email.');return;}
  if(!problematique){toast('Merci de décrire votre problématique.');return;}
  if(!el('m-rgpd')?.checked){toast('Merci d\'accepter la politique de confidentialité.');return;}
  const _bookKey = email.toLowerCase()+'__'+pendingExp+'__'+pendingSlot;
  if(_submitting.has(_bookKey)){toast('Inscription déjà en cours…');return;}
  _submitting.add(_bookKey);
  const structure = el('m-structure')?.value.trim() || el('m-structure-search')?.value.trim() || '';
  if(el('m-societe')?.value.trim() && !structure){ toast('Merci de sélectionner votre type de structure dans la liste déroulante.'); el('m-structure-search')?.focus(); return; }
  const doublon=DATA.bookings.find(b=>b.exposantId===pendingExp&&(b.email||'').toLowerCase()===email.toLowerCase());
  if(doublon){toast(`Vous avez déjà un RDV avec cet expert à ${doublon.slotStart}.`);closeModal();return;}
  // Vérif créneau déjà occupé (autre expert même heure)
  const slot=getSlots(pendingExp).find(s=>s.start===pendingSlot);
  const toMinC=t=>{if(!t)return 0;const[h,m]=t.split(':').map(Number);return h*60+m;};
  const pS=toMinC(pendingSlot),pE=toMinC(slot?.end||pendingSlot);
  const slotConflict=DATA.bookings.find(b=>{
    if((b.email||'').toLowerCase()!==email.toLowerCase())return false;
    const bS=toMinC(b.slotStart),bE=toMinC(b.slotEnd||b.slotStart);
    return bS<pE&&pS<bE;
  });
  if(slotConflict){const expC=DATA.exposants.find(e=>e.id===slotConflict.exposantId);toast(`Vous avez déjà un RDV sur ce créneau (${slotConflict.slotStart}–${slotConflict.slotEnd} avec ${expC?.name||'un expert'}).`);return;}
  // Vérif conflits ateliers
  const conflict=DATA.inscriptions.find(i=>(i.email||'').toLowerCase()===email.toLowerCase()&&checkTimeConflict(pendingSlot,slot?.end,i.atelierId));
  if(conflict){const at=DATA.ateliers.find(a=>a.id===conflict.atelierId);toast(`Conflit d'horaire avec l'atelier "${at?.titre}" à ${at?.start}.`);return;}
  loader(true);
  try{
    const{code,isNew}=await getOrCreateVisitorCode(email);
    const ref=await addDoc(collection(db,'bookings'),{exposantId:pendingExp,slotStart:pendingSlot,slotEnd:slot?.end||'',period:slot?.period||'',prenom,nom,email,societe,structure,problematique,mode:PLATFORM_MODE,consentRgpd:true,consentDate:new Date().toISOString(),createdAt:Date.now()});
    DATA.bookings.push({id:ref.id,exposantId:pendingExp,slotStart:pendingSlot,slotEnd:slot?.end,period:slot?.period,prenom,nom,email,societe,problematique});
    closeModal();
    if(isNew){showCodeModal(code,prenom,DATA.exposants.find(e=>e.id===pendingExp)?.name,pendingSlot,slot?.end,PLATFORM_MODE==='preinscription');}
    else{el('d-confirm').innerHTML=`<div class="confirm-ok"><i class="ti ti-circle-check"></i><div>RDV confirmé — ${prenom} ${nom}<br><span style="font-weight:400;font-size:12px">${pendingSlot}–${slot?.end}</span></div></div>`;openDrawer(pendingExp);}
    toast(PLATFORM_MODE==='preinscription'?`Préinscription enregistrée !`:`RDV confirmé !`);
  }catch(e){console.error(e);toast('Erreur.');}finally{_submitting.delete(_bookKey);}
  loader(false);
}

function checkTimeConflict(start,end,atelierId){
  const at=DATA.ateliers.find(a=>a.id===atelierId);if(!at)return false;
  const toMin=t=>{const[h,m]=t.split(':').map(Number);return h*60+m;};
  const s1=toMin(start),e1=toMin(end||start),s2=toMin(at.start),e2=toMin(at.end);
  return s1<e2&&s2<e1;
}

/* ── Ateliers visiteur ────────────────────────────────────────── */
function renderAteliersGrid(){
  const search=(el('at-search')?.value||'').toLowerCase();
  const catF=el('at-cat')?.value||'';
  const catSel=el('at-cat');
  if(catSel){const cur=catSel.value;const catList=(DATA.categories.length?DATA.categories.map(c=>c.name):ALL_CATS);catSel.innerHTML='<option value="">Toutes catégories</option>'+catList.map(c=>`<option value="${c}"${c===cur?' selected':''}>${c}</option>`).join('');}
  const grid=el('ateliers-grid');if(!grid)return;
  if(!DATA.ateliers.length){grid.innerHTML='<div class="empty-state"><i class="ti ti-school"></i><p>Aucun atelier disponible pour le moment.</p></div>';return;}
  const list=DATA.ateliers.filter(at=>{
    const ms=!search||at.titre.toLowerCase().includes(search)||(at.description||'').toLowerCase().includes(search);
    const mc=!catF||(at.categories||[]).includes(catF);
    const mp=!atPeriodFilter||at.period===atPeriodFilter;
    return ms&&mc&&mp;
  }).sort((a,b)=>a.start.localeCompare(b.start));
  if(!list.length){grid.innerHTML='<div class="empty-state"><i class="ti ti-search"></i><p>Aucun atelier trouvé.</p></div>';return;}
  grid.innerHTML=list.map(at=>{
    const inscrits=DATA.inscriptions.filter(i=>i.atelierId===at.id).length;
    const full=at.places>0&&inscrits>=at.places;
    const animNames=((at.animateurs||[]).map(id=>DATA.exposants.find(e=>e.id===id)?.name||'').filter(Boolean).join(', '))||at.intervenantLibre||'';
    const cats=(at.categories||[]).map(c=>`<span class="at-cat-tag">${c.split(',')[0].trim()}</span>`).join(' ');
    const isPm=at.period==='aprem';
    return`<div class="atelier-card">
      <div class="at-header">
        <div class="at-time-badge${isPm?' pm':''}">${at.start}–${at.end}</div>
        <div style="flex:1"><div class="at-title">${at.titre}</div><div class="at-salle"><i class="ti ti-map-pin" style="font-size:11px"></i> ${at.salle}</div></div>
      </div>
      ${at.description?`<div class="at-desc">${at.description}</div>`:''}
      ${animNames?`<div class="at-animateurs"><i class="ti ti-user-star" style="font-size:12px"></i> ${animNames}</div>`:''}
      <div class="at-cats">${cats}</div>
      <div class="at-footer">
        <div class="at-places${full?' full':`}`}"><strong>${inscrits}</strong>${at.places>0?` / ${at.places} places`:' inscrits'}${full?' · COMPLET':''}</div>
        ${full
          ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
               <span style="font-size:12px;color:var(--red);font-weight:600">Complet</span>
               <button class="btn-ghost" style="padding:4px 12px;font-size:12px;border-color:var(--am-brd);color:var(--am)" data-atid-wait="${at.id}"><i class="ti ti-clock" style="font-size:11px"></i> Liste d'attente (${waitPosAtelier(at.id).length})</button>
             </div>`
          : `<button class="btn-primary" style="padding:6px 14px;font-size:12px" data-atid="${at.id}"><i class="ti ti-plus"></i> S'inscrire</button>`}
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-atid]').forEach(btn=>btn.addEventListener('click',()=>openModalAtelier(btn.dataset.atid)));
  grid.querySelectorAll('[data-atid-wait]').forEach(btn=>btn.addEventListener('click',()=>openModalWait('atelier',null,null,null,btn.dataset.atidWait)));
}

/* ── Flash Talks (visiteur) ─────────────────────────────────────── */
function renderFlashTalksGrid(){
  const grid=el('flashtalks-grid');if(!grid)return;
  if(!DATA.flashTalks.length){grid.innerHTML='<div class="empty-state"><i class="ti ti-bolt"></i><p>Aucun flash talk programmé pour le moment.</p></div>';return;}
  const list=[...DATA.flashTalks].sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  grid.innerHTML=list.map(ft=>{
    return`<div class="atelier-card">
      <div class="at-header">
        <div class="at-time-badge">${ft.start||'–'}${ft.end?'–'+ft.end:''}</div>
        <div style="flex:1">
          <div class="at-title">${ft.sujet||ft.titre||'Flash talk'}</div>
          ${ft.thematique?`<div class="at-salle"><i class="ti ti-tag" style="font-size:11px"></i> ${ft.thematique}</div>`:''}
        </div>
      </div>
      ${ft.intervenant?`<div class="at-animateurs"><i class="ti ti-user-star" style="font-size:12px"></i> ${ft.intervenant}</div>`:''}
    </div>`;
  }).join('');
}

function openModalAtelier(atId){
  if(PLATFORM_MODE === 'lecture'){ toast(`Inscriptions disponibles à partir du ${DATA.config.lectureDate||'1er juillet 2026'}.`); return; }
  pendingAtelierId=atId;
  const at=DATA.ateliers.find(a=>a.id===atId);if(!at)return;
  el('ma-info').textContent=`${at.titre} · ${at.start}–${at.end} · ${at.salle} · 22 sept. 2026`;
  ['ma-prenom','ma-nom','ma-email','ma-societe','ma-code-rapide','ma-structure-search'].forEach(id=>{const e=el(id);if(e){e.value='';e.readOnly=false;e.style.background='';e.style.color='';e.style.fontWeight='';}});
  if(el('ma-rgpd'))el('ma-rgpd').checked=false;
  if(el('ma-structure-search'))el('ma-structure-search').value='';
  if(el('ma-structure'))el('ma-structure').value='';
  if(el('ma-structure-wrap'))el('ma-structure-wrap').style.display='none';
  if(el('ma-code-status')){el('ma-code-status').textContent='Vos informations seront pré-remplies automatiquement.';el('ma-code-status').style.color='var(--ink3)';}
  el('modal-atelier').classList.add('open');
  el('ma-code-apply').onclick=()=>applyQuickCode('ma-code-rapide','ma-code-status','ma');
  el('ma-code-rapide').onkeydown=e=>{if(e.key==='Enter')applyQuickCode('ma-code-rapide','ma-code-status','ma');};
  setTimeout(()=>el('ma-code-rapide')?.focus(),80);
}

async function confirmAtelier(){
  const prenom=el('ma-prenom').value.trim(),nom=el('ma-nom').value.trim(),email=el('ma-email').value.trim(),societe=el('ma-societe').value.trim();
  if(!prenom||!nom){toast('Merci de renseigner prénom et nom.');return;}
  if(!email){toast('Merci de renseigner votre email.');return;}
  if(!el('ma-rgpd')?.checked){toast('Merci d\'accepter la politique de confidentialité.');return;}
  const structureAt = el('ma-structure')?.value.trim() || el('ma-structure-search')?.value.trim() || '';
  if(el('ma-societe')?.value.trim() && !structureAt){ toast('Merci de sélectionner votre type de structure dans la liste déroulante.'); el('ma-structure-search')?.focus(); return; }
  const at=DATA.ateliers.find(a=>a.id===pendingAtelierId);
  const alreadyIn=DATA.inscriptions.find(i=>i.atelierId===pendingAtelierId&&(i.email||'').toLowerCase()===email.toLowerCase());
  if(alreadyIn){toast('Vous êtes déjà inscrit à cet atelier.');return;}
  const _atKey = email.toLowerCase()+'__at__'+pendingAtelierId;
  if(_submitting.has(_atKey)){toast('Inscription déjà en cours…');return;}
  _submitting.add(_atKey);
  const inscrits=DATA.inscriptions.filter(i=>i.atelierId===pendingAtelierId).length;
  if(at.places>0&&inscrits>=at.places){toast('Cet atelier est complet.');return;}
  // Vérif conflits RDV
  const conflictRdv=DATA.bookings.find(b=>(b.email||'').toLowerCase()===email.toLowerCase()&&checkTimeConflict(at.start,at.end,null));
  // check manual for RDV
  const toMin=t=>{const[h,m]=t.split(':').map(Number);return h*60+m;};
  const s2=toMin(at.start),e2=toMin(at.end);
  const rdvConflict=DATA.bookings.find(b=>{if((b.email||'').toLowerCase()!==email.toLowerCase())return false;const s1=toMin(b.slotStart),e1=toMin(b.slotEnd||b.slotStart);return s1<e2&&s2<e1;});
  if(rdvConflict){const exp=DATA.exposants.find(e=>e.id===rdvConflict.exposantId);toast(`Conflit avec votre RDV chez ${exp?.name} à ${rdvConflict.slotStart}.`);return;}
  const atConflict=DATA.inscriptions.find(i=>{if((i.email||'').toLowerCase()!==email.toLowerCase())return false;const oa=DATA.ateliers.find(a=>a.id===i.atelierId);if(!oa)return false;const s1=toMin(oa.start),e1=toMin(oa.end);return s1<e2&&s2<e1;});
  if(atConflict){const oa=DATA.ateliers.find(a=>a.id===atConflict.atelierId);toast(`Conflit avec l'atelier "${oa?.titre}" à ${oa?.start}.`);return;}
  loader(true);
  try{
    const{code,isNew}=await getOrCreateVisitorCode(email);
    const ref=await addDoc(collection(db,'inscriptions'),{atelierId:pendingAtelierId,prenom,nom,email,societe,structure:structureAt,consentRgpd:true,consentDate:new Date().toISOString(),createdAt:Date.now()});
    DATA.inscriptions.push({id:ref.id,atelierId:pendingAtelierId,prenom,nom,email,societe});
    el('modal-atelier').classList.remove('open');
    if(isNew)showCodeModal(code,prenom,at.titre,at.start,at.end,PLATFORM_MODE==='preinscription');
    else toast(PLATFORM_MODE==='preinscription'?`Préinscription enregistrée — ${at.titre} !`:`Inscription confirmée — ${at.titre} !`);
    renderAteliersGrid();
  }catch(e){console.error(e);toast('Erreur.');}finally{_submitting.delete(_atKey);}
  loader(false);
}

/* ── Mon planning ─────────────────────────────────────────────── */
async function searchMonPlanning(){
  const input=(el('mes-search-input')?.value||'').trim();
  const result=el('mes-result');if(!result||!input)return;
  if(!input){result.innerHTML='<div class="rdv-empty"><i class="ti ti-id-badge"></i><p>Saisissez votre code ou email.</p></div>';return;}
  const isCode=/^\d{6}$/.test(input);
  const emailLow=input.toLowerCase();
  let email,hasCode=false;
  if(isCode){
    let visitor=DATA.visitors.find(v=>v.code===input);
    if(!visitor){try{const s=await getDocs(collection(db,'visitors'));DATA.visitors=s.docs.map(d=>({id:d.id,...d.data()}));visitor=DATA.visitors.find(v=>v.code===input);}catch(e){}}
    if(!visitor){result.innerHTML='<div class="rdv-empty"><i class="ti ti-x"></i><p>Code introuvable.</p></div>';return;}
    email=visitor.email;hasCode=true;
  } else {email=emailLow;}
  const bk=DATA.bookings.filter(b=>(b.email||'').toLowerCase()===email);
  const ins=DATA.inscriptions.filter(i=>(i.email||'').toLowerCase()===email);
  if(!bk.length&&!ins.length){result.innerHTML='<div class="rdv-empty"><i class="ti ti-calendar-off"></i><p>Aucun élément trouvé.</p></div>';return;}
  const first=bk[0]||ins[0];
  // Recharger waitlist depuis Firebase si vide (données fraîches)
  if(!DATA.waitlist.length){
    try{const ws=await getDocs(query(collection(db,'waitlist'),orderBy('createdAt')));DATA.waitlist=ws.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error(e);}
  }
  // Recharger la waitlist fraîche depuis Firebase
  try{const ws=await getDocs(query(collection(db,'waitlist'),orderBy('createdAt')));DATA.waitlist=ws.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.error(e);}

  const waits=DATA.waitlist.filter(w=>(w.email||'').toLowerCase()===email);

  // 3 listes séparées triées chronologiquement
  const rdvItems = bk.map(b=>{
    const exp=DATA.exposants.find(e=>e.id===b.exposantId);
    return{id:b.id,time:b.slotStart,end:b.slotEnd,title:exp?.name||'–',sub:(exp?.cat||'')+(exp?.expertise?' · '+exp.expertise:''),prob:b.problematique||'',type:'rdv',period:b.period,canCancel:hasCode};
  }).sort((a,b)=>a.time.localeCompare(b.time));

  const atelierItems = ins.map(i=>{
    const at=DATA.ateliers.find(a=>a.id===i.atelierId);
    return{id:i.id,time:at?.start||'',end:at?.end||'',title:at?.titre||'–',sub:at?.salle||'',type:'atelier',period:at?.period||'',canCancel:hasCode};
  }).sort((a,b)=>a.time.localeCompare(b.time));

  const waitItems = waits.map(w=>{
    const exp=w.expId?DATA.exposants.find(e=>e.id===w.expId):null;
    const at=w.atelierId?DATA.ateliers.find(a=>a.id===w.atelierId):null;
    const queue=w.expId?waitPosRdv(w.expId,w.slotStart):waitPosAtelier(w.atelierId);
    const pos=queue.findIndex(x=>x.id===w.id)+1;
    return{id:w.id,time:w.slotStart||at?.start||'',end:w.slotEnd||at?.end||'',title:exp?.name||at?.titre||'–',sub:exp?(exp.cat+(exp.expertise?' · '+exp.expertise:'')):(at?.salle||''),subType:exp?'RDV':'Atelier',type:w.expId?'rdv':'atelier',period:w.period||at?.period||'',canCancel:hasCode,waitPos:pos};
  }).sort((a,b)=>a.time.localeCompare(b.time));

  function planItem(item, isWait=false){
    const isPm=item.period==='aprem', isAt=item.type==='atelier';
    const cls=isWait?'wait-item-red':(isAt?(isPm?'at-pm':'at-am'):(isPm?'rdv-pm':'rdv-am'));
    const timeColor=isWait?'#B85C1A':(isAt?'#3B6D11':(isPm?'#B8940A':'var(--cyan)'));
    const badge=isWait
      ?`<span class="pi-type" style="background:#B85C1A;color:#fff">Att. #${item.waitPos}</span>`
      :(isAt?'<span class="pi-type type-at">Atelier</span>':'<span class="pi-type type-rdv">RDV</span>');
    const dataType=isWait?('wait-'+(isAt?'atelier':'rdv')):item.type;
    const cancelBtn=item.canCancel
      ?`<button class="cancel-rdv-btn" data-id="${item.id}" data-type="${dataType}" data-title="${item.title}" data-time="${item.time}"><i class="ti ti-trash"></i></button>`:'';
    return`<div class="planning-item ${cls}">
      <div class="pi-time" style="color:${timeColor}">${item.time}–${item.end}</div>
      <div class="pi-info">
        <div class="pi-title">${item.title}${isWait?` <span style="font-size:11px;font-weight:400;color:#B85C1A">(${item.subType})</span>`:''}</div>
        <div class="pi-sub">${item.sub}${!isWait&&item.prob?' · "'+item.prob+'"':''}</div>
      </div>
      ${badge}${cancelBtn}
    </div>`;
  }

  const sectionTitle = (icon, label, count, color='var(--cyan)') =>
    `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:${color};display:flex;align-items:center;gap:6px;margin:1.25rem 0 .5rem;padding-bottom:.4rem;border-bottom:2px solid ${color}22">
      <i class="ti ${icon}"></i> ${label} <span style="font-weight:400;font-size:11px;opacity:.7">${count}</span>
    </div>`;

  const hasAnything = rdvItems.length||atelierItems.length||waitItems.length;
  if(!hasAnything){result.innerHTML='<div class="rdv-empty"><i class="ti ti-calendar-off"></i><p>Aucun élément trouvé.</p></div>';return;}

  result.innerHTML=`
    <div class="mes-rdv-header">
      <div style="font-size:15px;font-weight:700">${first?.prenom||''} ${first?.nom||''}</div>
      <div style="font-size:13px;color:var(--ink3);margin-top:2px">${rdvItems.length} RDV · ${atelierItems.length} atelier${atelierItems.length>1?'s':''} · ${waitItems.length?waitItems.length+' en attente · ':''}22 septembre 2026</div>
      ${!hasCode
        ?'<div style="font-size:12px;color:#B8940A;background:#FFF8E6;border:1px solid #FFD82B;border-radius:6px;padding:6px 10px;margin-top:8px"><i class="ti ti-lock"></i> Mode lecture seule — saisissez votre code pour annuler.</div>'
        :'<div style="font-size:12px;color:#2E6B12;background:#EAF3DE;border:1px solid #6BAA38;border-radius:6px;padding:6px 10px;margin-top:8px"><i class="ti ti-lock-open"></i> Accès complet — vous pouvez annuler.</div>'}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--brd);font-size:11px;color:var(--ink3)">
        Conformément au RGPD, vous pouvez demander la suppression de vos données en contactant
        <a href="mailto:entreprends.demain@paris-initiative.org" style="color:var(--cyan)">entreprends.demain@paris-initiative.org</a> ·
        <a href="rgpd.html" style="color:var(--cyan)">Politique de confidentialité</a>
      </div>
    </div>

    ${rdvItems.length?sectionTitle('ti-users','RDV Individuels',rdvItems.length,'var(--cyan)')+rdvItems.map(i=>planItem(i,false)).join(''):''}
    ${atelierItems.length?sectionTitle('ti-school','Ateliers',atelierItems.length,'#3B6D11')+atelierItems.map(i=>planItem(i,false)).join(''):''}
    ${waitItems.length?sectionTitle("ti-clock","Liste d'attente",waitItems.length,"#B85C1A")+waitItems.map(i=>planItem(i,true)).join(''):''}
  `;

  result.querySelectorAll('.cancel-rdv-btn').forEach(btn=>{
    const t=btn.dataset.type;
    if(t==='wait-rdv'||t==='wait-atelier'){
      btn.addEventListener('click',async()=>{
        if(!confirm(`Quitter la liste d'attente pour "${btn.dataset.title}" ?`))return;
        loader(true);
        try{
          await deleteDoc(doc(db,'waitlist',btn.dataset.id));
          DATA.waitlist=DATA.waitlist.filter(w=>w.id!==btn.dataset.id);
          toast(`Retiré de la liste d'attente.`);searchMonPlanning();
        }catch(e){console.error(e);toast('Erreur.');}
        loader(false);
      });
    } else {
      btn.addEventListener('click',()=>cancelItem(btn.dataset.id,btn.dataset.type,btn.dataset.title,btn.dataset.time));
    }
  });
}

async function cancelItem(id,type,title,time){
  if(!confirm(`Annuler ${type==='rdv'?'votre RDV':'votre inscription à l\'atelier'} "${title}" à ${time} ?`))return;
  loader(true);
  try{
    const item = type==='rdv'
      ? DATA.bookings.find(b=>b.id===id)
      : DATA.inscriptions.find(i=>i.id===id);
    await deleteDoc(doc(db,type==='rdv'?'bookings':'inscriptions',id));
    if(type==='rdv'){
      DATA.bookings=DATA.bookings.filter(b=>b.id!==id);
      // Promouvoir le premier de la liste d'attente
      if(item) await promoteWaitlistRdv(item.exposantId, item.slotStart);
    } else {
      DATA.inscriptions=DATA.inscriptions.filter(i=>i.id!==id);
      if(item) await promoteWaitlistAtelier(item.atelierId);
    }
    toast('Annulé.');searchMonPlanning();renderAteliersGrid();
    if(type==='rdv'&&item)openDrawer(item.exposantId);
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Profil exposant public ───────────────────────────────────── */
async function searchExposantPlanning(){
  const emailInput=(el('exp-email-input')?.value||'').trim().toLowerCase();
  const result=el('exp-result');if(!result||!emailInput)return;
  loader(true);
  // Reload to get fresh data
  try{
    const[bS,aS,iS]=await Promise.all([getDocs(query(collection(db,'bookings'),orderBy('slotStart'))),getDocs(query(collection(db,'ateliers'),orderBy('start'))),getDocs(collection(db,'inscriptions'))]);
    DATA.bookings=bS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.ateliers=aS.docs.map(d=>({id:d.id,...d.data()}));
    DATA.inscriptions=iS.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){console.error(e);}
  const exp=DATA.exposants.find(e=>(e.email||'').toLowerCase()===emailInput);
  if(!exp){result.innerHTML='<div class="rdv-empty"><i class="ti ti-search"></i><p>Aucun exposant trouvé avec cet email.</p></div>';loader(false);return;}
  const rdvs=DATA.bookings.filter(b=>b.exposantId===exp.id).sort((a,b)=>a.slotStart.localeCompare(b.slotStart));
  const ateliers=DATA.ateliers.filter(at=>(at.animateurs||[]).includes(exp.id)).sort((a,b)=>a.start.localeCompare(b.start));
  result.innerHTML=`<div class="mes-rdv-header" style="margin-bottom:1rem">
    <div style="font-size:16px;font-weight:700;color:var(--cyan)">${exp.name}</div>
    <div style="font-size:13px;color:var(--ink3)">${exp.cat}${exp.expertise?' · '+exp.expertise:''}</div>
    ${exp.adresse?`<div style="font-size:12px;color:var(--ink3);margin-top:4px"><i class="ti ti-map-pin" style="font-size:12px"></i> ${exp.adresse}</div>`:''}
    <div style="font-size:13px;margin-top:8px"><strong>${rdvs.length}</strong> RDV · <strong>${ateliers.length}</strong> atelier${ateliers.length>1?'s':''} animé${ateliers.length>1?'s':''}</div>
  </div>
  ${rdvs.length?`<div class="planning-section-title">RDV individuels</div>`+rdvs.map(b=>{const isPm=b.period==='aprem';return`<div class="planning-item ${isPm?'rdv-pm':'rdv-am'}"><div class="pi-time" style="color:${isPm?'#B8940A':'var(--cyan)'}">${b.slotStart}–${b.slotEnd}</div><div class="pi-info"><div class="pi-title">${b.prenom} ${b.nom}</div><div class="pi-sub">${b.email||''}</div></div><span class="pi-type type-rdv">${isPm?'Ap-m':'Matin'}</span></div>`;}).join(''):''}
  ${ateliers.length?`<div class="planning-section-title">Ateliers animés</div>`+ateliers.map(at=>{const isPm=at.period==='aprem';const inscrits=DATA.inscriptions.filter(i=>i.atelierId===at.id).length;return`<div class="planning-item ${isPm?'at-pm':'at-am'}"><div class="pi-time" style="color:${isPm?'#B8940A':'#3B6D11'}">${at.start}–${at.end}</div><div class="pi-info"><div class="pi-title">${at.titre}</div><div class="pi-sub">${at.salle} · ${inscrits} inscrit${inscrits>1?'s':''}</div></div><span class="pi-type type-at">Atelier</span></div>`;}).join(''):''}`;
  loader(false);
}

/* ── Mode visiteur ───────────────────────────────────────────── */

function applyModeUI() {
  // Supprimer bannière existante
  document.querySelector('.mode-banner')?.remove();

  // Bandeau code personnel — visible en inscription et préinscription
  const codeBanner = el('code-info-banner');
  if(codeBanner) {
    codeBanner.style.display = (PLATFORM_MODE === 'lecture') ? 'none' : 'block';
  }

  // Onglet plan visiteur — visible uniquement si plan publié
  const planTab = el('vtab-plan');
  const planPublic = DATA.config?.planPublic;
  if(planTab) planTab.style.display = planPublic ? '' : 'none';

  // sub-tabs-bar (si existe)
  const subBar = el('sub-tabs-bar');
  if(subBar) subBar.style.display = planPublic ? 'flex' : 'none';

  // Bannière mode lecture / préinscription
  const nav = document.querySelector('nav.nav');
  if(nav && (PLATFORM_MODE === 'lecture' || PLATFORM_MODE === 'preinscription')) {
    const existing = document.getElementById('platform-mode-banner');
    if(!existing) {
      const banner = document.createElement('div');
      banner.id = 'platform-mode-banner';
      if(PLATFORM_MODE === 'lecture') {
        const msg = DATA.config?.lectureMsg || `Les inscriptions seront ouvertes à partir du ${DATA.config?.lectureDate||'1er juillet 2026'}. En attendant, vous pouvez consulter les experts et ateliers disponibles.`;
        banner.className = 'mode-banner lecture';
        banner.innerHTML = `<i class="ti ti-eye" style="font-size:16px;flex-shrink:0"></i><span>${msg}</span>`;
      } else {
        const msg = DATA.config?.preinscriptionMsg || `Les inscriptions sont actuellement en phase de préinscription. Votre inscription sera confirmée à l'ouverture officielle des inscriptions.`;
        banner.className = 'mode-banner preinscription';
        banner.innerHTML = `<i class="ti ti-pencil" style="font-size:16px;flex-shrink:0"></i><span>${msg}</span>`;
      }
      nav.after(banner);
    }
  }
}  // fin applyModeUI

/* ── Navigation visiteur ──────────────────────────────────────── */
function switchVisitorTab(tab, pushHistory=true){
  applyModeUI();
  ['accueil','rdvs','ateliers','flashtalks','planning','exposant','exposants-list','plan-visiteur'].forEach(t=>{const e=el('tab-'+t);if(e)e.style.display=t===tab?'block':'none';});
  document.querySelectorAll('.vtab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  // Historique via hash — compatible GitHub Pages
  if(pushHistory){
    history.pushState({tab}, '', '#'+tab);
  }
  loadAll().then(()=>{
    applyModeUI();
    if(tab==='accueil')        renderAccueil();
    if(tab==='rdvs')           renderGrid();
    if(tab==='ateliers')       renderAteliersGrid();
    if(tab==='flashtalks')     renderFlashTalksGrid();
    if(tab==='exposants-list') renderExposantsList();
    if(tab==='plan-visiteur')  renderPlanVisiteur();
  });
}

// Bouton retour/avant navigateur
window.addEventListener('popstate', e=>{
  const tab = e.state?.tab || window.location.hash.replace('#','') || 'accueil';
  const valid = ['accueil','rdvs','ateliers','flashtalks','planning','exposant','exposants-list','plan-visiteur'];
  switchVisitorTab(valid.includes(tab)?tab:'accueil', false);
});

/* ── Répertoire exposants ───────────────────────────────────────── */
function renderExposantsList() {
  const search  = (el('el-search')?.value||'').toLowerCase();
  const catF    = el('el-cat')?.value||'';
  const periodeF= el('el-periode')?.value||'';
  const grid    = el('exposants-list-grid'); if(!grid) return;

  // Populer filtre catégorie
  const catSel = el('el-cat');
  if(catSel){
    const cur  = catSel.value;
    const cats = [...new Set(DATA.exposants.map(e=>e.cat).filter(Boolean))].sort();
    catSel.innerHTML = '<option value="">Toutes catégories</option>' +
      cats.map(c=>`<option value="${c}"${c===cur?' selected':''}>${c}</option>`).join('');
  }

  // Filtre présence : stand couvre la période
  const matchPeriode = (exp) => {
    if(!periodeF) return true;
    const s = exp.stand||'jour';
    if(periodeF==='matin') return s==='matin'||s==='jour';
    if(periodeF==='aprem') return s==='aprem'||s==='jour';
    return true;
  };

  const list = DATA.exposants
    .filter(exp => {
      const ms = !search || (exp.name+' '+exp.cat+' '+(exp.expertise||'')).toLowerCase().includes(search);
      const mc = !catF || exp.cat === catF;
      return ms && mc && matchPeriode(exp);
    })
    .sort((a,b)=>(a.cat||'').localeCompare(b.cat||'') || (a.name||'').localeCompare(b.name||''));

  if(!list.length){
    grid.innerHTML='<div class="empty-state"><i class="ti ti-building-community"></i><p>Aucun exposant trouvé.</p></div>';
    return;
  }

  // Grouper par catégorie
  const byCat = {};
  list.forEach(exp => {
    const cat = exp.cat||'Autre';
    if(!byCat[cat]) byCat[cat]=[];
    byCat[cat].push(exp);
  });

  const standLabel = s => s==='matin'?'🌅 Matin':s==='aprem'?'🌆 Après-midi':'🗓️ Toute la journée';

  grid.innerHTML = Object.entries(byCat).map(([cat, exps])=>`
    <div style="margin-bottom:2rem">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--cyan);border-bottom:2px solid var(--cyan-l);padding-bottom:.4rem;margin-bottom:.75rem">
        <i class="ti ti-tag" style="font-size:12px"></i> ${cat}
        <span style="font-weight:400;font-size:11px;opacity:.6">(${exps.length})</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
        ${exps.map(exp=>{
          const hasRdv = exp.period !== 'aucun';
          const slots  = hasRdv ? getSlots(exp.id) : [];
          const free   = slots.filter(s=>s.enabled&&!getBooking(exp.id,s.start)).length;
          return`<div class="exposant-list-card">
            <div class="elc-header">
              <div class="avatar" style="width:44px;height:44px;font-size:14px;flex-shrink:0">${initials(exp.name)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${exp.name}</div>
                ${exp.expertise?`<div style="font-size:11px;color:var(--ink3)">${exp.expertise}</div>`:''}
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">
                  <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#f0f0f0;color:var(--ink3)">${standLabel(exp.stand||'jour')}</span>
                  ${hasRdv?`<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--cyan-l);color:var(--cyan-d)">${free} créneau${free>1?'x':''}</span>`:'<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#f5f5f5;color:var(--ink3)">Présence</span>'}
                </div>
              </div>
            </div>
            <div class="elc-footer">
              ${exp.website?`<a href="${exp.website.startsWith('http')?exp.website:'https://'+exp.website}" target="_blank" rel="noopener" class="btn-ghost" style="padding:4px 10px;font-size:12px;text-decoration:none"><i class="ti ti-world"></i> Site web</a>`:''}
              ${hasRdv?`<button class="btn-primary" data-exp-id="${exp.id}" style="padding:4px 10px;font-size:12px"><i class="ti ti-calendar-plus"></i> RDV</button>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-exp-id]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      switchVisitorTab('rdvs');
      setTimeout(()=>openDrawer(btn.dataset.expId),300);
    });
  });
}

/* ── Page d'accueil ─────────────────────────────────────────────── */
function renderAccueil(){
  const totalExps = DATA.exposants.length;
  const rdvExps   = DATA.exposants.filter(e=>e.period&&e.period!=='aucun').length;
  const atTotal   = DATA.ateliers.length;
  // Hero exposants — total tous exposants
  const heroNum = el('rdv-count-num');
  if(heroNum) heroNum.textContent = totalExps||'—';
  // Card RDV — exposants qui font des RDV
  const rdvCardCount = el('rdv-card-count');
  if(rdvCardCount) rdvCardCount.textContent = rdvExps
    ? `${rdvExps} expert${rdvExps>1?'s':''} disponible${rdvExps>1?'s':''}`
    : '— experts disponibles';
  // Card ateliers
  const atNum = el('at-count-num');
  if(atNum) atNum.textContent = atTotal||'—';
  // Hero Flash Talks
  const ftTotal = DATA.flashTalks.length;
  const ftNum = el('ft-count-num');
  if(ftNum) ftNum.textContent = ftTotal||'—';
  // Brancher les boutons des cartes
  document.querySelectorAll('.accueil-card-btn, [data-goto]').forEach(btn=>{
    btn.onclick=()=>switchVisitorTab(btn.dataset.goto);
  });
}

/* ── Logique mode plateforme ─────────────────────────────────── */


function renderModeAdmin() {
  // Surligner la carte active
  ['lecture','preinscription','inscription'].forEach(m => {
    const card = el('mc-'+m);
    if(!card) return;
    card.className = 'mode-card' + (PLATFORM_MODE===m ? (m==='preinscription'?' active-mode-pre':m==='inscription'?' active-mode-ins':' active-mode') : '');
    const btn = card.querySelector('.mode-btn');
    if(btn) btn.textContent = PLATFORM_MODE===m ? '✓ Actif' : 'Activer';
    if(btn) btn.disabled = PLATFORM_MODE===m;
  });

  const cur = el('mode-current');
  if(cur){
    const labels={'lecture':'👁️ Lecture seule','preinscription':'📋 Préinscription','inscription':'✅ Inscription définitive'};
    cur.textContent = `Mode actuel : ${labels[PLATFORM_MODE]||PLATFORM_MODE}`;
  }

  // Stats validation
  const preRdv  = DATA.bookings.filter(b=>b.mode==='preinscription'&&!b.confirmed).length;
  const preAt   = DATA.inscriptions.filter(i=>i.mode==='preinscription'&&!i.confirmed).length;
  const confRdv = DATA.bookings.filter(b=>b.mode==='preinscription'&&b.confirmed).length;
  const vs = el('validation-stats');
  if(vs) vs.innerHTML = `${preRdv} RDV préinscrits non confirmés · ${preAt} ateliers préinscrits non confirmés · ${confRdv} RDV confirmés`;
}

async function launchValidation() {
  const preRdv = DATA.bookings.filter(b=>b.mode==='preinscription'&&!b.confirmed);
  const preAt  = DATA.inscriptions.filter(i=>i.mode==='preinscription'&&!i.confirmed);
  if(!preRdv.length&&!preAt.length){toast('Aucune préinscription à valider.');return;}
  if(!confirm(`Lancer la validation pour ${preRdv.length} RDV et ${preAt.length} ateliers préinscrits ? Les visiteurs auront 24h pour confirmer depuis "Mon Planning".`))return;
  loader(true);
  try{
    // Marquer la date limite de validation dans config
    await setDoc(doc(db,'config','validation'),{
      launchedAt: Date.now(),
      deadlineAt: Date.now() + 24*60*60*1000,
    });
    toast('Demande de validation lancée ! Les visiteurs sont informés à leur prochaine connexion.');
    renderModeAdmin();
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function cancelUnconfirmed() {
  const preRdv = DATA.bookings.filter(b=>b.mode==='preinscription'&&!b.confirmed);
  const preAt  = DATA.inscriptions.filter(i=>i.mode==='preinscription'&&!i.confirmed);
  if(!confirm(`Annuler ${preRdv.length} RDV et ${preAt.length} ateliers non confirmés ? Les créneaux seront redistribués aux listes d'attente.`))return;
  loader(true);
  try{
    const batch=writeBatch(db);
    preRdv.forEach(b=>batch.delete(doc(db,'bookings',b.id)));
    preAt.forEach(i=>batch.delete(doc(db,'inscriptions',i.id)));
    await batch.commit();
    // Redistribuer
    for(const b of preRdv){DATA.bookings=DATA.bookings.filter(x=>x.id!==b.id);await promoteWaitlistRdv(b.exposantId,b.slotStart);}
    for(const i of preAt){DATA.inscriptions=DATA.inscriptions.filter(x=>x.id!==i.id);await promoteWaitlistAtelier(i.atelierId);}
    renderModeAdmin();renderStats();updateBadges();
    toast(`${preRdv.length} RDV et ${preAt.length} ateliers annulés et redistribués.`);
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Onglet Plan ─────────────────────────────────────────────── */

async function renderPlan() {
  const listEl = el('plan-content'); if(!listEl) return;
  const isSA = currentAdmin?.role?.toLowerCase()==='superadmin' || currentAdmin?.email===SUPER_ADMIN_EMAIL;
  const planPublic = DATA.config?.planPublic || false;

  listEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:1.5rem">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--ink)">🗺️ Plan interactif</div>
        <div style="font-size:13px;color:var(--ink3);margin-top:2px">Gérez les villages et placez les exposants sur le plan</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isSA?`<button id="plan-publish-btn" class="${planPublic?'btn-primary':'btn-ghost'}" style="${planPublic?'background:#3B6D11;border-color:#3B6D11':''}">
          <i class="ti ti-${planPublic?'eye':'eye-off'}"></i> ${planPublic?'Plan publié':'Plan fantôme'}
        </button>`:''}
        <button id="add-village-btn" class="btn-primary"><i class="ti ti-plus"></i> Nouveau village</button>
      </div>
    </div>

    <!-- Sous-onglets -->
    <div style="display:flex;gap:6px;margin-bottom:1.25rem;border-bottom:2px solid var(--brd2);padding-bottom:.75rem">
      <button class="plan-subtab active" data-subtab="villages" style="padding:7px 16px;border-radius:8px;border:1.5px solid var(--cyan);background:var(--cyan);color:#fff;font-size:13px;font-weight:600;cursor:pointer">🏘️ Villages</button>
      <button class="plan-subtab" data-subtab="placement" style="padding:7px 16px;border-radius:8px;border:1.5px solid var(--brd2);background:#fff;color:var(--ink);font-size:13px;font-weight:600;cursor:pointer">📍 Placement sur plan</button>
    </div>

    <!-- Sous-onglet Villages -->
    <div id="plan-subtab-villages">
      <div id="add-village-form" style="display:none;background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem">
        <div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:10px">Créer un village</div>
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end">
          <div class="field"><label>Nom *</label><input id="new-village-name" placeholder="Ex: Village Juridique" /></div>
          <div class="field"><label>Couleur</label><input type="color" id="new-village-color" value="#3FCBD1" style="width:60px;height:38px;border-radius:8px;border:1.5px solid var(--brd2);cursor:pointer;padding:2px" /></div>
          <div style="display:flex;gap:8px">
            <button id="cancel-village-btn" class="btn-ghost">Annuler</button>
            <button id="save-village-btn" class="btn-primary"><i class="ti ti-check"></i> Créer</button>
          </div>
        </div>
      </div>
      <div id="villages-container" style="display:flex;flex-direction:column;gap:1rem"></div>
      <div id="unassigned-block" style="margin-top:1.5rem;background:#fff;border:2px dashed var(--brd2);border-radius:14px;padding:1.25rem">
        <div style="font-size:14px;font-weight:700;color:var(--ink3);margin-bottom:.75rem"><i class="ti ti-user-question"></i> Exposants sans village</div>
        <div id="unassigned-list" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>
    </div>

    <!-- Sous-onglet Placement -->
    <div id="plan-subtab-placement" style="display:none">
      <div style="font-size:13px;color:var(--ink3);margin-bottom:1rem">
        <strong>Mode Définir zones :</strong> dessinez des rectangles sur le plan pour marquer chaque village.<br>
        <strong>Mode Placer exposants :</strong> glissez les exposants depuis le panneau vers leur zone.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:1rem">
        <button class="plan-mode-btn active" data-mode="view" style="padding:6px 14px;border-radius:6px;border:1.5px solid var(--cyan);background:var(--cyan);color:#fff;font-size:12px;font-weight:600;cursor:pointer">👁 Vue</button>
        <button class="plan-mode-btn" data-mode="zone" style="padding:6px 14px;border-radius:6px;border:1.5px solid var(--brd2);background:#fff;color:var(--ink);font-size:12px;font-weight:600;cursor:pointer">📐 Zones</button>
        <button class="plan-mode-btn" data-mode="place" style="padding:6px 14px;border-radius:6px;border:1.5px solid var(--brd2);background:#fff;color:var(--ink);font-size:12px;font-weight:600;cursor:pointer">📍 Placer</button>
        <button id="clear-zones-btn" class="btn-ghost" style="font-size:12px;color:var(--red);border-color:var(--red);margin-left:auto"><i class="ti ti-trash"></i> Effacer zones</button>
      </div>
      <div id="plan-hint" style="font-size:12px;color:var(--ink3);margin-bottom:.75rem">Cliquez sur une zone pour voir les exposants.</div>
      <div style="position:relative;display:inline-block;width:100%;border:2px solid var(--brd2);border-radius:12px;overflow:hidden;background:#f9f9f9" id="plan-container">
        <img id="plan-img" src="plan.png" style="width:100%;height:auto;display:block;vertical-align:top" />
        <div id="plan-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></div>
      </div>
      <div id="plan-side-panel" style="display:none;margin-top:1rem;background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:12px;padding:1rem">
        <div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:.5rem">Exposants sans position</div>
        <div id="plan-exps-pool" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>
    </div>
  `;

  // Publication
  el('plan-publish-btn')?.addEventListener('click', async()=>{
    const newVal = !DATA.config.planPublic;
    loader(true);
    try {
      await setDoc(doc(db,'config','platform'),{planPublic:newVal,updatedAt:Date.now()},{merge:true});
      DATA.config.planPublic = newVal;
      renderPlan();
      toast(newVal?'Plan publié.':'Plan masqué.');
    } catch(e){console.error(e);toast('Erreur.');}
    loader(false);
  });

  // Villages
  renderVillagesUI();
  el('add-village-btn')?.addEventListener('click',()=>{
    const f=el('add-village-form'); if(!f) return;
    f.style.display=f.style.display==='none'?'block':'none';
    setTimeout(()=>el('new-village-name')?.focus(),50);
  });
  el('cancel-village-btn')?.addEventListener('click',()=>{ el('add-village-form').style.display='none'; });
  el('save-village-btn')?.addEventListener('click', createVillage);
  el('new-village-name')?.addEventListener('keydown',e=>{ if(e.key==='Enter') createVillage(); });

  // Sous-onglets
  listEl.querySelectorAll('.plan-subtab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      listEl.querySelectorAll('.plan-subtab').forEach(b=>{ b.style.background='#fff'; b.style.color='var(--ink)'; b.style.borderColor='var(--brd2)'; });
      btn.style.background='var(--cyan)'; btn.style.color='#fff'; btn.style.borderColor='var(--cyan)';
      const t=btn.dataset.subtab;
      el('plan-subtab-villages').style.display=t==='villages'?'block':'none';
      el('plan-subtab-placement').style.display=t==='placement'?'block':'none';
      if(t==='placement') initPlanPlacement();
    });
  });

  // Effacer zones
  el('clear-zones-btn')?.addEventListener('click', async()=>{
    if(!confirm(`Supprimer toutes les zones du plan ?`)) return;
    loader(true);
    try {
      const snap = await getDocs(collection(db,'planZones'));
      const batch = writeBatch(db);
      snap.docs.forEach(d=>{ if(d.data().type!=='bg') batch.delete(doc(db,'planZones',d.id)); });
      await batch.commit();
      DATA.planZones = DATA.planZones.filter(z=>z.type==='bg');
      renderPlanOverlay('view');
      toast('Zones effacées.');
    } catch(e){console.error(e);toast('Erreur.');}
    loader(false);
  });
}

function initPlanPlacement() {
  let currentMode = 'view';
  let draggedExp = null;
  let drawing = false, startX, startY, tempRect = null;

  const hints = {
    view: 'Cliquez sur une zone colorée pour voir ses exposants.',
    zone: 'Cliquez-glissez sur le plan pour dessiner une zone, puis associez-la à un village.',
    place: 'Glissez un exposant depuis le panneau vers une zone du plan.'
  };

  const setMode = (mode) => {
    currentMode = mode;
    document.querySelectorAll('.plan-mode-btn').forEach(b=>{
      const active = b.dataset.mode===mode;
      b.style.background = active?'var(--cyan)':'#fff';
      b.style.color = active?'#fff':'var(--ink)';
      b.style.borderColor = active?'var(--cyan)':'var(--brd2)';
    });
    const h=el('plan-hint'); if(h) h.textContent=hints[mode]||'';
    const sp=el('plan-side-panel'); if(sp) sp.style.display=mode==='place'?'block':'none';
    doRenderOverlay();
    if(mode==='place') renderExpsPool();
  };

  document.querySelectorAll('.plan-mode-btn').forEach(btn=>{
    btn.addEventListener('click',()=>setMode(btn.dataset.mode));
  });

  const getScale = () => {
    const container=el('plan-container');
    const img=el('plan-img');
    if(!container||!img||!img.naturalWidth) return {sx:1,sy:1};
    return { sx: container.offsetWidth/img.naturalWidth, sy: img.offsetHeight/img.naturalHeight };
  };

  const doRenderOverlay = () => {
    const overlay=el('plan-overlay'); if(!overlay) return;
    const {sx,sy} = getScale();
    const zones  = DATA.planZones.filter(z=>z.type==='zone');
    const stands = DATA.planZones.filter(z=>z.type==='stand');
    overlay.style.pointerEvents = 'all';
    overlay.innerHTML = '';

    // Dessiner les zones existantes
    zones.forEach(zone=>{
      const village = DATA.villages.find(v=>v.id===zone.villageId);
      const color = village?.color||'#3FCBD1';
      const div = document.createElement('div');
      div.style.cssText=`position:absolute;left:${zone.x*sx}px;top:${zone.y*sy}px;width:${zone.w*sx}px;height:${zone.h*sy}px;background:${color}33;border:2.5px solid ${color};border-radius:6px;box-sizing:border-box;`;
      const lbl = document.createElement('div');
      lbl.style.cssText=`position:absolute;top:4px;left:6px;right:4px;font-size:13px;font-weight:800;color:${color};pointer-events:none;white-space:normal;word-break:break-word;line-height:1.2;text-shadow:0 1px 2px rgba(255,255,255,.8)`;
      lbl.textContent = village?.name||zone.label||'Zone';
      div.appendChild(lbl);

      // Stands dans cette zone
      stands.filter(s=>s.zoneId===zone.id).forEach(stand=>{
        const exp=DATA.exposants.find(e=>e.id===stand.exposantId); if(!exp) return;
        const sd=document.createElement('div');
        const sdW=Math.min(zone.w*sx-8, 90);
        sd.style.cssText=`position:absolute;left:${(stand.relX||.5)*zone.w*sx-sdW/2}px;top:${(stand.relY||.5)*zone.h*sy-16}px;width:${sdW}px;background:${color};color:#fff;border-radius:5px;padding:3px 6px;font-size:11px;font-weight:700;white-space:normal;word-break:break-word;line-height:1.3;text-align:center;pointer-events:${currentMode==='place'?'all':'none'};cursor:${currentMode==='place'?'pointer':'default'};box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:2`;
        sd.textContent=exp.name;
        if(currentMode==='place'){
          sd.title=`Retirer ${exp.name}`;
          sd.addEventListener('click',async e2=>{
            e2.stopPropagation();
            if(!confirm(`Retirer ${exp.name} ?`)) return;
            await deleteDoc(doc(db,'planZones',stand.id));
            DATA.planZones=DATA.planZones.filter(z=>z.id!==stand.id);
            doRenderOverlay(); renderExpsPool();
          });
        }
        div.appendChild(sd);
      });

      // Drop exposant (mode place)
      if(currentMode==='place'){
        div.style.cursor='copy';
        div.addEventListener('dragover',e=>{ e.preventDefault(); div.style.background=`${color}55`; });
        div.addEventListener('dragleave',()=>{ div.style.background=`${color}33`; });
        div.addEventListener('drop',async e=>{
          e.preventDefault(); div.style.background=`${color}33`;
          if(!draggedExp) return;
          const rect=div.getBoundingClientRect();
          const relX=Math.min(Math.max((e.clientX-rect.left)/rect.width,.05),.95);
          const relY=Math.min(Math.max((e.clientY-rect.top)/rect.height,.1),.9);
          loader(true);
          try{
            const ref=await addDoc(collection(db,'planZones'),{type:'stand',zoneId:zone.id,villageId:zone.villageId,exposantId:draggedExp,relX,relY,createdAt:Date.now()});
            DATA.planZones.push({id:ref.id,type:'stand',zoneId:zone.id,villageId:zone.villageId,exposantId:draggedExp,relX,relY});
            draggedExp=null; doRenderOverlay(); renderExpsPool(); toast('Exposant placé.');
          }catch(err){console.error(err);toast('Erreur.');}
          loader(false);
        });
      }

      // Clic vue → modal
      if(currentMode==='view'){
        div.style.cursor='pointer';
        div.addEventListener('mouseenter',()=>div.style.background=`${color}55`);
        div.addEventListener('mouseleave',()=>div.style.background=`${color}33`);
        div.addEventListener('click',()=>{
          const zoneStands=stands.filter(s=>s.zoneId===zone.id);
          const exps=zoneStands.map(s=>DATA.exposants.find(e=>e.id===s.exposantId)).filter(Boolean);
          const existing=document.getElementById('zone-view-modal'); if(existing) existing.remove();
          const ov=document.createElement('div');
          ov.id='zone-view-modal';
          ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900;display:flex;align-items:center;justify-content:center;padding:1rem';
          ov.innerHTML=`<div style="background:#fff;border-radius:16px;width:100%;max-width:420px;overflow:hidden">
            <div style="background:${color};padding:1rem 1.25rem;display:flex;align-items:center;gap:10px">
              <div style="font-size:15px;font-weight:700;color:#fff;flex:1">${village?.name||'Zone'}</div>
              <span style="font-size:12px;color:rgba(255,255,255,.8)">${exps.length} exposant${exps.length>1?'s':''}</span>
              <button onclick="document.getElementById('zone-view-modal').remove()" style="background:rgba(255,255,255,.2);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;color:#fff;font-size:16px">×</button>
            </div>
            <div style="padding:1rem">
              ${exps.map(exp=>`<div style="display:flex;align-items:center;gap:10px;padding:.6rem .75rem;border-radius:8px;border:1.5px solid ${color}33;margin-bottom:6px">
                <div style="width:30px;height:30px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${initials(exp.name)}</div>
                <div><div style="font-size:13px;font-weight:700">${exp.name}</div><div style="font-size:11px;color:var(--ink3)">${exp.expertise||exp.cat||''}</div></div>
              </div>`).join('')||'<div style="font-size:13px;color:var(--ink3);font-style:italic">Aucun exposant placé. Utilisez le mode Placer.</div>'}
            </div>
          </div>`;
          document.body.appendChild(ov);
          ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
        });
      }
      overlay.appendChild(div);
    });

    // Mode zone : dessin de rectangle
    if(currentMode==='zone'){
      overlay.style.cursor='crosshair';
      overlay.addEventListener('mousedown', onMouseDown);
      overlay.addEventListener('mousemove', onMouseMove);
      overlay.addEventListener('mouseup', onMouseUp);
    }
  };

  const onMouseDown = e => {
    if(e.target!==el('plan-overlay')) return;
    const rect=e.currentTarget.getBoundingClientRect();
    startX=e.clientX-rect.left; startY=e.clientY-rect.top;
    drawing=true;
    tempRect=document.createElement('div');
    tempRect.style.cssText=`position:absolute;left:${startX}px;top:${startY}px;width:0;height:0;background:rgba(63,203,209,.2);border:2px dashed var(--cyan);pointer-events:none;box-sizing:border-box;z-index:10`;
    el('plan-overlay').appendChild(tempRect);
  };
  const onMouseMove = e => {
    if(!drawing||!tempRect) return;
    const rect=e.currentTarget.getBoundingClientRect();
    const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
    tempRect.style.left=`${Math.min(cx,startX)}px`;
    tempRect.style.top=`${Math.min(cy,startY)}px`;
    tempRect.style.width=`${Math.abs(cx-startX)}px`;
    tempRect.style.height=`${Math.abs(cy-startY)}px`;
  };
  const onMouseUp = async e => {
    if(!drawing) return; drawing=false;
    const rect=e.currentTarget.getBoundingClientRect();
    const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
    const px=Math.min(cx,startX), py=Math.min(cy,startY);
    const pw=Math.abs(cx-startX), ph=Math.abs(cy-startY);
    if(tempRect){tempRect.remove();tempRect=null;}
    if(pw<20||ph<20){toast('Zone trop petite, recommencez.');return;}
    const {sx,sy}=getScale();
    const nx=px/sx, ny=py/sy, nw=pw/sx, nh=ph/sy;
    // Modal assignation village
    const existing=document.getElementById('zone-assign-modal'); if(existing) existing.remove();
    const ov=document.createElement('div');
    ov.id='zone-assign-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900;display:flex;align-items:center;justify-content:center;padding:1rem';
    ov.innerHTML=`<div style="background:#fff;border-radius:16px;width:100%;max-width:380px;padding:1.5rem">
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:1rem">📐 Associer la zone</div>
      <div class="field" style="margin-bottom:10px"><label>Type</label>
        <select id="za-type" style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px">
          <option value="village">Village exposants</option>
          <option value="rdv">RDV individuels</option>
          <option value="accueil">Accueil / Info</option>
          <option value="cafe">Café / Terrasse</option>
          <option value="atelier">Ateliers</option>
        </select>
      </div>
      <div class="field" id="za-village-wrap" style="margin-bottom:10px"><label>Village</label>
        <select id="za-village" style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px">
          ${DATA.villages.map(v=>`<option value="${v.id}">${v.name}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="za-label-wrap" style="display:none;margin-bottom:10px"><label>Libellé</label>
        <input id="za-label" placeholder="Ex: Espace accueil" style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px" />
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-ghost" onclick="document.getElementById('zone-assign-modal').remove()">Annuler</button>
        <button id="za-save" class="btn-primary"><i class="ti ti-check"></i> Créer la zone</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    el('za-type')?.addEventListener('change',()=>{
      const t=el('za-type').value;
      el('za-village-wrap').style.display=t==='village'?'block':'none';
      el('za-label-wrap').style.display=t!=='village'?'block':'none';
    });
    el('za-save')?.addEventListener('click', async()=>{
      const type=el('za-type').value;
      const villageId=type==='village'?el('za-village')?.value:null;
      const label=el('za-label')?.value||type;
      loader(true);
      try{
        const ref=await addDoc(collection(db,'planZones'),{type:'zone',zoneType:type,villageId,label,x:nx,y:ny,w:nw,h:nh,createdAt:Date.now()});
        DATA.planZones.push({id:ref.id,type:'zone',zoneType:type,villageId,label,x:nx,y:ny,w:nw,h:nh});
        ov.remove(); doRenderOverlay(); toast('Zone créée.');
      }catch(err){console.error(err);toast('Erreur.');}
      loader(false);
    });
    ov.addEventListener('click',e2=>{ if(e2.target===ov) ov.remove(); });
  };

  const renderExpsPool = () => {
    const pool=el('plan-exps-pool'); if(!pool) return;
    const placed=new Set(DATA.planZones.filter(z=>z.type==='stand').map(z=>z.exposantId));
    const unplaced=DATA.exposants.filter(e=>!placed.has(e.id));
    pool.innerHTML=unplaced.map(e=>`<div class="exp-pool-chip" draggable="true" data-eid="${e.id}"
      style="padding:5px 12px;border-radius:16px;background:#fff;border:1.5px solid var(--brd2);font-size:12px;font-weight:600;cursor:grab;color:var(--ink)">${e.name}</div>`).join('')
      ||'<span style="font-size:12px;color:var(--ink3);font-style:italic">Tous placés.</span>';
    pool.querySelectorAll('.exp-pool-chip').forEach(chip=>{
      chip.addEventListener('dragstart',e=>{ draggedExp=chip.dataset.eid; e.dataTransfer.effectAllowed='copy'; setTimeout(()=>chip.style.opacity='.4',0); });
      chip.addEventListener('dragend',()=>{ chip.style.opacity=''; draggedExp=null; });
    });
  };

  // Init
  doRenderOverlay();
}


function renderVillagesUI() {
  const container = el('villages-container'); if(!container) return;
  const unassigned = el('unassigned-list'); if(!unassigned) return;

  // Exposants sans village
  const assignedIds = new Set(DATA.villages.flatMap(v=>v.exposants||[]));
  const sans = DATA.exposants.filter(e=>!assignedIds.has(e.id));
  unassigned.innerHTML = sans.length
    ? sans.map(e=>`<div class="exp-chip" draggable="true" data-eid="${e.id}" style="padding:5px 12px;border-radius:20px;background:#f0f0f0;border:1.5px solid #ddd;font-size:12px;font-weight:600;cursor:grab;color:var(--ink)">${e.name}</div>`).join('')
    : `<span style="font-size:13px;color:var(--ink3);font-style:italic">Tous les exposants sont affectés à un village.</span>`;

  // Villages
  container.innerHTML = DATA.villages.map((v,vi)=>{
    const exps = (v.exposants||[]).map(eid=>DATA.exposants.find(e=>e.id===eid)).filter(Boolean);
    const standMatin = exps.filter(e=>e.stand==='matin'||e.stand==='jour').length;
    const standAprem = exps.filter(e=>e.stand==='aprem'||e.stand==='jour').length;
    return `<div class="village-block" draggable="true" data-vid="${v.id}" data-vorder="${vi}"
      style="background:#fff;border:2.5px solid ${v.color||'#3FCBD1'};border-radius:14px;overflow:hidden">
      <div style="background:${v.color||'#3FCBD1'}22;padding:.9rem 1.1rem;display:flex;align-items:center;gap:10px;border-bottom:2px solid ${v.color||'#3FCBD1'}33;cursor:grab">
        <div style="width:16px;height:16px;border-radius:50%;background:${v.color||'#3FCBD1'};flex-shrink:0"></div>
        <div style="flex:1;font-size:15px;font-weight:700;color:var(--ink)">${v.name}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="color" class="village-color-input" data-vid="${v.id}" value="${v.color||'#3FCBD1'}" 
            style="width:28px;height:28px;border:none;border-radius:6px;cursor:pointer;padding:1px" title="Changer la couleur" />
          <button class="icon-btn delete-village-btn" data-vid="${v.id}" title="Supprimer ce village" style="color:var(--red)"><i class="ti ti-trash"></i></button>
          <i class="ti ti-grip-vertical" style="color:var(--ink3);font-size:16px"></i>
        </div>
      </div>
      <div class="village-drop-zone" data-vid="${v.id}" style="min-height:60px;padding:.75rem 1rem;display:flex;flex-wrap:wrap;gap:6px">
        ${exps.map((e,ei)=>`<div class="exp-chip" draggable="true" data-eid="${e.id}" data-in-village="${v.id}" data-eorder="${ei}"
          style="padding:5px 12px;border-radius:20px;background:${v.color||'#3FCBD1'}22;border:1.5px solid ${v.color||'#3FCBD1'};font-size:12px;font-weight:600;cursor:grab;color:var(--ink);display:flex;align-items:center;gap:6px">
          ${e.name}
          <button class="remove-from-village" data-eid="${e.id}" data-vid="${v.id}" style="background:none;border:none;cursor:pointer;color:${v.color||'#3FCBD1'};font-size:14px;line-height:1;padding:0">×</button>
        </div>`).join('')}
        ${exps.length===0?`<span style="font-size:12px;color:var(--ink3);font-style:italic">Glissez des exposants ici</span>`:''}
      </div>
      <div style="padding:.6rem 1rem;border-top:1px solid ${v.color||'#3FCBD1'}33;background:${v.color||'#3FCBD1'}11;display:flex;gap:16px">
        <span style="font-size:12px;color:var(--ink3)"><strong style="color:var(--ink)">${standMatin}</strong> stand${standMatin>1?'s':''} matin</span>
        <span style="font-size:12px;color:var(--ink3)"><strong style="color:var(--ink)">${standAprem}</strong> stand${standAprem>1?'s':''} après-midi</span>
        <span style="font-size:12px;color:var(--ink3)"><strong style="color:var(--ink)">${exps.length}</strong> exposant${exps.length>1?'s':''} total</span>
      </div>
    </div>`;
  }).join('');

  // Brancher les events
  bindVillageEvents();
}

function bindVillageEvents() {
  let dragEid=null, dragVid=null, dragIsVillage=false, dragVillageId=null;

  // Drag exposants
  document.querySelectorAll('.exp-chip').forEach(chip=>{
    chip.addEventListener('dragstart', e=>{
      dragEid=chip.dataset.eid; dragVid=chip.dataset.inVillage||null; dragIsVillage=false;
      e.dataTransfer.effectAllowed='move';
      setTimeout(()=>chip.style.opacity='.4',0);
    });
    chip.addEventListener('dragend', ()=>{ chip.style.opacity=''; });
  });

  // Drop zones villages
  document.querySelectorAll('.village-drop-zone').forEach(zone=>{
    zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.style.background='rgba(63,203,209,.08)'; });
    zone.addEventListener('dragleave', ()=>{ zone.style.background=''; });
    zone.addEventListener('drop', async e=>{
      e.preventDefault(); zone.style.background='';
      if(dragIsVillage||!dragEid) return;
      const targetVid = zone.dataset.vid;
      await moveExpToVillage(dragEid, dragVid, targetVid);
      dragEid=null; dragVid=null;
    });
  });

  // Drop zone sans-village
  const unassignedEl = el('unassigned-list');
  if(unassignedEl){
    unassignedEl.addEventListener('dragover',e=>{ e.preventDefault(); unassignedEl.style.background='rgba(0,0,0,.04)'; });
    unassignedEl.addEventListener('dragleave',()=>{ unassignedEl.style.background=''; });
    unassignedEl.addEventListener('drop',async e=>{
      e.preventDefault(); unassignedEl.style.background='';
      if(!dragEid||!dragVid) return;
      await removeExpFromVillage(dragEid, dragVid);
      dragEid=null; dragVid=null;
    });
  }

  // Drag villages (réordonnancement)
  document.querySelectorAll('.village-block').forEach(block=>{
    block.addEventListener('dragstart', e=>{
      if(e.target.classList.contains('exp-chip')||e.target.closest('.exp-chip')) return;
      dragIsVillage=true; dragVillageId=block.dataset.vid;
      e.dataTransfer.effectAllowed='move';
      setTimeout(()=>block.style.opacity='.5',0);
    });
    block.addEventListener('dragend',()=>{ block.style.opacity=''; dragIsVillage=false; });
    block.addEventListener('dragover',e=>{
      e.preventDefault();
      if(!dragIsVillage||dragVillageId===block.dataset.vid) return;
      block.style.borderStyle='dashed';
    });
    block.addEventListener('dragleave',()=>block.style.borderStyle='solid');
    block.addEventListener('drop',async e=>{
      e.preventDefault(); block.style.borderStyle='solid';
      if(!dragIsVillage||dragVillageId===block.dataset.vid) return;
      await reorderVillages(dragVillageId, block.dataset.vid);
      dragIsVillage=false; dragVillageId=null;
    });
  });

  // Boutons supprimer exposant du village
  document.querySelectorAll('.remove-from-village').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      await removeExpFromVillage(btn.dataset.eid, btn.dataset.vid);
    });
  });

  // Changer couleur
  document.querySelectorAll('.village-color-input').forEach(inp=>{
    inp.addEventListener('change', async()=>{
      const v=DATA.villages.find(x=>x.id===inp.dataset.vid); if(!v) return;
      v.color=inp.value;
      await updateDoc(doc(db,'villages',inp.dataset.vid),{color:inp.value});
      renderVillagesUI();
    });
  });

  // Supprimer village
  document.querySelectorAll('.delete-village-btn').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      const v=DATA.villages.find(x=>x.id===btn.dataset.vid);
      if(!confirm(`Supprimer le village "${v?.name}" ? Les exposants seront désaffectés.`)) return;
      loader(true);
      try{
        await deleteDoc(doc(db,'villages',btn.dataset.vid));
        DATA.villages=DATA.villages.filter(x=>x.id!==btn.dataset.vid);
        renderVillagesUI();
        toast(`Village "${v?.name}" supprimé.`);
      }catch(e){ console.error(e); toast('Erreur.'); }
      loader(false);
    });
  });
}

async function createVillage() {
  const name=(el('new-village-name')?.value||'').trim();
  const color=el('new-village-color')?.value||'#3FCBD1';
  if(!name){ toast('Nom du village requis.'); return; }
  loader(true);
  try{
    const order=DATA.villages.length;
    const ref=await addDoc(collection(db,'villages'),{name,color,exposants:[],order,createdAt:Date.now()});
    DATA.villages.push({id:ref.id,name,color,exposants:[],order});
    el('add-village-form').style.display='none';
    el('new-village-name').value='';
    renderVillagesUI();
    toast(`Village "${name}" créé.`);
  }catch(e){ console.error(e); toast('Erreur.'); }
  loader(false);
}

async function moveExpToVillage(eid, fromVid, toVid) {
  if(fromVid===toVid) return;
  loader(true);
  try{
    // Retirer de l'ancien village
    if(fromVid){
      const oldV=DATA.villages.find(v=>v.id===fromVid);
      if(oldV){ oldV.exposants=(oldV.exposants||[]).filter(id=>id!==eid); await updateDoc(doc(db,'villages',fromVid),{exposants:oldV.exposants}); }
    }
    // Ajouter au nouveau
    const newV=DATA.villages.find(v=>v.id===toVid);
    if(newV){ newV.exposants=[...(newV.exposants||[]).filter(id=>id!==eid),eid]; await updateDoc(doc(db,'villages',toVid),{exposants:newV.exposants}); }
    renderVillagesUI();
  }catch(e){ console.error(e); toast('Erreur.'); }
  loader(false);
}

async function removeExpFromVillage(eid, vid) {
  const v=DATA.villages.find(x=>x.id===vid); if(!v) return;
  loader(true);
  try{
    v.exposants=(v.exposants||[]).filter(id=>id!==eid);
    await updateDoc(doc(db,'villages',vid),{exposants:v.exposants});
    renderVillagesUI();
  }catch(e){ console.error(e); toast('Erreur.'); }
  loader(false);
}

async function reorderVillages(fromId, toId) {
  const fromIdx=DATA.villages.findIndex(v=>v.id===fromId);
  const toIdx=DATA.villages.findIndex(v=>v.id===toId);
  if(fromIdx===-1||toIdx===-1) return;
  // Réordonner
  const arr=[...DATA.villages];
  const [moved]=arr.splice(fromIdx,1);
  arr.splice(toIdx,0,moved);
  DATA.villages=arr;
  loader(true);
  try{
    const batch=writeBatch(db);
    arr.forEach((v,i)=>batch.update(doc(db,'villages',v.id),{order:i}));
    await batch.commit();
    renderVillagesUI();
  }catch(e){ console.error(e); toast('Erreur.'); }
  loader(false);
}

/* ── Onglet Équipe ───────────────────────────────────────────── */

async function renderEquipe() {
  const listEl = el('equipe-list'); if(!listEl) return;
  console.log('currentAdmin:', currentAdmin);
  const isSA = currentAdmin?.role?.toLowerCase() === 'superadmin' || currentAdmin?.email === SUPER_ADMIN_EMAIL;
  console.log('isSA:', isSA, 'role:', currentAdmin?.role, 'email:', currentAdmin?.email);
  if(!isSA) { listEl.innerHTML='<div class="empty-state"><i class="ti ti-lock"></i><p>Accès réservé au super-administrateur.</p></div>'; return; }

  const snap = await getDocs(collection(db,'admins'));
  const admins = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.email.localeCompare(b.email));
  const ALL_TABS = ['exposants','ateliers-admin','rdvs','visiteurs','waitlist-rdvs','waitlist-ateliers','plan','parametres','historique'];
  const LABELS = {'exposants':'Exposants','ateliers-admin':'Ateliers','rdvs':'RDV','visiteurs':'Visiteurs','waitlist-rdvs':'Att. RDV','waitlist-ateliers':'Att. Ateliers','plan':'Plan','parametres':'Paramètres','historique':'Historique'};

  // Droits par défaut pour un nouvel admin (historique et paramètres désactivés)
  const DEFAULT_DROITS = {
    'exposants':true,'ateliers-admin':true,'rdvs':true,'visiteurs':true,
    'waitlist-rdvs':true,'waitlist-ateliers':true,'plan':true,'parametres':false,'historique':false
  };

  listEl.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
      <button id="add-admin-btn" class="btn-primary"><i class="ti ti-user-plus"></i> Ajouter un admin</button>
    </div>
    <div id="add-admin-form" style="display:none;background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:12px;padding:1.25rem;margin-bottom:1rem">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="field"><label>Prénom *</label><input id="new-admin-prenom" placeholder="Prénom" /></div>
        <div class="field"><label>Nom *</label><input id="new-admin-nom" placeholder="Nom" /></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="field"><label>Structure</label><input id="new-admin-structure" placeholder="Organisation, association…" /></div>
        <div class="field"><label>Email *</label><input id="new-admin-email" type="email" placeholder="admin@exemple.fr" /></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="field"><label>Mot de passe *</label><input id="new-admin-pwd" type="password" placeholder="8 caractères min." /></div>
        <div class="field"><label>Confirmer *</label><input id="new-admin-pwd2" type="password" placeholder="Répétez le mot de passe" /></div>
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>Accès aux onglets <span style="font-size:11px;color:var(--ink3);font-weight:400">(Paramètres et Historique désactivés par défaut)</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
          ${ALL_TABS.map(t=>{
            const on = DEFAULT_DROITS[t] !== false;
            return`<button type="button" class="new-droit-btn" data-tab="${t}" data-val="${on?'1':'0'}"
              style="font-size:12px;padding:5px 12px;border-radius:6px;border:2px solid;cursor:pointer;font-family:var(--font);font-weight:600;transition:.15s;
              ${on?'background:var(--cyan);border-color:var(--cyan);color:#fff':'background:#f0f0f0;border-color:#ccc;color:#888'}">
              ${on?'✓ ':''}${LABELS[t]}
            </button>`;
          }).join('')}
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="cancel-new-admin" class="btn-ghost">Annuler</button>
        <button id="save-new-admin" class="btn-primary"><i class="ti ti-check"></i> Créer</button>
      </div>
    </div>
    ${admins.map(a=>{
      const isSelf = a.email === currentAdmin?.email;
      const isThisSA = a.role === 'superadmin';
      const droits = a.droits || DEFAULT_DROITS;
      return`<div style="background:#fff;border:1.5px solid var(--brd2);border-radius:12px;padding:1.1rem;margin-bottom:10px" data-admin-card="${a.id}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${isThisSA?'0':'10px'}">
          <div style="width:38px;height:38px;border-radius:50%;background:${isThisSA?'var(--yellow)':'var(--cyan-l)'};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:${isThisSA?'var(--ink)':'var(--cyan)'}">
            ${a.email[0].toUpperCase()}
          </div>
          <div style="flex:1">
            <div style="font-weight:600;color:var(--ink)">${a.prenom||''} ${a.nom||''}${a.prenom?' — ':''}<span style="font-weight:400">${a.email}</span>${isSelf?` <span style="font-size:11px;color:var(--ink3)">(vous)</span>`:''}</div>
            ${a.structure?`<div style="font-size:11px;color:var(--ink3)">${a.structure}</div>`:''}
            <div style="font-size:12px;color:${isThisSA?'#B8940A':'var(--ink3)'};">${isThisSA?'👑 Super-administrateur':'Administrateur'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${!isThisSA?`<button class="btn-ghost" style="padding:4px 10px;font-size:12px" data-pwd-admin="${a.id}" data-pwd-email="${a.email}" data-pwd-current="${a.password||''}"><i class="ti ti-key"></i> MDP</button>`:''}
            ${!isSelf&&!isThisSA?`<button class="btn-ghost" style="padding:4px 10px;font-size:12px" data-promote="${a.id}" data-email="${a.email}"><i class="ti ti-crown"></i> Promouvoir SA</button>`:''}
            ${!isSelf?`<button class="del-booking-btn" style="padding:5px 8px" data-del-admin="${a.id}" data-del-email="${a.email}"><i class="ti ti-trash"></i></button>`:''}
          </div>
        </div>
        ${!isThisSA?`
          <div style="font-size:11px;color:var(--ink3);margin-bottom:6px;font-weight:600">Accès aux onglets :</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${ALL_TABS.map(t=>{
              const on = droits[t] !== false;
              return`<button type="button" class="droit-toggle-btn" data-aid="${a.id}" data-tab="${t}" data-val="${on?'1':'0'}"
                style="font-size:11px;padding:4px 10px;border-radius:6px;border:2px solid;cursor:pointer;font-family:var(--font);font-weight:600;transition:.15s;
                ${on?'background:var(--cyan);border-color:var(--cyan);color:#fff':'background:#f0f0f0;border-color:#ccc;color:#888'}">
                ${on?'✓ ':''}${LABELS[t]}
              </button>`;
            }).join('')}
          </div>`:''}
      </div>`;
    }).join('')}
  `;

  // Toggle boutons du formulaire
  listEl.querySelectorAll('.new-droit-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const on = btn.dataset.val === '1';
      btn.dataset.val = on ? '0' : '1';
      if(!on){
        btn.style.background='var(--cyan)'; btn.style.borderColor='var(--cyan)'; btn.style.color='#fff';
        btn.textContent='✓ '+btn.textContent.replace('✓ ','').trim();
      } else {
        btn.style.background='#f0f0f0'; btn.style.borderColor='#ccc'; btn.style.color='#888';
        btn.textContent=btn.textContent.replace('✓ ','').trim();
      }
    });
  });

  el('add-admin-btn')?.addEventListener('click',()=>{ el('add-admin-form').style.display = el('add-admin-form').style.display==='none'?'block':'none'; });
  el('cancel-new-admin')?.addEventListener('click',()=>{ el('add-admin-form').style.display='none'; });
  el('save-new-admin')?.addEventListener('click', createAdmin);
  listEl.querySelectorAll('[data-promote]').forEach(btn=>btn.addEventListener('click',()=>transfertSuperAdmin(btn.dataset.promote,btn.dataset.email)));
  listEl.querySelectorAll('[data-del-admin]').forEach(btn=>btn.addEventListener('click',()=>deleteAdmin(btn.dataset.delAdmin,btn.dataset.delEmail)));
  listEl.querySelectorAll('[data-pwd-admin]').forEach(btn=>btn.addEventListener('click',()=>editAdminPassword(btn.dataset.pwdAdmin,btn.dataset.pwdEmail)));

  // Toggle droits admins existants — boutons visuels
  listEl.querySelectorAll('.droit-toggle-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const aid=btn.dataset.aid, tab=btn.dataset.tab;
      const on = btn.dataset.val === '1';
      const newVal = !on;
      // Mise à jour visuelle immédiate
      btn.dataset.val = newVal ? '1' : '0';
      if(newVal){
        btn.style.background='var(--cyan)'; btn.style.borderColor='var(--cyan)'; btn.style.color='#fff';
        btn.textContent='✓ '+btn.textContent.replace('✓ ','').trim();
      } else {
        btn.style.background='#f0f0f0'; btn.style.borderColor='#ccc'; btn.style.color='#888';
        btn.textContent=btn.textContent.replace('✓ ','').trim();
      }
      // Sauvegarder dans Firebase
      try{
        const adDoc=snap.docs.find(d=>d.id===aid);
        const droits={...(adDoc?.data().droits||DEFAULT_DROITS),[tab]:newVal};
        await updateDoc(doc(db,'admins',aid),{droits});
        await logAction('DROITS', `${adDoc?.data().email} → ${tab}=${newVal}`);
        toast(`Accès "${LABELS[tab]}" ${newVal?'activé':'désactivé'}.`);
      }catch(e){console.error(e);toast('Erreur.');
        // Annuler le changement visuel en cas d'erreur
        btn.dataset.val = on ? '1' : '0';
      }
    });
  });
}

async function editAdminPassword(adminId, adminEmail) {
  // Recharger depuis Firebase pour avoir le vrai mot de passe
  loader(true);
  let currentPwd = '';
  try {
    const snap = await getDocs(collection(db,'admins'));
    const adDoc = snap.docs.find(d=>d.id===adminId);
    currentPwd = adDoc?.data().password || '';
  } catch(e) { console.error(e); }
  loader(false);

  const existing = document.getElementById('pwd-edit-modal');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pwd-edit-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:420px;padding:1.75rem;border:2px solid var(--brd2)">
      <div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:.25rem"><i class="ti ti-key" style="color:var(--cyan)"></i> Mot de passe</div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:1.25rem">${adminEmail}</div>
      <div class="field" style="margin-bottom:10px">
        <label>Mot de passe actuel</label>
        <div style="font-family:monospace;background:var(--cyan-l);padding:8px 12px;border-radius:8px;font-size:14px;color:var(--cyan-d);letter-spacing:.05em;border:1.5px solid var(--brd2)">
          ${currentPwd || '<em style="opacity:.5;font-style:italic;font-family:var(--font)">Non défini</em>'}
        </div>
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>Nouveau mot de passe</label>
        <input id="pwd-edit-new" type="text" placeholder="8 caractères min." style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px" />
      </div>
      <div class="field" style="margin-bottom:1.25rem">
        <label>Confirmer</label>
        <input id="pwd-edit-confirm" type="text" placeholder="Répétez le mot de passe" style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="pwd-edit-cancel" class="btn-ghost">Annuler</button>
        <button id="pwd-edit-save" class="btn-primary"><i class="ti ti-check"></i> Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
  document.getElementById('pwd-edit-cancel').addEventListener('click', ()=>overlay.remove());
  document.getElementById('pwd-edit-new').focus();

  document.getElementById('pwd-edit-save').addEventListener('click', async()=>{
    const newPwd = (document.getElementById('pwd-edit-new')?.value||'').trim();
    const confirm = (document.getElementById('pwd-edit-confirm')?.value||'').trim();
    if(newPwd.length < 8){ toast('Mot de passe : 8 caractères minimum.'); return; }
    if(newPwd !== confirm){ toast('Les mots de passe ne correspondent pas.'); return; }
    loader(true);
    try{
      await updateDoc(doc(db,'admins',adminId), { password: newPwd });
      await logAction('MODIFICATION MDP', adminEmail);
      overlay.remove();
      toast(`Mot de passe de ${adminEmail} mis à jour.`);
      renderEquipe();
    }catch(e){ console.error(e); toast('Erreur.'); }
    loader(false);
  });
}

async function createAdmin() {
  const prenom=(el('new-admin-prenom')?.value||'').trim();
  const nom=(el('new-admin-nom')?.value||'').trim();
  const structure=(el('new-admin-structure')?.value||'').trim();
  const email=(el('new-admin-email')?.value||'').trim();
  const pwd=(el('new-admin-pwd')?.value||'').trim();
  const pwd2=(el('new-admin-pwd2')?.value||'').trim();
  if(!prenom||!nom){toast('Prénom et nom requis.');return;}
  if(!email){toast('Email requis.');return;}
  if(pwd.length<8){toast('Mot de passe : 8 caractères minimum.');return;}
  if(pwd!==pwd2){toast('Les mots de passe ne correspondent pas.');return;}
  const droits={};
  document.querySelectorAll('.new-droit-btn').forEach(btn=>{droits[btn.dataset.tab]=btn.dataset.val==='1';});
  loader(true);
  try{
    await addDoc(collection(db,'admins'),{prenom,nom,structure,email,password:pwd,role:'admin',droits,createdBy:currentAdmin?.email,createdAt:Date.now()});
    await logAction('AJOUT ADMIN', `${prenom} ${nom} (${email})`);
    el('add-admin-form').style.display='none';
    // Reset du formulaire
    ['new-admin-prenom','new-admin-nom','new-admin-structure','new-admin-email','new-admin-pwd','new-admin-pwd2'].forEach(id=>{if(el(id))el(id).value='';});
    toast(`Admin ${prenom} ${nom} créé.`);
    renderEquipe();
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteAdmin(adminId, adminEmail) {
  if(!confirm(`Supprimer le compte de ${adminEmail} ?`))return;
  loader(true);
  try{
    await deleteDoc(doc(db,'admins',adminId));
    await logAction('SUPPRESSION ADMIN', adminEmail);
    toast(`Compte ${adminEmail} supprimé.`);
    renderEquipe();
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function transfertSuperAdmin(newId, newEmail) {
  if(!confirm(`Transférer le rôle super-admin à ${newEmail} ? Vous deviendrez admin standard.`))return;
  loader(true);
  try{
    const snap=await getDocs(collection(db,'admins'));
    const myDoc=snap.docs.find(d=>d.data().email===currentAdmin?.email);
    const batch=writeBatch(db);
    if(myDoc) batch.update(doc(db,'admins',myDoc.id),{role:'admin'});
    batch.update(doc(db,'admins',newId),{role:'superadmin',droits:{exposants:true,ateliers:true,rdvs:true,visiteurs:true,mode:true,equipe:true,historique:true}});
    await batch.commit();
    await logAction('TRANSFERT SA', `→ ${newEmail}`);
    currentAdmin.role='admin';
    applyDroits(); renderEquipe();
    toast(`Super-admin transféré à ${newEmail}.`);
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

/* ── Onglet Historique ───────────────────────────────────────── */

async function exportHistorique() {
  try {
    const snap = await getDocs(query(collection(db,'logs'), orderBy('timestamp','desc')));
    const logs = snap.docs.map(d=>({id:d.id,...d.data()}));
    const esc = s => '"'+(s||'').replace(/"/g,'""')+'"';
    const rows = ['Date,Admin,Role,Action,Detail'];
    logs.forEach(l=>{
      const d = new Date(l.timestamp).toLocaleString('fr-FR');
      rows.push([esc(d),esc(l.adminEmail),esc(l.adminRole),esc(l.action),esc(l.details)].join(','));
    });
    const csv = rows.join(String.fromCharCode(13,10));
    const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`historique-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Historique exporté en CSV.');
  } catch(e){console.error(e);toast('Erreur export.');}
}

async function clearHistorique() {
  if(!confirm(`Supprimer tout l'historique ? Cette action est irréversible.`)) return;
  loader(true);
  try {
    const snap = await getDocs(collection(db,'logs'));
    const batch = writeBatch(db);
    snap.docs.forEach(d=>batch.delete(doc(db,'logs',d.id)));
    await batch.commit();
    toast('Historique effacé.');
    renderHistorique();
  } catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function renderHistorique() {
  const listEl=el('historique-list'); if(!listEl) return;
  try{
    const snap=await getDocs(query(collection(db,'logs'),orderBy('timestamp','desc')));
    const logs=snap.docs.map(d=>({id:d.id,...d.data()})).slice(0,200);
    const isSA = currentAdmin?.role?.toLowerCase()==='superadmin'||currentAdmin?.email===SUPER_ADMIN_EMAIL;
    const toolbar = isSA ? `<div style="display:flex;gap:8px;margin-bottom:1rem">
      <button id="btn-export-hist" class="btn-primary" style="font-size:13px"><i class="ti ti-download"></i> Exporter CSV</button>
      <button id="btn-clear-hist" class="btn-ghost" style="font-size:13px;border-color:var(--red);color:var(--red)"><i class="ti ti-trash"></i> Vider l'historique</button>
    </div>` : '';
    if(!logs.length){listEl.innerHTML=toolbar+'<div class="empty-state"><i class="ti ti-history"></i><p>Aucun historique.</p></div>';return;}
    listEl.innerHTML=toolbar+`<table class="rdv-table"><thead><tr>
      <th>Date</th><th>Admin</th><th>Rôle</th><th>Action</th><th>Détail</th>
    </tr></thead><tbody>${logs.map(l=>{
      const d=new Date(l.timestamp);
      const date=d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      const color=l.action?.includes('SUPPRESSION')?'var(--red)':l.action?.includes('CONNEXION')?'#3B6D11':'var(--ink)';
      return`<tr>
        <td style="font-size:12px;white-space:nowrap">${date}</td>
        <td style="font-size:12px">${l.adminEmail||'–'}</td>
        <td><span style="font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600;background:${l.adminRole==='superadmin'?'var(--yellow)':'var(--cyan-l)'};color:${l.adminRole==='superadmin'?'var(--ink)':'var(--cyan-d)'}">${l.adminRole||'–'}</span></td>
        <td style="font-size:12px;font-weight:600;color:${color}">${l.action||'–'}</td>
        <td style="font-size:12px;color:var(--ink3);max-width:200px">${l.details||'–'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  el('btn-export-hist')?.addEventListener('click', exportHistorique);
  el('btn-clear-hist')?.addEventListener('click', clearHistorique);
  }catch(e){console.error(e);listEl.innerHTML='<div class="empty-state"><p>Erreur chargement.</p></div>';}
}
function renderPlanVisiteur() {
  const cont = el('plan-visiteur-content'); if(!cont) return;

  const bgZone = DATA.planZones.find(z=>z.type==='bg');
  const planImg = bgZone?.url || 'plan.png';
  const zones  = DATA.planZones.filter(z=>z.type==='zone');
  const stands = DATA.planZones.filter(z=>z.type==='stand');

  // Pas encore de zones définies → afficher les villages existants
  const villages = DATA.villages.filter(v=>(v.exposants||[]).length>0);
  if(!bgZone?.url && !zones.length) {
    if(!villages.length){
      cont.innerHTML=`<div style="background:#f5f5f5;border:2px dashed #ccc;border-radius:16px;padding:3rem;text-align:center">
        <i class="ti ti-map-2" style="font-size:48px;color:#bbb;display:block;margin-bottom:.75rem"></i>
        <div style="font-size:15px;font-weight:600;color:var(--ink3)">Plan en cours de préparation</div>
        <div style="font-size:13px;color:#bbb;margin-top:.25rem">Revenez bientôt !</div>
      </div>`;
      return;
    }
    // Grille villages avec plan.png en haut
    cont.innerHTML = `<div style="margin-bottom:1.5rem;border-radius:12px;overflow:hidden;border:2px solid var(--brd2)">
      <img src="plan.png" style="width:100%;height:auto;display:block" alt="Plan" />
      <div style="padding:.75rem 1rem;background:var(--cyan-l);font-size:12px;color:var(--ink3);text-align:center"><i class="ti ti-hand-click"></i> Cliquez sur un village ci-dessous pour voir les exposants</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem">
      ${villages.map(v=>{
        const exps=(v.exposants||[]).map(id=>DATA.exposants.find(e=>e.id===id)).filter(Boolean);
        return `<div class="village-card-visitor" style="border:2.5px solid ${v.color||'var(--cyan)'};border-radius:14px;overflow:hidden;cursor:pointer" data-village-id="${v.id}">
          <div style="background:${v.color||'var(--cyan)'};padding:.85rem 1.1rem;display:flex;align-items:center;gap:10px">
            <div style="width:12px;height:12px;border-radius:50%;background:#fff;opacity:.8;flex-shrink:0"></div>
            <div style="font-size:15px;font-weight:700;color:#fff;flex:1">${v.name}</div>
            <div style="font-size:12px;color:rgba(255,255,255,.8)">${exps.length} exposant${exps.length>1?'s':''}</div>
            <i class="ti ti-chevron-down" style="color:#fff;font-size:14px;transition:.2s" id="chevron-${v.id}"></i>
          </div>
          <div class="village-exps-list" id="vexps-${v.id}" style="display:none;padding:.75rem;background:${v.color||'var(--cyan)'}0D">
            ${exps.map(e=>`<div class="village-exp-chip" data-eid="${e.id}" data-vcolor="${v.color||'var(--cyan)'}"
              style="display:flex;align-items:center;gap:10px;padding:.7rem .85rem;border-radius:10px;background:#fff;border:1.5px solid ${v.color||'var(--cyan)'}44;margin-bottom:6px;cursor:pointer">
              <div style="width:32px;height:32px;border-radius:50%;background:${v.color||'var(--cyan)'}22;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${v.color||'var(--cyan)'};flex-shrink:0">${initials(e.name)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;color:var(--ink)">${e.name}</div>
                <div style="font-size:11px;color:var(--ink3)">${e.expertise||e.cat||''}</div>
              </div>
              <i class="ti ti-info-circle" style="color:${v.color||'var(--cyan)'};font-size:16px;flex-shrink:0"></i>
            </div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    // Toggle et fiches exposants
    cont.querySelectorAll('.village-card-visitor').forEach(card=>{
      const vid=card.dataset.villageId;
      const header=card.querySelector('div[style*="padding:.85rem"]');
      const list=el('vexps-'+vid);
      const chevron=el('chevron-'+vid);
      header?.addEventListener('click',()=>{
        const open=list.style.display==='block';
        list.style.display=open?'none':'block';
        if(chevron) chevron.style.transform=open?'':'rotate(180deg)';
      });
    });
    cont.querySelectorAll('.village-exp-chip').forEach(chip=>{
      chip.addEventListener('click',e=>{
        e.stopPropagation();
        const exp=DATA.exposants.find(x=>x.id===chip.dataset.eid); if(!exp) return;
        const vcolor=chip.dataset.vcolor;
        const existing=document.getElementById('exp-plan-modal'); if(existing) existing.remove();
        const overlay=document.createElement('div');
        overlay.id='exp-plan-modal';
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';
        overlay.innerHTML=`<div style="background:#fff;border-radius:20px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2)">
          <div style="background:${vcolor};padding:1.25rem 1.5rem;display:flex;align-items:center;gap:12px">
            <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">${initials(exp.name)}</div>
            <div><div style="font-size:16px;font-weight:700;color:#fff">${exp.name}</div><div style="font-size:12px;color:rgba(255,255,255,.8)">${exp.cat||''}</div></div>
            <button onclick="document.getElementById('exp-plan-modal').remove()" style="margin-left:auto;background:rgba(255,255,255,.2);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;color:#fff;font-size:18px">×</button>
          </div>
          <div style="padding:1.25rem 1.5rem">
            ${exp.expertise?`<div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:.5rem">${exp.expertise}</div>`:''}
            ${exp.email?`<div style="font-size:13px;color:var(--ink2);margin-bottom:.4rem"><a href="mailto:${exp.email}" style="color:${vcolor}">${exp.email}</a></div>`:''}
            ${exp.website?`<div style="font-size:13px;margin-bottom:.75rem"><a href="${exp.website.startsWith('http')?exp.website:'https://'+exp.website}" target="_blank" style="color:${vcolor}">${exp.website}</a></div>`:''}
            ${exp.period!=='aucun'?`<button class="btn-primary" style="width:100%;justify-content:center" onclick="document.getElementById('exp-plan-modal').remove();switchVisitorTab('rdvs');setTimeout(()=>openDrawer('${exp.id}'),400)"><i class="ti ti-calendar-plus"></i> Prendre RDV</button>`:''}
          </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click',e2=>{if(e2.target===overlay)overlay.remove();});
      });
    });
    return;
  }

  cont.innerHTML = `
    <div style="font-size:13px;color:var(--ink3);margin-bottom:.75rem;text-align:center">
      <i class="ti ti-hand-click"></i> Cliquez sur une zone colorée pour voir les exposants
    </div>
    <div style="position:relative;display:inline-block;width:100%;border:2px solid var(--brd2);border-radius:12px;overflow:hidden;background:#f9f9f9;cursor:pointer" id="plan-vis-container">
      <img id="plan-vis-img" src="${planImg}" style="width:100%;height:auto;display:block;vertical-align:top" />
      <div id="plan-vis-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%"></div>
    </div>
    <div id="plan-vis-zoom" style="display:none;margin-top:1.5rem"></div>
  `;

  // Attendre que l'image soit chargée pour avoir les dimensions
  const img = el('plan-vis-img');
  const doRender = () => renderVisZones(zones, stands);
  if(img) { if(img.complete) doRender(); else img.addEventListener('load', doRender); }
  else doRender();

  const renderVisZones = (zones, stands) => {
    const overlay = el('plan-vis-overlay'); if(!overlay) return;
    const container = el('plan-vis-container');
    const img2 = el('plan-vis-img');
    const natW = img2?.naturalWidth||container.offsetWidth;
    const natH = img2?.naturalHeight||container.offsetHeight;
    const scaleX = container.offsetWidth/natW;
    const scaleH = img2?.offsetHeight||container.offsetHeight;
    const scaleY = scaleH/natH;

    overlay.innerHTML='';
    zones.forEach(zone=>{
      const village = DATA.villages.find(v=>v.id===zone.villageId);
      const isVillage = zone.zoneType==='village';
      const color = village?.color||(isVillage?'#3FCBD1':'#888');
      const zoneStands = stands.filter(s=>s.zoneId===zone.id);
      const label = village?.name || zone.label || zone.zoneType;

      const div = document.createElement('div');
      div.style.cssText=`position:absolute;left:${zone.x*scaleX}px;top:${zone.y*scaleY}px;width:${zone.w*scaleX}px;height:${zone.h*scaleY}px;background:${color}${isVillage?'33':'22'};border:${isVillage?'2.5':'1.5'}px solid ${color};border-radius:6px;box-sizing:border-box;transition:.2s;${isVillage?'cursor:pointer':''}`;

      const lbl = document.createElement('div');
      lbl.style.cssText=`position:absolute;top:4px;left:6px;font-size:${isVillage?'11':'10'}px;font-weight:700;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 12px);pointer-events:none`;
      lbl.textContent = label;
      div.appendChild(lbl);

      if(isVillage) {
        div.addEventListener('mouseenter',()=>div.style.background=`${color}55`);
        div.addEventListener('mouseleave',()=>div.style.background=`${color}33`);
        div.addEventListener('click',()=>showZoomVillage(zone,village,zoneStands,scaleX,scaleY));
      }
      overlay.appendChild(div);
    });
  }

  const showZoomVillage = (zone, village, zoneStands, scaleX, scaleY) => {
    const zoomEl = el('plan-vis-zoom'); if(!zoomEl) return;
    const color = village?.color||'var(--cyan)';
    const exps = zoneStands.map(s=>DATA.exposants.find(e=>e.id===s.exposantId)).filter(Boolean);

    // Zoom sur la zone du plan
    const container = el('plan-vis-container');
    const img2 = el('plan-vis-img');
    const natW = img2?.naturalWidth||1000, natH = img2?.naturalHeight||700;
    const scaleX2 = container.offsetWidth/natW;
    const scaleH = img2?.offsetHeight||container.offsetHeight;
    const scaleY2 = scaleH/natH;

    // Calculer crop en %
    const pad = 30;
    const cropX = Math.max(0, zone.x*scaleX2 - pad);
    const cropY = Math.max(0, zone.y*scaleY2 - pad);
    const cropW = zone.w*scaleX2 + pad*2;
    const cropH = zone.h*scaleY2 + pad*2;
    const totalW = container.offsetWidth;
    const totalH = img2?.offsetHeight||400;
    const zoom = Math.min(totalW/cropW, 360/cropH, 3);

    zoomEl.style.display='block';
    zoomEl.innerHTML=`
      <div style="border:2.5px solid ${color};border-radius:16px;overflow:hidden">
        <div style="background:${color};padding:.85rem 1.25rem;display:flex;align-items:center;gap:10px">
          <div style="width:12px;height:12px;border-radius:50%;background:#fff;opacity:.8"></div>
          <div style="font-size:15px;font-weight:700;color:#fff;flex:1">${village?.name||'Village'}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.8)">${exps.length} exposant${exps.length>1?'s':''}</div>
          <button onclick="el('plan-vis-zoom').style.display='none'" style="background:rgba(255,255,255,.2);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;color:#fff;font-size:16px">×</button>
        </div>
        <!-- Zoom visuel -->
        <div style="position:relative;overflow:hidden;height:220px;background:#f9f9f9">
          <img src="${img2.src}" style="position:absolute;transform-origin:top left;transform:scale(${zoom}) translate(-${cropX/zoom}px,-${cropY/zoom}px);height:auto;max-width:none" />
          <!-- Stands superposés -->
          ${zoneStands.map(s=>{
            const exp2=DATA.exposants.find(e=>e.id===s.exposantId); if(!exp2) return '';
            const sx=(zone.x*scaleX2 + s.relX*zone.w*scaleX2 - cropX)*zoom;
            const sy=(zone.y*scaleY2 + s.relY*zone.h*scaleY2 - cropY)*zoom;
            return `<div style="position:absolute;left:${sx}px;top:${sy}px;transform:translate(-50%,-50%);background:${color};color:#fff;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:2">${exp2.name.length>16?exp2.name.slice(0,14)+'…':exp2.name}</div>`;
          }).join('')}
        </div>
        <!-- Liste exposants -->
        <div style="padding:.85rem 1.1rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
          ${exps.map(exp2=>`<div style="display:flex;align-items:center;gap:8px;padding:.6rem .8rem;border-radius:8px;background:${color}11;border:1.5px solid ${color}33;cursor:pointer" onclick="document.getElementById('plan-vis-zoom').style.display='none';switchVisitorTab('rdvs');setTimeout(()=>openDrawer('${exp2.id}'),300)">
            <div style="width:30px;height:30px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${initials(exp2.name)}</div>
            <div style="min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${exp2.name}</div>
              <div style="font-size:10px;color:var(--ink3)">${exp2.expertise||exp2.cat||''}</div>
            </div>
          </div>`).join('')}
          ${!exps.length?`<div style="grid-column:1/-1;font-size:13px;color:var(--ink3);font-style:italic">Aucun exposant placé encore.</div>`:''}
        </div>
      </div>`;

    zoomEl.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  // Fallback : villages sans plan image
  const villages2 = DATA.villages.filter(v=>(v.exposants||[]).length>0);
  if(!bgZone?.url && villages2.length) {
    cont.innerHTML += `<div style="margin-top:2rem"><div style="font-size:14px;font-weight:700;color:var(--ink3);margin-bottom:.75rem">Villages</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem">
        ${villages2.map(v=>{
          const exps=(v.exposants||[]).map(id=>DATA.exposants.find(e=>e.id===id)).filter(Boolean);
          const color=v.color||'var(--cyan)';
          return `<div class="village-card-visitor" style="border:2.5px solid ${color};border-radius:14px;overflow:hidden;cursor:pointer" data-village-id="${v.id}">
            <div style="background:${color};padding:.85rem 1.1rem;display:flex;align-items:center;gap:10px">
              <div style="width:12px;height:12px;border-radius:50%;background:#fff;opacity:.8;flex-shrink:0"></div>
              <div style="font-size:15px;font-weight:700;color:#fff;flex:1">${v.name}</div>
              <div style="font-size:12px;color:rgba(255,255,255,.8)">${exps.length} exposant${exps.length>1?'s':''}</div>
              <i class="ti ti-chevron-down" style="color:#fff;font-size:14px;transition:.2s" id="chevron2-${v.id}"></i>
            </div>
            <div class="village-exps-list" id="vexps2-${v.id}" style="display:none;padding:.75rem;background:${color}0D">
              ${exps.map(e=>`<div class="village-exp-chip2" data-eid="${e.id}" data-vcolor="${color}"
                style="display:flex;align-items:center;gap:10px;padding:.7rem .85rem;border-radius:10px;background:#fff;border:1.5px solid ${color}44;margin-bottom:6px;cursor:pointer">
                <div style="width:32px;height:32px;border-radius:50%;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${color};flex-shrink:0">${initials(e.name)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:700;color:var(--ink)">${e.name}</div>
                  <div style="font-size:11px;color:var(--ink3)">${e.expertise||e.cat||''}</div>
                </div>
                <i class="ti ti-info-circle" style="color:${color};font-size:16px;flex-shrink:0"></i>
              </div>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div></div>`;

    // Toggle accordéon et fiches exposants pour le fallback
    cont.querySelectorAll('.village-card-visitor').forEach(card=>{
      const vid=card.dataset.villageId;
      const header=card.querySelector('div[style*="padding:.85rem"]');
      const list=document.getElementById('vexps2-'+vid);
      const chevron=document.getElementById('chevron2-'+vid);
      header?.addEventListener('click',()=>{
        if(!list) return;
        const open=list.style.display==='block';
        list.style.display=open?'none':'block';
        if(chevron) chevron.style.transform=open?'':'rotate(180deg)';
      });
    });
    cont.querySelectorAll('.village-exp-chip2').forEach(chip=>{
      chip.addEventListener('click',e=>{
        e.stopPropagation();
        const exp=DATA.exposants.find(x=>x.id===chip.dataset.eid); if(!exp) return;
        const vcolor=chip.dataset.vcolor;
        const existing=document.getElementById('exp-plan-modal'); if(existing) existing.remove();
        const overlay=document.createElement('div');
        overlay.id='exp-plan-modal';
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:800;display:flex;align-items:center;justify-content:center;padding:1rem';
        overlay.innerHTML=`<div style="background:#fff;border-radius:20px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2)">
          <div style="background:${vcolor};padding:1.25rem 1.5rem;display:flex;align-items:center;gap:12px">
            <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">${initials(exp.name)}</div>
            <div><div style="font-size:16px;font-weight:700;color:#fff">${exp.name}</div><div style="font-size:12px;color:rgba(255,255,255,.8)">${exp.cat||''}</div></div>
            <button id="close-exp-plan-modal" style="margin-left:auto;background:rgba(255,255,255,.2);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;color:#fff;font-size:18px">×</button>
          </div>
          <div style="padding:1.25rem 1.5rem">
            ${exp.expertise?`<div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:.5rem">${exp.expertise}</div>`:''}
            ${exp.email?`<div style="font-size:13px;color:var(--ink2);margin-bottom:.4rem"><a href="mailto:${exp.email}" style="color:${vcolor}">${exp.email}</a></div>`:''}
            ${exp.website?`<div style="font-size:13px;margin-bottom:.75rem"><a href="${exp.website.startsWith('http')?exp.website:'https://'+exp.website}" target="_blank" style="color:${vcolor}">${exp.website}</a></div>`:''}
            ${exp.period!=='aucun'?`<button class="btn-primary btn-rdv-from-plan" data-eid="${exp.id}" style="width:100%;justify-content:center"><i class="ti ti-calendar-plus"></i> Prendre RDV</button>`:''}
          </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click',e2=>{if(e2.target===overlay)overlay.remove();});
        document.getElementById('close-exp-plan-modal')?.addEventListener('click',()=>overlay.remove());
        overlay.querySelector('.btn-rdv-from-plan')?.addEventListener('click',()=>{
          overlay.remove();
          switchVisitorTab('rdvs');
          setTimeout(()=>openDrawer(exp.id),400);
        });
      });
    });
  }
}


function editTache(id) {
  const existing = document.getElementById('rp-edit-'+id);
  if(existing){existing.remove();return;}
  const taskEl = document.querySelector(`.rp-task[data-id="${id}"]`);
  if(!taskEl) return;

  // Chercher la tâche dans Firestore via getDocs serait async, on prend les valeurs du DOM
  const titre = taskEl.querySelector('div[style*="font-weight:700"]')?.textContent||'';
  const editForm = document.createElement('div');
  editForm.id='rp-edit-'+id;
  editForm.style.cssText='background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:10px;padding:1rem;margin-top:6px';
  editForm.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div class="field" style="grid-column:1/-1"><label>Titre</label><input id="rp-edit-titre-${id}" value="${titre.trim()}" /></div>
      <div class="field"><label>Catégorie</label><select id="rp-edit-cat-${id}">${RETRO_CATS.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
      <div class="field"><label>Date limite</label><input type="date" id="rp-edit-date-${id}" /></div>
      <div class="field"><label>Responsable</label><input id="rp-edit-resp-${id}" placeholder="Ex: TD, MM…" /></div>
      <div class="field"><label>Statut</label><select id="rp-edit-status-${id}">${RETRO_STATUS.map(s=>`<option value="${s}">${RETRO_STATUS_LABELS[s]}</option>`).join('')}</select></div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label><textarea id="rp-edit-notes-${id}" rows="2" style="width:100%;resize:vertical;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px"></textarea></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn-ghost" onclick="this.closest('#rp-edit-${id}').remove()">Annuler</button>
      <button class="btn-primary" id="rp-edit-save-${id}"><i class="ti ti-check"></i> Enregistrer</button>
    </div>`;
  taskEl.after(editForm);

  // Pré-charger depuis Firebase
  getDoc(doc(db,'retroplanning',id)).then(d=>{
    const t=d.data();
    const ti=el(`rp-edit-titre-${id}`); if(ti)ti.value=t.titre||'';
    const ca=el(`rp-edit-cat-${id}`); if(ca)ca.value=t.cat||'Autre';
    const da=el(`rp-edit-date-${id}`); if(da)da.value=t.date||'';
    const re=el(`rp-edit-resp-${id}`); if(re)re.value=t.responsable||'';
    const st=el(`rp-edit-status-${id}`); if(st)st.value=t.status||'todo';
    const no=el(`rp-edit-notes-${id}`); if(no)no.value=t.notes||'';
  });

  el(`rp-edit-save-${id}`)?.addEventListener('click', async()=>{
    loader(true);
    try {
      await updateDoc(doc(db,'retroplanning',id),{
        titre:(el(`rp-edit-titre-${id}`)?.value||'').trim(),
        cat:el(`rp-edit-cat-${id}`)?.value||'Autre',
        date:el(`rp-edit-date-${id}`)?.value||'',
        responsable:el(`rp-edit-resp-${id}`)?.value||'',
        status:el(`rp-edit-status-${id}`)?.value||'todo',
        notes:el(`rp-edit-notes-${id}`)?.value||'',
      });
      editForm.remove();
      toast('Tâche mise à jour.');
      loadTaches();
    } catch(e){console.error(e);toast('Erreur.');}
    loader(false);
  });
}


/* ── Onglet Rétro-planning ───────────────────────────────────── */

const RETRO_CATS = ['Organisation','Communication','Partenaires','Logistique','Contenu','Autre'];
const RETRO_STATUS = ['todo','en-cours','fait'];
const RETRO_STATUS_LABELS = {todo:'À faire','en-cours':'En cours',fait:'Fait'};
const RETRO_STATUS_COLORS = {todo:'#f0f0f0','en-cours':'#FFF8E6',fait:'#F0FFF4'};
const RETRO_STATUS_TEXT   = {todo:'#555','en-cours':'#B8940A',fait:'#2E6B12'};

async function renderRetroPlanning() {
  const cont = el('retroplanning-content'); if(!cont) return;
  cont.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:1.5rem">
    <div>
      <div style="font-size:20px;font-weight:700;color:var(--ink)">📋 Rétro-planning</div>
      <div style="font-size:13px;color:var(--ink3);margin-top:2px">Tâches de préparation de l'événement</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <select id="rp-filter-cat" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px">
        <option value="">Toutes catégories</option>
        ${RETRO_CATS.map(c=>`<option value="${c}">${c}</option>`).join('')}
      </select>
      <select id="rp-filter-status" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px">
        <option value="">Tous statuts</option>
        ${RETRO_STATUS.map(s=>`<option value="${s}">${RETRO_STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <button id="rp-add-btn" class="btn-primary"><i class="ti ti-plus"></i> Ajouter</button>
    </div>
  </div>
  <div id="rp-add-form" style="display:none;background:var(--cyan-l);border:1.5px solid var(--brd2);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem">
    <div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:10px">Nouvelle tâche</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="field" style="grid-column:1/-1"><label>Titre *</label><input id="rp-new-titre" placeholder="Titre de la tâche" /></div>
      <div class="field"><label>Catégorie</label><select id="rp-new-cat">${RETRO_CATS.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
      <div class="field"><label>Date limite</label><input type="date" id="rp-new-date" /></div>
      <div class="field"><label>Responsable</label><input id="rp-new-resp" placeholder="Ex: TD, MM…" /></div>
      <div class="field"><label>Statut</label><select id="rp-new-status">${RETRO_STATUS.map(s=>`<option value="${s}">${RETRO_STATUS_LABELS[s]}</option>`).join('')}</select></div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label><textarea id="rp-new-notes" rows="2" style="width:100%;resize:vertical;padding:8px 12px;border-radius:8px;border:1.5px solid var(--brd2);font-family:var(--font);font-size:13px"></textarea></div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="rp-cancel-btn" class="btn-ghost">Annuler</button>
      <button id="rp-save-btn" class="btn-primary"><i class="ti ti-check"></i> Créer</button>
    </div>
  </div>
  <div id="rp-list"></div>`;

  el('rp-add-btn')?.addEventListener('click',()=>{ const f=el('rp-add-form'); f.style.display=f.style.display==='none'?'block':'none'; });
  el('rp-cancel-btn')?.addEventListener('click',()=>{ el('rp-add-form').style.display='none'; });
  el('rp-save-btn')?.addEventListener('click', createTache);
  el('rp-filter-cat')?.addEventListener('change', loadTaches);
  el('rp-filter-status')?.addEventListener('change', loadTaches);
  loadTaches();
}

async function loadTaches() {
  const listEl = el('rp-list'); if(!listEl) return;
  const catF    = el('rp-filter-cat')?.value||'';
  const statusF = el('rp-filter-status')?.value||'';
  loader(true);
  try {
    const snap = await getDocs(query(collection(db,'retroplanning'), orderBy('createdAt')));
    let taches = snap.docs.map(d=>({id:d.id,...d.data()}));
    if(catF)    taches = taches.filter(t=>t.cat===catF);
    if(statusF) taches = taches.filter(t=>t.status===statusF);

    if(!taches.length) {
      listEl.innerHTML=`<div class="empty-state"><i class="ti ti-checklist"></i><p>Aucune tâche.</p></div>`;
      loader(false); return;
    }

    const today = new Date().toISOString().slice(0,10);
    const byCat = {};
    taches.forEach(t=>{ const c=t.cat||'Autre'; if(!byCat[c]) byCat[c]=[]; byCat[c].push(t); });

    listEl.innerHTML = Object.entries(byCat).map(([cat,tasks])=>`
      <div style="margin-bottom:1.5rem">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--cyan);padding-bottom:.4rem;margin-bottom:.75rem;border-bottom:2px solid var(--cyan-l)">
          ${cat} <span style="opacity:.5;font-weight:400">(${tasks.length})</span>
        </div>
        ${tasks.map(t=>{
          const overdue = t.date && t.date < today && t.status!=='fait';
          const dateStr = t.date ? new Date(t.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '';
          return `<div class="rp-task" data-id="${t.id}" style="background:${RETRO_STATUS_COLORS[t.status||'todo']};border:1.5px solid ${overdue?'var(--red)':'var(--brd2)'};border-radius:10px;padding:.9rem 1rem;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px">
            <button class="rp-status-btn" data-id="${t.id}" data-status="${t.status||'todo'}" title="Changer le statut"
              style="flex-shrink:0;width:28px;height:28px;border-radius:50%;border:2px solid;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;
              background:${t.status==='fait'?'#2E6B12':t.status==='en-cours'?'#B8940A':'#ccc'};
              border-color:${t.status==='fait'?'#2E6B12':t.status==='en-cours'?'#B8940A':'#ccc'};color:#fff">
              ${t.status==='fait'?'✓':t.status==='en-cours'?'…':'○'}
            </button>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;color:var(--ink);${t.status==='fait'?'text-decoration:line-through;opacity:.6':''}">${t.titre||''}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
                ${dateStr?`<span style="font-size:11px;color:${overdue?'var(--red)':'var(--ink3)'}"><i class="ti ti-calendar" style="font-size:10px"></i> ${dateStr}${overdue?' ⚠️':''}</span>`:''}
                ${t.responsable?`<span style="font-size:11px;color:var(--ink3)"><i class="ti ti-user" style="font-size:10px"></i> ${t.responsable}</span>`:''}
                <span style="font-size:10px;padding:1px 7px;border-radius:4px;font-weight:600;background:${RETRO_STATUS_COLORS[t.status||'todo']};color:${RETRO_STATUS_TEXT[t.status||'todo']};border:1px solid ${t.status==='fait'?'#6BAA38':t.status==='en-cours'?'#FFD82B':'#ddd'}">${RETRO_STATUS_LABELS[t.status||'todo']}</span>
              </div>
              ${t.notes?`<div style="font-size:12px;color:var(--ink3);margin-top:4px">${t.notes}</div>`:''}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0">
              <button class="rp-edit-btn icon-btn" data-id="${t.id}"><i class="ti ti-pencil"></i></button>
              <button class="rp-del-btn icon-btn" data-id="${t.id}" style="color:var(--red)"><i class="ti ti-trash"></i></button>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');

    listEl.querySelectorAll('.rp-status-btn').forEach(btn=>btn.addEventListener('click',()=>cycleStatus(btn.dataset.id,btn.dataset.status)));
    listEl.querySelectorAll('.rp-del-btn').forEach(btn=>btn.addEventListener('click',()=>deleteTache(btn.dataset.id)));
    listEl.querySelectorAll('.rp-edit-btn').forEach(btn=>btn.addEventListener('click',()=>editTache(btn.dataset.id)));
  } catch(e){ console.error(e); listEl.innerHTML=`<div class="empty-state"><p>Erreur chargement.</p></div>`; }
  loader(false);
}

async function cycleStatus(id, current) {
  const next = current==='todo'?'en-cours':current==='en-cours'?'fait':'todo';
  try { await updateDoc(doc(db,'retroplanning',id),{status:next}); loadTaches(); }
  catch(e){console.error(e);toast('Erreur.');}
}

async function createTache() {
  const titre=(el('rp-new-titre')?.value||'').trim();
  if(!titre){toast('Titre requis.');return;}
  loader(true);
  try {
    await addDoc(collection(db,'retroplanning'),{
      titre, cat:el('rp-new-cat')?.value||'Autre',
      date:el('rp-new-date')?.value||'',
      responsable:el('rp-new-resp')?.value||'',
      status:el('rp-new-status')?.value||'todo',
      notes:el('rp-new-notes')?.value||'',
      createdAt:Date.now()
    });
    el('rp-add-form').style.display='none';
    ['rp-new-titre','rp-new-notes','rp-new-date','rp-new-resp'].forEach(id=>{const e=el(id);if(e)e.value='';});
    toast('Tâche créée.'); loadTaches();
  } catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteTache(id) {
  if(!confirm(`Supprimer cette tâche ?`)) return;
  try { await deleteDoc(doc(db,'retroplanning',id)); loadTaches(); toast('Supprimé.'); }
  catch(e){console.error(e);toast('Erreur.');}
}


/* ── Init ─────────────────────────────────────────────────────── */
/* ── Statuts juridiques ───────────────────────────────────────── */
const STATUTS = [
  { label: 'Auto-entrepreneur / Micro-entreprise',   cat: 'Entreprise individuelle' },
  { label: 'Entreprise Individuelle (EI)',            cat: 'Entreprise individuelle' },
  { label: 'EIRL',                                    cat: 'Entreprise individuelle' },
  { label: 'EURL',                                    cat: 'Société unipersonnelle' },
  { label: 'SASU',                                    cat: 'Société unipersonnelle' },
  { label: 'SARL',                                    cat: 'Société à responsabilité limitée' },
  { label: 'SAS',                                     cat: 'Société par actions' },
  { label: 'SA',                                      cat: 'Société par actions' },
  { label: 'SNC',                                     cat: 'Société en nom collectif' },
  { label: 'SCS',                                     cat: 'Société en commandite' },
  { label: 'SCA',                                     cat: 'Société en commandite' },
  { label: 'SCOP (Société Coopérative)',              cat: 'Coopérative' },
  { label: "SCIC (Société Coopérative d'Intérêt Collectif)", cat: 'Coopérative' },
  { label: "CAE (Coopérative d'Activité et d'Emploi)", cat: 'Coopérative' },
  { label: 'Association loi 1901',                    cat: 'Association' },
  { label: "Association reconnue d'utilité publique", cat: 'Association' },
  { label: 'Fondation',                               cat: 'Association' },
  { label: 'TPE (Très Petite Entreprise)', cat: "Taille d'entreprise" },
  { label: 'PME (Petite et Moyenne Entreprise)', cat: "Taille d'entreprise" },
  { label: 'ETI (Entreprise de Taille Intermédiaire)', cat: "Taille d'entreprise" },
  { label: "GIE (Groupement d'Intérêt Économique)", cat: 'Groupement' },
  { label: 'GEIE',                                    cat: 'Groupement' },
  { label: 'SCI (Société Civile Immobilière)',        cat: 'Société civile' },
  { label: 'SCM',                                     cat: 'Société civile' },
  { label: 'SCP',                                     cat: 'Société civile' },
  { label: 'Établissement public',                    cat: 'Secteur public' },
  { label: 'Collectivité territoriale',               cat: 'Secteur public' },
  { label: 'Projet en cours de création',             cat: 'Projet' },
  { label: 'Autre',                                   cat: 'Autre' },
];

function initStructureField(searchId, dropdownId, hiddenId, wrapId, societyId) {
  const searchEl   = el(searchId);
  const dropEl     = el(dropdownId);
  const hiddenEl   = el(hiddenId);
  const wrapEl     = el(wrapId);
  const societyEl  = el(societyId);
  if (!searchEl || !dropEl || !hiddenEl) return;

  const renderDropdown = (filter) => {
    const q = filter.toLowerCase();
    const filtered = STATUTS.filter(s => !q || s.label.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q));
    if (!filtered.length) { dropEl.innerHTML = '<div class="structure-opt">Aucun résultat</div>'; }
    else {
      dropEl.innerHTML = filtered.map(s =>
        `<div class="structure-opt" data-val="${s.label}">${s.label}<span class="opt-cat">${s.cat}</span></div>`
      ).join('');
      dropEl.querySelectorAll('.structure-opt').forEach(opt => {
        opt.addEventListener('mousedown', e => {
          e.preventDefault();
          searchEl.value  = opt.dataset.val;
          hiddenEl.value  = opt.dataset.val;
          dropEl.classList.remove('open');
        });
      });
    }
    dropEl.classList.add('open');
  }

  searchEl.addEventListener('input', () => {
    renderDropdown(searchEl.value);
    // Si le texte tapé correspond exactement à un statut, on l'accepte directement
    const match = STATUTS.find(s => s.label.toLowerCase() === searchEl.value.toLowerCase());
    if(match) hiddenEl.value = match.label;
    else if(!searchEl.value.trim()) hiddenEl.value = '';
  });
  searchEl.addEventListener('focus', () => renderDropdown(searchEl.value));
  // Délai plus long pour laisser le mousedown se déclencher sur mobile
  searchEl.addEventListener('blur', () => setTimeout(() => {
    dropEl.classList.remove('open');
    // Si texte correspond à un statut connu, valider silencieusement
    const match = STATUTS.find(s => s.label.toLowerCase() === searchEl.value.toLowerCase());
    if(match) hiddenEl.value = match.label;
  }, 300));

  // Afficher/masquer le champ structure selon si société est remplie
  if (societyEl) {
    societyEl.addEventListener('input', () => {
      if (wrapEl) wrapEl.style.display = societyEl.value.trim() ? 'block' : 'none';
      if (!societyEl.value.trim()) { searchEl.value = ''; hiddenEl.value = ''; }
    });
  }
}

/* ── Paramètres admin ─────────────────────────────────────────── */

function initParametres() {
  // Sélectionner le bon radio mode (incl. fantome)
  const curMode = DATA.config.ghostMode ? 'fantome' : (DATA.config.mode||'inscription');
  const radio = document.querySelector(`input[name="site-mode"][value="${curMode}"]`);
  if(radio) radio.checked = true;
  const dateInput = el('lecture-date');
  if(dateInput) dateInput.value = DATA.config.lectureDate || '1er juillet 2026';
  if(el('ghost-mode-input')) el('ghost-mode-input').value = DATA.config.ghostMessage||'';
  const ghostWrap = el('ghost-msg-wrap');
  if(ghostWrap) ghostWrap.style.display = DATA.config.ghostMode ? 'block' : 'none';
  updateLecturePreview?.();
  updateModeLabel?.();
  el('lecture-date')?.addEventListener('input', updateLecturePreview);
  el('save-mode-btn')?.addEventListener('click', saveMode);
  el('save-lecture-btn')?.addEventListener('click', saveLectureDate);
  // Charger textes modes personnalisables
  if(el('lecture-msg-input')) el('lecture-msg-input').value = DATA.config.lectureMsg||'';
  if(el('preinscription-msg-input')) el('preinscription-msg-input').value = DATA.config.preinscriptionMsg||'';
  el('save-lecture-msg-btn')?.addEventListener('click', saveModeMessages);
  el('save-preinscription-msg-btn')?.addEventListener('click', saveModeMessages);
  // Afficher textarea ghost quand radio fantome sélectionné
  document.querySelectorAll('input[name="site-mode"]').forEach(r=>{
    r.addEventListener('change',()=>{
      const gw = el('ghost-msg-wrap');
      if(gw) gw.style.display = r.value==='fantome' ? 'block' : 'none';
    });
  });
  renderCategoriesList();
  el('add-category-btn')?.addEventListener('click', addCategory);
  el('new-category-input')?.addEventListener('keydown', e=>{ if(e.key==='Enter') addCategory(); });
}

/* ── Catégories partenaires (dynamiques — super-admin uniquement) ── */
function renderCategoriesList(){
  const listEl=el('categories-list');if(!listEl)return;
  const isSA = currentAdmin?.role?.toLowerCase()==='superadmin' || currentAdmin?.email===SUPER_ADMIN_EMAIL;
  const cats=DATA.categories.length?DATA.categories:ALL_CATS.map((c,i)=>({id:'default-'+i,name:c,order:i}));
  // Masquer le formulaire d'ajout pour les non-super-admins
  const addZone = el('add-category-btn')?.closest('div');
  if(addZone) addZone.style.display = isSA ? 'flex' : 'none';
  const restrictNote = el('categories-restrict-note');
  if(restrictNote) restrictNote.style.display = isSA ? 'none' : 'block';
  if(!cats.length){listEl.innerHTML='<div style="font-size:12px;color:var(--ink3)">Aucune catégorie. Ajoutez-en une ci-dessous.</div>';return;}
  listEl.innerHTML=cats.map(c=>`
    <div style="display:flex;align-items:center;gap:8px;background:var(--surf2);border:1.5px solid var(--brd2);border-radius:8px;padding:8px 12px">
      <i class="ti ti-tag" style="font-size:14px;color:var(--cyan);flex-shrink:0"></i>
      <span style="flex:1;font-size:13px;color:var(--ink)">${c.name}</span>
      ${isSA?`<button class="del-cat-btn" data-id="${c.id}" style="background:none;border:none;color:var(--red);cursor:pointer;padding:4px"><i class="ti ti-trash" style="font-size:14px"></i></button>`:''}
    </div>`).join('');
  listEl.querySelectorAll('.del-cat-btn').forEach(btn=>btn.addEventListener('click',()=>deleteCategory(btn.dataset.id)));
}

async function addCategory(){
  const isSA = currentAdmin?.role?.toLowerCase()==='superadmin' || currentAdmin?.email===SUPER_ADMIN_EMAIL;
  if(!isSA){toast('Seul le super-administrateur peut créer de nouvelles catégories.');return;}
  const input=el('new-category-input');
  const name=(input?.value||'').trim();
  if(!name){toast('Merci de saisir un nom de catégorie.');return;}
  if(DATA.categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){toast('Cette catégorie existe déjà.');return;}
  loader(true);
  try{
    const order=DATA.categories.length;
    const ref=await addDoc(collection(db,'categories'),{name,order,createdAt:Date.now()});
    DATA.categories.push({id:ref.id,name,order});
    if(input)input.value='';
    renderCategoriesList();
    toast('Catégorie ajoutée !');
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

async function deleteCategory(catId){
  const isSA = currentAdmin?.role?.toLowerCase()==='superadmin' || currentAdmin?.email===SUPER_ADMIN_EMAIL;
  if(!isSA){toast('Seul le super-administrateur peut supprimer une catégorie.');return;}
  if(catId.startsWith('default-')){toast('Cette catégorie par défaut ne peut pas être supprimée — ajoutez vos propres catégories.');return;}
  if(!confirm("Supprimer cette catégorie ? Les exposants/ateliers qui l'utilisent garderont leur valeur actuelle."))return;
  loader(true);
  try{
    await deleteDoc(doc(db,'categories',catId));
    DATA.categories=DATA.categories.filter(c=>c.id!==catId);
    renderCategoriesList();
    toast('Catégorie supprimée.');
  }catch(e){console.error(e);toast('Erreur.');}
  loader(false);
}

// _initParametresReal merged into initParametres

function updateLecturePreview() {
  const date = el('lecture-date')?.value || '1er juillet 2026';
  const prev = el('lecture-preview');
  if(prev) prev.innerHTML = `Les inscriptions seront ouvertes à partir du <strong>${date}</strong>. En attendant, vous pouvez consulter les experts et ateliers disponibles.`;
}

function updateModeLabel() {
  const labels = { lecture: 'Lecture seule', preinscription: 'Préinscription', inscription: 'Inscription définitive' };
  const el2 = el('mode-current-label');
  if(el2) el2.textContent = labels[DATA.config.mode] || '–';
}

async function saveMode() {
  const selected = document.querySelector('input[name="site-mode"]:checked')?.value;
  if(!selected) { toast('Choisissez un mode.'); return; }
  loader(true);
  try {
    const cfgRef = doc(db,'config','platform');
    if(selected === 'fantome') {
      // Mode fantôme : activer ghostMode
      const isSA = currentAdmin?.role?.toLowerCase()==='superadmin'||currentAdmin?.email===SUPER_ADMIN_EMAIL;
      if(!isSA){toast('Réservé au super-admin.');loader(false);return;}
      const msg = (el('ghost-mode-input')?.value||'').trim();
      if(!msg){toast('Saisissez un message à afficher aux visiteurs.');el('ghost-mode-input')?.focus();loader(false);return;}
      await updateDoc(cfgRef, {ghostMode:true, ghostMessage:msg, updatedAt:Date.now()});
      DATA.config.ghostMode=true; DATA.config.ghostMessage=msg;
      toast('Mode fantôme activé — le site est masqué aux visiteurs.');
    } else {
      // Mode normal : désactiver ghostMode si actif
      await setDoc(cfgRef, { mode:selected, lectureDate:DATA.config.lectureDate||'1er juillet 2026', ghostMode:false, updatedAt:Date.now() }, {merge:true});
      PLATFORM_MODE = selected;
      DATA.config.mode = selected;
      DATA.config.ghostMode = false;
      updateModeLabel();
      toast(`Mode "${selected}" activé !`);
    }
  } catch(e) { console.error(e); toast('Erreur.'); }
  loader(false);
}

async function saveModeMessages() {
  loader(true);
  try {
    const cfgRef = doc(db,'config','platform');
    const lectureMsg = (el('lecture-msg-input')?.value||'').trim();
    const preinscriptionMsg = (el('preinscription-msg-input')?.value||'').trim();
    await setDoc(cfgRef, { lectureMsg, preinscriptionMsg }, {merge:true});
    DATA.config.lectureMsg = lectureMsg;
    DATA.config.preinscriptionMsg = preinscriptionMsg;
    toast('Messages enregistrés !');
  } catch(e) { console.error(e); toast('Erreur.'); }
  loader(false);
}

async function saveLectureDate() {
  const date = el('lecture-date')?.value.trim();
  if(!date) { toast('Saisissez une date.'); return; }
  loader(true);
  try {
    const cfgRef = doc(db,'config','platform');
    await setDoc(cfgRef, { mode: DATA.config.mode, lectureDate: date });
    DATA.config.lectureDate = date;
    updateLecturePreview();
    toast('Date enregistrée !');
  } catch(e) { console.error(e); toast('Erreur.'); }
  loader(false);
}

const IS_ADMIN=!!el('admin-app'), IS_VISITOR=!!el('grid');

if(IS_ADMIN){
  el('add-btn')?.addEventListener('click',toggleAddForm);
  el('form-cancel')?.addEventListener('click',toggleAddForm);
  el('form-submit')?.addEventListener('click',addExposant);
  el('add-atelier-btn')?.addEventListener('click',()=>openAtelierForm());
  el('import-programme-btn')?.addEventListener('click',importProgramme);
  el('export-visiteurs-xlsx-btn')?.addEventListener('click',exportVisiteursXlsx);
  el('atelier-form-cancel')?.addEventListener('click',()=>{el('atelier-form').classList.remove('open');editAtelier=null;});
  el('atelier-form-submit')?.addEventListener('click',saveAtelier);
  el('add-flashtalk-btn')?.addEventListener('click',()=>openFlashTalkForm());
  el('flashtalk-form-cancel')?.addEventListener('click',()=>{el('flashtalk-form').classList.remove('open');editFlashTalk=null;});
  el('flashtalk-form-submit')?.addEventListener('click',saveFlashTalk);
  document.querySelectorAll('.atab').forEach(btn=>btn.addEventListener('click',()=>switchAdminTab(btn.dataset.tab)));
  el('rdv-filter-exp')?.addEventListener('change',renderRdvList);
  el('rdv-filter-period')?.addEventListener('change',renderRdvList);
  el('export-csv')?.addEventListener('click',exportCsv);
  el('vis-admin-search')?.addEventListener('input',renderVisiteursList);
  // Onglet mode
  document.querySelectorAll('.mode-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const m=btn.dataset.mode;
      loader(true);
      await setPlatformMode(m);
      renderModeAdmin();
      toast(`Mode "${m}" activé.`);
      loader(false);
    });
  });
  el('btn-launch-validation')?.addEventListener('click',launchValidation);
  el('btn-cancel-unconfirmed')?.addEventListener('click',cancelUnconfirmed);
  initLogin();
}

if(IS_VISITOR){
  document.querySelectorAll('.vtab').forEach(btn=>btn.addEventListener('click',()=>switchVisitorTab(btn.dataset.tab)));
  // Accueil actif par défaut
  // Restaurer l'onglet depuis l'URL si présent
  const _validTabs = ['accueil','rdvs','ateliers','flashtalks','planning','exposant','exposants-list','plan-visiteur'];
  const _hashTab = window.location.hash.replace('#','');
  const _initTab = _validTabs.includes(_hashTab) ? _hashTab : 'accueil';
  history.replaceState({tab:_initTab}, '', _initTab==='accueil'?window.location.pathname:'#'+_initTab);
  switchVisitorTab(_initTab, false);
  el('vis-search').addEventListener('input',renderGrid);
  el('vis-cat').addEventListener('change',renderGrid);
  el('vis-expertise')?.addEventListener('change',renderGrid);
  document.querySelectorAll('.pf').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.pf').forEach(b=>b.classList.remove('active'));btn.classList.add('active');periodFilter=btn.dataset.p;renderGrid();}));
  document.querySelectorAll('.at-pf').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.at-pf').forEach(b=>b.classList.remove('active'));btn.classList.add('active');atPeriodFilter=btn.dataset.p;renderAteliersGrid();}));
  el('at-search')?.addEventListener('input',renderAteliersGrid);
  el('el-search')?.addEventListener('input',renderExposantsList);
  el('el-cat')?.addEventListener('change',renderExposantsList);
  el('el-periode')?.addEventListener('change',renderExposantsList);
  el('at-cat')?.addEventListener('change',renderAteliersGrid);
  el('overlay').addEventListener('click',closeDrawer);
  el('drawer-close').addEventListener('click',closeDrawer);
  el('modal-close').addEventListener('click',closeModal);
  el('modal-cancel').addEventListener('click',closeModal);
  el('modal-confirm').addEventListener('click',confirmBooking);
  el('modal').addEventListener('click',e=>{if(e.target===el('modal'))closeModal();});
  el('ma-close').addEventListener('click',()=>el('modal-atelier').classList.remove('open'));
  el('ma-cancel').addEventListener('click',()=>el('modal-atelier').classList.remove('open'));
  el('ma-confirm').addEventListener('click',confirmAtelier);
  el('modal-atelier').addEventListener('click',e=>{if(e.target===el('modal-atelier'))el('modal-atelier').classList.remove('open');});
  // Sélecteurs de structure
  initStructureField('m-structure-search',  'm-structure-dropdown',  'm-structure',  'm-structure-wrap',  'm-societe');
  initStructureField('ma-structure-search', 'ma-structure-dropdown', 'ma-structure', 'ma-structure-wrap', 'ma-societe');

  el('mes-search-btn').addEventListener('click',searchMonPlanning);
  el('mes-search-input').addEventListener('keydown',e=>{if(e.key==='Enter')searchMonPlanning();});
  el('exp-search-btn')?.addEventListener('click',searchExposantPlanning);
  el('exp-email-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')searchExposantPlanning();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeDrawer();el('modal-atelier')?.classList.remove('open');}});
  loadAll().then(()=>{
    // Mode fantôme
    if(DATA.config?.ghostMode && DATA.config?.ghostMessage) {
      document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg,#F8F7F4);padding:2rem">
        <div style="max-width:500px;text-align:center;background:#fff;border-radius:20px;padding:3rem;box-shadow:0 8px 40px rgba(0,0,0,.1)">
          <img src="logo.png" style="max-width:200px;margin-bottom:1.5rem;opacity:.8" onerror="this.style.display='none'" />
          <div style="font-size:16px;color:#4A4A4A;line-height:1.8;font-family:'Montserrat',sans-serif">${DATA.config.ghostMessage}</div>
        </div>
      </div>`;
      return;
    }
    applyModeUI();renderAccueil();renderGrid();renderAteliersGrid();
  });
}
