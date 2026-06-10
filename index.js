const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { google } = require('googleapis');
const AdmZip  = require('adm-zip');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getGoogleAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function dataExtenso() {
  const dt = new Date();
  const meses = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro'];
  return dt.getDate() + ' de ' + meses[dt.getMonth()] + ' de ' + dt.getFullYear();
}

function fmtData(d) {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR'); }
  catch(e) { return d; }
}

function extrairDados(d) {
  const nomeCliente = (d.nomeCliente || '').trim();
  const nomeEmpresa = (d.nomeEmpresa ||
    (d.empresas && d.empresas[0] ? d.empresas[0].nome : '') || '').trim();
  return {
    nomeCliente,
    nomeEmpresa,
    dadosTemplate: {
      nomeCliente:   nomeCliente.toUpperCase(),
      nacionalidade: d.nacionalidade || 'brasileiro(a)',
      estadoCivil:   d.estadoCivil   || '',
      profissao:     d.profissao     || '',
      rg:            d.rg            || '',
      sspUf:         d.uf            || 'DF',
      cpf:           d.cpf           || '',
      endereco:      d.endereco      || [d.rua, d.numEnd, d.complemento, d.bairro, d.cidade]
                       .filter(Boolean).join(', '),
      cep:           d.cep           || '',
      nomeEmpresa:   nomeEmpresa,
      dataExtenso:   dataExtenso(),
    }
  };
}

function preencherTemplate(nomeArq, dados) {
  const caminho = path.join(__dirname, 'templates', nomeArq);
  const zip = new AdmZip(caminho);
  const novoZip = new AdmZip();
  zip.getEntries().forEach(function(entry) {
    if (entry.entryName === 'word/document.xml') {
      let xml = entry.getData().toString('utf8');
      for (var chave in dados) {
        xml = xml.split('{{' + chave + '}}').join(dados[chave] || '');
      }
      novoZip.addFile('word/document.xml', Buffer.from(xml, 'utf8'));
    } else {
      novoZip.addFile(entry.entryName, entry.getData());
    }
  });
  return novoZip.toBuffer();
}

