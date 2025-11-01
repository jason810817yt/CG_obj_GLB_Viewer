
// main_train.js — animate Train1/Train2 along Track.xyz with correct orientation (TBN)
// Adds axis-matching and an optional world-fix quaternion to align with the map.
import { listObjects, setRotMat3For, setPositionFor, samplePathAtDist, getPathTotalLength } from './core.js';

function el(id){ return document.getElementById(id); }
function norm3(a){ const L=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/L,a[1]/L,a[2]/L]; }
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function sub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

// Quaternion helpers (w,x,y,z)
function qNormalize(q){ const L=Math.hypot(q[0],q[1],q[2],q[3])||1; return [q[0]/L,q[1]/L,q[2]/L,q[3]/L]; }
function mat3FromQuat(q){
  const [w,x,y,z] = qNormalize(q);
  return [
    1-2*(y*y+z*z), 2*(x*y+w*z),   2*(x*z-w*y),
    2*(x*y-w*z),   1-2*(x*x+z*z), 2*(y*z+w*x),
    2*(x*z+w*y),   2*(y*z-w*x),   1-2*(x*x+y*y)
  ];
}
function mulMat3Vec3(m,v){ return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]]; }

let running = true;
let s = 0;         // arc-length for Train1
let params = { speed: 50.0, laneWidth: 2.0, laneSign: +1, height: 0.2, spacing: 0 };
let names = { t1: null, t2: null };
let axes = {
  t1: { forward: '+X', up: '+Z' },
  t2: { forward: '+X', up: '+Z' },
};
let worldFixQ = [1,0,0,0]; // if your path/map needs a pre-rotation like [1,1,0,0], set here or via UI (it will be normalized)

const AXES = ['+X','-X','+Y','-Y','+Z','-Z'];

function populateSelects(){
  const opts = listObjects() || [];
  const sel1 = el('train1_name');
  const sel2 = el('train2_name');
  if(!sel1 || !sel2) return;
  const keepValue1 = sel1.value, keepValue2 = sel2.value;
  sel1.innerHTML = ''; sel2.innerHTML = '';
  // Add a blank option
  const blank = new Option('(未指定)','');
  sel1.appendChild(blank.cloneNode(true)); sel2.appendChild(blank.cloneNode(true));
  for(const n of opts){
    sel1.appendChild(new Option(n,n));
    sel2.appendChild(new Option(n,n));
  }
  // restore if present
  if(keepValue1) sel1.value = keepValue1;
  if(keepValue2) sel2.value = keepValue2;
  // axis dropdowns
  for(const id of ['t1_forward','t1_up','t2_forward','t2_up']){
    const s=el(id); if(!s || s.options.length>0) continue;
    for(const a of AXES) s.appendChild(new Option(a,a));
  }
  el('t1_forward').value = axes.t1.forward;
  el('t1_up').value = axes.t1.up;
  el('t2_forward').value = axes.t2.forward;
  el('t2_up').value = axes.t2.up;
}

function readUI(){
  const sp = parseFloat(el('train_speed')?.value||params.speed);
  const lw = parseFloat(el('lane_width')?.value||params.laneWidth);
  const h  = parseFloat(el('lane_height')?.value||params.height);
  const d  = parseFloat(el('car_spacing')?.value||params.spacing);
  const lane = el('lane_right')?.checked ? +1 : -1;
  params = { speed: sp, laneWidth: lw, laneSign: lane, height: h, spacing: d };
  names.t1 = el('train1_name')?.value || names.t1;
  names.t2 = el('train2_name')?.value || names.t2;
  axes.t1.forward = el('t1_forward')?.value || axes.t1.forward;
  axes.t1.up      = el('t1_up')?.value || axes.t1.up;
  axes.t2.forward = el('t2_forward')?.value || axes.t2.forward;
  axes.t2.up      = el('t2_up')?.value || axes.t2.up;
  // world fix quaternion
  const qtxt = (el('world_fix_q')?.value||'').trim();
  if(qtxt){
    const parts = qtxt.split(/[,\s]+/).map(parseFloat).filter(x=>Number.isFinite(x));
    if(parts.length===4) worldFixQ = qNormalize(parts);
  }
}

function axisToVec(axis, T, N, B){
  switch(axis){
    case '+X': return [1,0,0]; // placeholder; we'll map later
    case '-X': return [-1,0,0];
    case '+Y': return [0,1,0];
    case '-Y': return [0,-1,0];
    case '+Z': return [0,0,1];
    case '-Z': return [0,0,-1];
  }
  return [0,0,1];
}

