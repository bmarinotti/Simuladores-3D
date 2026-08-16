// foodtruck.js — Simulador de food truck.
// Escolha de ponto na cidade, fluxo de pedestres por horario, conversao sensivel
// a preco e fila, estoque de insumos, preparo com equipe e fechamento diario.

import { criarApp, aplicarHora, criarPessoa, THREE } from '../comum/motor.js';
import { criarPainel, criarTopo, criarAviso, criarModal } from '../comum/hud.js';
import { criarRng, limitar, moeda, hhmm } from '../comum/rng.js';

// ---------------------------------------------------------------- parametros

const MIN_POR_SEG = 3;            // minutos simulados por segundo real (1x)
const ABRE = 10, FECHA = 23;

const CUSTO_INSUMO = 8.5;         // por lanche
const LOTE = 20;
const PRECO_REF = 24;             // ticket medio da concorrencia
const T_PREPARO = 3.6;            // minutos por pedido, com 1 pessoa

const PRECO = { chapa: 2500, toldo: 900, combustivel: 40 };
const SALARIO_DIA = 140;
const FILA_MAX = 8;

// curva de fluxo por hora (10..23) para cada ponto
const PONTOS = [
  {
    id: 'centro', nome: 'Centro empresarial', x: -45, aluguel: 220, fluxo: 115,
    resumo: 'Enxurrada no almoco, deserto a noite.',
    curva: { 10: .35, 11: .85, 12: 1.0, 13: .9, 14: .45, 15: .25, 16: .2, 17: .3, 18: .35, 19: .2, 20: .08, 21: .05, 22: .03 },
  },
  {
    id: 'parque', nome: 'Parque municipal', x: -15, aluguel: 120, fluxo: 78,
    resumo: 'Fluxo constante e barato, pico no fim da tarde.',
    curva: { 10: .5, 11: .55, 12: .7, 13: .6, 14: .6, 15: .75, 16: .9, 17: 1.0, 18: .85, 19: .5, 20: .25, 21: .12, 22: .06 },
  },
  {
    id: 'campus', nome: 'Campus universitario', x: 15, aluguel: 150, fluxo: 98,
    resumo: 'Dois picos: almoco e intervalo da noite. Publico sensivel a preco.',
    curva: { 10: .4, 11: .7, 12: 1.0, 13: .8, 14: .45, 15: .4, 16: .5, 17: .6, 18: .8, 19: .95, 20: .85, 21: .5, 22: .2 },
    elasticidadeExtra: 1.35,
  },
  {
    id: 'boemia', nome: 'Rua da boemia', x: 45, aluguel: 185, fluxo: 90,
    resumo: 'Vazio de dia, cheio depois das 20h. Aceita ticket mais alto.',
    curva: { 10: .05, 11: .08, 12: .15, 13: .12, 14: .1, 15: .12, 16: .2, 17: .35, 18: .55, 19: .75, 20: 1.0, 21: 1.0, 22: .9 },
    elasticidadeExtra: 0.7,
  },
];

// ---------------------------------------------------------------- estado

const rng = criarRng(31337);

const estado = {
  dia: 1,
  hora: ABRE,
  velocidade: 1,
  caixa: 6000,
  preco: 22,
  estoque: 60,
  equipe: 1,                  // pessoas na chapa (voce inclusa)
  chapaDupla: false,
  toldo: false,
  reputacao: 0.6,
  ponto: PONTOS[0],
  movendo: null,              // {destino, restante}
  d: { receita: 0, insumos: 0, capex: 0, vendas: 0, perdidosFila: 0, perdidosEstoque: 0, esperaSoma: 0, esperaN: 0 },
};

// ---------------------------------------------------------------- cena

const app = criarApp({
  corFundo: 0x9cc2e8,
  posCamera: [PONTOS[0].x, 10, 18],
  alvoCamera: [PONTOS[0].x, 1.5, 1],
  fov: 50,
  distMin: 6,
  distMax: 70,
  raioSombra: 40,
  neblina: { cor: 0x9cc2e8, perto: 60, longe: 190 },
});

const RUA_COMP = 150;

// calcada
const calcada = new THREE.Mesh(
  new THREE.BoxGeometry(RUA_COMP, 0.25, 5),
  new THREE.MeshStandardMaterial({ color: 0xbdbcb6, roughness: 0.95 }),
);
calcada.position.set(0, 0.125, -1);
calcada.receiveShadow = true;
app.cena.add(calcada);

