'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Edição de texto dentro dos arquivos Word (.docx)
//
//  No Word, uma mesma palavra muitas vezes está partida em vários pedaços de
//  formatação ("inscrito" + "(a)"). Por isso as trocas aqui olham o texto do
//  parágrafo inteiro e depois devolvem cada letra ao seu pedaço original —
//  assim negrito, sublinhado e fonte continuam exatamente onde estavam.
// ─────────────────────────────────────────────────────────────────────────────

const RE_TEXTO = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
const RE_FIM_PARAGRAFO = /<\/w:p>/g;

const decodificar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

const codificar = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Aplica `trocas` ([regex, substituição]) no texto de cada parágrafo do XML.
function substituirNosParagrafos(xml, trocas) {
  // Localiza todos os pedaços de texto e o parágrafo a que pertencem
  const nos = [];
  let m;
  RE_TEXTO.lastIndex = 0;
  while ((m = RE_TEXTO.exec(xml)) !== null) {
    nos.push({ inicio: m.index, fim: m.index + m[0].length, attrs: m[1] || '', texto: decodificar(m[2]) });
  }
  if (!nos.length) return xml;

  const finsParagrafo = [];
  RE_FIM_PARAGRAFO.lastIndex = 0;
  while ((m = RE_FIM_PARAGRAFO.exec(xml)) !== null) finsParagrafo.push(m.index);

  const grupos = [];
  let atual = [];
  let p = 0;
  for (const no of nos) {
    while (p < finsParagrafo.length && finsParagrafo[p] < no.inicio) {
      if (atual.length) grupos.push(atual);
      atual = [];
      p++;
    }
    atual.push(no);
  }
  if (atual.length) grupos.push(atual);

  // Em cada parágrafo: junta o texto, aplica as trocas, devolve aos pedaços
  for (const grupo of grupos) {
    let letras = [];
    grupo.forEach((no, i) => { for (const ch of no.texto) letras.push({ ch, no: i }); });
    const original = letras.map((l) => l.ch).join('');
    if (!original) continue;

    let mudou = false;
    for (const [regex, subst] of trocas) {
      const texto = letras.map((l) => l.ch).join('');
      const achados = [];
      regex.lastIndex = 0;
      let a;
      while ((a = regex.exec(texto)) !== null) {
        const nova = typeof subst === 'function' ? subst(...a) : a[0].replace(new RegExp(regex.source, regex.flags.replace('g', '')), subst);
        if (nova !== a[0]) achados.push({ ini: a.index, fim: a.index + a[0].length, nova });
        if (a[0].length === 0) regex.lastIndex++;
      }
      if (!achados.length) continue;
      mudou = true;

      // Trabalha em unidades de código (JS), mapeando para as letras
      const unidades = [];
      letras.forEach((l, idx) => { for (let k = 0; k < l.ch.length; k++) unidades.push(idx); });

      for (const ac of achados.reverse()) {
        const iniLetra = ac.ini < unidades.length ? unidades[ac.ini] : letras.length;
        const fimLetra = ac.fim - 1 < unidades.length && ac.fim > ac.ini ? unidades[ac.fim - 1] + 1 : iniLetra;
        const dono = letras[Math.min(iniLetra, letras.length - 1)].no;
        const novas = [...ac.nova].map((ch) => ({ ch, no: dono }));
        letras.splice(iniLetra, fimLetra - iniLetra, ...novas);
      }
    }
    if (!mudou) continue;

    grupo.forEach((no, i) => {
      no.novoTexto = letras.filter((l) => l.no === i).map((l) => l.ch).join('');
    });
  }

  // Remonta o XML de trás para frente, para as posições continuarem válidas
  let saida = xml;
  for (let i = nos.length - 1; i >= 0; i--) {
    const no = nos[i];
    if (no.novoTexto === undefined || no.novoTexto === no.texto) continue;
    const attrs = /xml:space=/.test(no.attrs) ? no.attrs : `${no.attrs} xml:space="preserve"`;
    saida = saida.slice(0, no.inicio) + `<w:t${attrs}>${codificar(no.novoTexto)}</w:t>` + saida.slice(no.fim);
  }
  return saida;
}

// ── Realce e sombreamento ────────────────────────────────────────────────────
// Remove o marca-texto (amarelo ou qualquer cor) e o fundo colorido do texto.
function removerRealces(xml) {
  return xml
    .replace(/<w:highlight\b[^>]*\/>/g, '')
    .replace(/<w:highlight\b[^>]*>[\s\S]*?<\/w:highlight>/g, '')
    .replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_, dentro) =>
      `<w:rPr>${dentro.replace(/<w:shd\b[^>]*\/>/g, '')}</w:rPr>`);
}

// ── Gênero ───────────────────────────────────────────────────────────────────
//  Os modelos do escritório marcam as palavras que mudam com o gênero do
//  cliente assim: "portador(a)", "o(a) Contratante", "ao(à)", "O(A)".
//  Aqui cada marca vira a forma certa. Marcas de plural — "testemunha(s)",
//  "trabalhou(ram)" — não são tocadas.
const RE_MARCA_GENERO = /(\p{L}+)\((a|A|à|À)\)/gu;

const maiusculo = (s) => s === s.toUpperCase() && s !== s.toLowerCase();

function feminino(palavra) {
  const caixaAlta = maiusculo(palavra);
  const baixa = palavra.toLowerCase();
  let fem;

  const PRONOMES = {
    um: 'uma', ele: 'ela', dele: 'dela', nele: 'nela', aquele: 'aquela',
    este: 'esta', deste: 'desta', neste: 'nesta', esse: 'essa', desse: 'dessa', nesse: 'nessa',
  };

  if (PRONOMES[baixa]) fem = PRONOMES[baixa];
  else if (baixa.endsWith('ês')) fem = baixa.slice(0, -2) + 'esa';     // português → portuguesa
  else if (baixa.endsWith('o')) fem = baixa.slice(0, -1) + 'a';        // inscrito → inscrita, o → a
  else fem = baixa + 'a';                                              // portador → portadora

  if (caixaAlta) return fem.toUpperCase();
  if (palavra[0] === palavra[0].toUpperCase()) return fem[0].toUpperCase() + fem.slice(1);
  return fem;
}

function trocaDeGenero(fem) {
  return [RE_MARCA_GENERO, (inteiro, palavra, marca) => {
    if (!fem) return palavra;                                   // masculino: tira a marca
    if (marca === 'à' || marca === 'À') {                        // "ao(à)" → "à"
      return maiusculo(palavra) || palavra[0] === palavra[0].toUpperCase() ? 'À' : 'à';
    }
    return feminino(palavra);
  }];
}

// Tira vírgulas seguidas deixadas por campos em branco: "João, , , advogado"
const TROCA_VIRGULAS_VAZIAS = [/,(?:\s*,)+/g, ','];

module.exports = {
  substituirNosParagrafos, removerRealces, trocaDeGenero, feminino, TROCA_VIRGULAS_VAZIAS,
};
