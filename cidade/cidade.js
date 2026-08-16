// cidade.js — Simulador de cidade: zoneamento RCI, crescimento por demanda,
// orcamento municipal, transito instanciado e ciclo dia/noite.

import { criarApp, aplicarHora, criarChao, THREE } from '../comum/motor.js';
import { criarPainel, criarTopo, criarAviso, criarModal } from '../comum/hud.js';
import { criarRng, limitar, moeda, hhmm } from '../comum/rng.js';

// ---------------------------------------------------------------- parametros

const N = 28;                 // celulas por lado
const CEL = 4;                // tamanho da celula em unidades de mundo
const MEIO = (N * CEL) / 2;
const PASSO_RUA = 4;          // a cada 4 celulas ha uma rua
const NIVEL_MAX = 3;

const HORAS_POR_SEG = 2.0;    // 1x => 12 s por dia simulado

const ZONAS = {
  res: {
    nome: 'Residencial', cor: 0x5bbd6e, corPredio: 0x8fbf7a,
    pop: [0, 8, 22, 55], empregos: [0, 0, 0, 0],
    alturas: [0, 3.2, 6.4, 11.5], largura: 2.7, poluicao: 0,
  },
  com: {
    nome: 'Comercial', cor: 0x4f9de0, corPredio: 0x7ab5e8,
    pop: [0, 0, 0, 0], empregos: [0, 6, 16, 40],
    alturas: [0, 4.0, 8.5, 16.0], largura: 3.0, poluicao: 0.2,
  },
  ind: {
    nome: 'Industrial', cor: 0xe0b152, corPredio: 0xc9a06a,
    pop: [0, 0, 0, 0], empregos: [0, 10, 24, 52],
    alturas: [0, 3.6, 5.6, 8.4], largura: 3.3, poluicao: 2.4,
  },
  parque: {
    nome: 'Parque', cor: 0x2f8f52, corPredio: 0x2f8f52,
    pop: [0, 0, 0, 0], empregos: [0, 0, 0, 0],
    alturas: [0, 0, 0, 0], largura: 3.4, poluicao: -1.2,
  },
};

const CUSTO = { res: 45, com: 60, ind: 70, parque: 250, demolir: 12 };
const MANUT = { res: 0.9, com: 1.1, ind: 1.4, parque: 6.0 };

// ---------------------------------------------------------------- estado

const rng = criarRng(20260811);

const estado = {
  dia: 1,
  hora: 6,
  velocidade: 1,
  caixa: 25000,
  imposto: 9,          // %
  pop: 0,
  empregos: 0,
  poluicao: 0,
  satisfacao: 0.62,
  demanda: { res: 0.5, com: 0.2, ind: 0.2 },
  ferramenta: 'camera',
  receitaDia: 0,
  custoDia: 0,
  construcoes: 0,
  falidoAvisado: false,
};

// ---------------------------------------------------------------- cena

const app = criarApp({
  corFundo: 0x8fbde8,
  posCamera: [78, 62, 78],
  alvoCamera: [0, 0, 0],
  distMin: 14,
  distMax: 260,
  raioSombra: 90,
  neblina: { cor: 0x8fbde8, perto: 130, longe: 340 },
});

criarChao(app, { tamanho: N * CEL + 60, cor: 0x4a6b3c });

// materiais compartilhados (uma unica troca acende toda a cidade a noite)
const matPredio = {};
for (const [k, z] of Object.entries(ZONAS)) {
  matPredio[k] = new THREE.MeshStandardMaterial({
    color: z.corPredio,
    roughness: 0.78,
    metalness: 0.05,
    emissive: new THREE.Color(0xffd9a0),
    emissiveIntensity: 0,
  });
}
const matPad = {};
for (const [k, z] of Object.entries(ZONAS)) {
  matPad[k] = new THREE.MeshStandardMaterial({ color: z.cor, roughness: 0.95 });
}
const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoPad = new THREE.PlaneGeometry(1, 1);

// ---------------------------------------------------------------- grade

