// Owenz Games — Subway Driver NYC
// A gentle 3D subway driving game for little conductors.

import * as THREE from 'three';
import { LINES, ROUTE_COLORS, DARK_TEXT_ROUTES } from './data.js';

/* ============================== Constants ============================== */

const SPACING = 230;          // distance between station centers
const FIRST_Z = 60;           // z of first station center
const PLATFORM_HALF = 34;     // platform half-length
const STOP_OFFSET = 30;       // train nose stops this far past station center
const CAR_LEN = 18;
const CAR_GAP = 1.2;
const NUM_CARS = 3;
const TRAIN_LEN = NUM_CARS * CAR_LEN + (NUM_CARS - 1) * CAR_GAP;

const MAX_SPEED = 20;         // m/s (~45 mph)
const ACCEL = 3.5;
const IDEAL_DECEL = 5;        // used for star scoring
const MAX_DECEL = 8;
const EMERGENCY_DECEL = 8.5;
const SCORE_ZONE = 150;       // pressing STOP within this range of stop point = scored stop

const TUNNEL_BG = new THREE.Color(0x06060e);
const SKY_BG = new THREE.Color(0x9fd9ff);
const TUNNEL_FOG = { near: 22, far: 170 };
const SKY_FOG = { near: 70, far: 700 };

/* ============================== DOM helpers ============================== */

const $ = (id) => document.getElementById(id);
const hudEl = $('hud'), menuEl = $('menu'), endEl = $('end');
const nextStopEl = $('next-stop'), towardEl = $('toward'), progressFillEl = $('progress-fill'),
      progressTextEl = $('progress-text'), speedEl = $('speed'), bannerEl = $('banner'),
      stopPanelEl = $('stop-panel'), starsBurstEl = $('stars-burst'), stopMsgEl = $('stop-msg'),
      transfersEl = $('transfers'), factEl = $('fact'),
      goBtn = $('go'), stopBtn = $('stop');

function bulletHTML(route) {
  const dark = DARK_TEXT_ROUTES.has(route) ? ' dark' : '';
  return `<span class="bullet${dark}" style="background:${ROUTE_COLORS[route]}">${route}</span>`;
}

function starsHTML(value) {
  // value 0..5, supports halves
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (value >= i) html += '<span class="star full">★</span>';
    else if (value >= i - 0.5) html += '<span class="star half">★</span>';
    else html += '<span class="star empty">★</span>';
  }
  return html;
}

/* ============================== Audio ============================== */

const SFX = {
  ctx: null, motorOsc: null, motorOsc2: null, motorGain: null, motorFilter: null,
  muted: localStorage.getItem('owenz_muted') === '1',
  voice: localStorage.getItem('owenz_voice') !== '0',

  ensure() {
    if (this.ctx || this.muted) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      this.motorGain = ctx.createGain();
      this.motorGain.gain.value = 0;
      this.motorFilter = ctx.createBiquadFilter();
      this.motorFilter.type = 'lowpass';
      this.motorFilter.frequency.value = 220;
      this.motorOsc = ctx.createOscillator();
      this.motorOsc.type = 'sawtooth';
      this.motorOsc.frequency.value = 50;
      this.motorOsc2 = ctx.createOscillator();
      this.motorOsc2.type = 'triangle';
      this.motorOsc2.frequency.value = 100;
      this.motorOsc.connect(this.motorFilter);
      this.motorOsc2.connect(this.motorFilter);
      this.motorFilter.connect(this.motorGain);
      this.motorGain.connect(ctx.destination);
      this.motorOsc.start();
      this.motorOsc2.start();
    } catch (e) { /* no audio available */ }
  },

  motor(speedRatio) {
    if (!this.ctx) return;
    const target = this.muted ? 0 : 0.035 * Math.min(1, speedRatio * 1.4);
    this.motorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    this.motorOsc.frequency.setTargetAtTime(45 + speedRatio * 90, this.ctx.currentTime, 0.1);
    this.motorOsc2.frequency.setTargetAtTime(90 + speedRatio * 260, this.ctx.currentTime, 0.1);
    this.motorFilter.frequency.setTargetAtTime(180 + speedRatio * 500, this.ctx.currentTime, 0.1);
  },

  tone(freq, t0, dur, type = 'sine', vol = 0.12) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    const start = ctx.currentTime + t0;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(start); osc.stop(start + dur + 0.05);
  },

  chime()    { this.tone(660, 0, 0.45); this.tone(523, 0.28, 0.6); },          // door chime: high then low
  ding()     { this.tone(880, 0, 0.4); },
  starPop(i) { this.tone(520 + i * 110, 0, 0.22, 'triangle', 0.1); },
  fanfare()  { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.16, 0.5, 'triangle', 0.12)); },
  hiss() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start();
  },

  say(text) {
    if (this.muted || !this.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95; u.pitch = 1.0;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  },
};

/* ============================== Texture helpers ============================== */

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function stationSignTexture(name) {
  return canvasTexture(512, 96, (g) => {
    g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 84);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 44;
    g.font = `bold ${size}px Helvetica, Arial, sans-serif`;
    while (g.measureText(name).width > 470 && size > 18) {
      size -= 2;
      g.font = `bold ${size}px Helvetica, Arial, sans-serif`;
    }
    g.fillText(name, 256, 50);
  });
}