// asfalto
const asfalto = new THREE.Mesh(
  new THREE.PlaneGeometry(RUA_COMP, 14),
  new THREE.MeshStandardMaterial({ color: 0x40444c, roughness: 0.98 }),
);
asfalto.rotation.x = -Math.PI / 2;
asfalto.position.set(0, 0.01, 8.5);
asfalto.receiveShadow = true;
app.cena.add(asfalto);

// faixa central tracejada
const matFaixa = new THREE.MeshStandardMaterial({ color: 0xd9d4b8, roughness: 0.9 });
for (let x = -RUA_COMP / 2; x < RUA_COMP / 2; x += 6) {
  const f = new THREE.Mesh(new THREE.BoxGeometry(3, 0.02, 0.22), matFaixa);
  f.position.set(x + 1.5, 0.03, 9.5);
  app.cena.add(f);
}

// fundo: quadra generica + tematizacao por ponto
const matPredios = [0x6f7684, 0x7d8493, 0x5f6675, 0x8a8f9c].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }),
);
const geoCubo = new THREE.BoxGeometry(1, 1, 1);

function predio(x, largura, altura, prof, mat) {
  const m = new THREE.Mesh(geoCubo, mat);
  m.scale.set(largura, altura, prof);
  m.position.set(x, altura / 2, -6 - prof / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  app.cena.add(m);
  return m;
}

function arvore(x, z, escala = 1) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }));
  t.position.y = 0.7;
  const c = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f7a3f, roughness: 0.95 }));
  c.position.y = 2.1;
  c.castShadow = true;
  g.add(t, c);
  g.position.set(x, 0.25, z);
  g.scale.setScalar(escala);
  app.cena.add(g);
  return g;
}

// dressing de cada ponto
for (const p of PONTOS) {
  if (p.id === 'centro') {
    for (let k = -3; k <= 3; k++) predio(p.x + k * 7, 6, rng.entre(16, 30), 10, matPredios[(k + 3) % 4]);
  } else if (p.id === 'parque') {
    const grama = new THREE.Mesh(
      new THREE.BoxGeometry(46, 0.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x4f7f3f, roughness: 0.98 }),
    );
    grama.position.set(p.x, 0.1, -14);
    grama.receiveShadow = true;
    app.cena.add(grama);
    for (let k = 0; k < 12; k++) arvore(p.x + rng.entre(-20, 20), rng.entre(-22, -8), rng.entre(0.9, 1.5));
  } else if (p.id === 'campus') {
    predio(p.x, 34, 9, 14, matPredios[1]);
    for (let k = 0; k < 6; k++) arvore(p.x + rng.entre(-18, 18), -7.5, rng.entre(0.8, 1.1));
  } else {
    for (let k = -3; k <= 3; k++) {
      predio(p.x + k * 6.5, 5.6, rng.entre(7, 13), 9, matPredios[(k + 4) % 4]);
      // toldo colorido de bar
      const t = new THREE.Mesh(
        new THREE.BoxGeometry(5.0, 0.2, 1.6),
        new THREE.MeshStandardMaterial({ color: [0xd94f4f, 0xd9a83c, 0x3f8fd0][Math.abs(k) % 3], roughness: 0.8 }),
      );
      t.position.set(p.x + k * 6.5, 3.1, -5.2);
      t.castShadow = true;
      app.cena.add(t);
    }
  }
  // placa do ponto, para achar o lugar quando a camera passeia
  const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a5160, roughness: 0.7 }));
  poste.position.set(p.x - 6, 1.85, -2.6);
  poste.castShadow = true;
  app.cena.add(poste);
}

// ---------------------------------------------------------------- o truck

const truck = new THREE.Group();
app.cena.add(truck);

const matCarroceria = new THREE.MeshStandardMaterial({ color: 0xe8503f, roughness: 0.42, metalness: 0.2 });
const matCabine = new THREE.MeshStandardMaterial({ color: 0xd9422f, roughness: 0.42, metalness: 0.2 });
const matVidroT = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.12, metalness: 0.5 });
const matPneu = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.95 });
const matBalcao = new THREE.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.7 });

const bau = new THREE.Mesh(geoCubo, matCarroceria);
bau.scale.set(6.4, 2.9, 2.6);
bau.position.set(0.6, 1.95, 0);
bau.castShadow = true; bau.receiveShadow = true;
truck.add(bau);

