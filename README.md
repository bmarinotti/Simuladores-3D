# Simuladores 3D

Três simulações de negócio em WebGL com three.js: uma **cidade**, uma **lavanderia self-service** e um **food truck**. Sem build, sem framework, sem dependência baixada em tempo de execução — três.js fica versionado em `vendor/` e toda a geometria é procedural.

## Rodar

Os simuladores usam módulos ES, então precisam ser servidos por HTTP (abrir por `file://` é bloqueado por CORS).

```bash
py -3 -m http.server 8080
```

Depois abra `http://localhost:8080/`. No Windows, `iniciar.bat` sobe o servidor e abre o navegador.

## Instalar como app no iPhone (PWA)

O hub e os três simuladores agora são um PWA — instalável na tela de início, tela cheia, funciona offline depois da primeira visita.

1. Suba o servidor local (`python3 -m http.server 8080` na pasta do projeto) num computador na mesma rede do iPhone, ou hospede a pasta em qualquer servidor HTTP estático (GitHub Pages, Netlify, etc. — sem backend necessário).
2. No iPhone, abra o endereço no **Safari** (precisa ser Safari, não Chrome — só o Safari expõe "Adicionar à Tela de Início").
3. Toque no ícone de compartilhar e depois em **"Adicionar à Tela de Início"**.
4. Abra pelo ícone criado: roda em tela cheia, sem barra do navegador, e depois da primeira carga funciona sem internet (o `sw.js` cacheia todos os arquivos locais).

Isso não é um app nativo da App Store — não existe toolchain de macOS/Xcode neste projeto para compilar um `.ipa`. É um PWA de verdade: mesmo código, instalável, offline, com ícone próprio — o caminho que dá pra entregar sem depender de conta de desenvolvedor Apple nem de um Mac.

## Os três simuladores

### `cidade/` — Simulador de Cidade

Malha viária fixa (rua a cada 4 células) sobre uma grade 28×28. O jogador pinta zonas residencial, comercial e industrial; lotes que tocam uma rua se desenvolvem sozinhos quando há demanda.

- **Demanda RCI** — residencial cresce com vaga de emprego sobrando; comercial e industrial crescem com população. O excedente constante no cálculo é o que sustenta o crescimento composto.
- **Orçamento** — imposto (0–20%) sobre população e empregos financia a manutenção das construções. Lote zoneado vazio não custa nada; construção custa por nível.
- **Satisfação** — cai com desemprego, poluição industrial e imposto acima de 9%; sobe com parques. Multiplica a chance de crescimento de todo lote.
- **Trânsito** — `InstancedMesh` de até 180 carros, quantidade proporcional a população + empregos.
- Ciclo dia/noite com janelas acendendo ao anoitecer.

Controles: botão esquerdo pinta a zona selecionada (pode arrastar), botão direito gira a câmera, teclas <kbd>1</kbd>–<kbd>6</kbd> trocam de ferramenta, <kbd>Espaço</kbd> pausa.

### `lavanderia/` — Lavanderia Self-Service

Sala com lavadoras de um lado, secadoras do outro e mesa de dobrar no meio. Clientes chegam por uma curva horária, percorrem lavar → secar → dobrar → pagar e vão embora.

- **Fila** — chegadas por Poisson moduladas por hora, preço, reputação e capacidade instalada. Quem espera além da paciência desiste, e desistência derruba a reputação — que multiplica o fluxo do dia seguinte.
- **Elasticidade** — a referência do bairro é R$ 32 pelo ciclo completo; acima disso o fluxo cai rápido.
- **Desgaste** — cada ciclo desgasta a máquina. Quebra no meio do ciclo custa reembolso e reputação. Manutenção preventiva e equipe reduzem a taxa de falha.
- **Fechamento diário** com P&L: receita, insumos, aluguel, salários e reparos.

### `foodtruck/` — Food Truck

Quatro pontos na mesma rua, cada um com curva de fluxo, público e sensibilidade a preço próprios: centro empresarial (almoço), parque (tarde), campus (dois picos, público sensível a preço) e rua da boemia (noite, aceita ticket alto).

- **Conversão** separada em dois fatores: *apetite* (preço vs. referência, reputação, vitrine) e *atrito* (fila atual, estoque zerado). Isso mantém as causas de perda de cliente contabilizadas separadamente.
- **Gargalo de preparo** — 3,6 min por pedido com uma pessoa. Chapa dupla e ajudante encurtam; no pico do almoço é o que limita o faturamento.
- **Estoque** — sem insumo não há venda, e cliente que chega e não é atendido queima a reputação do ponto.
- Trocar de ponto custa combustível e 45 minutos parado.

## Estrutura

```
Simuladores-3D/
  index.html          hub com os três cartões
  iniciar.bat         sobe o servidor e abre o navegador (Windows)
  comum/
    motor.js          renderer, câmera, controles, luzes, laço, raycast, ciclo dia/noite
    hud.js            painéis, stats, barras, botões, sliders, modal e log
    estilo.css        HUD sobreposto ao canvas
    rng.js            RNG com semente (mulberry32), Poisson, formatação pt-BR
  vendor/             three.js r169 + OrbitControls (local, não é CDN)
  cidade/  lavanderia/  foodtruck/
  testes/quadros.html harness de desenvolvimento
```

## Harness de testes

`testes/quadros.html?sim=<cidade|lavanderia|foodtruck>` substitui `performance.now` e `requestAnimationFrame` por versões controláveis e expõe `window.__pump(quadros, dtMs)`. Serve para rodar dias inteiros de simulação sem depender do compositor do navegador — útil para conferir balanceamento e para ambientes onde a aba não renderiza.

```js
window.__pump(9000, 30);   // ~4,5 min de tempo simulado a 30 ms por quadro
window.__dbg;              // estado interno do simulador carregado
window.__erros;            // erros capturados durante os quadros
```

## Nota sobre tempo simulado

Os três comprimem o tempo (a lavanderia roda 10 minutos simulados por segundo real). Movimento de personagem usa tempo **real**, para parecer natural; ocupação de máquina, preparo e espera usam tempo **simulado**. Misturar os dois faz a caminhada de um boneco "custar" uma hora de ocupação de lavadora — por isso ciclos e preparo começam no momento da atribuição, e a caminhada é apenas representação.