function trainSideTexture(lineColor) {
  // One car side: stainless steel with windows and two door pairs
  return canvasTexture(1024, 192, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 192);
    grad.addColorStop(0, '#c9cdd2'); grad.addColorStop(0.5, '#aeb3ba'); grad.addColorStop(1, '#8e939a');
    g.fillStyle = grad; g.fillRect(0, 0, 1024, 192);
    // corrugation lines
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let y = 130; y < 190; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    // window band with warm lit windows + little riders
    const winY = 36, winH = 52;
    const drawWindow = (x, w) => {
      g.fillStyle = '#1a2330'; g.fillRect(x - 3, winY - 3, w + 6, winH + 6);
      g.fillStyle = '#ffe9b0'; g.fillRect(x, winY, w, winH);
      // a friendly silhouette in some windows
      if (Math.random() < 0.5) {
        g.fillStyle = '#3a4a5a';
        const px = x + 10 + Math.random() * (w - 30);
        g.beginPath(); g.arc(px + 8, winY + 26, 9, 0, Math.PI * 2); g.fill();
        g.fillRect(px, winY + 34, 16, 18);
      }
    };
    const drawDoors = (x) => {
      g.fillStyle = '#9aa0a8'; g.fillRect(x, 24, 96, 150);
      g.strokeStyle = '#5b6068'; g.lineWidth = 3;
      g.strokeRect(x, 24, 96, 150);
      g.beginPath(); g.moveTo(x + 48, 24); g.lineTo(x + 48, 174); g.stroke();
      g.fillStyle = '#1a2330'; g.fillRect(x + 10, 40, 32, 48); g.fillRect(x + 54, 40, 32, 48);
    };
    drawWindow(40, 110); drawDoors(190); drawWindow(330, 110);
    drawWindow(470, 110); drawDoors(620); drawWindow(760, 110); drawWindow(900, 90);
    // line color stripe near roof
    g.fillStyle = lineColor; g.fillRect(0, 8, 1024, 10);
  });
}

function trainFrontTexture(line) {
  return canvasTexture(256, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#c9cdd2'); grad.addColorStop(1, '#8e939a');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    // windshield band
    g.fillStyle = '#11161d'; g.fillRect(20, 40, 216, 70);
    g.fillStyle = '#2b3a4d'; g.fillRect(28, 48, 90, 54); g.fillRect(138, 48, 90, 54);
    // route bullet
    g.beginPath(); g.arc(128, 150, 34, 0, Math.PI * 2);
    g.fillStyle = line.color; g.fill();
    g.fillStyle = line.darkText ? '#111' : '#fff';
    g.font = 'bold 44px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(line.id, 128, 153);
    // headlights
    g.fillStyle = '#fff7d6';
    g.beginPath(); g.arc(48, 210, 16, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(208, 210, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#cc2222';
    g.beginPath(); g.arc(80, 212, 7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(176, 212, 7, 0, Math.PI * 2); g.fill();
  });
}

// R211 — modern car used on the A/C/E. Blue cab, wide blue stripe + gold accent, 4 wide doors/side.
function r211SideTexture(lineColor) {
  return canvasTexture(1024, 192, (g) => {
    // stainless steel body
    const grad = g.createLinearGradient(0, 0, 0, 192);
    grad.addColorStop(0, '#d0d4d9'); grad.addColorStop(0.55, '#b8bdc4'); grad.addColorStop(1, '#979da5');
    g.fillStyle = grad; g.fillRect(0, 0, 1024, 192);
    // corrugation lines
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    for (let y = 125; y < 190; y += 7) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    // wide blue stripe near roof
    g.fillStyle = lineColor; g.fillRect(0, 0, 1024, 28);
    // gold accent line below stripe
    g.fillStyle = '#f5c518'; g.fillRect(0, 28, 1024, 5);
    // tall panoramic windows (higher, bigger than older cars)
    const winY = 40, winH = 68;
    const drawWindow = (x, w) => {
      g.fillStyle = '#111820'; g.fillRect(x - 2, winY - 2, w + 4, winH + 4);
      g.fillStyle = '#c8dff5'; g.fillRect(x, winY, w, winH); // lighter blue-tinted glass
      if (Math.random() < 0.45) {
        g.fillStyle = 'rgba(30,50,70,0.7)';
        const px = x + 8 + Math.random() * (w - 28);
        g.beginPath(); g.arc(px + 8, winY + 32, 9, 0, Math.PI * 2); g.fill();
        g.fillRect(px, winY + 40, 16, 18);
      }
    };
    // wider doors (58" vs 50") — 4 per side
    const drawDoorsR211 = (x) => {
      g.fillStyle = '#8a9098'; g.fillRect(x, 18, 110, 166);
      g.strokeStyle = '#4a5058'; g.lineWidth = 2.5;
      g.strokeRect(x, 18, 110, 166);
      g.beginPath(); g.moveTo(x + 55, 18); g.lineTo(x + 55, 184); g.stroke();
      // door window
      g.fillStyle = '#111820'; g.fillRect(x + 8, 36, 42, 55); g.fillRect(x + 60, 36, 42, 55);
      g.fillStyle = '#c8dff5'; g.fillRect(x + 10, 38, 40, 53); g.fillRect(x + 62, 38, 40, 53);
      // green door indicator lights (top corners)
      g.fillStyle = '#00d060';
      g.fillRect(x + 4, 20, 8, 5); g.fillRect(x + 98, 20, 8, 5);
    };
    // layout: W D W D W D W D W  (4 doors, 5 window groups)
    drawWindow(8, 72);
    drawDoorsR211(92);
    drawWindow(214, 75);
    drawDoorsR211(301);
    drawWindow(423, 75);
    drawDoorsR211(510);
    drawWindow(632, 75);
    drawDoorsR211(719);
    drawWindow(841, 70);
  });
}

function r211FrontTexture(line) {
  return canvasTexture(256, 256, (g) => {
    // blue cab front — most distinctive R211 feature
    g.fillStyle = line.color; g.fillRect(0, 0, 256, 256);
    // lighter blue gradient to add depth
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0.18)'); grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    // wide panoramic windshield (taller, more rectangular than old cars)
    g.fillStyle = '#0a0f14'; g.fillRect(14, 28, 228, 90);
    g.fillStyle = '#1e3a50'; g.fillRect(20, 34, 100, 78); g.fillRect(136, 34, 100, 78);
    // center divider pillar
    g.fillStyle = line.color; g.fillRect(124, 28, 8, 90);
    // LED bar headlights (horizontal strips, not circles)
    g.fillStyle = '#fff9e0'; g.fillRect(18, 130, 70, 10); // left white bar
    g.fillRect(168, 130, 70, 10);                          // right white bar
    g.fillStyle = '#ff3333'; g.fillRect(30, 145, 46, 7);  // left red bar
    g.fillRect(180, 145, 46, 7);                           // right red bar
    // large LED route bullet display (center lower)
    g.beginPath(); g.arc(128, 198, 40, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fill();
    g.beginPath(); g.arc(128, 198, 36, 0, Math.PI * 2);
    g.fillStyle = line.color; g.fill();
    // bright ring around bullet (LED glow effect)
    g.strokeStyle = '#ffffff'; g.lineWidth = 3;
    g.beginPath(); g.arc(128, 198, 37, 0, Math.PI * 2); g.stroke();
    g.fillStyle = line.darkText ? '#111' : '#fff';
    g.font = 'bold 46px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(line.id, 128, 201);
  });
}

/* ============================== World building ============================== */

let renderer, scene, camera, world = null;

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  $('canvas-holder').appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 1200);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function disposeWorld() {
  if (!world) return;
  world.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
  world = null;
}

const M = {
  tunnelWall: new THREE.MeshLambertMaterial({ color: 0x2a2a33 }),
  stationWall: new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }),
  ceiling: new THREE.MeshLambertMaterial({ color: 0x32323c }),
  stationCeiling: new THREE.MeshLambertMaterial({ color: 0xcfc9bb }),
  floor: new THREE.MeshLambertMaterial({ color: 0x232328 }),
  ballast: new THREE.MeshLambertMaterial({ color: 0x3a3a40 }),
  platform: new THREE.MeshLambertMaterial({ color: 0xb9b3a6 }),
  edge: new THREE.MeshBasicMaterial({ color: 0xffd900 }),
  rail: new THREE.MeshBasicMaterial({ color: 0x9aa2ad }),
  thirdRail: new THREE.MeshLambertMaterial({ color: 0x6b5b3e }),
  tie: new THREE.MeshLambertMaterial({ color: 0x26221c }),
  column: new THREE.MeshLambertMaterial({ color: 0x1d6f5c }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  deck: new THREE.MeshLambertMaterial({ color: 0x556068 }),
  girder: new THREE.MeshLambertMaterial({ color: 0x405046 }),
  street: new THREE.MeshLambertMaterial({ color: 0x4a4f55 }),
  canopy: new THREE.MeshLambertMaterial({ color: 0x7a3030 }),
  cloud: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  dark: new THREE.MeshLambertMaterial({ color: 0x15151a }),
};

