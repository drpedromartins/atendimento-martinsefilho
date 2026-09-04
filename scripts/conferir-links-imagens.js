'use strict';
// Lista os links clicáveis e as imagens de cada página, no modelo original e
// no modelo já preparado — para conferir que nada se perdeu no caminho.
const fs = require('fs');
const path = require('path');

const ARQUIVOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['BOAS_VINDAS_F.pdf', 'BOAS_VINDAS_F_LIMPO.pdf'];

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  for (const arq of ARQUIVOS) {
    const caminho = path.join(__dirname, '..', 'templates', arq);
    if (!fs.existsSync(caminho)) { console.log(`\n${arq}: não encontrado`); continue; }

    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(caminho)), useSystemFonts: true,
    }).promise;

    console.log(`\n=== ${arq}`);
    let totalLinks = 0;
    let totalImagens = 0;

    for (let n = 1; n <= doc.numPages; n++) {
      const pag = await doc.getPage(n);

      // Links
      const anotacoes = await pag.getAnnotations();
      const links = anotacoes.filter((a) => a.subtype === 'Link' && (a.url || a.unsafeUrl));

      // Imagens desenhadas na página
      const ops = await pag.getOperatorList();
      const { OPS } = pdfjs;
      const imagens = ops.fnArray.filter((f) =>
        f === OPS.paintImageXObject || f === OPS.paintJpegXObject || f === OPS.paintInlineImageXObject).length;

      totalLinks += links.length;
      totalImagens += imagens;

      const detalheLinks = links.length
        ? links.map((l) => (l.url || l.unsafeUrl)).join('  |  ')
        : '—';
      console.log(`  página ${n}: ${String(imagens).padStart(2)} imagem(ns), ${links.length} link(s)   ${detalheLinks}`);
    }
    console.log(`  TOTAL: ${totalImagens} imagens, ${totalLinks} links`);
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
