'use strict';
// Descobre qual fonte o modelo usa na saudação e, se possível, salva o arquivo
// dessa fonte em templates/, para o sistema escrever o nome com a mesma letra.
const fs = require('fs');
const path = require('path');

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const templates = path.join(__dirname, '..', 'templates');

  for (const arq of ['BOAS_VINDAS_F.pdf', 'BOAS_VINDAS_M.pdf']) {
    const caminho = path.join(templates, arq);
    if (!fs.existsSync(caminho)) continue;

    console.log(`\n=== ${arq}`);
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(caminho)),
      useSystemFonts: false,
      disableFontFace: true,
      fontExtraProperties: true,
    }).promise;

    const pag = await doc.getPage(1);
    await pag.getOperatorList();            // força o carregamento das fontes
    const conteudo = await pag.getTextContent();

    const usadas = new Map();
    for (const item of conteudo.items) {
      if (!item.fontName) continue;
      if (!usadas.has(item.fontName)) usadas.set(item.fontName, item.str);
    }

    for (const [interno, exemplo] of usadas) {
      let obj = null;
      try { obj = pag.commonObjs.get(interno); } catch (e) { /* ainda não carregada */ }

      const nomeReal = obj ? (obj.name || obj.loadedName || '?') : '?';
      console.log(`  ${interno.padEnd(10)} → ${String(nomeReal).padEnd(32)} ex.: "${exemplo.slice(0, 30)}"`);

      if (obj && obj.data && obj.data.length) {
        const destino = path.join(templates, `FONTE_${String(nomeReal).replace(/[^A-Za-z0-9]/g, '_')}.ttf`);
        fs.writeFileSync(destino, Buffer.from(obj.data));
        console.log(`      arquivo da fonte salvo: ${path.basename(destino)} (${(obj.data.length / 1024).toFixed(0)} KB)`);
      }
    }
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
