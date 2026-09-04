'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Geração dos documentos — Martins & Filho
//  • 4 documentos a partir dos templates .docx timbrados (docxtemplater)
//  • Ficha de atendimento e Resumo jurídico montados do zero (docx)
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs   = require('fs');
const PizZip        = require('pizzip');
const Docxtemplater = require('docxtemplater');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType,
} = require('docx');

// Paleta do escritório (a mesma do formulário de atendimento)
const COR_TXT   = '1A1A10';
const COR_TXT2  = '5A5840';
const COR_GOLD  = 'C9A84C';
const COR_BG    = 'EDE8DC';
const COR_BORDA = 'D8D2BC';
const FONTE     = 'Calibri';

const TEMPLATES = path.join(__dirname, '..', 'templates');

// ── Utilidades ───────────────────────────────────────────────────────────────
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dataExtenso(d) {
  const dt = d instanceof Date ? d : new Date();
  return `${dt.getDate()} de ${MESES[dt.getMonth()]} de ${dt.getFullYear()}`;
}

function fmtData(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = String(v).split('-');
    return `${d}/${m}/${a}`;
  }
  return String(v);
}

const val = (v) => {
  if (v === undefined || v === null) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
};

const limpaNome = (s) => String(s || 'cliente')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cliente';

// ── 1) Documentos a partir dos templates timbrados ───────────────────────────
function preencherTemplate(nomeArq, dados) {
  const caminho = path.join(TEMPLATES, nomeArq);
  if (!fs.existsSync(caminho)) throw new Error('Template não encontrado: ' + nomeArq);
  const zip = new PizZip(fs.readFileSync(caminho, 'binary'));
  const doc = new Docxtemplater(zip, {
    // Os templates do escritório usam marcadores de chave dupla: {{nomeCliente}}
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  doc.render(dados);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function dadosDoTemplate(d, agora) {
  const enderecoCompleto = d.endereco || [
    d.rua, d.numEnd, d.complemento, d.bairro,
    [d.cidade, d.uf].filter(Boolean).join('/'),
  ].filter(Boolean).join(', ');

  return {
    nomeCliente:   String(d.nomeCliente || '').toUpperCase(),
    nacionalidade: d.nacionalidade || 'brasileiro(a)',
    estadoCivil:   d.estadoCivil   || '',
    profissao:     d.profissao     || '',
    rg:            d.rg            || '',
    sspUf:         d.uf            || 'DF',
    cpf:           d.cpf           || '',
    endereco:      enderecoCompleto,
    cep:           d.cep           || '',
    nomeEmpresa:   d.nomeEmpresa || (d.empresas && d.empresas[0] ? d.empresas[0].nome : '') || '',
    dataExtenso:   dataExtenso(agora),
  };
}

// ── Blocos de montagem dos documentos próprios ───────────────────────────────
function txt(t, o = {}) {
  return new TextRun({
    text: String(t === undefined || t === null ? '' : t),
    font: FONTE,
    size: o.size || 20,               // meio-pontos: 20 = 10 pt
    bold: !!o.bold,
    italics: !!o.italico,
    color: o.cor || COR_TXT,
    allCaps: !!o.caps,
  });
}

function par(t, o = {}) {
  return new Paragraph({
    alignment: o.align || AlignmentType.LEFT,
    spacing: { before: o.antes || 0, after: o.depois === undefined ? 60 : o.depois },
    children: Array.isArray(t) ? t : [txt(t, o)],
  });
}

// Faixa de título de seção (fundo dourado)
function secao(numero, titulo) {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    shading: { type: ShadingType.CLEAR, fill: COR_GOLD },
    children: [txt(`  ${numero}. ${titulo}`, { bold: true, size: 20, caps: true })],
  });
}

const SEM_BORDA  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const BORDA_FINA = { style: BorderStyle.SINGLE, size: 1, color: COR_BORDA };

function celula(conteudo, o = {}) {
  return new TableCell({
    width: { size: o.largura || 50, type: WidthType.PERCENTAGE },
    shading: o.fundo ? { type: ShadingType.CLEAR, fill: o.fundo } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: Array.isArray(conteudo) ? conteudo : [par(conteudo, o)],
  });
}

// Tabela de pares rótulo → valor
function tabelaPares(pares) {
  const linhas = pares.map(([rotulo, valor]) => new TableRow({
    children: [
      celula(rotulo, { largura: 28, fundo: COR_BG, bold: true, size: 18, cor: COR_TXT2, depois: 0 }),
      celula(val(valor), { largura: 72, depois: 0 }),
    ],
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDA_FINA, bottom: BORDA_FINA, left: BORDA_FINA, right: BORDA_FINA,
      insideHorizontal: BORDA_FINA, insideVertical: BORDA_FINA,
    },
    rows: linhas,
  });
}

// Tabela com cabeçalho (listas: reclamadas, jornadas, testemunhas)
function tabelaLista(cabecalhos, linhas, larguras) {
  const cab = new TableRow({
    tableHeader: true,
    children: cabecalhos.map((c, i) => celula(c, {
      largura: larguras[i], fundo: COR_BG, bold: true, size: 18, cor: COR_TXT2, depois: 0,
    })),
  });
  const corpo = linhas.map((l) => new TableRow({
    children: l.map((c, i) => celula(val(c), { largura: larguras[i], size: 18, depois: 0 })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDA_FINA, bottom: BORDA_FINA, left: BORDA_FINA, right: BORDA_FINA,
      insideHorizontal: BORDA_FINA, insideVertical: BORDA_FINA,
    },
    rows: [cab, ...corpo],
  });
}

function textoLongo(rotulo, conteudo) {
  const partes = String(conteudo || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const out = [par([txt(rotulo, { bold: true, size: 18, cor: COR_TXT2 })], { antes: 120, depois: 40 })];
  if (!partes.length) {
    out.push(par('(não preenchido)', { italico: true, cor: COR_TXT2 }));
  } else {
    partes.forEach((l) => out.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 60, line: 276 },
      children: [txt(l)],
    })));
  }
  return out;
}

