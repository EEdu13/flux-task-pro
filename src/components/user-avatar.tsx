import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { assinarFotos, carimboDaFoto } from "@/lib/foto-versao";
import {
  assinarAniversarios,
  fazAniversarioHoje,
  garantirAniversariosDeHoje,
  versaoDosAniversarios,
} from "@/lib/aniversario-hoje";

/**
 * Foto da pessoa, com as iniciais como reserva.
 *
 * As iniciais ficam desenhadas ATRÁS da imagem, que cobre tudo quando carrega.
 * Quem não tem foto recebe 404 e a imagem se remove sozinha, revelando o que já
 * estava lá — nada pisca e não existe estado de "carregando" para gerenciar.
 * (Padrão emprestado do PCP, que resolveu isso antes.)
 *
 * A chave de busca é o NOME COMPLETO, não o login: a IAM indexa foto por nome,
 * e quem tem registro duplicado só recebe a foto atual pelo nome completo.
 */

/**
 * Versão da miniatura servida. O navegador guarda a foto por 24h; quando o jeito
 * de gerar a miniatura mudar (tamanho, recorte, qualidade), subir este número
 * troca a URL e força todo mundo a buscar a nova na hora.
 */
const FOTO_V = 1;

export function UserAvatar({
  nome,
  iniciais,
  className,
  title,
  style,
}: {
  nome: string;
  iniciais: string;
  className?: string;
  title?: string;
  /** Cor de fundo própria das iniciais (ex.: a cor do setor, em Contatos). */
  style?: React.CSSProperties;
}) {
  const [falhou, setFalhou] = useState(false);
  const carimbo = useSyncExternalStore(
    assinarFotos,
    () => carimboDaFoto(nome),
    () => 0,
  );

  // Pessoa diferente (ou foto nova): tenta de novo, senão o 404 de uma gruda na próxima.
  useEffect(() => setFalhou(false), [nome, carimbo]);

  /* Aniversário (Mural, 14/10/2026): no dia, a pessoa ganha um chapeuzinho de
     festa em todo avatar. A lista de hoje vem uma vez por sessão (o primeiro
     avatar a montar pede); aqui é só uma consulta a um conjunto na memória. */
  useSyncExternalStore(assinarAniversarios, versaoDosAniversarios, () => 0);
  useEffect(() => garantirAniversariosDeHoje(), []);
  const festa = fazAniversarioHoje(nome);

  const temNome = nome.trim().length >= 3;

  return (
    <div
      className={cn(
        // Com o chapéu, o recorte redondo passa para a foto (`rounded-full`
        // nela), senão o chapéu, que sai para fora do círculo, seria cortado.
        "relative flex shrink-0 items-center justify-center rounded-full font-bold",
        !festa && "overflow-hidden",
        !style && "bg-primary text-primary-foreground",
        className,
      )}
      style={style}
      title={title ?? (festa ? `${nome} — hoje é aniversário! 🎂` : nome)}
    >
      <span>{iniciais}</span>
      {temNome && !falhou && (
        <img
          src={`/api/public/foto/${encodeURIComponent(nome.trim())}?v=${FOTO_V}${carimbo ? `&t=${carimbo}` : ""}`}
          alt=""
          aria-hidden
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full rounded-full object-cover"
          onError={() => setFalhou(true)}
        />
      )}
      {festa && <ChapeuDeFesta />}
    </div>
  );
}

/** O chapeuzinho: em %, para servir do avatar de 16px ao de 96px. */
function ChapeuDeFesta() {
  return (
    <svg
      viewBox="0 0 32 40"
      aria-hidden
      className="pointer-events-none absolute -right-[18%] -top-[52%] z-10 h-[72%] w-[58%] rotate-[22deg] drop-shadow-sm"
    >
      <path d="M16 4 L29 36 Q16 40 3 36 Z" fill="#f43f5e" />
      <path d="M10.6 17 Q16 18.6 21.4 17 L23.6 22.6 Q16 24.8 8.4 22.6 Z" fill="#facc15" />
      <path d="M6.2 28 Q16 30.6 25.8 28 L27.4 32 Q16 35 4.6 32 Z" fill="#38bdf8" />
      <circle cx="16" cy="4" r="3.6" fill="#facc15" />
      <path d="M3 36 Q16 40 29 36" stroke="#fff" strokeWidth="1.6" fill="none" opacity="0.8" />
    </svg>
  );
}
