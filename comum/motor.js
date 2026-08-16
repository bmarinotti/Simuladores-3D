// motor.js — bootstrap comum de cena three.js/WebGL usado pelos tres simuladores.
// Cuida de renderer, camera, controles, luzes, laco de animacao, resize e raycast.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export { THREE };

/**
 * Cria a aplicacao 3D basica.
 * @param {object} opcoes
 * @returns {object} api do app
 */
export function criarApp(opcoes = {}) {
  const {
    corFundo = 0x8fb8e0,
    posCamera = [40, 34, 40],
    alvoCamera = [0, 0, 0],
    fov = 50,
    neblina = null,          // {cor, perto, longe}
    distMin = 4,
    distMax = 220,
    raioSombra = 90,
    anguloMax = Math.PI / 2 - 0.06,
  } = opcoes;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.id = 'tela3d';
  document.body.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  cena.background = new THREE.Color(corFundo);
  if (neblina) {
    cena.fog = new THREE.Fog(neblina.cor ?? corFundo, neblina.perto ?? 60, neblina.longe ?? 300);
  }

  const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(...posCamera);

  const controles = new OrbitControls(camera, renderer.domElement);
  controles.target.set(...alvoCamera);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.maxPolarAngle = anguloMax;
  controles.minDistance = distMin;
  controles.maxDistance = distMax;
  controles.update();

  const luzCeu = new THREE.HemisphereLight(0xbcd6ff, 0x4a4033, 0.85);
  cena.add(luzCeu);

  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  sol.position.set(60, 90, 40);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.camera.left = -raioSombra;
  sol.shadow.camera.right = raioSombra;
  sol.shadow.camera.top = raioSombra;
  sol.shadow.camera.bottom = -raioSombra;
  sol.shadow.camera.near = 1;
  sol.shadow.camera.far = raioSombra * 4;
  sol.shadow.bias = -0.0006;
  sol.shadow.normalBias = 0.02;
  cena.add(sol);
  cena.add(sol.target);

  // --- laco ---
  const relogio = new THREE.Clock();
  const ouvintes = [];
  let rodando = false;
  let pausado = false;

  function aoQuadro(fn) { ouvintes.push(fn); }

  function laco() {
    requestAnimationFrame(laco);
    const dt = Math.min(relogio.getDelta(), 0.05);
    controles.update();
    if (!pausado) {
      for (const fn of ouvintes) fn(dt);
    }
    renderer.render(cena, camera);
  }

  function iniciar() {
    if (rodando) return;
    rodando = true;
    relogio.getDelta();
    laco();
  }

  function pausar(v) { pausado = v; }
  function estaPausado() { return pausado; }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- raycast ---
  const raio = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();
  const planoAux = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitAux = new THREE.Vector3();

  function normalizarPonteiro(evento) {
    ponteiro.x = (evento.clientX / window.innerWidth) * 2 - 1;
    ponteiro.y = -(evento.clientY / window.innerHeight) * 2 + 1;
    return ponteiro;
  }

  /** Devolve o ponto do plano horizontal y=alturaY sob o mouse, ou null. */
  function pontoNoPlano(evento, alturaY = 0) {
    normalizarPonteiro(evento);
    raio.setFromCamera(ponteiro, camera);
    planoAux.constant = -alturaY;
    const p = raio.ray.intersectPlane(planoAux, hitAux);
    return p ? p.clone() : null;
  }

  /** Raycast contra uma lista de objetos. */
  function objetosSobPonteiro(evento, objetos, recursivo = true) {
    normalizarPonteiro(evento);
    raio.setFromCamera(ponteiro, camera);
    return raio.intersectObjects(objetos, recursivo);
  }

  return {
    THREE, renderer, cena, camera, controles, sol, luzCeu,
    aoQuadro, iniciar, pausar, estaPausado,
    pontoNoPlano, objetosSobPonteiro,
  };
}

// --- Ciclo dia/noite -------------------------------------------------------