function lista(itens) {
  if (!itens || !itens.length) return [par('(nenhum)', { italico: true, cor: COR_TXT2 })];
  return itens.map((i) => new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 40 },
    children: [txt(i)],
  }));
}

function cabecalhoDoc(titulo, protocolo, agora, atendente) {
  return [
    par([txt('MARTINS & FILHO', { bold: true, size: 28 }),
         txt('  ADVOGADOS ASSOCIADOS', { size: 18, cor: COR_TXT2 })],
        { align: AlignmentType.CENTER, depois: 40 }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COR_GOLD } },
      children: [txt(titulo, { bold: true, size: 22, cor: COR_TXT2, caps: true })],
    }),
    tabelaPares([
      ['Protocolo', protocolo],
      ['Data do atendimento', agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })],
      ['Atendente', atendente],
    ]),
  ];
}

function documento(filhos) {
  return new Document({
    creator: 'Martins & Filho Advogados Associados',
    styles: { default: { document: { run: { font: FONTE, size: 20, color: COR_TXT } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
      children: filhos,
    }],
  });
}

// ── 2) FICHA DE ATENDIMENTO ──────────────────────────────────────────────────
async function gerarFicha(d, protocolo, agora) {
  const c = [];
  c.push(...cabecalhoDoc('Ficha de Atendimento Trabalhista', protocolo, agora, val(d.atendente)));

  // 1. Cliente
  c.push(secao(1, 'Dados do cliente'));
  c.push(tabelaPares([
    ['Nome completo', d.nomeCliente],
    ['CPF', d.cpf],
    ['RG', d.rg],
    ['Data de nascimento', fmtData(d.dataNascimento)],
    ['Nacionalidade', d.nacionalidade],
    ['Estado civil', d.estadoCivil],
    ['Profissão', d.profissao],
    ['Escolaridade', d.escolaridade],
    ['WhatsApp', d.whatsapp],
    ['Telefone alternativo', d.telAlt],
    ['E-mail', d.email],
    ['Endereço', d.endereco],
    ['CEP', d.cep],
  ]));
  if (d.obs_cliente) c.push(...textoLongo('Observações', d.obs_cliente));

  // 2. Reclamadas
  c.push(secao(2, 'Reclamada(s)'));
  const emps = Array.isArray(d.empresas) ? d.empresas : [];
  if (emps.length) {
    c.push(tabelaLista(
      ['Razão social', 'CNPJ', 'Cidade', 'Tipo', 'Observações'],
      emps.map((e) => [e.nome, e.cnpj, e.cidade, e.tipo, e.obs]),
      [30, 20, 15, 15, 20],
    ));
  } else {
    c.push(par('(nenhuma reclamada informada)', { italico: true, cor: COR_TXT2 }));
  }
  if (d.obs_emp) c.push(...textoLongo('Observações', d.obs_emp));

  // 3. Vínculo
  c.push(secao(3, 'Vínculo de emprego'));
  c.push(tabelaPares([
    ['Cargo real exercido', d.cargoReal],
    ['Cargo anotado na CTPS', d.cargoCtps],
    ['Último salário', d.salario],
    ['Admissão', fmtData(d.dataAdmissao)],
    ['Saída', fmtData(d.dataSaida)],
    ['CTPS registrada', d.ctpsRegistrada],
    ['Tipo de contrato', d.tipoContrato],
  ]));
  if (d.obs_vinculo) c.push(...textoLongo('Observações', d.obs_vinculo));

  // 4. Desligamento
  c.push(secao(4, 'Desligamento'));
  c.push(tabelaPares([
    ['Forma de desligamento', d.formaDesligamento],
    ['TRCT pago', d.trctPago],
    ['Aviso prévio', d.avisoPrevio],
    ['FGTS / multa de 40%', d.fgts],
  ]));
  if (d.narrativa)  c.push(...textoLongo('Narrativa do desligamento', d.narrativa));
  if (d.obs_deslig) c.push(...textoLongo('Observações', d.obs_deslig));

  // 5. Jornada
  c.push(secao(5, 'Jornada de trabalho'));
  const jorns = Array.isArray(d.jornadas) ? d.jornadas : [];
  if (jorns.length) {
    c.push(tabelaLista(
      ['Período (de / até)', 'Horário', 'Dias', 'Intervalo', 'Registro de ponto', 'Obs.'],
      jorns.map((j) => [
        [fmtData(j.de) || 'início', fmtData(j.ate) || 'saída'].join(' a '),
        j.hr, j.dias, j.intervalo, j.ponto, j.obs,
      ]),
      [22, 18, 16, 14, 16, 14],
    ));
  } else {
    c.push(par('(jornada não informada)', { italico: true, cor: COR_TXT2 }));
  }
  if (d.obs_jornada) c.push(...textoLongo('Observações', d.obs_jornada));

  // 6. Módulos específicos
  const mods = [];
  if (d.mod_pj) mods.push(['Trabalho como PJ / pejotização', [
    ['CNPJ aberto pelo trabalhador', d.mod_pj.cnpj],
    ['Exclusividade', d.mod_pj.exclusividade],
    ['Controle de jornada', d.mod_pj.controle],
    ['Recebia ordens', d.mod_pj.ordens],
    ['Observações', d.mod_pj.obs],
  ]]);
  if (d.mod_jc) mods.push(['Justa causa', [
    ['Motivo alegado pela empresa', d.mod_jc.motivo],
    ['Houve advertência ou suspensão', d.mod_jc.advertencia],
    ['Versão do trabalhador', d.mod_jc.versao],
    ['Observações', d.mod_jc.obs],
  ]]);
  if (d.mod_ri) mods.push(['Rescisão indireta', [
    ['Inciso do art. 483 da CLT', d.mod_ri.inciso],
    ['Notificou a empresa', d.mod_ri.notificou],
    ['Fatos', d.mod_ri.fatos],
    ['Observações', d.mod_ri.obs],
  ]]);
  if (d.mod_gest) mods.push(['Estabilidade / gestante', [
    ['Tipo de estabilidade', d.mod_gest.tipo],
    ['Empresa tinha ciência', d.mod_gest.ciencia],
    ['Data provável do parto', fmtData(d.mod_gest.dpp)],
    ['Data da demissão', fmtData(d.mod_gest.demissao)],
    ['Observações', d.mod_gest.obs],
  ]]);
  if (d.mod_acid) mods.push(['Acidente de trabalho / doença ocupacional', [
    ['Tipo', d.mod_acid.tipo],
    ['CAT emitida', d.mod_acid.cat],
    ['Afastamento pelo INSS', d.mod_acid.afastamento],
    ['Sequelas', d.mod_acid.sequelas],
    ['Descrição', d.mod_acid.descricao],
    ['Observações', d.mod_acid.obs],
  ]]);
  if (d.mod_assedio) mods.push(['Assédio / dano moral', [
    ['Tipo', d.mod_assedio.tipo],
    ['Frequência', d.mod_assedio.frequencia],
    ['Reportou à empresa', d.mod_assedio.reportou],
    ['Provas disponíveis', d.mod_assedio.provas],
    ['Descrição', d.mod_assedio.descricao],
    ['Observações', d.mod_assedio.obs],
  ]]);
  if (d.mod_motor) mods.push(['Motorista', [
    ['Veículo', d.mod_motor.veiculo],
    ['Propriedade do veículo', d.mod_motor.propriedade],
    ['Tempo de sobreaviso', d.mod_motor.sobreaviso],
    ['Tempo de espera', d.mod_motor.espera],
    ['Observações', d.mod_motor.obs],
  ]]);
  if (d.mod_dom) mods.push(['Trabalho doméstico', [
    ['Frequência semanal', d.mod_dom.frequencia],
    ['Residia no local', d.mod_dom.residia],
    ['FGTS recolhido', d.mod_dom.fgts],
    ['13º pago', d.mod_dom.decimo],
    ['Observações', d.mod_dom.obs],
  ]]);

  c.push(secao(6, 'Situações específicas'));
  if (mods.length) {
    mods.forEach(([titulo, pares]) => {
      c.push(par([txt(titulo, { bold: true, size: 19, cor: COR_TXT2 })], { antes: 140, depois: 60 }));
      c.push(tabelaPares(pares));
    });
  } else {
    c.push(par('(nenhum módulo específico acionado neste atendimento)', { italico: true, cor: COR_TXT2 }));
  }

  // 7. Pedidos
  c.push(secao(7, 'Pedidos pretendidos'));
  c.push(...lista(d.pedidos));
  if (d.obs_pedidos) c.push(...textoLongo('Observações', d.obs_pedidos));

  // 8. Documentos
  c.push(secao(8, 'Documentos'));
  c.push(par([txt('Entregues nesta data:', { bold: true, size: 18, cor: COR_TXT2 })], { depois: 40 }));
  c.push(...lista(d.docsEntregues));
  c.push(tabelaPares([
    ['Outros documentos entregues', d.docsEntreguesObs],
    ['Documentos pendentes', d.docsPendentes],
  ]));
  if (d.obs_docs) c.push(...textoLongo('Observações', d.obs_docs));

  // 9. Prescrição
  c.push(secao(9, 'Prescrição'));
  c.push(tabelaPares([
    ['Último dia trabalhado', fmtData(d.ultimoDia)],
    ['Prazo bienal (art. 7º, XXIX, CF)', fmtData(d.prazoBienal)],
    ['Dias restantes', d.diasRestantes],
    ['Urgência', d.urgencia],
  ]));
  if (d.obs_presc) c.push(...textoLongo('Observações', d.obs_presc));

  // 10. Testemunhas
  c.push(secao(10, 'Testemunhas'));
  const tests = Array.isArray(d.testemunhas) ? d.testemunhas : [];
  if (tests.length) {
    c.push(tabelaLista(
      ['Nome', 'Telefone', 'Tipo', 'Observações'],
      tests.map((t) => [t.nome, t.tel, t.tipo, t.obs]),
      [32, 20, 18, 30],
    ));
  } else {
    c.push(par('(nenhuma testemunha indicada)', { italico: true, cor: COR_TXT2 }));
  }
  if (d.obs_test) c.push(...textoLongo('Observações', d.obs_test));

  // 11. Previdenciário
  c.push(secao(11, 'Previdenciário'));
  c.push(tabelaPares([
    ['Recebe ou recebeu benefício', d.prev_benef],
    ['Problema previdenciário', d.prev_prob],
  ]));
  if (d.prev_obs) c.push(...textoLongo('Observações', d.prev_obs));

  // 12. Triagem
  c.push(secao(12, 'Triagem interna'));
  c.push(tabelaPares([
    ['Advogado responsável', d.advogado],
    ['Atendente', d.atendente],
    ['Como conheceu o escritório', d.comoConheceu],
    ['Viabilidade', d.viabilidade],
    ['Próximo passo', d.proximoPasso],
  ]));

  // 13. Resumo do caso
  c.push(secao(13, 'Resumo do caso'));
  c.push(...textoLongo('Relato', d.resumoCaso));
  if (d.obs_final) c.push(...textoLongo('Observações finais', d.obs_final));

  // Assinaturas
  c.push(par('', { antes: 400, depois: 0 }));
  c.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: SEM_BORDA, bottom: SEM_BORDA, left: SEM_BORDA, right: SEM_BORDA,
      insideHorizontal: SEM_BORDA, insideVertical: SEM_BORDA,
    },
    rows: [new TableRow({
      children: [
        celula([
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 0 },
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: COR_TXT2 } },
            children: [txt(val(d.nomeCliente), { size: 18 })],
          }),
          par('Cliente', { align: AlignmentType.CENTER, size: 16, cor: COR_TXT2 }),
        ], { largura: 48 }),
        celula('', { largura: 4 }),
        celula([
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 0 },
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: COR_TXT2 } },
            children: [txt(val(d.atendente), { size: 18 })],
          }),
          par('Atendente — Martins & Filho', { align: AlignmentType.CENTER, size: 16, cor: COR_TXT2 }),
        ], { largura: 48 }),
      ],
    })],
  }));

  return Packer.toBuffer(documento(c));
}