const cabine = new THREE.Mesh(geoCubo, matCabine);
cabine.scale.set(2.2, 2.0, 2.5);
cabine.position.set(-3.5, 1.5, 0);
cabine.castShadow = true;
truck.add(cabine);

const paraBrisa = new THREE.Mesh(geoCubo, matVidroT);
paraBrisa.scale.set(0.12, 0.9, 2.1);
paraBrisa.position.set(-4.6, 1.9, 0);
truck.add(paraBrisa);

for (const wx of [-3.4, 1.2, 2.9]) {
  const roda = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 16), matPneu);
  roda.rotation.x = Math.PI / 2;
  roda.position.set(wx, 0.62, -1.35);
  roda.castShadow = true;
  truck.add(roda);
  const roda2 = roda.clone();
  roda2.position.z = 1.35;
  truck.add(roda2);
}

// janela de atendimento voltada para a calcada (-z)
const vao = new THREE.Mesh(geoCubo, new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.9 }));
vao.scale.set(3.4, 1.35, 0.1);
vao.position.set(0.8, 2.25, -1.32);
truck.add(vao);

const balcao = new THREE.Mesh(geoCubo, matBalcao);
balcao.scale.set(3.9, 0.14, 0.55);
balcao.position.set(0.8, 1.62, -1.6);
balcao.castShadow = true;
truck.add(balcao);

// toldo (upgrade visivel)
const toldoMesh = new THREE.Mesh(geoCubo, new THREE.MeshStandardMaterial({ color: 0xf0c453, roughness: 0.8 }));
toldoMesh.scale.set(4.2, 0.12, 1.5);
toldoMesh.position.set(0.8, 3.15, -2.0);
toldoMesh.rotation.x = -0.16;
toldoMesh.castShadow = true;
toldoMesh.visible = false;
truck.add(toldoMesh);

// letreiro
const letreiro = new THREE.Mesh(geoCubo, new THREE.MeshStandardMaterial({
  color: 0xfaf3e0, emissive: 0xffcf6b, emissiveIntensity: 0.0, roughness: 0.6,
}));
letreiro.scale.set(3.0, 0.62, 0.12);
letreiro.position.set(0.8, 3.05, -1.36);
truck.add(letreiro);

// luz de trabalho no balcao
const luzBalcao = new THREE.PointLight(0xffd9a0, 0, 9, 2);
luzBalcao.position.set(0.8, 2.6, -1.9);
truck.add(luzBalcao);

// chapa: cilindro girando de leve quando ha pedido em preparo
const chapa = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 0.12, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x8d95a3, roughness: 0.35, metalness: 0.7 }),
);
chapa.position.set(1.9, 1.7, -0.2);
truck.add(chapa);

// cozinheiros
const cozinheiros = [];
for (let k = 0; k < 3; k++) {
  const p = criarPessoa(0xf0f0f0, 0.95);
  p.position.set(0.2 + k * 1.1, 1.05, 0.4);
  p.rotation.y = Math.PI;
  p.visible = k === 0;
  truck.add(p);
  cozinheiros.push(p);
}

function posicionarTruck(x) {
  truck.position.set(x, 0, 4.6);
}
posicionarTruck(estado.ponto.x);

// posicao da janela em coordenadas de mundo
function posJanela() {
  return { x: truck.position.x + 0.8, z: truck.position.z - 2.4 };
}
function slotFila(k) {
  const j = posJanela();
  return { x: j.x - k * 1.05, z: j.z - 0.4 };
}

// ---------------------------------------------------------------- pedestres

const CALCADA_Z = -1.2;
const pedestres = [];
const fila = [];
let emPreparo = null;    // {cliente, restante}

/**
 * Cria um transeunte. `vaiComprar` ja vem decidido na chegada — a animacao e
 * so representacao: o relogio de tela e comprimido demais para que a caminhada
 * do boneco defina quando a venda acontece.
 */
