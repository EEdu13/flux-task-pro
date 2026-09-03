import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

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

  // Pessoa diferente: tenta de novo, senão o 404 de uma gruda na próxima.
  useEffect(() => setFalhou(false), [nome]);

  const temNome = nome.trim().length >= 3;

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        !style && "bg-primary text-primary-foreground",
        className,
      )}
      style={style}
      title={title ?? nome}
    >
      <span>{iniciais}</span>
      {temNome && !falhou && (
        <img
          src={`/api/public/foto/${encodeURIComponent(nome.trim())}?v=${FOTO_V}`}
          alt=""
          aria-hidden
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFalhou(true)}
        />
      )}
    </div>
  );
}
