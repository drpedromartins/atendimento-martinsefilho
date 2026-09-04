'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  ZapSign — envio dos documentos para assinatura eletrônica
//  Documentação: https://docs.zapsign.com.br/documentos/criar-documento
// ─────────────────────────────────────────────────────────────────────────────
const API = 'https://api.zapsign.com.br/api/v1';

function token() {
  const t = (process.env.ZAPSIGN_TOKEN || '').trim();
  if (!t) {
    throw new Error('ZAPSIGN_TOKEN não configurado no Render — a assinatura eletrônica está desligada.');
  }
  return t;
}

const ativo = () => !!(process.env.ZAPSIGN_TOKEN || '').trim();

// Normaliza o telefone brasileiro para o formato esperado (DDD + número)
function telefone(v) {
  let n = String(v || '').replace(/\D/g, '');
  if (n.startsWith('55') && n.length > 11) n = n.slice(2);
  return n.length >= 10 ? n : '';
}

// Monta o signatário (o cliente) a partir dos dados da ficha
function signatarioCliente(d) {
  const fone = telefone(d.whatsapp);
  const email = String(d.email || '').trim();

  const s = {
    name: String(d.nomeCliente || '').trim() || 'Cliente',
    auth_mode: (process.env.ZAPSIGN_AUTH_MODE || 'assinaturaTela').trim(),
    send_automatic_email: !!email,
    send_automatic_whatsapp: !!fone,
  };
  if (email) s.email = email;
  if (fone) { s.phone_country = '55'; s.phone_number = fone; }
  if (String(d.cpf || '').trim()) s.external_id = String(d.cpf).replace(/\D/g, '');

  return s;
}

async function criarDocumento({ nome, base64Docx, signatarios }) {
  const corpo = {
    name: nome,
    base64_docx: base64Docx,
    lang: 'pt-br',
    disable_signer_emails: false,
    signature_order_active: false,
    signers: signatarios,
  };

  const r = await fetch(`${API}/docs/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });

  let j = {};
  try { j = await r.json(); } catch (e) { /* resposta sem JSON */ }

  if (!r.ok) {
    const detalhe = j.detail || j.error || j.message || JSON.stringify(j).slice(0, 300);
    throw new Error(`ZapSign respondeu ${r.status}: ${detalhe}`);
  }
  return j;
}

// Envia vários documentos de uma vez; um erro em um deles não derruba os demais
async function enviarParaAssinatura({ dados, arquivos, filtros }) {
  const signatarios = [signatarioCliente(dados)];
  const escolhidos = arquivos.filter((a) => filtros.some((f) => f.test(a.nome)));
  const enviados = [];
  const falhas = [];

  for (const a of escolhidos) {
    const titulo = a.nome.replace(/^\d+_/, '').replace(/\.docx$/i, '').replace(/_/g, ' ');
    try {
      const doc = await criarDocumento({
        nome: titulo,
        base64Docx: Buffer.from(a.buffer).toString('base64'),
        signatarios,
      });
      enviados.push({
        documento: titulo,
        token: doc.token || '',
        linkAssinatura: (doc.signers && doc.signers[0] && doc.signers[0].sign_url) || '',
        painel: doc.token ? `https://app.zapsign.com.br/verificar/${doc.token}` : '',
      });
    } catch (e) {
      falhas.push({ documento: titulo, erro: e.message });
    }
  }

  return { enviados, falhas };
}

module.exports = { ativo, criarDocumento, enviarParaAssinatura, signatarioCliente };