// ── 3) RESUMO JURÍDICO ───────────────────────────────────────────────────────
async function gerarResumo(d, protocolo, agora) {
  const c = [];
  c.push(...cabecalhoDoc('Resumo Jurídico do Caso', protocolo, agora, val(d.atendente)));

  const emps = Array.isArray(d.empresas) ? d.empresas : [];
  const nomeEmp = emps.length
    ? emps.map((e) => e.nome + (e.cnpj ? ` (${e.cnpj})` : '')).join('; ')
    : val(d.nomeEmpresa);

  c.push(secao(1, 'Identificação'));
  c.push(tabelaPares([
    ['Reclamante', d.nomeCliente],
    ['CPF', d.cpf],
    ['Contato', [d.whatsapp, d.email].filter(Boolean).join(' | ')],
    ['Reclamada(s)', nomeEmp],
  ]));

  c.push(secao(2, 'Contrato de trabalho'));
  c.push(tabelaPares([
    ['Função', d.cargoReal],
    ['Remuneração', d.salario],
    ['Período', `${fmtData(d.dataAdmissao) || '—'} a ${fmtData(d.dataSaida) || '—'}`],
    ['CTPS registrada', d.ctpsRegistrada],
    ['Forma de desligamento', d.formaDesligamento],
    ['Verbas rescisórias', `TRCT: ${val(d.trctPago)} | FGTS: ${val(d.fgts)} | Aviso: ${val(d.avisoPrevio)}`],
  ]));

  const jorns = Array.isArray(d.jornadas) ? d.jornadas : [];
  if (jorns.length) {
    c.push(secao(3, 'Jornada declarada'));
    c.push(tabelaLista(
      ['Período', 'Horário', 'Dias', 'Intervalo', 'Ponto'],
      jorns.map((j) => [
        [fmtData(j.de) || 'início', fmtData(j.ate) || 'saída'].join(' a '),
        j.hr, j.dias, j.intervalo, j.ponto,
      ]),
      [24, 20, 20, 18, 18],
    ));
  }

  // Teses possíveis a partir dos módulos acionados no atendimento
  const teses = [];
  if (d.mod_pj)      teses.push(`Reconhecimento de vínculo (pejotização) — exclusividade: ${val(d.mod_pj.exclusividade)}; controle de jornada: ${val(d.mod_pj.controle)}; recebia ordens: ${val(d.mod_pj.ordens)}.`);
  if (d.mod_jc)      teses.push(`Reversão da justa causa — motivo alegado: ${val(d.mod_jc.motivo)}; punições anteriores: ${val(d.mod_jc.advertencia)}.`);
  if (d.mod_ri)      teses.push(`Rescisão indireta (art. 483 da CLT, ${val(d.mod_ri.inciso)}) — notificação à empresa: ${val(d.mod_ri.notificou)}.`);
  if (d.mod_gest)    teses.push(`Estabilidade provisória (${val(d.mod_gest.tipo)}) — ciência da empresa: ${val(d.mod_gest.ciencia)}.`);
  if (d.mod_acid)    teses.push(`Acidente de trabalho / doença ocupacional (${val(d.mod_acid.tipo)}) — CAT: ${val(d.mod_acid.cat)}; sequelas: ${val(d.mod_acid.sequelas)}.`);
  if (d.mod_assedio) teses.push(`Dano moral por assédio (${val(d.mod_assedio.tipo)}) — frequência: ${val(d.mod_assedio.frequencia)}; provas: ${val(d.mod_assedio.provas)}.`);
  if (d.mod_motor)   teses.push(`Horas de sobreaviso e tempo de espera (motorista) — sobreaviso: ${val(d.mod_motor.sobreaviso)}; espera: ${val(d.mod_motor.espera)}.`);
  if (d.mod_dom)     teses.push(`Trabalho doméstico (LC 150/2015) — frequência: ${val(d.mod_dom.frequencia)}; FGTS: ${val(d.mod_dom.fgts)}.`);

  c.push(secao(4, 'Teses identificadas no atendimento'));
  c.push(...lista(teses));

  c.push(secao(5, 'Pedidos pretendidos'));
  c.push(...lista(d.pedidos));
  if (d.obs_pedidos) c.push(...textoLongo('Observações', d.obs_pedidos));

  c.push(secao(6, 'Prova documental'));
  c.push(par([txt('Já em poder do escritório:', { bold: true, size: 18, cor: COR_TXT2 })], { depois: 40 }));
  c.push(...lista(d.docsEntregues));
  if (d.docsPendentes) {
    c.push(par([txt('Pendentes de entrega: ', { bold: true, size: 18, cor: COR_TXT2 }),
                txt(d.docsPendentes)], { antes: 80 }));
  }

  const tests = Array.isArray(d.testemunhas) ? d.testemunhas : [];
  if (tests.length) {
    c.push(secao(7, 'Prova testemunhal'));
    c.push(...lista(tests.map((t) =>
      `${t.nome}${t.tel ? ' — ' + t.tel : ''}${t.tipo ? ' (' + t.tipo + ')' : ''}`)));
  }

  c.push(secao(8, 'Prescrição'));
  c.push(tabelaPares([
    ['Último dia trabalhado', fmtData(d.ultimoDia)],
    ['Prazo bienal', fmtData(d.prazoBienal)],
    ['Dias restantes', d.diasRestantes],
    ['Urgência', d.urgencia],
  ]));

  c.push(secao(9, 'Triagem e encaminhamento'));
  c.push(tabelaPares([
    ['Viabilidade', d.viabilidade],
    ['Advogado responsável', d.advogado],
    ['Canal de origem', d.comoConheceu],
    ['Próximo passo', d.proximoPasso],
  ]));

  c.push(secao(10, 'Relato do caso'));
  c.push(...textoLongo('Narrativa', d.resumoCaso || d.narrativa));
  if (d.obs_final) c.push(...textoLongo('Observações finais', d.obs_final));

  return Packer.toBuffer(documento(c));
}

