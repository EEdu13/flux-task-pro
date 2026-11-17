import {
  BlendMode,
  degrees,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFFont,
  type PDFObject,
} from "pdf-lib";
import {
  baseDaLinha,
  ENTRELINHA,
  larguraDoTexto,
  quebrarLinhas,
  rgbDe,
  type EdicaoNoEstado,
  type EstadoDoEditor,
  type Giro,
  type ImagemGuardada,
  type Objeto,
  type ObjetoTexto,
  type PaginaDoEditor,
} from "../../editor/modelo";
import { ErroDeConversao, type AoExecutar, type Resultado } from "../../tipos";
import { blobDe, nomeBase, pararSeCancelado, respirar } from "../arquivos";
import { carregarNoPdfLib, type DocumentoAberto } from "./documento";
import { cabeNaFontePadrao, fontePadraoParecida, type CacheDeFontes } from "./fontes";
import { preencherFormulario } from "./formulario";
import { limparRastros } from "./rastros";
import {
  aplicarEdicoes,
  equilibrarConteudo,
  type EdicaoDeLinha,
  type ResumoDaTroca,
} from "./pagina";

/*
 * Salvar o que foi feito no Editor de PDF (05/11/2026).
 *
 * Cada salvar parte do arquivo original, de novo: as edições não se acumulam, e
 * desfazer não precisa desfazer nada no PDF. A ordem importa: primeiro as linhas
 * trocadas (o conteúdo da página é reescrito), depois os objetos por cima, e só no
 * fim o giro, porque as contas de posição usam o giro que a página tinha ao abrir.
 */

export type PedidoDeEdicao = {
  estado: EstadoDoEditor;
  documentos: readonly DocumentoAberto[];
  imagens: ReadonlyMap<string, ImagemGuardada>;
  /** Achatar o formulário ao salvar: os campos viram desenho e ninguém mais altera. */
  travarFormulario?: boolean;
};

function paraEdicaoDeLinha(e: EdicaoNoEstado): EdicaoDeLinha {
  const { linha } = e;
  return {
    regiao: linha.regiao,
    textoOriginal: linha.texto,
    texto: e.texto,
    ascendente: linha.ascendente,
    descendente: linha.descendente,
    familia: linha.familia,
    negrito: linha.negrito,
    italico: linha.italico,
    corDeFundo: e.corDeFundo,
    corDoTexto: e.corDoTexto,
  };
}

/**
 * Roda `f` com a página sem os links. Um link aponta para outra página, e copiar a
 * página com ele arrastaria o documento inteiro para cada prévia. As outras anotações
 * ficam: um campo de formulário ou um comentário aparecem na página.
 */
async function semLinks<T>(pagina: PDFPage, f: () => Promise<T>): Promise<T> {
  const chave = PDFName.of("Annots");
  const antes = pagina.node.get(chave);
  const lista = pagina.node.lookup(chave);
  if (!(lista instanceof PDFArray)) return f();
  const ficam = pagina.doc.context.obj([]);
  for (let i = 0; i < lista.size(); i++) {
    const a = lista.lookup(i);
    if (!(a instanceof PDFDict) || a.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) {
      ficam.push(lista.get(i));
    }
  }
  pagina.node.set(chave, ficam);
  try {
    return await f();
  } finally {
    if (antes) pagina.node.set(chave, antes);
  }
}

/**
 * A página com as edições, sozinha num PDF: é o que o Editor desenha, para a tela
 * mostrar o resultado de verdade, com a fonte de verdade, em vez de uma imitação.
 */
export async function previaDaPagina(
  doc: DocumentoAberto,
  indice: number,
  edicoes: readonly EdicaoNoEstado[],
): Promise<{ bytes: Uint8Array; resumo: ResumoDaTroca }> {
  const original = await doc.pdfLib();
  const copia = await PDFDocument.create({ updateMetadata: false });
  const [pagina] = await semLinks(original.getPage(indice), () =>
    copia.copyPages(original, [indice]),
  );
  copia.addPage(pagina!);
  const resumo = await aplicarEdicoes(
    copia,
    pagina!,
    edicoes.map(paraEdicaoDeLinha),
    new Map(),
    await doc.usadosDaPagina(indice),
  );
  return { bytes: await copia.save({ useObjectStreams: false }), resumo };
}