const BOX = new THREE.BoxGeometry(1, 1, 1);

function addBox(parent, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function makePerson(rng) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setHSL(rng(), 0.7, 0.55),
  });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b3550 });
  const skinTones = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
  const skin = new THREE.MeshLambertMaterial({ color: skinTones[Math.floor(rng() * skinTones.length)] });
  addBox(g, pants, 0.34, 0.6, 0.22, 0, 0.3, 0);
  addBox(g, shirt, 0.42, 0.55, 0.26, 0, 0.85, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), skin);
  head.position.y = 1.3; g.add(head);
  if (rng() < 0.4) addBox(g, shirt, 0.3, 0.08, 0.3, 0, 1.44, 0); // little cap
  return g;
}

// R211 trains (A/C/E) have a blue front; use darker charcoal roof to match
const R211_LINES = new Set(['A', 'C', 'E']);

function buildTrain(line) {
  const train = new THREE.Group();
  const isR211 = R211_LINES.has(line.id);
  const sideTex = isR211 ? r211SideTexture(line.color) : trainSideTexture(line.color);
  const sideMat = new THREE.MeshLambertMaterial({ map: sideTex });
  const frontMat = new THREE.MeshLambertMaterial({ map: isR211 ? r211FrontTexture(line) : trainFrontTexture(line) });
  const roofMat = isR211
    ? new THREE.MeshLambertMaterial({ color: 0x7a8088 })
    : new THREE.MeshLambertMaterial({ color: 0x9b9fa6 });
  const endMat = isR211
    ? new THREE.MeshLambertMaterial({ color: line.color })  // R211 ends are painted line color
    : new THREE.MeshLambertMaterial({ color: 0x8e939a });
  const bogieMat = new THREE.MeshLambertMaterial({ color: 0x16181c });

  for (let i = 0; i < NUM_CARS; i++) {
    const zc = -(i * (CAR_LEN + CAR_GAP)) - CAR_LEN / 2; // nose of train is z=0
    const mats = [sideMat, sideMat, roofMat, bogieMat, i === 0 ? frontMat : endMat, endMat];
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.6, CAR_LEN), mats);
    body.position.set(0, 1.9, zc);
    train.add(body);
    // bogies + wheels
    addBox(train, bogieMat, 2.4, 0.5, 2.6, 0, 0.45, zc + CAR_LEN / 2 - 2.4);
    addBox(train, bogieMat, 2.4, 0.5, 2.6, 0, 0.45, zc - CAR_LEN / 2 + 2.4);
  }
  // headlight glow
  const head = new THREE.PointLight(0xfff2cc, 60, 55, 1.8);
  head.position.set(0, 2.2, 2);
  train.add(head);
  return train;
}

