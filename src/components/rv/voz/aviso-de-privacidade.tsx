import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { marcarCardsIaAceito } from "./preferencia-cards-ia";

/**
 * O combinado antes de ligar os "Cards por IA". A voz sai do computador para
 * duas empresas de fora; a pessoa precisa saber disso ANTES, uma vez, em
 * palavras simples — inclusive que vozes perto dela também são captadas, que
 * os outros veem o selo "IA" e que o mudo corta tudo.
 *
 * Popup próprio (nunca confirm() do navegador). Quem decide abrir é o
 * integrador, com `cardsIaJaAceito()` (preferencia-cards-ia.ts); aceitar grava a chave.
 */

export function AvisoCardsIA({
  aberto,
  aoAceitar,
  aoCancelar,
}: {
  aberto: boolean;
  aoAceitar: () => void;
  aoCancelar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoCancelar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            Ligar os cards por IA?
          </DialogTitle>
          <DialogDescription>
            O que você falar vira um card curto num balão em cima do seu avatar, para todos verem.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            O áudio da sua voz vai para a <b>OpenAI</b> para virar texto — e{" "}
            <b>vozes próximas captadas pelo seu microfone também</b>.
          </li>
          <li>
            O texto vai para a <b>Anthropic</b> (Claude) para virar card.
          </li>
          <li>Nada é gravado no banco: o card vive só nesta reunião.</li>
          <li>
            Todos na sala veem o selo <b>"IA"</b> no seu nome enquanto estiver ligado.
          </li>
          <li>No mudo, nada é enviado — nem a frase que estava em andamento.</li>
          <li>Você pode desfazer qualquer card seu.</li>
        </ul>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={aoCancelar}>
            Agora não
          </Button>
          <Button
            className="bg-violet-600 text-white hover:bg-violet-700"
            onClick={() => {
              marcarCardsIaAceito();
              aoAceitar();
            }}
          >
            Ligar cards
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
