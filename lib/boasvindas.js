'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  PDF de boas-vindas ao cliente — Martins & Filho
//
//  Dois caminhos:
//  1. Se existirem os PDFs oficiais em templates/ (exportados do Canva),
//     o sistema usa o do gênero certo e escreve o nome do cliente por cima.
//         templates/BOAS_VINDAS_F.pdf   (feminino)
//         templates/BOAS_VINDAS_M.pdf   (masculino)
//  2. Se não existirem, monta o PDF do zero com a identidade do escritório.
//
//  A posição do nome no PDF oficial pode ser calibrada sem mexer no código,
//  pelas variáveis de ambiente BV_* (ver README).
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const TEMPLATES = path.join(__dirname, '..', 'templates');

// Identidade visual do escritório
const BEGE   = rgb(0.957, 0.945, 0.918); // #F4F1EA
const DOURADO= rgb(0.788, 0.659, 0.298); // #C9A84C
const ESCURO = rgb(0.102, 0.102, 0.063); // #1A1A10
const CINZA  = rgb(0.353, 0.345, 0.251); // #5A5840

const num = (v, padrao) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : padrao;
};

// ── Gênero do cliente ────────────────────────────────────────────────────────
// Vem do seletor obrigatório "Gênero" da ficha. Nada de adivinhar: antes, um
// cliente sem gênero marcado caía na carta feminina ("SEJA BEM VINDA").
function ehFeminino(d) {
  const g = String((d && d.genero) || '').trim().toLowerCase();
  if (g.startsWith('f')) return true;
  if (g.startsWith('m')) return false;
  return null;
}

