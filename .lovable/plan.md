## O que vou entregar (leva única)

### 1. Senha temporária (PIN) em sala trancada
- Nova coluna `pin` em `room_state` (6 dígitos, gerado no servidor quando alguém tranca).
- Quem tranca vê o PIN no botão "Privada" e pode copiar.
- Ao convidar, o PIN vai junto no convite (aparece no card do `IncomingCall`).
- Quem tenta entrar em sala trancada sem estar na lista vê um campo de PIN — acertando, entra direto (sem knock). Errando 3x, volta pro fluxo de knock.
- Ao destrancar, o PIN é apagado.

### 2. Pré-sala (mic/câmera antes de entrar)
- Nova tela intermediária em `/salas/$roomName` antes de conectar ao LiveKit:
  - Preview local com `getUserMedia`
  - Toggle mic/câmera
  - Seletor de dispositivo (mic + câmera)
  - Botão "Entrar" que só então gera o token e conecta
- Preferências (mic/cam ligado, deviceId) salvas em `localStorage`.

### 3. Atalhos de teclado
Dentro da chamada: **M** mutar/desmutar mic, **V** liga/desliga câmera, **E** encerra, **C** abre chat, **H** levanta a mão. Ignorados quando o foco está em `input`/`textarea`. Tooltip nos botões mostra o atalho.

### 4. Modo apresentador
Quando alguém compartilha tela: layout muda automaticamente — tela grande no centro, tiles dos participantes viram uma faixa lateral pequena. Toggle "Modo grade" pra voltar ao padrão.

### 5. Status "Ocupado / Em reunião" automático
- Novo `useRoomPresence()` que faz polling agregado das salas em uso (uma chamada só) e expõe `isUserBusy(userId)` + `busyRoomLabel(userId)`.
- Novo `<PresenceBadge user />` — pontinho verde/vermelho + tooltip "Em reunião: X". Aplicado em: `equipe`, `inbox` (autor da mensagem), `minhas-tarefas` (responsáveis), lista de contatos do convite.

### 6. Quem está falando agora no card da sala
- Um participante da sala publica no data channel `fluxo-active-speaker` a cada 1s a lista de identidades com áudio ativo (`activeSpeakers` do LiveKit já dá isso).
- Também escrevemos no `room_state.active_speakers` (jsonb) pra `listSectorRooms` retornar. O card da sala destaca o falante com um anel pulsando ao lado do nome.

### 7. Gravação da reunião
- Botão "Gravar" no `ControlBar`. Usa `MediaRecorder` **client-side** capturando um `MediaStream` composto (áudio de todos os participantes remotos + áudio local + a tela compartilhada quando existir, senão a grid via canvas).
- Enquanto grava, badge vermelho pulsando + aviso "Gravando" pra todos via data channel.
- Ao parar: baixa `.webm` automaticamente + oferece "Enviar pra inbox" (anexo já existente).

### 8. Transcrição ao vivo + ata por IA
- Transcrição: `webkitSpeechRecognition` (Chrome/Edge) capturando fala do participante local em `pt-BR`, com marcação de quem falou pelo identity. Cada participante transcreve o próprio áudio e faz broadcast das linhas via data channel → todos veem a transcrição.
- Painel de transcrição no chat (aba "Transcrição").
- Ao encerrar a chamada (ou clicar "Gerar ata"): server function `summarizeMeeting` chama Lovable AI (`openai/gpt-5.5`) com o transcript + chat → gera **ata em markdown** (tópicos, decisões, pendências). A ata vai pra `inbox` de todos os participantes (mensagem do sistema).

## Onde tem tradeoff (importante)

- **Gravação server-side (LiveKit Egress)** seria melhor (grava mesmo se seu navegador fechar, mixa tudo no servidor). Precisa de: worker LiveKit Egress + bucket S3 + credenciais. **Fica de fora dessa leva** — a gravação client-side já resolve 90% dos casos ("quero registrar essa reunião") sem infra nova.
- **Transcrição via Web Speech API** é grátis mas: só funciona em Chrome/Edge, exige mic ativo, e só transcreve o áudio que o seu navegador capta. Alternativa "de verdade" seria um agente LiveKit + Whisper — mesma questão de infra. Pra "diretoria quer atas automáticas", combinar Web Speech + resumo por IA já entrega o valor.

## Arquivos que serão criados/editados

**Novos:** `src/lib/room-presence.ts`, `src/components/presence-badge.tsx`, `src/components/pre-call.tsx`, `src/components/meeting-recorder.tsx`, `src/lib/meeting-summary.functions.ts`, `src/hooks/use-keyboard-shortcuts.ts`, migração SQL (`pin` + `active_speakers` em `room_state`).

**Editados:** `livekit-token.functions.ts` (validar PIN, atualizar active_speakers, retornar PIN pra dono), `call-inviter-context.tsx` (mostrar PIN, incluir no convite), `active-call-widget.tsx` (atalhos, modo apresentador, botão gravar, painel transcrição, active speaker highlight), `salas.$roomName.tsx` (pré-sala + PIN entry), `salas.index.tsx` (badge falando agora), `incoming-call.tsx` (mostrar PIN), `fluxo-store.tsx` (mensagens de sistema no inbox), `equipe.tsx`, `inbox.tsx`, `minhas-tarefas.tsx` (PresenceBadge nos avatares).

## Fora do escopo desta leva
- Egress server-side / gravação em nuvem
- Transcrição por agente Whisper server-side
- Suporte a Safari/Firefox pra transcrição (Web Speech API não cobre)

Se você quiser esses depois, faço em uma segunda leva com a infra necessária. Aprovando este plano, começo a implementar.