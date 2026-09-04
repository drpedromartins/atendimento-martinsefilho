'use strict';
// Varre o modelo padrão e lista TODO trecho de texto com marca de gênero,
// para garantir que a versão masculina seja gerada sem deixar nada para trás.
const fs   = require('fs');
const path = require('path');

const arq = process.argv[2] || 'BOAS_VINDAS_PADRAO.pdf';

// Palavras que denunciam gênero no texto da carta
const MARCAS = /(bem[\s-]?vind[oa]|vind[oa]|noss[oa]\s+client|client[ea]\b|\bela\b|\bele\b|guiá-l[oa]|-l[oa]\b|\bo\(a\)|\ba\(o\)|senhor[a]?|Sr[a]?\.|amig[oa]|preparad[oa]|satisfeit[oa]|entusiasmad[oa]s?)/i;

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'templates', arq))),
    useSystemFonts: true,
  }).promise;

  console.log(`${arq}: ${doc.numPages} páginas\n`);

  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const altura = pag.getViewport({ scale: 1 }).height;
    const itens = (await pag.getTextContent()).items.filter((i) => i.str.trim() !== '');

    const comMarca = itens.filter((i) => MARCAS.test(i.str));
    if (!comMarca.length) continue;

    console.log(`=== página ${n}`);
    comMarca.forEach((i) => {
      const x = i.transform[4];
      const y = altura - i.transform[5];
      const tam = Math.abs(i.transform[3]) || i.height;
      console.log(`  x=${x.toFixed(0).padStart(5)}..${(x + i.width).toFixed(0).padStart(4)} y=${y.toFixed(0).padStart(4)} ${tam.toFixed(1).padStart(5)}pt  "${i.str}"`);
    });
    console.log('');
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