// ── Parágrafo Word ────────────────────────────────────────────────────────
function par(txt, bold, italic, size, center, cor) {
  const jc  = center ? '<w:jc w:val="center"/>' : '';
  const b   = bold   ? '<w:b/><w:bCs/>' : '';
  const it  = italic ? '<w:i/><w:iCs/>' : '';
  const sz  = size || 20;
  const c   = cor   || '111111';
  const t   = (txt||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
  return '<w:p><w:pPr><w:spacing w:after="60"/>' + jc + '</w:pPr>' +
    '<w:r><w:rPr>' + b + it +
    '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>' +
    '<w:color w:val="' + c + '"/>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>' +
    '</w:rPr><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
}

function secao(titulo) {
  return par(titulo, true, false, 22, false, '8B7A3A');
}

function sep() {
  return par(Array(50).join('\u2500'), false, false, 14, false, 'C9A84C');
}

// ── Gerar resumo jurídico com timbrado ───────────────────────────────────
function gerarResumoDocx(d) {
  const { nomeCliente, nomeEmpresa } = extrairDados(d);
  const agora   = new Date();
  const dataFmt = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const pedidos = Array.isArray(d.pedidos) ? d.pedidos
    : (d.pedidos||'').split(', ').filter(Boolean);
  const docsEnt = Array.isArray(d.docsEntregues) ? d.docsEntregues
    : (d.docsEntregues||'').split(', ').filter(Boolean);

  var body = '';
  body += par('RESUMO JURÍDICO DO CASO', true, false, 26, true, '5C4A10');
  body += sep();
  body += par('Protocolo: ' + (d._id||'—') + '     Data: ' + dataFmt, false, false, 18, false, '555555');
  body += par('Urgência: ' + (d.urgencia||'—') + '     Viabilidade: ' + (d.viabilidade||'—'), false, false, 18, false, '555555');
  body += sep();

  body += secao('1. CLIENTE');
  body += par('Nome: ' + (nomeCliente||'—'), false, false, 20);
  body += par('CPF: ' + (d.cpf||'—') + '     RG: ' + (d.rg||'—'), false, false, 20);
  body += par('WhatsApp: ' + (d.whatsapp||'—') + '     E-mail: ' + (d.email||'—'), false, false, 20);
  body += par('Endereço: ' + (d.endereco||'—'), false, false, 20);
  body += par('Nascimento: ' + (d.dataNascimento||'—') + '     Estado civil: ' + (d.estadoCivil||'—') + '     Profissão: ' + (d.profissao||'—'), false, false, 20);
  body += sep();

  body += secao('2. VÍNCULO EMPREGATÍCIO');
  body += par('Empresa: ' + (nomeEmpresa||'—') + '     CNPJ: ' + (d.cnpj||'—'), false, false, 20);
  body += par('Cargo real: ' + (d.cargoReal||'—') + '     Cargo CTPS: ' + (d.cargoCtps||'—'), false, false, 20);
  body += par('Salário: ' + (d.salario||'—') + '     Contrato: ' + (d.tipoContrato||'—'), false, false, 20);
  body += par('Admissão: ' + (fmtData(d.dataAdmissao)||'—') + '     Saída: ' + (fmtData(d.dataSaida)||'—'), false, false, 20);
  body += par('CTPS: ' + (d.ctpsRegistrada||'—'), false, false, 20);
  if (d.obs_vinculo) body += par('Obs: ' + d.obs_vinculo, false, true, 19, false, '555555');
  body += sep();

  body += secao('3. DESLIGAMENTO');
  body += par('Forma: ' + (d.formaDesligamento||'—'), false, false, 20);
  body += par('TRCT pago: ' + (d.trctPago||'—') + '     FGTS: ' + (d.fgts||'—') + '     Aviso prévio: ' + (d.avisoPrevio||'—'), false, false, 20);
  if (d.narrativa) {
    body += par('Narrativa do cliente:', true, false, 20);
    body += par(d.narrativa, false, true, 19, false, '333333');
  }
  if (d.obs_deslig) body += par('Obs: ' + d.obs_deslig, false, true, 19, false, '555555');
  body += sep();

  body += secao('4. JORNADA');
  var hr = (d.hrEntrada && d.hrSaida) ? d.hrEntrada + ' às ' + d.hrSaida : '—';
  body += par('Horário: ' + hr + '     Dias/semana: ' + (d.diasSemana||'—'), false, false, 20);
  body += par('Intervalo: ' + (d.intervalo||'—') + '     Horas extras: ' + (d.horasExtras||'—'), false, false, 20);
  body += par('Controle de ponto: ' + (d.controlePonto||'—'), false, false, 20);
  if (d.obs_jornada) body += par('Obs: ' + d.obs_jornada, false, true, 19, false, '555555');
  body += sep();

  body += secao('5. PEDIDOS SINALIZADOS');
  if (pedidos.length) {
    pedidos.forEach(function(p) { body += par('\u2022 ' + p, false, false, 20); });
  } else {
    body += par('(nenhum selecionado)', false, true, 19, false, '888888');
  }
  if (d.obs_pedidos) body += par('Obs: ' + d.obs_pedidos, false, true, 19, false, '555555');
  body += sep();

  body += secao('6. DOCUMENTOS');
  if (docsEnt.length) {
    docsEnt.forEach(function(p) { body += par('\u2022 ' + p, false, false, 20); });
  } else {
    body += par('(nenhum marcado)', false, true, 19, false, '888888');
  }
  if (d.docsPendentes) body += par('Pendentes: ' + d.docsPendentes, false, false, 20);
  if (d.obs_docs) body += par('Obs: ' + d.obs_docs, false, true, 19, false, '555555');
  body += sep();

  body += secao('7. PRESCRIÇÃO');
  body += par('Prazo bienal: ' + (d.prazoBienal||'—') + '     Dias restantes: ' + (d.diasRestantes||'—'), false, false, 20);
  if (d.obs_presc) body += par('Estabilidade/obs: ' + d.obs_presc, false, true, 19, false, '555555');
  body += sep();

  body += secao('8. TESTEMUNHAS');
  var tests = d.testemunhas || [];
  if (tests.length) {
    tests.forEach(function(t) {
      if (t.nome) body += par('\u2022 ' + t.nome + (t.tel ? ' — ' + t.tel : '') + (t.obs ? ' (' + t.obs + ')' : ''), false, false, 20);
    });
  } else {
    body += par('(nenhuma informada)', false, true, 19, false, '888888');
  }
  if (d.obs_test) body += par('Obs: ' + d.obs_test, false, true, 19, false, '555555');
  body += sep();

  body += secao('9. RESUMO DO CASO');
  body += par(d.resumoCaso || '(não preenchido)', false, true, 20, false, '1A1A18');
  body += par('', false, false, 18);
  body += secao('10. PRÓXIMO PASSO');
  body += par(d.proximoPasso || '(não definido)', false, false, 20);
  body += par('Advogado responsável: ' + (d.advogado||'—') + '     Atendente: ' + (d.atendente||'—'), false, false, 20);
  body += par('Canal: ' + (d.comoConheceu||'—'), false, false, 20);
  if (d.obs_final) {
    body += sep();
    body += secao('OBSERVAÇÕES FINAIS');
    body += par(d.obs_final, false, true, 20, false, '333333');
  }
  body += sep();

  // Usar template base com logo
  const templatePath = path.join(__dirname, 'templates', 'TEMPLATE_RESUMO_BASE.docx');
  const zipBase = new AdmZip(templatePath);
  const novoZip = new AdmZip();

  zipBase.getEntries().forEach(function(entry) {
    if (entry.entryName === 'word/document.xml') {
      var xml = entry.getData().toString('utf8');
      xml = xml.replace('{{BODY_PLACEHOLDER}}', body);
      novoZip.addFile('word/document.xml', Buffer.from(xml, 'utf8'));
    } else {
      novoZip.addFile(entry.entryName, entry.getData());
    }
  });

  return novoZip.toBuffer();
}

async function salvarSheets(auth, sheetId, linha) {
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const check = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: 'Atendimentos!A1',
    });
    if (!check.data.values || check.data.values[0][0] !== 'ID') throw new Error('sem cab');
  } catch(e) {
    const cab = ['ID','Data/Hora','Nome','CPF','WhatsApp','E-mail',
      'Empresa','CNPJ','Cargo','Salário','Admissão','Saída',
      'Desligamento','TRCT','FGTS','Pedidos',
      'Docs Entregues','Docs Pendentes','Prazo Bienal','Urgência',
      'Viabilidade','Advogado','Atendente','Canal','Resumo','Próximo Passo'];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: 'Atendimentos!A1',
      valueInputOption: 'RAW', requestBody: { values: [cab] },
    });
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Atendimentos!A1',
    valueInputOption: 'RAW', requestBody: { values: [linha] },
  });
}