/** @type {Array<Array<object>>} */
const grade = [];
const grupoCidade = new THREE.Group();
app.cena.add(grupoCidade);

function ehRua(i, j) { return i % PASSO_RUA === 0 || j % PASSO_RUA === 0; }

for (let i = 0; i < N; i++) {
  grade[i] = [];
  for (let j = 0; j < N; j++) {
    grade[i][j] = {
      i, j,
      x: -MEIO + i * CEL + CEL / 2,
      z: -MEIO + j * CEL + CEL / 2,
      rua: ehRua(i, j),
      zona: null,
      nivel: 0,
      pad: null,
      predio: null,
      juntoRua: false,
    };
  }
}
// adjacencia a rua (define se o lote pode se desenvolver)
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const c = grade[i][j];
    if (c.rua) continue;
    c.juntoRua = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
      const a = grade[i + di]?.[j + dj];
      return a && a.rua;
    });
  }
}

// asfalto: um plano por linha/coluna de rua, barato de desenhar
const matAsfalto = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 });
const grupoRuas = new THREE.Group();
grupoCidade.add(grupoRuas);
const linhasRua = [];   // coordenadas de mundo dos eixos das ruas
for (let i = 0; i < N; i += PASSO_RUA) {
  const c = -MEIO + i * CEL + CEL / 2;
  linhasRua.push(c);
  for (const eixo of ['x', 'z']) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(eixo === 'x' ? CEL : N * CEL, eixo === 'x' ? N * CEL : CEL), matAsfalto);
    m.rotation.x = -Math.PI / 2;
    m.position.set(eixo === 'x' ? c : 0, 0.04, eixo === 'x' ? 0 : c);
    m.receiveShadow = true;
    grupoRuas.add(m);
  }
}

// ---------------------------------------------------------------- transito

const MAX_CARROS = 180;
const geoCarro = new THREE.BoxGeometry(1.7, 0.7, 0.85);
const matCarro = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.15 });
const carros = new THREE.InstancedMesh(geoCarro, matCarro, MAX_CARROS);
carros.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
carros.castShadow = true;
carros.count = 0;
grupoCidade.add(carros);
// cor por instancia
const coresCarro = new Float32Array(MAX_CARROS * 3);
const paletaCarro = [0xd94f4f, 0x4f7fd9, 0xe8e8e8, 0x2c2f36, 0xd9a83c, 0x53a86e];
for (let k = 0; k < MAX_CARROS; k++) {
  const c = new THREE.Color(paletaCarro[k % paletaCarro.length]);
  coresCarro[k * 3] = c.r; coresCarro[k * 3 + 1] = c.g; coresCarro[k * 3 + 2] = c.b;
}
carros.instanceColor = new THREE.InstancedBufferAttribute(coresCarro, 3);

const frota = [];
for (let k = 0; k < MAX_CARROS; k++) {
  const eixoX = k % 2 === 0;
  frota.push({
    eixoX,
    linha: linhasRua[Math.floor(rng() * linhasRua.length)],
    pos: rng.entre(-MEIO, MEIO),
    dir: rng() < 0.5 ? 1 : -1,
    vel: rng.entre(7, 13),
  });
}
const auxObj = new THREE.Object3D();

function atualizarTransito(dt, escalaTempo) {
  const alvo = Math.round(limitar((estado.pop + estado.empregos) / 55, 0, MAX_CARROS));
  carros.count = alvo;
  if (alvo === 0) return;
  const v = dt * escalaTempo;
  for (let k = 0; k < alvo; k++) {
    const c = frota[k];
    c.pos += c.dir * c.vel * v;
    if (c.pos > MEIO + 3) c.pos = -MEIO - 3;
    if (c.pos < -MEIO - 3) c.pos = MEIO + 3;
    const faixa = c.dir > 0 ? 1.0 : -1.0;
    if (c.eixoX) {
      auxObj.position.set(c.linha + faixa, 0.42, c.pos);
      auxObj.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0);
      auxObj.rotation.y += Math.PI / 2;
    } else {
      auxObj.position.set(c.pos, 0.42, c.linha - faixa);
      auxObj.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0);
    }
    auxObj.updateMatrix();
    carros.setMatrixAt(k, auxObj.matrix);
  }
  carros.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- construcao

