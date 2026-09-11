/* ============================================================
   STATE (in-memory — no browser storage per environment rules)
   ============================================================ */
const state = {
  settings: {
    conversion: 1000,
    welcome: 100,
    minRedeem: 250,
    maxRedeemPct: 0.20,
    expiryMonths: 12
  },
  tiers: [
    { name:'Cloud Member', min:0,         max:2499999,     mult:1.00 },
    { name:'Cloud Silver', min:2500000,   max:4999999,     mult:1.10 },
    { name:'Cloud Gold',   min:5000000,   max:9999999,     mult:1.25 },
    { name:'Cloud Black',  min:10000000,  max:Infinity,    mult:1.50 },
  ],
  rewards: [
    { id:'R1', name:'Cloud Reward 1', points:250,  discount:5000,   active:true },
    { id:'R2', name:'Cloud Reward 2', points:500,  discount:15000,  active:true },
    { id:'R3', name:'Cloud Reward 3', points:1000, discount:35000,  active:true },
    { id:'R4', name:'Cloud Reward 4', points:1500, discount:60000,  active:true },
    { id:'R5', name:'Cloud Reward 5', points:2500, discount:125000, active:true },
  ],
  campaign: {
    name:'DOUBLE CLOUD POINTS',
    multiplier:2.0,
    minTransaction:100000,
    active:true,
    start:'2026-09-12',
    end:'2026-09-15'
  },
  members: [],
  ledger: [],
  transactions: [],
  seq:{ member:1, tx:1, ledger:1 }
};

function fmtRp(n){ return 'Rp' + Math.round(n).toLocaleString('id-ID'); }
function fmtPts(n){ return (n<0?'':'+') + Math.round(n).toLocaleString('id-ID') + ' Pts'; }
function nowISO(){ return new Date().toISOString(); }
function fmtDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) + ' ' +
         d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}
function addMonths(iso, months){
  const d = new Date(iso);
  d.setMonth(d.getMonth()+months);
  return d.toISOString();
}
function normalizeWa(wa){
  let w = (wa||'').replace(/[^\d]/g,'');
  if(w.startsWith('0')) w = '62'+w.slice(1);
  return w;
}

function tierFor(totalSpending){
  return state.tiers.find(t=> totalSpending>=t.min && totalSpending<=t.max) || state.tiers[0];
}

/* ---------- Ledger writer (single source of truth) ---------- */
function writeLedger(member, type, points, description, transactionId, expiredAt, createdBy){
  const before = member.availablePoints;
  const after = before + points;
  member.availablePoints = after;
  if(points>0){
    member.lifetimePoints += points;
  } else {
    member.redeemedPoints += Math.abs(points);
  }
  const entry = {
    id: 'LG-' + String(state.seq.ledger++).padStart(5,'0'),
    memberId: member.id,
    transactionId: transactionId || null,
    type, points,
    balanceBefore: before,
    balanceAfter: after,
    description,
    expiredAt: expiredAt || null,
    createdAt: nowISO(),
    createdBy: createdBy || 'System'
  };
  state.ledger.unshift(entry);
  return entry;
}

function evaluateTier(member){
  member.tier = tierFor(member.totalSpending).name;
}

/* ---------- Seed demo data ---------- */
function seed(){
  const seedMembers = [
    { name:'Fikri Maulana', wa:'6281234500001', totalSpending:5750000, availablePoints:1425, lifetimePoints:3200, redeemedPoints:1775, status:'ACTIVE', days:5 },
    { name:'Nadia Putri',   wa:'6281234500002', totalSpending:3100000, availablePoints:640,  lifetimePoints:900,  redeemedPoints:260,  status:'ACTIVE', days:40 },
    { name:'Reza Pratama',  wa:'6281234500003', totalSpending:12500000,availablePoints:2210, lifetimePoints:5100, redeemedPoints:2890, status:'ACTIVE', days:120 },
    { name:'Sinta Aulia',   wa:'6281234500004', totalSpending:850000,  availablePoints:100,  lifetimePoints:100,  redeemedPoints:0,    status:'ACTIVE', days:2 },
  ];
  seedMembers.forEach(sm=>{
    const m = {
      id:'M-'+String(state.seq.member++).padStart(5,'0'),
      code:'EC-'+String(state.seq.member-1).padStart(6,'0'),
      name:sm.name, whatsapp:sm.wa,
      totalSpending:sm.totalSpending,
      availablePoints:0, lifetimePoints:0, redeemedPoints:0,
      status:sm.status,
      joinedAt: new Date(Date.now()-sm.days*86400000).toISOString()
    };
    evaluateTier(m);
    state.members.push(m);
    writeLedger(m,'BONUS', sm.availablePoints, 'Saldo awal (demo seed)', null, addMonths(nowISO(), state.settings.expiryMonths), 'System');
    m.lifetimePoints = sm.lifetimePoints;
    m.redeemedPoints = sm.redeemedPoints;
  });
}
seed();

