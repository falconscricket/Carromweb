/* Two Hearts Carrom — game logic */

/* ================= ambience: floating hearts ================= */
(function(){
  const box = document.getElementById('heartsBg');
  const glyphs = ['💗','💕','🤍','💓'];
  for(let i=0;i<10;i++){
    const s = document.createElement('span');
    s.textContent = glyphs[i % glyphs.length];
    s.style.left = (Math.random()*100)+'%';
    s.style.fontSize = (16+Math.random()*18)+'px';
    s.style.animationDuration = (10+Math.random()*10)+'s';
    s.style.animationDelay = (Math.random()*10)+'s';
    box.appendChild(s);
  }
})();

/* ================= screen navigation ================= */
function goTo(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

const state = {
  roomCode: null,
  p1Name: 'You',
  p2Name: 'Partner'
};

function randomCode(){
  const words = ['LOVE','HEART','KISS','DUO','ROSE','TWIN','VOWS','MOON'];
  const w = words[Math.floor(Math.random()*words.length)];
  const n = Math.floor(10 + Math.random()*89);
  return w + n;
}

function createRoom(){
  const n1 = document.getElementById('createName1').value.trim();
  const n2 = document.getElementById('createName2').value.trim();
  state.p1Name = n1 || 'You';
  state.p2Name = n2 || 'Partner';
  state.roomCode = randomCode();
  document.getElementById('lobbyCode').textContent = state.roomCode;
  goTo('screen-lobby');
}

function joinRoom(){
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  const name = document.getElementById('joinName').value.trim();
  state.roomCode = code || randomCode();
  state.p1Name = name || 'You';
  state.p2Name = 'Partner';
  document.getElementById('lobbyCode').textContent = state.roomCode;
  goTo('screen-lobby');
}

function startGame(){
  document.getElementById('nameP1').textContent = state.p1Name;
  document.getElementById('nameP2').textContent = state.p2Name;
  goTo('screen-game');
  requestAnimationFrame(()=>{ initGame(); });
}

/* ================= CARROM GAME ENGINE ================= */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const SIZE = 680;
// render at full device pixel density so the board & coins stay crisp on phones
const DPR = Math.min(window.devicePixelRatio || 1, 3);
canvas.width = SIZE * DPR;
canvas.height = SIZE * DPR;
ctx.scale(DPR, DPR);
ctx.imageSmoothingEnabled = true;
const PAD = 46;               // inner playfield padding
const INNER = SIZE - PAD*2;
const PIECE_R = 21;
const STRIKER_R = 26;
const POCKET_R = 34;           // capture radius, matched closely to the visual hole
const POCKET_MAGNET_R = 52;    // pieces drifting slowly this close get gently pulled in, like real momentum near a hole
const FRICTION = 0.9835;
const MIN_VEL = 0.045;
const WALL_RESTITUTION = 0.8;
const MAX_PULL = 175;
const POWER_SCALE = 0.225;
const SUBSTEPS = 8;
const FRICTION_SUB = Math.pow(FRICTION, 1/SUBSTEPS);
const MASS = { pink:1, cream:1, queen:1, striker:1.35 };

let pieces = [];      // {x,y,vx,vy,r,color,type,trail:[]}
let striker = null;
let turn = 1;          // 1 = pink (p1), 2 = cream (p2)
let scores = {1:0, 2:0};
let animating = false;
let inputLocked = false;
let dragging = false;
let dragStart = null;
let dragCurrent = null;
let sliderDragging = false;
let gameOver = false;
let consecutive = {1:false,2:false};

const pocketCenters = [
  {x:PAD, y:PAD}, {x:SIZE-PAD, y:PAD},
  {x:PAD, y:SIZE-PAD}, {x:SIZE-PAD, y:SIZE-PAD}
];

function initGame(){
  gameOver = false;
  scores = {1:0,2:0};
  turn = 1;
  strikerFouled = false;
  strokeEvents = [];
  queenPending = null;
  pocketFlashes = [];
  document.getElementById('scoreP1').textContent = '0';
  document.getElementById('scoreP2').textContent = '0';
  setupPieces();
  resetStrikerToBaseline();
  updateTurnUI();
  requestAnimationFrame(loop);
}

function resetMatch(){ initGame(); }
function rematch(){
  document.getElementById('resultOverlay').classList.add('hidden');
  initGame();
}

/* hex circle-packing layout: cube coords radius 2 -> 19 cells,
   pieces alternate pink/cream around each ring (angle-sorted) for a proper
   flower pattern like a real carrom board opening. */
function setupPieces(){
  pieces = [];
  const cx = SIZE/2, cy = SIZE/2;
  const spacing = PIECE_R * 1.02; // touching-ish
  const cells = [];
  for(let q=-2;q<=2;q++){
    for(let r=-2;r<=2;r++){
      const s = -q-r;
      if(Math.abs(s) <= 2){
        const x = cx + spacing*Math.sqrt(3)*(q + r/2);
        const y = cy + spacing*1.5*r;
        cells.push({q,r,s, x, y, ring: Math.max(Math.abs(q),Math.abs(r),Math.abs(s))});
      }
    }
  }
  const ring0 = cells.filter(c=>c.ring===0);
  const ring1 = cells.filter(c=>c.ring===1).sort((a,b)=> Math.atan2(a.y-cy,a.x-cx) - Math.atan2(b.y-cy,b.x-cx));
  const ring2 = cells.filter(c=>c.ring===2).sort((a,b)=> Math.atan2(a.y-cy,a.x-cx) - Math.atan2(b.y-cy,b.x-cx));

  ring0.forEach(c=> pieces.push({x:c.x,y:c.y,vx:0,vy:0,r:PIECE_R,color:'queen',type:'queen',trail:[],alive:true}));
  ring1.forEach((c,i)=>{
    const type = i%2===0 ? 'pink' : 'cream';
    pieces.push({x:c.x,y:c.y,vx:0,vy:0,r:PIECE_R,color:type,type,trail:[],alive:true});
  });
  ring2.forEach((c,i)=>{
    const type = i%2===0 ? 'cream' : 'pink';
    pieces.push({x:c.x,y:c.y,vx:0,vy:0,r:PIECE_R,color:type,type,trail:[],alive:true});
  });
}

function baselineY(){ return turn===1 ? SIZE - PAD - 60 : PAD + 60; }

function resetStrikerToBaseline(){
  striker = {
    x: SIZE/2, y: baselineY(),
    vx:0, vy:0, r: STRIKER_R,
    color: turn===1?'pink':'cream', type:'striker', trail:[], alive:true
  };
  updateKnobFromStriker();
}

function updateTurnUI(message){
  document.getElementById('scoreP1').textContent = scores[1];
  document.getElementById('scoreP2').textContent = scores[2];
  const p1chip = document.getElementById('chipP1');
  const p2chip = document.getElementById('chipP2');
  p1chip.classList.toggle('turn-ring', turn===1);
  p2chip.classList.toggle('turn-ring', turn===2);
  const banner = document.getElementById('turnBanner');
  if(message){
    banner.textContent = message;
  } else {
    let txt = (turn===1? state.p1Name : state.p2Name) + "'s turn " + (turn===1?'💗':'🤍');
    if(queenPending && queenPending.owner===turn) txt = 'Cover the Queen! 👑';
    banner.textContent = txt;
  }
  if(striker) striker.color = turn===1?'pink':'cream';
}

/* ---------------- physics ---------------- */
function anyMoving(){
  const all = [...pieces.filter(p=>p.alive), striker].filter(Boolean);
  return all.some(p => Math.abs(p.vx) > MIN_VEL || Math.abs(p.vy) > MIN_VEL);
}

function stepPhysics(){
  const all = [...pieces.filter(p=>p.alive)];
  if(striker && striker.alive) all.push(striker);
  if(all.length === 0) return;

  for(let s=0; s<SUBSTEPS; s++){
    // integrate a fraction of the motion + apply per-substep friction (prevents tunneling)
    all.forEach(p=>{
      p.x += p.vx / SUBSTEPS;
      p.y += p.vy / SUBSTEPS;
      p.vx *= FRICTION_SUB;
      p.vy *= FRICTION_SUB;
    });

    // pockets are checked BEFORE the wall bounce — otherwise a piece heading
    // straight into a corner hole gets reflected off the wall a hair before
    // it ever reaches the pocket's capture radius, and it never falls in.
    const pocketed = [];
    all.forEach(p=>{
      if(!p.alive) return;
      for(const pc of pocketCenters){
        const dist = Math.hypot(p.x-pc.x, p.y-pc.y);
        if(dist < POCKET_R){ pocketed.push(p); break; }
        // gentle magnet: a slow-moving piece lingering right at the lip of a
        // pocket gets nudged in rather than balancing on the edge forever
        const speed = Math.hypot(p.vx,p.vy);
        if(dist < POCKET_MAGNET_R && speed < 3.2){
          const pull = 0.55;
          p.x += (pc.x-p.x)/dist*pull;
          p.y += (pc.y-p.y)/dist*pull;
        }
      }
    });
    pocketed.forEach(p=> handlePocket(p));

    // walls — only for pieces that didn't just fall into a pocket
    all.forEach(p=>{
      if(!p.alive) return;
      if(p.x - p.r < PAD){ p.x = PAD + p.r; p.vx = Math.abs(p.vx)*WALL_RESTITUTION; }
      if(p.x + p.r > SIZE-PAD){ p.x = SIZE-PAD - p.r; p.vx = -Math.abs(p.vx)*WALL_RESTITUTION; }
      if(p.y - p.r < PAD){ p.y = PAD + p.r; p.vy = Math.abs(p.vy)*WALL_RESTITUTION; }
      if(p.y + p.r > SIZE-PAD){ p.y = SIZE-PAD - p.r; p.vy = -Math.abs(p.vy)*WALL_RESTITUTION; }
    });

    // collisions — a couple of relaxation passes for stable stacked contacts
    for(let iter=0; iter<2; iter++){
      for(let i=0;i<all.length;i++){
        for(let j=i+1;j<all.length;j++){
          resolveCollision(all[i], all[j]);
        }
      }
    }
  }

  // trail + final velocity clamp, once per frame
  all.forEach(p=>{
    if(!p.alive) return;
    if(Math.abs(p.vx) < MIN_VEL) p.vx = 0;
    if(Math.abs(p.vy) < MIN_VEL) p.vy = 0;
    const speed = Math.hypot(p.vx,p.vy);
    if(speed > 0.6){
      p.trail.push({x:p.x, y:p.y});
      if(p.trail.length > 10) p.trail.shift();
    } else if(p.trail.length){
      p.trail.shift();
    }
  });
}

function resolveCollision(a,b){
  if(!a.alive || !b.alive) return;
  const dx = b.x-a.x, dy = b.y-a.y;
  const dist = Math.hypot(dx,dy);
  const minDist = a.r+b.r;
  if(dist === 0 || dist >= minDist) return;
  const nx = dx/dist, ny = dy/dist;
  const ma = MASS[a.type] || 1, mb = MASS[b.type] || 1;
  const totalMass = ma+mb;
  const overlap = (minDist-dist);
  // push apart proportional to the OTHER body's mass (heavier body moves less)
  a.x -= nx*overlap*(mb/totalMass); a.y -= ny*overlap*(mb/totalMass);
  b.x += nx*overlap*(ma/totalMass); b.y += ny*overlap*(ma/totalMass);

  const avx = a.vx, avy = a.vy, bvx = b.vx, bvy = b.vy;
  const relVel = (bvx-avx)*nx + (bvy-avy)*ny;
  if(relVel > 0) return;
  const restitution = 0.9;
  const impulse = -(1+restitution)*relVel / (1/ma + 1/mb);
  a.vx -= (impulse/ma)*nx; a.vy -= (impulse/ma)*ny;
  b.vx += (impulse/mb)*nx; b.vy += (impulse/mb)*ny;
}

let strikerFouled = false;
let strokeEvents = [];      // pieces pocketed during the current stroke, resolved once it settles
let queenPending = null;    // {owner} when queen is pocketed and awaiting a cover shot

let pocketFlashes = []; // {x,y,age,color}

function handlePocket(p){
  if(!p.alive) return;
  p.alive = false;
  pocketFlashes.push({x:p.x, y:p.y, age:0, color:p.type});
  p.trail = [];
  if(navigator.vibrate) navigator.vibrate(15);
  if(p.type === 'striker'){
    strikerFouled = true;
    return;
  }
  strokeEvents.push({type:p.type});
}

function respawnQueen(){
  const q = pieces.find(pc=>pc.type==='queen');
  if(!q) return;
  q.alive = true; q.trail = [];
  // put it back at the center; nudge aside if another piece already sits there
  let x = SIZE/2, y = SIZE/2, tries = 0;
  while(pieces.some(pc=>pc!==q && pc.alive && Math.hypot(pc.x-x,pc.y-y) < PIECE_R*1.9) && tries<12){
    const a = Math.random()*Math.PI*2;
    x = SIZE/2 + Math.cos(a)*PIECE_R*2.1;
    y = SIZE/2 + Math.sin(a)*PIECE_R*2.1;
    tries++;
  }
  q.x = x; q.y = y; q.vx = 0; q.vy = 0;
}

/* ---------------- render ---------------- */
function drawBoard(){
  ctx.clearRect(0,0,SIZE,SIZE);

  // outer frame (deep plum, like a lacquered rim) — matches the dark mat a real
  // carrom board sits on in the reference photo
  const frameG = ctx.createLinearGradient(0,0,SIZE,SIZE);
  frameG.addColorStop(0,'#5c1c4e');
  frameG.addColorStop(.5,'#3a1032');
  frameG.addColorStop(1,'#20081c');
  ctx.fillStyle = frameG;
  ctx.fillRect(0,0,SIZE,SIZE);

  // wood base (playfield) — warmer, more saturated honey-wood like the reference board
  const g = ctx.createRadialGradient(SIZE*0.42,SIZE*0.38,30, SIZE/2,SIZE/2, SIZE*0.78);
  g.addColorStop(0,'#f0c179');
  g.addColorStop(0.4,'#dda155');
  g.addColorStop(0.75,'#bf8039');
  g.addColorStop(1,'#93611f');
  ctx.fillStyle = g;
  roundRectPath(PAD-8,PAD-8,INNER+16,INNER+16,14);
  ctx.fill();

  // wood grain lines
  ctx.save();
  roundRectPath(PAD-8,PAD-8,INNER+16,INNER+16,14);
  ctx.clip();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#3a1f0a';
  ctx.lineWidth = 1.4;
  for(let i=0;i<30;i++){
    ctx.beginPath();
    ctx.moveTo(0, i*(SIZE/28) + (Math.sin(i*1.3)*5));
    ctx.lineTo(SIZE, i*(SIZE/28) + (Math.cos(i*1.1)*5));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // soft vignette so the corners read a touch darker, like a lacquered board
  const vg = ctx.createRadialGradient(SIZE/2,SIZE/2, INNER*0.3, SIZE/2,SIZE/2, INNER*0.75);
  vg.addColorStop(0,'rgba(0,0,0,0)');
  vg.addColorStop(1,'rgba(30,8,20,0.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0,0,SIZE,SIZE);
  // gentle top-left sheen (glossy varnish look)
  const sheen = ctx.createLinearGradient(PAD, PAD, SIZE*0.65, SIZE*0.6);
  sheen.addColorStop(0,'rgba(255,255,255,0.16)');
  sheen.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0,0,SIZE,SIZE);
  ctx.restore();

  // slim gold rounded rim around playfield
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,225,160,0.55)';
  roundRectPath(PAD-8,PAD-8,INNER+16,INNER+16,14);
  ctx.stroke();

  // single guide-line square track (classic carrom "border line") ~24px in from the edge
  const inset = 24;
  ctx.strokeStyle = 'rgba(70,28,20,0.55)';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(PAD+inset, PAD+inset, INNER-inset*2, INNER-inset*2);

  // small addition-circles paired at each corner, sitting right on the guide line —
  // this is the pattern in the reference board (one circle in from each direction)
  const cornerDirs = [
    {cx:PAD, cy:PAD, dx:1, dy:1}, {cx:SIZE-PAD, cy:PAD, dx:-1, dy:1},
    {cx:PAD, cy:SIZE-PAD, dx:1, dy:-1}, {cx:SIZE-PAD, cy:SIZE-PAD, dx:-1, dy:-1}
  ];
  const lineX0 = PAD+inset, lineX1 = SIZE-PAD-inset;
  cornerDirs.forEach(c=>{
    const gapFromEdge = 46; // distance along each guide-line arm from its corner
    const spots = [
      { x: c.cx + c.dx*gapFromEdge, y: c.cy + c.dy*inset },
      { x: c.cx + c.dx*inset,       y: c.cy + c.dy*gapFromEdge }
    ];
    spots.forEach(s=>{
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9.5, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,225,160,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,60,90,0.14)';
      ctx.fill();
    });
  });

  // center circle + faint 8-point rangoli, quiet enough not to compete with the pieces
  ctx.save();
  ctx.translate(SIZE/2, SIZE/2);
  ctx.strokeStyle = 'rgba(120,45,40,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0,0,100,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle = 'rgba(212,132,159,0.28)';
  ctx.lineWidth = 1.4;
  for(let i=0;i<8;i++){
    ctx.rotate(Math.PI/4);
    ctx.beginPath();
    ctx.moveTo(0,-40); ctx.lineTo(0,-100);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(232,193,112,0.14)';
  ctx.beginPath();
  for(let i=0;i<8;i++){
    const a = i*Math.PI/4;
    const rr = i%2===0 ? 96 : 58;
    ctx.lineTo(Math.cos(a)*rr, Math.sin(a)*rr);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // pockets — deep black holes cut right into the corner, gold-trimmed like the reference
  pocketCenters.forEach(pc=>{
    // soft outer shadow so the hole reads clearly against the wood
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, POCKET_R+13, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();
    // gold rounded holder ring
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, POCKET_R+6, 0, Math.PI*2);
    const holderG = ctx.createRadialGradient(pc.x-8,pc.y-8,2, pc.x,pc.y,POCKET_R+6);
    holderG.addColorStop(0,'#ffe9a8');
    holderG.addColorStop(0.6,'#e8c170');
    holderG.addColorStop(1,'#a8762f');
    ctx.fillStyle = holderG;
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,42,10,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // the hole itself — near-black with a soft rim highlight so it reads as a real depression
    const pg = ctx.createRadialGradient(pc.x-6,pc.y-6,2,pc.x,pc.y,POCKET_R);
    pg.addColorStop(0,'#2c2c2c');
    pg.addColorStop(0.5,'#0c0c0c');
    pg.addColorStop(1,'#000000');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(pc.x,pc.y,POCKET_R,0,Math.PI*2); ctx.fill();
    ctx.beginPath();
    ctx.arc(pc.x,pc.y,POCKET_R,0,Math.PI*2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // little heart glint deep in the hole
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '14px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('♥', pc.x, pc.y+1);
  });

  // baselines — both ends, whichever player is up gets a glowing lane + soft color wash
  [ {y: SIZE-PAD-60, active: turn===1}, {y: PAD+60, active: turn===2} ].forEach(bl=>{
    if(bl.active){
      const wash = ctx.createRadialGradient(SIZE/2, bl.y, 6, SIZE/2, bl.y, 110);
      wash.addColorStop(0,'rgba(140,224,150,0.22)');
      wash.addColorStop(1,'rgba(140,224,150,0)');
      ctx.fillStyle = wash;
      ctx.fillRect(PAD, bl.y-70, INNER, 140);
    }
    ctx.strokeStyle = bl.active ? 'rgba(255,225,160,0.95)' : 'rgba(255,225,160,0.35)';
    ctx.lineWidth = bl.active ? 2.6 : 1.8;
    ctx.setLineDash([5,6]);
    ctx.beginPath();
    ctx.moveTo(PAD+30, bl.y); ctx.lineTo(SIZE-PAD-30, bl.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // little inward-pointing arrow at the centre of the active lane
    if(bl.active){
      const dir = bl.y > SIZE/2 ? -1 : 1;
      ctx.fillStyle = 'rgba(255,225,160,0.9)';
      ctx.beginPath();
      ctx.moveTo(SIZE/2, bl.y + dir*14);
      ctx.lineTo(SIZE/2-8, bl.y + dir*2);
      ctx.lineTo(SIZE/2+8, bl.y + dir*2);
      ctx.closePath();
      ctx.fill();
    }
  });
}

function roundRectPath(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function pieceGradientColor(type){
  switch(type){
    case 'pink': return { rim:'#b85c82', base:'#f2a0bf', light:'#ffd9e8', edge:'#e888ad' };
    case 'cream': return { rim:'#c7b48c', base:'#f7ecd6', light:'#fffdf5', edge:'#efe0c2' };
    case 'queen': return { rim:'#7c2530', base:'#c8333f', light:'#ff7d87', edge:'#a52b36' };
  }
}

function drawPiece(p){
  if(!p.alive) return;
  // trail (fading tail)
  p.trail.forEach((t,i)=>{
    const alpha = (i+1)/(p.trail.length+2) * 0.3;
    ctx.beginPath();
    ctx.fillStyle = p.type==='striker'
      ? `rgba(214,69,80,${alpha})`
      : p.type==='pink' ? `rgba(244,166,193,${alpha})`
      : p.type==='cream' ? `rgba(230,214,190,${alpha})`
      : `rgba(214,69,80,${alpha})`;
    ctx.arc(t.x,t.y,p.r*0.62,0,Math.PI*2);
    ctx.fill();
  });

  // grounded drop shadow
  ctx.beginPath();
  ctx.ellipse(p.x+2.5, p.y+6, p.r*0.98, p.r*0.66, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(10,3,9,0.4)';
  ctx.filter = 'blur(1px)';
  ctx.fill();
  ctx.filter = 'none';

  if(p.type === 'striker'){
    drawStrikerDisc(p);
    return;
  }

  const c = pieceGradientColor(p.type);
  // dark outer edge (gives the coin real thickness/depth)
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
  ctx.fillStyle = c.rim;
  ctx.fill();
  // bevel highlight ring just inside the edge
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r*0.93,0,Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = p.r*0.08;
  ctx.stroke();
  // main flat face
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r*0.84,0,Math.PI*2);
  const rg = ctx.createRadialGradient(p.x-p.r*0.28,p.y-p.r*0.32,p.r*0.06, p.x,p.y,p.r*0.9);
  rg.addColorStop(0, c.light);
  rg.addColorStop(0.55, c.base);
  rg.addColorStop(1, c.edge);
  ctx.fillStyle = rg;
  ctx.fill();
  // thin inner ring (carrom-coin groove)
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r*0.6,0,Math.PI*2);
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // gloss highlight streak
  ctx.beginPath();
  ctx.ellipse(p.x-p.r*0.26, p.y-p.r*0.32, p.r*0.36, p.r*0.19, -0.5, 0, Math.PI*2);
  const gloss = ctx.createRadialGradient(p.x-p.r*0.26,p.y-p.r*0.32,0, p.x-p.r*0.26,p.y-p.r*0.32,p.r*0.4);
  gloss.addColorStop(0,'rgba(255,255,255,0.85)');
  gloss.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fill();

  if(p.type === 'queen'){
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 3;
    ctx.font = `${p.r*0.95}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline='middle';
    ctx.fillText('♛', p.x, p.y+1);
    ctx.shadowBlur = 0;
  }
}

function drawStrikerDisc(p){
  const pink = p.color==='pink';
  const rimC = pink ? '#8f2a45' : '#a3906a';
  const baseC = pink ? '#f28fb2' : '#fdf2df';
  const lightC = pink ? '#ffd2e4' : '#ffffff';
  const edgeC = pink ? '#e26f95' : '#eddcb8';

  // outer rim (extra dark + thick — the striker should read as the "big" piece)
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
  ctx.fillStyle = rimC;
  ctx.fill();
  // colorful accent ring (like the reference striker's coloured washer)
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r*0.9,0,Math.PI*2);
  const ring = ctx.createConicGradient ? ctx.createConicGradient(0,p.x,p.y) : null;
  if(ring){
    ring.addColorStop(0,'#e8c170'); ring.addColorStop(.25,'#d64550');
    ring.addColorStop(.5,'#e8a0bf'); ring.addColorStop(.75,'#e8c170'); ring.addColorStop(1,'#d64550');
    ctx.fillStyle = ring;
  } else {
    ctx.fillStyle = '#e8c170';
  }
  ctx.fill();
  // bevel highlight ring
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r*0.8,0,Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = p.r*0.07;
  ctx.stroke();
  // main flat face
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.r*0.7,0,Math.PI*2);
  const rg = ctx.createRadialGradient(p.x-p.r*0.25,p.y-p.r*0.3,p.r*0.06, p.x,p.y,p.r*0.75);
  rg.addColorStop(0, lightC); rg.addColorStop(0.55, baseC); rg.addColorStop(1, edgeC);
  ctx.fillStyle = rg;
  ctx.fill();
  // heart engraving
  drawHeart(p.x, p.y, p.r*0.4, pink ? '#d97ea4' : '#e8b8c8', pink ? '#a5324f' : '#c98fa0');
  // gloss streak
  ctx.beginPath();
  ctx.ellipse(p.x-p.r*0.22, p.y-p.r*0.28, p.r*0.3, p.r*0.16, -0.5, 0, Math.PI*2);
  const gloss = ctx.createRadialGradient(p.x-p.r*0.22,p.y-p.r*0.28,0, p.x-p.r*0.22,p.y-p.r*0.28,p.r*0.35);
  gloss.addColorStop(0,'rgba(255,255,255,0.8)');
  gloss.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fill();
}

function drawHeart(cx,cy,r,fill,dark){
  ctx.save();
  ctx.translate(cx,cy);
  const s = r/16;
  ctx.beginPath();
  ctx.moveTo(0, 5*s);
  ctx.bezierCurveTo(-16*s, -10*s, -6*s, -18*s, 0, -6*s);
  ctx.bezierCurveTo(6*s, -18*s, 16*s, -10*s, 0, 5*s);
  ctx.closePath();
  const rg = ctx.createRadialGradient(-4*s,-6*s,2*s,0,0,16*s);
  rg.addColorStop(0,'#ffffff');
  rg.addColorStop(0.4, fill);
  rg.addColorStop(1, dark);
  ctx.fillStyle = rg;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(214,69,80,0.5)';
  ctx.stroke();
  ctx.restore();
}

function drawAimLine(){
  if(!dragging || !dragCurrent) return;
  const dx = dragCurrent.x - dragStart.x;
  const dy = dragCurrent.y - dragStart.y;
  const dist = Math.min(Math.hypot(dx,dy), MAX_PULL);
  const ang = Math.atan2(dy,dx);
  const ex = striker.x - Math.cos(ang)*dist;
  const ey = striker.y - Math.sin(ang)*dist;

  ctx.save();
  ctx.strokeStyle = 'rgba(232,193,112,0.85)';
  ctx.lineWidth = 3;
  ctx.setLineDash([2,6]);
  ctx.beginPath();
  ctx.moveTo(striker.x, striker.y);
  ctx.lineTo(striker.x + Math.cos(ang)*dist, striker.y + Math.sin(ang)*dist);
  ctx.stroke();
  ctx.setLineDash([]);

  // power arrow forward direction
  const power = dist/MAX_PULL;
  ctx.fillStyle = `rgba(214,69,80,${0.4+power*0.5})`;
  ctx.beginPath();
  const tipx = striker.x - Math.cos(ang)*(dist+18);
  const tipy = striker.y - Math.sin(ang)*(dist+18);
  ctx.arc(tipx,tipy, 5+power*5, 0, Math.PI*2);
  ctx.fill();

  // power ring around the striker itself
  ctx.beginPath();
  ctx.arc(striker.x, striker.y, striker.r+8, -Math.PI/2, -Math.PI/2 + Math.PI*2*power);
  ctx.strokeStyle = power>0.75 ? 'rgba(232,80,80,0.9)' : 'rgba(232,193,112,0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawPocketFlashes(){
  pocketFlashes.forEach(f=>{
    const t = f.age / 18;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10 + t*26, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(232,193,112,${(1-t)*0.8})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    f.age++;
  });
  pocketFlashes = pocketFlashes.filter(f=>f.age < 18);
}

function render(){
  drawBoard();
  pieces.forEach(drawPiece);
  if(striker) drawPiece(striker);
  drawAimLine();
  drawPocketFlashes();
}

function loop(){
  if(animating){
    stepPhysics();
    if(!anyMoving()){
      animating = false;
      finalizeTurn();
    }
  }
  render();
  requestAnimationFrame(loop);
}

/* ---------------- turn resolution ---------------- */
function otherPlayer(t){ return t===1 ? 2 : 1; }

function finalizeTurn(){
  if(gameOver) return;

  // --- FOUL: striker itself went into a pocket ---
  if(strikerFouled){
    strikerFouled = false;
    strokeEvents = [];
    if(queenPending && queenPending.owner === turn){
      respawnQueen();
      queenPending = null;
    }
    const fouledName = turn===1 ? state.p1Name : state.p2Name;
    turn = otherPlayer(turn);
    resetStrikerToBaseline();
    updateTurnUI(`Foul! ${fouledName} pocketed the striker 💔`);
    setTimeout(()=>{ if(!gameOver) updateTurnUI(); }, 1600);
    return;
  }

  const queenThisStroke = strokeEvents.some(e=>e.type==='queen');
  const ownThisStroke = strokeEvents.some(e=> (e.type==='pink'&&turn===1) || (e.type==='cream'&&turn===2));
  const hadPendingBefore = !!(queenPending && queenPending.owner === turn);
  let banner = null;

  // --- score this stroke's own/opponent pieces ---
  strokeEvents.forEach(e=>{
    if(e.type !== 'queen'){
      const owner = e.type === 'pink' ? 1 : 2;
      if(owner === turn) scores[turn] += 1;
      // opponent's piece pocketed: removed, no points
    }
  });

  // --- queen logic ---
  if(queenThisStroke && ownThisStroke){
    // covered in the very same stroke — confirmed instantly
    scores[turn] += 1;
    queenPending = null;
    banner = 'Queen covered! +1 💗';
  } else if(queenThisStroke){
    // queen down, but needs a cover shot next
    queenPending = {owner: turn};
    banner = 'Queen down — cover it next shot!';
  } else if(hadPendingBefore){
    if(ownThisStroke){
      scores[turn] += 1;
      queenPending = null;
      banner = 'Queen covered! +1 💗';
    } else {
      respawnQueen();
      queenPending = null;
      banner = 'Queen not covered — back to center';
    }
  }

  strokeEvents = [];

  const continueTurn = ownThisStroke || queenThisStroke;
  if(!continueTurn){
    turn = otherPlayer(turn);
  }

  resetStrikerToBaseline();
  updateTurnUI(banner);
  if(banner) setTimeout(()=>{ if(!gameOver) updateTurnUI(); }, 1600);
  checkWin();
}

function checkWin(){
  if(scores[1] >= 9 || scores[2] >= 9){
    gameOver = true;
    const winner = scores[1] >= 9 ? 1 : 2;
    showResult(winner);
  }
}

function showResult(winner){
  const overlay = document.getElementById('resultOverlay');
  const icon = document.getElementById('resultIcon');
  const title = document.getElementById('resultTitle');
  const sub = document.getElementById('resultSub');
  const winnerName = winner===1 ? state.p1Name : state.p2Name;
  const otherName = winner===1 ? state.p2Name : state.p1Name;

  // Show a personalized message depending on which "side" you'd be viewing from (P1 perspective)
  if(winner === 1){
    icon.textContent = '🏆';
    title.textContent = `${winnerName} Wins! 💗`;
    sub.textContent = `${winnerName} takes it! ${otherName} is already planning the rematch. 💞`;
  } else {
    icon.textContent = '🤍';
    title.textContent = `${winnerName} Wins! 🤍`;
    sub.textContent = `${winnerName} takes it! ${state.p1Name}, cheer them on — their victory is your victory too. 💘`;
  }
  overlay.classList.remove('hidden');
}

/* ---------------- input: striker slider ---------------- */
const sliderEl = document.getElementById('strikerSlider');
const knobEl = document.getElementById('strikerKnob');

function baselineXRange(){ return {min: PAD+40, max: SIZE-PAD-40}; }

function updateKnobFromStriker(){
  const rect = sliderEl.getBoundingClientRect();
  const {min,max} = baselineXRange();
  const t = (striker.x - min)/(max-min);
  const px = t * rect.width;
  knobEl.style.left = px + 'px';
}

sliderEl.addEventListener('pointerdown', e=>{
  if(animating || dragging) return;
  sliderDragging = true;
  moveSliderTo(e);
});
window.addEventListener('pointermove', e=>{
  if(sliderDragging) moveSliderTo(e);
});
window.addEventListener('pointerup', ()=>{ sliderDragging = false; });

function moveSliderTo(e){
  const rect = sliderEl.getBoundingClientRect();
  let t = (e.clientX - rect.left) / rect.width;
  t = Math.max(0, Math.min(1, t));
  const {min,max} = baselineXRange();
  striker.x = min + t*(max-min);
  striker.y = baselineY();
  knobEl.style.left = (t*rect.width) + 'px';
}

/* ---------------- input: striker drag-to-shoot ---------------- */
function canvasPoint(e){
  const rect = canvas.getBoundingClientRect();
  const scaleX = SIZE/rect.width, scaleY = SIZE/rect.height;
  return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY };
}

canvas.addEventListener('pointerdown', e=>{
  if(animating || gameOver) return;
  const pt = canvasPoint(e);
  const d = Math.hypot(pt.x-striker.x, pt.y-striker.y);
  const nearBaselineLane = Math.abs(pt.y - baselineY()) < 55;
  if(d < striker.r*3.2 || nearBaselineLane){
    // grabbing anywhere near the baseline snaps + slides the striker there too —
    // no need for pixel-perfect precision on the little disc itself.
    const {min,max} = baselineXRange();
    striker.x = Math.max(min, Math.min(max, pt.x));
    striker.y = baselineY();
    updateKnobFromStriker();
    dragging = true;
    dragStart = {x:striker.x, y:striker.y};
    dragCurrent = pt;
  }
});
window.addEventListener('pointermove', e=>{
  if(dragging){
    dragCurrent = canvasPoint(e);
  }
});
window.addEventListener('pointerup', e=>{
  if(dragging){
    dragging = false;
    const dx = dragCurrent.x - dragStart.x;
    const dy = dragCurrent.y - dragStart.y;
    let dist = Math.hypot(dx,dy);
    dist = Math.min(dist, MAX_PULL);
    if(dist > 8){
      const ang = Math.atan2(dy,dx);
      striker.vx = -Math.cos(ang) * dist * POWER_SCALE;
      striker.vy = -Math.sin(ang) * dist * POWER_SCALE;
      animating = true;
      inputLocked = true;
      if(navigator.vibrate) navigator.vibrate(Math.min(30, 8 + dist/8));
    }
    dragCurrent = null;
  }
});

/* keep knob synced on resize */
window.addEventListener('resize', ()=>{ if(striker) updateKnobFromStriker(); });
