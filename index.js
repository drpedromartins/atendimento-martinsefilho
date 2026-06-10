const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { google } = require('googleapis');
const AdmZip     = require('adm-zip');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

async function uploadDrive(drive, pastaId, nomeArq, buffer, mimeType) {
  const { Readable } = require('stream');
  const res = await drive.files.create({
    requestBody: { name: nomeArq, parents: [pastaId], mimeType },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,webViewLink',
  });
  return res.data;
}

async function criarPasta(drive, nomePasta) {
  const res = await drive.files.create({
    requestBody: {
      name: nomePasta,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id,webViewLink',
  });
  // Compartilhar automaticamente com o escritório
  try {
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: 'pedromartins@pedromartins.adv.br',
      },
      sendNotificationEmail: false,
    });
  } catch(e) {
    console.log('Aviso compartilhamento:', e.message);
  }
  return res.data.id;
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

app.post('/salvar', async (req, res) => {
  try {
    const d = req.body;
    const agora   = new Date();
    const dataFmt = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const id      = d._id || require('crypto').randomUUID();

    const nomeCliente = (d.nomeCliente || '').trim();
    const nomeEmpresa = (d.nomeEmpresa ||
      (d.empresas && d.empresas[0] ? d.empresas[0].nome : '') || '').trim();

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
      dataExtenso:   dataExtenso(),
    };

    const auth     = await getGoogleAuth();
    const drive    = google.drive({ version: 'v3', auth });
    const SHEET_ID = process.env.SHEET_ID;

    const hoje      = agora.toLocaleDateString('pt-BR').replace(/\//g, '-');
    const nomePasta = (nomeCliente && nomeEmpresa)
      ? `${nomeCliente.toUpperCase()} x ${nomeEmpresa.toUpperCase()} - ${hoje}`
      : `${nomeCliente.toUpperCase() || 'ATENDIMENTO'} - ${hoje}`;

    const pastaId = await criarPasta(drive, nomePasta);

    const docs = [
      { template: 'TEMPLATE_CONTRATO_DE_HONORARIOS.docx',     nome: `1_Contrato_${nomeCliente.replace(/\s+/g,'_')}.docx` },
      { template: 'TEMPLATE_PROCURACAO.docx',                  nome: `2_Procuracao_${nomeCliente.replace(/\s+/g,'_')}.docx` },
      { template: 'TEMPLATE_DECLARACAO_HIPOSSUFICIENCIA.docx', nome: `3_Declaracao_${nomeCliente.replace(/\s+/g,'_')}.docx` },
      { template: 'TEMPLATE_TERMO_CIENCIA.docx',               nome: `4_Termo_Ciencia_${nomeCliente.replace(/\s+/g,'_')}.docx` },
    ];

    const links = {};
    for (const doc of docs) {
      const buffer  = preencherTemplate(doc.template, dadosTemplate);
      const arquivo = await uploadDrive(drive, pastaId, doc.nome, buffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      links[doc.nome] = arquivo.webViewLink;
    }

    if (SHEET_ID) {
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

    const pastaInfo = await drive.files.get({ fileId: pastaId, fields: 'webViewLink,name' });

    res.json({
      ok: true, id,
      pastaUrl: pastaInfo.data.webViewLink,
      docs: links,
      msg: `4 documentos gerados. Acesse pelo link da pasta.`,
    });

  } catch (err) {
    console.error('Erro /salvar:', err.message, JSON.stringify(err.errors||''));
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/listar', async (req, res) => {
  try {
    const auth   = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const r = await sheets.spreadsheets.values.get({
