// lavanderia.js — Simulador de lavanderia self-service.
// Fila de clientes, ciclos de lavagem/secagem, desgaste de maquinas,
// precificacao com elasticidade, reputacao e fechamento diario.

import { criarApp, criarPessoa, THREE } from '../comum/motor.js';
import { criarPainel, criarTopo, criarAviso, criarModal } from '../comum/hud.js';
import { criarRng, limitar, moeda, hhmm } from '../comum/rng.js';

// ---------------------------------------------------------------- parametros

const SALA = { x: 22, z: 16 };          // dimensoes internas
const MAX_MAQ = 9;                      // slots por parede
const MIN_POR_SEG = 10;                 // minutos simulados por segundo real (velocidade 1x)

const ABRE = 7, FECHA = 22;

const T_LAVAGEM = 30;                   // minutos
const T_SECAGEM = 24;
const T_DOBRA = 10;

const PRECO_REF = 32;                   // referencia de mercado (lavar + secar)
const CUSTO_LAVAGEM = 4.2;              // agua, energia, sabao
const CUSTO_SECAGEM = 3.6;

const PRECO = {
  lavadora: 3800, secadora: 3200,
  reparo: 450, preventiva: 150, marketing: 400,
};
const ALUGUEL_DIA = 180;
const SALARIO_DIA = 120;

// curva de movimento do bairro por hora (multiplicador da taxa base)
const CURVA = {
  7: 0.5, 8: 1.1, 9: 1.5, 10: 1.4, 11: 1.1, 12: 0.7, 13: 0.6, 14: 0.8,
  15: 0.9, 16: 1.0, 17: 1.3, 18: 1.7, 19: 1.8, 20: 1.4, 21: 0.8,
};
const LAMBDA_BASE = 5.0;                // clientes/hora no pico neutro

// ---------------------------------------------------------------- estado

const rng = criarRng(77001);

const estado = {
  dia: 1,
  hora: ABRE,
  velocidade: 1,
  aberto: true,
  caixa: 12000,
  precoLavagem: 18,
  precoSecagem: 14,
  funcionarios: 1,
  reputacao: 0.70,
  marketingDias: 0,
  atendidos: 0,
  perdidos: 0,
  totalAtendidos: 0,
  // caixa do dia
  d: { receita: 0, insumos: 0, reparos: 0, capex: 0, atendidos: 0, perdidos: 0, esperaSoma: 0, esperaN: 0 },
};

// ---------------------------------------------------------------- cena

const app = criarApp({
  corFundo: 0x1a2030,
  posCamera: [0, 18, 24],
  alvoCamera: [0, 1.5, 0],
  fov: 48,
  distMin: 8,
  distMax: 60,
  raioSombra: 26,
});
app.controles.maxPolarAngle = Math.PI / 2 - 0.12;

// iluminacao interna: o sol do motor fica fraco, quem manda sao as luminarias
app.sol.intensity = 0.35;
app.sol.position.set(12, 26, 10);
app.luzCeu.intensity = 0.45;

const matPiso = new THREE.MeshStandardMaterial({ color: 0xd8d5cd, roughness: 0.55, metalness: 0.02 });
const piso = new THREE.Mesh(new THREE.PlaneGeometry(SALA.x, SALA.z), matPiso);
piso.rotation.x = -Math.PI / 2;
piso.receiveShadow = true;
app.cena.add(piso);

// ladrilhos: grade sutil sobre o piso
const grade = new THREE.GridHelper(SALA.x, SALA.x / 2, 0x8f8b82, 0x8f8b82);
grade.position.y = 0.01;
grade.material.opacity = 0.35;
grade.material.transparent = true;
app.cena.add(grade);

const matParede = new THREE.MeshStandardMaterial({ color: 0xeaf0f4, roughness: 0.9, side: THREE.DoubleSide });
function parede(largura, altura, x, y, z, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(largura, altura), matParede);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  app.cena.add(m);
  return m;
}
const H_PAREDE = 4;
parede(SALA.x, H_PAREDE, 0, H_PAREDE / 2, -SALA.z / 2, 0);           // fundo (com porta)
parede(SALA.z, H_PAREDE, -SALA.x / 2, H_PAREDE / 2, 0, Math.PI / 2); // esquerda
parede(SALA.z, H_PAREDE, SALA.x / 2, H_PAREDE / 2, 0, Math.PI / 2);  // direita