function buildWorld(line, stations) {
  disposeWorld();
  scene = new THREE.Scene();
  scene.background = TUNNEL_BG.clone();
  scene.fog = new THREE.Fog(TUNNEL_BG.clone(), TUNNEL_FOG.near, TUNNEL_FOG.far);

  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x3a3228, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
  sun.position.set(60, 120, -40);
  scene.add(sun);

  let seed = 42;
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const stationZ = stations.map((_, i) => FIRST_Z + i * SPACING);
  const totalLen = stationZ[stationZ.length - 1] + 200;

  /* ---- track (full length) ---- */
  addBox(scene, M.ballast, 4.6, 0.5, totalLen + 200, 0, -0.3, totalLen / 2 - 100);
  addBox(scene, M.rail, 0.14, 0.18, totalLen + 200, -0.72, 0.05, totalLen / 2 - 100);
  addBox(scene, M.rail, 0.14, 0.18, totalLen + 200, 0.72, 0.05, totalLen / 2 - 100);
  addBox(scene, M.thirdRail, 0.18, 0.14, totalLen + 200, -1.5, 0.32, totalLen / 2 - 100); // third rail!

  const tieCount = Math.floor(totalLen / 3);
  const ties = new THREE.InstancedMesh(BOX, M.tie, tieCount);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < tieCount; i++) {
    mtx.makeScale(2.4, 0.12, 0.5);
    mtx.setPosition(0, -0.02, -60 + i * 3);
    ties.setMatrixAt(i, mtx);
  }
  ties.frustumCulled = false;
  scene.add(ties);

  /* ---- zones: station areas + segments between ---- */
  const isElevated = (i) => !!stations[i].el;
  const zones = []; // { z0, z1, el, stationIdx? }
  for (let i = 0; i < stations.length; i++) {
    zones.push({ z0: stationZ[i] - 45, z1: stationZ[i] + 45, el: isElevated(i), stationIdx: i });
    if (i < stations.length - 1) {
      zones.push({ z0: stationZ[i] + 45, z1: stationZ[i + 1] - 45, el: isElevated(i) && isElevated(i + 1) });
    }
  }
  zones.unshift({ z0: -80, z1: stationZ[0] - 45, el: isElevated(0) });
  zones.push({ z0: stationZ[stations.length - 1] + 45, z1: totalLen + 60, el: isElevated(stations.length - 1) });

  const lampMatrices = [], columnMatrices = [], legMatrices = [], railingMatrices = [];
  const buildingZones = [];

  for (const zn of zones) {
    const len = zn.z1 - zn.z0, mid = (zn.z0 + zn.z1) / 2;
    if (len <= 0) continue;
    const isStation = zn.stationIdx !== undefined;

    if (!zn.el) {
      // underground: floor slab, walls, ceiling
      addBox(scene, M.floor, 26, 1, len, 0, -1.0, mid);
      if (isStation) {
        addBox(scene, M.stationWall, 1, 9, len, -8, 3.5, mid);
        addBox(scene, M.stationWall, 1, 9, len, 11.5, 3.5, mid);
        addBox(scene, M.stationCeiling, 20.5, 1, len, 1.75, 7.6, mid);
        // colored mosaic stripe behind platform
        const stripe = new THREE.MeshBasicMaterial({ color: new THREE.Color(line.color) });
        addBox(scene, stripe, 0.2, 0.8, len - 10, 11.0, 4.6, mid);
      } else {
        addBox(scene, M.tunnelWall, 1, 8, len, -5, 3, mid);
        addBox(scene, M.tunnelWall, 1, 8, len, 5, 3, mid);
        addBox(scene, M.ceiling, 11, 1, len, 0, 6.8, mid);
        for (let z = zn.z0 + 10; z < zn.z1 - 5; z += 22) {
          mtx.makeScale(0.5, 0.15, 1.6); mtx.setPosition(0, 6.2, z);
          lampMatrices.push(mtx.clone());
        }
      }
    } else {
      // elevated: viaduct deck + legs + railings, open sky
      addBox(scene, M.deck, isStation ? 16 : 9, 0.8, len, isStation ? 2.5 : 0, -0.75, mid);
      for (let z = zn.z0 + 8; z < zn.z1; z += 17) {
        mtx.makeScale(0.9, 11, 0.9); mtx.setPosition(-3.2, -6.5, z); legMatrices.push(mtx.clone());
        mtx.makeScale(0.9, 11, 0.9); mtx.setPosition(3.2, -6.5, z); legMatrices.push(mtx.clone());
      }
      if (!isStation) {
        for (let z = zn.z0; z < zn.z1; z += 4) {
          mtx.makeScale(0.15, 1.1, 3.6); mtx.setPosition(-4.3, 0.4, z + 1.8); railingMatrices.push(mtx.clone());
          mtx.makeScale(0.15, 1.1, 3.6); mtx.setPosition(4.3, 0.4, z + 1.8); railingMatrices.push(mtx.clone());
        }
      }
      buildingZones.push(zn);
    }

    if (isStation) {
      const st = stations[zn.stationIdx];
      const z = stationZ[zn.stationIdx];
      // platform on the right (+x)
      addBox(scene, M.platform, 6.5, 1.2, PLATFORM_HALF * 2, 5.6, 0.55, z);
      addBox(scene, M.edge, 0.5, 0.06, PLATFORM_HALF * 2, 2.6, 1.18, z);
      // columns along the back of the platform (clear of the doors camera)
      for (let dz = -PLATFORM_HALF + 4; dz <= PLATFORM_HALF - 4; dz += 7.5) {
        mtx.makeScale(0.45, zn.el ? 3.4 : 6.4, 0.45);
        mtx.setPosition(6.8, zn.el ? 2.8 : 4.3, z + dz);
        columnMatrices.push(mtx.clone());
      }
      if (zn.el) {
        // cute canopy roof on elevated platforms
        addBox(scene, M.canopy, 7.5, 0.3, PLATFORM_HALF * 2 - 6, 5.6, 4.7, z);
      }
      // station name signs facing the track
      const signTex = stationSignTexture(st.n);
      const signMat = new THREE.MeshBasicMaterial({ map: signTex });
      for (const dz of [-16, 8, 28]) {
        // one face toward the track, one toward the platform
        for (const rot of [-Math.PI / 2, Math.PI / 2]) {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), signMat);
          sign.position.set(4.2 + (rot > 0 ? 0.03 : -0.03), 3.2, z + dz);
          sign.rotation.y = rot;
          scene.add(sign);
        }
      }
      // a couple of friendly riders waiting
      for (let p = 0; p < 2 + Math.floor(rng() * 2); p++) {
        const person = makePerson(rng);
        person.position.set(4.5 + rng() * 3, 1.15, z - PLATFORM_HALF + 6 + rng() * (PLATFORM_HALF * 2 - 12));
        person.rotation.y = Math.PI / 2 + (rng() - 0.5);
        scene.add(person);
      }
    }
  }

  const placeInstances = (matrices, mat) => {
    if (!matrices.length) return;
    const im = new THREE.InstancedMesh(BOX, mat, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.frustumCulled = false;
    scene.add(im);
  };
  placeInstances(lampMatrices, M.lamp);
  placeInstances(columnMatrices, M.column);
  placeInstances(legMatrices, M.girder);
  placeInstances(railingMatrices, M.girder);

  /* ---- elevated scenery: street, buildings, clouds ---- */
  if (buildingZones.length) {
    const buildings = [];
    for (const zn of buildingZones) {
      for (let z = zn.z0; z < zn.z1; z += 14 + rng() * 12) {
        for (const side of [-1, 1]) {
          const w = 8 + rng() * 12, h = 5 + rng() * 18, d = 8 + rng() * 10;
          const x = side * (16 + rng() * 45);
          buildings.push({ w, h, d, x, z, hue: rng() });
        }
      }
    }
    const bm = new THREE.InstancedMesh(
      BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), buildings.length);
    const col = new THREE.Color();
    buildings.forEach((b, i) => {
      mtx.makeScale(b.w, b.h, b.d);
      mtx.setPosition(b.x, -12 + b.h / 2, b.z);
      bm.setMatrixAt(i, mtx);
      col.setHSL(0.05 + b.hue * 0.55, 0.35, 0.5 + b.hue * 0.25);
      bm.setColorAt(i, col);
    });
    bm.frustumCulled = false;
    scene.add(bm);
    // street level
    for (const zn of buildingZones) {
      addBox(scene, M.street, 160, 0.5, zn.z1 - zn.z0 + 10, 0, -12.3, (zn.z0 + zn.z1) / 2);
    }
    // clouds
    for (const zn of buildingZones) {
      for (let z = zn.z0; z < zn.z1; z += 90) {
        const cloud = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(4 + rng() * 4, 7, 6), M.cloud);
          s.position.set(k * 5 - 5, rng() * 2, rng() * 3);
          s.scale.y = 0.55;
          cloud.add(s);
        }
        cloud.position.set(-40 + rng() * 80, 45 + rng() * 18, z);
        scene.add(cloud);
      }
    }
  }

  /* ---- the train ---- */
  const train = buildTrain(line);
  scene.add(train);

  /* ---- passenger pool for door animations ---- */
  const people = [];
  for (let i = 0; i < 8; i++) {
    const p = makePerson(rng);
    p.visible = false;
    scene.add(p);
    people.push(p);
  }

  world = { scene, train, stationZ, stations, line, people, hemi, envT: stations[0].el ? 1 : 0 };
  return world;
}

