// main_obj.js — Separated inputs only (OBJ / MTL / TEXTURES)
import { Mesh, addObject, setMeshTextureFromImage } from './core_patch_append.js';
const log=(...a)=>console.log('[OBJ]',...a);
const dbg=(...a)=>console.log('[OBJ-DBG]',...a);

const basename = s => (s||'').replace(/^.*[\\\/]/,'');
const normName = s => basename(s).trim().replace(/\s+/g,'').toLowerCase();
const stem = s => normName(s).replace(/\.[^.]+$/,'');

function pickTextureToken(arrayLike){
  for(const t of arrayLike){
    if(/\.(png|jpe?g|bmp|tga)$/i.test(t)) return basename(t);
  }
  return null;
}
function parseMTL(text){
  const mats={}; let cur=null;
  for(const raw of text.split(/\r?\n/)){
    const s=raw.trim(); if(!s||s.startsWith('#')) continue;
    const p=s.split(/\s+/); const kw=p[0].toLowerCase();
    if(kw==='newmtl'){ cur=mats[p.slice(1).join(' ')]= {name:p.slice(1).join(' ')}; }
    else if(!cur) continue;
    else if(kw==='kd' && p.length>=4){ cur.Kd=[+p[1],+p[2],+p[3]]; }
    else if(kw==='map_kd'){ cur.map_Kd = pickTextureToken(p.slice(1)); }
    else if(kw==='d'){ cur.d=+p[1]; }
    else if(kw==='tr'){ cur.d=1-(+p[1]); }
  }
  return mats;
}

function parseOBJ(text, objName='obj'){
  const v=[], vt=[], vn=[];
  const idx=[], pos=[], uv=[], nor=[];
  let currentUseMtl = null;

  for(const raw of text.split(/\r?\n/)){
    const s=raw.trim(); if(!s||s.startsWith('#')) continue;
    const p=s.split(/\s+/); const kw=p[0].toLowerCase();
    if(kw==='v' && p.length>=4){ v.push([+p[1],+p[2],+p[3]]); }
    else if(kw==='vt'){ vt.push([+p[1], 1-+p[2]]); }
    else if(kw==='vn'){ vn.push([+p[1],+p[2],+p[3]]); }
    else if(kw==='usemtl'){ currentUseMtl = p.slice(1).join(' '); }
    else if(kw==='f' && p.length>=4){
      const verts=p.slice(1).map(tok=>{
        const t=tok.split('/'); return [parseInt(t[0]), t[1]?parseInt(t[1]):0, t[2]?parseInt(t[2]):0];
      });
      const add=(vi,ti,ni)=>{
        const V=v[vi-1]; pos.push(V[0],V[1],V[2]);
        if(ti>0 && vt[ti-1]){ const T=vt[ti-1]; uv.push(T[0],T[1]); } else { uv.push(0,0); }
        if(ni>0 && vn[ni-1]){ const N=vn[ni-1]; nor.push(N[0],N[1],N[2]); } else { nor.push(0,1,0); }
        return (pos.length/3 - 1);
      };
      const a = add(...verts[0]);
      for(let i=1;i+1<verts.length;i++){
        const b = add(...verts[i]);
        const c = add(...verts[i+1]);
        idx.push(a,b,c);
      }
    }
  }
  const mesh = new Mesh(objName, new Float32Array(pos), new Float32Array(nor), new Float32Array(uv), new Uint32Array(idx));
  mesh._materialName = currentUseMtl; // may be null
  return [mesh];
}

function applyAll(store){
  const matKeys = Object.keys(store.mats||{});
  const firstMat = matKeys.length ? store.mats[matKeys[0]] : null;
  for(const mesh of store.meshes){
    let m = null;
    if(mesh._materialName && store.mats) m = store.mats[mesh._materialName];
    if(!m) m = firstMat;
    if(!m) continue;

    if(m.Kd) mesh.baseColorFactor = m.Kd.slice(0,3);
    if(m.d!=null && m.d<1){ mesh.alphaMode='BLEND'; }

    let wanted = m.map_Kd ? normName(m.map_Kd) : null;
    let file = null;
    if(wanted){
      file = store.images.get(wanted) || store.images.get(stem(wanted));
      if(!file){
        for(const [k,f] of store.images.entries()){
          if(k===wanted || k===stem(wanted) || k.replace(/\.[^.]+$/,'')===stem(wanted)){ file=f; break; }
        }
      }
    }
    if(!file && store.images.size>0){
      file = store.images.values().next().value; // pragmatic fallback
    }
    if(file){
      const img = new Image();
      img.onload = ()=> setMeshTextureFromImage(mesh, img);
      img.src = URL.createObjectURL(file);
      mesh.hasTex = true;
      dbg('貼圖套用 OK →', mesh.name);
    }else{
      dbg('沒有可套用的貼圖（map_Kd 對不到且沒有 fallback）→', mesh.name);
    }
  }
}

const store = { meshes:[], mats:{}, images:new Map() };

function bindSeparated(){
  const inObj = document.getElementById('file_obj');
  const inMtl = document.getElementById('file_mtl');
  const inTex = document.getElementById('files_tex');

  if(inObj && !inObj.__bound){
    inObj.addEventListener('change', async ()=>{
      const f=inObj.files?.[0]; if(!f) return;
      const [mesh] = parseOBJ(await f.text(), f.name.replace(/\.obj$/i,''));
      store.meshes = [mesh];
      addObject(mesh);
      applyAll(store);
      log('OBJ 單檔載入完成', f.name);
    });
    inObj.__bound = true;
  }

  if(inMtl && !inMtl.__bound){
    inMtl.addEventListener('change', async ()=>{
      const f=inMtl.files?.[0]; if(!f) return;
      store.mats = parseMTL(await f.text());
      console.groupCollapsed('[OBJ-DBG] 單檔 MTL'); try{ Object.entries(store.mats||{}).forEach(([k,v])=>console.log(k, v.map_Kd||'(no map_Kd)', v.Kd||'(no Kd)')); }catch{} console.groupEnd();
      applyAll(store);
      log('MTL 單檔載入完成');
    });
    inMtl.__bound = true;
  }

  if(inTex && !inTex.__bound){
    inTex.addEventListener('change', ()=>{
      for(const f of Array.from(inTex.files||[])){
        if(/\.(png|jpe?g|bmp|tga)$/i.test(f.name)){
          const k = normName(f.name);
          store.images.set(k, f);
          store.images.set(stem(k), f);
        }
      }
      applyAll(store);
      log('貼圖檔加入', [...new Set([...store.images.keys()].map(x=>x))].slice(0,8));
    });
    inTex.__bound = true;
  }
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', bindSeparated);
else bindSeparated();

console.log('OBJ 分開載入 (三欄位) ready');