// fachada (z = +SALA.z/2): meia-parede com vao de porta, para nao tapar a camera
const PORTA = { x: 0, z: SALA.z / 2 };
const H_FACHADA = 1.1;
parede(SALA.x / 2 - 1.5, H_FACHADA, -SALA.x / 4 - 0.75, H_FACHADA / 2, PORTA.z, 0);
parede(SALA.x / 2 - 1.5, H_FACHADA, SALA.x / 4 + 0.75, H_FACHADA / 2, PORTA.z, 0);

// placa do estabelecimento sobre o vao
const matPoste = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.7 });
for (const px of [-1.6, 1.6]) {
  const poste = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.0, 0.16), matPoste);
  poste.position.set(px, 1.5, PORTA.z);
  poste.castShadow = true;
  app.cena.add(poste);
}
const placa = new THREE.Mesh(
  new THREE.BoxGeometry(3.6, 0.7, 0.16),
  new THREE.MeshStandardMaterial({ color: 0x2f6fd0, emissive: 0x2f6fd0, emissiveIntensity: 0.35, roughness: 0.5 }),
);
placa.position.set(0, 3.1, PORTA.z);
placa.castShadow = true;
app.cena.add(placa);

// luminarias
for (const lx of [-6, 0, 6]) {
  const l = new THREE.PointLight(0xfff0d8, 60, 26, 2);
  l.position.set(lx, 3.6, 0);
  app.cena.add(l);
  const bulbo = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.12, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 1.4 }),
  );
  bulbo.position.set(lx, 3.85, 0);
  app.cena.add(bulbo);
}

// ---------------------------------------------------------------- mobiliario

const matMesa = new THREE.MeshStandardMaterial({ color: 0xc9b394, roughness: 0.8 });
const mesa = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.18, 1.5), matMesa);
mesa.position.set(0, 0.92, 4.4);
mesa.castShadow = true; mesa.receiveShadow = true;
app.cena.add(mesa);
for (const px of [-3.0, 3.0]) {
  for (const pz of [-0.6, 0.6]) {
    const pe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), matMesa);
    pe.position.set(px, 0.45, 4.4 + pz);
    app.cena.add(pe);
  }
}
const PONTOS_DOBRA = [-2.4, -0.8, 0.8, 2.4].map((x) => ({ x, z: 3.2, ocupado: false }));

// bancos de espera
const matBanco = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.8 });
for (const bx of [-4.5, 4.5]) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.9), matBanco);
  b.position.set(bx, 0.5, 6.2);
  b.castShadow = true;
  app.cena.add(b);
}

// pontos de espera (fila informal no meio da sala)
const PONTOS_ESPERA = [];
for (let k = 0; k < 12; k++) {
  PONTOS_ESPERA.push({ x: -3.3 + (k % 6) * 1.3, z: 6.6 - Math.floor(k / 6) * 1.3, ocupado: false });
}

// ---------------------------------------------------------------- maquinas

const geoCorpoMaq = new THREE.BoxGeometry(1.25, 1.35, 1.2);
const geoTambor = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 20);
const geoAro = new THREE.TorusGeometry(0.46, 0.06, 8, 22);

const matLavadora = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.35, metalness: 0.25 });
const matSecadora = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.35, metalness: 0.3 });
const matAro = new THREE.MeshStandardMaterial({ color: 0x8d95a3, roughness: 0.4, metalness: 0.6 });
const matVidro = new THREE.MeshStandardMaterial({ color: 0x2b3448, roughness: 0.15, metalness: 0.1 });

const maquinas = [];

function posSlot(tipo, slot) {
  const z = -5.6 + slot * 1.4;
  // a porta da maquina fica no +x local; lavadoras encaram o centro (+x), secadoras o oposto
  return tipo === 'lavadora'
    ? { x: -SALA.x / 2 + 1.1, z, frenteX: -SALA.x / 2 + 2.6, giro: 0 }
    : { x: SALA.x / 2 - 1.1, z, frenteX: SALA.x / 2 - 2.6, giro: Math.PI };
}

