// The 3D stadium: pitch, possession territory + donut, shot arcs, key-moment
// timeline, stat towers and a floating scoreboard.
import * as THREE from '../vendor/three/build/three.module.js';
import { OrbitControls } from '../vendor/three/examples/jsm/controls/OrbitControls.js';

const L = 105; // pitch length (m)
const W = 68; // pitch width (m)
const HALF_L = L / 2;
const HALF_W = W / 2;
const GOAL_W = 7.32;
const GOAL_H = 2.44;
const TIMELINE_Z = HALF_W + 6;
const TOWERS_Z = -HALF_W - 12;

const CAMERA_VIEWS = {
  broadcast: { pos: [0, 90, 118], target: [0, 9, 0] },
  top: { pos: [0, 150, 0.1], target: [0, 0, 0] },
  goal: { pos: [HALF_L + 40, 20, 0], target: [5, 0, 0] },
  timeline: { pos: [0, 34, TIMELINE_Z + 80], target: [0, 3, TIMELINE_Z] },
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const minuteToX = (minute) => -HALF_L + (Math.min(minute, 96) / 96) * L;

export class StadiumScene {
  constructor(container, { onHover } = {}) {
    this.container = container;
    this.onHover = onHover;
    this.tweens = [];
    this.flights = [];
    this.confetti = null;
    this.seenShots = new Set();
    this.autoRotate = false;
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070b16');
    this.scene.fog = new THREE.Fog('#070b16', 220, 600);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1200);
    this.view = 'broadcast';
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 450;
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.buildEnvironment();
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-10, -10);
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerClient = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener('pointerleave', () => {
      this.pointer.set(-10, -10);
      this.onHover?.(null);
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.setView(this.view, 0);
  }

  /** Narrow screens need the camera further back to fit the pitch. */
  viewPose(name) {
    const v = CAMERA_VIEWS[name];
    const target = new THREE.Vector3(...v.target);
    const k = Math.max(1, Math.pow(1.5 / this.camera.aspect, 0.85));
    const pos = new THREE.Vector3(...v.pos).sub(target).multiplyScalar(k).add(target);
    return { pos, target };
  }

  // ---------------------------------------------------------------- static world
  buildEnvironment() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#bcd4ff', '#16301a', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-40, 90, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 70, bottom: -70, far: 260 });
    s.add(sun);

    // Surround + pitch
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 70, W + 60),
      new THREE.MeshStandardMaterial({ color: '#0f2a17', roughness: 1 }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.05;
    surround.receiveShadow = true;
    s.add(surround);

    const pitchTex = new THREE.CanvasTexture(drawPitchCanvas());
    pitchTex.colorSpace = THREE.SRGBColorSpace;
    pitchTex.anisotropy = 8;
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    s.add(pitch);

    for (const dir of [1, -1]) s.add(buildGoal(dir));

    // Floodlight towers for atmosphere
    for (const [x, z] of [[-70, -50], [70, -50], [-70, 50], [70, 50]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 40), new THREE.MeshStandardMaterial({ color: '#39424f' }));
      pole.position.set(x, 20, z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 1), new THREE.MeshBasicMaterial({ color: '#fffbe6' }));
      lamp.position.set(x, 41, z);
      lamp.lookAt(0, 0, 0);
      s.add(pole, lamp);
    }

    // Starfield-ish backdrop
    const pts = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const r = 260 + Math.random() * 40;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.45;
      pts.set([r * Math.cos(th) * Math.sin(ph), r * Math.cos(ph) * 0.6 + 20, r * Math.sin(th) * Math.sin(ph)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    s.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#8fa8ff', size: 0.9, fog: false })));
  }

  // ---------------------------------------------------------------- public API
  /** Render a match. `fresh` resets everything (new match); otherwise only new shots animate. */
  setMatch(match, { fresh = true } = {}) {
    if (fresh) this.seenShots.clear();
    this.match = match;
    this.disposeGroup(this.dynamic);
    this.flights = [];
    this.hoverables = [];

    const home = new THREE.Color(match.home.color);
    const away = new THREE.Color(match.away.color);
    const poss = match.stats?.home?.possession ?? 50;

    this.buildPossession(poss, home, away, fresh);
    this.buildScoreboard(match);
    this.buildShots(match, home, away);
    this.buildTimeline(match, home, away);
    this.buildTowers(match, home, away, fresh);
  }

  setView(name, ms = 1200) {
    if (!CAMERA_VIEWS[name]) return;
    this.view = name;
    this.userMoved = false;
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const { pos: toPos, target: toTarget } = this.viewPose(name);
    if (!ms) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      return;
    }
    this.tween(ms, (t) => {
      this.camera.position.lerpVectors(fromPos, toPos, t);
      this.controls.target.lerpVectors(fromTarget, toTarget, t);
    });
  }

  setAutoRotate(on) {
    this.autoRotate = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.6;
  }

  /** Goal celebration: confetti in the scoring team's colour and a camera shake. */
  celebrate(side) {
    const color = new THREE.Color(this.match?.[side]?.color || '#ffd54a');
    const count = 500;
    if (this.confetti) this.disposeObject(this.confetti.mesh);
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.7, 0.4),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      count,
    );
    const goalX = side === 'home' ? HALF_L : -HALF_L;
    const parts = [];
    const gold = new THREE.Color('#ffd54a');
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < count; i++) {
      parts.push({
        p: new THREE.Vector3(goalX, 3, (Math.random() - 0.5) * 6),
        v: new THREE.Vector3(-Math.sign(goalX) * Math.random() * 22, 18 + Math.random() * 22, (Math.random() - 0.5) * 30),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
        spin: Math.random() * 8,
      });
      mesh.setColorAt(i, [color, gold, white][i % 3]);
    }
    this.scene.add(mesh);
    this.confetti = { mesh, parts, age: 0 };
    this.shake = 0.8;
  }

  // ---------------------------------------------------------------- builders
  buildPossession(poss, home, away, animate) {
    const group = new THREE.Group();
    this.dynamic.add(group);

    // Territory: each side's colour floods the pitch in proportion to possession.
    const homeMat = new THREE.MeshBasicMaterial({ color: home, transparent: true, opacity: 0.22, depthWrite: false });
    const awayMat = new THREE.MeshBasicMaterial({ color: away, transparent: true, opacity: 0.22, depthWrite: false });
    const homePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, W), homeMat);
    const awayPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, W), awayMat);
    for (const p of [homePlane, awayPlane]) {
      p.rotation.x = -Math.PI / 2;
      p.position.y = 0.03;
      group.add(p);
    }
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 4, W),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    wall.position.y = 2;
    group.add(wall);

    // Floating possession donut above the centre circle
    const donut = new THREE.Group();
    donut.position.set(0, 15, 0);
    donut.rotation.x = -Math.PI / 2.6;
    group.add(donut);
    this.donut = donut;
    const homeLabel = makeLabel('', { size: 46, color: '#fff', bg: home.getStyle() });
    const awayLabel = makeLabel('', { size: 46, color: '#fff', bg: away.getStyle() });
    homeLabel.position.set(-17, 15, 0);
    awayLabel.position.set(17, 15, 0);
    group.add(homeLabel, awayLabel);
    const title = makeLabel('POSSESSION', { size: 22, color: '#cfd8ff' });
    title.position.set(0, 7.5, 6);
    group.add(title);

    const apply = (p) => {
      const split = -HALF_L + (p / 100) * L;
      homePlane.scale.x = split + HALF_L;
      homePlane.position.x = (-HALF_L + split) / 2;
      awayPlane.scale.x = HALF_L - split;
      awayPlane.position.x = (split + HALF_L) / 2;
      wall.position.x = split;
      this.disposeGroup(donut);
      const homeArc = Math.max(0.01, (p / 100) * Math.PI * 2);
      const awayArc = Math.max(0.01, Math.PI * 2 - homeArc);
      const hm = new THREE.Mesh(new THREE.TorusGeometry(6, 1.6, 20, 96, homeArc), new THREE.MeshStandardMaterial({ color: home, emissive: home, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 }));
      const am = new THREE.Mesh(new THREE.TorusGeometry(6, 1.6, 20, 96, awayArc), new THREE.MeshStandardMaterial({ color: away, emissive: away, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 }));
      am.rotation.z = homeArc;
      hm.castShadow = am.castShadow = true;
      donut.add(hm, am);
      updateLabel(homeLabel, `${Math.round(p)}%`);
      updateLabel(awayLabel, `${Math.round(100 - p)}%`);
    };

    const from = animate ? 50 : this.lastPossession ?? poss;
    this.lastPossession = poss;
    if (from === poss) apply(poss);
    else this.tween(1400, (t) => apply(from + (poss - from) * t));
  }

  buildScoreboard(m) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, m.home.color);
    grad.addColorStop(0.32, '#0b1020');
    grad.addColorStop(0.68, '#0b1020');
    grad.addColorStop(1, m.away.color);
    roundRect(ctx, 6, 6, 1012, 244, 36);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 12;
    ctx.fillText(m.home.abbr, 160, 118);
    ctx.fillText(m.away.abbr, 864, 118);
    ctx.font = '900 130px system-ui, sans-serif';
    ctx.fillText(`${m.home.score} – ${m.away.score}`, 512, 112);
    ctx.font = '700 40px system-ui, sans-serif';
    const status = m.status === 'LIVE' ? `● LIVE ${m.clockLabel || `${m.minute}'`}` : m.status === 'FT' ? 'FULL TIME' : 'UPCOMING';
    ctx.fillStyle = m.status === 'LIVE' ? '#ff5b6e' : '#cfd8ff';
    ctx.fillText(status, 512, 212);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sprite.scale.set(32, 8, 1);
    sprite.position.set(0, 44, -14);
    this.dynamic.add(sprite);
    this.scoreboard = sprite;
  }

  buildShots(m, home, away) {
    const gold = new THREE.Color('#ffd54a');
    let delay = 0;
    for (const shot of m.shots) {
      const key = `${shot.team}-${shot.minute}-${shot.x.toFixed(2)}-${shot.z.toFixed(2)}`;
      const isNew = !this.seenShots.has(key);
      this.seenShots.add(key);
      const color = shot.goal ? gold : shot.team === 'home' ? home : away;
      const dir = shot.team === 'home' ? 1 : -1;
      const start = new THREE.Vector3(shot.x, 0.35, shot.z);
      const r = shot.seed ?? 0.5;
      let end;
      if (shot.onTarget) {
        end = new THREE.Vector3(dir * (HALF_L + 0.6), 0.3 + r * (GOAL_H - 0.6), (r - 0.5) * (GOAL_W - 1));
      } else {
        const wide = r > 0.35;
        end = new THREE.Vector3(
          dir * (HALF_L + 3),
          wide ? 0.5 + r * 2 : GOAL_H + 1 + r * 3,
          wide ? Math.sign(r - 0.67 || 1) * (GOAL_W / 2 + 1 + r * 5) : (r - 0.5) * 6,
        );
      }
      const mid = start.clone().lerp(end, 0.5);
      mid.y += 2 + start.distanceTo(end) * 0.12;
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);

      const tubeMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: shot.goal ? 0.9 : 0.4,
        transparent: true, opacity: shot.goal ? 0.95 : shot.onTarget ? 0.75 : 0.4,
      });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, shot.goal ? 0.22 : 0.12, 8), tubeMat);
      tube.userData.tip = shotTip(m, shot);
      this.dynamic.add(tube);
      this.hoverables.push(tube);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, shot.goal ? 1.3 : 0.9, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(shot.x, 0.06, shot.z);
      ring.userData.pulse = shot.goal;
      this.dynamic.add(ring);

      if (isNew) {
        // Draw the arc progressively and fly a ball along it.
        tube.geometry.setDrawRange(0, 0);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }));
        ball.castShadow = true;
        ball.visible = false;
        this.dynamic.add(ball);
        this.flights.push({ curve, ball, tube, delay, t: 0, goal: shot.goal, team: shot.team });
        delay += 0.12;
      }
    }
  }

  buildTimeline(m, home, away) {
    const group = new THREE.Group();
    this.dynamic.add(group);
    const track = new THREE.Mesh(new THREE.BoxGeometry(L, 0.3, 0.8), new THREE.MeshStandardMaterial({ color: '#2b3550', emissive: '#1b2240' }));
    track.position.set(0, 0.15, TIMELINE_Z);
    group.add(track);
    for (const min of [0, 15, 30, 45, 60, 75, 90]) {
      const tick = makeLabel(`${min}'`, { size: 28, color: '#9fb0d8' });
      tick.position.set(minuteToX(min), 1.2, TIMELINE_Z + 3.2);
      tick.scale.multiplyScalar(0.55);
      group.add(tick);
    }
    const title = makeLabel('KEY MOMENTS', { size: 30, color: '#cfd8ff' });
    title.position.set(-HALF_L - 9, 1.6, TIMELINE_Z);
    title.scale.multiplyScalar(0.8);
    group.add(title);

    // Playhead (where the match is now)
    const now = m.status === 'FT' ? Math.max(90, m.minute) : m.minute;
    if (m.status !== 'UPCOMING') {
      const progress = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.01, minuteToX(now) + HALF_L), 0.35, 0.9),
        new THREE.MeshStandardMaterial({ color: '#4b7bff', emissive: '#4b7bff', emissiveIntensity: 0.6 }),
      );
      progress.position.set((-HALF_L + minuteToX(now)) / 2, 0.2, TIMELINE_Z);
      group.add(progress);
      if (m.status === 'LIVE') {
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff5b6e' }));
        head.position.set(minuteToX(now), 0.6, TIMELINE_Z);
        head.userData.pulse = true;
        group.add(head);
      }
    }

    const stackAt = new Map();
    for (const e of m.events) {
      const x = minuteToX(e.minute);
      const bucket = `${Math.round(x / 3)}-${e.team}`;
      const stack = stackAt.get(bucket) || 0;
      stackAt.set(bucket, stack + 1);
      const z = TIMELINE_Z + (e.team === 'home' ? -1.4 : e.team === 'away' ? 1.4 : 0);
      const teamColor = e.team === 'home' ? home : e.team === 'away' ? away : new THREE.Color('#ffffff');
      const isGoal = e.type === 'goal' || e.type === 'penalty' || e.type === 'own-goal';
      const height = (isGoal ? 7 : e.type === 'red' || e.type === 'yellow' ? 4 : e.type === 'sub' ? 2.6 : 3) + stack * 2.2;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, height), new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 0.4 }));
      pole.position.set(x, height / 2, z);
      group.add(pole);

      let marker;
      if (isGoal) {
        marker = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd54a', emissiveIntensity: 0.5, flatShading: true }));
        marker.userData.spin = 1.5;
        const lbl = makeLabel(`${e.score?.[0] ?? ''}–${e.score?.[1] ?? ''}`, { size: 34, color: '#fff', bg: teamColor.getStyle() });
        lbl.position.set(x, height + 2.6, z);
        lbl.scale.multiplyScalar(0.6);
        group.add(lbl);
      } else if (e.type === 'yellow' || e.type === 'red') {
        marker = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.7, 0.12), new THREE.MeshStandardMaterial({ color: e.type === 'yellow' ? '#ffd400' : '#e8202f', emissive: e.type === 'yellow' ? '#5a4a00' : '#4a0008' }));
        marker.userData.spin = 2.2;
      } else if (e.type === 'sub') {
        marker = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 16), new THREE.MeshStandardMaterial({ color: '#33d17a', emissive: '#0d4a26' }));
        marker.userData.spin = 1;
      } else {
        marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#555' }));
        const lbl = makeLabel(e.label, { size: 30, color: '#fff' });
        lbl.position.set(x, height + 2, z);
        lbl.scale.multiplyScalar(0.5);
        group.add(lbl);
      }
      marker.position.set(x, height + 0.6, z);
      marker.castShadow = true;
      marker.userData.tip = eventTip(m, e);
      group.add(marker);
      this.hoverables.push(marker);
    }
  }

  buildTowers(m, home, away, animate) {
    const s = m.stats;
    if (!s) return;
    const group = new THREE.Group();
    group.position.z = TOWERS_Z;
    this.dynamic.add(group);
    const metrics = [
      ['Shots', s.home.shots, s.away.shots],
      ['On target', s.home.shotsOnTarget, s.away.shotsOnTarget],
      ['Corners', s.home.corners, s.away.corners],
      ['Passes', s.home.passes, s.away.passes],
      ['Pass %', s.home.passAccuracy, s.away.passAccuracy],
      ['Fouls', s.home.fouls, s.away.fouls],
      ['Cards', s.home.yellow + s.home.red, s.away.yellow + s.away.red],
    ];
    const spacing = 15;
    metrics.forEach(([name, hv, av], i) => {
      const x = (i - (metrics.length - 1) / 2) * spacing;
      const max = Math.max(hv, av, 1);
      [[hv, home, -2.2], [av, away, 2.2]].forEach(([v, color, dx]) => {
        const h = Math.max(0.15, (v / max) * 12);
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.5 });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1, 3.6), mat);
        tower.castShadow = true;
        tower.position.x = x + dx;
        tower.userData.tip = `<b>${name}</b><br>${m.home.abbr} ${hv} · ${m.away.abbr} ${av}`;
        group.add(tower);
        this.hoverables.push(tower);
        const lbl = makeLabel(String(v), { size: 34, color: '#fff' });
        lbl.scale.multiplyScalar(0.5);
        group.add(lbl);
        const set = (hh) => {
          tower.scale.y = hh;
          tower.position.y = hh / 2;
          lbl.position.set(x + dx, hh + 1.6, 0);
        };
        if (animate) this.tween(1200 + i * 120, (t) => set(Math.max(0.01, h * t)));
        else set(h);
      });
      const label = makeLabel(name.toUpperCase(), { size: 28, color: '#cfd8ff' });
      label.scale.multiplyScalar(0.6);
      label.position.set(x, 0.8, 4.5);
      group.add(label);
    });
  }

  // ---------------------------------------------------------------- loop
  tween(ms, fn) {
    this.tweens.push({ ms, fn, start: performance.now() });
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();
    const elapsed = this.clock.elapsedTime;

    this.tweens = this.tweens.filter((tw) => {
      const t = Math.min(1, (now - tw.start) / tw.ms);
      tw.fn(easeOutCubic(t));
      return t < 1;
    });

    if (this.donut) this.donut.rotation.z += dt * 0.25;
    if (this.scoreboard) this.scoreboard.position.y = 44 + Math.sin(elapsed * 1.2) * 0.5;

    this.dynamic.traverse((o) => {
      if (o.userData.spin) o.rotation.y += dt * o.userData.spin;
      if (o.userData.pulse) {
        const k = 1 + Math.sin(elapsed * 4) * 0.25;
        o.scale.set(k, k, k);
      }
    });

    for (const f of this.flights) {
      if (f.done) continue;
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.ball.visible = true;
      f.t = Math.min(1, f.t + dt * 1.1);
      f.ball.position.copy(f.curve.getPoint(f.t));
      f.ball.rotation.x += dt * 12;
      const idx = f.tube.geometry.index;
      f.tube.geometry.setDrawRange(0, Math.floor((idx ? idx.count : Infinity) * f.t));
      if (f.t >= 1) {
        f.done = true;
        f.ball.visible = false;
      }
    }

    if (this.confetti) {
      const c = this.confetti;
      c.age += dt;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      c.parts.forEach((p, i) => {
        p.v.y -= 25 * dt;
        p.v.multiplyScalar(0.99);
        p.p.addScaledVector(p.v, dt);
        if (p.p.y < 0.1) { p.p.y = 0.1; p.v.set(0, 0, 0); }
        p.r.x += p.spin * dt;
        p.r.y += p.spin * dt * 0.7;
        c.mesh.setMatrixAt(i, m4.compose(p.p, q.setFromEuler(p.r), one));
      });
      c.mesh.instanceMatrix.needsUpdate = true;
      if (c.age > 6) {
        this.disposeObject(c.mesh);
        this.confetti = null;
      }
    }

    this.controls.update();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }

    this.updateHover();
    this.renderer.render(this.scene, this.camera);
  }

  updateHover() {
    if (!this.hoverables?.length || this.pointer.x < -1.5) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hoverables, false)[0];
    if (hit?.object !== this.hovered) {
      if (this.hovered?.material?.emissiveIntensity !== undefined) this.hovered.material.emissiveIntensity = this.hovered.userData.baseEmissive;
      this.hovered = hit?.object || null;
      if (this.hovered?.material?.emissiveIntensity !== undefined) {
        this.hovered.userData.baseEmissive = this.hovered.material.emissiveIntensity;
        this.hovered.material.emissiveIntensity = 1.2;
      }
    }
    this.onHover?.(this.hovered ? { html: this.hovered.userData.tip, ...this.pointerClient } : null);
  }

  // ---------------------------------------------------------------- cleanup
  disposeGroup(group) {
    for (const child of [...group.children]) this.disposeObject(child);
  }

  disposeObject(obj) {
    obj.removeFromParent();
    obj.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}