const CEU_DIA = new THREE.Color(0x8fbde8);
const CEU_ENTARDECER = new THREE.Color(0xe8975a);
const CEU_NOITE = new THREE.Color(0x0a1024);
const LUZ_DIA = new THREE.Color(0xfff4e0);
const LUZ_ENTARDECER = new THREE.Color(0xffb072);
const LUZ_NOITE = new THREE.Color(0x5a6a9c);

const _corCeu = new THREE.Color();
const _corLuz = new THREE.Color();

/**
 * Ajusta sol, ceu e neblina conforme a hora (0..24).
 * Devolve fator 0 (noite total) .. 1 (meio-dia) para quem quiser acender janelas.
 */
export function aplicarHora(app, hora, opcoes = {}) {
  const { raio = 90, intensidadeMax = 2.2 } = opcoes;
  const h = ((hora % 24) + 24) % 24;

  // angulo do sol: 6h nasce (0), 12h zenite, 18h se poe (PI)
  const ang = ((h - 6) / 12) * Math.PI;
  const altura = Math.sin(ang);           // -1..1
  const dia = Math.max(0, altura);        // 0..1

  app.sol.position.set(
    Math.cos(ang) * raio,
    Math.max(altura * raio, -raio * 0.4),
    raio * 0.45,
  );
  app.sol.intensity = 0.15 + dia * intensidadeMax;

  // cor do ceu por faixa
  if (dia <= 0) {
    _corCeu.copy(CEU_NOITE);
    _corLuz.copy(LUZ_NOITE);
  } else if (dia < 0.35) {
    const t = dia / 0.35;
    _corCeu.copy(CEU_NOITE).lerp(CEU_ENTARDECER, t);
    _corLuz.copy(LUZ_NOITE).lerp(LUZ_ENTARDECER, t);
  } else {
    const t = (dia - 0.35) / 0.65;
    _corCeu.copy(CEU_ENTARDECER).lerp(CEU_DIA, t);
    _corLuz.copy(LUZ_ENTARDECER).lerp(LUZ_DIA, t);
  }

  app.sol.color.copy(_corLuz);
  app.luzCeu.intensity = 0.18 + dia * 0.75;
  if (app.cena.background && app.cena.background.isColor) app.cena.background.copy(_corCeu);
  if (app.cena.fog) app.cena.fog.color.copy(_corCeu);

  return dia;
}

// --- Utilitarios de geometria ---------------------------------------------

/** Chao simples com grid opcional. */
export function criarChao(app, { tamanho = 200, cor = 0x4f6b3f, grade = false, corGrade = 0x000000 } = {}) {
  const geo = new THREE.PlaneGeometry(tamanho, tamanho);
  const mat = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.95, metalness: 0.0 });
  const chao = new THREE.Mesh(geo, mat);
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  app.cena.add(chao);
  if (grade) {
    const g = new THREE.GridHelper(tamanho, tamanho / 4, corGrade, corGrade);
    g.material.opacity = 0.12;
    g.material.transparent = true;
    g.position.y = 0.02;
    app.cena.add(g);
  }
  return chao;
}

/** Bonequinho low-poly reutilizado por lavanderia e food truck. */
export function criarPessoa(cor = 0x3f7fd0, escala = 1) {
  const g = new THREE.Group();
  const matCorpo = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.8 });
  const matPele = new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.9 });

  const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 10), matCorpo);
  corpo.position.y = 0.62;
  corpo.castShadow = true;
  g.add(corpo);

  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), matPele);
  cabeca.position.y = 1.14;
  cabeca.castShadow = true;
  g.add(cabeca);

  const pernas = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0x2c3242, roughness: 0.9 }));
  pernas.position.y = 0.21;
  pernas.castShadow = true;
  g.add(pernas);

  g.scale.setScalar(escala);
  return g;
}

/** Paleta deterministica agradavel a partir de um indice. */
export function corDaPaleta(i) {
  const paleta = [
    0xe05c5c, 0x4f8ee0, 0x53b57a, 0xe0a83c, 0x8f6ad0,
    0x2fb3b3, 0xd9698f, 0x8fa63c, 0xc97a3a, 0x6a7fd0,
  ];
  return paleta[Math.abs(i) % paleta.length];
}