function comprarMaquina(tipo, cobrar = true) {
  const doTipo = maquinas.filter((m) => m.tipo === tipo);
  if (doTipo.length >= MAX_MAQ) { avisar('Sem espaco na parede para mais maquinas.', 1800); return null; }
  if (cobrar) {
    const p = PRECO[tipo];
    if (estado.caixa < p) { avisar('Caixa insuficiente.', 1600, 'ruim'); return null; }
    estado.caixa -= p;
    estado.d.capex += p;
    log.escrever(`comprou ${tipo} por ${moeda(p)}`, 'aten');
  }

  const slot = doTipo.length;
  const p = posSlot(tipo, slot);
  const g = new THREE.Group();

  const corpo = new THREE.Mesh(geoCorpoMaq, tipo === 'lavadora' ? matLavadora : matSecadora);
  corpo.position.y = 0.68;
  corpo.castShadow = true; corpo.receiveShadow = true;
  g.add(corpo);

  const tambor = new THREE.Mesh(geoTambor, matVidro);
  tambor.rotation.z = Math.PI / 2;
  tambor.position.set(0.62, 0.75, 0);
  g.add(tambor);

  const aro = new THREE.Mesh(geoAro, matAro);
  aro.rotation.y = Math.PI / 2;
  aro.position.set(0.63, 0.75, 0);
  g.add(aro);

  const luz = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f9e5a, emissive: 0x2f9e5a, emissiveIntensity: 1.2 }),
  );
  luz.position.set(0.6, 1.24, 0.38);
  g.add(luz);

  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.giro;
  app.cena.add(g);

  const maq = {
    tipo, slot, grupo: g, tambor, luz,
    // livre | rodando | concluida (esperando o dono retirar) | quebrada
    estado: 'livre',
    dono: null,
    restante: 0,
    desgaste: 0,
    frente: { x: p.frenteX, z: p.z },
    ciclos: 0,
  };
  maquinas.push(maq);
  atualizarHud();
  return maq;
}

const COR_LUZ = {
  livre: 0x2f9e5a, rodando: 0xe0a83c, concluida: 0x2fb3b3, quebrada: 0xd94f4f,
};

/** Libera a maquina quando o dono retira a roupa (ou desiste). */
function liberar(m) {
  if (!m) return;
  m.dono = null;
  if (m.estado !== 'quebrada') m.estado = 'livre';
  pintarLuz(m);
}

function pintarLuz(m) {
  const c = COR_LUZ[m.estado];
  m.luz.material.color.setHex(c);
  m.luz.material.emissive.setHex(c);
}

function livres(tipo) { return maquinas.filter((m) => m.tipo === tipo && m.estado === 'livre'); }
function contar(tipo, st) { return maquinas.filter((m) => m.tipo === tipo && (!st || m.estado === st)).length; }
function quebradas() { return maquinas.filter((m) => m.estado === 'quebrada'); }

// ---------------------------------------------------------------- clientes

const clientes = [];
const VEL = 2.4;

function pontoLivre(lista) { return lista.find((p) => !p.ocupado) ?? null; }

function novoCliente() {
  const cor = [0xd94f4f, 0x3f7fd0, 0x53a86e, 0xd9a83c, 0x8f6ad0, 0x2fb3b3][rng.inteiro(0, 5)];
  const g = criarPessoa(cor, rng.entre(0.92, 1.08));
  g.position.set(PORTA.x + rng.entre(-0.6, 0.6), 0, PORTA.z + 2.5);
  app.cena.add(g);

  // cesto de roupa carregado ate a lavadora
  const cesto = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.32),
    new THREE.MeshStandardMaterial({ color: 0xe8e3d6, roughness: 0.9 }),
  );
  cesto.position.set(0.3, 0.72, 0.16);
  cesto.castShadow = true;
  g.add(cesto);

  const c = {
    grupo: g, cesto,
    fase: 'entrando',
    alvo: null,
    ponto: null,
    maq: null,
    espera: 0,
    paciencia: rng.entre(25, 60),   // minutos que aceita esperar na fila
    tempo: 0,
    pago: 0,
  };
  clientes.push(c);
  return c;
}

function irPara(c, x, z) { c.alvo = { x, z }; }

function chegou(c) {
  if (!c.alvo) return true;
  const dx = c.alvo.x - c.grupo.position.x;
  const dz = c.alvo.z - c.grupo.position.z;
  return dx * dx + dz * dz < 0.09;
}

function mover(c, dt) {
  if (!c.alvo) return;
  const dx = c.alvo.x - c.grupo.position.x;
  const dz = c.alvo.z - c.grupo.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  const passo = Math.min(VEL * dt, d);
  c.grupo.position.x += (dx / d) * passo;
  c.grupo.position.z += (dz / d) * passo;
  c.grupo.rotation.y = Math.atan2(dx, dz);
}

function soltarPonto(c) {
  if (c.ponto) { c.ponto.ocupado = false; c.ponto = null; }
}

/**
 * Tira o cliente da sala. `satisfeito` contabiliza atendimento;
 * desistencias ja foram contadas em `desistir`, entao aqui nao contam de novo.
 */
