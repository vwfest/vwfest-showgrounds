// Skin shader: wrap-lit "subsurface-like" diffuse + procedural pore/bump detail (object-space noise, screen-space bump)
// + optional head masks (scalp paint, lips, stubble dots, freckles) driven by a per-vertex unit direction.
import * as THREE from 'three';
const NOISE = `
float h31(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
vec3 pnArb(vec3 sp, vec3 sn, vec2 dH, float fd){ vec3 sx=dFdx(sp), sy=dFdy(sp); vec3 r1=cross(sy,sn), r2=cross(sn,sx); float det=dot(sx,r1)*fd; vec3 g=sign(det)*(dH.x*r1+dH.y*r2); return normalize(abs(det)*sn-g); }
`;
let PORE = null;
function poreTex() { if (PORE) return PORE; const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  let r = 12345; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  // fine wrinkles: short crossing lines (tileable by wrapping)
  g.lineCap = 'round'; for (let i = 0; i < 900; i++) { const x = rnd() * N, y = rnd() * N, a = (rnd() < 0.5 ? 0.6 : 2.4) + (rnd() - 0.5) * 0.5, L = 6 + rnd() * 22; g.strokeStyle = `rgba(40,40,40,${0.08 + rnd() * 0.12})`; g.lineWidth = 0.7 + rnd() * 0.8;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L); g.stroke(); } }
  // pores: small soft dips
  for (let i = 0; i < 5200; i++) { const x = rnd() * N, y = rnd() * N, rr = 0.8 + rnd() * 1.4; const gr = g.createRadialGradient(x, y, 0, x, y, rr * 1.8); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr * 2, y - rr * 2, rr * 4, rr * 4); }
  PORE = new THREE.CanvasTexture(cv); PORE.wrapS = PORE.wrapT = THREE.RepeatWrapping; PORE.anisotropy = 8; return PORE; }