// Primeiro e segundo nome do cliente, com as iniciais maiúsculas.
// Partículas como "de", "da", "dos" não contam como segundo nome:
// "Maria de Souza Lima" → "Maria de Souza".
function nomeDeTratamento(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Cliente';

  const particula = (p) => /^(de|da|do|das|dos|e|del|di|van|von)$/i.test(p);
  const maiuscula = (p) => (particula(p)
    ? p.toLowerCase()
    : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

  const escolhidas = [partes[0]];
  for (let i = 1; i < partes.length; i++) {
    escolhidas.push(partes[i]);
    if (!particula(partes[i])) break;   // parou no primeiro nome de verdade
  }
  return escolhidas.map(maiuscula).join(' ');
}

// ── Caminho 1: escrever o nome sobre o PDF oficial do escritório ─────────────
//
//  Medidas conferidas nos PDFs exportados do Canva em 04/09/2026
//  (página de 1440 x 810 pt; saudação na página 1). Se os PDFs forem
//  refeitos, rode `node scripts/calibrar-boas-vindas.js` e atualize aqui —
//  ou ajuste pelas variáveis de ambiente BV_*, sem mexer no código.
//
//  Todas as medidas verticais são contadas a partir do TOPO da página.
//  O nome do cliente aparece em DOIS lugares da carta:
//   • capa (página 1): logo depois do "Olá,", em negrito e caixa alta;
//   • página 7: no começo do texto, em letra normal.
//
//  Como as duas versões saem do mesmo design do Canva, as medidas valem para
//  cliente homem e cliente mulher. Conferir com `node scripts/calibrar-boas-vindas.js`
//  se o design mudar.
const LOCAIS_DO_NOME = [
  {
    pagina: 1, x: 174.2, baseY: 233.3, tamanho: 24.3, negrito: true,
    texto: (n) => `${n.toUpperCase()}.`,
  },
  {
    pagina: 7, x: 46.9, baseY: 170.6, tamanho: 20.6, negrito: true,
    texto: (n) => `${n},`,
  },
];

// Cor exata do fundo do cartão nos PDFs do escritório
const FUNDO_CARTAO = rgb(232 / 255, 232 / 255, 232 / 255); // #E8E8E8
const TEXTO_PRETO  = rgb(0, 0, 0);

// O modelo do Canva usa a fonte Ubuntu. Escrevemos o nome do cliente com ela,
// para que a saudação fique igual ao resto do texto.
const ARQUIVOS_FONTE = {
  regular: path.join(TEMPLATES, 'Ubuntu-Regular.ttf'),
  negrito: path.join(TEMPLATES, 'Ubuntu-Bold.ttf'),
};

async function sobreporNoModelo(caminho, nome) {
  const pdf = await PDFDocument.load(fs.readFileSync(caminho));

  // Os modelos preparados já vêm sem o nome do cliente anterior, então aqui
  // é só escrever — não há nada para cobrir.
  const temUbuntu = fs.existsSync(ARQUIVOS_FONTE.regular) && fs.existsSync(ARQUIVOS_FONTE.negrito);
  let fonte;
  if (temUbuntu) {
    pdf.registerFontkit(fontkit);
    fonte = {
      regular: await pdf.embedFont(fs.readFileSync(ARQUIVOS_FONTE.regular), { subset: true }),
      negrito: await pdf.embedFont(fs.readFileSync(ARQUIVOS_FONTE.negrito), { subset: true }),
    };
  } else {
    fonte = {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      negrito: await pdf.embedFont(StandardFonts.HelveticaBold),
    };
  }

  const paginas = pdf.getPages();

  LOCAIS_DO_NOME.forEach((local, i) => {
    const pagina = paginas[local.pagina - 1];
    if (!pagina) return;

    const { height } = pagina.getSize();

    // As variáveis de ambiente BV_* permitem ajustar a saudação da capa
    // sem mexer no código, caso o design mude de lugar.
    const naCapa = i === 0;

    pagina.drawText(local.texto(nome), {
      x: naCapa ? num(process.env.BV_X, local.x) : local.x,
      y: height - (naCapa ? num(process.env.BV_Y, local.baseY) : local.baseY),
      size: naCapa ? num(process.env.BV_TAM, local.tamanho) : local.tamanho,
      font: local.negrito ? fonte.negrito : fonte.regular,
      color: TEXTO_PRETO,
    });
  });

  return Buffer.from(await pdf.save());
}

// ── Caminho 2: montar o PDF do zero ─────────────────────────────────────────
async function montarDoZero(nome, fem) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const L = 960, A = 540;                  // proporção 16:9, como o original
  const MARGEM = 70;

  // Concordância de gênero
  const vinda   = fem === null ? 'bem-vindo(a)' : (fem ? 'bem-vinda' : 'bem-vindo');
  const VINDA   = vinda.toUpperCase();
  const cliente = fem === null ? 'cliente' : (fem ? 'nossa cliente' : 'nosso cliente');
  const guiar   = fem === null ? 'guiá-lo(a)' : (fem ? 'guiá-la' : 'guiá-lo');

  function novaPagina() {
    const p = pdf.addPage([L, A]);
    p.drawRectangle({ x: 0, y: 0, width: L, height: A, color: BEGE });
    p.drawRectangle({ x: 0, y: A - 8, width: L, height: 8, color: DOURADO });
    p.drawText('MARTINS & FILHO', {
      x: MARGEM, y: A - 46, size: 17, font: negrito, color: ESCURO,
    });
    p.drawText('ADVOGADOS ASSOCIADOS', {
      x: MARGEM, y: A - 62, size: 8, font: regular, color: CINZA,
    });
    return p;
  }

  // Escreve um parágrafo quebrando as linhas na largura disponível
  function paragrafo(p, texto, x, y, largura, tam, fonte, cor, entrelinha = 1.5) {
    const palavras = String(texto).split(/\s+/);
    let linha = '';
    let cursor = y;
    for (const palavra of palavras) {
      const tentativa = linha ? linha + ' ' + palavra : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tam) > largura && linha) {
        p.drawText(linha, { x, y: cursor, size: tam, font: fonte, color: cor });
        cursor -= tam * entrelinha;
        linha = palavra;
      } else {
        linha = tentativa;
      }
    }
    if (linha) {
      p.drawText(linha, { x, y: cursor, size: tam, font: fonte, color: cor });
      cursor -= tam * entrelinha;
    }
    return cursor;
  }

  // ── Página 1 ──────────────────────────────────────────────────────────────
  const p1 = novaPagina();
  p1.drawText(`SEJA ${VINDA}!`, {
    x: MARGEM, y: A - 130, size: 34, font: negrito, color: ESCURO,
  });
  p1.drawRectangle({ x: MARGEM, y: A - 146, width: 120, height: 3, color: DOURADO });

  let y = A - 190;
  y = paragrafo(p1, `Olá, ${nome}.`, MARGEM, y, 800, 15, negrito, ESCURO);
  y -= 12;
  y = paragrafo(p1, `Parabéns por escolher o Martins & Filho Advogados Associados. Ficamos felizes em ter você como ${cliente} e vamos trabalhar para que sua experiência conosco seja a mais eficiente e tranquila possível.`,
    MARGEM, y, 820, 12, regular, ESCURO);
  y -= 10;
  y = paragrafo(p1, 'Neste documento você encontra as informações mais importantes sobre como será o nosso trabalho a partir de agora.',
    MARGEM, y, 820, 12, regular, ESCURO);

  // ── Página 2 ──────────────────────────────────────────────────────────────
  const p2 = novaPagina();
  p2.drawText('Informações importantes', {
    x: MARGEM, y: A - 120, size: 24, font: negrito, color: ESCURO,
  });
  p2.drawRectangle({ x: MARGEM, y: A - 134, width: 100, height: 3, color: DOURADO });

  y = A - 175;
  y = paragrafo(p2, 'Confirmação do contrato', MARGEM, y, 800, 13, negrito, ESCURO);
  y -= 6;
  y = paragrafo(p2, 'Seu contrato de honorários e os documentos necessários ao protocolo da ação foram assinados e registrados em nosso sistema.',
    MARGEM, y, 820, 11.5, regular, ESCURO);

  y -= 22;
  y = paragrafo(p2, 'Quem cuida do seu caso', MARGEM, y, 800, 13, negrito, ESCURO);
  y -= 6;
  y = paragrafo(p2, `Seu contato a partir de agora é o nosso time jurídico, pronto para responder às suas perguntas e ${guiar} ao longo do processo.`,
    MARGEM, y, 820, 11.5, regular, ESCURO);
  y -= 6;
  y = paragrafo(p2, 'Telefone do escritório: (61) 3224-6020   |   E-mail: contato@martinsefilho.adv.br',
    MARGEM, y, 820, 11.5, negrito, CINZA);

  y -= 22;
  y = paragrafo(p2, 'Atenção a golpes', MARGEM, y, 800, 13, negrito, ESCURO);
  y -= 6;
  paragrafo(p2, 'O escritório nunca pede depósitos, PIX ou pagamento de taxas para dar andamento ao processo. Se receber uma cobrança em nosso nome, não pague: ligue antes para o telefone acima.',
    MARGEM, y, 820, 11.5, regular, ESCURO);

  // ── Página 3 ──────────────────────────────────────────────────────────────
  const p3 = novaPagina();
  p3.drawText('Próximos passos', {
    x: MARGEM, y: A - 120, size: 24, font: negrito, color: ESCURO,
  });
  p3.drawRectangle({ x: MARGEM, y: A - 134, width: 100, height: 3, color: DOURADO });

  y = A - 175;
  y = paragrafo(p3, 'Vamos analisar os documentos que você já nos entregou e, se for necessário, entraremos em contato para pedir outros. Também podemos marcar reuniões para tratar dos detalhes do seu caso.',
    MARGEM, y, 820, 11.5, regular, ESCURO);
  y -= 10;
  y = paragrafo(p3, 'Assim que a ação estiver pronta para o protocolo, avisaremos você e informaremos o número do processo.',
    MARGEM, y, 820, 11.5, regular, ESCURO);

  y -= 22;
  y = paragrafo(p3, 'Como vamos nos falar', MARGEM, y, 800, 13, negrito, ESCURO);
  y -= 6;
  y = paragrafo(p3, 'Nosso canal oficial é o WhatsApp (61) 3224-6020. Salve esse número na sua agenda. Sempre que houver uma novidade importante no processo, avisaremos você por ali.',
    MARGEM, y, 820, 11.5, regular, ESCURO);

  y -= 22;
  y = paragrafo(p3, 'Duas coisas que ajudam muito', MARGEM, y, 800, 13, negrito, ESCURO);
  y -= 6;
  y = paragrafo(p3, '1. Avise-nos antes de aceitar qualquer proposta de acordo feita diretamente pela empresa.',
    MARGEM, y, 820, 11.5, regular, ESCURO);
  y -= 2;
  paragrafo(p3, '2. Mantenha seu telefone e endereço atualizados conosco — a Justiça pode precisar localizar você.',
    MARGEM, y, 820, 11.5, regular, ESCURO);

  // ── Página 4 ──────────────────────────────────────────────────────────────
  const p4 = novaPagina();
  p4.drawText('Conte com a gente', {
    x: MARGEM, y: A - 150, size: 26, font: negrito, color: ESCURO,
  });
  p4.drawRectangle({ x: MARGEM, y: A - 166, width: 100, height: 3, color: DOURADO });

  y = A - 210;
  y = paragrafo(p4, 'Agradecemos pela confiança. Estamos aqui para trabalhar lado a lado com você e buscar o melhor resultado possível para o seu caso.',
    MARGEM, y, 820, 13, regular, ESCURO);
  y -= 14;
  paragrafo(p4, 'Se tiver qualquer dúvida ou precisar de ajuda ao longo do caminho, é só entrar em contato.',
    MARGEM, y, 820, 13, regular, ESCURO);

  p4.drawText('Martins & Filho Advogados Associados', {
    x: MARGEM, y: 90, size: 12, font: negrito, color: ESCURO,
  });
  p4.drawText('(61) 3224-6020   |   contato@martinsefilho.adv.br', {
    x: MARGEM, y: 72, size: 10, font: regular, color: CINZA,
  });

  return Buffer.from(await pdf.save());
}

// ── Ponto de entrada ─────────────────────────────────────────────────────────
async function gerarBoasVindas(d) {
  const nome = nomeDeTratamento(d.nomeCliente);
  const fem  = ehFeminino(d);

  if (fem === null) {
    throw new Error('Informe se o cliente é homem ou mulher (campo "Gênero" na ficha) '
      + 'para gerar a carta de boas-vindas.');
  }

  // Escolhe o modelo conforme o gênero do cliente. Os dois saem do mesmo
  // design do Canva, preparados por `node scripts/preparar-modelos.js`:
  // o masculino já vem com a concordância trocada (bem vindo, nosso cliente,
  // guiá-lo).
  const modelo = path.join(TEMPLATES, `BOAS_VINDAS_${fem ? 'F' : 'M'}_LIMPO.pdf`);

  if (fs.existsSync(modelo)) {
    try {
      return await sobreporNoModelo(modelo, nome);
    } catch (e) {
      console.error('Falha ao usar o modelo oficial de boas-vindas, montando do zero:', e.message);
    }
  }

  return montarDoZero(nome, fem);
}

module.exports = { gerarBoasVindas, ehFeminino, nomeDeTratamento };