/* ------------------------------- Coordenadas --------------------------------- */

type Conversor = {
  /** Da camada do objeto (y para baixo) para o espaço do usuário do PDF (y para cima). */
  paraUsuario: (x: number, y: number) => [number, number];
  /** O giro, em graus no sentido do PDF, para um desenho sair de pé na camada. */
  giro: number;
};

/** Da camada de um objeto para a página sem o giro que a pessoa deu. */
function camadaParaBase(giro: Giro, largura: number, altura: number, x: number, y: number) {
  switch (giro) {
    case 90:
      return [y, altura - x] as const;
    case 180:
      return [largura - x, altura - y] as const;
    case 270:
      return [largura - y, x] as const;
    default:
      return [x, y] as const;
  }
}

/** A área visível da página e o giro que o próprio PDF traz, como o pdf.js os entende. */
type VisaoDaPagina = { x: number; y: number; width: number; height: number; rotacao: number };

async function visaoDa(p: PaginaDoEditor, documentos: readonly DocumentoAberto[]) {
  if (p.documento === null) {
    return { x: 0, y: 0, width: p.largura, height: p.altura, rotacao: 0 } as VisaoDaPagina;
  }
  /* A mesma caixa da tela: o pdf.js cruza CropBox e MediaBox e põe em ordem. A CropBox crua
     do pdf-lib pode ser maior que a página, ou invertida, e os objetos sairiam deslocados. */
  const pg = await documentos[p.documento]!.pagina(p.indice);
  const [x0, y0, x1, y1] = pg.view as [number, number, number, number];
  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    rotacao: ((pg.rotate % 360) + 360) % 360,
  } as VisaoDaPagina;
}

function conversorDa(visao: VisaoDaPagina, giroDaCamada: Giro, p: PaginaDoEditor): Conversor {
  const { rotacao } = visao;
  const caixa = visao;
  return {
    giro: rotacao + giroDaCamada,
    paraUsuario: (x, y) => {
      const [bx, by] = camadaParaBase(giroDaCamada, p.largura, p.altura, x, y);
      switch (rotacao) {
        case 90:
          return [caixa.x + by, caixa.y + bx];
        case 180:
          return [caixa.x + caixa.width - bx, caixa.y + by];
        case 270:
          return [caixa.x + caixa.width - by, caixa.y + caixa.height - bx];
        default:
          return [caixa.x + bx, caixa.y + caixa.height - by];
      }
    },
  };
}

/* ------------------------------ Desenhar objetos ------------------------------- */

type Fontes = (o: ObjetoTexto) => Promise<PDFFont>;

function desenharTexto(pagina: PDFPage, o: ObjetoTexto, c: Conversor, fonte: PDFFont): void {
  const linhas = quebrarLinhas(o.texto, o.l, o);
  linhas.forEach((linha, i) => {
    // As fontes padrão cobrem o português inteiro; o resto sai como "?", em vez de derrubar o salvar.
    const limpa = Array.from(linha.normalize("NFC"))
      .map((ch) => (cabeNaFontePadrao(ch) ? ch : "?"))
      .join("");
    if (!limpa.trim()) return;
    const largura = larguraDoTexto(limpa, o);
    const folga =
      o.alinhamento === "centro"
        ? (o.l - largura) / 2
        : o.alinhamento === "direita"
          ? o.l - largura
          : 0;
    const [x, y] = c.paraUsuario(
      o.x + folga,
      o.y + i * o.tamanho * ENTRELINHA + o.tamanho * baseDaLinha(o.familia),
    );
    pagina.drawText(limpa, {
      x,
      y,
      font: fonte,
      size: o.tamanho,
      rotate: degrees(c.giro),
      color: corDe(o.cor),
    });
  });
}

function corDe(hexa: string) {
  const c = rgbDe(hexa);
  return rgb(c.r, c.g, c.b);
}

