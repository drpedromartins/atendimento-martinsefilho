'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Google Drive + Google Sheets — Martins & Filho
// ─────────────────────────────────────────────────────────────────────────────
const { google }   = require('googleapis');
const { Readable } = require('stream');

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const MIME_DOCX  = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_PASTA = 'application/vnd.google-apps.folder';

// Colunas da planilha (a última é o link da pasta criada no Drive)
const CABECALHO = [
  'ID', 'Data/Hora', 'Nome', 'CPF', 'WhatsApp', 'E-mail',
  'Empresa', 'CNPJ', 'Cargo', 'Salário', 'Admissão', 'Saída',
  'Desligamento', 'TRCT Pago', 'FGTS', 'Pedidos',
  'Docs Entregues', 'Docs Pendentes', 'Prazo Bienal', 'Urgência',
  'Viabilidade', 'Advogado', 'Atendente', 'Canal', 'Resumo',
  'Próximo Passo', 'Pasta no Drive',
];

// ── Credenciais ──────────────────────────────────────────────────────────────
function credenciais() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('A variável GOOGLE_SERVICE_ACCOUNT não está configurada no Render.');
  }
  let c;
  try {
    c = JSON.parse(raw);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT não é um JSON válido — cole o arquivo .json inteiro, das chaves { até }.');
  }
  // Render às vezes guarda as quebras de linha da chave como \n literal
  if (c.private_key) c.private_key = c.private_key.replace(/\\n/g, '\n');
  return c;
}

function emailContaServico() {
  try { return credenciais().client_email || '(não encontrado no JSON)'; }
  catch (e) { return '(erro: ' + e.message + ')'; }
}

// O "ID do cliente" da conta de serviço — é o número que o Admin do Google
// Workspace pede para autorizar a delegação. Não é segredo.
function clienteIdContaServico() {
  try { return credenciais().client_id || '(não encontrado no JSON)'; }
  catch (e) { return '(erro: ' + e.message + ')'; }
}

// Dono da pasta de clientes no Drive. A conta de serviço age em nome dele
// (delegação em todo o domínio), então os arquivos nascem no Drive do
// escritório — conta de serviço não tem espaço próprio para guardar arquivos.
const USUARIO_DRIVE = (process.env.IMPERSONATE_USER || 'pedromartins@pedromartins.adv.br').trim();

function getAuth({ comoUsuario = false } = {}) {
  const c = credenciais();
  if (comoUsuario && USUARIO_DRIVE) {
    return new google.auth.JWT({
      email: c.client_email, key: c.private_key, scopes: SCOPES, subject: USUARIO_DRIVE,
    });
  }
  return new google.auth.GoogleAuth({ credentials: c, scopes: SCOPES });
}

// O Google recusou agir em nome do usuário: a delegação ainda não foi
// autorizada no Admin do Workspace.
function ehErroDeDelegacao(err) {
  const m = String((err && (err.message || (err.response && JSON.stringify(err.response.data)))) || err);
  return /unauthorized_client|invalid_grant|not authorized to retrieve access tokens|Client is unauthorized/i.test(m);
}

// Escapa aspas simples usadas nas buscas do Drive
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ── Drive ────────────────────────────────────────────────────────────────────
async function obterPasta(auth, raizId, nome) {
  const drive = google.drive({ version: 'v3', auth });

  const busca = await drive.files.list({
    q: `'${raizId}' in parents and name='${esc(nome)}' and mimeType='${MIME_PASTA}' and trashed=false`,
    fields: 'files(id,name,webViewLink)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (busca.data.files && busca.data.files.length) return busca.data.files[0];

  const nova = await drive.files.create({
    requestBody: { name: nome, mimeType: MIME_PASTA, parents: [raizId] },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return nova.data;
}

async function enviarArquivo(auth, pastaId, nome, buffer, mime = MIME_DOCX) {
  const drive = google.drive({ version: 'v3', auth });

  // Se o mesmo documento já existe na pasta, atualiza em vez de duplicar.
  const existentes = await drive.files.list({
    q: `'${pastaId}' in parents and name='${esc(nome)}' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existentes.data.files && existentes.data.files.length) {
    const r = await drive.files.update({
      fileId: existentes.data.files[0].id,
      media: { mimeType: mime, body: Readable.from(buffer) },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });
    return r.data;
  }

  const r = await drive.files.create({
    requestBody: { name: nome, parents: [pastaId], mimeType: mime },
    media: { mimeType: mime, body: Readable.from(buffer) },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return r.data;
}

async function infoPasta(auth, pastaId) {
  const drive = google.drive({ version: 'v3', auth });
  const r = await drive.files.get({
    fileId: pastaId,
    fields: 'id,name,webViewLink,capabilities/canAddChildren',
    supportsAllDrives: true,
  });
  return r.data;
}

async function apagarArquivo(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

// ── Sheets ───────────────────────────────────────────────────────────────────
async function garantirCabecalho(auth, sheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const atual = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Atendimentos!A1:AZ1',
  });
  const linha = (atual.data.values && atual.data.values[0]) || [];

  // Reescreve o cabeçalho se estiver vazio ou desatualizado (colunas novas)
  if (linha.length < CABECALHO.length || linha[0] !== 'ID') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Atendimentos!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [CABECALHO] },
    });
  }
}

async function salvarLinha(auth, sheetId, valores) {
  const sheets = google.sheets({ version: 'v4', auth });
  await garantirCabecalho(auth, sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Atendimentos!A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valores] },
  });
}

async function listarFichas(auth, sheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Atendimentos!A:AZ',
  });
  const linhas = r.data.values || [];
  if (linhas.length <= 1) return [];
  const [cab, ...dados] = linhas;
  return dados.map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i] || ''])));
}

module.exports = {
  MIME_DOCX, MIME_PASTA, CABECALHO, SCOPES, USUARIO_DRIVE,
  getAuth, emailContaServico, clienteIdContaServico, ehErroDeDelegacao,
  obterPasta, enviarArquivo, infoPasta, apagarArquivo,
  salvarLinha, listarFichas,
};
