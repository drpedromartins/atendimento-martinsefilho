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

// ── Auth Google ───────────────────────────────────────────────────────────
function getGoogleAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function dataExtenso() {
  const dt = new Date();
  const meses = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${dt.getDate()} de ${meses[dt.getMonth()]} de ${dt.getFullYear()}`;
}

function fmtData(d) {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR'); }
  catch(e) { return d; }
}

// ── Preencher template ────────────────────────────────────────────────────
function preencherTemplate(nomeArq, dados) {
  const caminho = path.join(__dirname, 'templates', nomeArq);
  const zip = new AdmZip(caminho);
  const novoZip = new AdmZip();
  zip.getEntries().forEach(entry => {
    if (entry.entryName === 'word/document.xml') {
      let xml = entry.getData().toString('utf8');
      for (const [chave, valor] of Object.entries(dados)) {
        xml = xml.split('{{' + chave + '}}').join(valor || '');
      }
      novoZip.addFile('word/document.xml', Buffer.from(xml, 'utf8'));
    } else {
      novoZip.addFile(entry.entryName, entry.getData());
    }
  });
  return novoZip.toBuffer();
}

// ── Extrair dados do body ─────────────────────────────────────────────────
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

// ── Salvar no Sheets ──────────────────────────────────────────────────────
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

// ── ROTA: salvar no Sheets ────────────────────────────────────────────────
app.post('/salvar', async (req, res) => {
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

// ── ROTA: gerar documentos e retornar ZIP ────────────────────────────────
app.post('/gerar-docs', (req, res) => {
  try {
    const d = req.body;
    const { nomeCliente, dadosTemplate } = extrairDados(d);

    const templates = [
      { arquivo: 'TEMPLATE_CONTRATO_DE_HONORARIOS.docx',     nome: '1_Contrato_' },
      { arquivo: 'TEMPLATE_PROCURACAO.docx',                  nome: '2_Procuracao_' },
      { arquivo: 'TEMPLATE_DECLARACAO_HIPOSSUFICIENCIA.docx', nome: '3_Declaracao_' },
      { arquivo: 'TEMPLATE_TERMO_CIENCIA.docx',               nome: '4_Termo_Ciencia_' },
    ];

    // Criar ZIP com os 4 documentos
    const zipSaida = new AdmZip();
    const nomeBase = (nomeCliente || 'cliente').replace(/\s+/g, '_');

    templates.forEach(t => {
      const buffer = preencherTemplate(t.arquivo, dadosTemplate);
      zipSaida.addFile(t.nome + nomeBase + '.docx', buffer);
    });

    const zipBuffer = zipSaida.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      `attachment; filename="${nomeBase}_documentos.zip"`);
    res.send(zipBuffer);

  } catch (err) {
    console.error('Erro /gerar-docs:', err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── ROTA: listar fichas ───────────────────────────────────────────────────
app.get('/listar', async (req, res) => {
  try {
    const auth   = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID, range: 'Atendimentos!A:Z',
    });
    const rows = r.data.values || [];
    if (rows.length <= 1) return res.json({ ok: true, fichas: [] });
    const [cab, ...dados] = rows;
    const fichas = dados.map(row =>
      Object.fromEntries(cab.map((c,i) => [c, row[i]||''])));
    res.json({ ok: true, fichas });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/ping', (req, res) =>
  res.json({ ok: true, msg: 'Martins & Filho — online' }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
