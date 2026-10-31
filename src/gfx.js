// Graphics pipeline: quality tiers (Ultra/High/Medium/Low), HDR image-based lighting (Poly Haven CC0 HDRIs), cascaded soft shadows, GTAO ambient occlusion,
// bloom (neon + diamond plates), sunset god rays, optional depth of field, ACES tone mapping and MSAA/SMAA anti-aliasing. Heavy modules are loaded only for
// the tiers that use them, so phones never download or run them.
import * as THREE from 'three';
export const TIERS = ['ultra', 'high', 'med', 'low'];
const TIER = {
  ultra: { dpr: 2, post: true, msaa: 4, smaa: true, ao: true, bloom: 0.62, rays: true, shadow: 'csm', shadowRes: 2048, env: true, grass: 110000, tex: true, fog: [90, 330] },
  high: { dpr: 1.5, post: true, msaa: 4, smaa: false, ao: false, bloom: 0.5, rays: false, shadow: 'single', shadowRes: 2048, env: true, grass: 40000, tex: true, fog: [80, 300] },
  med: { dpr: 1.25, post: false, msaa: 0, smaa: false, ao: false, bloom: 0, rays: false, shadow: 'single', shadowRes: 1024, env: true, grass: 9000, tex: false, fog: [70, 260] },
  low: { dpr: 1, post: false, msaa: 0, smaa: false, ao: false, bloom: 0, rays: false, shadow: 'none', shadowRes: 0, env: false, grass: 0, tex: false, fog: [60, 240] },
};
export const tierInfo = (t) => TIER[t] || TIER.med;

// Guess a starting tier from the GPU and device. A runtime FPS governor can still lower it.
export function detectTier(renderer, isTouch) {
  let gpu = ''; try { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''; } catch {}
  const g = gpu.toLowerCase(), mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(g)) return { tier: 'low', gpu };
  if (isTouch || /mali|adreno|powervr|apple gpu.*a\d|videocore/.test(g)) return { tier: mem >= 6 && cores >= 8 && !/mali-g[3-5]|adreno \(tm\) [3-5]/.test(g) ? 'med' : 'low', gpu };
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m\d|apple gpu|arc /.test(g) && mem >= 4) return { tier: 'ultra', gpu };
  if (/intel|uhd|iris|radeon\(tm\)|vega|mesa/.test(g)) return { tier: cores >= 8 && mem >= 8 ? 'high' : 'med', gpu };
  return { tier: mem >= 8 && cores >= 8 ? 'high' : 'med', gpu };
}