/* ============================================================
   NAVIGATION
   ============================================================ */
document.getElementById('nav').addEventListener('click', e=>{
  const btn = e.target.closest('.nav-item');
  if(!btn) return;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+btn.dataset.panel).classList.add('active');
  if(btn.dataset.panel==='member') renderMemberList();
  if(btn.dataset.panel==='ledger') renderLedger();
  if(btn.dataset.panel==='reward') renderRewardPanel();
  if(btn.dataset.panel==='dashboard') renderDashboard();
  if(btn.dataset.panel==='setting') renderSetting();
});

function tick(){
  document.getElementById('clock').textContent =
    new Date().toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}
tick();

/* ============================================================
   POS
   ============================================================ */
let posMember = null;
let posSelectedReward = null;

document.getElementById('posSearchBtn').addEventListener('click', doPosSearch);
document.getElementById('posSearchWa').addEventListener('keydown', e=>{ if(e.key==='Enter') doPosSearch(); });
document.getElementById('posSubtotal').addEventListener('input', recalcPos);
document.getElementById('posDiscount').addEventListener('input', recalcPos);
document.getElementById('posCompleteBtn').addEventListener('click', completeTransaction);

function doPosSearch(){
  const wa = normalizeWa(document.getElementById('posSearchWa').value);
  const resultEl = document.getElementById('posSearchResult');
  if(!wa){ resultEl.innerHTML=''; return; }
  const found = state.members.find(m=>m.whatsapp===wa);
  posSelectedReward = null;
  if(found){
    posMember = found;
    resultEl.innerHTML = `<div class="banner banner-good">Member ditemukan: ${found.name} · ${found.tier}</div>`;
  } else {
    posMember = null;
    resultEl.innerHTML = `
      <div class="banner banner-warn">Nomor belum terdaftar sebagai member.</div>
      <button class="btn btn-gold btn-block" id="quickRegisterBtn">Daftarkan Member Baru</button>`;
    document.getElementById('quickRegisterBtn').addEventListener('click', ()=>{
      const name = prompt('Nama pelanggan baru:');
      if(!name) return;
      posMember = registerMember(name, wa);
      resultEl.innerHTML = `<div class="banner banner-good">Member baru terdaftar: ${posMember.name} · +${state.settings.welcome} Welcome Points</div>`;
      renderPosMemberCard();
      recalcPos();
    });
  }
  renderPosMemberCard();
  recalcPos();
}

function registerMember(name, wa, createdBy){
  const m = {
    id:'M-'+String(state.seq.member++).padStart(5,'0'),
    code:'EC-'+String(state.seq.member-1).padStart(6,'0'),
    name: name.trim(), whatsapp: wa,
    totalSpending:0, availablePoints:0, lifetimePoints:0, redeemedPoints:0,
    status:'ACTIVE', joinedAt: nowISO()
  };
  evaluateTier(m);
  state.members.push(m);
  writeLedger(m, 'BONUS', state.settings.welcome, 'Welcome Member', null, addMonths(nowISO(), state.settings.expiryMonths), createdBy||'System');
  return m;
}

function renderPosMemberCard(){
  const wrap = document.getElementById('posMemberCardWrap');
  const block = document.getElementById('posRewardBlock');
  if(!posMember){ wrap.innerHTML = `<div class="card"><div class="empty">Belum ada member dipilih.<br>Cari nomor WhatsApp untuk memulai.</div></div>`; block.style.display='none'; return; }
  const t = tierFor(posMember.totalSpending);
  wrap.innerHTML = `
    <div class="member-card tier-${t.name.replace(/\s/g,'-')}">
      <div class="mc-top">
        <div>
          <div class="mc-name">${posMember.name}</div>
          <div class="mc-code">${posMember.code} · ${posMember.whatsapp}</div>
        </div>
        <div class="mc-tier">${t.name.toUpperCase()}</div>
      </div>
      <div class="mc-balance">
        <div class="num">${posMember.availablePoints.toLocaleString('id-ID')}</div>
        <div class="lbl">Cloud Points</div>
      </div>
      <div class="mc-foot">
        <div><b>${fmtRp(posMember.totalSpending)}</b>Total Belanja (12 bln)</div>
        <div><b>${t.mult.toFixed(2)}x</b>Multiplier</div>
      </div>
    </div>`;
  block.style.display = 'block';
  renderPosRewardList();
}