function removerCliente(c, satisfeito) {
  soltarPonto(c);
  app.cena.remove(c.grupo);
  c.grupo.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
  const i = clientes.indexOf(c);
  if (i >= 0) clientes.splice(i, 1);
  if (!satisfeito) return;
  estado.atendidos++;
  estado.totalAtendidos++;
  estado.d.atendidos++;
  estado.d.esperaSoma += c.espera;
  estado.d.esperaN++;
  estado.reputacao = limitar(estado.reputacao + (c.espera < 15 ? 0.006 : c.espera < 30 ? 0.002 : -0.004), 0.05, 1);
}

function desistir(c, motivo) {
  log.escrever(`cliente desistiu (${motivo})`, 'ruim');
  soltarPonto(c);
  if (c.maq && c.maq.dono === c) liberar(c.maq);
  c.maq = null;
  c.desistiu = true;
  c.fase = 'saindo';
  irPara(c, PORTA.x, PORTA.z);
  estado.perdidos++;
  estado.d.perdidos++;
  estado.reputacao = limitar(estado.reputacao - 0.015, 0.05, 1);
}

// ---------------------------------------------------------------- logica

function elasticidade() {
  const total = estado.precoLavagem + estado.precoSecagem;
  return limitar(Math.pow(PRECO_REF / Math.max(total, 4), 1.35), 0.15, 2.6);
}

function taxaChegada(hora) {
  const h = Math.floor(hora);
  const mult = CURVA[h] ?? 0;
  const mkt = estado.marketingDias > 0 ? 1.35 : 1;
  const capacidade = limitar((contar('lavadora') + contar('secadora')) / 6, 0.35, 1.25);
  return LAMBDA_BASE * mult * elasticidade() * (0.45 + estado.reputacao * 0.8) * mkt * capacidade;
}

