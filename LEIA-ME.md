# Corte no Ar 1.2.2

Jogo do CACCO para a Mostra de Profissões da UNIFEI Itabira. Controle a lâmina com o indicador ou com o mouse e corte frutas para marcar pontos. As bombas descontam pontos. O menu mostra a duração da rodada e o valor de cada alvo.

No modo câmera, frutas e bombas se movem 20% mais devagar. A altura dos lançamentos é a mesma nos dois modos. As ondas de alvos ficam um pouco mais frequentes ao longo da rodada.

## Abrir a versão pronta

1. Extraia o ZIP inteiro para uma pasta.
2. No Windows, abra **Jogar.cmd**. O computador precisa ter Node.js. Mantenha a janela do terminal aberta durante o jogo.
3. Abra **http://127.0.0.1:4173/** no Chrome ou Edge se o navegador demorar a abrir.
4. Clique em **Jogar com a mão** e permita a câmera. Enquadre a mão inteira, do punho aos dedos, com o indicador estendido. O retângulo na prévia indica a área que corresponde à arena. Faça uma talhada para conferir o movimento antes de clicar em **Começar partida**.
5. Para jogar com mouse, passe o cursor pelas frutas. A barra de espaço pausa ou continua a partida.

Em Linux ou macOS, execute **node scripts/jogar.mjs** na pasta extraída.

A pasta **dist** inclui o modelo e os arquivos de execução do MediaPipe. O jogo roda pelo servidor local sem instalar pacotes npm. O navegador processa as imagens da câmera em memória e a política do servidor local bloqueia conexões externas da página. O recorde fica neste navegador.

## Controle pela mão

O jogo analisa um quadro por vez. Na preparação, ele mede o tempo de resposta do Worker com CPU e, quando o navegador oferece aceleração, também com GPU. Testa uma entrada menor quando a análise está lenta e a mantém se houver ganho de tempo com detecção comparável. O perfil escolhido fica fixo durante a rodada. Se o navegador precisar executar a detecção na página, o modo CPU continua disponível.

A busca encontra até duas mãos e prioriza a continuidade da mão escolhida. Quando há uma única mão estável, o jogo usa um rastreador já preparado para acompanhá-la. Se perder essa referência, volta à busca. A compensação de brilho mede a região próxima da palma. Se o navegador apresentar poucos quadros de vídeo por segundo, a tela de preparo mostra a cadência e sugere iluminar a mão de frente.

O filtro usa a palma para rejeitar saltos isolados. Durante um traço, até dois quadros consecutivos de indicador dobrado mantêm a lâmina no último ponto confirmado. O terceiro encerra o traço. Ao perder e reencontrar a mão, o jogo inicia um novo traço.

O jogo guarda um histórico curto das posições dos alvos. Ao chegar uma talhada, compara os segmentos confirmados da lâmina e dos alvos no intervalo do gesto. A ponta percorre visualmente a mesma reta em uma transição curta. Se o detector falhar durante a partida, o relógio fica em espera enquanto o jogo tenta reativar a câmera. Se a tentativa falhar, a partida pode continuar com o mouse.

## Diagnóstico

Abra **http://127.0.0.1:4173/?debug=1** e use o painel abaixo da arena. Abra a câmera, clique em **Gravar trilha** e reproduza o gesto. A gravação dura até 30 segundos. O painel mostra o indicador bruto em azul, o indicador filtrado em amarelo e o centro da palma em verde. As métricas mostram separadamente os FPS da câmera, as posições confirmadas por segundo e os tempos de análise e chegada. O painel também indica se o jogo está buscando ou acompanhando a mão.

Use **Exportar JSON** para guardar as coordenadas e **Importar trilha** e **Reproduzir** para rever uma amostra. O arquivo contém dados do rastreamento e tempos, sem fotos ou vídeo.

## Editar o projeto

Abra a pasta no VS Code. No terminal PowerShell:

    npm.cmd ci
    npm.cmd run dev
    npm.cmd run check

Em Linux ou macOS, use **npm**. Instalar as dependências de desenvolvimento requer internet e Node.js 20.19+ na série 20, 22.13+ na série 22 ou 24+. O comando **check** executa o lint, os testes de regressão e a compilação. Para recompilar a pasta **dist** separadamente, use **npm.cmd run build**.

- **src/config.ts** define as regras, as dimensões da arena e os parâmetros da câmera e do filtro.
- **src/match-controller.ts** controla o estado da partida e conecta os modos de entrada. **src/game-view.ts** atualiza a interface e **src/record.ts** guarda o recorde.
- **src/game.ts**, **src/blade.ts** e **src/render.ts** cuidam da física e dos alvos, dos traços da lâmina e do desenho, respectivamente.
- **src/hand-camera.ts** gerencia a webcam e os resultados da análise. **src/hand-inference.ts**, **src/hand-worker.ts** e **src/hand-vision.ts** preparam e executam a inferência.
- **src/hand-geometry.ts**, **src/hand-selector.ts** e **src/hand-filter.ts** cuidam do enquadramento, da escolha da mão e do filtro.
- **src/style.css** define o tema e o layout. **public/vision** guarda o modelo e a execução local do MediaPipe.
- **tests/tracking.test.mjs** cobre cortes com atraso, rastreamento, cadência e o relógio. **scripts/jogar.mjs** serve o jogo compilado no próprio computador.

## Teste no notebook da Mostra

Na tela de preparo, mova o indicador devagar para baixo e para cima e depois faça uma talhada larga e rápida. Feche a mão, retire-a do quadro e volte com o indicador estendido. Jogue uma rodada completa com a iluminação e a webcam do estande. Desligue a internet e reabra o jogo pelo atalho.

## Créditos

Identidade do CACCO. Rastreamento de mãos com MediaPipe Tasks Vision, do Google. Veja **CREDITOS.txt** e **LICENSE-MediaPipe.txt**.
