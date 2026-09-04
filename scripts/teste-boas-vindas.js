'use strict';
// Gera cartas de boas-vindas de teste e confere:
//  • que o nome do cliente entrou certo;
//  • que nenhum nome de cliente antigo sobrou dentro do arquivo.
const fs   = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const BoasVindas = require('../lib/boasvindas');

const NOMES_ANTIGOS = ['Regilane', 'REGILANE', 'Roberpaulo'];

// Concordância que NÃO pode aparecer em cada versão
const ERRADO_PARA_HOMEM  = [/bem\s*vinda/i, /nossa\s+cliente/i, /guiá-la/i];
const ERRADO_PARA_MULHER = [/bem\s*vindo/i, /nosso\s+cliente/i, /guiá-lo/i];

const CASOS = [
  { nomeCliente: 'Maria Aparecida de Souza', genero: 'F' },
  { nomeCliente: 'João Conceição Assunção',  genero: 'M' },
  { nomeCliente: 'Ana Paula Costa',          estadoCivil: 'Casada' },
  { nomeCliente: 'Carlos Eduardo Nogueira',  estadoCivil: 'Solteiro' },
];

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const saida = path.join(__dirname, '..', '_saida_teste');
  fs.mkdirSync(saida, { recursive: true });

  let problemas = 0;

  for (const caso of CASOS) {
    const bytes = await BoasVindas.gerarBoasVindas(caso);
    const esperado = 'Olá, ' + BoasVindas.nomeDeTratamento(caso.nomeCliente) + '.';
    const arquivo = path.join(saida, 'carta_' + caso.nomeCliente.split(' ')[0] + '.pdf');
    fs.writeFileSync(arquivo, bytes);

    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;

    // Junta o texto de todas as páginas: o nome aparece em duas delas e a
    // concordância precisa estar certa na carta inteira.
    const porPagina = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      porPagina.push((await p.getTextContent()).items.map((i) => i.str));
    }
    const textos = porPagina.flat();
    const tudo = textos.join(' ');
    const genero = BoasVindas.ehFeminino(caso);

    const nomeCurto = BoasVindas.nomeDeTratamento(caso.nomeCliente);
    const naCapa    = porPagina[0].some((t) => t.trim() === nomeCurto.toUpperCase() + '.');
    const naPagina7 = (porPagina[6] || []).some((t) => t.trim() === nomeCurto + ',');
    const vazou     = NOMES_ANTIGOS.filter((n) => tudo.includes(n));
    const erradas   = (genero === false ? ERRADO_PARA_HOMEM : ERRADO_PARA_MULHER)
      .filter((re) => re.test(tudo));

    let situacao = 'OK';
    if (!naCapa)          situacao = `ERRO: nome não saiu na capa`;
    else if (!naPagina7)  situacao = `ERRO: nome não saiu na página 7`;
    else if (vazou.length) situacao = `ERRO: nome antigo ainda no arquivo (${vazou.join(', ')})`;
    else if (erradas.length) situacao = `ERRO: concordância errada (${erradas.map((r) => r.source).join(', ')})`;
    if (situacao !== 'OK') problemas++;

    const pag = await doc.getPage(1);
    console.log(`  ${situacao === 'OK' ? '✓' : '✗'} ${esperado.padEnd(34)} ${(genero === null ? 'neutro' : genero ? 'feminino' : 'masculino').padEnd(10)} ${(bytes.length / 1024 / 1024).toFixed(2)} MB   ${situacao}`);

    // Imagem da primeira página, para conferir de olho
    const viewport = pag.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await pag.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    fs.writeFileSync(arquivo.replace('.pdf', '.png'), canvas.toBuffer('image/png'));
  }

  console.log(problemas ? `\n${problemas} problema(s).` : '\nTudo certo.');
  process.exit(problemas ? 1 : 0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
