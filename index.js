'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  MARTINS & FILHO — Sistema de Atendimento Trabalhista
//
//  Ao salvar um atendimento, o sistema:
//    1. gera 7 documentos (carta de boas-vindas, ficha, resumo jurídico,
//       contrato, procuração, declaração de hipossuficiência e termo de
//       ciência), com a concordância de gênero do cliente;
//    2. cria a pasta "CLIENTE x EMPRESA — DATA" no Google Drive e sobe tudo;
//    3. registra a linha na planilha de atendimentos;
//    4. devolve o .zip para download e o link da pasta;
//    5. opcionalmente envia os documentos para assinatura no ZapSign.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const G       = require('./lib/google');
const Docs    = require('./lib/docs');
const ZapSign = require('./lib/zapsign');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Pasta "COMERCIAL MARTINS E FILHO / PASTA CLIENTES - AUTOMATIZADA".
// O ID não é segredo; a variável FOLDER_ID no Render, se existir, tem prioridade.
const FOLDER_ID = (process.env.FOLDER_ID || '1EpvGtzCR8ZUhlFG5Gsbwgx6YveWucS9d').trim();
const SHEET_ID  = (process.env.SHEET_ID  || '').trim();

// ── Guarda temporária dos atendimentos gerados ───────────────────────────────
// O .zip e os documentos ficam em memória por 1 hora, para o navegador baixar
// e o ZapSign reaproveitar os mesmos arquivos. A chave é aleatória (não o
// protocolo), para que ninguém consiga baixar documento de cliente adivinhando
// o número.
const CACHE    = new Map();
const UMA_HORA = 60 * 60 * 1000;

function guardar(conteudo) {
  const chave = crypto.randomUUID();
  CACHE.set(chave, { ...conteudo, criadoEm: Date.now() });
  for (const [k, v] of CACHE) {
    if (Date.now() - v.criadoEm > UMA_HORA) CACHE.delete(k);
  }
  return chave;
}

// ── Auxiliares ───────────────────────────────────────────────────────────────
function novoProtocolo() {
  const d = new Date();
  const data = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `AT-${data}-${crypto.randomInt(1000, 9999)}`;
}

function nomeDaPasta(d, agora) {
  const cliente = String(d.nomeCliente || 'ATENDIMENTO').toUpperCase().trim();
  const empresa = String(
    d.nomeEmpresa || (d.empresas && d.empresas[0] ? d.empresas[0].nome : '') || '',
  ).toUpperCase().trim();
  const hoje = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/\//g, '-');
  return empresa ? `${cliente} x ${empresa} — ${hoje}` : `${cliente} — ${hoje}`;
}

const juntar = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));

function linhaDaPlanilha(d, protocolo, agora, pastaUrl) {
  return [
    protocolo,
    agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    d.nomeCliente || '', d.cpf || '', d.whatsapp || '', d.email || '',
    d.nomeEmpresa || (d.empresas && d.empresas[0] ? d.empresas[0].nome : '') || '',
    d.cnpj || (d.empresas && d.empresas[0] ? d.empresas[0].cnpj : '') || '',
    d.cargoReal || '', d.salario || '',
    Docs.fmtData(d.dataAdmissao), Docs.fmtData(d.dataSaida),
    d.formaDesligamento || '', d.trctPago || '', d.fgts || '',
    juntar(d.pedidos), juntar(d.docsEntregues), d.docsPendentes || '',
    Docs.fmtData(d.prazoBienal), d.urgencia || '',
    d.viabilidade || '', d.advogado || '', d.atendente || '',
    d.comoConheceu || '', d.resumoCaso || '', d.proximoPasso || '',
    pastaUrl || '',
  ];
}

// Instrução para liberar a gravação no Drive (delegação em todo o domínio)
function instrucaoDelegacao() {
  return 'No Admin do Google Workspace (admin.google.com), com a conta do escritório: '
    + 'Segurança → Acesso e controle de dados → Controles de API → Gerenciar delegação em todo o domínio → '
    + `Adicionar novo. ID do cliente: ${G.clienteIdContaServico()}. `
    + `Escopos: ${G.SCOPES.join(',')}`;
}

// Mensagens de erro do Google traduzidas para linguagem de escritório
function explicarErroDrive(err) {
  const m = String(err && err.message ? err.message : err);
  if (G.ehErroDeDelegacao(err)) {
    return `O Google ainda não autorizou o sistema a gravar em nome de ${G.USUARIO_DRIVE}. ${instrucaoDelegacao()}`;
  }
  if (/storageQuotaExceeded|storage quota|do not have storage quota/i.test(m)) {
    return 'O Google recusou o arquivo porque a conta de serviço não tem espaço próprio no Drive. '
      + `A solução é autorizar o sistema a gravar em nome de ${G.USUARIO_DRIVE}. ${instrucaoDelegacao()}`;
  }
  if (/File not found|notFound/i.test(m)) {
    return 'A pasta de clientes não foi encontrada no Drive. Confira se ela não foi apagada ou movida para a lixeira.';
  }
  if (/insufficient|forbidden|403/i.test(m)) {
    return `Sem permissão na pasta do Drive. ${instrucaoDelegacao()}`;
  }
  return m;
}

