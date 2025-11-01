let state = { gl: null, canvas: null, pathData: null };

export function ensureGL(){
  if(state.gl) return state.gl;
  const c = state.canvas || document.getElementById('glcanvas');
  if(c){
    const ctx = c.getContext('webgl') || c.getContext('experimental-webgl');
    if(ctx){ state.gl = ctx; state.canvas = c; }
  }
  return state.gl;
}
const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl");
if(!gl){ alert("WebGL not supported"); throw new Error("no webgl"); }
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.05,0.07,0.10,1);

function mat4Identity(){return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];}
function mat4Mul(a,b){const o=new Array(16);for(let r=0;r<4;r++)for(let c=0;c<4;c++)o[r*4+c]=a[r*4+0]*b[0*4+c]+a[r*4+1]*b[1*4+c]+a[r*4+2]*b[2*4+c]+a[r*4+3]*b[3*4+c];return o;}
function mat4Perspective(fov,asp,n,f){const t=1/Math.tan(fov/2), nf=1/(n-f);return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,(2*f*n)*nf,0];}
function vec3(a=0,b=0,c=0){return [a,b,c];}
function vAdd(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function vSub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function vMul(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
function vDot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function vCross(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];}
function vLen(a){return Math.hypot(a[0],a[1],a[2]);}
function vNorm(a){const l=vLen(a)||1;return [a[0]/l,a[1]/l,a[2]/l];}
function lookAt(eye,ctr,up){
  const z=vNorm(vSub(eye,ctr)), x=vNorm(vCross(up,z)), y=vCross(z,x);
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -vDot(x,eye),-vDot(y,eye),-vDot(z,eye),1];
}
function quatMul(A,B){ const[w1,x1,y1,z1]=A,[w2,x2,y2,z2]=B;
  return [w1*w2-x1*x2-y1*y2-z1*z2,
          w1*x2+x1*w2+y1*z2-z1*y2,
          w1*y2-x1*z2+y1*w2+z1*x2,
          w1*z2+x1*y2-y1*x2+z1*w2];
}
function quatFromAxisAngle(ax,ang){const s=Math.sin(ang/2), c=Math.cos(ang/2);return [c, ax[0]*s, ax[1]*s, ax[2]*s];}
function normalizeQ(q){ const L=Math.hypot(q[0],q[1],q[2],q[3])||1; return [q[0]/L,q[1]/L,q[2]/L,q[3]/L]; }
function mat4FromTRS(t,q,s){
  const L=Math.hypot(q[0],q[1],q[2],q[3])||1;
  const w=q[0]/L, x=q[1]/L, y=q[2]/L, z=q[3]/L;
  const sx=s[0], sy=s[1], sz=s[2];
  const xx=x*x, yy=y*y, zz=z*z, xy=x*y, xz=x*z, yz=y*z, wx=w*x, wy=w*y, wz=w*z;
  const m=[1-2*(yy+zz), 2*(xy+wz),   2*(xz-wy),   0,
           2*(xy-wz),   1-2*(xx+zz), 2*(yz+wx),   0,
           2*(xz+wy),   2*(yz-wx),   1-2*(xx+yy), 0,
           t[0],        t[1],        t[2],        1];
  m[0]*=sx; m[1]*=sx; m[2]*=sx;
  m[4]*=sy; m[5]*=sy; m[6]*=sy;
  m[8]*=sz; m[9]*=sz; m[10]*=sz;
  return m;
}
function mat3FromMat4(m){return [m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]];}