export function skinMaterial(color, o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, sheen: 0.35, sheenColor: new THREE.Color('#ffb59a'), sheenRoughness: 0.6, clearcoat: 0.06, clearcoatRoughness: 0.5 });
  const U = { hairC: { value: new THREE.Color(o.hairC || '#222') }, beardC: { value: new THREE.Color(o.beardC || o.hairC || '#222') }, lipC: { value: new THREE.Color(color).lerp(new THREE.Color('#a24a46'), 0.7) }, sss: { value: o.sss ?? 0.65 }, poreT: { value: poreTex() } };
  const D = []; if (o.head) D.push('HEAD'); if (o.scalp) D.push('SCALP'); if (o.mohawk) D.push('MOHAWK'); if (o.stubble) D.push('STUBBLE'); if (o.beard) D.push('BEARD'); if (o.chops) D.push('CHOPS'); if (o.freckles) D.push('FRECKLES');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const defs = D.map((d) => `#define ${d}\n`).join('');
    sh.vertexShader = defs + 'varying vec3 vObj;\n' + (o.head ? 'attribute vec3 udir; varying vec3 vU;\n' : '') + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObj = position;' + (o.head ? ' vU = udir;' : ''));
    let fs = defs + 'varying vec3 vObj;\n' + (o.head ? 'varying vec3 vU;\n' : '') + 'uniform vec3 hairC, beardC, lipC; uniform float sss; uniform sampler2D poreT;\n' + NOISE + sh.fragmentShader;
    fs = fs.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;',
      'float wr = saturate((dot(geometryNormal, directLight.direction) + 0.45) / 1.45); vec3 irradiance = mix(vec3(dotNL), vec3(wr, mix(dotNL, wr, 0.45), mix(dotNL, wr, 0.3)) * vec3(1.0, 0.92, 0.88), sss) * directLight.color;'));
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
      float lf = vn(vObj * 9.0) * 0.6 + vn(vObj * 31.0) * 0.4;
      diffuseColor.rgb *= mix(vec3(1.04, 0.97, 0.95), vec3(0.95, 0.99, 1.0), lf);
      #ifdef HEAD
        vec3 u = normalize(vU); float ax = abs(u.x);
        float lip = exp(-u.x*u.x/(2.0*0.19*0.19)) * exp(-pow(u.y+0.458,2.0)/(2.0*0.042*0.042)) * step(0.0,u.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, lipC, lip*0.95);
        float ml = exp(-pow(u.y+0.452,2.0)/(2.0*0.007*0.007)) * exp(-u.x*u.x/(2.0*0.18*0.18)) * step(0.0,u.z); diffuseColor.rgb *= 1.0 - 0.7*ml;
        float sock = exp(-pow(ax-0.33,2.0)/(2.0*0.12*0.12)) * exp(-pow(u.y-0.1,2.0)/(2.0*0.09*0.09)) * step(0.0,u.z); diffuseColor.rgb *= 1.0 - 0.14*sock;
        float nlf = exp(-pow(ax-(0.13+(-0.25-u.y)*0.45),2.0)/(2.0*0.02*0.02)) * exp(-pow(u.y+0.37,2.0)/(2.0*0.08*0.08)) * step(0.0,u.z); diffuseColor.rgb *= 1.0 - 0.1*nlf;
        float nos = exp(-pow(ax-0.06,2.0)/(2.0*0.025*0.025)) * exp(-pow(u.y+0.3,2.0)/(2.0*0.022*0.022)) * step(0.0,u.z); diffuseColor.rgb *= 1.0 - 0.6*nos;
        float cheek = exp(-pow(ax-0.42,2.0)/(2.0*0.13*0.13)) * exp(-pow(u.y+0.2,2.0)/(2.0*0.12*0.12)) * step(0.0,u.z); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.04,0.9,0.88), cheek*0.6);
        #ifdef SCALP
          float hl = 0.12 + 0.28*pow(max(u.z,0.0),1.2) - 0.55*max(-u.z,0.0);
          float sc = smoothstep(-0.03, 0.05, u.y - hl);
          #ifdef MOHAWK
            sc *= mix(0.4, 1.0, smoothstep(0.3, 0.2, ax));
          #endif
          float hd = vn(vObj*1600.0); diffuseColor.rgb = mix(diffuseColor.rgb, hairC*mix(0.55,0.9,hd), sc*0.92);
        #endif
        #ifdef STUBBLE
          float tb = mix(-0.29, -0.06, smoothstep(0.14, 0.42, ax));
          float sm = smoothstep(-0.03, 0.14, tb - u.y) * smoothstep(-0.5, -0.25, u.z) * (1.0 - lip) * smoothstep(-1.0, -0.82, u.y);
          #ifdef CHOPS
            sm *= smoothstep(0.3, 0.42, ax);
          #endif
          float nd = vn(vObj*3200.0); float aa = fwidth(nd); float dots = smoothstep(0.62-aa, 0.62+aa, nd) * (1.0 - smoothstep(0.15, 0.5, aa));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.8,0.82,0.88), sm*0.35);
          diffuseColor.rgb = mix(diffuseColor.rgb, beardC*0.7, sm*dots*0.4);
          #ifdef BEARD
            diffuseColor.rgb = mix(diffuseColor.rgb, beardC*0.75, sm*0.85);
          #endif
        #endif
        #ifdef FRECKLES
          float fm = exp(-pow(ax-0.25,2.0)/(2.0*0.16*0.16)) * exp(-pow(u.y+0.08,2.0)/(2.0*0.1*0.1)) * step(0.0,u.z);
          float fn = vn(vObj*1500.0); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.8,0.66,0.55), fm*0.8*smoothstep(0.74,0.8,fn));
        #endif
      #endif`);
    fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * (0.85 + 0.35 * vn(vObj * 160.0)), 0.25, 0.8);
      #ifdef HEAD
        { vec3 uu = normalize(vU); roughnessFactor *= 1.0 - 0.3 * exp(-uu.x*uu.x/(2.0*0.1*0.1)) * smoothstep(-0.3, 0.0, uu.y) * step(0.0, uu.z); }
      #endif`);
    fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 on = abs(normalize(cross(dFdx(vObj), dFdy(vObj)))); on = on*on*on; on /= (on.x+on.y+on.z);
        float pt = texture2D(poreT, vObj.zy*14.0).r*on.x + texture2D(poreT, vObj.xz*14.0).r*on.y + texture2D(poreT, vObj.xy*14.0).r*on.z;
        float hgt = 0.0005*vn(vObj*90.0) + 0.0012*vn(vObj*22.0) + 0.0003*pt;
        float fade = 1.0 - smoothstep(0.0, 0.002, length(fwidth(vObj)));
        normal = pnArb(-vViewPosition, normal, vec2(dFdx(hgt), dFdy(hgt))*fade, faceDirection); }`);
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'skin' + D.join();
  return m;
}
