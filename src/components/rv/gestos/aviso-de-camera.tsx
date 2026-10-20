/*
 * aviso-de-camera.tsx — Dialog próprio (nunca alert/confirm) para quando a câmera dos gestos
 * não abre: bloqueada, ocupada por outro programa ou inexistente. Cada caso diz O QUE FAZER,
 * porque "erro na câmera" sozinho não ajuda ninguém a destravar.
 */
import { CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EstadoGestos } from "./use-gestos";

const TEXTOS: Partial<Record<EstadoGestos, { titulo: string; corpo: string }>> = {
  negado: {
    titulo: "A câmera está bloqueada",
    corpo:
      "Para os gestos funcionarem, clique no cadeado da barra de endereço → Câmera → Permitir e tente de novo. No app de mesa: Configurações do Windows → Privacidade → Câmera, e deixe o app usar a câmera.",
  },
  ocupada: {
    titulo: "Câmera em uso por outro programa (Teams, Zoom…)",
    corpo:
      "Feche o programa que está usando a câmera e clique em Tentar de novo. Enquanto isso, tentamos sozinhos a cada 10 segundos.",
  },
  "sem-camera": {
    titulo: "Nenhuma câmera encontrada",
    corpo:
      "Conecte uma webcam (ou confira se ela não está desativada no Windows) e clique em Tentar de novo. A câmera serve só para os gestos e não é transmitida.",
  },
};

export function AvisoDeCamera({
  estado,
  aberto,
  aoFechar,
  aoTentarDeNovo,
}: {
  estado: EstadoGestos;
  aberto: boolean;
  aoFechar: () => void;
  aoTentarDeNovo: () => void;
}) {
  const t = TEXTOS[estado];
  return (
    <Dialog open={aberto && !!t} onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CameraOff className="h-5 w-5 text-[#dc2626]" aria-hidden />
            {t?.titulo}
          </DialogTitle>
          <DialogDescription className="pt-2 text-[14px] leading-relaxed">
            {t?.corpo}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={aoFechar}>
            Agora não
          </Button>
          {/* Só "tentar": quem abriu o aviso fecha e rearma (fechar = "Agora não" = dispensar). */}
          <Button onClick={aoTentarDeNovo}>Tentar de novo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