function activeCampaign(netAmount){
  const c = state.campaign;
  if(!c.active) return null;
  const today = new Date().toISOString().slice(0,10);
  if(today < c.start || today > c.end) return null;
  if(netAmount < c.minTransaction) return null;
  return c;
}

function renderPosRewardList(){
  const wrapEl = document.getElementById('posRewardList');
  const subtotal = Number(document.getElementById('posSubtotal').value)||0;
  const discount = Number(document.getElementById('posDiscount').value)||0;
  const net = Math.max(subtotal-discount,0);
  const maxRewardValue = net * state.settings.maxRedeemPct;
  wrapEl.innerHTML = state.rewards.map(r=>{
    const notEnoughPoints = posMember.availablePoints < r.points;
    const overCap = r.discount > maxRewardValue;
    const inactive = !r.active;
    const disabled = notEnoughPoints || overCap || inactive;
    const sel = posSelectedReward===r.id;
    let reason = '';
    if(inactive) reason='Nonaktif';
    else if(notEnoughPoints) reason='Saldo poin kurang';
    else if(overCap) reason=`Melebihi batas 20% (maks ${fmtRp(maxRewardValue)})`;
    return `<div class="reward-opt ${sel?'selected':''} ${disabled?'disabled':''}" data-id="${r.id}" data-disabled="${disabled}">
      <div>
        <div class="rname">${r.name}</div>
        <div class="rmeta">${r.points.toLocaleString('id-ID')} Points ${reason?('· '+reason):''}</div>
      </div>
      <div class="rval">-${fmtRp(r.discount)}</div>
    </div>`;
  }).join('');
  wrapEl.querySelectorAll('.reward-opt').forEach(el=>{
    el.addEventListener('click', ()=>{
      if(el.dataset.disabled==='true') return;
      const id = el.dataset.id;
      posSelectedReward = posSelectedReward===id ? null : id;
      renderPosRewardList();
      recalcPos();
    });
  });
}

function recalcPos(){
  const subtotal = Number(document.getElementById('posSubtotal').value)||0;
  const discount = Number(document.getElementById('posDiscount').value)||0;
  const net = Math.max(subtotal-discount,0);
  const tierMult = posMember ? tierFor(posMember.totalSpending).mult : 1.0;
  const camp = posMember ? activeCampaign(net) : null;
  const campMult = camp ? camp.multiplier : 1.0;

  const base = Math.floor(net/state.settings.conversion);
  const earned = Math.floor(base*tierMult*campMult);

  let rewardDiscount = 0;
  if(posMember && posSelectedReward){
    const r = state.rewards.find(x=>x.id===posSelectedReward);
    if(r) rewardDiscount = r.discount;
  }

  document.getElementById('calcNet').textContent = fmtRp(net);
  document.getElementById('calcBase').textContent = base.toLocaleString('id-ID');
  document.getElementById('calcTierMult').textContent = tierMult.toFixed(2)+'x';
  document.getElementById('calcCampMult').textContent = campMult.toFixed(2)+'x' + (camp?` (${camp.name})`:'');
  document.getElementById('calcRewardDisc').textContent = fmtRp(rewardDiscount);
  document.getElementById('calcEarned').textContent = '+'+earned.toLocaleString('id-ID');

  if(posMember) renderPosRewardList();

  const completeBtn = document.getElementById('posCompleteBtn');
  completeBtn.disabled = !(posMember && net>0);
}