// ------------------------------------------------------------------ helpers
function drawPitchCanvas() {
  const S = 20;
  const c = document.createElement('canvas');
  c.width = L * S;
  c.height = W * S;
  const ctx = c.getContext('2d');
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2f8a3f' : '#35994a';
    ctx.fillRect((i * c.width) / stripes, 0, c.width / stripes + 1, c.height);
  }
  const px = (x) => (x + HALF_L) * S;
  const py = (z) => (z + HALF_W) * S;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 0.14 * S;
  const rect = (x1, z1, x2, z2) => ctx.strokeRect(px(x1), py(z1), px(x2) - px(x1), py(z2) - py(z1));
  const spot = (x, z) => { ctx.beginPath(); ctx.arc(px(x), py(z), 0.25 * S, 0, Math.PI * 2); ctx.fill(); };
  const inset = 0.1;
  rect(-HALF_L + inset, -HALF_W + inset, HALF_L - inset, HALF_W - inset);
  ctx.beginPath(); ctx.moveTo(px(0), py(-HALF_W)); ctx.lineTo(px(0), py(HALF_W)); ctx.stroke();
  ctx.beginPath(); ctx.arc(px(0), py(0), 9.15 * S, 0, Math.PI * 2); ctx.stroke();
  spot(0, 0);
  for (const d of [-1, 1]) {
    const gx = d * HALF_L;
    rect(Math.min(gx, gx - d * 16.5), -20.16, Math.max(gx, gx - d * 16.5), 20.16);
    rect(Math.min(gx, gx - d * 5.5), -9.16, Math.max(gx, gx - d * 5.5), 9.16);
    spot(gx - d * 11, 0);
    const a = Math.acos(5.5 / 9.15);
    ctx.beginPath();
    if (d === 1) ctx.arc(px(gx - 11), py(0), 9.15 * S, Math.PI - a, Math.PI + a);
    else ctx.arc(px(gx + 11), py(0), 9.15 * S, -a, a);
    ctx.stroke();
    for (const e of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(px(gx), py(e * HALF_W), 1 * S, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return c;
}

function buildGoal(dir) {
  const g = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
  const r = 0.12;
  const add = (geo, x, y, z, rot) => {
    const m = new THREE.Mesh(geo, post);
    m.position.set(x, y, z);
    if (rot) m.rotation.x = rot;
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.CylinderGeometry(r, r, GOAL_H), 0, GOAL_H / 2, -GOAL_W / 2);
  add(new THREE.CylinderGeometry(r, r, GOAL_H), 0, GOAL_H / 2, GOAL_W / 2);
  add(new THREE.CylinderGeometry(r, r, GOAL_W), 0, GOAL_H, 0, Math.PI / 2);
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(2, GOAL_H, GOAL_W, 6, 6, 12),
    new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.25 }),
  );
  net.position.set(dir * 1, GOAL_H / 2, 0);
  g.add(net);
  g.position.x = dir * HALF_L;
  return g;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeLabel(text, opts = {}) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
  sprite.userData.opts = opts;
  updateLabel(sprite, text);
  return sprite;
}