/** Avanca a simulacao em `dm` minutos. */
function simular(dm, dt) {
  // chegadas
  if (estado.aberto && estado.hora < FECHA) {
    const lambdaMin = taxaChegada(estado.hora) / 60;
    const n = rng.poisson(lambdaMin * dm);
    for (let k = 0; k < n; k++) {
      if (clientes.length >= 26) { estado.perdidos++; estado.d.perdidos++; continue; }
      const semLavadora = livres('lavadora').length === 0;
      const filaCheia = clientes.filter((c) => c.fase === 'esperaLavadora').length;
      if (semLavadora && filaCheia >= 6 && rng.chance(0.7)) {
        // desiste na porta ao ver a fila
        estado.perdidos++;
        estado.d.perdidos++;
        estado.reputacao = limitar(estado.reputacao - 0.004, 0.05, 1);
        continue;
      }
      novoCliente();
    }
  }

  // maquinas
  for (const m of maquinas) {
    if (m.estado === 'rodando') {
      m.restante -= dm;
      m.tambor.rotation.x += dt * 6;
      if (m.restante <= 0) {
        m.restante = 0;
        m.ciclos++;
        m.desgaste = limitar(m.desgaste + rng.entre(0.010, 0.022) / (1 + estado.funcionarios * 0.35), 0, 1.4);
        const chanceQuebra = 0.010 + m.desgaste * 0.10;
        if (rng.chance(chanceQuebra / (1 + estado.funcionarios * 0.4))) {
          m.estado = 'quebrada';
          log.escrever(`${m.tipo} #${m.slot + 1} quebrou`, 'ruim');
          avisar(`${m.tipo === 'lavadora' ? 'Lavadora' : 'Secadora'} quebrou — repare no painel.`, 2400, 'ruim');
        } else {
          // fica ocupada ate o dono retirar a roupa; so entao volta a ficar livre
          m.estado = m.dono ? 'concluida' : 'livre';
        }
        pintarLuz(m);
      }
    } else if (m.estado === 'quebrada') {
      m.grupo.position.y = Math.sin(performance.now() / 260) * 0.012;
    }
  }

  // clientes
  for (let i = clientes.length - 1; i >= 0; i--) {
    const c = clientes[i];
    mover(c, dt);
    c.tempo += dm;

    switch (c.fase) {
      case 'entrando':                       // primeiro alinha com o vao da porta
        if (!c.alvo) irPara(c, PORTA.x, PORTA.z);
        if (chegou(c)) { c.fase = 'entrou'; irPara(c, PORTA.x, PORTA.z - 2.0); }
        break;

      case 'entrou':
        if (chegou(c)) { c.fase = 'esperaLavadora'; c.alvo = null; }
        break;

      case 'esperaLavadora': {
        const m = livres('lavadora')[0];
        if (m) {
          // o ciclo comeca na atribuicao: a caminhada e so visual e nao
          // pode custar ocupacao de maquina (o tempo de tela e comprimido)
          soltarPonto(c);
          m.estado = 'rodando';
          m.restante = T_LAVAGEM;
          m.dono = c;
          pintarLuz(m);
          c.maq = m;
          c.grupo.remove(c.cesto);
          c.pago += estado.precoLavagem;
          estado.caixa += estado.precoLavagem - CUSTO_LAVAGEM;
          estado.d.receita += estado.precoLavagem;
          estado.d.insumos += CUSTO_LAVAGEM;
          c.fase = 'lavando';
          irPara(c, m.frente.x, m.frente.z);
        } else {
          c.espera += dm;
          if (!c.ponto) {
            const p = pontoLivre(PONTOS_ESPERA);
            if (p) { p.ocupado = true; c.ponto = p; irPara(c, p.x, p.z); }
          }
          if (c.espera > c.paciencia) desistir(c, 'fila longa');
        }
        break;
      }

      case 'lavando': {
        const m = c.maq;
        if (!m) { c.fase = 'saindo'; irPara(c, PORTA.x, PORTA.z); break; }
        if (m.estado === 'quebrada') {
          // reembolso e cliente vai embora irritado
          estado.caixa -= c.pago;
          estado.d.receita -= c.pago;
          c.maq = null;
          desistir(c, 'maquina quebrou no ciclo');
          break;
        }
        if (m.estado === 'concluida') {
          liberar(m);
          c.maq = null; soltarPonto(c);
          c.fase = 'esperaSecadora'; c.alvo = null;
        }
        break;
      }

      case 'esperaSecadora': {
        const m = livres('secadora')[0];
        if (m) {
          soltarPonto(c);
          m.estado = 'rodando';
          m.restante = T_SECAGEM;
          m.dono = c;
          pintarLuz(m);
          c.maq = m;
          c.pago += estado.precoSecagem;
          estado.caixa += estado.precoSecagem - CUSTO_SECAGEM;
          estado.d.receita += estado.precoSecagem;
          estado.d.insumos += CUSTO_SECAGEM;
          c.fase = 'secando';
          irPara(c, m.frente.x, m.frente.z);
        } else {
          c.espera += dm;
          if (!c.ponto) {
            const p = pontoLivre(PONTOS_ESPERA);
            if (p) { p.ocupado = true; c.ponto = p; irPara(c, p.x, p.z); }
          }
          if (c.espera > c.paciencia * 1.4) desistir(c, 'sem secadora');
        }
        break;
      }

      case 'secando': {
        const m = c.maq;
        if (!m) { c.fase = 'saindo'; irPara(c, PORTA.x, PORTA.z); break; }
        if (m.estado === 'quebrada') {
          estado.caixa -= estado.precoSecagem;
          estado.d.receita -= estado.precoSecagem;
          c.maq = null;
          desistir(c, 'secadora quebrou');
          break;
        }
        if (m.estado === 'concluida') {
          liberar(m);
          c.maq = null; soltarPonto(c);
          c.fase = 'esperaDobra'; c.alvo = null;
        }
        break;
      }

      case 'esperaDobra': {
        const p = pontoLivre(PONTOS_DOBRA);
        if (p) {
          soltarPonto(c);
          p.ocupado = true; c.ponto = p;
          c.fase = 'dobrando';
          c.tempoDobra = T_DOBRA / (1 + estado.funcionarios * 0.25);
          irPara(c, p.x, p.z);
        } else {
          c.espera += dm * 0.5;
          if (!c.ponto) {
            const e = pontoLivre(PONTOS_ESPERA);
            if (e) { e.ocupado = true; c.ponto = e; irPara(c, e.x, e.z); }
          }
        }
        break;
      }

      case 'dobrando':
        c.tempoDobra -= dm;
        if (chegou(c)) c.grupo.rotation.y = Math.PI;   // de frente para a mesa
        if (c.tempoDobra <= 0) {
          soltarPonto(c);
          c.fase = 'saindo';
          irPara(c, PORTA.x, PORTA.z);
        }
        break;

      case 'saindo':                         // sai pelo vao antes de sumir na calcada
        if (chegou(c)) { c.fase = 'saiu'; irPara(c, PORTA.x, PORTA.z + 4.0); }
        break;

      case 'saiu':
        if (chegou(c)) removerCliente(c, !c.desistiu && c.pago > 0);
        break;
    }
  }
}