function novoPedestre(vaiComprar) {
  const dir = rng() < 0.5 ? 1 : -1;
  const cor = [0xd94f4f, 0x3f7fd0, 0x53a86e, 0xd9a83c, 0x8f6ad0, 0x2fb3b3, 0xe08a3c][rng.inteiro(0, 6)];
  const g = criarPessoa(cor, rng.entre(0.9, 1.08));
  const dist = vaiComprar ? rng.entre(6, 11) : 22;
  g.position.set(truck.position.x - dir * dist, 0.25, CALCADA_Z + rng.entre(-1.1, 1.1));
  g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  app.cena.add(g);

  const p = {
    grupo: g, dir, vel: rng.entre(1.1, 1.8),
    estado: vaiComprar ? 'indoFila' : 'passando',
    espera: 0, slot: -1,
  };
  pedestres.push(p);
  if (vaiComprar) {
    p.slot = fila.length;
    fila.push(p);
  }
  return p;
}

function descartarPedestre(p) {
  app.cena.remove(p.grupo);
  p.grupo.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
  const i = pedestres.indexOf(p);
  if (i >= 0) pedestres.splice(i, 1);
}

function reorganizarFila() {
  fila.forEach((c, k) => { c.slot = k; });
}

// ---------------------------------------------------------------- economia

function elasticidade() {
  const extra = estado.ponto.elasticidadeExtra ?? 1;
  // preco acima da referencia derruba conversao; o expoente varia por publico
  return limitar(Math.pow(PRECO_REF / Math.max(estado.preco, 5), 1.15 * extra), 0.1, 2.4);
}

function tempoPreparo() {
  return T_PREPARO / (estado.equipe * (estado.chapaDupla ? 1.45 : 1));
}

function taxaPedestres(hora) {
  const h = Math.floor(hora);
  const mult = estado.ponto.curva[h] ?? 0;
  return estado.ponto.fluxo * mult;      // pedestres por hora
}

/** Vontade de comprar, sem contar fila nem falta de estoque. */
function apetite() {
  const fatorToldo = estado.toldo ? 1.12 : 1;
  return limitar(0.20 * elasticidade() * (0.5 + estado.reputacao * 0.9) * fatorToldo, 0, 0.85);
}

/**
 * Fracao de quem quer comprar e ainda encara a fila atual.
 * Ate duas pessoas na frente ninguem desiste; dai em diante cai rapido.
 */
const FILA_TOLERADA = 2;
function fatorFila() {
  const excesso = Math.max(0, fila.length - FILA_TOLERADA);
  return Math.pow(limitar(1 - excesso / (FILA_MAX - FILA_TOLERADA), 0, 1), 1.3);
}

/** Conversao efetiva agora — o que o painel mostra. */
function probConversao() {
  if (estado.estoque <= 0) return 0;
  return apetite() * fatorFila();
}

function vender(c) {
  estado.caixa += estado.preco;
  estado.d.receita += estado.preco;
  estado.d.vendas++;
  estado.estoque--;
  estado.d.esperaSoma += c.espera;
  estado.d.esperaN++;
  estado.reputacao = limitar(
    estado.reputacao + (c.espera < 6 ? 0.007 : c.espera < 12 ? 0.002 : -0.005),
    0.05, 1,
  );
  if (estado.estoque === 0) {
    avisar('Estoque zerado — compre insumos ou o dia acaba aqui.', 2600, 'ruim');
    log.escrever('estoque zerado', 'ruim');
  }
}

// ---------------------------------------------------------------- simulacao

