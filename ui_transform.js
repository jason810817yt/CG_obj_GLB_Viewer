
// ui_transform.js — Scale & Rotation Matrix controls
import * as Core from './core.js';

function el(id){ return document.getElementById(id); }
function readSelected(){ const sel = el('sel_obj_name'); return sel && sel.value; }

// Scale UI
function readScaleToUI(){
  const name = readSelected(); if(!name) return;
  const s = Core.getScaleFor ? Core.getScaleFor(name) : [1,1,1];
  ['x','y','z'].forEach((k,i)=>{ const e=el('scale_'+k); if(e) e.value = (s[i]??1); });
}
function applyScaleFromUI(){
  const name = readSelected(); if(!name) return;
  const sx = parseFloat(el('scale_x').value||'1');
  const sy = parseFloat(el('scale_y').value||'1');
  const sz = parseFloat(el('scale_z').value||'1');
  Core.setScaleFor && Core.setScaleFor(name, [sx,sy,sz]);
}
function resetScale(){
  const name = readSelected(); if(!name) return;
  Core.setScaleFor && Core.setScaleFor(name, [1,1,1]);
  readScaleToUI();
}

// Rotation Matrix UI
function setMatrixInputs(M){
  const ids = ['m00','m01','m02','m10','m11','m12','m20','m21','m22'];
  ids.forEach((id,i)=>{ const e = el('rot_'+id); if(e) e.value = (M[i]??0); });
}
function getMatrixInputs(){
  const ids = ['m00','m01','m02','m10','m11','m12','m20','m21','m22'];
  return ids.map(id => parseFloat(el('rot_'+id).value||'0'));
}
function readRotMatToUI(){
  const name = readSelected(); if(!name) return;
  const M = Core.getRotMat3For ? Core.getRotMat3For(name) : [1,0,0,0,1,0,0,0,1];
  setMatrixInputs(M);
}
function applyRotMatFromUI(){
  const name = readSelected(); if(!name) return;
  const M = getMatrixInputs();
  Core.setRotMat3For && Core.setRotMat3For(name, M);
}
function resetRotMat(){
  const name = readSelected(); if(!name) return;
  Core.setRotMat3For && Core.setRotMat3For(name, [1,0,0, 0,1,0, 0,0,1]);
  readRotMatToUI();
}

// Bind events once DOM is ready
window.addEventListener('DOMContentLoaded', ()=>{
  ['btn_read_scale','btn_apply_scale','btn_reset_scale',
   'btn_read_rotm','btn_apply_rotm','btn_reset_rotm'].forEach(id=>{
     const e = el(id); if(!e) return;
     if(id==='btn_read_scale') e.addEventListener('click', readScaleToUI);
     if(id==='btn_apply_scale') e.addEventListener('click', applyScaleFromUI);
     if(id==='btn_reset_scale') e.addEventListener('click', resetScale);
     if(id==='btn_read_rotm') e.addEventListener('click', readRotMatToUI);
     if(id==='btn_apply_rotm') e.addEventListener('click', applyRotMatFromUI);
     if(id==='btn_reset_rotm') e.addEventListener('click', resetRotMat);
   });

  // When object selection changes, refresh fields
  const sel = el('sel_obj_name');
  if(sel) sel.addEventListener('change', ()=>{ readScaleToUI(); readRotMatToUI(); });

  // Initialize fields
  readScaleToUI();
  readRotMatToUI();
});