// ---------------------------------------------------------------- dia

function fecharDia() {
  const salarios = estado.funcionarios * SALARIO_DIA;
  estado.caixa -= ALUGUEL_DIA + salarios;

  const d = estado.d;
  const bruto = d.receita;
  const opex = d.insumos + ALUGUEL_DIA + salarios + d.reparos;
  const lucro = bruto - opex;
  const esperaMedia = d.esperaN > 0 ? d.esperaSoma / d.esperaN : 0;

  modal.abrir(`
    <h2>Fechamento do dia ${estado.dia}</h2>
    <h3>Movimento</h3>
    <table>
      <tr><td>Clientes atendidos</td><td>${d.atendidos}</td></tr>
      <tr><td>Clientes perdidos</td><td class="${d.perdidos > d.atendidos * 0.2 ? 'neg' : ''}">${d.perdidos}</td></tr>
      <tr><td>Espera media na fila</td><td>${esperaMedia.toFixed(0)} min</td></tr>
      <tr><td>Reputacao</td><td>${(estado.reputacao * 100).toFixed(0)}%</td></tr>
    </table>
    <h3>Resultado</h3>
    <table>
      <tr><td>Receita</td><td class="pos">${moeda(bruto, 2)}</td></tr>
      <tr><td>Insumos (agua/energia/sabao)</td><td class="neg">-${moeda(d.insumos, 2)}</td></tr>
      <tr><td>Aluguel</td><td class="neg">-${moeda(ALUGUEL_DIA, 2)}</td></tr>
      <tr><td>Salarios (${estado.funcionarios})</td><td class="neg">-${moeda(salarios, 2)}</td></tr>
      <tr><td>Reparos</td><td class="neg">-${moeda(d.reparos, 2)}</td></tr>
      <tr><td><b>Lucro operacional</b></td><td class="${lucro >= 0 ? 'pos' : 'neg'}"><b>${moeda(lucro, 2)}</b></td></tr>
      <tr><td>Investimento em maquinas</td><td>${moeda(d.capex, 2)}</td></tr>
      <tr><td><b>Caixa final</b></td><td><b>${moeda(estado.caixa, 2)}</b></td></tr>
    </table>
    <button class="btn btn-primario" data-fechar>Abrir o dia ${estado.dia + 1}</button>
  `, abrirProximoDia);

  app.pausar(true);
}

function abrirProximoDia() {
  app.pausar(false);
  estado.dia++;
  estado.hora = ABRE;
  estado.aberto = true;
  estado.d = { receita: 0, insumos: 0, reparos: 0, capex: 0, atendidos: 0, perdidos: 0, esperaSoma: 0, esperaN: 0 };
  if (estado.marketingDias > 0) {
    estado.marketingDias--;
    if (estado.marketingDias === 0) log.escrever('campanha de marketing encerrada');
  }
  log.escrever(`--- dia ${estado.dia} aberto ---`, 'aten');
  atualizarHud();
}

// ---------------------------------------------------------------- hud

const topo = criarTopo('Lavanderia Self-Service', 'fila · maquinas · precificacao');
const avisar = criarAviso();
const modal = criarModal();

const pEsq = criarPainel({ lado: 'esq', titulo: 'Operacao', subtitulo: 'preco, equipe e investimento', largura: 272 });
const pDir = criarPainel({ lado: 'dir', titulo: 'Painel do dia', subtitulo: 'movimento e resultado', largura: 262 });

pEsq.secao('Precos por ciclo');
pEsq.deslizante('Lavagem', {
  min: 8, max: 40, passo: 1, valor: estado.precoLavagem,
  formato: (v) => moeda(v),
  aoMudar: (v) => { estado.precoLavagem = v; atualizarHud(); },
});
pEsq.deslizante('Secagem', {
  min: 6, max: 34, passo: 1, valor: estado.precoSecagem,
  formato: (v) => moeda(v),
  aoMudar: (v) => { estado.precoSecagem = v; atualizarHud(); },
});
pEsq.stat('elast', 'Efeito na demanda', '—', 'Quanto o preco total afeta o fluxo de clientes vs. a referencia do bairro.');
pEsq.texto(`Referencia do bairro: <b>${moeda(PRECO_REF)}</b> pelo ciclo completo. Custo variavel: ${moeda(CUSTO_LAVAGEM + CUSTO_SECAGEM, 2)}.`);