// Build rotation matrix columns [Xw,Yw,Zw] for a model whose local (forward,up) axes are specified.
// We want "forward -> T", "up -> N", remaining axis by right-handed cross.
function matFromTBNAndModelAxes(T, N, forwardAxis, upAxis){
  // Orthogonalize N against T to kill drifting
  N = norm3( sub(N, [T[0]*dot(N,T), T[1]*dot(N,T), T[2]*dot(N,T)]) );
  const B = norm3( cross(T,N) );
  // Step1: world vectors for desired forward/up
  const signF = forwardAxis[0]==='-' ? -1 : +1;
  const signU = upAxis[0]==='-' ? -1 : +1;
  const axF = forwardAxis[1]; // 'X' | 'Y' | 'Z'
  const axU = upAxis[1];
  const wForward = [ T[0]*signF, T[1]*signF, T[2]*signF ];
  const wUp      = [ N[0]*signU, N[1]*signU, N[2]*signU ];
  // Step2: place into columns according to which model axis is forward/up
  let X=null, Y=null, Z=null;
  if(axF==='X') X = wForward; else if(axF==='Y') Y = wForward; else Z = wForward;
  if(axU==='X') X = wUp;      else if(axU==='Y') Y = wUp;      else Z = wUp;
  // Step3: fill the remaining column to make right-handed basis
  if(!X && Y && Z) X = norm3( cross(Y,Z) );
  if(!Y && Z && X) Y = norm3( cross(Z,X) );
  if(!Z && X && Y) Z = norm3( cross(X,Y) );
  if(!X||!Y||!Z){ // fallback: default mapping (forward +Z, up +Y)
    X = B; Y = N; Z = T;
  }
  return [ X[0],Y[0],Z[0],  X[1],Y[1],Z[1],  X[2],Y[2],Z[2] ];
}

function step(dt){
  if(!running) return;
  const L = getPathTotalLength(); if(!L) return; // no path yet
  readUI();
  // Auto-pick names if empty
  if(!names.t1 || !names.t2){
    const objs = (listObjects()||[]).filter(n=>!/\.GLB$/.test(n));
    const trains = objs.filter(n=>/train/i.test(n));
    if(trains.length>=2){ names.t1=trains[0]; names.t2=trains[1]; }
    else if(objs.length>=2){ names.t1=objs[0]; names.t2=objs[1]; }
  }
  if(!names.t1) return;

  s = (s + params.speed * dt) % L;
  const samp1 = samplePathAtDist(s); if(!samp1) return;
  const samp2 = samplePathAtDist(s - params.spacing);

  // Optional world-fix rotation (e.g., q=[1,1,0,0] ~= 90° about X)
  const Rfix = mat3FromQuat(worldFixQ);

  function place(name, samp, axCfg){
    if(!name||!samp) return;
    // Apply fix to T/N
    const T = norm3( mulMat3Vec3(Rfix, samp.tan) );
    let N   = norm3( mulMat3Vec3(Rfix, samp.nor) );
    // lane binormal after fix
    let B = norm3(cross(T, N));
    // re-orthogonalize
    N = norm3(cross(B, T));
    // lane offset + height
    const pos = [
      (mulMat3Vec3(Rfix, samp.pos))[0] + params.laneSign * 0.5 * params.laneWidth * B[0] + params.height * N[0],
      (mulMat3Vec3(Rfix, samp.pos))[1] + params.laneSign * 0.5 * params.laneWidth * B[1] + params.height * N[1],
      (mulMat3Vec3(Rfix, samp.pos))[2] + params.laneSign * 0.5 * params.laneWidth * B[2] + params.height * N[2],
    ];
    // Build rotation with axis matching
    const M = matFromTBNAndModelAxes(T, N, axCfg.forward, axCfg.up);
    setRotMat3For(name, M);
    setPositionFor(name, pos);
  }
  place(names.t1, samp1, axes.t1);
  if(names.t2) place(names.t2, samp2, axes.t2);
}

let last = performance.now();
function loop(t){
  const dt = (t - last)/1000; last = t;
  try{ step(dt); }catch(e){ /* keep anim alive */ }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Bind UI
window.addEventListener('DOMContentLoaded', ()=>{
  populateSelects();
  // refresh object options periodically in case user loads models later
  setInterval(populateSelects, 1000);
  const btn = el('btn_train_toggle'); if(btn) btn.addEventListener('click', ()=>{ running = !running; btn.textContent = running? '暫停' : '開始'; });
  const laneL = el('lane_left'), laneR = el('lane_right');
  if(laneL && laneR){ laneR.checked = true; }
});