async function desenharObjeto(
  doc: PDFDocument,
  pagina: PDFPage,
  o: Objeto,
  c: Conversor,
  fontes: Fontes,
  imagens: ReadonlyMap<string, ImagemGuardada>,
): Promise<void> {
  const [cantoX, cantoY] = c.paraUsuario(o.x, o.y + o.a);
  const rotate = degrees(c.giro);
  switch (o.tipo) {
    case "texto":
      desenharTexto(pagina, o, c, await fontes(o));
      return;
    case "imagem": {
      const img = imagens.get(o.imagemId);
      if (!img) return;
      const embutida =
        img.tipo === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
      pagina.drawImage(embutida, { x: cantoX, y: cantoY, width: o.l, height: o.a, rotate });
      return;
    }
    case "realce":
      pagina.drawRectangle({
        x: cantoX,
        y: cantoY,
        width: o.l,
        height: o.a,
        rotate,
        color: corDe(o.cor),
        opacity: 0.4,
        blendMode: BlendMode.Multiply,
      });
      return;
    case "retangulo":
      pagina.drawRectangle({
        x: cantoX,
        y: cantoY,
        width: o.l,
        height: o.a,
        rotate,
        borderColor: corDe(o.cor),
        borderWidth: o.espessura,
        color: o.preenchimento ? corDe(o.preenchimento) : undefined,
      });
      return;
    case "elipse": {
      const [x, y] = c.paraUsuario(o.x + o.l / 2, o.y + o.a / 2);
      const deitada = c.giro % 180 !== 0;
      pagina.drawEllipse({
        x,
        y,
        xScale: (deitada ? o.a : o.l) / 2,
        yScale: (deitada ? o.l : o.a) / 2,
        borderColor: corDe(o.cor),
        borderWidth: o.espessura,
        color: o.preenchimento ? corDe(o.preenchimento) : undefined,
      });
      return;
    }
    case "linha":
    case "seta":
    case "traco": {
      const pontos = o.pontos.map(([px, py]) => c.paraUsuario(o.x + px * o.l, o.y + py * o.a));
      const primeiro = pontos[0];
      if (!primeiro) return;
      const ops = [
        pushGraphicsState(),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
        setStrokingColor(corDe(o.cor)),
        setLineWidth(o.espessura),
        moveTo(primeiro[0], primeiro[1]),
        ...pontos.slice(1).map(([x, y]) => lineTo(x, y)),
      ];
      const ultimo = pontos[pontos.length - 1];
      const penultimo = pontos[pontos.length - 2];
      if (o.tipo === "seta" && ultimo && penultimo) {
        const angulo = Math.atan2(ultimo[1] - penultimo[1], ultimo[0] - penultimo[0]);
        const ponta = Math.max(8, o.espessura * 4);
        for (const lado of [-1, 1]) {
          const a = angulo + Math.PI + (lado * Math.PI) / 7;
          ops.push(
            moveTo(ultimo[0], ultimo[1]),
            lineTo(ultimo[0] + Math.cos(a) * ponta, ultimo[1] + Math.sin(a) * ponta),
          );
        }
      }
      ops.push(stroke(), popGraphicsState());
      pagina.pushOperators(...ops);
      return;
    }
  }
}

/* ---------------------------------- Salvar ------------------------------------ */

/** As coisas que uma página pode herdar do nó de cima da árvore de páginas. */
function herdarAtributos(pagina: PDFPage): void {
  /* Reordenar tira as páginas da árvore, e os nós do meio somem. O que vinha deles (tamanho,
     recursos, giro) precisa estar na própria página, ou ela sai sem nada disso. */
  for (const chave of PDFPageLeaf.InheritableEntries) {
    const nomeDaChave = PDFName.of(chave);
    if (pagina.node.has(nomeDaChave)) continue;
    const valor = pagina.node.getInheritableAttribute(nomeDaChave);
    if (valor) pagina.node.set(nomeDaChave, valor);
  }
}

