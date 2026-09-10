'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Confere o texto que sai no contrato, na procuração, na declaração e no
//  termo — para cliente homem e cliente mulher:
//    • nada de marca-texto (amarelo) ou fundo colorido;
//    • nenhuma marca "(a)" / "o(a)" sobrando;
//    • concordância certa para cada gênero;
//    • contrato sem o nome da empresa na cláusula 1;
//    • marcas de plural ("testemunha(s)") preservadas.
//
//  Rodar:  node scripts/teste-documentos-word.js
// ─────────────────────────────────────────────────────────────────────────────
const fs     = require('fs');
const path   = require('path');
const PizZip = require('pizzip');
const Docs   = require('../lib/docs');

const BASE = {
  nacionalidade: 'Brasileiro(a)', estadoCivil: 'Casado(a)', profissao: 'motorista',
  rg: '1.234.567', uf: 'DF', cpf: '123.456.789-00', cep: '70000-000',
  rua: 'Quadra 10, Conjunto B', numEnd: '15', bairro: 'Ceilândia Sul', cidade: 'Brasília',
  empresas: [{ nome: 'EMPRESA TESTE 2' }],
};

const CASOS = [
  {
    rotulo: 'cliente homem', dados: { ...BASE, nomeCliente: 'Pedro Teste Dois', genero: 'M' },
    deveTer: {
      Contrato:   ['brasileiro, casado, motorista', 'portador da cédula', 'inscrito no CPF',
                   'residente e domiciliado em Quadra 10', 'defender os interesses do CONTRATANTE',
                   'propor Reclamação Trabalhista com o objetivo', 'do que o CONTRATANTE vier a receber',
                   'este deverá pagar', 'outorgada pelo Contratante'],
      Procuracao: ['portador da cédula', 'inscrito no CPF', 'residente e domiciliado em'],
      Declaracao: ['portador da cédula', 'inscrito no CPF', 'residente e domiciliado em'],
      Termo:      ['O CONTRATANTE acima identificado', 'beneficiário da justiça gratuita',
                   'junto ao Contratante', 'testemunha(s)', 'trabalhou(ram)'],
    },
    naoPodeTer: ['portadora', 'inscrita no CPF', 'domiciliada', 'da CONTRATANTE', 'beneficiária', 'brasileira'],
  },
  {
    rotulo: 'cliente mulher', dados: { ...BASE, nomeCliente: 'Maria Teste Dois', genero: 'F' },
    deveTer: {
      Contrato:   ['brasileira, casada, motorista', 'portadora da cédula', 'inscrita no CPF',
                   'residente e domiciliada em Quadra 10', 'defender os interesses da CONTRATANTE',
                   'propor Reclamação Trabalhista com o objetivo', 'do que a CONTRATANTE vier a receber',
                   'esta deverá pagar', 'outorgada pela Contratante'],
      Procuracao: ['portadora da cédula', 'inscrita no CPF', 'residente e domiciliada em'],
      Declaracao: ['portadora da cédula', 'inscrita no CPF', 'residente e domiciliada em'],
      Termo:      ['A CONTRATANTE acima identificada', 'beneficiária da justiça gratuita',
                   'junto à Contratante', 'testemunha(s)', 'trabalhou(ram)'],
    },
    naoPodeTer: ['portador da', 'inscrito no CPF', 'domiciliado em', 'do CONTRATANTE', 'beneficiário da', 'DOIS, brasileiro'],
  },
];

function textoDoDocx(buffer) {
  const zip = new PizZip(buffer);
  const partes = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  let realces = 0;
  let texto = '';
  for (const p of partes) {
    const xml = zip.file(p).asText();
    realces += (xml.match(/<w:highlight\b/g) || []).length;
    texto += xml.split(/<\/w:p>/).map((par) => (par.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, '')).join('')).join('\n');
  }
  texto = texto.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { texto, realces };
}

(async () => {
  let problemas = 0;
  const saida = path.join(__dirname, '..', '_saida_teste');
  fs.mkdirSync(saida, { recursive: true });

  for (const caso of CASOS) {
    console.log(`\n=== ${caso.rotulo}`);
    const arquivos = await Docs.gerarTodos(caso.dados, 'AT-TESTE', new Date(2026, 8, 10));

    for (const [chave, frases] of Object.entries(caso.deveTer)) {
      const arq = arquivos.find((a) => a.nome.includes(`_${chave}`));
      fs.writeFileSync(path.join(saida, `${caso.dados.genero}_${arq.nome}`), arq.buffer);
      const { texto, realces } = textoDoDocx(arq.buffer);

      const erros = [];
      if (realces) erros.push(`${realces} trecho(s) com marca-texto`);
      const marcas = texto.match(/\p{L}+\((?:a|A|à|À)\)/gu);
      if (marcas) erros.push(`marca de gênero sobrando: ${[...new Set(marcas)].join(', ')}`);
      frases.forEach((f) => { if (!texto.includes(f)) erros.push(`faltou "${f}"`); });
      caso.naoPodeTer.forEach((f) => { if (texto.includes(f)) erros.push(`não devia ter "${f}"`); });
      if (chave === 'Contrato' && /em face de/i.test(texto)) erros.push('o contrato ainda cita a empresa ("em face de")');
      if (/EMPRESA TESTE 2/.test(texto)) erros.push('o nome da empresa aparece no documento');
      if (/,\s*,/.test(texto)) erros.push('vírgulas duplicadas');

      if (erros.length) problemas += erros.length;
      console.log(`  ${erros.length ? '✗' : '✓'} ${chave.padEnd(11)} ${erros.length ? erros.join(' | ') : 'OK'}`);
    }
  }

  // Sem gênero, o sistema precisa recusar em vez de adivinhar
  try {
    await Docs.gerarTodos({ ...BASE, nomeCliente: 'Sem Genero' }, 'AT-TESTE', new Date());
    console.log('\n  ✗ gerou documentos sem gênero definido — devia recusar');
    problemas++;
  } catch (e) {
    console.log('\n  ✓ sem gênero marcado, o sistema recusa e pede o dado');
  }

  console.log(problemas ? `\n${problemas} problema(s).` : '\nTudo certo.');
  process.exit(problemas ? 1 : 0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
