// main_glb.js — GLB 解析：修正 normalized/stride、取消 flipY
import { Mesh, addObject, setMeshTextureFromImage, registerTopGroup } from './core_patch_append.js';
const log=(...a)=>console.log('[GLB]',...a);

function textFrom(ab){ return new TextDecoder('utf-8').decode(ab); }

async function parseGLB(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.getUint32(0,true)!==0x46546C67) throw new Error('Not a GLB');
  let off=12, json=null, bin=null;
  while(off < arrayBuffer.byteLength){
    const len = dv.getUint32(off,true); off+=4;
    const typ = dv.getUint32(off,true); off+=4;
    const view = new Uint8Array(arrayBuffer, off, len); off+=len;
    if(typ===0x4E4F534A){ json = JSON.parse(textFrom(view)); }
    else if(typ===0x004E4942){ bin = new Uint8Array(arrayBuffer, off-len, len); }
  }
  if(!json||!bin) throw new Error('GLB chunks missing');

  const bufferViews = json.bufferViews||[];
  const accessors   = json.accessors||[];
  const images      = json.images||[];
  const textures    = json.textures||[];
  const materials   = json.materials||[];
  const meshes      = json.meshes||[];
  const nodes       = json.nodes||[];
  const scenes      = json.scenes||[];
  const sceneIndex  = json.scene ?? 0;
  const scene       = scenes[sceneIndex] || { nodes: [] };

  const NUM_COMP={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
  const BYTES={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}; // i8,u8,i16,u16,u32,f32
  const getBV = (i)=>bufferViews[i];

  // 讀 accessor → Float32Array（處理 normalized 與 byteStride）
  function readAsFloat(aidx){
    if(aidx==null) return null;
    const acc = accessors[aidx];
    const bv  = getBV(acc.bufferView);
    const num = NUM_COMP[acc.type];
    const ctp = acc.componentType;
    const bpe = BYTES[ctp];
    const stride = (bv.byteStride && bv.byteStride!==num*bpe) ? bv.byteStride : (num*bpe);
    const count = acc.count;
    const baseOffset = (bv.byteOffset||0) + (acc.byteOffset||0);

    const out = new Float32Array(count * num);
    const dv  = new DataView(bin.buffer, bin.byteOffset + baseOffset, stride*count);

    const isFloat = (ctp===5126);
    const norm = !!acc.normalized;

    const readOne = (byteOff)=>{
      switch(ctp){
        case 5126: return dv.getFloat32(byteOff, true);
        case 5125: return dv.getUint32(byteOff, true);
        case 5123: return dv.getUint16(byteOff, true);
        case 5121: return dv.getUint8 (byteOff);
        case 5122: return dv.getInt16 (byteOff, true);
        case 5120: return dv.getInt8  (byteOff);
        default: return 0;
      }
    };

    for(let i=0;i<count;i++){
      const row = i*stride;
      for(let k=0;k<num;k++){
        const val = readOne(row + k*bpe);
        let f = isFloat ? val : val*1.0;
        if(!isFloat && norm){
          // normalized integer → [-1,1] 或 [0,1]
          if(ctp===5121) f = val/255.0;          // UBYTE
          else if(ctp===5123) f = val/65535.0;   // USHORT
          else if(ctp===5125) f = val/4294967295.0; // UINT（少見）
          else if(ctp===5120) f = Math.max(-1, val/127.0);   // BYTE
          else if(ctp===5122) f = Math.max(-1, val/32767.0); // SHORT
        }
        out[i*num+k] = f;
      }
    }
    return out;
  }

  // indices 保留原型別（讓 16/32 位索引能被 GPU 用）
  function readIndices(aidx){
    if(aidx==null) return null;
    const acc = accessors[aidx];
    const bv  = getBV(acc.bufferView);
    const start = bin.byteOffset + (bv.byteOffset||0) + (acc.byteOffset||0);
    const len   = acc.count;
    switch(acc.componentType){
      case 5125: return new Uint32Array(bin.buffer, start, len);
      case 5123: return new Uint16Array(bin.buffer, start, len);
      case 5121: return new Uint8Array (bin.buffer, start, len);
      default:   return null;
    }
  }

  async function getImage(imgIndex){
    const img = images[imgIndex];
    if(img?.uri){
      const im=new Image(); im.src=img.uri;
      await im.decode().catch(()=>new Promise(r=>im.onload=r)); return im;
    }else if(img?.bufferView!=null){
      const bv=getBV(img.bufferView);
      const slice=new Uint8Array(bin.buffer, bin.byteOffset+(bv.byteOffset||0), bv.byteLength);
      const blob=new Blob([slice],{type:img.mimeType||'image/png'});
      const url=URL.createObjectURL(blob);
      const im=new Image(); im.src=url;
      await im.decode().catch(()=>new Promise(r=>im.onload=r)); return im;
    }
    return null;
  }

  const groupName = registerTopGroup((json.asset?.generator||'Scene')+'.GLB');

  function applyMaterialAndTex(mesh, prim){
    const mi = prim.material;
    if(mi==null) return;
    const mat = materials[mi]||{};
    const pbr = mat.pbrMetallicRoughness||{};

    // baseColorFactor（RGB + Alpha）
    if(Array.isArray(pbr.baseColorFactor)){
      mesh.baseColorFactor = pbr.baseColorFactor.slice(0,3);
      mesh.baseAlpha = (pbr.baseColorFactor[3]!=null) ? pbr.baseColorFactor[3] : 1.0;
    }

    // baseColorTexture（不翻 Y）
    const texInfo = pbr.baseColorTexture;
    if(texInfo?.index!=null){
      const tex = textures[texInfo.index];
      if(tex?.source!=null){
        getImage(tex.source).then(img=>{
          if(img) setMeshTextureFromImage(mesh, img, /*flipY=*/false);
        });
        mesh.hasTex = true;
      }
      // KHR_texture_transform（簡化版：scale/offset；rotation先略）
      const tt = texInfo.extensions?.KHR_texture_transform;
      if(tt && mesh.uv){
        const sx = (tt.scale?.[0] ?? 1), sy=(tt.scale?.[1] ?? 1);
        const ox = (tt.offset?.[0]?? 0), oy=(tt.offset?.[1]?? 0);
        for(let i=0;i<mesh.uv.length;i+=2){
          const u=mesh.uv[i], v=mesh.uv[i+1];
          mesh.uv[i]   = u*sx + ox;
          mesh.uv[i+1] = v*sy + oy;
        }
      }
    }

    // 透明模式
    if(mat.alphaMode){ mesh.alphaMode = mat.alphaMode; }
    if(mat.alphaMode==='MASK' && mat.alphaCutoff!=null) mesh.alphaCutoff = mat.alphaCutoff;

    // Unlit
    if(mat.extensions && mat.extensions.KHR_materials_unlit) mesh.unlit = true;
  }

  function addPrimitive(prim, name, nodeTRS){
    // 幾何：全部轉成 Float32，正確處理 normalized 與 stride
    const pos = readAsFloat(prim.attributes.POSITION);
    const nor = readAsFloat(prim.attributes.NORMAL);
    const uv0 = readAsFloat(prim.attributes.TEXCOORD_0);
    const col = readAsFloat(prim.attributes.COLOR_0);
    const idx = readIndices(prim.indices);

    const mesh = new Mesh(name, pos, nor, uv0, idx);

    // 頂點顏色：VEC3/4 → 只取 RGB
    if(col){
      const k = (col.length === (pos.length/3)*4) ? 4 : 3;
      const out = new Float32Array((col.length/k)*3);
      for(let i=0,j=0;i<col.length;i+=k, j+=3){
        out[j+0]=col[i+0]; out[j+1]=col[i+1]; out[j+2]=col[i+2];
      }
      mesh.vertexColor = out;
    }

    // 套 Node 的 T/R/S（glTF quaternion 為 [x,y,z,w]）
    if(nodeTRS){
      if(nodeTRS.t) mesh.modelT = nodeTRS.t.slice(0,3);
      if(nodeTRS.s) mesh.modelS = nodeTRS.s.slice(0,3);
      if(nodeTRS.q){ const [x,y,z,w]=nodeTRS.q; mesh.modelQ = [w,x,y,z]; }
    }

    mesh.parentName = groupName;
    applyMaterialAndTex(mesh, prim);
    addObject(mesh);
  }

  function trav(nidx){
    const node = nodes[nidx]||{};
    const mname = node.name || ('node_'+nidx);
    const trs = {
      t: node.translation,
      s: node.scale,
      q: node.rotation
    };
    if(node.mesh!=null){
      (meshes[node.mesh]?.primitives||[]).forEach((p,pi)=> addPrimitive(p, `${mname}_p${pi}`, trs));
    }
    (node.children||[]).forEach(trav);
  }
  (scene.nodes||[]).forEach(trav);

  return groupName;
}

function bind(){
  const inp = document.getElementById('file_glb');
  if (!inp){ setTimeout(bind, 100); return; }
  if (!inp.__bound){
    inp.addEventListener('change', async ()=>{
      const f = inp.files?.[0]; if(!f) return;
      try{
        log('即選即載 ->', f.name);
        const ab = await f.arrayBuffer();
        const group = await parseGLB(ab);
        log('載入完成', group);
      }catch(err){
        console.error(err); alert('GLB 解析失敗：'+err.message);
      }
    });
    inp.__bound = true;
  }
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', bind); else bind();

console.log('GLB ready (normalized/stride + no-flipY)');