/* ======================= Shader ======================= */
const VS=`
attribute vec3 a_pos; attribute vec3 a_nor; attribute vec2 a_uv; attribute vec3 a_col;
uniform mat4 u_M,u_V,u_P; uniform mat3 u_N;
varying vec3 v_nor; varying vec3 v_pos; varying vec2 v_uv; varying vec3 v_col;
void main(){ vec4 wp=u_M*vec4(a_pos,1.0); v_pos=wp.xyz; v_nor=normalize(u_N*a_nor); v_uv=a_uv; v_col=a_col; gl_Position=u_P*u_V*wp; }`;
const FS=`
precision mediump float;
uniform vec3 u_cam; uniform vec3 u_lightDir;
uniform vec3 u_fallbackColor, u_col;
uniform bool u_unlit, u_hasTex, u_hasVCol;
uniform float u_lightI, u_ambient;
uniform sampler2D u_sampler;
uniform int u_alphaMode; // 0=OPAQUE,1=MASK,2=BLEND
uniform float u_alphaCutoff;
uniform float u_colA; // baseColorFactor 的 alpha
varying vec3 v_nor; varying vec3 v_pos; varying vec2 v_uv; varying vec3 v_col;
vec3 srgb2lin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 lin2srgb(vec3 c){ return pow(max(c, vec3(0.0)), vec3(1.0/2.2)); }
void main(){
  vec3 base = (length(u_col)>0.001)?u_col:u_fallbackColor;
  float alpha = u_colA;
  if(u_hasTex){ vec4 s = texture2D(u_sampler, v_uv); base *= srgb2lin(s.rgb); alpha *= s.a; }
  if(u_hasVCol){ base *= v_col; }
  if(u_alphaMode==1){ if(alpha < u_alphaCutoff) discard; alpha = 1.0; }
  if(u_unlit){ gl_FragColor=vec4(lin2srgb(base), alpha); return; }
  vec3 N=normalize(v_nor), L=normalize(-u_lightDir), V=normalize(u_cam-v_pos), H=normalize(L+V);
  float diff=max(dot(N,L),0.0);
  float spec=pow(max(dot(N,H),0.0),32.0);
  vec3 col = base*(u_ambient + u_lightI*diff) + u_lightI*0.25*spec;
  gl_FragColor=vec4(lin2srgb(col), alpha);
}`;

function compile(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
const PROG=gl.createProgram();
gl.attachShader(PROG,compile(gl.VERTEX_SHADER,VS));
gl.attachShader(PROG,compile(gl.FRAGMENT_SHADER,FS));
gl.bindAttribLocation(PROG,0,"a_pos"); gl.bindAttribLocation(PROG,1,"a_nor"); gl.bindAttribLocation(PROG,2,"a_uv");
gl.linkProgram(PROG); if(!gl.getProgramParameter(PROG,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(PROG));

/* ======================= 狀態 ======================= */
Object.assign(state, {
  eye:[0,120,600], ctr:[0,0,0], up:[0,1,0], fov:60*Math.PI/180,
  mode:"mixed", doubleSided:true, showGrid:true, showAxes:true,
  flightSpeed:2.0, paths:[], meshes:[], name2idx:{},
  mouse:{down:false,btn:0,lastX:0,lastY:0}, flying:false, alt:false,
  selected:-1,
  light:{ azimuth:45, elevation:35, intensity:1.0, ambient:0.08 },
});

function resize(){
  const dpr=window.devicePixelRatio||1;
  canvas.width=canvas.clientWidth*dpr; canvas.height=canvas.clientHeight*dpr;
  gl.viewport(0,0,canvas.width,canvas.height);
}
window.addEventListener("resize",resize); resize();

/* ======================= 輔助幾何 ======================= */
function makeGrid(n=40, step=50){ const v=[]; const s=n*step*0.5;
  for(let i=-n;i<=n;i++){ v.push(-s,0,i*step, s,0,i*step); v.push(i*step,0,-s, i*step,0,s); }
  return new Float32Array(v);
}
function makeAxes(){ const L=1000; return new Float32Array([ 0,0,0, L,0,0, 0,0,0, 0,L,0, 0,0,0, 0,0,L ]); }
const GRID={vbo:gl.createBuffer(), count:(40*2+1)*4}; gl.bindBuffer(gl.ARRAY_BUFFER, GRID.vbo); gl.bufferData(gl.ARRAY_BUFFER, makeGrid(), gl.STATIC_DRAW);
const AXES={vbo:gl.createBuffer(), count:6}; gl.bindBuffer(gl.ARRAY_BUFFER, AXES.vbo); gl.bufferData(gl.ARRAY_BUFFER, makeAxes(), gl.STATIC_DRAW);

function makeCircle(segments=96){ const v=[]; for(let i=0;i<segments;i++){const a=i/segments*2*Math.PI, b=(i+1)/segments*2*Math.PI; v.push(Math.cos(a),Math.sin(a),0, Math.cos(b),Math.sin(b),0);} return new Float32Array(v); }
const RING = { vbo:gl.createBuffer(), count:96*2 };
gl.bindBuffer(gl.ARRAY_BUFFER, RING.vbo);
gl.bufferData(gl.ARRAY_BUFFER, makeCircle(), gl.STATIC_DRAW);

/* ======================= Mesh 類（含群組/貼圖） ======================= */
export class Mesh{
  constructor(name,pos,nor,uv,idx){
    this.name=name||`mesh_${state.meshes.length}`;
    this.pos=pos?new Float32Array(pos):null;
    this.nor=nor?new Float32Array(nor):null;
    this.uv =uv ?new Float32Array(uv ):null;
    this.idx=idx?((idx.constructor===Uint16Array||idx.constructor===Uint32Array)?idx:new Uint32Array(idx)):null;
    this.modelT=vec3(0,0,0);
    this.modelQ=[1,0,0,0];
    this.modelS=[1,1,1];
    this.color=[0.8,0.85,0.95];
    this.baseColorFactor=[1,1,1]; // GLB PBR 顏色因子
    this.alphaMode='OPAQUE';
    this.alphaCutoff=0.5;
    this.hasTex=false; this.unlit=false;
    this._tex=null; // WebGLTexture
    this._gpu=null; this._bbox=null; this._radius=1;

    this.isGroup=false; this._children=[]; this.hidden=false; this.visible=true; this.deleted=false; this._logOnce=false;
  }
}



function computeBounds(mesh){
  const p=mesh.pos; if(!p||p.length<3){ mesh._bbox=[[0,0,0],[0,0,0]]; mesh._radius=1; return; }
  const mn=[+Infinity,+Infinity,+Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<p.length;i+=3){ const x=p[i],y=p[i+1],z=p[i+2]; if(x<mn[0])mn[0]=x; if(y<mn[1])mn[1]=y; if(z<mn[2])mn[2]=z; if(x>mx[0])mx[0]=x; if(y>mx[1])mx[1]=y; if(z>mx[2])mx[2]=z; }
  mesh._bbox=[mn,mx]; mesh._radius = 0.5*vLen(vSub(mx,mn));
}
function buildGPU(mesh){
  if(mesh._gpu||!mesh.pos) return;
  const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
  let nbo=null,tbo=null,cbo=null,ibo=null,type=gl.UNSIGNED_SHORT,count=0;
  if(mesh.nor){ nbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,nbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.nor, gl.STATIC_DRAW); }
  if(mesh.uv ){ tbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,tbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.uv , gl.STATIC_DRAW); }
  if(mesh.vertexColor){ cbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,cbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertexColor , gl.STATIC_DRAW); }
  if(mesh.idx){
    ibo=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);
    const need32=(mesh.pos.length/3)>65535;
    const arr=need32?new Uint32Array(mesh.idx):new Uint16Array(mesh.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    type=need32?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT; count=arr.length;
    if(need32&&!gl.getExtension('OES_element_index_uint')) console.warn('OES_element_index_uint not supported.');
  }else count=mesh.pos.length/3;
  mesh._gpu={vbo,nbo,tbo,cbo,ibo,type,count};
  if(!mesh._bbox) computeBounds(mesh);
}