function completeTransaction(){
  if(!posMember) return;
  const subtotal = Number(document.getElementById('posSubtotal').value)||0;
  const discount = Number(document.getElementById('posDiscount').value)||0;
  const net = Math.max(subtotal-discount,0);
  if(net<=0){ return; }

  const tierMult = tierFor(posMember.totalSpending).mult;
  const camp = activeCampaign(net);
  const campMult = camp ? camp.multiplier : 1.0;
  const base = Math.floor(net/state.settings.conversion);
  const earned = Math.floor(base*tierMult*campMult);

  let pointDiscount = 0, redeemedPointsUsed = 0, rewardUsed = null;
  if(posSelectedReward){
    rewardUsed = state.rewards.find(r=>r.id===posSelectedReward);
    const maxRewardValue = net*state.settings.maxRedeemPct;
    const eligible = rewardUsed && rewardUsed.active &&
      posMember.availablePoints>=rewardUsed.points &&
      rewardUsed.discount<=maxRewardValue;
    if(eligible){
      pointDiscount = rewardUsed.discount;
      redeemedPointsUsed = rewardUsed.points;
    } else {
      rewardUsed = null;
    }
  }

  const txId = 'INV-'+String(state.seq.tx++).padStart(5,'0');

  if(redeemedPointsUsed>0){
    writeLedger(posMember, 'REDEEM', -redeemedPointsUsed,
      `Redeem ${rewardUsed.name} pada ${txId}`, txId, null, 'Cashier');
  }

  posMember.totalSpending += net;
  evaluateTier(posMember);

  writeLedger(posMember, 'EARN', earned,
    `${txId} — belanja ${fmtRp(net)}${camp?` (promo ${camp.name} ${campMult}x)`:''}`,
    txId, addMonths(nowISO(), state.settings.expiryMonths), 'System');

  state.transactions.unshift({
    id: txId, memberId: posMember.id, subtotal, discount, pointDiscount,
    grandTotal: subtotal-discount-pointDiscount,
    basePoints: base, earnedPoints: earned, pointsRedeemed: redeemedPointsUsed,
    status:'SUCCESS', createdAt: nowISO()
  });

  document.getElementById('posMsg').innerHTML =
    `<div class="banner banner-good">Transaksi ${txId} berhasil. ${posMember.name} mendapat +${earned} Cloud Points.
     ${rewardUsed? ` Reward ${rewardUsed.name} diterapkan (-${fmtRp(rewardUsed.discount)}).`:''}</div>`;

  document.getElementById('posSubtotal').value='';
  document.getElementById('posDiscount').value='0';
  posSelectedReward = null;
  renderPosMemberCard();
  recalcPos();
}

/* ============================================================
   MEMBER PANEL
   ============================================================ */
document.getElementById('openRegisterBtn').addEventListener('click', ()=>{
  const c = document.getElementById('registerCard');
  c.style.display = c.style.display==='none' ? 'block':'none';
  document.getElementById('welcomePreview').textContent = state.settings.welcome;
});
document.getElementById('regCancelBtn').addEventListener('click', ()=>{
  document.getElementById('registerCard').style.display='none';
});
document.getElementById('regSubmitBtn').addEventListener('click', ()=>{
  const name = document.getElementById('regName').value.trim();
  const wa = normalizeWa(document.getElementById('regWa').value);
  const msg = document.getElementById('regMsg');
  if(!name || !wa){ msg.innerHTML = `<div class="banner banner-err">Nama dan nomor WhatsApp wajib diisi.</div>`; return; }
  if(state.members.find(m=>m.whatsapp===wa)){ msg.innerHTML = `<div class="banner banner-err">Nomor WhatsApp sudah terdaftar.</div>`; return; }
  const m = registerMember(name, wa, 'Admin');
  msg.innerHTML = `<div class="banner banner-good">${m.name} terdaftar sebagai ${m.code} dengan +${state.settings.welcome} Welcome Points.</div>`;
  document.getElementById('regName').value=''; document.getElementById('regWa').value='';
  renderMemberList();
});

