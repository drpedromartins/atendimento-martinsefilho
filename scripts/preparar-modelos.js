'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Prepara a carta de boas-vindas a partir de UM ÚNICO design do Canva.
//
//  O escritório mantém no Canva só a versão feminina, que é a referência:
//      templates/BOAS_VINDAS_PADRAO.pdf
//
//  Deste arquivo saem os dois modelos que o sistema usa:
//      BOAS_VINDAS_F_LIMPO.pdf   → cliente mulher
//      BOAS_VINDAS_M_LIMPO.pdf   → cliente homem (concordância trocada aqui)
//
//  Nos dois, o nome do cliente é removido (páginas 1 e 7) — o sistema escreve
//  o nome de cada cliente na hora de gerar a carta. O texto sai de dentro do
//  arquivo de verdade: cobrir com um retângulo deixaria o nome do cliente
//  anterior visível para quem copiasse o conteúdo do PDF.
//
//  Rodar sempre que o design for alterado no Canva:
//      node scripts/preparar-modelos.js
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { PDFDocument, PDFRawStream, PDFArray, PDFName, decodePDFRawStream, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const TEMPLATES = path.join(__dirname, '..', 'templates');
const PADRAO    = path.join(TEMPLATES, 'BOAS_VINDAS_PADRAO.pdf');
const FONTES    = {
  regular: path.join(TEMPLATES, 'Ubuntu-Regular.ttf'),
  negrito: path.join(TEMPLATES, 'Ubuntu-Bold.ttf'),
};

const PRETO  = rgb(0, 0, 0);
const FUNDO  = rgb(232 / 255, 232 / 255, 232 / 255);   // #E8E8E8, o fundo do cartão

// ── O nome do cliente, nas duas páginas em que aparece ───────────────────────
const NOME_DO_CLIENTE = [
  // Capa: "Olá, REGILANE." — o "Olá," fica; saem o nome e o ponto final
  {
    pagina: 1, oque: 'nome na capa',
    casa: (i) => i.texto.trim() !== '' && i.y > 225 && i.y < 240 && i.x > 170 && i.x < 320,
  },
  // Página 7: "Regilane,"
  { pagina: 7, oque: 'nome na página 7',  casa: (i) => i.x < 80 && i.y < 210 && /^[^,]{2,40},$/.test(i.texto.trim()) },
];

// ── O que muda quando o cliente é homem ──────────────────────────────────────
//  Cada item é uma linha inteira do modelo, reescrita com a concordância certa.
const TROCAS_MASCULINO = [
  { pagina: 1, de: 'BEM VINDA',     para: 'BEM VINDO' },
  { pagina: 1, de: 'bem vinda',     para: 'bem vindo' },
  { pagina: 1, de: 'como nossa',    para: 'como nosso' },
  { pagina: 2, de: 'guiá-la',       para: 'guiá-lo' },
  { pagina: 3, de: 'nossa cliente', para: 'nosso cliente' },
  { pagina: 7, de: 'nossa cliente', para: 'nosso cliente' },
];

// ── Leitura do texto, com posição e peso da fonte ────────────────────────────
async function lerTextos(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, fontExtraProperties: true,
  }).promise;

  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const altura = pag.getViewport({ scale: 1 }).height;
    await pag.getOperatorList();                 // carrega as fontes

    paginas.push((await pag.getTextContent()).items.map((i) => {
      let negrito = false;
      try {
        const f = pag.commonObjs.get(i.fontName);
        negrito = /bold/i.test((f && (f.name || f.loadedName)) || '');
      } catch (e) { /* fonte não carregada */ }

      return {
        texto: i.str,
        x: i.transform[4],
        y: altura - i.transform[5],              // linha de base, medida do topo
        tamanho: Math.abs(i.transform[3]) || i.height,
        largura: i.width,
        negrito,
      };
    }));
  }
  return paginas;
}

// ── Localizar um bloco de texto pela posição em que desenha ──────────────────
//  O pdf.js inventa trechos vazios para marcar quebras de linha, então não dá
//  para casar trecho e bloco pela ordem. Seguimos as transformações de
//  coordenada (q/Q/cm) e calculamos onde cada bloco realmente escreve.
function streamDaPagina(pdf, pagina) {
  const contents = pagina.node.Contents();
  const lista = contents instanceof PDFArray
    ? [...Array(contents.size())].map((_, i) => pdf.context.lookup(contents.get(i)))
    : [pdf.context.lookup(contents)];
  return lista.find((s) => s instanceof PDFRawStream) || null;
}