/* ====== 紋理工具 ====== */


export function createTextureFromImage(img, flipY = true) {
  console.log('[TEX] upload', img.width + 'x' + img.height, 'flipY=', flipY);
  const gl = ensureGL();
  if (!gl) { console.warn('[TEX] GL not ready'); return null; }

  const tex = gl.createTexture();
  if (!tex) { console.warn('[TEX] gl.createTexture() failed'); return null; }

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

  const isPOT = (n) => n > 0 && (n & (n - 1)) === 0;
  const pot = isPOT(img.width) && isPOT(img.height);

  if (pot) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  } else {
    // NPOT textures: no mipmap, clamp-to-edge, linear sampling
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  return tex;
}

export function setMeshTextureFromImage(mesh,img,flipY=true){
  console.log('[TEX] setMeshTextureFromImage', mesh?.name, img?.width+'x'+img?.height, 'flipY=', flipY);
  mesh._tex = createTextureFromImage(img, flipY);
  mesh.hasTex = true;

}


export function setVisibility(name,on){ const i=state.name2idx[name]; if(i==null) return; state.meshes[i].visible=!!on; }
export function softDelete(name){ const i=state.name2idx[name]; if(i==null) return; state.meshes[i].deleted=true; }
/* ====== 物件/群組 API ====== */
export function addObject(m){
  const mesh = (m instanceof Mesh) ? m : new Mesh(m.name,m.pos,m.nor,m.uv,m.idx);
  if(m.modelT) mesh.modelT=m.modelT.slice?m.modelT.slice():[m.modelT[0],m.modelT[1],m.modelT[2]];
  if(m.modelQ) mesh.modelQ=m.modelQ.slice();
  if(m.modelS) mesh.modelS=Array.isArray(m.modelS)?m.modelS:[m.modelS,m.modelS,m.modelS];
  if(m.color ) mesh.color=m.color.slice(0,3);
  if(m.baseColorFactor) mesh.baseColorFactor = m.baseColorFactor.slice(0,3);
  mesh.hasTex=!!m.hasTex; mesh.unlit=!!m.unlit;

  state.name2idx[mesh.name]=state.meshes.length;
  state.meshes.push(mesh);

  // 掛到群組
  if(m.parentName && state.name2idx[m.parentName]!=null){
    const p = state.meshes[state.name2idx[m.parentName]];
    p._children.push(state.meshes.length-1);
    mesh.hidden = true; // UI 不列出
  }

  // 自動選取剛加入的物件/群組
  selectByIndex(state.meshes.length-1);
  return mesh.name;
}
export function addGroup(name){
  const g=new Mesh(name,null,null,null,null);
  g.isGroup=true;
  state.name2idx[name]=state.meshes.length;
  state.meshes.push(g);
  return name;
}