function updateLabel(sprite, text) {
  const { size = 32, color = '#fff', bg = null } = sprite.userData.opts;
  if (sprite.userData.text === text) return;
  sprite.userData.text = text;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `800 ${size * 2}px system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.max(ctx.measureText(text).width + size * 1.6, size * 2);
  const h = size * 3;
  canvas.width = Math.ceil(w);
  canvas.height = h;
  if (bg) {
    roundRect(ctx, 2, 2, canvas.width - 4, h - 4, h / 2.4);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, canvas.width / 2, h / 2 + size * 0.1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sprite.material.map?.dispose();
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
  const scale = size / 6;
  sprite.scale.set((canvas.width / h) * scale, scale, 1);
}

const EVENT_NAMES = { goal: '⚽ Goal', penalty: '⚽ Penalty goal', 'own-goal': '⚽ Own goal', yellow: '🟨 Yellow card', red: '🟥 Red card', sub: '🔁 Substitution', ht: '⏸ Half time', ft: '🏁 Full time' };

function eventTip(m, e) {
  const team = e.team ? m[e.team].name : '';
  const score = e.score ? ` (${e.score[0]}–${e.score[1]})` : '';
  return `<b>${e.label} ${EVENT_NAMES[e.type] || e.type}${score}</b>${team ? `<br>${team}` : ''}${e.player ? ` · ${escapeHtml(e.player)}` : ''}`;
}

function shotTip(m, s) {
  const outcome = s.goal ? 'GOAL' : s.onTarget ? 'On target (saved)' : 'Off target';
  return `<b>${m[s.team].abbr} shot · ${outcome}</b><br>${s.minute}'${s.player ? ` · ${escapeHtml(s.player)}` : ''}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
