const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const PizZip     = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { google } = require('googleapis');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ── Autenticação Google ───────────────────────────────────────────────────
function getGoogleAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

// ── Data por extenso ──────────────────────────────────────────────────────
function dataExtenso(d) {
  const dt = d ? new Date(d + 'T12:00:00') : new Date();
  const meses = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${dt.getDate()} de ${meses[dt.getMonth()]} de ${dt.getFullYear()}`;
}

function fmtData(d) {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR'); }
  catch(e) { return d; }
}

// ── Preencher template .docx ──────────────────────────────────────────────
function preencherTemplate(nomeArq, dados) {
  const caminho = path.join(__dirname, 'templates', nomeArq);
  const conteudo = fs.readFileSync(caminho, 'binary');
  const zip = new PizZip(conteudo);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  doc.render(dados);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Upload para Google Drive ──────────────────────────────────────────────
async function uploadDrive(auth, pastaId, nomeArq, buffer, mimeType) {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: {
      name: nomeArq,
      parents: [pastaId],
      mimeType,
    },
    media: {
      mimeType,
      body: require('stream').Readable.from(buffer),
    },
    fields: 'id,webViewLink',
  });
  return res.data;
}

// ── Criar/buscar pasta no Drive ───────────────────────────────────────────
async function obterPasta(auth, pastaRaizId, nomePasta) {
  const drive = google.drive({ version: 'v3', auth });

  // Buscar se já existe
  const busca = await drive.files.list({
    q: `'${pastaRaizId}' in parents and name='${nomePasta}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });

  if (busca.data.files.length > 0) return busca.data.files[0].id;

  // Criar nova
  const criar = await drive.files.create({
    requestBody: {
      name: nomePasta,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [pastaRaizId],
    },
    fields: 'id',
  });
  return criar.data.id;
}

// ── Salvar linha no Sheets ────────────────────────────────────────────────
async function salvarSheets(auth, sheetId, linha) {
  const sheets = google.sheets({ version: 'v4', auth });

  // Verificar se tem cabeçalho
  const check = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Atendimentos!A1',
  });

  if (!check.data.values || !check.data.values[0] || check.data.values[0][0] !== 'ID') {
    const cab = ['ID','Data/Hora','Nome','CPF','WhatsApp','E-mail',
      'Empresa','CNPJ','Cargo','Salário','Admissão','Saída',
      'Desligamento','TRCT','FGTS','Pedidos',
      'Docs Entregues','Docs Pendentes','Prazo Bienal','Urgência',
      'Viabilidade','Advogado','Atendente','Canal','Resumo','Próximo Passo'];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Atendimentos!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [cab] },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Atendimentos!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [linha] },
  });
}

// ── ROTA PRINCIPAL: salvar atendimento ────────────────────────────────────
app.post('/salvar', async (req, res) => {
  try {
    const d = req.body;
    const agora = new Date();
    const dataFmt = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const id = d._id || require('crypto').randomUUID();
    const nomeCliente = d.nomeCliente || '';
    const nomeEmpresa = d.nomeEmpresa ||
      (d.empresas && d.empresas[0] ? d.empresas[0].nome : '') || '';

    // Dados para os templates
    const dadosTemplate = {
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
      dataExtenso:   dataExtenso(agora),
    };

    // Google Auth
    const auth = await getGoogleAuth();
    const FOLDER_ID = process.env.FOLDER_ID;
    const SHEET_ID  = process.env.SHEET_ID;

    // Nome da pasta
    const hoje = agora.toLocaleDateString('pt-BR').replace(/\//g, '-');
    const nomePasta = (nomeCliente && nomeEmpresa)
      ? `${nomeCliente.toUpperCase()} x ${nomeEmpresa.toUpperCase()} — ${hoje}`
      : `${nomeCliente.toUpperCase() || 'ATENDIMENTO'} — ${hoje}`;

    const pastaId = await obterPasta(auth, FOLDER_ID, nomePasta);

    // Gerar e fazer upload dos 4 documentos
    const docs = [
      { template: 'TEMPLATE_CONTRATO_DE_HONORARIOS.docx',      nome: `1_Contrato_${nomeCliente.replace(/\s+/g,'_')}.docx` },
      { template: 'TEMPLATE_PROCURACAO.docx',                   nome: `2_Procuracao_${nomeCliente.replace(/\s+/g,'_')}.docx` },
      { template: 'TEMPLATE_DECLARACAO_HIPOSSUFICIENCIA.docx',  nome: `3_Declaracao_${nomeCliente.replace(/\s+/g,'_')}.docx` },
      { template: 'TEMPLATE_TERMO_CIENCIA.docx',                nome: `4_Termo_Ciencia_${nomeCliente.replace(/\s+/g,'_')}.docx` },
    ];

    const links = {};
    for (const doc of docs) {
      const buffer = preencherTemplate(doc.template, dadosTemplate);
      const arquivo = await uploadDrive(auth, pastaId, doc.nome, buffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      links[doc.nome] = arquivo.webViewLink;
    }

    // Salvar no Sheets
    const pedidos = Array.isArray(d.pedidos) ? d.pedidos.join(', ') : (d.pedidos || '');
    const docs_ent = Array.isArray(d.docsEntregues) ? d.docsEntregues.join(', ') : (d.docsEntregues || '');
    await salvarSheets(auth, SHEET_ID, [
      id, dataFmt, nomeCliente, d.cpf||'', d.whatsapp||'', d.email||'',
      nomeEmpresa, d.cnpj||'', d.cargoReal||'', d.salario||'',
      fmtData(d.dataAdmissao), fmtData(d.dataSaida),
      d.formaDesligamento||'', d.trctPago||'', d.fgts||'',
      pedidos, docs_ent, d.docsPendentes||'',
      d.prazoBienal||'', d.urgencia||'',
      d.viabilidade||'', d.advogado||'', d.atendente||'',
      d.comoConheceu||'', d.resumoCaso||'', d.proximoPasso||'',
    ]);

    // URL da pasta
    const drive = google.drive({ version: 'v3', auth });
    const pasta = await drive.files.get({ fileId: pastaId, fields: 'webViewLink' });

    res.json({
      ok: true, id,
      pastaUrl: pasta.data.webViewLink,
      docs: links,
      msg: `4 documentos gerados na pasta "${nomePasta}"`,
    });

  } catch (err) {
    console.error('Erro /salvar:', err);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── ROTA: listar atendimentos ─────────────────────────────────────────────
app.get('/listar', async (req, res) => {
  try {
    const auth  = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Atendimentos!A:Z',
    });
    const rows = r.data.values || [];
    if (rows.length <= 1) return res.json({ ok: true, fichas: [] });
    const [cab, ...dados] = rows;
    const fichas = dados.map(row => Object.fromEntries(cab.map((c,i) => [c, row[i]||''])));
    res.json({ ok: true, fichas });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/ping', (req, res) => res.json({ ok: true, msg: 'Martins & Filho — online' }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