function simular(dm, dt) {
  const operando = !estado.movendo && estado.hora < FECHA;

  // chegada de pedestres: a decisao de compra e tomada aqui, em tempo simulado
  if (operando) {
    const porMin = taxaPedestres(estado.hora) / 60;
    const n = rng.poisson(porMin * dm);
    let cenario = pedestres.reduce((s, p) => s + (p.estado === 'passando' ? 1 : 0), 0);
    for (let k = 0; k < n; k++) {
      const quer = rng.chance(apetite());
      if (quer && estado.estoque <= 0) {
        // chegar e nao ter o que vender queima o ponto
        estado.d.perdidosEstoque++;
        estado.reputacao = limitar(estado.reputacao - 0.0025, 0.05, 1);
      } else if (quer && !rng.chance(fatorFila())) {
        estado.d.perdidosFila++;
      } else if (quer) {
        novoPedestre(true);
        continue;
      }
      // quem so passa e cenario: limitado para nao lotar a calcada de bonecos
      if (cenario < 24) { novoPedestre(false); cenario++; }
    }
  }

  for (let i = pedestres.length - 1; i >= 0; i--) {
    const p = pedestres[i];

    if (p.estado === 'passando') {
      p.grupo.position.x += p.dir * p.vel * dt;
      if (Math.abs(p.grupo.position.x - truck.position.x) > 26) descartarPedestre(p);
      continue;
    }

    if (p.estado === 'indoFila' || p.estado === 'naFila') {
      const alvo = slotFila(p.slot);
      const dx = alvo.x - p.grupo.position.x;
      const dz = alvo.z - p.grupo.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const passo = Math.min(2.2 * dt, d);
        p.grupo.position.x += (dx / d) * passo;
        p.grupo.position.z += (dz / d) * passo;
        p.grupo.rotation.y = Math.atan2(dx, dz);
      } else {
        p.estado = 'naFila';
        p.grupo.rotation.y = Math.PI;      // de frente para a janela
      }
      // so conta espera depois de chegar ao lugar: a caminhada e tempo de tela
      if (p.estado === 'naFila') p.espera += dm;
      if (p.espera > 18 + rng() * 6 && emPreparo?.cliente !== p) {
        const k = fila.indexOf(p);
        if (k >= 0) fila.splice(k, 1);
        reorganizarFila();
        estado.d.perdidosFila++;
        estado.reputacao = limitar(estado.reputacao - 0.01, 0.05, 1);
        p.estado = 'passando';
        p.dir = rng() < 0.5 ? 1 : -1;
        p.grupo.position.z = CALCADA_Z;
        log.escrever('cliente cansou de esperar e saiu da fila', 'ruim');
      }
      continue;
    }

    if (p.estado === 'saindo') {
      p.grupo.position.x += p.dir * p.vel * dt;
      p.grupo.position.z += (CALCADA_Z - p.grupo.position.z) * Math.min(1, dt * 2);
      if (Math.abs(p.grupo.position.x - truck.position.x) > 26) descartarPedestre(p);
    }
  }

  // atendimento
  if (emPreparo) {
    emPreparo.restante -= dm;
    chapa.rotation.y += dt * 1.2;
    if (emPreparo.restante <= 0) {
      const c = emPreparo.cliente;
      vender(c);
      c.estado = 'saindo';
      c.dir = rng() < 0.5 ? 1 : -1;
      c.grupo.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      emPreparo = null;
      reorganizarFila();
    }
  }
  // o preparo comeca assim que o cliente e o proximo da fila, mesmo que o
  // boneco ainda esteja andando ate a janela
  if (!emPreparo && fila.length && estado.estoque > 0) {
    const c = fila.shift();
    reorganizarFila();
    emPreparo = { cliente: c, restante: tempoPreparo() };
  }

  // deslocamento entre pontos
  if (estado.movendo) {
    estado.movendo.restante -= dm;
    const alvo = estado.movendo.destino;
    const dx = alvo.x - truck.position.x;
    truck.position.x += dx * Math.min(1, dt * 1.4);
    app.controles.target.x += (alvo.x - app.controles.target.x) * Math.min(1, dt * 1.4);
    app.camera.position.x += (alvo.x - app.camera.position.x) * Math.min(1, dt * 1.4);
    if (estado.movendo.restante <= 0) {
      posicionarTruck(alvo.x);
      app.controles.target.set(alvo.x, 1.5, 1);
      estado.ponto = alvo;
      estado.movendo = null;
      log.escrever(`estacionado em ${alvo.nome}`, 'aten');
      atualizarHud();
    }
  }
}

// ---------------------------------------------------------------- dia

function limparRua() {
  pedestres.slice().forEach(descartarPedestre);
  fila.length = 0;
  emPreparo = null;
}

