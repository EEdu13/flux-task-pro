import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { CartaoDeErro } from "@/components/estrutura/blocos-da-tela";
import { listaDeNomes, mensagemDaFalha } from "@/components/estrutura/mensagens";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { motivoDaFalha } from "@/lib/estrutura-cliente";
import { semAcento, type Candidatos, type TipoDeCandidato } from "@/lib/estrutura-tipos";
import { nomeCurto } from "@/lib/nome-curto";

/*
 * "Adicionar à equipe": puxar para a equipe quem está SEM EQUIPE, pessoa ou veículo. É o
 * espelho do "NÃO ESTÁ NA EQUIPE", que manda para lá. Acontece NA HORA (não espera o envio da
 * estrutura): muda quem é da equipe no PWA, então pede uma confirmação, dentro desta mesma janela
 * (o `confirmar()` do app é outro overlay, e ficaria sem clique por cima de um Dialog).
 *
 * Só aparece quem o servidor oferece, no alcance que o app do líder usa: pessoas efetivas da
 * coordenação da equipe (ou sem coordenador) e veículos do projeto dela. Nunca PJ nem estagiário
 * (o PWA não os move). O servidor confere de novo, sem cache, na hora de puxar.
 */

export type TipoDeAdicao = TipoDeCandidato;

/** De onde vem a lista, numa frase: "da coordenação de Rodrigo Silva" ou "do projeto 400". */
function deOnde(dados: Candidatos | null, veiculos: boolean): string {
  if (!dados) return "";
  if (veiculos) return dados.alcance.projeto ? ` do projeto ${dados.alcance.projeto}` : "";
  return dados.alcance.coordenador
    ? ` da coordenação de ${nomeCurto(dados.alcance.coordenador)} (ou sem coordenador)`
    : " sem coordenador";
}

interface Linha {
  id: number;
  titulo: string;
  detalhe: string;
  busca: string;
}

function linhasDe(dados: Candidatos | null, tipo: TipoDeAdicao | null): Linha[] {
  if (!dados || !tipo) return [];
  if (tipo === "pessoas") {
    return dados.pessoas.map((p) => ({
      id: p.id,
      titulo: p.nome,
      detalhe: [p.funcao, p.cpf && `CPF ${p.cpf}`].filter(Boolean).join(" · "),
      busca: semAcento(`${p.nome} ${p.funcao}`),
    }));
  }
  return dados.veiculos.map((v) => ({
    id: v.id,
    titulo: v.prefixo,
    detalhe: [v.placa, v.modelo, v.tipo].filter(Boolean).join(" · "),
    busca: semAcento(`${v.prefixo} ${v.placa} ${v.modelo} ${v.tipo}`),
  }));
}