/**
 * Outra página com o mesmo conteúdo, sem copiar nada: fontes e imagens ficam uma vez só
 * no arquivo. Os `Contents` precisam de lista própria, senão o que for desenhado numa
 * apareceria na outra. As anotações ficam só na original: anotação é de uma página só.
 */
function duplicarPagina(doc: PDFDocument, original: PDFPage): PDFPage {
  const folha = original.node.clone();
  const contents = original.node.Contents();
  if (contents instanceof PDFArray) folha.set(PDFName.of("Contents"), contents.clone());
  folha.delete(PDFName.of("Annots"));
  return PDFPage.of(folha, doc.context.register(folha), doc);
}

/**
 * Página apagada: esvazia. Um marcador ou um link ainda pode apontar para ela, e aí o
 * conteúdo continuaria no arquivo mesmo depois de `tirarObjetosSoltos`.
 */
function esvaziarPagina(pagina: PDFPage): void {
  const ficam = new Set(["Type", "Parent", "MediaBox"]);
  for (const [chave] of pagina.node.entries()) {
    if (!ficam.has(chave.decodeText())) pagina.node.delete(chave);
  }
}

/**
 * Tira do arquivo o que ninguém mais alcança. O pdf-lib grava TODOS os objetos que
 * carregou: sem isto, o conteúdo antigo da página trocada e o da página apagada seguiam
 * dentro do PDF salvo, e o CPF "trocado" podia ser lido de lá (achado na revisão de
 * 05/11/2026). Só depois do `flush`, que é quando as fontes e imagens novas viram objetos.
 */
async function tirarObjetosSoltos(doc: PDFDocument): Promise<void> {
  await doc.flush();
  const ctx = doc.context;
  const alcancados = new Set<PDFRef>();
  const pilha: PDFObject[] = [];
  const { Root, Encrypt, Info, ID } = ctx.trailerInfo;
  for (const raiz of [Root, Encrypt, Info, ID]) if (raiz) pilha.push(raiz);
  while (pilha.length > 0) {
    const o = pilha.pop()!;
    if (o instanceof PDFRef) {
      if (alcancados.has(o)) continue;
      alcancados.add(o);
      const alvo = ctx.lookup(o);
      if (alvo) pilha.push(alvo);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) pilha.push(o.get(i));
    } else if (o instanceof PDFDict) {
      for (const [, valor] of o.entries()) pilha.push(valor);
    } else if (o instanceof PDFStream) {
      pilha.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!alcancados.has(ref)) ctx.delete(ref);
  }
}