pEsq.secao('Investimento');
pEsq.botao(`Comprar lavadora <small>${moeda(PRECO.lavadora)}</small>`, () => comprarMaquina('lavadora'), { id: 'bLav' });
pEsq.botao(`Comprar secadora <small>${moeda(PRECO.secadora)}</small>`, () => comprarMaquina('secadora'), { id: 'bSec' });

pEsq.secao('Manutencao');
pEsq.botao('Reparar quebradas', () => {
  const qs = quebradas();
  if (!qs.length) { avisar('Nenhuma maquina quebrada.', 1400); return; }
  const total = qs.length * PRECO.reparo;
  if (estado.caixa < total) { avisar('Caixa insuficiente para todos os reparos.', 1800, 'ruim'); return; }
  estado.caixa -= total;
  estado.d.reparos += total;
  qs.forEach((m) => { m.estado = 'livre'; m.dono = null; m.desgaste = 0; m.grupo.position.y = 0; pintarLuz(m); });
  log.escrever(`reparou ${qs.length} maquina(s) por ${moeda(total)}`, 'aten');
  atualizarHud();
}, { id: 'bRep' });

pEsq.botao(`Manutencao preventiva <small>${moeda(PRECO.preventiva)}</small>`, () => {
  if (estado.caixa < PRECO.preventiva) { avisar('Caixa insuficiente.', 1500, 'ruim'); return; }
  estado.caixa -= PRECO.preventiva;
  estado.d.reparos += PRECO.preventiva;
  maquinas.forEach((m) => { if (m.estado !== 'quebrada') m.desgaste = Math.max(0, m.desgaste - 0.5); });
  log.escrever('manutencao preventiva realizada', 'bom');
  atualizarHud();
});

pEsq.secao('Equipe e marketing');
pEsq.botao('Contratar atendente <small>R$ 120/dia</small>', () => {
  if (estado.funcionarios >= 3) { avisar('Equipe no limite (3).', 1400); return; }
  estado.funcionarios++;
  log.escrever(`contratou atendente (${estado.funcionarios} na equipe)`, 'aten');
  atualizarHud();
});
pEsq.botao('Demitir atendente', () => {
  if (estado.funcionarios <= 0) return;
  estado.funcionarios--;
  log.escrever(`equipe reduzida para ${estado.funcionarios}`, 'aten');
  atualizarHud();
}, { classe: 'btn-perigo' });
pEsq.botao(`Campanha local <small>${moeda(PRECO.marketing)}</small>`, () => {
  if (estado.caixa < PRECO.marketing) { avisar('Caixa insuficiente.', 1500, 'ruim'); return; }
  estado.caixa -= PRECO.marketing;
  estado.d.capex += PRECO.marketing;
  estado.marketingDias = 3;
  log.escrever('campanha ativa por 3 dias (+35% de fluxo)', 'bom');
  atualizarHud();
});

pEsq.secao('Tempo');
pEsq.grupo([
  { rotulo: 'Pausa', valor: 0 },
  { rotulo: '1x', valor: 1 },
  { rotulo: '2x', valor: 2 },
  { rotulo: '4x', valor: 4 },
], (v) => { estado.velocidade = v; }, { selecionado: 1 });

pEsq.botao('Como jogar', () => modal.abrir(`
  <h2>Como jogar</h2>
  <p>Voce opera uma lavanderia self-service. O cliente lava, seca, dobra e vai embora — pagando por ciclo.</p>
  <h3>O que decide o resultado</h3>
  <p>· <b>Preco</b>: acima da referencia do bairro o fluxo cai rapido; abaixo, sobe mas a margem some.<br>
     · <b>Capacidade</b>: sem lavadora livre a fila cresce e o cliente desiste. Secadora e o gargalo seguinte.<br>
     · <b>Desgaste</b>: cada ciclo desgasta a maquina. Quebra no meio do ciclo custa reembolso e reputacao.<br>
     · <b>Equipe</b>: reduz quebras e acelera a dobra, mas custa salario todo dia.<br>
     · <b>Reputacao</b>: sobe com espera curta, cai com desistencia. Multiplica o fluxo de amanha.</p>
  <button class="btn btn-primario" data-fechar>Entendi</button>
`));

pDir.secao('Movimento');
pDir.stat('hora', 'Relogio', '07:00');
pDir.stat('naSala', 'Na sala', '0');
pDir.stat('fila', 'Na fila', '0');
pDir.stat('atend', 'Atendidos hoje', '0');
pDir.stat('perd', 'Perdidos hoje', '0');
pDir.barra('rep', 'Reputacao');

