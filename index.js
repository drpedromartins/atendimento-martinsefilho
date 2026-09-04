'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  MARTINS & FILHO — Sistema de Atendimento Trabalhista
//
//  Ao salvar um atendimento, o sistema:
//    1. gera 6 documentos (ficha, resumo jurídico, contrato, procuração,
//       declaração de hipossuficiência e termo de ciência);
//    2. cria a pasta "CLIENTE x EMPRESA — DATA" no Google Drive e sobe tudo;
//    3. registra a linha na planilha de atendimentos;
//    4. devolve o .zip para download e o link da pasta;
//    5. opcionalmente envia os documentos para assinatura no ZapSign.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');

const G       = require('./lib/google');
const Docs    = require('./lib/docs');
const ZapSign = require('./lib/zapsign');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const FOLDER_ID = (process.env.FOLDER_ID || '').trim();
const SHEET_ID  = (process.env.SHEET_ID  || '').trim();

// ── Guarda temporária dos atendimentos gerados ───────────────────────────────
// Mantém o .zip e os documentos em memória por 1 hora, para que o navegador
// possa baixar o arquivo e o ZapSign reaproveitar os mesmos documentos sem
// precisar gerar tudo de novo.
const CACHE   = new Map();
const UMA_HORA = 60 * 60 * 1000;

function guardar(id, conteudo) {
  CACHE.set(id, { ...conteudo, criadoEm: Date.now() });
  for (const [k, v] of CACHE) {
    if (Date.now() - v.criadoEm > UMA_HORA) CACHE.delete(k);
  }
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

// Mensagens de erro do Google traduzidas para linguagem de escritório
function explicarErroDrive(err) {
  const m = String(err && err.message ? err.message : err);
  if (/storageQuotaExceeded|storage quota/i.test(m)) {
    return 'O Google recusou o envio por cota de armazenamento: a conta de serviço não tem espaço próprio. '
         + 'Solução: preencher a variável IMPERSONATE_USER no Render com o e-mail do escritório '
         + '(exige delegação em todo o domínio no Admin do Google Workspace), ou mover a pasta para um Drive compartilhado.';
  }
  if (/File not found|notFound/i.test(m)) {
    return 'A pasta informada em FOLDER_ID não foi encontrada. Confira o ID e compartilhe a pasta '
         + `com a conta de serviço (${G.emailContaServico()}) como Editor.`;
  }
  if (/insufficient|forbidden|403/i.test(m)) {
    return `Sem permissão na pasta do Drive. Compartilhe a pasta com ${G.emailContaServico()} como Editor.`;
  }
  return m;
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

  // 1) Documentos — se isto falhar, não há o que salvar
  let arquivos;
  try {
    arquivos = await Docs.gerarTodos(d, protocolo, agora);
  } catch (err) {
    console.error('Erro ao gerar documentos:', err);
    return res.status(500).json({ ok: false, erro: 'Falha ao gerar os documentos: ' + err.message });
  }

  const zip = Docs.montarZip(arquivos);
  guardar(protocolo, { zip, arquivos, dados: d, nomeCliente: d.nomeCliente });

  // 2) Google Drive — cria a pasta do cliente e sobe os 6 documentos
  let pastaUrl = '';
  let pastaNome = nomeDaPasta(d, agora);
  const docsEnviados = {};

  if (!FOLDER_ID) {
    avisos.push('FOLDER_ID não configurado no Render — nada foi enviado ao Drive.');
  } else {
    try {
      const auth  = G.getAuth();
      const pasta = await G.obterPasta(auth, FOLDER_ID, pastaNome);
      pastaUrl = pasta.webViewLink || `https://drive.google.com/drive/folders/${pasta.id}`;

      for (const a of arquivos) {
        const enviado = await G.enviarArquivo(auth, pasta.id, a.nome, a.buffer);
        docsEnviados[a.nome] = enviado.webViewLink || '';
      }
    } catch (err) {
      console.error('Erro no Drive:', err);
      avisos.push('Drive: ' + explicarErroDrive(err));
    }
  }

  // 3) Planilha de atendimentos
  if (!SHEET_ID) {
    avisos.push('SHEET_ID não configurado no Render — o atendimento não foi registrado na planilha.');
  } else {
    try {
      const auth = G.getAuth();
      await G.salvarLinha(auth, SHEET_ID, linhaDaPlanilha(d, protocolo, agora, pastaUrl));
    } catch (err) {
      console.error('Erro na planilha:', err);
      avisos.push('Planilha: ' + err.message);
    }
  }

  res.json({
    ok: true,
    protocolo,
    pastaNome,
    pastaUrl,
    zipUrl: `/baixar/${protocolo}`,
    docs: docsEnviados,
    documentos: arquivos.map((a) => a.nome),
    zapsignDisponivel: ZapSign.ativo(),
    avisos,
    msg: pastaUrl
      ? `6 documentos gerados na pasta "${pastaNome}".`
      : '6 documentos gerados (o envio ao Drive não foi concluído — veja os avisos).',
  });
});