function criarPad(cel) {
  const pad = new THREE.Mesh(geoPad, matPad[cel.zona]);
  pad.rotation.x = -Math.PI / 2;
  pad.scale.set(CEL - 0.5, CEL - 0.5, 1);
  pad.position.set(cel.x, 0.06, cel.z);
  pad.receiveShadow = true;
  grupoCidade.add(pad);
  return pad;
}

function criarArvore(x, z, escala) {
  const g = new THREE.Group();
  const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }));
  tronco.position.y = 0.35;
  const copa = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f7a3f, roughness: 0.95 }));
  copa.position.y = 1.25;
  copa.castShadow = true;
  g.add(tronco, copa);
  g.position.set(x, 0, z);
  g.scale.setScalar(escala);
  return g;
}

function reconstruir(cel) {
  if (cel.predio) { grupoCidade.remove(cel.predio); descartar(cel.predio); cel.predio = null; }
  if (!cel.zona || cel.nivel === 0) return;
  const z = ZONAS[cel.zona];

  if (cel.zona === 'parque') {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      g.add(criarArvore(
        cel.x + rng.entre(-1.2, 1.2),
        cel.z + rng.entre(-1.2, 1.2),
        rng.entre(0.75, 1.15),
      ));
    }
    cel.predio = g;
    grupoCidade.add(g);
    return;
  }

  const alt = z.alturas[cel.nivel];
  const g = new THREE.Group();
  const corpo = new THREE.Mesh(geoBox, matPredio[cel.zona]);
  corpo.scale.set(z.largura, alt, z.largura);
  corpo.position.set(cel.x, alt / 2, cel.z);
  corpo.castShadow = true;
  corpo.receiveShadow = true;
  g.add(corpo);

  if (cel.nivel === NIVEL_MAX && cel.zona !== 'ind') {
    // coroamento: bloco menor no topo, da silhueta de torre
    const topo = new THREE.Mesh(geoBox, matPredio[cel.zona]);
    const at = alt * 0.28;
    topo.scale.set(z.largura * 0.55, at, z.largura * 0.55);
    topo.position.set(cel.x, alt + at / 2, cel.z);
    topo.castShadow = true;
    g.add(topo);
  }
  if (cel.zona === 'ind') {
    // chamine
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, alt * 0.9, 8), matPredio.ind);
    ch.position.set(cel.x + z.largura * 0.32, alt + alt * 0.45, cel.z - z.largura * 0.32);
    ch.castShadow = true;
    g.add(ch);
  }

  cel.predio = g;
  grupoCidade.add(g);
}

function descartar(obj) {
  obj.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry !== geoBox && o.geometry !== geoPad) o.geometry.dispose();
  });
}

// ---------------------------------------------------------------- economia

