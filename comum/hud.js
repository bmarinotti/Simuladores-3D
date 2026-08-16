// hud.js — construtor de painel HTML sobreposto ao canvas WebGL.
// Evita repetir DOM cru nos tres simuladores.

/**
 * Cria um painel ancorado num canto da tela.
 * @param {object} cfg {lado:'esq'|'dir', titulo, subtitulo, largura}
 */
export function criarPainel({ lado = 'esq', titulo = '', subtitulo = '', largura = 268, recolhivel = true } = {}) {
  const el = document.createElement('div');
  el.className = `painel painel-${lado}`;
  el.style.width = largura + 'px';

  const cabecalho = document.createElement('div');
  cabecalho.className = 'painel-cab';
  cabecalho.innerHTML = `<span class="painel-titulo">${titulo}</span>` +
    (subtitulo ? `<span class="painel-sub">${subtitulo}</span>` : '');
  el.appendChild(cabecalho);

  const corpo = document.createElement('div');
  corpo.className = 'painel-corpo';
  el.appendChild(corpo);

  const ehCelular = () => window.matchMedia('(max-width: 760px)').matches;

  if (recolhivel) {
    cabecalho.classList.add('clicavel');
    cabecalho.title = 'Clique para recolher/expandir';
    cabecalho.addEventListener('click', () => {
      const vaiAbrir = el.classList.contains('recolhido');
      // em celular so uma folha (bottom sheet) fica aberta por vez
      if (vaiAbrir && ehCelular()) {
        document.querySelectorAll('.painel').forEach((p) => { if (p !== el) p.classList.add('recolhido'); });
      }
      el.classList.toggle('recolhido');
    });
  }

  // em celular a tela comeca com os paineis recolhidos (chips), pra nao tapar a cena 3D
  if (recolhivel && ehCelular()) el.classList.add('recolhido');

  document.body.appendChild(el);

  const stats = new Map();

  const api = {
    el, corpo,

    secao(texto) {
      const s = document.createElement('div');
      s.className = 'secao';
      s.textContent = texto;
      corpo.appendChild(s);
      return api;
    },

    /** Linha de leitura: rotulo a esquerda, valor a direita. */
    stat(id, rotulo, valorInicial = '—', dica = '') {
      const linha = document.createElement('div');
      linha.className = 'stat';
      if (dica) linha.title = dica;
      const r = document.createElement('span');
      r.className = 'stat-rot';
      r.textContent = rotulo;
      const v = document.createElement('span');
      v.className = 'stat-val';
      v.textContent = valorInicial;
      linha.append(r, v);
      corpo.appendChild(linha);
      stats.set(id, v);
      return api;
    },

    set(id, valor, classe = null) {
      const v = stats.get(id);
      if (!v) return api;
      v.textContent = valor;
      v.className = 'stat-val' + (classe ? ' ' + classe : '');
      return api;
    },

    /** Barra de progresso 0..1. */
    barra(id, rotulo) {
      const linha = document.createElement('div');
      linha.className = 'barra-wrap';
      linha.innerHTML = `<span class="stat-rot">${rotulo}</span><span class="barra"><i></i></span>`;
      corpo.appendChild(linha);
      stats.set('__barra__' + id, linha.querySelector('i'));
      return api;
    },

    setBarra(id, fracao, cor = null) {
      const i = stats.get('__barra__' + id);
      if (!i) return api;
      i.style.transform = `scaleX(${Math.max(0, Math.min(1, fracao))})`;
      if (cor) i.style.background = cor;
      return api;
    },

    botao(rotulo, aoClicar, { classe = '', dica = '', id = null } = {}) {
      const b = document.createElement('button');
      b.className = 'btn ' + classe;
      b.innerHTML = rotulo;
      if (dica) b.title = dica;
      b.addEventListener('click', (e) => { e.stopPropagation(); aoClicar(b); });
      corpo.appendChild(b);
      if (id) stats.set('__btn__' + id, b);
      return b;
    },

    setBotao(id, html, desabilitado = null) {
      const b = stats.get('__btn__' + id);
      if (!b) return api;
      if (html !== null) b.innerHTML = html;
      if (desabilitado !== null) b.disabled = desabilitado;
      return api;
    },

    /** Grupo de botoes em linha (ferramentas, seletores). */
    grupo(itens, aoSelecionar, { selecionado = null } = {}) {
      const g = document.createElement('div');
      g.className = 'grupo';
      const botoes = [];
      itens.forEach((it) => {
        const b = document.createElement('button');
        b.className = 'btn btn-grupo';
        // ponto de cor discreto antes do rotulo (ex.: cor da zona), em vez de borda lateral
        b.innerHTML = (it.cor ? `<i class="ponto" style="background:${it.cor}"></i>` : '') + it.rotulo;
        if (it.dica) b.title = it.dica;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          botoes.forEach((x) => x.classList.remove('ativo'));
          b.classList.add('ativo');
          aoSelecionar(it.valor, it);
        });
        if (it.valor === selecionado) b.classList.add('ativo');
        g.appendChild(b);
        botoes.push(b);
      });
      corpo.appendChild(g);
      return { el: g, botoes };
    },

    deslizante(rotulo, { min = 0, max = 100, passo = 1, valor = 50, formato = (v) => v, aoMudar = () => {} } = {}) {
      const wrap = document.createElement('div');
      wrap.className = 'deslizante';
      const cab = document.createElement('div');
      cab.className = 'stat';
      const r = document.createElement('span'); r.className = 'stat-rot'; r.textContent = rotulo;
      const v = document.createElement('span'); v.className = 'stat-val'; v.textContent = formato(valor);
      cab.append(r, v);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = passo; input.value = valor;
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        v.textContent = formato(n);
        aoMudar(n);
      });
      wrap.append(cab, input);
      corpo.appendChild(wrap);
      return { input, setValor: (n) => { input.value = n; v.textContent = formato(n); } };
    },

    texto(html, classe = '') {
      const p = document.createElement('div');
      p.className = 'texto ' + classe;
      p.innerHTML = html;
      corpo.appendChild(p);
      return p;
    },

    /** Console de eventos, mantem as ultimas N linhas. */
    log(maxLinhas = 60) {
      const box = document.createElement('div');
      box.className = 'log';
      corpo.appendChild(box);
      return {
        el: box,
        escrever(msg, classe = '') {
          const l = document.createElement('div');
          l.className = 'log-linha ' + classe;
          l.innerHTML = msg;
          box.appendChild(l);
          while (box.childElementCount > maxLinhas) box.removeChild(box.firstChild);
          box.scrollTop = box.scrollHeight;
        },
        limpar() { box.innerHTML = ''; },
      };
    },
  };

  return api;
}