export function addPath(points){
  const arr=(points instanceof Float32Array)?points:new Float32Array(points);
  const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  state.paths.push({vbo,count:arr.length/3,color:[1,1,0]});
}

export function setMode(m){ state.mode=m; }
export function setDoubleSided(f){ state.doubleSided=!!f; }
export function setShowGrid(f){ state.showGrid=!!f; }
export function setShowAxes(f){ state.showAxes=!!f; }
export function setFlightSpeed(v){ state.flightSpeed=Math.max(0.1,Number(v)||2); }

export function setQuatFor(name,q){
  const i=state.name2idx[name]; if(i==null) return;
  const m=state.meshes[i];
  if(m.isGroup){
    for(const ci of m._children){ const c=state.meshes[ci]; c.modelQ=[q[0],q[1],q[2],q[3]]; }
  }else{
    m.modelQ=[q[0],q[1],q[2],q[3]];
  }
}
export function focusOn(name){
  const i=state.name2idx[name]; if(i==null) return; focusIndex(i);
}

/* ======================= 選取/導航 ======================= */
function selectByName(name){ const i=state.name2idx[name]; if(i==null) return; selectByIndex(i); }
function selectByIndex(i){ state.selected=i; }
function focusIndex(i){
  const m=state.meshes[i]; if(!m) return;
  // 若是群組，取所有子物件的綜合 Bounding
  let ctr=[0,0,0], R=100, cnt=0;
  if(m.isGroup && m._children.length){
    let mn=[+Infinity,+Infinity,+Infinity], mx=[-Infinity,-Infinity,-Infinity];
    for(const ci of m._children){
      const c=state.meshes[ci]; if(!c) continue;
      buildGPU(c); computeBounds(c);
      const M=mat4FromTRS(c.modelT,c.modelQ,c.modelS);
      const bb=[c._bbox[0].slice(), c._bbox[1].slice()];
      // 只估略中心與半徑就好
      const center=[
        (bb[0][0]+bb[1][0])*0.5 + M[12],
        (bb[0][1]+bb[1][1])*0.5 + M[13],
        (bb[0][2]+bb[1][2])*0.5 + M[14],
      ];
      ctr=vAdd(ctr,center); cnt++;
      R=Math.max(R, c._radius);
    }
    if(cnt>0) ctr=vMul(ctr,1/cnt);
  }else{
    const M=mat4FromTRS(m.modelT,m.modelQ,m.modelS);
    ctr=[M[12],M[13],M[14]]; R=Math.max(100, m._radius*2.2);
  }
  const dir=vNorm(vSub(state.eye,state.ctr));
  state.ctr=ctr.slice(); state.eye=vAdd(ctr, vMul(dir, R));
}

/* ======================= 控制（略，同你原本） ======================= */
let keys={};
canvas.addEventListener("mousedown",e=>{state.mouse.down=true;state.mouse.btn=e.button;state.mouse.lastX=e.clientX;state.mouse.lastY=e.clientY;});
window.addEventListener("mouseup",()=>state.mouse.down=false);
window.addEventListener("keydown",e=>{ keys[e.key.toLowerCase()]=true; if(e.key==='Shift') state.flying=true; if(e.key==='Alt') state.alt=true; });
window.addEventListener("keyup",e=>{ delete keys[e.key.toLowerCase()]; if(e.key==='Shift') state.flying=false; if(e.key==='Alt') state.alt=false; });