pDir.secao('Maquinas');
pDir.stat('lav', 'Lavadoras', '0');
pDir.stat('sec', 'Secadoras', '0');
pDir.stat('queb', 'Quebradas', '0');
pDir.barra('desg', 'Desgaste medio');

pDir.secao('Financeiro do dia');
pDir.stat('caixa', 'Caixa', moeda(estado.caixa));
pDir.stat('recDia', 'Receita', moeda(0));
pDir.stat('cusDia', 'Custos', moeda(0));
pDir.stat('lucDia', 'Parcial', moeda(0));

pDir.secao('Eventos');
const log = pDir.log(60);
log.escrever('--- dia 1 aberto ---', 'aten');

function atualizarHud() {
  const fila = clientes.filter((c) => c.fase === 'esperaLavadora' || c.fase === 'esperaSecadora').length;
  const desgMedio = maquinas.length
    ? maquinas.reduce((s, m) => s + limitar(m.desgaste, 0, 1), 0) / maquinas.length : 0;

  const el = elasticidade();
  pEsq.set('elast', (el >= 1 ? '+' : '') + ((el - 1) * 100).toFixed(0) + '%',
    el >= 1.05 ? 'bom' : el >= 0.8 ? 'medio' : 'ruim');

  pDir.set('hora', hhmm(estado.hora));
  pDir.set('naSala', String(clientes.length));
  pDir.set('fila', String(fila), fila <= 2 ? 'bom' : fila <= 5 ? 'medio' : 'ruim');
  pDir.set('atend', String(estado.d.atendidos), 'bom');
  pDir.set('perd', String(estado.d.perdidos), estado.d.perdidos === 0 ? 'bom' : 'ruim');
  pDir.setBarra('rep', estado.reputacao,
    estado.reputacao > 0.65 ? '#57c98a' : estado.reputacao > 0.4 ? '#e6b352' : '#e06a6a');

  pDir.set('lav', `${contar('lavadora', 'livre')} livre / ${contar('lavadora')}`);
  pDir.set('sec', `${contar('secadora', 'livre')} livre / ${contar('secadora')}`);
  const nq = quebradas().length;
  pDir.set('queb', String(nq), nq === 0 ? 'bom' : 'ruim');
  pDir.setBarra('desg', desgMedio, desgMedio < 0.35 ? '#57c98a' : desgMedio < 0.7 ? '#e6b352' : '#e06a6a');

  const custos = estado.d.insumos + estado.d.reparos;
  const parcial = estado.d.receita - custos;
  pDir.set('caixa', moeda(estado.caixa), estado.caixa >= 0 ? 'bom' : 'ruim');
  pDir.set('recDia', moeda(estado.d.receita, 2));
  pDir.set('cusDia', moeda(custos, 2));
  pDir.set('lucDia', (parcial >= 0 ? '+' : '') + moeda(parcial, 2), parcial >= 0 ? 'bom' : 'ruim');

  pEsq.setBotao('bLav', null, contar('lavadora') >= MAX_MAQ || estado.caixa < PRECO.lavadora);
  pEsq.setBotao('bSec', null, contar('secadora') >= MAX_MAQ || estado.caixa < PRECO.secadora);
  pEsq.setBotao('bRep', `Reparar quebradas <small>${nq ? moeda(nq * PRECO.reparo) : '—'}</small>`, nq === 0);
}

// ---------------------------------------------------------------- laco

let acumHud = 0;

app.aoQuadro((dt) => {
  if (estado.velocidade === 0 || modal.aberto()) return;

  const dm = dt * MIN_POR_SEG * estado.velocidade;
  estado.hora += dm / 60;

  if (estado.hora >= FECHA) estado.aberto = false;

  simular(dm, dt * estado.velocidade);

  if (!estado.aberto && (clientes.length === 0 || estado.hora >= FECHA + 2)) {
    clientes.slice().forEach((c) => removerCliente(c, false));
    fecharDia();
    return;
  }

  topo.setRelogio(`dia ${estado.dia} · ${hhmm(estado.hora)}${estado.aberto ? '' : ' · fechado'}`);

  acumHud += dt;
  if (acumHud > 0.25) { acumHud = 0; atualizarHud(); }
});

// parque de maquinas inicial
for (let k = 0; k < 5; k++) comprarMaquina('lavadora', false);
for (let k = 0; k < 4; k++) comprarMaquina('secadora', false);
maquinas.forEach(pintarLuz);

atualizarHud();
app.iniciar();

// gancho de inspecao usado por testes/quadros.html
window.__dbg = { estado, maquinas, clientes, PONTOS_ESPERA, PONTOS_DOBRA };
