'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Confere onde o nome do cliente aparece no design do Canva, para o sistema
//  escrevê-lo no lugar certo.
//
//  Rodar depois de alterar o design e exportar o novo BOAS_VINDAS_PADRAO.pdf:
//      node scripts/calibrar-boas-vindas.js
//
//  Ele imprime os valores prontos para a constante LOCAIS_DO_NOME,
//  em lib/boasvindas.js.
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', 'templates', 'BOAS_VINDAS_PADRAO.pdf');

(async () => {
  if (!fs.existsSync(ARQUIVO)) {
    console.error('Não encontrei templates/BOAS_VINDAS_PADRAO.pdf.');
    process.exit(1);
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(ARQUIVO)),
    useSystemFonts: false, disableFontFace: true, fontExtraProperties: true,
  }).promise;

  console.log(`BOAS_VINDAS_PADRAO.pdf — ${doc.numPages} páginas\n`);

  async function itensDaPagina(n) {
    const pag = await doc.getPage(n);
    const altura = pag.getViewport({ scale: 1 }).height;
    await pag.getOperatorList();
    return (await pag.getTextContent()).items
      .filter((i) => i.str.trim() !== '')
      .map((i) => {
        let negrito = false;
        try {
          const f = pag.commonObjs.get(i.fontName);
          negrito = /bold/i.test((f && (f.name || f.loadedName)) || '');
        } catch (e) { /* ignore */ }
        return {
          texto: i.str,
          x: i.transform[4],
          baseY: altura - i.transform[5],
          tamanho: Math.abs(i.transform[3]) || i.height,
          negrito,
        };
      });
  }

  function mostrar(rotulo, item, formato) {
    if (!item) { console.log(`  ${rotulo}: NÃO ENCONTRADO`); return; }
    console.log(`  ${rotulo}: "${item.texto}"`);
    console.log(`    { pagina: X, x: ${item.x.toFixed(1)}, baseY: ${item.baseY.toFixed(1)}, `
      + `tamanho: ${item.tamanho.toFixed(1)}, negrito: ${item.negrito}, texto: ${formato} },`);
  }

  // Capa: o nome vem logo depois do "Olá,"
  const capa = await itensDaPagina(1);
  const ola = capa.find((i) => /^ol[áa][\s,]*$/i.test(i.texto.trim()));
  const nomeCapa = ola
    ? capa.find((i) => Math.abs(i.baseY - ola.baseY) < 3 && i.x > ola.x + 5)
    : null;
  mostrar('nome na capa (página 1)', nomeCapa, '(n) => `${n.toUpperCase()}.`');

  // Página 7: o nome é o texto curto terminado em vírgula, no alto à esquerda
  const p7 = await itensDaPagina(7);
  const nomeP7 = p7.find((i) => i.x < 80 && i.baseY < 210 && /^[^,]{2,40},$/.test(i.texto.trim()));
  console.log('');
  mostrar('nome na página 7', nomeP7, '(n) => `${n},`');

  console.log('\nSe algum valor mudou, atualize LOCAIS_DO_NOME em lib/boasvindas.js');
  console.log('e rode: node scripts/preparar-modelos.js && node scripts/teste-boas-vindas.js');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