function recalcular() {
  let pop = 0, empregos = 0, poluicao = 0, parques = 0, custo = 0, construcoes = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const c = grade[i][j];
      if (!c.zona) continue;
      const z = ZONAS[c.zona];
      if (c.zona === 'parque') { parques++; custo += MANUT.parque; continue; }
      if (c.nivel === 0) continue;          // lote vazio nao custa manutencao
      custo += MANUT[c.zona] * c.nivel;
      construcoes++;
      pop += z.pop[c.nivel];
      empregos += z.empregos[c.nivel];
      poluicao += z.poluicao * c.nivel;
    }
  }
  estado.pop = pop;
  estado.empregos = empregos;
  estado.poluicao = Math.max(0, poluicao - parques * 1.2);
  estado.construcoes = construcoes;
  estado.custoDia = custo;

  // demanda RCI: quanto de cada zona falta para equilibrar a cidade
  const vagasCom = somaEmpregos('com');
  const vagasInd = somaEmpregos('ind');
  // o excedente constante (+40 / +15) e o que da partida na cidade e sustenta
  // o crescimento composto: mais gente pede mais comercio, que pede mais gente
  estado.demanda.res = limitar((empregos * 1.15 + 40 - pop) / 80, -1, 1);
  estado.demanda.com = limitar((pop * 0.50 + 15 - vagasCom) / 55, -1, 1);
  estado.demanda.ind = limitar((pop * 0.40 + 15 - vagasInd) / 55, -1, 1);

  const desemprego = pop > 0 ? limitar(1 - empregos / pop, 0, 1) : 0;
  const polPerCap = pop > 0 ? estado.poluicao / (pop / 100) : 0;
  const verde = pop > 0 ? limitar(parques / (pop / 260), 0, 1.5) : 0;
  estado.satisfacao = limitar(
    0.66
    - desemprego * 0.45
    - limitar(polPerCap * 0.035, 0, 0.3)
    + verde * 0.12
    - Math.max(0, estado.imposto - 9) * 0.022
    + Math.max(0, 9 - estado.imposto) * 0.012,
    0, 1,
  );

  estado.receitaDia = (pop * 3.4 + empregos * 4.6) * (estado.imposto / 100) * (0.6 + estado.satisfacao * 0.6);
}

function somaEmpregos(zona) {
  let s = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const c = grade[i][j];
    if (c.zona === zona && c.nivel > 0) s += ZONAS[zona].empregos[c.nivel];
  }
  return s;
}

function passarDia() {
  recalcular();

  estado.caixa += estado.receitaDia - estado.custoDia;

  // crescimento / declinio dos lotes
  let cresceu = 0, caiu = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const c = grade[i][j];
      if (!c.zona || c.zona === 'parque' || !c.juntoRua) continue;
      const d = estado.demanda[c.zona];
      if (c.nivel < NIVEL_MAX && d > 0.04) {
        const chance = d * 0.28 * (0.45 + estado.satisfacao) * (c.nivel === 0 ? 1.5 : 1);
        if (rng.chance(chance)) { c.nivel++; reconstruir(c); cresceu++; }
      } else if (c.nivel > 0 && d < -0.35 && rng.chance(0.05)) {
        c.nivel--; reconstruir(c); caiu++;
      }
    }
  }

  recalcular();
  estado.dia++;

  if (cresceu) log.escrever(`dia ${estado.dia - 1}: +${cresceu} lote(s) desenvolvido(s)`, 'bom');
  if (caiu) log.escrever(`dia ${estado.dia - 1}: ${caiu} lote(s) em declinio`, 'ruim');
  if (estado.dia % 5 === 0) {
    const saldo = estado.receitaDia - estado.custoDia;
    log.escrever(`dia ${estado.dia}: pop ${estado.pop} · caixa ${moeda(estado.caixa)} · saldo ${saldo >= 0 ? '+' : ''}${moeda(saldo)}`);
  }
  if (estado.caixa < 0 && !estado.falidoAvisado) {
    estado.falidoAvisado = true;
    avisar('Caixa negativo. Suba o imposto ou corte manutencao.', 3200, 'ruim');
    log.escrever('caixa negativo — prefeitura no vermelho', 'ruim');
  }
  if (estado.caixa >= 0) estado.falidoAvisado = false;

  atualizarHud();
}

// ---------------------------------------------------------------- interacao

const topo = criarTopo('Simulador de Cidade', 'zoneamento · demanda · orcamento');
const avisar = criarAviso();
const modal = criarModal();

const pEsq = criarPainel({ lado: 'esq', titulo: 'Prefeitura', subtitulo: 'ferramentas e politica fiscal', largura: 262 });
const pDir = criarPainel({ lado: 'dir', titulo: 'Indicadores', subtitulo: 'atualizados a cada dia', largura: 262 });