/* ============================== Game state ============================== */

const game = {
  state: 'menu',        // menu | ready | run | braking | doors | done
  lineId: '1',
  reversed: false,
  shortTrip: true,
  stations: [],
  stationIdx: 0,        // next station to stop at
  z: 0, v: 0,
  throttle: false,
  brakeDecel: 0,
  brakeMode: null,      // 'scored' | 'manual' | 'auto'
  pendingStars: 0,
  stars: [],
  doorTimer: 0,
  doorPhase: 0,
  camShake: 0,
  menuAngle: 0,
};

function stopPointFor(i) { return world.stationZ[i] + STOP_OFFSET; }

function setupRun() {
  const line = LINES[game.lineId];
  let sts = line.stations.slice();
  if (game.reversed) sts.reverse();
  if (game.shortTrip) sts = sts.slice(0, 6);
  game.stations = sts;
  buildWorld(line, sts);
  game.stationIdx = 1;
  game.z = stopPointFor(0);
  game.v = 0;
  game.throttle = false;
  game.brakeMode = null;
  game.stars = [];
  game.state = 'ready';

  const terminal = sts[sts.length - 1].n;
  const hb = $('hud-bullet');
  hb.className = `bullet big${line.darkText ? ' dark' : ''}`;
  hb.style.background = line.color;
  hb.textContent = line.id;
  towardEl.textContent = `to ${terminal}`;
  updateHud();
  hudEl.classList.remove('hidden');
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  stopPanelEl.classList.add('hidden');
  showBanner(`Welcome aboard the ${line.name}! Press GO!`, 3200);
  SFX.say(`Welcome aboard the ${line.id} train to ${terminal}.`);
  setGoEnabled(true);
}

function updateHud() {
  const next = game.stations[game.stationIdx];
  nextStopEl.textContent = next ? next.n : 'Last Stop!';
  progressTextEl.textContent = `Stop ${game.stationIdx} of ${game.stations.length - 1}`;
  progressFillEl.style.width = `${((game.stationIdx - 1) / (game.stations.length - 1)) * 100}%`;
}