/** Faixa superior com titulo do simulador e link de volta ao hub. */
export function criarTopo(titulo, subtitulo = '') {
  const el = document.createElement('div');
  el.className = 'topo';
  el.innerHTML = `
    <a class="voltar" href="../index.html" title="Voltar ao hub">&#8592;</a>
    <div class="topo-txt"><b>${titulo}</b><span>${subtitulo}</span></div>
    <div class="topo-relogio" id="topo-relogio"></div>`;
  document.body.appendChild(el);
  return {
    el,
    setRelogio(txt) { el.querySelector('#topo-relogio').textContent = txt; },
  };
}

/** Aviso central temporario (ex.: "sem caixa", "fim do dia"). */
export function criarAviso() {
  const el = document.createElement('div');
  el.className = 'aviso';
  document.body.appendChild(el);
  let t = null;
  return function avisar(msg, ms = 2200, classe = '') {
    el.innerHTML = msg;
    el.className = 'aviso visivel ' + classe;
    clearTimeout(t);
    t = setTimeout(() => { el.className = 'aviso'; }, ms);
  };
}

/** Painel modal simples (relatorio de fim de dia, ajuda). */
export function criarModal() {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  const cx = document.createElement('div');
  cx.className = 'modal';
  fundo.appendChild(cx);
  document.body.appendChild(fundo);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  function abrir(html, aoFechar = null) {
    cx.innerHTML = html;
    fundo.classList.add('visivel');
    const b = cx.querySelector('[data-fechar]');
    if (b) b.addEventListener('click', () => { fechar(); if (aoFechar) aoFechar(); });
  }
  function fechar() { fundo.classList.remove('visivel'); }
  return { abrir, fechar, el: cx, aberto: () => fundo.classList.contains('visivel') };
}