// -- ferramentas
pEsq.secao('Ferramenta');
pEsq.grupo([
  { rotulo: 'Mover camera', valor: 'camera', dica: 'Arraste para girar. Roda do mouse: zoom.' },
  { rotulo: `Residencial <small>${moeda(CUSTO.res)}</small>`, valor: 'res', cor: '#5bbd6e', dica: 'Moradia. Cresce se houver emprego.' },
  { rotulo: `Comercial <small>${moeda(CUSTO.com)}</small>`, valor: 'com', cor: '#4f9de0', dica: 'Empregos e servicos para a populacao.' },
  { rotulo: `Industrial <small>${moeda(CUSTO.ind)}</small>`, valor: 'ind', cor: '#e0b152', dica: 'Muitos empregos, mas polui.' },
  { rotulo: `Parque <small>${moeda(CUSTO.parque)}</small>`, valor: 'parque', cor: '#2f8f52', dica: 'Reduz poluicao e eleva satisfacao.' },
  { rotulo: `Demolir <small>${moeda(CUSTO.demolir)}</small>`, valor: 'demolir' },
], (v) => {
  estado.ferramenta = v;
  aplicarModoCamera();
}, { selecionado: 'camera' });

pEsq.texto('Com uma zona selecionada, o botao esquerdo <b>pinta lotes</b> (pode arrastar) e o direito gira a camera. Lotes so se desenvolvem se tocarem uma rua.');

// -- fiscal
pEsq.secao('Politica fiscal');
pEsq.deslizante('Imposto', {
  min: 0, max: 20, passo: 1, valor: estado.imposto,
  formato: (v) => v + '%',
  aoMudar: (v) => { estado.imposto = v; recalcular(); atualizarHud(); },
});
pEsq.texto('Acima de 9% a satisfacao cai; abaixo, sobe — mas a receita encolhe.');

pEsq.secao('Tempo');
pEsq.grupo([
  { rotulo: 'Pausa', valor: 0 },
  { rotulo: '1x', valor: 1 },
  { rotulo: '2x', valor: 2 },
  { rotulo: '4x', valor: 4 },
], (v) => { estado.velocidade = v; }, { selecionado: 1 });

pEsq.botao('Como jogar', () => abrirAjuda(), { classe: '' });

// -- indicadores
pDir.secao('Cidade');
pDir.stat('dia', 'Dia', '1');
pDir.stat('pop', 'Populacao', '0');
pDir.stat('emp', 'Empregos', '0');
pDir.stat('desemp', 'Desemprego', '0%');
pDir.stat('cons', 'Construcoes', '0');

pDir.secao('Orcamento');
pDir.stat('caixa', 'Caixa', moeda(estado.caixa));
pDir.stat('rec', 'Receita/dia', moeda(0));
pDir.stat('cus', 'Manutencao/dia', moeda(0));
pDir.stat('sal', 'Saldo/dia', moeda(0));

pDir.secao('Qualidade de vida');
pDir.barra('sat', 'Satisfacao');
pDir.barra('pol', 'Poluicao');

pDir.secao('Demanda por zona');
pDir.barra('dres', 'Residencial');
pDir.barra('dcom', 'Comercial');
pDir.barra('dind', 'Industrial');

pDir.secao('Eventos');
const log = pDir.log(50);
log.escrever('cidade fundada. zoneie perto das ruas.');

// destaque da celula sob o mouse
const destaque = new THREE.Mesh(
  new THREE.BoxGeometry(CEL - 0.3, 0.12, CEL - 0.3),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }),
);
destaque.visible = false;
app.cena.add(destaque);

