'use strict';
// Renderiza páginas específicas de um modelo e lista os textos com posição.
//   node scripts/ver-paginas.js BOAS_VINDAS_F.pdf 6 7 8
const fs   = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const arq = process.argv[2] || 'BOAS_VINDAS_F.pdf';
const paginas = process.argv.slice(3).map(Number).filter(Boolean);

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const caminho = path.join(__dirname, '..', 'templates', arq);
  const saida = path.join(__dirname, '..', '_saida_teste');
  fs.mkdirSync(saida, { recursive: true });

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(caminho)), useSystemFonts: true,
  }).promise;

  console.log(`${arq}: ${doc.numPages} páginas`);

  for (const n of (paginas.length ? paginas : [...Array(doc.numPages)].map((_, i) => i + 1))) {
    const pag = await doc.getPage(n);
    const viewport = pag.getViewport({ scale: 1 });
    const conteudo = await pag.getTextContent();

    console.log(`\n=== página ${n}  (${viewport.width.toFixed(0)} x ${viewport.height.toFixed(0)} pt)`);
    conteudo.items
      .filter((i) => i.str.trim() !== '')
      .forEach((i) => {
        const x = i.transform[4];
        const yTopo = viewport.height - i.transform[5];
        const tam = Math.abs(i.transform[3]) || i.height;
        const fim = x + i.width;
        console.log(`  x=${x.toFixed(0).padStart(5)}..${fim.toFixed(0).padStart(4)} y=${yTopo.toFixed(0).padStart(4)} ${tam.toFixed(1).padStart(5)}pt  "${i.str}"`);
      });

    const canvas = createCanvas(viewport.width, viewport.height);
    await pag.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const png = path.join(saida, `${arq.replace('.pdf', '')}_p${n}.png`);
    fs.writeFileSync(png, canvas.toBuffer('image/png'));
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