function fecharDia() {
  const salarios = Math.max(0, estado.equipe - 1) * SALARIO_DIA;
  const aluguel = estado.ponto.aluguel;
  estado.caixa -= aluguel + salarios;

  const d = estado.d;
  const lucro = d.receita - d.insumos - aluguel - salarios;
  const espera = d.esperaN ? d.esperaSoma / d.esperaN : 0;
  const ticket = d.vendas ? d.receita / d.vendas : 0;

  modal.abrir(`
    <h2>Fechamento do dia ${estado.dia}</h2>
    <p>${estado.ponto.nome}</p>
    <h3>Operacao</h3>
    <table>
      <tr><td>Lanches vendidos</td><td>${d.vendas}</td></tr>
      <tr><td>Ticket medio</td><td>${moeda(ticket, 2)}</td></tr>
      <tr><td>Espera media na fila</td><td>${espera.toFixed(1)} min</td></tr>
      <tr><td>Perdidos por fila</td><td class="${d.perdidosFila > d.vendas * 0.25 ? 'neg' : ''}">${d.perdidosFila}</td></tr>
      <tr><td>Perdidos por falta de estoque</td><td class="${d.perdidosEstoque ? 'neg' : ''}">${d.perdidosEstoque}</td></tr>
      <tr><td>Estoque em maos</td><td>${estado.estoque} un</td></tr>
    </table>
    <h3>Resultado</h3>
    <table>
      <tr><td>Receita</td><td class="pos">${moeda(d.receita, 2)}</td></tr>
      <tr><td>Insumos comprados</td><td class="neg">-${moeda(d.insumos, 2)}</td></tr>
      <tr><td>Ponto / autorizacao</td><td class="neg">-${moeda(aluguel, 2)}</td></tr>
      <tr><td>Salarios</td><td class="neg">-${moeda(salarios, 2)}</td></tr>
      <tr><td><b>Lucro do dia</b></td><td class="${lucro >= 0 ? 'pos' : 'neg'}"><b>${moeda(lucro, 2)}</b></td></tr>
      <tr><td>Investimentos</td><td>${moeda(d.capex, 2)}</td></tr>
      <tr><td><b>Caixa</b></td><td><b>${moeda(estado.caixa, 2)}</b></td></tr>
    </table>
    <button class="btn btn-primario" data-fechar>Comecar o dia ${estado.dia + 1}</button>
  `, proximoDia);

  app.pausar(true);
}

function proximoDia() {
  app.pausar(false);
  limparRua();
  estado.dia++;
  estado.hora = ABRE;
  estado.d = { receita: 0, insumos: 0, capex: 0, vendas: 0, perdidosFila: 0, perdidosEstoque: 0, esperaSoma: 0, esperaN: 0 };
  log.escrever(`--- dia ${estado.dia} · ${estado.ponto.nome} ---`, 'aten');
  atualizarHud();
}

// ---------------------------------------------------------------- hud

const topo = criarTopo('Food Truck', 'ponto · preco · estoque');
const avisar = criarAviso();
const modal = criarModal();

const pEsq = criarPainel({ lado: 'esq', titulo: 'Negocio', subtitulo: 'onde parar e por quanto vender', largura: 276 });
const pDir = criarPainel({ lado: 'dir', titulo: 'Painel do dia', subtitulo: 'fluxo, fila e resultado', largura: 262 });

pEsq.secao('Ponto');
const grupoPontos = pEsq.grupo(
  PONTOS.map((p) => ({ rotulo: `${p.nome} <small>${moeda(p.aluguel)}/dia</small>`, valor: p.id, dica: p.resumo })),
  (id) => moverPara(id),
  { selecionado: PONTOS[0].id },
);
const infoPonto = pEsq.texto('');

function moverPara(id) {
  const alvo = PONTOS.find((p) => p.id === id);
  if (!alvo || alvo === estado.ponto) return;
  if (estado.caixa < PRECO.combustivel) { avisar('Sem caixa nem para o combustivel.', 1800, 'ruim'); return; }
  estado.caixa -= PRECO.combustivel;
  estado.d.capex += PRECO.combustivel;
  limparRua();
  estado.movendo = { destino: alvo, restante: 45 };   // 45 min de deslocamento
  log.escrever(`saindo para ${alvo.nome} (45 min parado)`, 'aten');
  atualizarHud();
}

pEsq.secao('Preco e estoque');
pEsq.deslizante('Preco do lanche', {
  min: 12, max: 45, passo: 1, valor: estado.preco,
  formato: (v) => moeda(v),
  aoMudar: (v) => { estado.preco = v; atualizarHud(); },
});
pEsq.stat('margem', 'Margem por lanche', '—');
pEsq.stat('conv', 'Conversao estimada', '—', 'Chance de um pedestre que passa virar cliente agora.');
pEsq.botao(`Comprar ${LOTE} un <small>${moeda(CUSTO_INSUMO * LOTE, 2)}</small>`, () => {
  const c = CUSTO_INSUMO * LOTE;
  if (estado.caixa < c) { avisar('Caixa insuficiente.', 1500, 'ruim'); return; }
  estado.caixa -= c;
  estado.d.insumos += c;
  estado.estoque += LOTE;
  log.escrever(`comprou ${LOTE} un de insumo (${moeda(c, 2)})`);
  atualizarHud();
}, { id: 'bEstoque' });