function aplicarModoCamera() {
  const pintando = estado.ferramenta !== 'camera';
  app.controles.mouseButtons = {
    LEFT: pintando ? null : THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  destaque.visible = false;
}
aplicarModoCamera();

function celulaDoEvento(ev) {
  const p = app.pontoNoPlano(ev, 0);
  if (!p) return null;
  const i = Math.floor((p.x + MEIO) / CEL);
  const j = Math.floor((p.z + MEIO) / CEL);
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  return grade[i][j];
}

function aplicarFerramenta(cel) {
  if (!cel) return;
  const f = estado.ferramenta;
  if (f === 'camera') return;

  if (cel.rua) { avisar('Nao da para construir sobre a rua.', 1400); return; }

  if (f === 'demolir') {
    if (!cel.zona) return;
    if (estado.caixa < CUSTO.demolir) { avisar('Sem caixa para demolir.', 1400, 'ruim'); return; }
    estado.caixa -= CUSTO.demolir;
    if (cel.pad) { grupoCidade.remove(cel.pad); cel.pad = null; }
    if (cel.predio) { grupoCidade.remove(cel.predio); descartar(cel.predio); cel.predio = null; }
    cel.zona = null; cel.nivel = 0;
    recalcular(); atualizarHud();
    return;
  }

  if (cel.zona === f) return;                    // ja e dessa zona
  const custo = CUSTO[f];
  if (estado.caixa < custo) { avisar('Caixa insuficiente.', 1500, 'ruim'); return; }
  estado.caixa -= custo;

  if (cel.pad) { grupoCidade.remove(cel.pad); cel.pad = null; }
  if (cel.predio) { grupoCidade.remove(cel.predio); descartar(cel.predio); cel.predio = null; }

  cel.zona = f;
  cel.nivel = f === 'parque' ? 1 : 0;
  cel.pad = criarPad(cel);
  if (f === 'parque') reconstruir(cel);
  if (!cel.juntoRua && f !== 'parque') avisar('Lote sem acesso a rua — nao vai se desenvolver.', 1900);

  recalcular(); atualizarHud();
}

let pintando = false;
let ultimaCel = null;

app.renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (estado.ferramenta === 'camera') return;
  // botao direito do mouse continua girando a camera mesmo com ferramenta ativa
  if (ev.pointerType !== 'touch' && ev.button !== 0) return;
  // no toque, OrbitControls.touches.ONE gira a camera com 1 dedo por conta propria
  // (independe de mouseButtons.LEFT). Desligar a orbita durante o gesto de pintura
  // evita competir pelo mesmo arrasto com um so dedo.
  app.controles.enabled = false;
  pintando = true;
  const c = celulaDoEvento(ev);
  ultimaCel = c;
  aplicarFerramenta(c);
});

window.addEventListener('pointerup', () => {
  pintando = false;
  ultimaCel = null;
  app.controles.enabled = true;
});

app.renderer.domElement.addEventListener('pointermove', (ev) => {
  if (estado.ferramenta === 'camera') { destaque.visible = false; return; }
  const c = celulaDoEvento(ev);
  if (c) {
    destaque.visible = true;
    destaque.position.set(c.x, 0.12, c.z);
  } else {
    destaque.visible = false;
  }
  if (pintando && c && c !== ultimaCel) { ultimaCel = c; aplicarFerramenta(c); }
});

window.addEventListener('keydown', (ev) => {
  const mapa = { Digit1: 'camera', Digit2: 'res', Digit3: 'com', Digit4: 'ind', Digit5: 'parque', Digit6: 'demolir' };
  if (mapa[ev.code]) {
    estado.ferramenta = mapa[ev.code];
    aplicarModoCamera();
    avisar('Ferramenta: ' + (ZONAS[estado.ferramenta]?.nome ?? estado.ferramenta), 900);
  }
  if (ev.code === 'Space') { ev.preventDefault(); estado.velocidade = estado.velocidade === 0 ? 1 : 0; }
});

function abrirAjuda() {
  modal.abrir(`
    <h2>Como jogar</h2>
    <p>Voce administra uma cidade. Zoneie lotes, equilibre empregos e moradia e mantenha o caixa positivo.</p>
    <h3>Regras principais</h3>
    <p>· Lotes so se desenvolvem se tocarem uma <b>rua</b>.<br>
       · <b>Residencial</b> cresce quando ha vaga de emprego sobrando.<br>
       · <b>Comercial</b> e <b>industrial</b> crescem quando ha populacao para trabalhar e consumir.<br>
       · <b>Industria</b> polui: compense com <b>parques</b>.<br>
       · Imposto alto arrecada mais no curto prazo e derruba a satisfacao — que por sua vez freia o crescimento.</p>
    <h3>Atalhos</h3>
    <p><kbd>1</kbd>..<kbd>6</kbd> trocam de ferramenta · <kbd>Espaco</kbd> pausa.</p>
    <button class="btn btn-primario" data-fechar>Entendi</button>
  `);
}

