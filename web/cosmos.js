// Orion — moteur de rendu cosmos (ThreeRenderer), qualité cinématique.
// Implémente l'interface RendererAdapter. NE CONNAÎT QUE le Modèle de Domaine Orion.
// Pipeline : RenderPass → UnrealBloomPass → OutputPass (tone mapping ACES).
// Planètes & étoiles en ShaderMaterial procédural (surface + atmosphère fresnel).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BASE_COLOR = {
  star: 0xffcf6e, planet: 0x4fd0e0, station: 0x9a8cff, moon: 0xcdd6ea, rogue: 0xc06bff,
};
// Palette « naturelle » pour les corps nominaux : un système solaire diversifié.
// Le statut (scanning/attack/compromised) reste le signal d'alerte qui surcharge ces teintes.
const PLANET_PALETTE = [
  0x3a6ea5, 0x2fa39a, 0xc2703d, 0xc9a36a, 0x6f78c8, 0x9fc8e0, 0x3fae7a, 0xa85a5a, 0x7b6cd0,
];
// Coquilles orbitales : chaque corps sur une orbite distincte, espacement garanti.
const SHELLS = [{ r: 22, max: 4 }, { r: 38, max: 6 }, { r: 54, max: 8 }, { r: 72, max: 10 }];
const SHELL_PHASE = [0, 0.5, 0.25, 0.75];
const ZONE_R = 138; // distance des systèmes au centre de la galaxie
const STATUS_COLOR = {
  nominal: null, scanning: 0xffe066, under_attack: 0xff9b3d,
  compromised: 0xff3b46, offline: 0x556070,
};
const SEV_COLOR = {
  info: 0x6f8fd0, low: 0x46c8ff, medium: 0x3ad6a0, high: 0xff9b3d, critical: 0xff3b46,
};

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---- GLSL : bruit simplex 3D (Ashima) partagé par les shaders ----
const NOISE = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy; vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5,f=0.0; for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.02; a*=0.5; } return f; }
`;

const BODY_VERT = `
varying vec3 vNormalW; varying vec3 vPosW; varying vec3 vPosL;
void main(){
  vPosL = position;
  vec4 wp = modelMatrix * vec4(position,1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PLANET_FRAG = NOISE + `
uniform vec3 uColor; uniform vec3 uTint; uniform float uTintAmt;
uniform float uTime; uniform float uSeed; uniform float uStar; uniform float uType;
varying vec3 vNormalW; varying vec3 vPosW; varying vec3 vPosL;
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(vec3(0.55, 0.7, 0.45));
  vec3 sp = vPosL * 1.7 + uSeed;
  float n = fbm(sp);
  float diff = clamp(dot(N,L), 0.0, 1.0);
  float lat = vPosL.y / max(length(vPosL), 0.001);

  // ---- étoile : seule vraie source lumineuse ----
  if (uStar > 0.5) {
    float tur = fbm(sp*2.0 + uTime*0.15);
    vec3 hot = mix(uColor, vec3(1.0,0.96,0.84), 0.5);
    vec3 col = mix(uColor*1.05, hot*1.6, smoothstep(-0.3,0.6,tur));
    float fr = pow(1.0 - clamp(dot(N,V),0.0,1.0), 2.0);
    col += hot * fr * 0.7;
    gl_FragColor = vec4(col, 1.0); return;
  }

  // ---- planètes : surface typée (corps solides, sous le seuil de bloom) ----
  vec3 surf;
  if (uType < 0.5) {
    // TERRESTRE : océans, continents, calottes, lumières de ville la nuit
    float land = smoothstep(0.0, 0.22, n);
    vec3 ocean = vec3(0.04,0.16,0.32);
    vec3 ground = mix(vec3(0.18,0.30,0.12), vec3(0.42,0.34,0.20), fbm(sp*2.0)*0.5+0.5);
    surf = mix(ocean, ground, land);
    surf = mix(surf, vec3(0.82,0.88,0.95), smoothstep(0.72,0.96, abs(lat)));
    surf = mix(surf, surf*0.5 + uColor*0.5, 0.20);
    surf *= (0.14 + diff*0.95);
    float night = smoothstep(0.25, -0.05, diff);
    float city = smoothstep(0.62,0.85, fbm(sp*5.0)) * land * night;
    surf += vec3(1.0,0.82,0.45) * city * 0.4;
  } else if (uType < 1.5) {
    // GÉANTE GAZEUSE : bandes + tourbillons animés
    float band = sin(lat*11.0 + fbm(sp*1.4)*3.0);
    float swirl = fbm(vec3(sp.x*3.0, sp.y*1.0, sp.z*3.0) + uTime*0.04);
    surf = mix(uColor*0.45, mix(uColor, vec3(1.0),0.45), band*0.5+0.5);
    surf = mix(surf, uColor, swirl*0.35+0.25);
    surf *= (0.18 + diff*0.9);
  } else if (uType < 2.5) {
    // GLACE : albédo élevé, craquelures
    float cr = smoothstep(0.46,0.5, abs(fbm(sp*3.0)));
    surf = mix(vec3(0.68,0.80,0.92), uColor, 0.30) - cr*0.22;
    surf *= (0.20 + diff*0.95);
  } else if (uType < 3.5) {
    // MONDE OCÉAN : bleu + nuages mouvants
    float clouds = smoothstep(0.30,0.62, fbm(sp*2.2 + uTime*0.03));
    surf = mix(uColor*0.7, vec3(0.45,0.68,0.95), 0.4);
    surf = mix(surf, vec3(0.95), clouds*0.55);
    surf *= (0.16 + diff*0.95);
  } else {
    // ROGUE / VOLCANIQUE : sombre, fissures incandescentes (menaçant)
    float crack = smoothstep(0.74,0.9, fbm(sp*2.4 + uTime*0.12));
    surf = vec3(0.06,0.035,0.045) + vec3(1.0,0.25,0.10)*crack*0.85;
    surf *= (0.4 + diff*0.6);
  }

  // ---- overlay statut : garde la texture, teinte fort + liseré pulsé ----
  surf = mix(surf, surf*0.30 + uTint*0.9, uTintAmt);
  float fres = pow(1.0 - clamp(dot(N,V),0.0,1.0), 3.2);
  vec3 atmoBase = (uType > 3.5) ? vec3(0.9,0.25,0.12) : mix(uColor, vec3(0.5,0.72,1.0), 0.4);
  vec3 atmo = mix(atmoBase, uTint, uTintAmt) * fres * (0.5 + uTintAmt*1.6);
  gl_FragColor = vec4(surf + atmo, 1.0);
}`;

const VIGNETTE_FRAG = `
uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = vUv - 0.5;
  float vig = 1.0 - dot(d, d) * uStrength;
  c.rgb *= clamp(vig, 0.0, 1.0);
  gl_FragColor = c;
}`;

const RING_VERT = `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `;
const RING_FRAG = NOISE + `
uniform vec3 uColor; varying vec3 vP;
void main(){
  float d = length(vP.xy);
  float bands = 0.5 + 0.5*sin(d*5.0) * (0.6 + 0.4*snoise(vec3(d*8.0,0.0,0.0)));
  float a = bands * 0.5;
  gl_FragColor = vec4(uColor * (0.7+bands*0.6), a);
}`;

const NEBULA_FRAG = NOISE + `
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float n  = fbm(d*2.2 + 3.0);
  float n2 = fbm(d*4.5 - 7.0);
  vec3 deep   = vec3(0.015,0.02,0.05);
  vec3 purple = vec3(0.10,0.05,0.20);
  vec3 teal   = vec3(0.02,0.10,0.16);
  vec3 col = mix(deep, purple, smoothstep(0.0,0.9,n));
  col = mix(col, teal, smoothstep(0.35,1.0,n2)*0.5);
  // bande galactique douce
  float band = exp(-pow(d.y*2.6,2.0));
  col += vec3(0.06,0.07,0.12) * band * (0.4+0.6*n);
  gl_FragColor = vec4(col, 1.0);
}`;

export class ThreeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.bodies = new Map();
    this.fluxLines = [];
    this.projectiles = [];
    this.shocks = [];
    this.fluxPulses = [];          // impulsions de données circulant entre les corps
    this.shaderMats = [];          // matériaux à animer (uTime)
    this.analyst = false;
    this.onPick = null;
    this._clock = new THREE.Clock();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  mount() {
    const scene = new THREE.Scene();
    this.scene = scene;

    const cam = new THREE.PerspectiveCamera(55, this._aspect(), 0.1, 4000);
    cam.position.set(0, 112, 288);
    this.camera = cam;

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;
    this._resizeRenderer();

    // ---- pipeline de post-processing (bloom cinématique) ----
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, cam));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(this.canvas.clientWidth, this.canvas.clientHeight),
      0.45,   // strength — seuls les cœurs d'étoiles / comètes embrasent
      0.40,   // radius
      0.62,   // threshold — la majorité de la scène reste SOUS le seuil
    );
    this.bloom = bloom;
    composer.addPass(bloom);
    const vignette = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uStrength: { value: 1.15 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: VIGNETTE_FRAG,
    });
    composer.addPass(vignette);
    composer.addPass(new OutputPass());
    this.composer = composer;

    const controls = new OrbitControls(cam, this.canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.maxDistance = 1100; controls.minDistance = 26;
    controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.22;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    this.controls = controls;

    scene.add(new THREE.AmbientLight(0x3a4566, 0.9));
    const dir = new THREE.DirectionalLight(0xcfe0ff, 0.7);
    dir.position.set(70, 120, 50); scene.add(dir);

    this._glowTex = makeGlowTexture();
    this._flareTex = makeFlareTexture();
    this._buildNebula();
    this._buildStarfield();

    // intro caméra cinématique : plongée dans le cosmos
    this._introFrom = new THREE.Vector3(0, 480, 840);
    this._introTo = new THREE.Vector3(0, 112, 288);
    this._introT = 0;
    cam.position.copy(this._introFrom);
    controls.enabled = false;

    window.addEventListener('resize', () => this._resize());
    this.canvas.addEventListener('click', (e) => this._handleClick(e));

    this._preallocPools();
    this._animate();
  }

  buildFromSnapshot(snap) {
    for (const b of this.bodies.values()) this.scene.remove(b.group);
    this.bodies.clear();
    if (this._systems) for (const o of this._systems) this.scene.remove(o);
    this._systems = [];

    const zones = snap.zones;
    const zoneCenter = new Map();
    zones.forEach((z, i) => {
      const a = (i / zones.length) * Math.PI * 2 - Math.PI / 2;
      zoneCenter.set(z.id, new THREE.Vector3(Math.cos(a) * ZONE_R, 0, Math.sin(a) * ZONE_R));
    });
    this.zoneCenters = zoneCenter;       // pour l'ajout dynamique de corps
    this.zoneSlots = new Map();          // zoneId -> nb de corps non-gateway placés

    for (const z of zones) this._addZoneSystem(zoneCenter.get(z.id), z);

    const byZone = new Map();
    for (const b of snap.bodies) {
      const k = zoneCenter.has(b.zone) ? b.zone : '__ext';
      (byZone.get(k) || byZone.set(k, []).get(k)).push(b);
    }

    for (const [zid, list] of byZone) {
      if (zid === '__ext') {
        list.forEach((b, i) => {
          const a = (i / Math.max(1, list.length)) * Math.PI * 2;
          this._addBody(b, new THREE.Vector3(Math.cos(a) * 44, 64, -300 - i * 12));
        });
        continue;
      }
      const c = zoneCenter.get(zid);
      // gateway au centre, le reste sur orbites concentriques (plus critique = plus proche)
      const others = list.filter((b) => b.kind !== 'gateway').sort((a, b) => b.criticality - a.criticality);
      for (const b of list) if (b.kind === 'gateway') this._addBody(b, c.clone().setY(0));
      others.forEach((b) => {
        const idx = this.zoneSlots.get(zid) || 0;
        this.zoneSlots.set(zid, idx + 1);
        this._addBody(b, this._slotPosition(c, idx));
      });
    }
  }

  // Position sur la prochaine coquille orbitale libre du système
  _slotPosition(center, idx) {
    let s = 0, rem = idx;
    while (s < SHELLS.length - 1 && rem >= SHELLS[s].max) { rem -= SHELLS[s].max; s++; }
    const shell = SHELLS[s];
    const ang = (rem / shell.max) * Math.PI * 2 + SHELL_PHASE[s] * Math.PI * 2;
    const y = ((s % 2) ? 7 : -7) + (rem % 2 ? 3 : -3);
    return center.clone().add(new THREE.Vector3(Math.cos(ang) * shell.r, y, Math.sin(ang) * shell.r));
  }

  // Système solaire : orbites concentriques + label
  _addZoneSystem(center, zone) {
    for (const sh of SHELLS) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(sh.r - 0.3, sh.r + 0.3, 180),
        new THREE.MeshBasicMaterial({ color: 0x33507f, transparent: true, opacity: 0.15,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.copy(center);
      this.scene.add(ring); this._systems.push(ring);
    }
    const lbl = this._makeLabel(`◇ ${zone.constellation}\n${zone.label}`, 0xaec4ff);
    lbl.position.copy(center).add(new THREE.Vector3(0, 0, SHELLS[SHELLS.length - 1].r + 14));
    lbl.scale.multiplyScalar(1.4);
    this.scene.add(lbl); this._systems.push(lbl);
  }

  // Ajout d'un corps à chaud (découverte d'actif / source temps réel) → topologie dynamique
  addBodyDynamic(b) {
    if (this.bodies.has(b.id)) return;
    const c = this.zoneCenters?.get(b.zone);
    let pos;
    if (c) {
      const idx = this.zoneSlots.get(b.zone) || 0;
      this.zoneSlots.set(b.zone, idx + 1);
      pos = this._slotPosition(c, idx);
    } else {
      pos = new THREE.Vector3((Math.random() - 0.5) * 70, 56, -300);
    }
    this._addBody(b, pos);
    const body = this.bodies.get(b.id);
    if (body) { body.group.scale.setScalar(0.01); body.spawnT = 0; }
  }

  _bodyMaterial(color, isStar, seed, type) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: color.clone() },
        uTint: { value: new THREE.Color(0xff3b46) },
        uTintAmt: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uStar: { value: isStar ? 1 : 0 },
        uType: { value: type },
      },
      vertexShader: BODY_VERT,
      fragmentShader: PLANET_FRAG,
    });
    this.shaderMats.push(mat);
    return mat;
  }

  _addBody(b, pos) {
    const group = new THREE.Group();
    group.position.copy(pos);

    const isStar = b.kind === 'gateway'; // une seule étoile par système : la passerelle
    const r = 2.0 + b.criticality * 0.9 + (b.mass || 0) * 1.7 + (isStar ? 1.8 : 0);
    let hash = 0; for (let i = 0; i < b.id.length; i++) hash = (hash * 31 + b.id.charCodeAt(i)) >>> 0;
    const seed = (hash % 997) * 0.13;
    const baseColor = new THREE.Color(
      isStar ? BASE_COLOR.star
      : b.cosmic === 'rogue' ? BASE_COLOR.rogue
      : b.cosmic === 'station' ? BASE_COLOR.station
      : PLANET_PALETTE[hash % PLANET_PALETTE.length],
    );

    const type = isStar ? 0
      : b.cosmic === 'rogue' ? 4
      : (b.kind === 'server' && b.criticality >= 3) ? 1   // géante gazeuse (joyau)
      : b.kind === 'server' ? 0                            // terrestre
      : b.kind === 'service' ? 3                           // monde océan
      : b.kind === 'endpoint' ? 2                          // glace
      : 0;
    const mat = this._bodyMaterial(baseColor, isStar, seed, type);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 48), mat);
    group.add(mesh);

    // halo additif : très subtil (atmosphère) sur planète, modeste sur étoile
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTex, color: baseColor.clone(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      opacity: isStar ? 0.5 : 0.14,
    }));
    glow.scale.setScalar(r * (isStar ? 3.4 : 2.3));
    group.add(glow);

    // couronne solaire (flare en croix) pour les étoiles
    let corona = null;
    if (isStar) {
      corona = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._flareTex, color: baseColor.clone(), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55,
      }));
      corona.scale.setScalar(r * 7.5);
      group.add(corona);
    }

    // anneau pour certaines planètes (détail)
    let ring = null;
    if (!isStar && b.criticality >= 2 && b.cosmic === 'planet') {
      ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 1.5, r * 2.5, 96),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: baseColor.clone() } },
          vertexShader: RING_VERT, fragmentShader: RING_FRAG,
          transparent: true, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2 - 0.5;
      ring.rotation.y = seed;
      group.add(ring);
    }

    const label = this._makeLabel(`${b.label}\n${b.id.replace(/^host-/, '')}`);
    label.position.set(0, r + 5, 0);
    label.visible = this.analyst;
    group.add(label);

    this.scene.add(group);
    this.bodies.set(b.id, {
      group, mesh, mat, glow, ring, label, corona, pos: pos.clone(),
      baseColor,
      tint: new THREE.Color(0xff3b46), tintTarget: new THREE.Color(0xff3b46),
      tintAmt: 0, tintAmtTarget: 0, glowTarget: baseColor.clone(),
      isStar, r, rot: (Math.random() * 0.4 + 0.1) * (Math.random() > 0.5 ? 1 : -1),
      statusName: 'nominal',
    });
  }

  setBodyStatus(id, status) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.statusName = status;
    b.tintAmtTarget = { nominal: 0, scanning: 0.5, under_attack: 0.7, compromised: 0.88, offline: 0.55 }[status] ?? 0;
    const sc = STATUS_COLOR[status];
    if (sc != null) b.tintTarget.set(sc);
    b.glowTarget = sc != null ? new THREE.Color(sc) : b.baseColor.clone();
  }

  spawnEvent(ev) {
    const from = this.bodies.get(ev.src)?.pos;
    const to = this.bodies.get(ev.dst)?.pos;
    if (!to) return;
    const start = (from || this._farPoint()).clone();
    const color = new THREE.Color(SEV_COLOR[ev.severity] || SEV_COLOR.info);
    const blackhole = ev.cosmic === 'blackhole';

    const p = this.projectiles.find((x) => !x.active);
    if (!p) return;
    p.active = true; p.t = 0;
    p.speed = blackhole ? 0.42 : ev.cosmic === 'meteor' ? 1.3 : 0.55; // ralenti → plus lisible
    p.start.copy(blackhole ? to : start);
    p.end.copy(blackhole ? this._farPoint() : to);
    p.ctrl.copy(p.start).add(p.end).multiplyScalar(0.5).add(new THREE.Vector3(0, 34 + Math.random() * 30, 0));
    const hot = color.clone().lerp(new THREE.Color(0xffffff), 0.5); // cœur incandescent
    p.headScale = ev.severity === 'critical' ? 15 : ev.severity === 'high' ? 10 : ev.severity === 'medium' ? 7 : 5;
    p.head.material.color.copy(hot); p.head.material.opacity = 1;
    p.head.scale.setScalar(p.headScale); p.head.visible = true;
    for (const s of p.tail) { s.material.color.copy(color); s.visible = !reduceMotion; }
    for (let i = 0; i < p.trailLen; i++) p.setTrail(i, p.start);
    p.onArrive = () => {
      if (ev.severity === 'critical') this._supernova(to, color);
      else this._impactFlash(to, color);
    };
  }

  drawFlux(flux) {
    const a = this.bodies.get(flux.src)?.pos, b = this.bodies.get(flux.dst)?.pos;
    if (!a || !b) return;
    const line = this.fluxLines.find((l) => !l.active);
    if (!line) return;
    line.active = true; line.life = 1;
    line.geom.setFromPoints([a, b]);
    line.obj.visible = true;
    const susp = flux.status === 'suspicious';
    line.obj.material.color.set(susp ? 0xff9b3d : 0x335f9e);
    // glint de données qui parcourt la liaison
    const fp = this.fluxPulses.find((x) => !x.active);
    if (fp) {
      fp.active = true; fp.t = 0; fp.speed = 0.9 + Math.random() * 0.5;
      fp.a.copy(a); fp.b.copy(b);
      fp.sprite.material.color.set(susp ? 0xff9b3d : 0x6fd0ff);
      fp.sprite.scale.setScalar(2.4); fp.sprite.visible = true;
    }
  }

  _preallocPools() {
    for (let i = 0; i < 48; i++) {
      const trailLen = reduceMotion ? 2 : 26;
      const positions = new Float32Array(trailLen * 3);
      const head = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      head.visible = false; this.scene.add(head);
      const tail = [];
      const TN = reduceMotion ? 0 : 10;
      for (let j = 0; j < TN; j++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        s.visible = false; this.scene.add(s); tail.push(s);
      }
      this.projectiles.push({
        active: false, t: 0, speed: 1, trailLen, positions, head, tail, headScale: 5,
        start: new THREE.Vector3(), end: new THREE.Vector3(), ctrl: new THREE.Vector3(), onArrive: null,
        setTrail(i, v) { this.positions[i*3]=v.x; this.positions[i*3+1]=v.y; this.positions[i*3+2]=v.z; },
        sampleTo(i, out) { out.set(this.positions[i*3], this.positions[i*3+1], this.positions[i*3+2]); },
      });
    }
    for (let i = 0; i < 48; i++) {
      const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const obj = new THREE.Line(geom, new THREE.LineBasicMaterial({
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      obj.visible = false; this.scene.add(obj);
      this.fluxLines.push({ active: false, life: 0, geom, obj });
    }
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(1, 1.6, 64),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; this.scene.add(m);
      this.shocks.push({ active: false, t: 0, mesh: m });
    }
    // impulsions de flux : des glints de données qui circulent entre les corps
    for (let i = 0; i < 80; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sprite.visible = false; this.scene.add(sprite);
      this.fluxPulses.push({ active: false, t: 0, speed: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), sprite });
    }
  }

  _supernova(pos, color) {
    const s = this.shocks.find((x) => !x.active);
    if (s) { s.active = true; s.t = 0; s.mesh.position.copy(pos); s.mesh.material.color.copy(color); s.mesh.visible = true; }
    this._impactFlash(pos, color);
    if (this.onSupernova) this.onSupernova();
  }

  _impactFlash(pos, color) {
    const p = this.projectiles.find((x) => !x.active);
    if (!p) return;
    p.active = true; p.t = 0; p.speed = 3; p.start.copy(pos); p.end.copy(pos); p.ctrl.copy(pos);
    p.head.material.color.copy(color); p.head.material.opacity = 1;
    p.head.scale.setScalar(18); p.head.visible = true;
    for (const s of p.tail) s.visible = false; p.onArrive = null;
  }

  setAnalyst(on) {
    this.analyst = on;
    for (const b of this.bodies.values()) b.label.visible = on;
  }

  // Centre la caméra sur un corps (depuis la vue Incidents)
  focusBody(id) {
    const b = this.bodies.get(id);
    if (!b) return;
    this.controls.autoRotate = false;
    this.controls.target.copy(b.pos);
    const dir = new THREE.Vector3().subVectors(this.camera.position, b.pos);
    if (dir.lengthSq() < 1) dir.set(0, 0.4, 1);
    dir.normalize().multiplyScalar(42);
    this.camera.position.copy(b.pos).add(dir);
    this.controls.update();
    if (this.onPick) this.onPick(id);
  }

  _animate() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const t = this._clock.elapsedTime;

    // intro caméra cinématique (plongée), puis on rend la main à l'utilisateur
    if (this._introT < 1) {
      this._introT = Math.min(1, this._introT + dt / 2.8);
      const e = 1 - Math.pow(1 - this._introT, 3);
      this.camera.position.lerpVectors(this._introFrom, this._introTo, e);
      this.controls.target.set(0, 0, 0);
      if (this._introT >= 1) this.controls.enabled = true;
    }
    this.controls.update();

    for (const m of this.shaderMats) m.uniforms.uTime.value = t;

    for (const b of this.bodies.values()) {
      b.tintAmt += (b.tintAmtTarget - b.tintAmt) * 0.06;
      b.tint.lerp(b.tintTarget, 0.08);
      b.mat.uniforms.uTint.value.copy(b.tint);
      b.mat.uniforms.uTintAmt.value = b.tintAmt;
      b.glow.material.color.lerp(b.glowTarget, 0.06);
      b.mesh.rotation.y += dt * b.rot * 0.25;
      const pulse = 1 + Math.sin(t * 2.5 + b.pos.x) * (b.statusName === 'compromised' ? 0.2 : 0.05);
      b.glow.scale.setScalar(b.r * (b.isStar ? 3.4 : 2.3) * pulse * (1 + b.tintAmt * 0.4));
      if (b.corona) {
        b.corona.material.rotation += dt * 0.08;
        b.corona.scale.setScalar(b.r * 7.5 * (1 + Math.sin(t * 1.4 + b.pos.z) * 0.07));
      }
      if (b.spawnT !== undefined && b.spawnT < 1) {
        b.spawnT = Math.min(1, b.spawnT + dt * 1.6);
        const e = 1 - Math.pow(1 - b.spawnT, 3);
        b.group.scale.setScalar(e);
      }
    }

    // impulsions de flux : glints qui parcourent les liaisons réseau
    for (const fp of this.fluxPulses) {
      if (!fp.active) continue;
      fp.t += dt * fp.speed;
      this._tmp.lerpVectors(fp.a, fp.b, Math.min(fp.t, 1));
      fp.sprite.position.copy(this._tmp);
      fp.sprite.material.opacity = 0.9 * (1 - Math.abs(fp.t - 0.5) * 1.2);
      if (fp.t >= 1) { fp.active = false; fp.sprite.visible = false; }
    }

    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.t += dt * p.speed;
      if (p.start.equals(p.end)) {           // flash d'impact sur place
        p.head.material.opacity = Math.max(0, 1 - p.t);
        if (p.t >= 1) { p.active = false; p.head.visible = false; }
        continue;
      }
      const tt = Math.min(p.t, 1);
      bezier(p.start, p.ctrl, p.end, tt, this._tmp);
      p.head.position.copy(this._tmp);
      for (let i = p.trailLen - 1; i >= 1; i--) {
        p.positions[i*3]=p.positions[(i-1)*3]; p.positions[i*3+1]=p.positions[(i-1)*3+1]; p.positions[i*3+2]=p.positions[(i-1)*3+2];
      }
      p.setTrail(0, this._tmp);
      // queue de sprites échantillonnés le long de la trajectoire récente
      for (let j = 0; j < p.tail.length; j++) {
        const idx = Math.floor((j + 1) / (p.tail.length + 1) * (p.trailLen - 1));
        p.sampleTo(idx, this._tmp2);
        const s = p.tail[j];
        s.position.copy(this._tmp2);
        const f = 1 - (j + 1) / (p.tail.length + 1);
        s.scale.setScalar(p.headScale * 0.8 * f);
        s.material.opacity = 0.85 * f * f;
      }
      if (p.t >= 1) {
        p.active = false; p.head.visible = false;
        for (const s of p.tail) s.visible = false;
        if (p.onArrive) p.onArrive();
      }
    }

    for (const l of this.fluxLines) {
      if (!l.active) continue;
      l.life -= dt * 1.6;
      l.obj.material.opacity = Math.max(0, l.life) * 0.55;
      if (l.life <= 0) { l.active = false; l.obj.visible = false; }
    }

    for (const s of this.shocks) {
      if (!s.active) continue;
      s.t += dt;
      s.mesh.scale.setScalar(1 + s.t * 46);
      s.mesh.lookAt(this.camera.position);
      s.mesh.material.opacity = Math.max(0, 0.95 - s.t);
      if (s.t > 0.95) { s.active = false; s.mesh.visible = false; }
    }

    this.composer.render();
    requestAnimationFrame(() => this._animate());
  }

  _buildNebula() {
    const geo = new THREE.SphereGeometry(1800, 32, 32);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: NEBULA_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    this.scene.add(mesh);
  }

  _buildStarfield() {
    const N = reduceMotion ? 800 : 3200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 500 + Math.random() * 900;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i*3] = r * Math.sin(ph) * Math.cos(th);
      pos[i*3+1] = r * Math.cos(ph);
      pos[i*3+2] = r * Math.sin(ph) * Math.sin(th);
      const warm = Math.random();
      c.setHSL(warm > 0.7 ? 0.08 : 0.6, 0.5, 0.6 + Math.random() * 0.4);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.0, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9,
    })));
  }

  _makeLabel(text, color = 0xffffff) {
    const lines = text.split('\n');
    const c = document.createElement('canvas');
    let ctx = c.getContext('2d'); ctx.font = '600 26px ui-monospace, monospace';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    c.width = w; c.height = lines.length * 30 + 16;
    ctx = c.getContext('2d'); ctx.font = '600 26px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(6,8,18,0.66)'; roundRect(ctx, 0, 0, c.width, c.height, 8); ctx.fill();
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, 8, 8 + i * 30));
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    spr.scale.set(c.width / 26 * 1.4, c.height / 26 * 1.4, 1);
    return spr;
  }

  _farPoint() { return new THREE.Vector3((Math.random() - 0.5) * 60, 50, -210); }
  _aspect() { return this.canvas.clientWidth / this.canvas.clientHeight || 1; }
  _resizeRenderer() { this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false); }
  _resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
    this.camera.aspect = w / h || 1; this.camera.updateProjectionMatrix();
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const meshes = [...this.bodies.entries()].map(([id, b]) => { b.mesh.userData.id = id; return b.mesh; });
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit && this.onPick) this.onPick(hit.object.userData.id);
  }
}

function bezier(a, c, b, t, out) {
  const u = 1 - t;
  out.set(
    u*u*a.x + 2*u*t*c.x + t*t*b.x,
    u*u*a.y + 2*u*t*c.y + t*t*b.y,
    u*u*a.z + 2*u*t*c.z + t*t*b.z,
  );
  return out;
}

function makeGlowTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function makeFlareTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  // pointes de flare en croix
  ctx.translate(s/2, s/2);
  const spike = ctx.createLinearGradient(-s/2, 0, s/2, 0);
  spike.addColorStop(0, 'rgba(255,255,255,0)');
  spike.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  spike.addColorStop(1, 'rgba(255,255,255,0)');
  for (let k = 0; k < 2; k++) { ctx.save(); ctx.rotate(k * Math.PI / 2); ctx.fillStyle = spike; ctx.fillRect(-s/2, -1.5, s, 3); ctx.restore(); }
  return new THREE.CanvasTexture(c);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