const GODRAYS = {
  uniforms: { tDiffuse: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 }, decay: { value: 0.955 }, thr: { value: 0.8 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 sun; uniform float strength; uniform float decay; uniform float thr; varying vec2 vUv;
    void main(){ vec4 base=texture2D(tDiffuse,vUv); if(strength<=0.001){ gl_FragColor=base; return; }
      vec2 d=(vUv-sun)/56.*0.95; vec2 uv=vUv; float w=1.; vec3 acc=vec3(0.);
      for(int i=0;i<56;i++){ uv-=d; vec3 c=texture2D(tDiffuse,uv).rgb; float l=dot(c,vec3(0.3,0.59,0.11)); acc+=max(c*smoothstep(thr,thr+1.2,l),0.)*w; w*=decay; }
      gl_FragColor=vec4(base.rgb+acc*strength/56.*3.2,base.a); }`,
};

export class Gfx {
  constructor({ renderer, scene, camera, world, sky, base = '', isTouch = false }) {
    Object.assign(this, { renderer, scene, camera, world, sky, base, isTouch }); this.tier = null; this.comp = null; this.csm = null; this.env = {}; this.curEnv = null; this.passes = {}; this.texLoaded = false; this.w = 1; this.h = 1; this.dof = false;
    this.sun = sky.sun; this.hemi = sky.hemi; this.tmp = new THREE.Vector3(); this.fpsAcc = 0; this.fpsN = 0; this.bad = 0; this.auto = true; this.born = performance.now(); this.onTier = null;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = true;
  }
  async setTier(t, auto = false) {
    if (!TIER[t]) t = 'med'; const cfg = TIER[t], r = this.renderer; this.tier = t; this.cfg = cfg; this.auto = auto; const seq = (this.seq = (this.seq || 0) + 1);
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dpr)); r.shadowMap.enabled = cfg.shadow !== 'none'; this.scene.fog.near = cfg.fog[0]; this.scene.fog.far = cfg.fog[1];
    if (this.world.setGrass) this.world.setGrass(cfg.grass); if (cfg.tex && !this.texLoaded) this.loadTextures(); else if (!cfg.tex && this.world.setPbrTextures) { this.world.setPbrTextures(null); this.texLoaded = false; }
    await this.setupShadows(cfg); if (seq !== this.seq) return;
    this.scene.traverse((o) => { if (o.material && o.isMesh) { for (const m of [].concat(o.material)) m.needsUpdate = true; } });
    if (cfg.env) await this.loadEnv(); else { this.scene.environment = null; this.curEnv = null; }
    if (seq !== this.seq) return; await this.setupPost(cfg); if (seq !== this.seq) return; this.resize(this.w, this.h); if (this.onTier) this.onTier(t);
  }
  // ---- shadows ----
  async setupShadows(cfg) {
    const { sun, scene } = this; if (this.csm) { this.csm.remove(); this.csm.dispose(); this.csm = null; for (const m of this.sharedMaterials()) if (m.userData.chain) m.onBeforeCompile = m.userData.chain; }
    sun.castShadow = false; sun.visible = true;
    if (cfg.shadow === 'single') { sun.castShadow = true; sun.shadow.mapSize.set(cfg.shadowRes, cfg.shadowRes); const c = sun.shadow.camera; Object.assign(c, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 260 }); c.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3; if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    else if (cfg.shadow === 'csm') {
      const { CSM } = await import('three/addons/csm/CSM.js'); if (this.tier !== 'ultra') return;
      this.csm = new CSM({ maxFar: 190, cascades: 3, mode: 'practical', parent: scene, shadowMapSize: cfg.shadowRes, lightDirection: new THREE.Vector3(-1, -1, -0.3).normalize(), camera: this.camera, lightIntensity: 1, lightNear: 1, lightFar: 600, shadowBias: -0.0003 });
      this.csm.fade = true; sun.visible = false; for (const m of this.sharedMaterials()) { this.csm.setupMaterial(m); if (m.userData.chain) { const f = m.onBeforeCompile, ch = m.userData.chain; m.onBeforeCompile = (sh, r) => { f(sh, r); ch(sh, r); }; } }
    }
    this.world.setShadowCasting && this.world.setShadowCasting(cfg.shadow !== 'none');
  }
  sharedMaterials() { return this.world.materials ? this.world.materials() : []; }
  // ---- image based lighting ----
  async loadEnv() {
    if (this.env.day) return this.useEnv(); const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js'); const pm = new THREE.PMREMGenerator(this.renderer); const ld = new RGBELoader();
    const load = (f) => new Promise((res) => ld.load(`${this.base}assets/${f}`, (t) => { t.mapping = THREE.EquirectangularReflectionMapping; const e = pm.fromEquirectangular(t).texture; t.dispose(); res(e); }, undefined, () => res(null)));
    const [day, sun] = await Promise.all([load('kloppenheim_06_puresky_1k.hdr'), load('belfast_sunset_puresky_1k.hdr')]); pm.dispose(); this.env = { day, sun: sun || day }; this.useEnv();
  }
  useEnv(which) { const e = this.env[which || this.curEnvName || 'day']; if (e) { this.scene.environment = e; this.curEnv = e; } }
  // ---- textures ----
  loadTextures() { this.texLoaded = true; const L = new THREE.TextureLoader(), A = `${this.base}assets/`; const get = (f, srgb) => { const t = L.load(A + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const set = (n) => ({ map: get(`${n}_diff_1k.jpg`, true), normalMap: get(`${n}_nor_1k.jpg`), roughnessMap: get(`${n}_rough_1k.jpg`) }); if (this.world.setPbrTextures) this.world.setPbrTextures({ asphalt: set('asphalt_02'), grass: set('grass_path_2') }); }
  // ---- post processing ----
  async setupPost(cfg) {
    const r = this.renderer; if (this.comp) { this.comp.dispose(); this.comp = null; } this.passes = {};
    if (!cfg.post) { r.toneMappingExposure = 1.0; return; }
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js'), import('three/addons/postprocessing/ShaderPass.js')]);
    const size = r.getDrawingBufferSize(new THREE.Vector2()); const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: cfg.msaa });
    const c = (this.comp = new EffectComposer(r, rt)); c.addPass(new RenderPass(this.scene, this.camera));
    if (cfg.ao) { const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js'); const g = new GTAOPass(this.scene, this.camera, size.x, size.y); g.output = GTAOPass.OUTPUT.Default; g.blendIntensity = 0.95; g.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false }); g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // the AO normal pass re-renders the scene with a normal material: keep sprites (name tags), transparent glass and the grass out of it
      const r0 = g.render.bind(g); g.render = (...a) => { const hid = []; this.scene.traverse((o) => { if (o.visible && (o.isSprite || o.isInstancedMesh || (o.isMesh && o.material && o.material.transparent))) { hid.push(o); o.visible = false; } }); r0(...a); for (const o of hid) o.visible = true; }; c.addPass(g); this.passes.ao = g; }
    if (this.dof) { const { BokehPass } = await import('three/addons/postprocessing/BokehPass.js'); const b = new BokehPass(this.scene, this.camera, { focus: 9, aperture: 0.00018, maxblur: 0.012 }); c.addPass(b); this.passes.dof = b; }
    if (cfg.rays) { const sp = new ShaderPass(GODRAYS); c.addPass(sp); this.passes.rays = sp; }
    if (cfg.bloom) { const b = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), cfg.bloom, 0.65, 0.95); c.addPass(b); this.passes.bloom = b; }
    c.addPass(new OutputPass());
    if (cfg.smaa) { const { SMAAPass } = await import('three/addons/postprocessing/SMAAPass.js'); const s = new SMAAPass(size.x, size.y); c.addPass(s); this.passes.smaa = s; }
  }
  async setDof(on) { this.dof = !!on; if (this.cfg && this.cfg.post) await this.setupPost(this.cfg); this.resize(this.w, this.h); }
  resize(w, h) { this.w = w; this.h = h; const r = this.renderer; r.setSize(w, h, false); if (this.comp) { this.comp.setPixelRatio(r.getPixelRatio()); this.comp.setSize(w, h); } }
  // ---- per frame ----
  update(phase, focus, dt) {
    const { sun, hemi, scene } = this; const k = this.sky.state || { sun: 1, sunset: 0 };
    // sun elevation drives env choice + intensities
    const sunset = k.sunset; const want = sunset > 0.35 ? 'sun' : 'day'; if (want !== this.curEnvName) { this.curEnvName = want; if (this.cfg && this.cfg.env) this.useEnv(want); }
    const day = Math.min(1, Math.max(0, (k.sun - 0.1) / 1.05)); if (this.cfg && this.cfg.env && this.curEnv) { scene.environmentIntensity = 0.1 + 0.95 * day; hemi.intensity *= 0.28; } else { scene.environmentIntensity = 1; }
    // sun / CSM follow the player (snapped to the shadow texel to prevent shimmering)
    const dir = this.sky.sunDir; if (this.csm) { this.csm.lightDirection.copy(dir).negate(); for (const l of this.csm.lights) { l.color.copy(sun.color); l.intensity = sun.intensity * 1.1; } this.csm.update(); }
    else if (sun.castShadow) { const ts = 96 / this.cfg.shadowRes; const x = Math.round(focus.x / (ts * 4)) * ts * 4, z = Math.round(focus.z / (ts * 4)) * ts * 4; sun.target.position.set(x, 0, z); sun.position.set(x + dir.x * 120, dir.y * 120, z + dir.z * 120); sun.target.updateMatrixWorld(); }
    if (this.passes.rays) { const u = this.passes.rays.uniforms; this.tmp.copy(this.camera.position).addScaledVector(dir, 400).project(this.camera); const front = this.camera.getWorldDirection(new THREE.Vector3()).dot(dir) > 0.05; u.sun.value.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5); u.strength.value = front ? Math.max(0, sunset) * 0.9 + (k.sun > 0.6 ? 0.06 : 0) : 0; }
    this.renderer.toneMappingExposure = 0.92 + 0.32 * (1 - day);
    if (this.passes.dof && focus.dist) this.passes.dof.uniforms.focus.value = focus.dist;
  }
  render(dt) {
    const t = performance.now(); if (this.comp) this.comp.render(dt); else this.renderer.render(this.scene, this.camera);
    // governor: if the average frame rate stays too low in auto mode, step the tier down (never up, to avoid flapping)
    if (this.auto && this.tier !== 'low') { this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 3) { const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; if (performance.now() - this.born > 6000) { this.bad = fps < 27 ? this.bad + 1 : 0; if (this.bad >= 2) { this.bad = 0; this.born = performance.now(); this.setTier(TIERS[TIERS.indexOf(this.tier) + 1], true); } } } }
  }
}
