# CLAUDE.md — Simuladores 3D

Orientação para trabalhar neste projeto. Leia antes de editar qualquer arquivo aqui.

> Projeto **independente** dos demais do workspace. Não compartilha dados, código ou contexto com `Dashboard/`, `Ferramentas/`, `Relatorio SRE/` ou qualquer pasta de DCM. Nada aqui usa dado real de cliente, emissor ou contraparte — é tudo paramétrico e fictício, e deve continuar assim.

## O que é

Três simuladores de negócio em WebGL/three.js, cada um em sua pasta, compartilhando um núcleo em `comum/`:

| Pasta | Simulador | Sistema modelado |
|---|---|---|
| `cidade/` | Cidade | zoneamento RCI, crescimento por demanda, orçamento municipal, poluição |
| `lavanderia/` | Lavanderia self-service | teoria de filas, elasticidade-preço, desgaste de ativo, P&L diário |
| `foodtruck/` | Food truck | escolha de ponto, conversão de fluxo, gargalo de produção, estoque |

## Regras de conduta (prioridade máxima)

1. **Verdade acima de utilidade.** Sem certeza → dizer explicitamente.
2. **Nada inventado.** Não inventar API de three.js. Se não tiver certeza de que um método existe na r169, conferir em `vendor/three.module.js` antes de usar.
3. **Idioma:** português do Brasil. Comentários, nomes de variável e função e textos de interface em pt-BR, **sem acento em identificadores de código** (o restante do texto leva acento normalmente).
4. Ler este arquivo e o `README.md` antes de iniciar.

## Padrões técnicos

- **Sem build, sem npm.** Módulos ES nativos resolvidos por `importmap` em cada `index.html`. Toda página nova precisa do mesmo bloco de importmap apontando para `../vendor/`.
- **three.js é local.** `vendor/three.module.js` (r169) e `vendor/addons/controls/OrbitControls.js`. **Não trocar por CDN** — o projeto precisa rodar offline. Para atualizar a versão, baixar os dois arquivos e reconferir a API usada.
- **Zero asset externo.** Nenhuma textura, fonte ou modelo: toda geometria é procedural (`BoxGeometry`, `CylinderGeometry`, `CapsuleGeometry`…). Manter assim.
- **Precisa de HTTP.** `file://` não carrega módulos ES. Validar sempre servindo a pasta (`py -3 -m http.server 8080`).
- **Materiais compartilhados** por tipo, não por instância, quando a intenção é mudar todos de uma vez (ex.: `matPredio` na cidade acende todas as janelas ao anoitecer). Materiais por instância só quando o estado é individual (ex.: luz de cada máquina na lavanderia).
- **`InstancedMesh` para multidão homogênea** (carros da cidade). Grupos individuais para agentes com estado (clientes, pedestres).
- Sempre `dispose()` na geometria ao remover um agente da cena.

## A armadilha central: tempo real vs. tempo simulado

Os três simuladores comprimem o tempo. O laço recebe `dt` em segundos reais e converte para minutos ou horas simuladas.

- **Movimento de personagem** usa `dt` real, para a caminhada parecer natural na tela.
- **Ocupação de recurso, preparo, ciclo e espera** usam tempo simulado.

Misturar os dois é o bug mais fácil de introduzir aqui e o mais difícil de enxergar: a 10 minutos simulados por segundo, uma caminhada de 6 segundos "custa" uma hora de lavadora ocupada, e a capacidade instalada despenca sem nenhum erro aparente.

**Regra:** ciclo, preparo e atendimento começam no momento da **atribuição** do recurso, não na chegada do boneco. A caminhada é só representação. Tempo de espera do cliente também só conta depois que ele chega ao lugar na fila.

## Balanceamento

Números de economia (preços, curvas de fluxo, taxas de quebra, custos) ficam em constantes no topo de cada arquivo — mexer ali, não espalhado pelo código. Ao alterar qualquer um, **rodar o harness e conferir o resultado do dia** antes de dar por pronto.

Referências atuais de um dia sem intervenção do jogador:

| Simulador | Esperado |
|---|---|
| Cidade | ~2.800 hab e ~2.400 empregos por volta do dia 15 com 300 lotes zoneados; receita acima da manutenção |
| Lavanderia | ~74 atendidos e ~R$ 2.800 de receita no dia 1; sem manutenção as máquinas quebram e o resultado degrada |
| Food truck | ~130 vendas/dia no centro com estoque suficiente; espera média ~3 min; fila é o gargalo no pico |

## Validação

Não há pytest aqui. O procedimento é:

1. Servir a pasta por HTTP.
2. Abrir `testes/quadros.html?sim=<nome>` e rodar `window.__pump(9000, 30)`.
3. Conferir `window.__erros` vazio e `window.__dbg` com números plausíveis.
4. Abrir o simulador de verdade e olhar a cena.

O harness existe porque `requestAnimationFrame` não dispara quando a aba não está compondo quadros — em ambiente headless ou com o painel do navegador oculto, o simulador carrega sem erro mas não avança. Isso é limitação do ambiente, não bug do código.

Cada simulador expõe `window.__dbg` com seu estado interno. É gancho de teste; manter enxuto e não usar como via de comunicação entre módulos.

## Não confundir

- `vendor/` é dependência de terceiro — não editar.
- `testes/quadros.html` é ferramenta de desenvolvimento, não faz parte da experiência do usuário.

## PWA / iPhone (adicionado depois do README original)

O projeto virou instalável (`manifest.json`, `sw.js`, `icones/`). Pontos que quem mexer aqui depois precisa saber:

- **`comum/estilo.css`** tem um bloco `@media (max-width: 760px)` no final que transforma os dois `.painel` fixos em bottom sheets (chips lado a lado quando recolhidos, folha de 68vh quando abertos). Não depende de mudar `comum/hud.js` para cada simulador — é so CSS reagindo as mesmas classes que ja existiam (`.recolhido`).
- **`comum/hud.js`**: `criarPainel` agora comeca recolhido em tela ≤760px, e abrir um painel recolhe os outros automaticamente nesse breakpoint (pra so uma folha cobrir a tela por vez). Guardado atras de `matchMedia`, entao desktop nao muda.
- **`cidade/cidade.js`**: o toque de 1 dedo pra pintar zona competia com `OrbitControls.touches.ONE` (que gira a camera com 1 dedo *independente* de `mouseButtons.LEFT` — isso pegou um bug real, confirmado lendo `vendor/addons/controls/OrbitControls.js`). A correcao desliga `app.controles.enabled` durante o gesto de pintura, tanto pra mouse quanto pra touch. Se um novo simulador for pintar sobre o canvas via clique/arrasto, replicar o mesmo padrao.
- `lavanderia/` e `foodtruck/` não tiveram nenhuma mudança de lógica — não há interação por clique na cena, só HUD, então não sofrem do conflito de toque acima.
- Sem persistência de estado entre sessões (localStorage) — não foi implementado. Ficou de fora por risco: reconstruir a cena da cidade (centenas de lotes/prédios procedurais) a partir de estado salvo é bem mais arriscado que lavanderia/food truck, e não quis entregar persistência inconsistente entre os três.