let bannerTimeout = null;
function showBanner(text, ms = 2200) {
  bannerEl.textContent = text;
  bannerEl.classList.remove('hidden');
  bannerEl.classList.remove('pop'); void bannerEl.offsetWidth; bannerEl.classList.add('pop');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => bannerEl.classList.add('hidden'), ms);
}

function setGoEnabled(on) {
  goBtn.classList.toggle('active', game.throttle);
  goBtn.disabled = !on;
}

/* ---- driving input ---- */

function pressGo() {
  SFX.ensure();
  if (game.state === 'ready') {
    game.state = 'run';
    game.throttle = true;
    showBanner(`Next stop: ${game.stations[game.stationIdx].n}`, 2600);
    SFX.ding();
  } else if (game.state === 'run') {
    game.throttle = true;
  } else {
    return; // doors open, braking, menu, etc.
  }
  goBtn.classList.add('active');
  stopBtn.classList.remove('pulse');
}

function pressStop() {
  SFX.ensure();
  if (game.state !== 'run') return;
  game.throttle = false;
  goBtn.classList.remove('active');

  const target = stopPointFor(game.stationIdx);
  const d = target - game.z;
  const needed = (game.v * game.v) / (2 * IDEAL_DECEL);
  const r = d / needed;

  if (d > 0 && d < SCORE_ZONE && game.v > 0.5 && r <= 3.5) {
    // scored stop: compute how well-timed the press was
    game.brakeMode = 'scored';
    game.brakeDecel = Math.min(MAX_DECEL, Math.max(1.5, (game.v * game.v) / (2 * d)));
    if (r >= 0.85 && r <= 1.5) game.pendingStars = 5;
    else if (r >= 0.55 && r <= 2.3) game.pendingStars = 4;
    else game.pendingStars = 3;
    game.state = 'braking';
  } else {
    // anywhere else: just slow down and wait for another GO
    if (d > 0 && d < SCORE_ZONE && game.v > 0.5) {
      showBanner('A little early! Press GO and get closer.', 1800);
    }
    game.brakeMode = 'manual';
    game.brakeDecel = IDEAL_DECEL;
    game.state = 'braking';
  }
  stopBtn.classList.remove('pulse');
  SFX.hiss();
}

/* ---- physics ---- */

function physics(dt) {
  const target = game.stationIdx < game.stations.length ? stopPointFor(game.stationIdx) : Infinity;
  const dist = target - game.z;

  if (game.state === 'run') {
    if (game.throttle) game.v = Math.min(MAX_SPEED, game.v + ACCEL * dt);
    else game.v = Math.max(0, game.v - 0.6 * dt);

    // pulse the STOP button when entering the sweet zone
    const needed = (game.v * game.v) / (2 * IDEAL_DECEL);
    stopBtn.classList.toggle('pulse', dist > 0 && dist < needed * 1.35 + 8 && game.v > 2);

    // guardian angel auto-brake so nobody ever misses a station
    if (dist > 0 && dist <= (game.v * game.v) / (2 * EMERGENCY_DECEL) + 1.5 && game.v > 1) {
      game.throttle = false;
      goBtn.classList.remove('active');
      game.brakeMode = 'auto';
      game.brakeDecel = EMERGENCY_DECEL;
      game.pendingStars = 2;
      game.state = 'braking';
      showBanner('Auto-brake! The train helped you stop 🤖', 2000);
      SFX.hiss();
    }
  } else if (game.state === 'braking') {
    game.v = Math.max(0, game.v - game.brakeDecel * dt);
    if (game.v <= 0.05) {
      game.v = 0;
      if (game.brakeMode === 'manual') {
        // stopped between stations — that's fine, just wait for GO
        game.state = 'run';
        game.brakeMode = null;
        stopBtn.classList.remove('pulse');
        return;
      }
      const off = target - game.z;
      if (Math.abs(off) <= 1.0) {
        game.z = target;
        arriveAtStation();
      } else if (off > 0) {
        game.v = 2.2; game.brakeMode = 'creep'; game.state = 'creep'; // a bit short — roll forward
      } else {
        game.v = -1.6; game.brakeMode = 'creep'; game.state = 'creep'; // overshot — funny little roll back
        showBanner('Oops, a little far! Rolling back…', 1800);
      }
    }
  } else if (game.state === 'creep') {
    const off = target - game.z;
    if ((game.v > 0 && off <= 0.15) || (game.v < 0 && off >= -0.15)) {
      game.z = target; game.v = 0;
      arriveAtStation();
      return;
    }
  }

  game.z += game.v * dt;
}

/* ---- station arrival, doors, stars ---- */

function arriveAtStation() {
  const st = game.stations[game.stationIdx];
  const stars = game.pendingStars || 3;
  game.pendingStars = 0;
  game.brakeMode = null;
  game.stars.push(stars);
  game.state = 'doors';
  game.doorTimer = 0;
  game.doorPhase = 0;
  stopBtn.classList.remove('pulse');

  // announce
  SFX.chime();
  const msgs = { 5: 'PERFECT STOP!', 4: 'Great stop!', 3: 'Nice stop!', 2: 'Good try!' };
  stopMsgEl.textContent = `This is ${st.n}`;
  starsBurstEl.innerHTML = '';
  transfersEl.innerHTML = st.t.length
    ? `<span class="label">Change here for</span> ${st.t.map(bulletHTML).join('')}`
    : '';
  factEl.textContent = st.fact || '';
  stopPanelEl.classList.remove('hidden');
  showBanner(msgs[stars], 2000);
  SFX.say(`This is ${st.n}.`);

  // pop the stars in one at a time
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      if (game.state !== 'doors' && game.state !== 'done') return;
      const s = document.createElement('span');
      s.className = 'star ' + (i < stars ? 'full' : 'empty');
      s.textContent = '★';
      starsBurstEl.appendChild(s);
      if (i < stars) SFX.starPop(i);
    }, 350 + i * 220);
  }

  spawnDoorPeople();
  setGoEnabled(false);
}