canvas.addEventListener("mousemove",e=>{
  if(!state.mouse.down) return;
  const dx=e.clientX-state.mouse.lastX, dy=e.clientY-state.mouse.lastY;
  state.mouse.lastX=e.clientX; state.mouse.lastY=e.clientY;
  const btn=state.mouse.btn;

  // Alt+左鍵 → 旋轉選取物件（支援群組）
  if(btn===0 && state.alt && state.selected>=0){
    const m=state.meshes[state.selected];
    const speed=0.005;
    const right = vNorm(vCross(vNorm(vSub(state.ctr,state.eye)), state.up));
    const up = vNorm(state.up);
    const qYaw  = quatFromAxisAngle(up, -dx*speed);
    const qPitch= quatFromAxisAngle(right, -dy*speed);
    const apply=(tar)=>{ tar.modelQ = normalizeQ( quatMul(qYaw, quatMul(qPitch, tar.modelQ)) ); };
    if(m.isGroup){ for(const ci of m._children) apply(state.meshes[ci]); } else apply(m);
    return;
  }

  // 相機
  const sp=0.005;
  if(btn===0){
    const off=vSub(state.eye,state.ctr);
    let yaw=-dx*sp, pitch=-dy*sp;
    const r = Math.hypot(off[0],off[2]);
    const ang = Math.atan2(off[2],off[0])+yaw;
    const dist = Math.hypot(off[0],off[1],off[2]);
    const py = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, Math.asin(off[1]/dist)+pitch));
    const x = Math.cos(py)*Math.cos(ang)*dist, z=Math.cos(py)*Math.sin(ang)*dist, y=Math.sin(py)*dist;
    state.eye=[state.ctr[0]+x, state.ctr[1]+y, state.ctr[2]+z];
  } else if(btn===2){
    const pan=0.5;
    const f=vNorm(vSub(state.ctr,state.eye)); const r=vNorm(vCross(f,state.up)); const u=vNorm(vCross(r,f));
    const d=vAdd(vMul(r,-dx*pan), vMul(u,dy*pan)); state.eye=vAdd(state.eye,d); state.ctr=vAdd(state.ctr,d);
  }
});
canvas.addEventListener("wheel",e=>{ const s=Math.exp(-e.deltaY*0.001); const dir=vSub(state.ctr,state.eye); state.eye=vAdd(state.eye, vMul(dir, 1-1/s)); });

function stepFlight(dt){
  if(!state.flying) return;
  const sp=state.flightSpeed*dt*60;
  const f=vNorm(vSub(state.ctr,state.eye)), r=vNorm(vCross(f,state.up)), u=vNorm(vCross(r,f));
  if(keys['w']){ state.eye=vAdd(state.eye,vMul(f, sp)); state.ctr=vAdd(state.ctr,vMul(f, sp)); }
  if(keys['s']){ state.eye=vAdd(state.eye,vMul(f,-sp)); state.ctr=vAdd(state.ctr,vMul(f,-sp)); }
  if(keys['a']){ state.eye=vAdd(state.eye,vMul(r,-sp)); state.ctr=vAdd(state.ctr,vMul(r,-sp)); }
  if(keys['d']){ state.eye=vAdd(state.eye,vMul(r, sp)); state.ctr=vAdd(state.ctr,vMul(r, sp)); }
  if(keys['q']){ state.eye=vAdd(state.eye,vMul(u,-sp)); state.ctr=vAdd(state.ctr,vMul(u,-sp)); }
  if(keys['e']){ state.eye=vAdd(state.eye,vMul(u, sp)); state.ctr=vAdd(state.ctr,vMul(u, sp)); }
}