pEsq.secao('Estrutura');
pEsq.botao(`Chapa dupla <small>${moeda(PRECO.chapa)}</small>`, () => {
  if (estado.chapaDupla) { avisar('Ja instalada.', 1200); return; }
  if (estado.caixa < PRECO.chapa) { avisar('Caixa insuficiente.', 1500, 'ruim'); return; }
  estado.caixa -= PRECO.chapa;
  estado.d.capex += PRECO.chapa;
  estado.chapaDupla = true;
  log.escrever('chapa dupla instalada: preparo 45% mais rapido', 'bom');
  atualizarHud();
}, { id: 'bChapa' });

pEsq.botao(`Toldo e vitrine <small>${moeda(PRECO.toldo)}</small>`, () => {
  if (estado.toldo) { avisar('Ja instalado.', 1200); return; }
  if (estado.caixa < PRECO.toldo) { avisar('Caixa insuficiente.', 1500, 'ruim'); return; }
  estado.caixa -= PRECO.toldo;
  estado.d.capex += PRECO.toldo;
  estado.toldo = true;
  toldoMesh.visible = true;
  log.escrever('toldo instalado: +12% de conversao', 'bom');
  atualizarHud();
}, { id: 'bToldo' });

pEsq.botao(`Contratar ajudante <small>${moeda(SALARIO_DIA)}/dia</small>`, () => {
  if (estado.equipe >= 3) { avisar('Nao cabe mais gente no truck.', 1400); return; }
  estado.equipe++;
  cozinheiros.forEach((c, k) => { c.visible = k < estado.equipe; });
  log.escrever(`equipe agora com ${estado.equipe}`, 'aten');
  atualizarHud();
});
pEsq.botao('Dispensar ajudante', () => {
  if (estado.equipe <= 1) return;
  estado.equipe--;
  cozinheiros.forEach((c, k) => { c.visible = k < estado.equipe; });
  atualizarHud();
}, { classe: 'btn-perigo' });

pEsq.secao('Tempo');
pEsq.grupo([
  { rotulo: 'Pausa', valor: 0 },
  { rotulo: '1x', valor: 1 },
  { rotulo: '2x', valor: 2 },
  { rotulo: '4x', valor: 4 },
], (v) => { estado.velocidade = v; }, { selecionado: 1 });

pEsq.botao('Como jogar', () => modal.abrir(`
  <h2>Como jogar</h2>
  <p>Voce toca um food truck. Escolhe onde estacionar, por quanto vender e quanto insumo carregar.</p>
  <h3>O que decide o resultado</h3>
  <p>· <b>Ponto</b>: cada lugar tem uma curva de movimento propria. Centro so almoco; boemia so a noite. Mudar de ponto custa combustivel e 45 minutos parado.<br>
     · <b>Preco</b>: acima de ${moeda(PRECO_REF)} a conversao cai — e no campus cai mais rapido que na boemia.<br>
     · <b>Fila</b>: quem chega e ve fila grande passa direto. Chapa dupla e ajudante encurtam o preparo.<br>
     · <b>Estoque</b>: sem insumo nao ha venda. Sobra de estoque nao estraga, mas prende caixa.<br>
     · <b>Reputacao</b>: sobe com atendimento rapido e multiplica a conversao dos proximos dias.</p>
  <button class="btn btn-primario" data-fechar>Entendi</button>
`));

pDir.secao('Agora');
pDir.stat('hora', 'Relogio', hhmm(ABRE));
pDir.stat('ponto', 'Ponto', PONTOS[0].nome);
pDir.stat('fluxo', 'Fluxo/hora', '0');
pDir.stat('fila', 'Fila', '0');
pDir.stat('prep', 'Preparo', '—');
pDir.barra('rep', 'Reputacao');

pDir.secao('Dia');
pDir.stat('vendas', 'Vendas', '0');
pDir.stat('estoque', 'Estoque', String(estado.estoque));
pDir.stat('perdF', 'Perdidos (fila)', '0');
pDir.stat('perdE', 'Perdidos (estoque)', '0');