app.post('/salvar', async function(req, res) {
  try {
    const d = req.body;
    const agora   = new Date();
    const dataFmt = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const id      = d._id || require('crypto').randomUUID();
    const { nomeCliente, nomeEmpresa } = extrairDados(d);
    const SHEET_ID = process.env.SHEET_ID;
    if (SHEET_ID) {
      const auth = await getGoogleAuth();
      const pedidos = Array.isArray(d.pedidos) ? d.pedidos.join(', ') : (d.pedidos || '');
      const docsEnt = Array.isArray(d.docsEntregues) ? d.docsEntregues.join(', ') : (d.docsEntregues || '');
      await salvarSheets(auth, SHEET_ID, [
        id, dataFmt, nomeCliente, d.cpf||'', d.whatsapp||'', d.email||'',
        nomeEmpresa, d.cnpj||'', d.cargoReal||'', d.salario||'',
        fmtData(d.dataAdmissao), fmtData(d.dataSaida),
        d.formaDesligamento||'', d.trctPago||'', d.fgts||'',
        pedidos, docsEnt, d.docsPendentes||'',
        d.prazoBienal||'', d.urgencia||'',
        d.viabilidade||'', d.advogado||'', d.atendente||'',
        d.comoConheceu||'', d.resumoCaso||'', d.proximoPasso||'',
      ]);
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Erro /salvar:', err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.post('/gerar-docs', function(req, res) {
  try {
    const d = req.body;
    const { nomeCliente, dadosTemplate } = extrairDados(d);
    const nomeBase = (nomeCliente || 'cliente').replace(/\s+/g, '_');

    const templates = [
      { arquivo: 'TEMPLATE_CONTRATO_DE_HONORARIOS.docx',     nome: '2_Contrato_' },
      { arquivo: 'TEMPLATE_PROCURACAO.docx',                  nome: '3_Procuracao_' },
      { arquivo: 'TEMPLATE_DECLARACAO_HIPOSSUFICIENCIA.docx', nome: '4_Declaracao_' },
      { arquivo: 'TEMPLATE_TERMO_CIENCIA.docx',               nome: '5_Termo_Ciencia_' },
    ];

    const zipSaida = new AdmZip();

    // 1. Resumo jurídico com timbrado
    zipSaida.addFile('1_Resumo_Juridico_' + nomeBase + '.docx', gerarResumoDocx(d));

    // 2-5. Templates preenchidos
    templates.forEach(function(t) {
      zipSaida.addFile(t.nome + nomeBase + '.docx', preencherTemplate(t.arquivo, dadosTemplate));
    });

    const zipBuffer = zipSaida.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      'attachment; filename="' + nomeBase + '_documentos.zip"');
    res.send(zipBuffer);

  } catch (err) {
    console.error('Erro /gerar-docs:', err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/listar', async function(req, res) {
  try {
    const auth   = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID, range: 'Atendimentos!A:Z',
    });
    const rows = r.data.values || [];
    if (rows.length <= 1) return res.json({ ok: true, fichas: [] });
    const [cab, ...dados] = rows;
    const fichas = dados.map(function(row) {
      return Object.fromEntries(cab.map(function(c,i) { return [c, row[i]||'']; }));
    });
    res.json({ ok: true, fichas });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/ping', function(req, res) {
  res.json({ ok: true, msg: 'Martins & Filho — online' });
});

app.listen(PORT, function() {
  console.log('Servidor rodando na porta ' + PORT);
});