/* ======================= 畫圖 ======================= */
function useCommon(P,V){
  const loc=n=>gl.getUniformLocation(PROG,n);
  gl.uniformMatrix4fv(loc('u_P'),false,new Float32Array(P));
  gl.uniformMatrix4fv(loc('u_V'),false,new Float32Array(V));
  const az=state.light.azimuth*Math.PI/180, el=state.light.elevation*Math.PI/180;
  const L=[Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)];
  gl.uniform3fv(loc('u_lightDir'), new Float32Array(L));
  gl.uniform1f(loc('u_lightI'), state.light.intensity);
  gl.uniform1f(loc('u_ambient'), state.light.ambient);
  gl.uniform3fv(loc('u_cam'), new Float32Array(state.eye));
}
function drawLines(vbo,count,color,mode=gl.LINES){
  gl.useProgram(PROG);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(0);
  gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  const loc=n=>gl.getUniformLocation(PROG,n);
  gl.uniformMatrix4fv(loc('u_M'),false,new Float32Array(mat4Identity()));
  gl.uniformMatrix3fv(loc('u_N'),false,new Float32Array([1,0,0,0,1,0,0,0,1]));
  gl.uniform1i(loc('u_unlit'),1); gl.uniform1i(loc('u_hasTex'),0);
  gl.uniform3fv(loc('u_fallbackColor'),new Float32Array(color)); gl.uniform3fv(loc('u_col'),new Float32Array(color));
  gl.drawArrays(mode,0,count);
}
function drawPath(p){
  gl.useProgram(PROG);
  gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(0);
  gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  const loc=n=>gl.getUniformLocation(PROG,n);
  gl.uniformMatrix4fv(loc('u_M'),false,new Float32Array(mat4Identity()));
  gl.uniformMatrix3fv(loc('u_N'),false,new Float32Array([1,0,0,0,1,0,0,0,1]));
  gl.uniform1i(loc('u_unlit'),1); gl.uniform1i(loc('u_hasTex'),0);
  gl.uniform3fv(loc('u_fallbackColor'),new Float32Array(p.color)); gl.uniform3fv(loc('u_col'),new Float32Array(p.color));
  gl.drawArrays(gl.LINE_STRIP,0,p.count);
}
function drawMesh(mesh){ if(mesh && (mesh.deleted||mesh.visible===false)) return; 
  if(mesh.isGroup) return; // 群組本身不畫
  buildGPU(mesh);
  const g=mesh._gpu;
  gl.useProgram(PROG);
  gl.bindBuffer(gl.ARRAY_BUFFER,g.vbo);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(0);
  if(g.nbo){ gl.bindBuffer(gl.ARRAY_BUFFER,g.nbo); gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(1); } else gl.disableVertexAttribArray(1);
  if(g.tbo){ gl.bindBuffer(gl.ARRAY_BUFFER,g.tbo); gl.vertexAttribPointer(2,2,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(2); } else gl.disableVertexAttribArray(2);
  // vertex color (a_col)
  const locCol = gl.getAttribLocation(PROG,'a_col');
  if(g.cbo && locCol>=0){ gl.bindBuffer(gl.ARRAY_BUFFER,g.cbo); gl.vertexAttribPointer(locCol,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(locCol); }
  else if(locCol>=0){ gl.disableVertexAttribArray(locCol); }

  if(g.ibo) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,g.ibo);

  const M=mat4FromTRS(mesh.modelT,mesh.modelQ,mesh.modelS);
  const N=mat3FromMat4(M);
  const loc=n=>gl.getUniformLocation(PROG,n);
  gl.uniformMatrix4fv(loc('u_M'),false,new Float32Array(M));
  gl.uniformMatrix3fv(loc('u_N'),false,new Float32Array(N));
  gl.uniform1i(loc('u_unlit'), mesh.unlit?1:0);

  // 紋理/顏色
  let col = mesh.baseColorFactor || mesh.color;
  gl.uniform3fv(loc('u_fallbackColor'), new Float32Array(col));
  gl.uniform3fv(loc('u_col'), new Float32Array(col));
  gl.uniform1i(loc('u_hasVCol'), (g.cbo?1:0));

  if(mesh._tex){
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mesh._tex);
    gl.uniform1i(loc('u_sampler'), 0);
    gl.uniform1i(loc('u_hasTex'), 1);
  // alpha mode uniforms & blending
  var __am = (mesh.alphaMode||'OPAQUE');
  gl.uniform1i(loc('u_alphaMode'), __am==='MASK'?1:(__am==='BLEND'?2:0));
  gl.uniform1f(loc('u_alphaCutoff'), mesh.alphaCutoff||0.5);

  

  
  if(__am==='BLEND'){ gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);} else { gl.disable(gl.BLEND);}
  }else{
    gl.uniform1i(loc('u_hasTex'), mesh.hasTex?1:0);
  }

  if(state.doubleSided){ gl.disable(gl.CULL_FACE); } else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }

  /* DIAG */ if(!mesh._logOnce){ try{ const uvZero=(mesh.uv?Array.prototype.every.call(mesh.uv,(v)=>v===0):true); console.log('[DRAW]', mesh.name, {hasTex:mesh.hasTex, uv:mesh.uv?mesh.uv.length:0, uvAllZero:uvZero, alphaMode:mesh.alphaMode, alphaCutoff:mesh.alphaCutoff, baseColor:mesh.baseColorFactor, vertexColor: !!mesh.vertexColor}); mesh._logOnce=true;}catch(e){} }
  const drawSolid=()=>{ if(g.ibo) gl.drawElements(gl.TRIANGLES,g.count,g.type,0); else gl.drawArrays(gl.TRIANGLES,0,g.count); };
  const drawWire =()=>{ gl.lineWidth(1); if(g.ibo) gl.drawElements(gl.LINES,g.count,g.type,0); else gl.drawArrays(gl.LINE_STRIP,0,g.count); };

  if(state.mode==="solid") drawSolid();
  else if(state.mode==="wire") drawWire();
  else { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1,1); drawSolid(); gl.disable(gl.POLYGON_OFFSET_FILL); gl.uniform1i(loc('u_unlit'),1); drawWire(); }

  // Arcball 環（選取）
  if(state.selected>=0 && state.meshes[state.selected]===mesh){
    const r = mesh._radius||100;
    drawRing(M, r, [1,0.35,0.35]); // xy
    drawRing(mat4Mul(M, rotZ90), r, [0.35,1,0.35]); // yz
    drawRing(mat4Mul(M, rotY90), r, [0.35,0.7,1]);  // zx
  }
}
const rotY90=[0,0,1,0, 0,1,0,0, -1,0,0,0, 0,0,0,1];
const rotZ90=[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1];
function drawRing(M,r,color){
  gl.useProgram(PROG);
  gl.bindBuffer(gl.ARRAY_BUFFER, RING.vbo);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(0);
  gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  const loc=n=>gl.getUniformLocation(PROG,n);
  const Ms=[ r,0,0,0, 0,r,0,0, 0,0,r,0, 0,0,0,1 ];
  const MM=mat4Mul(M,Ms);
  gl.uniformMatrix4fv(loc('u_M'),false,new Float32Array(MM));
  gl.uniformMatrix3fv(loc('u_N'),false,new Float32Array([1,0,0,0,1,0,0,0,1]));
  gl.uniform1i(loc('u_unlit'),1); gl.uniform1i(loc('u_hasTex'),0);
  gl.uniform3fv(loc('u_fallbackColor'),new Float32Array(color)); gl.uniform3fv(loc('u_col'),new Float32Array(color));
  gl.drawArrays(gl.LINES,0,RING.count);
}

