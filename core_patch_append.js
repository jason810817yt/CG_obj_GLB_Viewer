// core_patch_append.js — UI wiring built on top of core.js public API
import * as Core from './core.js';

// Re-export for loaders to import through this module
export const Mesh = Core.Mesh;
export function addObject(m){ const r = Core.addObject(m); refreshListSoon(); return r; }
export const setMeshTextureFromImage = Core.setMeshTextureFromImage;
export function registerTopGroup(name){ return Core.addGroup ? Core.addGroup(name) : name; }

function el(id){ return document.getElementById(id); }

/* ====== 物件清單 ====== */
function refreshObjectList(){
  const lst = el('lst_objs'); const sel = el('sel_obj_name');
  if(!lst || !sel) return;
  const names = (Core.listObjects ? Core.listObjects():[]) || [];
  const prev = sel.value;
  lst.innerHTML = ''; sel.innerHTML = '';
  for(const name of names){
    const li = document.createElement('li');
    li.textContent = name; li.dataset.name = name;
    li.addEventListener('dblclick', ()=> Core.focusOn && Core.focusOn(name));
    li.addEventListener('click', ()=>{ sel.value = name; Core.selectObject && Core.selectObject(name); });
    lst.appendChild(li);

    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  }
  if (names.includes(prev)) sel.value = prev;
  else if (names.length) sel.value = names[0];
}
let refreshTimer=null;
function refreshListSoon(){ clearTimeout(refreshTimer); refreshTimer=setTimeout(refreshObjectList, 50); }

/* ====== 四元數應用 ====== */
function bindQuat(){
  const btn = el('btn_apply_q'); const sel = el('sel_obj_name');
  if(btn && !btn.__bound){
    btn.addEventListener('click', ()=>{
      const q=[ parseFloat(el('qw').value||'1'), parseFloat(el('qx').value||'0'),
                parseFloat(el('qy').value||'0'), parseFloat(el('qz').value||'0') ];
      if(q.every(Number.isFinite) && sel && sel.value && Core.setQuatFor){
        Core.setQuatFor(sel.value, q);
      }
    });
    btn.__bound = true;
  }
  if(sel && !sel.__bound){
    sel.addEventListener('change', ()=> Core.selectObject && Core.selectObject(sel.value));
    sel.__bound = true;
  }
}

/* ====== 光源 / 顯示模式 / 速度 ====== */
function bindDisplay(){
  const mode = el('sel_mode');
  const dbl  = el('chk_double');
  const grid = el('chk_grid');
  const axes = el('chk_axes');
  const spd  = el('rng_speed');
  if(mode && !mode.__bound){ mode.addEventListener('change', ()=>Core.setMode && Core.setMode(mode.value)); mode.__bound=true; }
  if(dbl  && !dbl.__bound) { dbl.addEventListener('change', ()=>Core.setDoubleSided && Core.setDoubleSided(dbl.checked)); dbl.__bound=true; }
  if(grid && !grid.__bound){ grid.addEventListener('change',()=>Core.setShowGrid && Core.setShowGrid(grid.checked)); grid.__bound=true; }
  if(axes && !axes.__bound){ axes.addEventListener('change',()=>Core.setShowAxes && Core.setShowAxes(axes.checked)); axes.__bound=true; }
  if(spd  && !spd.__bound) { spd.addEventListener('input', ()=>Core.setFlightSpeed && Core.setFlightSpeed(spd.value)); spd.__bound=true; }
  // 光源
  const az = el('light_az'), elv = el('light_el'), I = el('light_i'), A = el('light_a');
  const emit=()=> Core.setLight && Core.setLight({ azimuth:+az.value, elevation:+elv.value, intensity:+I.value, ambient:+A.value });
  for (const ctrl of [az,elv,I,A]) if (ctrl && !ctrl.__bound){ ctrl.addEventListener('input', emit); ctrl.__bound=true; }
}

/* ====== 相機 HUD ====== */
function startCameraHUD(){
  const pos = el('cam_pos'); const ctr = el('cam_ctr');
  if(!pos || !ctr || !Core.getCameraInfo) return;
  const tick=()=>{
    try{
      const {eye,ctr:target} = Core.getCameraInfo();
      pos.textContent = `${eye[0].toFixed(1)}, ${eye[1].toFixed(1)}, ${eye[2].toFixed(1)}`;
      ctr.textContent = `${target[0].toFixed(1)}, ${target[1].toFixed(1)}, ${target[2].toFixed(1)}`;
    }catch{ /* ignore */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ====== 啟動 ====== */
function bindAll(){
  bindVisDel();
  refreshObjectList();
  bindQuat();
  bindDisplay();
  startCameraHUD();
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', bindAll); else bindAll();

// 每 300ms 抽樣更新物件清單（處理載入後才出現的物件）
setInterval(refreshObjectList, 300);

function bindVisDel(){
  const sel = el('sel_obj_name');
  const btnV = el('btn_toggle_vis');
  const btnD = el('btn_delete_obj');
  if(btnV && !btnV.__bound){
    btnV.addEventListener('click', ()=>{
      const name = sel?.value; if(!name) return;
      const cur = (Core.__getByName? Core.__getByName(name): null);
      const next = !(cur && cur.visible===true);
      if(Core.setVisibility) Core.setVisibility(name, next);
      setTimeout(()=>{ try{ sel.value=name; }catch{}; }, 0);
    });
    btnV.__bound=true;
  }
  if(btnD && !btnD.__bound){
    btnD.addEventListener('click', ()=>{
      const name = sel?.value; if(!name) return;
      if(confirm('確定要軟刪除 '+name+' ?')){ if(Core.softDelete) Core.softDelete(name); }
    });
    btnD.__bound=true;
  }
}