// Tenta o Drive agindo em nome do escritório; se a delegação ainda não foi
// autorizada, cai para a conta de serviço (que ao menos consegue ler a pasta).
async function authDoDrive() {
  const comoUsuario = G.getAuth({ comoUsuario: true });
  try {
    await G.infoPasta(comoUsuario, FOLDER_ID);
    return { auth: comoUsuario, modo: `em nome de ${G.USUARIO_DRIVE}` };
  } catch (err) {
    if (!G.ehErroDeDelegacao(err)) throw err;
    return { auth: G.getAuth(), modo: 'conta de serviço', delegacaoPendente: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROTA PRINCIPAL — salva o atendimento por completo
// ─────────────────────────────────────────────────────────────────────────────
app.post('/salvar', async (req, res) => {
  const d = req.body || {};
  const agora = new Date();
  const protocolo = d._id || novoProtocolo();
  const avisos = [];

  if (!d.nomeCliente || !String(d.nomeCliente).trim()) {
    return res.status(400).json({ ok: false, erro: 'Informe o nome do cliente antes de salvar.' });
  }
  if (!Docs.generoDoCliente(d)) {
    return res.status(400).json({
      ok: false,
      erro: 'Marque se o cliente é homem ou mulher (campo "Gênero", logo abaixo do nome). '
        + 'Os documentos e a carta de boas-vindas mudam conforme o gênero.',
    });
  }

  d.endereco = Docs.montarEndereco(d);

  const lacunas = Docs.lacunasDaQualificacao(d);
  if (lacunas.length) {
    avisos.push(`Qualificação incompleta — faltam: ${lacunas.join(', ')}. `
      + 'Os documentos saíram com essas lacunas; confira antes de mandar para assinatura.');
  }

  // 1) Documentos — se isto falhar, não há o que salvar
  let arquivos;
  try {
    arquivos = await Docs.gerarTodos(d, protocolo, agora);
  } catch (err) {
    console.error('Erro ao gerar documentos:', err);
    return res.status(500).json({ ok: false, erro: 'Falha ao gerar os documentos: ' + err.message });
  }

  const zip = Docs.montarZip(arquivos);
  const token = guardar({ zip, arquivos, dados: d, nomeCliente: d.nomeCliente, protocolo });

  // 2) Google Drive — cria a pasta do cliente e sobe os documentos
  let pastaUrl = '';
  const pastaNome = nomeDaPasta(d, agora);
  const docsEnviados = {};

  let contextoDrive = null;
  try {
    contextoDrive = await authDoDrive();
    const { auth } = contextoDrive;
    const pasta = await G.obterPasta(auth, FOLDER_ID, pastaNome);
    pastaUrl = pasta.webViewLink || `https://drive.google.com/drive/folders/${pasta.id}`;

    for (const a of arquivos) {
      const mime = a.nome.endsWith('.pdf') ? 'application/pdf' : G.MIME_DOCX;
      const enviado = await G.enviarArquivo(auth, pasta.id, a.nome, a.buffer, mime);
      docsEnviados[a.nome] = enviado.webViewLink || '';
    }
  } catch (err) {
    console.error('Erro no Drive:', err);
    avisos.push('Drive: ' + (contextoDrive && contextoDrive.delegacaoPendente
      ? `o sistema ainda não está autorizado a gravar no Drive do escritório. ${instrucaoDelegacao()}`
      : explicarErroDrive(err)));
    // Pasta criada mas arquivos recusados: não mostra link para pasta vazia
    if (!Object.keys(docsEnviados).length) pastaUrl = '';
  }

  // 3) Planilha de atendimentos
  if (!SHEET_ID) {
    avisos.push('SHEET_ID não configurado no Render — o atendimento não foi registrado na planilha.');
  } else {
    try {
      await G.salvarLinha(G.getAuth(), SHEET_ID, linhaDaPlanilha(d, protocolo, agora, pastaUrl));
    } catch (err) {
      console.error('Erro na planilha:', err);
      avisos.push('Planilha: ' + err.message);
    }
  }

  const enviadosAoDrive = Object.keys(docsEnviados).length;
  res.json({
    ok: true,
    protocolo,
    token,
    pastaNome,
    pastaUrl,
    zipUrl: `/baixar/${token}`,
    docs: docsEnviados,
    documentos: arquivos.map((a) => a.nome),
    zapsignDisponivel: ZapSign.ativo(),
    avisos,
    msg: enviadosAoDrive === arquivos.length
      ? `${arquivos.length} documentos gerados na pasta "${pastaNome}".`
      : `${arquivos.length} documentos gerados (o envio ao Drive não foi concluído — veja os avisos).`,
  });
});

// ── Download do .zip gerado ──────────────────────────────────────────────────
app.get('/baixar/:token', (req, res) => {
  const item = CACHE.get(req.params.token);
  if (!item) {
    return res.status(404).json({
      ok: false,
      erro: 'Este atendimento não está mais disponível para download (o link vale 1 hora). Salve novamente.',
    });
  }
  const nome = Docs.limpaNome(item.nomeCliente) + '_documentos.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(item.zip);
});

// ── ZapSign — envia contrato, procuração, declaração e termo p/ assinatura ───
app.post('/zapsign', async (req, res) => {
  try {
    if (!ZapSign.ativo()) {
      return res.status(400).json({
        ok: false,
        erro: 'A assinatura eletrônica está desligada: falta a variável ZAPSIGN_TOKEN no Render.',
      });
    }

    const item = CACHE.get((req.body && req.body.token) || '');
    if (!item) {
      return res.status(400).json({
        ok: false,
        erro: 'Atendimento não encontrado (o envio vale por 1 hora depois de salvar). Salve o atendimento novamente.',
      });
    }

    const r = await ZapSign.enviarParaAssinatura({
      dados: item.dados,
      arquivos: item.arquivos,
      filtros: Docs.PARA_ASSINATURA,
    });

    res.json({
      ok: r.enviados.length > 0,
      enviados: r.enviados,
      falhas: r.falhas,
      msg: r.enviados.length
        ? `${r.enviados.length} documento(s) enviado(s) para assinatura de ${item.dados.nomeCliente}.`
        : 'Nenhum documento foi enviado — veja as falhas.',
    });
  } catch (err) {
    console.error('Erro /zapsign:', err);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Diagnóstico: confere toda a configuração de uma vez ──────────────────────
app.get('/diag', async (req, res) => {
  const mascarar = (s) => (s && s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || '(vazio)');
  const r = {
    servidor: 'Martins & Filho — online',
    hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    variaveis: {
      GOOGLE_SERVICE_ACCOUNT: !!process.env.GOOGLE_SERVICE_ACCOUNT,
      FOLDER_ID: FOLDER_ID + (process.env.FOLDER_ID ? ' (do Render)' : ' (padrão do sistema)'),
      SHEET_ID: mascarar(SHEET_ID),
      ZAPSIGN_TOKEN: ZapSign.ativo(),
    },
    contaDeServico: G.emailContaServico(),
    idDoClienteDaContaDeServico: G.clienteIdContaServico(),
    driveEmNomeDe: G.USUARIO_DRIVE,
    testes: {},
  };

  // Templates presentes?
  try {
    r.testes.templates = fs.readdirSync(path.join(__dirname, 'templates'))
      .filter((f) => /\.(docx|pdf)$/.test(f));
  } catch (e) {
    r.testes.templates = 'ERRO: ' + e.message;
  }

  // Geração dos documentos, nos dois gêneros
  for (const genero of ['M', 'F']) {
    try {
      const teste = await Docs.gerarTodos(
        { nomeCliente: 'TESTE DE CONEXÃO', genero, cpf: '000.000.000-00', empresas: [{ nome: 'EMPRESA TESTE' }] },
        'AT-DIAGNOSTICO', new Date(),
      );
      r.testes[`geracaoDocumentos_${genero}`] = `OK — ${teste.length} documentos`;
    } catch (e) {
      r.testes[`geracaoDocumentos_${genero}`] = 'ERRO: ' + e.message;
    }
  }

  // Delegação: o sistema consegue agir em nome do escritório?
  try {
    const info = await G.infoPasta(G.getAuth({ comoUsuario: true }), FOLDER_ID);
    r.testes.delegacao = `OK — o sistema age em nome de ${G.USUARIO_DRIVE} (pasta "${info.name}")`;
  } catch (e) {
    r.testes.delegacao = G.ehErroDeDelegacao(e)
      ? `PENDENTE — ${instrucaoDelegacao()}`
      : 'ERRO: ' + explicarErroDrive(e);
  }

  // Gravação real na pasta (cria um arquivo de teste e apaga em seguida)
  let ctxTeste = null;
  try {
    ctxTeste = await authDoDrive();
    const arq = await G.enviarArquivo(
      ctxTeste.auth, FOLDER_ID, '_teste_conexao.txt',
      Buffer.from('teste de gravação — pode apagar'), 'text/plain',
    );
    await G.apagarArquivo(ctxTeste.auth, arq.id);
    r.testes.gravacaoNoDrive = `OK — arquivo de teste criado e apagado (${ctxTeste.modo})`;
  } catch (e) {
    r.testes.gravacaoNoDrive = 'ERRO: ' + (ctxTeste && ctxTeste.delegacaoPendente
      ? `sem autorização para gravar no Drive do escritório. ${instrucaoDelegacao()}`
      : explicarErroDrive(e));
  }

  // Acesso à planilha
  if (SHEET_ID) {
    try {
      const fichas = await G.listarFichas(G.getAuth(), SHEET_ID);
      r.testes.planilha = `OK — ${fichas.length} atendimento(s) registrado(s)`;
    } catch (e) {
      r.testes.planilha = 'ERRO: ' + e.message;
    }
  } else {
    r.testes.planilha = 'SHEET_ID não configurado';
  }

  res.json(r);
});

app.get('/ping', (req, res) => res.json({ ok: true, msg: 'Martins & Filho — online' }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