function spawnDoorPeople() {
  const doorZ = [-3, -12, -22, -31]; // door spots along the train (nose at z offset 0)
  world.people.forEach((p, i) => {
    const out = i < 5;
    const dz = doorZ[i % doorZ.length] + (i > 3 ? 1.5 : 0);
    p.visible = true;
    p.userData = {
      t: -0.2 - i * 0.25,
      out,
      z: game.z + dz,
    };
    p.position.set(out ? 1.7 : 6.5, 1.15, p.userData.z);
    p.rotation.y = out ? Math.PI / 2 : -Math.PI / 2;
  });
}

function animatePeople(dt) {
  world.people.forEach((p) => {
    if (!p.visible || p.userData.t === undefined) return;
    p.userData.t += dt * 0.55;
    const t = p.userData.t;
    if (t < 0) return;
    if (t > 1) { p.visible = false; return; }
    const from = p.userData.out ? 1.7 : 6.5;
    const to = p.userData.out ? 6.0 : 1.7;
    p.position.x = from + (to - from) * t;
    p.position.y = 1.15 + Math.abs(Math.sin(t * 18)) * 0.07; // little walk bounce
  });
}

function doorsLogic(dt) {
  game.doorTimer += dt;
  if (game.doorPhase === 0 && game.doorTimer > 4.2) {
    game.doorPhase = 1;
    const isLast = game.stationIdx >= game.stations.length - 1;
    if (!isLast) {
      showBanner('Stand clear of the closing doors, please!', 2200);
      SFX.say('Stand clear of the closing doors, please.');
      SFX.chime();
    }
  } else if (game.doorPhase === 1 && game.doorTimer > 6.2) {
    stopPanelEl.classList.add('hidden');
    const isLast = game.stationIdx >= game.stations.length - 1;
    if (isLast) { finishRun(); return; }
    game.stationIdx += 1;
    game.state = 'ready';
    updateHud();
    setGoEnabled(true);
    goBtn.classList.add('pulse-go');
    setTimeout(() => goBtn.classList.remove('pulse-go'), 3000);
  }
}

/* ---- finish + 5-star rating ---- */

function finishRun() {
  game.state = 'done';
  const avg = game.stars.reduce((a, b) => a + b, 0) / game.stars.length;
  const rating = Math.round(avg * 2) / 2;
  const line = LINES[game.lineId];

  const key = `owenz_subway_best_${game.lineId}`;
  const best = Math.max(rating, parseFloat(localStorage.getItem(key) || '0'));
  localStorage.setItem(key, String(best));

  $('end-title').textContent = 'You did it!';
  $('end-sub').textContent =
    `You drove the ${line.name} all the way to ${game.stations[game.stations.length - 1].n}!`;
  $('end-stars').innerHTML = starsHTML(rating);
  $('end-rating').textContent = `Your trip rating: ${rating} out of 5 stars`;
  $('end-best').textContent = best > rating ? `Your best on the ${line.name}: ${best} ★` : 'New best score! 🎉';

  const confetti = $('confetti');
  confetti.innerHTML = '';
  const colors = ['#EE352E', '#FCCC0A', '#0039A6', '#FF6319', '#00933C', '#B933AD'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 2.5 + 's';
    c.style.animationDuration = 2.5 + Math.random() * 2 + 's';
    confetti.appendChild(c);
  }
  endEl.classList.remove('hidden');
  SFX.fanfare();
  SFX.say('Hooray! You did it!');
}

/* ============================== Camera & environment ============================== */

const camPos = new THREE.Vector3(5, 8, -30);
const camLook = new THREE.Vector3(0, 2, 0);
const tmpV = new THREE.Vector3();

function envStyleAt(z) {
  // 1 = open sky, 0 = tunnel; based on nearest station / segment
  const i = Math.round((z - FIRST_Z) / SPACING);
  const a = Math.max(0, Math.min(game.stations.length - 1, i));
  const frac = (z - FIRST_Z) / SPACING - a;
  const b = Math.max(0, Math.min(game.stations.length - 1, frac > 0 ? a + 1 : a - 1));
  const elA = game.stations[a].el ? 1 : 0;
  const elB = game.stations[b].el ? 1 : 0;
  return Math.abs(frac) < 0.22 ? elA : Math.min(elA, elB);
}