pDir.secao('Financeiro');
pDir.stat('caixa', 'Caixa', moeda(estado.caixa));
pDir.stat('rec', 'Receita do dia', moeda(0));
pDir.stat('cus', 'Insumos do dia', moeda(0));
pDir.stat('parc', 'Parcial', moeda(0));

pDir.secao('Eventos');
const log = pDir.log(60);
log.escrever(`--- dia 1 · ${PONTOS[0].nome} ---`, 'aten');

function atualizarHud() {
  const margem = estado.preco - CUSTO_INSUMO;
  pEsq.set('margem', moeda(margem, 2), margem > 10 ? 'bom' : margem > 4 ? 'medio' : 'ruim');
  const conv = probConversao();
  pEsq.set('conv', (conv * 100).toFixed(1) + '%', conv > 0.16 ? 'bom' : conv > 0.07 ? 'medio' : 'ruim');
  infoPonto.innerHTML = `<b>${estado.ponto.nome}</b> — ${estado.ponto.resumo}`;

  pDir.set('hora', hhmm(estado.hora));
  pDir.set('ponto', estado.movendo ? 'em deslocamento' : estado.ponto.nome);
  pDir.set('fluxo', Math.round(taxaPedestres(estado.hora)) + '/h');
  pDir.set('fila', String(fila.length), fila.length < 3 ? 'bom' : fila.length < 6 ? 'medio' : 'ruim');
  pDir.set('prep', tempoPreparo().toFixed(1) + ' min');
  pDir.setBarra('rep', estado.reputacao,
    estado.reputacao > 0.65 ? '#57c98a' : estado.reputacao > 0.4 ? '#e6b352' : '#e06a6a');

  pDir.set('vendas', String(estado.d.vendas), 'bom');
  pDir.set('estoque', String(estado.estoque), estado.estoque > 15 ? 'bom' : estado.estoque > 0 ? 'medio' : 'ruim');
  pDir.set('perdF', String(estado.d.perdidosFila), estado.d.perdidosFila ? 'ruim' : 'bom');
  pDir.set('perdE', String(estado.d.perdidosEstoque), estado.d.perdidosEstoque ? 'ruim' : 'bom');

  pDir.set('caixa', moeda(estado.caixa), estado.caixa >= 0 ? 'bom' : 'ruim');
  pDir.set('rec', moeda(estado.d.receita, 2));
  pDir.set('cus', moeda(estado.d.insumos, 2));
  const parcial = estado.d.receita - estado.d.insumos;
  pDir.set('parc', (parcial >= 0 ? '+' : '') + moeda(parcial, 2), parcial >= 0 ? 'bom' : 'ruim');

  pEsq.setBotao('bEstoque', null, estado.caixa < CUSTO_INSUMO * LOTE);
  pEsq.setBotao('bChapa', estado.chapaDupla ? 'Chapa dupla <small>instalada</small>' : null, estado.chapaDupla || estado.caixa < PRECO.chapa);
  pEsq.setBotao('bToldo', estado.toldo ? 'Toldo e vitrine <small>instalado</small>' : null, estado.toldo || estado.caixa < PRECO.toldo);

  grupoPontos.botoes.forEach((b, k) => { b.classList.toggle('ativo', PONTOS[k] === estado.ponto); });
}

// ---------------------------------------------------------------- laco

let acumHud = 0;

app.aoQuadro((dt) => {
  if (estado.velocidade === 0 || modal.aberto()) return;

  const dtSim = dt * estado.velocidade;
  const dm = dtSim * MIN_POR_SEG;
  estado.hora += dm / 60;

  simular(dm, dtSim);

  // ceu e luz de trabalho
  const luzDia = aplicarHora(app, estado.hora, { raio: 90, intensidadeMax: 1.9 });
  const noite = limitar((0.3 - luzDia) / 0.3, 0, 1);
  luzBalcao.intensity = noite * 22;
  letreiro.material.emissiveIntensity = noite * 1.1;

  if (estado.hora >= FECHA && !modal.aberto()) {
    limparRua();
    fecharDia();
    return;
  }

  topo.setRelogio(`dia ${estado.dia} · ${hhmm(estado.hora)}`);

  acumHud += dt;
  if (acumHud > 0.2) { acumHud = 0; atualizarHud(); }
});

atualizarHud();
app.iniciar();

// gancho de inspecao usado por testes/quadros.html
window.__dbg = { estado, pedestres, fila, PONTOS, get emPreparo() { return emPreparo; } };
