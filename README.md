# Corte no Ar — CACCO

Jogo interativo inspirado em Fruit Ninja, controlado por movimentos da mão
capturados pela webcam ou pelo mouse.

Desenvolvido para o estande de Ciência da Computação do CACCO na
IV Mostra de Profissões da UNIFEI — Campus Itabira.

## 🛠 Tecnologias utilizadas

- TypeScript
- Vite
- MediaPipe Tasks Vision
- HTML5 e CSS3
- Canvas API
- Web Workers
- Node.js e npm

![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.3.7-646CFF?logo=vite&logoColor=white)
![Versão](https://img.shields.io/badge/Vers%C3%A3o-1.2.2-blue)
![Status](https://img.shields.io/badge/Status-Em_desenvolvimento-yellow)

## ⚙ Funcionalidades

- Controle da lâmina pelo indicador, utilizando a webcam
- Modo alternativo de controle pelo mouse
- Corte de frutas e penalidade ao atingir bombas
- Rodadas com tempo limitado, pausa e retomada da partida
- Placar em tempo real e recorde salvo no navegador
- Modo de tela cheia
- Seleção de CPU ou GPU conforme o desempenho medido na preparação
- Painel de diagnóstico com gravação, reprodução e exportação das trajetórias

## 🧠 Conceitos aplicados

- Visão computacional e rastreamento de mãos
- Programação Orientada a Objetos e tipagem estática
- Separação de responsabilidades entre partida, interface e câmera
- Física básica com velocidade, gravidade e trajetórias
- Detecção de colisão ao longo de segmentos de reta
- Compensação de latência com histórico de posições dos alvos
- Processamento em segundo plano com Web Workers
- Persistência de dados com `localStorage`

## 📁 Estrutura do projeto

- `src/main.ts` → inicialização da aplicação
- `src/match-controller.ts` → fluxo da partida e integração dos controles
- `src/game.ts` → física, alvos, cortes e pontuação
- `src/render.ts` → desenho da arena e dos efeitos no Canvas
- `src/game-view.ts` → atualização da interface
- `src/hand-*.ts` → câmera, detecção, seleção e filtragem da mão
- `src/style.css` → identidade visual e layout
- `public/` → logo e arquivos locais do MediaPipe
- `tests/` → testes de regressão
- `scripts/jogar.mjs` → servidor local da versão compilada

## ▶ Como executar o projeto

1. Instale o Node.js 24 ou superior.
2. Clone o repositório e abra a pasta do projeto no terminal.
3. Instale as dependências:

   ```bash
   npm ci
   ```

4. Inicie o servidor de desenvolvimento:

   ```bash
   npm run dev
   ```

5. Abra o endereço informado no terminal.
6. Escolha o controle e permita o acesso à webcam para jogar com a mão.

No PowerShell do Windows, você também pode usar `npm.cmd ci` e `npm.cmd run dev`.

Para gerar e executar a versão compilada:

```bash
npm run build
npm run jogar
```

No Windows, a versão compilada também pode ser aberta pelo arquivo `Jogar.cmd`.

Para executar o lint, os testes e a compilação:

```bash
npm run check
```

## 📌 Observações

Projeto desenvolvido para divulgação de Ciência da Computação,
aprendizado e portfólio, com foco em visão computacional,
interação por gestos e desenvolvimento de jogos no navegador.

O processamento da câmera acontece localmente no navegador.
O desempenho do rastreamento depende do hardware, da webcam e da iluminação.

O painel de diagnóstico pode ser acessado adicionando `?debug=1` ao endereço do jogo.

Rastreamento de mãos com MediaPipe Tasks Vision, do Google.
Consulte os arquivos `CREDITOS.txt` e `LICENSE-MediaPipe.txt`
para os créditos e a licença do MediaPipe.

- [Documentação do MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [Documentação do Vite](https://vite.dev/guide/)