function updateCameraAndEnv(dt) {
  const z = game.z;
  let targetPos, targetLook;
  if (game.state === 'menu') {
    // slow close-up orbit around the parked train, staying inside the station
    game.menuAngle += dt * 0.18;
    const r = 6.5;
    targetPos = tmpV.set(Math.sin(game.menuAngle) * r, 4.2 + Math.sin(game.menuAngle * 0.7) * 1.2,
      z - 10 + Math.cos(game.menuAngle) * r).clone();
    targetLook = new THREE.Vector3(0, 2.2, z - 10);
  } else if (game.state === 'doors' || game.state === 'done') {
    // stand on the platform ahead of the nose, looking back along the train
    targetPos = new THREE.Vector3(6.0, 4.0, z + 12);
    targetLook = new THREE.Vector3(0, 2, z - 16);
  } else {
    // chase cam over the right shoulder of the train, inside the tunnel bore
    targetPos = new THREE.Vector3(2.6, 5.2, z - 24);
    targetLook = new THREE.Vector3(0, 2.2, z + 14);
  }
  const k = game.state === 'menu' ? 1 : 1 - Math.pow(0.0015, dt);
  camPos.lerp(targetPos, k);
  camLook.lerp(targetLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // gentle sway while moving
  if (game.v > 1) {
    camera.position.y += Math.sin(performance.now() * 0.004) * 0.05 * (game.v / MAX_SPEED);
    camera.position.x += Math.sin(performance.now() * 0.0027) * 0.06 * (game.v / MAX_SPEED);
  }

  // sky / tunnel blend
  const targetEnv = envStyleAt(z + 18);
  world.envT += (targetEnv - world.envT) * Math.min(1, dt * 1.6);
  const t = world.envT;
  scene.background.copy(TUNNEL_BG).lerp(SKY_BG, t);
  scene.fog.color.copy(scene.background);
  scene.fog.near = TUNNEL_FOG.near + (SKY_FOG.near - TUNNEL_FOG.near) * t;
  scene.fog.far = TUNNEL_FOG.far + (SKY_FOG.far - TUNNEL_FOG.far) * t;
  world.hemi.intensity = 1.0 + t * 0.6;
}

/* ============================== Main loop ============================== */

let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!world) return;

  if (game.state === 'run' || game.state === 'braking' || game.state === 'creep') physics(dt);
  if (game.state === 'doors') doorsLogic(dt);
  animatePeople(dt);

  world.train.position.z = game.z;
  world.train.position.y = game.v > 1 ? Math.sin(performance.now() * 0.006) * 0.02 : 0;

  SFX.motor(Math.abs(game.v) / MAX_SPEED);
  const mph = Math.round(Math.abs(game.v) * 2.237);
  speedEl.textContent = `${mph} mph`;

  updateCameraAndEnv(dt);
  renderer.render(scene, camera);
}

/* ============================== Menu wiring ============================== */

function renderMenu() {
  // line cards
  document.querySelectorAll('.line-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.line === game.lineId);
  });
  const line = LINES[game.lineId];
  // direction buttons
  const fwd = $('dir-fwd'), rev = $('dir-rev');
  fwd.innerHTML = `<small>${line.dirLabels[1]}</small>to ${line.termini[1]}`;
  rev.innerHTML = `<small>${line.dirLabels[0]}</small>to ${line.termini[0]}`;
  fwd.classList.toggle('selected', !game.reversed);
  rev.classList.toggle('selected', game.reversed);
  $('trip-short').classList.toggle('selected', game.shortTrip);
  $('trip-full').classList.toggle('selected', !game.shortTrip);
  $('trip-short').innerHTML = `<small>Short ride</small>5 stops`;
  $('trip-full').innerHTML = `<small>Whole line!</small>${line.stations.length - 1} stops`;

  const best = parseFloat(localStorage.getItem(`owenz_subway_best_${game.lineId}`) || '0');
  $('menu-best').innerHTML = best > 0 ? `Best ${line.name} rating: ${starsHTML(best)}` : '';
}

function showMenu() {
  game.state = 'menu';
  game.throttle = false; game.v = 0;
  menuEl.classList.remove('hidden');
  hudEl.classList.add('hidden');
  endEl.classList.add('hidden');
  stopPanelEl.classList.add('hidden');
  renderMenu();
  // pretty backdrop: park the chosen train at its first station
  const line = LINES[game.lineId];
  let sts = line.stations.slice();
  if (game.reversed) sts.reverse();
  game.stations = sts.slice(0, 3);
  buildWorld(line, game.stations);
  game.z = stopPointFor(0);
}

function wireUI() {
  document.querySelectorAll('.line-card').forEach((card) => {
    card.addEventListener('click', () => {
      game.lineId = card.dataset.line;
      SFX.ensure(); SFX.ding();
      showMenu(); // rebuild backdrop with new train
    });
  });
  $('dir-fwd').addEventListener('click', () => { game.reversed = false; renderMenu(); });
  $('dir-rev').addEventListener('click', () => { game.reversed = true; renderMenu(); });
  $('trip-short').addEventListener('click', () => { game.shortTrip = true; renderMenu(); });
  $('trip-full').addEventListener('click', () => { game.shortTrip = false; renderMenu(); });
  $('start').addEventListener('click', () => { SFX.ensure(); setupRun(); });

  const press = (el, fn) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  };
  press(goBtn, pressGo);
  press(stopBtn, pressStop);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Enter') { e.preventDefault(); pressGo(); }
    if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'Space') { e.preventDefault(); pressStop(); }
  });

  $('btn-menu').addEventListener('click', () => { window.speechSynthesis?.cancel(); showMenu(); });
  $('again').addEventListener('click', () => setupRun());
  $('pick-train').addEventListener('click', () => showMenu());

  const muteBtn = $('btn-mute'), voiceBtn = $('btn-voice');
  const syncToggles = () => {
    muteBtn.textContent = SFX.muted ? '🔇' : '🔊';
    voiceBtn.textContent = SFX.voice ? '🗣️' : '🤐';
    voiceBtn.style.display = ('speechSynthesis' in window) ? '' : 'none';
  };
  muteBtn.addEventListener('click', () => {
    SFX.muted = !SFX.muted;
    localStorage.setItem('owenz_muted', SFX.muted ? '1' : '0');
    if (!SFX.muted) SFX.ensure();
    syncToggles();
  });
  voiceBtn.addEventListener('click', () => {
    SFX.voice = !SFX.voice;
    localStorage.setItem('owenz_voice', SFX.voice ? '1' : '0');
    if (!SFX.voice) window.speechSynthesis?.cancel();
    syncToggles();
  });
  syncToggles();
}

/* ============================== Boot ============================== */

initRenderer();
wireUI();
showMenu();
requestAnimationFrame(loop);