export function AdicionarNaEquipe({
  tipo,
  equipe,
  aoFechar,
  aoAdicionado,
}: {
  /** `null` = fechada. */
  tipo: TipoDeAdicao | null;
  equipe: string;
  aoFechar: () => void;
  /** Alguém entrou: a tela relê a lista da equipe. */
  aoAdicionado: () => void;
}) {
  const [dados, setDados] = useState<Candidatos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<number[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  // Ao abrir (e ao tentar de novo): quem está sem equipe agora.
  useEffect(() => {
    if (!tipo) return;
    let vivo = true;
    setDados(null);
    setErro(null);
    setBusca("");
    setEscolhidos([]);
    setConfirmando(false);
    void import("@/lib/estrutura.functions")
      .then(({ candidatosDaEquipe }) => candidatosDaEquipe({ data: { equipe, tipo } }))
      .then((r) => vivo && setDados(r))
      .catch((e: unknown) => vivo && setErro(mensagemDaFalha(e)));
    return () => {
      vivo = false;
    };
  }, [tipo, equipe, tentativa]);

  const linhas = useMemo(() => linhasDe(dados, tipo), [dados, tipo]);
  const filtradas = useMemo(() => {
    const q = semAcento(busca);
    return q ? linhas.filter((l) => l.busca.includes(q)) : linhas;
  }, [linhas, busca]);
  const nomes = escolhidos
    .map((id) => linhas.find((l) => l.id === id)?.titulo ?? "")
    .filter(Boolean);
  const veiculos = tipo === "veiculos";

  const alternar = (id: number) =>
    setEscolhidos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const adicionar = async () => {
    if (!tipo || enviando || escolhidos.length === 0) return;
    setEnviando(true);
    try {
      const { adicionarNaEquipe } = await import("@/lib/estrutura.functions");
      const r = await adicionarNaEquipe({
        data: {
          equipe,
          pessoas: tipo === "pessoas" ? escolhidos : [],
          veiculos: tipo === "veiculos" ? escolhidos : [],
        },
      });
      const entraram = [...r.pessoas, ...r.veiculos];
      if (entraram.length > 0) {
        toast.success(
          `${listaDeNomes(entraram)} ${entraram.length === 1 ? "entrou" : "entraram"} na equipe ${equipe}`,
        );
        aoAdicionado();
      }
      if (r.falhas.length > 0) {
        toast.error(`Não deu para adicionar: ${listaDeNomes(r.falhas.map((f) => f.nome))}`, {
          description: r.falhas.some((f) => f.motivo === "recusado")
            ? "O sistema de apontamento recusou. Quem é da equipe de outro líder, por exemplo, não sai de lá por aqui."
            : "O sistema de apontamento não respondeu. Tente de novo.",
          duration: 15_000,
        });
        setTentativa((x) => x + 1); // o que sobrou, atualizado
      } else {
        aoFechar();
      }
    } catch (e) {
      toast.error(mensagemDaFalha(e), { duration: 12_000 });
      // Alguém puxou antes: a lista se refaz, sem o que já não está livre.
      if (motivoDaFalha(e) === "candidato_indisponivel") setTentativa((x) => x + 1);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog
      open={tipo !== null}
      onOpenChange={(aberto) => {
        if (!aberto && !enviando) aoFechar();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {veiculos ? "Adicionar veículo à equipe" : "Adicionar pessoa à equipe"} {equipe}
          </DialogTitle>
          <DialogDescription>
            {veiculos ? "Veículos" : "Pessoas"} que estão SEM EQUIPE{deOnde(dados, veiculos)}. Ao
            adicionar, saem de lá e entram na equipe {equipe} na hora.
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <CartaoDeErro mensagem={erro} aoTentarDeNovo={() => setTentativa((x) => x + 1)} />
        ) : !dados ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Buscando quem está sem equipe…
          </div>
        ) : confirmando ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold">Confirmar?</p>
            <p className="mt-1 text-muted-foreground">
              {listaDeNomes(nomes)} {nomes.length === 1 ? "sai" : "saem"} de SEM EQUIPE e{" "}
              {nomes.length === 1 ? "entra" : "entram"} na equipe {equipe}. Isso muda a equipe no
              sistema de apontamento, na hora.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={
                  veiculos ? "Buscar por prefixo, placa ou modelo" : "Buscar por nome ou função"
                }
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {filtradas.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {linhas.length === 0
                  ? veiculos
                    ? dados.alcance.projeto
                      ? "Nenhum veículo do projeto está sem equipe agora."
                      : "Sem o projeto da equipe não dá para listar os veículos."
                    : "Ninguém da coordenação está sem equipe agora."
                  : "Nada com essa busca."}
              </p>
            ) : (
              <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {filtradas.map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-secondary/40">
                      <input
                        type="checkbox"
                        checked={escolhidos.includes(l.id)}
                        onChange={() => alternar(l.id)}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{l.titulo}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {l.detalhe || "Sem detalhes"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {!veiculos && (
              <p className="text-[11px] text-muted-foreground">
                PJ e estagiário não entram por aqui: a equipe deles muda no cadastro de externos,
                pela TI.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {confirmando ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={enviando}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void adicionar()}
                disabled={enviando}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {enviando ? "Adicionando…" : "Confirmar e adicionar"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={aoFechar}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                disabled={escolhidos.length === 0 || !dados}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {escolhidos.length > 1 ? `Adicionar ${escolhidos.length}` : "Adicionar"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
