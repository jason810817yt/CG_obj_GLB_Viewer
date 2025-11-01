// main_path.js
import { addPath, registerPath } from './core.js';

const btn = document.getElementById('btn_load_path');
if(btn) btn.addEventListener('change', e=>{
  const f=e.target.files?.[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=()=>{
    // 支援純 "x y z" 每行；也容忍以逗號分隔
    const lines=String(fr.result).split(/\r?\n/);
    const out=[]; const nors=[]; let hasNor=false;
    for(const ln of lines){
      const t=ln.trim(); if(!t) continue;
      const parts=t.split(/[,\s]+/).map(Number);
      if(parts.length>=3){ out.push(parts[0],parts[1],parts[2]); if(parts.length>=6){ nors.push(parts[3],parts[4],parts[5]); hasNor=true; } }
    }
    if(out.length>=6){ addPath(out); try{ registerPath(new Float32Array(out), hasNor? new Float32Array(nors): null); }catch(e){ console.warn('registerPath failed:', e); } }
  };
  fr.readAsText(f);
});