function multiplicar(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

const NUM = '([-\\d.]+)';
const RE_CM = new RegExp(`${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+cm`);
const RE_TM = new RegExp(`${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+Tm`);

function blocosComPosicao(conteudo) {
  const blocos = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha = [];

  const re = /(q|Q|BT[\s\S]*?ET)|([-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+cm)/g;
  let m;
  while ((m = re.exec(conteudo)) !== null) {
    const trecho = m[0];

    if (trecho === 'q') { pilha.push([...ctm]); continue; }
    if (trecho === 'Q') { ctm = pilha.pop() || [1, 0, 0, 1, 0, 0]; continue; }

    if (trecho.endsWith('cm')) {
      const cm = trecho.match(RE_CM);
      if (cm) ctm = multiplicar(cm.slice(1, 7).map(Number), ctm);
      continue;
    }

    if (trecho.startsWith('BT')) {
      const tm = trecho.match(RE_TM);
      if (!tm) continue;
      const matriz = multiplicar(tm.slice(1, 7).map(Number), ctm);
      blocos.push({ inicio: m.index, fim: m.index + trecho.length, x: matriz[4], y: matriz[5] });
    }
  }
  return blocos;
}

function removerBlocoNaPosicao(pdf, pagina, item) {
  const stream = streamDaPagina(pdf, pagina);
  if (!stream) { console.log('      (a página não tem stream de conteúdo legível)'); return false; }

  const conteudo = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  const alvoY = pagina.getSize().height - item.y;

  const perto = blocosComPosicao(conteudo)
    .map((b) => ({ ...b, distancia: Math.hypot(b.x - item.x, b.y - alvoY) }))
    .sort((a, b) => a.distancia - b.distancia)[0];

  if (!perto || perto.distancia > 3) {
    console.log(`      (procurei em x=${item.x.toFixed(1)} y=${alvoY.toFixed(1)}; bloco mais próximo ficou a ${perto ? perto.distancia.toFixed(1) : '?'}pt)`);
    return false;
  }

  const novo = conteudo.slice(0, perto.inicio) + conteudo.slice(perto.fim);
  pagina.node.set(PDFName.of('Contents'),
    pdf.context.register(pdf.context.flateStream(Buffer.from(novo, 'latin1'))));
  return true;
}

// ── Geração de um modelo ─────────────────────────────────────────────────────
async function gerarModelo({ destino, trocas, rotulo }) {
  console.log(`\n=== ${rotulo}  →  ${destino}`);

  const bytesAntes = fs.readFileSync(PADRAO);
  const antes = await lerTextos(bytesAntes);

  const pdf = await PDFDocument.load(bytesAntes);
  pdf.registerFontkit(fontkit);
  const fonte = {
    regular: await pdf.embedFont(fs.readFileSync(FONTES.regular), { subset: true }),
    negrito: await pdf.embedFont(fs.readFileSync(FONTES.negrito), { subset: true }),
  };
  const paginas = pdf.getPages();

  const removidos = [];
  const trocados = [];
  const aEscrever = [];

  // 1) Tira o nome do cliente das duas páginas
  for (const r of NOME_DO_CLIENTE) {
    const alvos = (antes[r.pagina - 1] || []).filter(r.casa);
    if (!alvos.length) { console.log(`  ERRO: não achei o ${r.oque}.`); return false; }

    for (const alvo of alvos) {
      if (!removerBlocoNaPosicao(pdf, paginas[r.pagina - 1], alvo)) {
        console.log(`  ERRO: não consegui remover o ${r.oque}.`); return false;
      }
      removidos.push(alvo.texto);
    }
    console.log(`  página ${r.pagina}: ${r.oque} removido — ${alvos.map((a) => `"${a.texto}"`).join(' + ')}`);
  }

  // 2) Concordância de gênero (só no modelo masculino).
  //    Primeiro removemos todas as linhas antigas; o texto novo é desenhado
  //    depois, porque uma remoção posterior na mesma página descartaria o
  //    desenho que o pdf-lib ainda não gravou.
  for (const t of trocas) {
    const alvo = (antes[t.pagina - 1] || []).find((i) => i.texto.includes(t.de));
    if (!alvo) { console.log(`  ERRO: não achei "${t.de}" na página ${t.pagina}.`); return false; }

    const pagina = paginas[t.pagina - 1];
    if (!removerBlocoNaPosicao(pdf, pagina, alvo)) {
      console.log(`  ERRO: não consegui reescrever a linha da página ${t.pagina}.`); return false;
    }

    const novoTexto = alvo.texto.split(t.de).join(t.para);
    aEscrever.push({ pagina, alvo, novoTexto });
    trocados.push({ antigo: alvo.texto, novo: novoTexto });
    console.log(`  página ${t.pagina}: "${t.de}" → "${t.para}"`);
  }

  //    A linha antiga já saiu do arquivo, então não há nada a cobrir: um
  //    retângulo de fundo aqui invadiria o texto vizinho (o "Martins e Filho"
  //    que vem logo depois, na mesma linha).
  for (const { pagina, alvo, novoTexto } of aEscrever) {
    const { height } = pagina.getSize();
    pagina.drawText(novoTexto, {
      x: alvo.x,
      y: height - alvo.y,
      size: alvo.tamanho,
      font: alvo.negrito ? fonte.negrito : fonte.regular,
      color: PRETO,
    });
  }

  const bytesDepois = await pdf.save();

  // 3) Conferência: saiu o que devia sair, entrou o que devia entrar,
  //    e nada mais se perdeu no caminho.
  const depois = await lerTextos(bytesDepois);
  const juntar = (p) => p.flat().map((i) => i.texto).filter((t) => t.trim() !== '');
  const listaAntes = juntar(antes);
  const listaDepois = juntar(depois);

  const problemas = [];
  for (const t of removidos) {
    if (listaDepois.some((d) => d.trim() === t.trim())) problemas.push(`o texto "${t}" continua no arquivo`);
  }
  for (const { antigo, novo } of trocados) {
    if (listaDepois.some((d) => d.trim() === antigo.trim())) problemas.push(`a versão antiga continua: "${antigo}"`);
    if (!listaDepois.some((d) => d.trim() === novo.trim())) problemas.push(`faltou a versão corrigida: "${novo}"`);
  }

  const restante = [...listaDepois];
  const sumiram = listaAntes.filter((t) => {
    const i = restante.indexOf(t);
    if (i >= 0) { restante.splice(i, 1); return false; }
    return true;
  });
  const previstos = [...removidos, ...trocados.map((x) => x.antigo)];
  sumiram.filter((t) => !previstos.includes(t))
    .forEach((t) => problemas.push(`sumiu um texto que não devia: "${t}"`));

  if (problemas.length) {
    problemas.forEach((p) => console.log(`  ERRO: ${p}`));
    console.log('  Modelo NÃO foi gravado.');
    return false;
  }

  fs.writeFileSync(path.join(TEMPLATES, destino), bytesDepois);
  console.log(`  ✓ conferido: ${listaDepois.length} trechos de texto, nada perdido por engano`);
  console.log(`  ✓ gravado: ${destino} (${(bytesDepois.length / 1024 / 1024).toFixed(2)} MB)`);
  return true;
}

(async () => {
  if (!fs.existsSync(PADRAO)) {
    console.error(`Não encontrei ${path.basename(PADRAO)} em templates/.`);
    console.error('Exporte o design do Canva em PDF e salve com esse nome.');
    process.exit(1);
  }

  console.log(`Modelo de referência: ${path.basename(PADRAO)}`);

  const ok = [
    await gerarModelo({ destino: 'BOAS_VINDAS_F_LIMPO.pdf', trocas: [],                rotulo: 'cliente mulher' }),
    await gerarModelo({ destino: 'BOAS_VINDAS_M_LIMPO.pdf', trocas: TROCAS_MASCULINO,  rotulo: 'cliente homem' }),
  ];

  console.log(ok.every(Boolean) ? '\nModelos prontos.' : '\nHouve problema — veja acima.');
  process.exit(ok.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
