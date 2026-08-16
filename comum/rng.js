// rng.js — gerador pseudoaleatorio com semente (mulberry32) para simulacoes reproduziveis.

/** Cria um RNG a partir de uma semente numerica. */
export function criarRng(semente = 12345) {
  let a = semente >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.entre = (min, max) => min + rng() * (max - min);
  rng.inteiro = (min, max) => Math.floor(min + rng() * (max - min + 1));
  rng.escolha = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  /** Amostra de uma Poisson com media lambda (Knuth). */
  rng.poisson = (lambda) => {
    if (lambda <= 0) return 0;
    if (lambda > 30) { // aproximacao normal para lambdas altos
      const u1 = Math.max(rng(), 1e-9), u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
    }
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  };
  /** Semente pode ser trocada em runtime (reiniciar simulacao). */
  rng.semear = (s) => { a = s >>> 0; };
  return rng;
}

/** Semente derivada da data/hora, para quem quiser partida diferente a cada abertura. */
export function sementeAleatoria() {
  return (Math.random() * 0xffffffff) >>> 0;
}

export const limitar = (v, min, max) => Math.min(max, Math.max(min, v));
export const misturar = (a, b, t) => a + (b - a) * t;

/** Formata em reais (pt-BR). */
export function moeda(v, casas = 0) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Formata hora decimal (13.5 -> "13:30"). */
export function hhmm(horaDecimal) {
  const h = Math.floor(((horaDecimal % 24) + 24) % 24);
  const m = Math.floor((horaDecimal - Math.floor(horaDecimal)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