// ---------------------------------------------------------------- hud

function atualizarHud() {
  const desemprego = estado.pop > 0 ? limitar(1 - estado.empregos / estado.pop, 0, 1) : 0;
  const saldo = estado.receitaDia - estado.custoDia;

  pDir.set('dia', String(estado.dia));
  pDir.set('pop', estado.pop.toLocaleString('pt-BR'));
  pDir.set('emp', estado.empregos.toLocaleString('pt-BR'));
  pDir.set('desemp', (desemprego * 100).toFixed(0) + '%', desemprego < 0.08 ? 'bom' : desemprego < 0.2 ? 'medio' : 'ruim');
  pDir.set('cons', String(estado.construcoes));

  pDir.set('caixa', moeda(estado.caixa), estado.caixa >= 0 ? 'bom' : 'ruim');
  pDir.set('rec', moeda(estado.receitaDia));
  pDir.set('cus', moeda(estado.custoDia));
  pDir.set('sal', (saldo >= 0 ? '+' : '') + moeda(saldo), saldo >= 0 ? 'bom' : 'ruim');

  pDir.setBarra('sat', estado.satisfacao,
    estado.satisfacao > 0.6 ? '#57c98a' : estado.satisfacao > 0.35 ? '#e6b352' : '#e06a6a');
  const polNorm = limitar(estado.poluicao / 60, 0, 1);
  pDir.setBarra('pol', polNorm, polNorm < 0.3 ? '#57c98a' : polNorm < 0.6 ? '#e6b352' : '#e06a6a');

  pDir.setBarra('dres', Math.max(0, estado.demanda.res), '#5bbd6e');
  pDir.setBarra('dcom', Math.max(0, estado.demanda.com), '#4f9de0');
  pDir.setBarra('dind', Math.max(0, estado.demanda.ind), '#e0b152');
}

// ---------------------------------------------------------------- laco

let acumuladoDia = 0;

app.aoQuadro((dt) => {
  const escala = estado.velocidade;
  if (escala > 0) {
    const dh = dt * HORAS_POR_SEG * escala;
    estado.hora += dh;
    acumuladoDia += dh;
    if (acumuladoDia >= 24) { acumuladoDia -= 24; passarDia(); }
  }

  const dia = aplicarHora(app, estado.hora, { raio: 110, intensidadeMax: 2.0 });

  // janelas acendem ao anoitecer
  const luzJanela = limitar((0.32 - dia) / 0.32, 0, 1);
  for (const k of ['res', 'com', 'ind']) matPredio[k].emissiveIntensity = luzJanela * 0.55;

  atualizarTransito(dt, escala);
  topo.setRelogio(`dia ${estado.dia} · ${hhmm(estado.hora)}`);
});

recalcular();
atualizarHud();
app.iniciar();

// cidade inicial semeada: um quarteirao ja zoneado para dar partida
(function semear() {
  const seeds = [
    ['res', 13, 13], ['res', 14, 13], ['res', 13, 14], ['res', 14, 14],
    ['com', 17, 13], ['com', 18, 13], ['ind', 9, 17], ['ind', 10, 17],
  ];
  for (const [z, i, j] of seeds) {
    const c = grade[i]?.[j];
    if (!c || c.rua) continue;
    c.zona = z; c.nivel = 1;
    c.pad = criarPad(c);
    reconstruir(c);
  }
  recalcular();
  atualizarHud();
})();

// gancho de inspecao usado por testes/quadros.html
window.__dbg = { estado, grade, ZONAS, aplicarFerramenta, recalcular };