// ── 4) Conjunto completo ─────────────────────────────────────────────────────
async function gerarTodos(d, protocolo, agora = new Date()) {
  const base = limpaNome(d.nomeCliente);
  const dt   = dadosDoTemplate(d, agora);

  const BoasVindas = require('./boasvindas');

  return [
    { nome: `0_Boas_Vindas_${base}.pdf`,        buffer: await BoasVindas.gerarBoasVindas(d) },
    { nome: `1_Ficha_Atendimento_${base}.docx`, buffer: await gerarFicha(d, protocolo, agora) },
    { nome: `2_Resumo_Juridico_${base}.docx`,   buffer: await gerarResumo(d, protocolo, agora) },
    { nome: `3_Contrato_${base}.docx`,          buffer: preencherTemplate('TEMPLATE_CONTRATO_DE_HONORARIOS.docx', dt) },
    { nome: `4_Procuracao_${base}.docx`,        buffer: preencherTemplate('TEMPLATE_PROCURACAO.docx', dt) },
    { nome: `5_Declaracao_${base}.docx`,        buffer: preencherTemplate('TEMPLATE_DECLARACAO_HIPOSSUFICIENCIA.docx', dt) },
    { nome: `6_Termo_Ciencia_${base}.docx`,     buffer: preencherTemplate('TEMPLATE_TERMO_CIENCIA.docx', dt) },
  ];
}

// Documentos que vão para assinatura no ZapSign (ficha e resumo são internos)
const PARA_ASSINATURA = [/^3_Contrato_/, /^4_Procuracao_/, /^5_Declaracao_/, /^6_Termo_Ciencia_/];

function montarZip(arquivos) {
  const zip = new PizZip();
  arquivos.forEach((a) => zip.file(a.nome, a.buffer));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  gerarTodos, gerarFicha, gerarResumo, preencherTemplate,
  montarZip, limpaNome, dataExtenso, fmtData, PARA_ASSINATURA,
};