// ── Download do .zip gerado ──────────────────────────────────────────────────
app.get('/baixar/:id', (req, res) => {
  const item = CACHE.get(req.params.id);
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

// ── Gera e devolve o .zip direto, sem Drive nem planilha ─────────────────────
app.post('/gerar-docs', async (req, res) => {
  try {
    const d = req.body || {};
    const protocolo = d._id || novoProtocolo();
    const arquivos = await Docs.gerarTodos(d, protocolo, new Date());
    const zip = Docs.montarZip(arquivos);
    guardar(protocolo, { zip, arquivos, dados: d, nomeCliente: d.nomeCliente });

    const nome = Docs.limpaNome(d.nomeCliente) + '_documentos.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(zip);
  } catch (err) {
    console.error('Erro /gerar-docs:', err);
    res.status(500).json({ ok: false, erro: err.message });
  }
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

    const protocolo = (req.body && req.body.protocolo) || '';
    let dados = (req.body && req.body.dados) || null;
    let arquivos = null;

    const item = CACHE.get(protocolo);
    if (item) {
      arquivos = item.arquivos;
      dados = dados || item.dados;
    } else {
      if (!dados || !dados.nomeCliente) {
        return res.status(400).json({
          ok: false,
          erro: 'Atendimento não encontrado. Salve o atendimento novamente antes de enviar para assinatura.',
        });
      }
      arquivos = await Docs.gerarTodos(dados, protocolo || novoProtocolo(), new Date());
    }

    const r = await ZapSign.enviarParaAssinatura({
      dados,
      arquivos,
      filtros: Docs.PARA_ASSINATURA,
    });

    res.json({
      ok: r.enviados.length > 0,
      enviados: r.enviados,
      falhas: r.falhas,
      msg: r.enviados.length
        ? `${r.enviados.length} documento(s) enviado(s) para assinatura de ${dados.nomeCliente}.`
        : 'Nenhum documento foi enviado — veja as falhas.',
    });
  } catch (err) {
    console.error('Erro /zapsign:', err);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Consulta dos atendimentos já registrados ─────────────────────────────────
app.get('/listar', async (req, res) => {
  try {
    if (!SHEET_ID) return res.status(400).json({ ok: false, erro: 'SHEET_ID não configurado.' });
    const fichas = await G.listarFichas(G.getAuth(), SHEET_ID);
    res.json({ ok: true, fichas });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Diagnóstico: confere toda a configuração de uma vez ──────────────────────
app.get('/diag', async (req, res) => {
  const r = {
    servidor: 'Martins & Filho — online',
    hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    variaveis: {
      GOOGLE_SERVICE_ACCOUNT: !!process.env.GOOGLE_SERVICE_ACCOUNT,
      FOLDER_ID: FOLDER_ID || '(vazio)',
      SHEET_ID: SHEET_ID || '(vazio)',
      IMPERSONATE_USER: process.env.IMPERSONATE_USER || '(não usado)',
      ZAPSIGN_TOKEN: ZapSign.ativo(),
    },
    contaDeServico: G.emailContaServico(),
    testes: {},
  };

  // Templates presentes?
  try {
    const fs = require('fs');
    r.testes.templates = fs.readdirSync(path.join(__dirname, 'templates'))
      .filter((f) => f.endsWith('.docx'));
  } catch (e) {
    r.testes.templates = 'ERRO: ' + e.message;
  }

  // Geração dos documentos
  try {
    const teste = await Docs.gerarTodos(
      { nomeCliente: 'TESTE DE CONEXÃO', cpf: '000.000.000-00', empresas: [{ nome: 'EMPRESA TESTE' }] },
      'AT-DIAGNOSTICO', new Date(),
    );
    r.testes.geracaoDocumentos = `OK — ${teste.length} documentos (${teste.map((t) => t.nome).join(', ')})`;
  } catch (e) {
    r.testes.geracaoDocumentos = 'ERRO: ' + e.message;
  }

  // Acesso à pasta do Drive (inclusive teste real de gravação)
  if (FOLDER_ID) {
    try {
      const auth = G.getAuth();
      const info = await G.infoPasta(auth, FOLDER_ID);
      r.testes.pastaDrive = `OK — "${info.name}" (pode criar arquivos: ${info.capabilities && info.capabilities.canAddChildren ? 'sim' : 'não'})`;

      const arq = await G.enviarArquivo(
        auth, FOLDER_ID, '_teste_conexao.txt',
        Buffer.from('teste de gravação — pode apagar'), 'text/plain',
      );
      await G.apagarArquivo(auth, arq.id);
      r.testes.gravacaoNoDrive = 'OK — arquivo de teste criado e apagado com sucesso';
    } catch (e) {
      r.testes.gravacaoNoDrive = 'ERRO: ' + explicarErroDrive(e);
    }
  } else {
    r.testes.pastaDrive = 'FOLDER_ID não configurado';
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