/* ======================= 迴圈 ======================= */
let last=performance.now();
function loop(t){
  const dt=(t-last)/1000; last=t;
  stepFlight(dt);
  resize();
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

  const P=mat4Perspective(state.fov,(canvas.width||1)/(canvas.height||1),0.1,10000);
  const V=lookAt(state.eye,state.ctr,state.up);
  gl.useProgram(PROG);
  useCommon(P,V);

  if(state.showGrid) drawLines(GRID.vbo, GRID.count, [0.25,0.30,0.35]);
  if(state.showAxes){ drawLines(AXES.vbo, AXES.count, [1,0,0]); drawLines(AXES.vbo, AXES.count, [0,1,1]); }
  for(const p of state.paths) drawPath(p);
  for(const m of state.meshes) drawMesh(m);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ====== 對 UI 暴露 ====== */
export function listObjects(){
  // 只列出群組與沒被隱藏的物件（避免 GLB 子件塞爆清單）
  return state.meshes.filter(m=>!m.deleted && (m.isGroup || !m.hidden)).map(m=>m.name);
}
export function selectObject(name){ const i=state.name2idx[name]; if(i!=null) { state.selected=i; } }
export function setLight(opts){ if(opts) Object.assign(state.light, opts); }
export function getCameraInfo(){ return { eye: state.eye.slice(), ctr: state.ctr.slice() }; }
export function initGL() { /* no-op */ }
export function __getByName(name){ const i=state.name2idx[name]; return i!=null?state.meshes[i]:null; }
// ==== Appended exports for transform & visibility ====


export function setScaleFor(name, s){
  const i=state.name2idx[name]; if(i==null) return;
  const ss = Array.isArray(s)? s.slice(0,3) : [s,s,s];
  const m=state.meshes[i];
  const apply = (tar)=>{ tar.modelS = [parseFloat(ss[0])||1, parseFloat(ss[1])||1, parseFloat(ss[2])||1]; };
  if(m.isGroup){ for(const ci of m._children) apply(state.meshes[ci]); } else apply(m);
}
export function getScaleFor(name){
  const i=state.name2idx[name]; if(i==null) return [1,1,1];
  const m=state.meshes[i]; return m.modelS? m.modelS.slice(0,3):[1,1,1];
}

function rotMat3FromQuat(q){
  const L=Math.hypot(q[0],q[1],q[2],q[3])||1;
  const w=q[0]/L, x=q[1]/L, y=q[2]/L, z=q[3]/L;
  return [
    1-2*(y*y+z*z), 2*(x*y+w*z),   2*(x*z-w*y),
    2*(x*y-w*z),   1-2*(x*x+z*z), 2*(y*z+w*x),
    2*(x*z+w*y),   2*(y*z-w*x),   1-2*(x*x+y*y)
  ];
}
export function getRotMat3For(name){
  const i=state.name2idx[name]; if(i==null) return [1,0,0,0,1,0,0,0,1];
  const m=state.meshes[i];
  const q=m.modelQ || [1,0,0,0];
  return rotMat3FromQuat(q);
}
function quatFromRotMat3(M){
  const m00=M[0], m01=M[1], m02=M[2];
  const m10=M[3], m11=M[4], m12=M[5];
  const m20=M[6], m21=M[7], m22=M[8];
  const trace = m00 + m11 + m22;
  let w,x,y,z;
  if(trace>0){
    let s = Math.sqrt(trace+1.0)*2;
    w = 0.25*s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  }else if((m00>m11)&&(m00>m22)){
    let s = Math.sqrt(1.0 + m00 - m11 - m22)*2;
    w = (m21 - m12) / s;
    x = 0.25*s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  }else if(m11>m22){
    let s = Math.sqrt(1.0 + m11 - m00 - m22)*2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25*s;
    z = (m12 + m21) / s;
  }else{
    let s = Math.sqrt(1.0 + m22 - m00 - m11)*2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25*s;
  }
  return normalizeQ([w,x,y,z]);
}
export function setRotMat3For(name, M){
  const q = quatFromRotMat3(M);
  return setQuatFor(name, q);
}



// === Added by patch: path sampling + position setter ===
export function registerPath(points, normals){
  const P = (points instanceof Float32Array)? points : new Float32Array(points);
  const N = (normals && normals.length>=P.length)? ((normals instanceof Float32Array)?normals:new Float32Array(normals)) : null;
  const n = Math.floor(P.length/3);
  if(n<2){ console.warn('registerPath: need at least 2 points'); state.pathData=null; return; }
  const S = new Float32Array(n); S[0]=0;
  for(let i=1;i<n;i++){
    const x=P[i*3]-P[(i-1)*3], y=P[i*3+1]-P[(i-1)*3+1], z=P[i*3+2]-P[(i-1)*3+2];
    S[i]=S[i-1]+Math.hypot(x,y,z);
  }
  const L = S[n-1];
  state.pathData = { P, N, S, L, n };
  try{ addPath(P); }catch{}
  console.log('[core] registerPath OK — points:', n, 'length:', L.toFixed(3));
}
export function getPathTotalLength(){ return state.pathData ? state.pathData.L : 0; }
function lerp(a,b,t){ return a + (b-a)*t; }
export function samplePathAtDist(s){
  const d = state.pathData; if(!d||d.n<2) return null;
  const L = d.L; if(L<=0) return null;
  let u = s % L; if(u<0) u += L;
  let lo=0, hi=d.n-1;
  while(lo+1<hi){
    const mid = (lo+hi)>>1;
    if(d.S[mid] <= u) lo=mid; else hi=mid;
  }
  const s0 = d.S[lo], s1 = d.S[hi]; const t = (u - s0)/Math.max(1e-8, (s1 - s0));
  const ax= d.P[lo*3], ay=d.P[lo*3+1], az=d.P[lo*3+2];
  const bx= d.P[hi*3], by=d.P[hi*3+1], bz=d.P[hi*3+2];
  const pos=[ ax+(bx-ax)*t, ay+(by-ay)*t, az+(bz-az)*t ];
  const tx = bx-ax, ty=by-ay, tz=bz-az; const len=Math.hypot(tx,ty,tz)||1;
  const tan=[tx/len, ty/len, tz/len];
  let nor;
  if(d.N && d.N.length>=d.P.length){
    const nax=d.N[lo*3], nay=d.N[lo*3+1], naz=d.N[lo*3+2];
    const nbx=d.N[hi*3], nby=d.N[hi*3+1], nbz=d.N[hi*3+2];
    const nx = nax+(nbx-nax)*t, ny = nay+(nby-nay)*t, nz = naz+(nbz-naz)*t;
    const ln = Math.hypot(nx,ny,nz)||1; nor=[nx/ln,ny/ln,nz/ln];
  }else{
    nor=[0,1,0];
  }
  return { pos, tan, nor };
}
export function setPositionFor(name, t){
  const i=state.name2idx[name]; if(i==null) return;
  const m=state.meshes[i];
  const apply=(tar)=>{ tar.modelT=[+t[0]||0,+t[1]||0,+t[2]||0]; };
  if(m.isGroup){ for(const ci of m._children) apply(state.meshes[ci]); } else apply(m);
}
// === End of patch ===