function renderMemberList(){
  const tbody = document.getElementById('memberTbody');
  const empty = document.getElementById('memberEmpty');
  if(state.members.length===0){ tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML = state.members.map(m=>{
    const t = tierFor(m.totalSpending);
    return `<tr>
      <td><b>${m.name}</b><div class="muted small">${m.code}</div></td>
      <td>${m.whatsapp}</td>
      <td>${t.name}</td>
      <td>${fmtRp(m.totalSpending)}</td>
      <td>${m.availablePoints.toLocaleString('id-ID')} Pts</td>
      <td><span class="tag ${m.status==='ACTIVE'?'tag-earn':'tag-redeem'}">${m.status}</span></td>
    </tr>`;
  }).join('');
}

/* ============================================================
   LEDGER PANEL
   ============================================================ */
let ledgerFilter = 'ALL';
function renderLedgerFilters(){
  const box = document.getElementById('ledgerFilterMember');
  const chips = ['ALL', ...state.members.map(m=>m.id)];
  box.innerHTML = chips.map(id=>{
    const label = id==='ALL' ? 'Semua Member' : state.members.find(m=>m.id===id).name;
    return `<div class="pill ${ledgerFilter===id?'active':''}" data-id="${id}">${label}</div>`;
  }).join('');
  box.querySelectorAll('.pill').forEach(p=>{
    p.addEventListener('click', ()=>{ ledgerFilter = p.dataset.id; renderLedger(); });
  });
}

const typeTagClass = { EARN:'tag-earn', REDEEM:'tag-redeem', BONUS:'tag-bonus', EXPIRE:'tag-expire', ADJUSTMENT:'tag-adjustment', REFUND:'tag-refund' };

function renderLedger(){
  renderLedgerFilters();
  const tbody = document.getElementById('ledgerTbody');
  const empty = document.getElementById('ledgerEmpty');
  let rows = state.ledger;
  if(ledgerFilter!=='ALL') rows = rows.filter(l=>l.memberId===ledgerFilter);
  if(rows.length===0){ tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML = rows.map(l=>{
    const m = state.members.find(mm=>mm.id===l.memberId);
    return `<tr>
      <td class="small muted">${fmtDate(l.createdAt)}</td>
      <td>${m? m.name : '-'}</td>
      <td><span class="tag ${typeTagClass[l.type]||''}">${l.type}</span></td>
      <td class="small">${l.description}</td>
      <td style="font-weight:700;color:${l.points<0?'var(--danger)':'var(--good)'};">${fmtPts(l.points)}</td>
      <td>${l.balanceAfter.toLocaleString('id-ID')}</td>
    </tr>`;
  }).join('');
}

/* ============================================================
   REWARD / CAMPAIGN PANEL
   ============================================================ */
function renderRewardPanel(){
  document.getElementById('minRedeemLabel').textContent = state.settings.minRedeem;
  const tbody = document.getElementById('rewardTbody');
  tbody.innerHTML = state.rewards.map(r=>`
    <tr>
      <td><b>${r.name}</b></td>
      <td>${r.points.toLocaleString('id-ID')}</td>
      <td>${fmtRp(r.discount)}</td>
      <td><span class="tag ${r.active?'tag-earn':'tag-expire'}">${r.active?'AKTIF':'NONAKTIF'}</span></td>
      <td><button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" data-id="${r.id}">${r.active?'Nonaktifkan':'Aktifkan'}</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('button[data-id]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const r = state.rewards.find(x=>x.id===b.dataset.id);
      r.active = !r.active;
      renderRewardPanel();
    });
  });

  const c = state.campaign;
  document.getElementById('campaignBlock').innerHTML = `
    <div class="banner ${c.active?'banner-good':'banner-warn'}">${c.name} — ${c.active?'AKTIF':'NONAKTIF'}</div>
    <table>
      <tr><td class="muted">Multiplier</td><td style="text-align:right;font-weight:700;">${c.multiplier.toFixed(2)}x</td></tr>
      <tr><td class="muted">Minimum Transaksi</td><td style="text-align:right;">${fmtRp(c.minTransaction)}</td></tr>
      <tr><td class="muted">Periode</td><td style="text-align:right;">${c.start} — ${c.end}</td></tr>
    </table>
    <p class="hint" style="margin-top:12px;">earned_points = floor(base_points × tier_multiplier × campaign_multiplier)</p>
    <button class="btn ${c.active?'btn-ghost':'btn-primary'}" id="toggleCampaignBtn">${c.active?'Nonaktifkan Campaign':'Aktifkan Campaign'}</button>
  `;
  document.getElementById('toggleCampaignBtn').addEventListener('click', ()=>{
    c.active = !c.active; renderRewardPanel();
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(){
  const totalMember = state.members.length;
  const activeMember = state.members.filter(m=>m.status==='ACTIVE').length;
  const issued = state.ledger.filter(l=>l.points>0).reduce((s,l)=>s+l.points,0);
  const redeemed = state.ledger.filter(l=>l.type==='REDEEM').reduce((s,l)=>s+Math.abs(l.points),0);
  const outstanding = state.members.reduce((s,m)=>s+m.availablePoints,0);
  const totalSales = state.transactions.reduce((s,t)=>s+t.grandTotal,0);
  const avgTx = state.transactions.length ? totalSales/state.transactions.length : 0;
  const redemptionRate = issued>0 ? (redeemed/issued*100) : 0;

  const kpis = [
    ['Total Member', totalMember.toLocaleString('id-ID'), ''],
    ['Member Aktif', activeMember.toLocaleString('id-ID'), ''],
    ['Points Issued', issued.toLocaleString('id-ID'), ''],
    ['Points Redeemed', redeemed.toLocaleString('id-ID'), ''],
    ['Outstanding Points', outstanding.toLocaleString('id-ID'), ''],
    ['Total Sales (POS)', fmtRp(totalSales), ''],
    ['Avg. Transaction', fmtRp(avgTx), ''],
    ['Redemption Rate', redemptionRate.toFixed(1)+'%', ''],
  ];
  document.getElementById('kpiGrid').innerHTML = kpis.map(([lbl,val])=>`
    <div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>
  `).join('');

  const dist = state.tiers.map(t=>({t, count: state.members.filter(m=>tierFor(m.totalSpending).name===t.name).length}));
  const maxCount = Math.max(1,...dist.map(d=>d.count));
  document.getElementById('tierDist').innerHTML = dist.map(d=>`
    <div style="margin-bottom:12px;">
      <div class="flex-between small"><span>${d.t.name}</span><span class="muted">${d.count} member</span></div>
      <div style="background:#EEF3F2;border-radius:6px;height:8px;margin-top:5px;overflow:hidden;">
        <div style="width:${(d.count/maxCount*100)}%;background:var(--teal);height:100%;"></div>
      </div>
    </div>`).join('');

  const soon = state.ledger.filter(l=>{
    if(!l.expiredAt || l.points<=0) return false;
    const days = (new Date(l.expiredAt)-new Date())/86400000;
    return days>0 && days<=30;
  });
  document.getElementById('expiringList').innerHTML = soon.length ? soon.slice(0,6).map(l=>{
    const m = state.members.find(mm=>mm.id===l.memberId);
    const days = Math.round((new Date(l.expiredAt)-new Date())/86400000);
    return `<div class="flex-between small" style="padding:8px 0;border-bottom:1px solid #EEF3F2;">
      <span>${m?m.name:'-'} <span class="muted">· ${l.points} Pts</span></span>
      <span class="muted">${days} hari lagi</span>
    </div>`;
  }).join('') : `<div class="empty">Tidak ada poin yang akan kedaluwarsa dalam 30 hari.</div>`;
}

/* ============================================================
   SETTING
   ============================================================ */
function renderSetting(){
  document.getElementById('setConversion').value = state.settings.conversion;
  document.getElementById('setWelcome').value = state.settings.welcome;
  document.getElementById('setMinRedeem').value = state.settings.minRedeem;
  document.getElementById('setMaxRedeemPct').value = Math.round(state.settings.maxRedeemPct*100);
  document.getElementById('setExpiry').value = state.settings.expiryMonths;

  document.getElementById('tierListView').innerHTML = state.tiers.map(t=>`
    <div class="tier-chip">
      <div class="tn">${t.name}</div>
      <div class="tm">${t.mult.toFixed(2)}x multiplier</div>
      <div class="tr">${fmtRp(t.min)} ${t.max===Infinity?'ke atas':'— '+fmtRp(t.max)}</div>
    </div>`).join('');
}
document.getElementById('saveSettingBtn').addEventListener('click', ()=>{
  state.settings.conversion = Number(document.getElementById('setConversion').value)||1000;
  state.settings.welcome = Number(document.getElementById('setWelcome').value)||0;
  state.settings.minRedeem = Number(document.getElementById('setMinRedeem').value)||0;
  state.settings.maxRedeemPct = (Number(document.getElementById('setMaxRedeemPct').value)||0)/100;
  state.settings.expiryMonths = Number(document.getElementById('setExpiry').value)||12;
  document.getElementById('setMsg').innerHTML = `<div class="banner banner-good">Setting tersimpan.</div>`;
  recalcPos();
});

/* ---------- initial paint ---------- */
renderPosMemberCard();
recalcPos();