export async function salvarEdicao(
  arquivos: File[],
  pedido: PedidoDeEdicao,
  ao: AoExecutar,
): Promise<Resultado> {
  const { estado, documentos, imagens } = pedido;
  const principal = documentos[0];
  if (!principal) throw new ErroDeConversao("O PDF não está mais aberto.", "SEM_DOCUMENTO");
  if (estado.paginas.length === 0) {
    throw new ErroDeConversao("O PDF precisa de pelo menos uma página.", "SEM_PAGINAS");
  }
  const doc = await carregarNoPdfLib(principal.bytes, principal.nome);
  ao.progresso(0.1);

  /* As páginas, na ordem de agora. A primeira vez que uma página do arquivo principal
     aparece é ela mesma; repetida (duplicada) ou de outro PDF, entra como cópia. */
  const originais = doc.getPages();
  // Antes de duplicar: a cópia nasce com o que a original herdava.
  for (const o of originais) herdarAtributos(o);

  /* Numa chamada só por documento: cada `copyPages` copia as fontes de novo, e 20 páginas
     trazidas do mesmo PDF multiplicavam o arquivo por 20. */
  const copiasDe = new Map<number, Promise<PDFPage[]>>();
  const paginasDe = (documento: number) => {
    let c = copiasDe.get(documento);
    if (!c) {
      const indices = estado.paginas.filter((p) => p.documento === documento).map((p) => p.indice);
      c = documentos[documento]!.pdfLib().then((origem) => doc.copyPages(origem, indices));
      copiasDe.set(documento, c);
    }
    return c;
  };
  const posicaoNaCopia = new Map<number, number>();
  const usadas = new Set<number>();
  const saida: { p: PaginaDoEditor; pagina: PDFPage }[] = [];
  for (const p of estado.paginas) {
    if (p.documento === 0) {
      const original = originais[p.indice]!;
      if (usadas.has(p.indice)) saida.push({ p, pagina: duplicarPagina(doc, original) });
      else saida.push({ p, pagina: original });
      usadas.add(p.indice);
    } else if (p.documento !== null) {
      const n = posicaoNaCopia.get(p.documento) ?? 0;
      posicaoNaCopia.set(p.documento, n + 1);
      saida.push({ p, pagina: (await paginasDe(p.documento))[n]! });
    } else {
      const nova = PDFPage.create(doc);
      nova.setSize(p.largura, p.altura);
      saida.push({ p, pagina: nova });
    }
  }
  const mudou =
    saida.length !== originais.length || saida.some((s, i) => s.pagina !== originais[i]);
  if (mudou) {
    for (let i = originais.length - 1; i >= 0; i--) doc.removePage(i);
    for (const s of saida) doc.addPage(s.pagina);
    originais.forEach((o, i) => {
      if (!usadas.has(i)) esvaziarPagina(o);
    });
  }
  ao.progresso(0.2);

  const cacheDeFontes: CacheDeFontes = new Map();
  const fontesEmbutidas = new Map<string, Promise<PDFFont>>();
  const fontes: Fontes = (o) => {
    const qual = fontePadraoParecida({
      serifa: o.familia === "serif",
      mono: o.familia === "mono",
      negrito: o.negrito,
      italico: o.italico,
    });
    let f = fontesEmbutidas.get(qual);
    if (!f) {
      f = doc.embedFont(qual);
      fontesEmbutidas.set(qual, f);
    }
    return f;
  };

  const edicoes = Object.values(estado.edicoes);
  const paginasEditadas: PDFPage[] = [];
  for (const [n, { p, pagina }] of saida.entries()) {
    pararSeCancelado(ao.sinal);
    const daPagina = edicoes.filter((e) => e.paginaId === p.id);
    if (daPagina.length > 0 && p.documento !== null) {
      paginasEditadas.push(pagina);
      await aplicarEdicoes(
        doc,
        pagina,
        daPagina.map(paraEdicaoDeLinha),
        cacheDeFontes,
        await documentos[p.documento]!.usadosDaPagina(p.indice),
      );
    }
    const objetos = estado.objetos.filter((o) => o.paginaId === p.id);
    if (objetos.length > 0) {
      if (daPagina.length === 0) equilibrarConteudo(doc, pagina, cacheDeFontes);
      const visao = await visaoDa(p, documentos);
      /* Camada por camada, na mesma ordem em que a tela pinta. */
      for (const giro of new Set(objetos.map((o) => o.giroDaCamada))) {
        const c = conversorDa(visao, giro, p);
        for (const o of objetos) {
          if (o.giroDaCamada === giro) await desenharObjeto(doc, pagina, o, c, fontes, imagens);
        }
      }
    }
    if (p.giro !== 0) {
      pagina.setRotation(degrees((pagina.getRotation().angle + p.giro) % 360));
    }
    ao.progresso(0.2 + (0.6 * (n + 1)) / saida.length);
    await respirar();
  }

  pararSeCancelado(ao.sinal);
  // O texto trocado também sai do título, dos metadados, dos marcadores e das miniaturas.
  limparRastros(
    doc,
    edicoes.map((e) => ({ antes: e.linha.texto, depois: e.texto })),
    paginasEditadas,
  );
  const avisoDoFormulario = preencherFormulario(
    doc,
    estado.campos ?? {},
    pedido.travarFormulario === true,
  );
  await tirarObjetosSoltos(doc);
  const bytes = await doc.save();
  ao.progresso(1);
  const nome = arquivos[0]?.name ?? principal.nome;
  return {
    arquivos: [{ nome: `${nomeBase(nome)}-editado.pdf`, blob: blobDe(bytes, "application/pdf") }],
    ...(avisoDoFormulario ? { resumo: avisoDoFormulario } : {}),
  };
}
