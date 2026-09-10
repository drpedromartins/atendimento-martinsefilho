'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Teste local — gera os 6 documentos em _saida_teste/ sem tocar no Drive.
//  Como rodar:  node scripts/teste-local.js
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const Docs = require('../lib/docs');

const CASO = {
  _id: 'AT-TESTE-0001',
  nomeCliente: 'Maria Aparecida de Souza', genero: 'F',
  cpf: '123.456.789-00', rg: '1.234.567', dataNascimento: '1985-04-12',
  nacionalidade: 'brasileira', estadoCivil: 'casada', profissao: 'auxiliar de limpeza',
  escolaridade: 'Ensino médio completo',
  whatsapp: '(61) 99999-1234', telAlt: '(61) 3333-4444', email: 'maria.souza@email.com',
  cep: '70000-000', rua: 'Quadra 10, Conjunto B', numEnd: '15', complemento: 'Casa 2',
  bairro: 'Ceilândia Sul', cidade: 'Brasília', uf: 'DF',
  endereco: 'Quadra 10, Conjunto B, 15, Casa 2, Ceilândia Sul, Brasília/DF, 70000-000',
  obs_cliente: 'Cliente compareceu acompanhada do marido.',

  empresas: [
    { nome: 'Limpa Tudo Serviços Gerais LTDA', cnpj: '12.345.678/0001-90', cidade: 'Brasília', tipo: 'Empregadora direta', obs: 'Consta na CTPS' },
    { nome: 'Condomínio Residencial Alfa', cnpj: '98.765.432/0001-10', cidade: 'Brasília', tipo: 'Tomadora de serviços', obs: 'Responsabilidade subsidiária' },
  ],
  obs_emp: 'Terceirização de serviços de limpeza.',

  cargoReal: 'Auxiliar de limpeza', cargoCtps: 'Servente',
  salario: 'R$ 1.520,00', dataAdmissao: '2019-03-01', dataSaida: '2026-06-20',
  ctpsRegistrada: 'Sim', tipoContrato: 'Prazo indeterminado',
  obs_vinculo: 'Exercia função acima da anotada na CTPS.',

  formaDesligamento: 'Dispensa sem justa causa', trctPago: 'Não',
  avisoPrevio: 'Não concedido', fgts: 'Não liberado',
  narrativa: 'Foi dispensada por telefone, sem qualquer formalização.\nNão recebeu as verbas rescisórias até a data do atendimento.',
  obs_deslig: 'Prazo do art. 477 da CLT já ultrapassado.',

  jornadas: [
    { de: '2019-03-01', ate: '2023-12-31', hr: '07h às 17h', dias: 'Segunda a sexta', intervalo: '30 min', ponto: 'Sem registro', obs: 'Fazia hora extra sem receber' },
    { de: '2024-01-01', ate: '2026-06-20', hr: '06h às 18h', dias: 'Segunda a sábado', intervalo: '1 hora', ponto: 'Ponto por aplicativo', obs: 'Britado pela chefia' },
  ],
  obs_jornada: 'Nunca recebeu adicional de horas extras.',

  mod_jc: null,
  mod_assedio: {
    tipo: 'Assédio moral', frequencia: 'Semanal', reportou: 'Sim, ao RH',
    provas: 'Mensagens de WhatsApp e testemunhas',
    descricao: 'A supervisora fazia comentários humilhantes na frente dos colegas.',
    obs: 'Cliente apresenta quadro de ansiedade.',
  },
  mod_acid: {
    tipo: 'Doença ocupacional', cat: 'Não emitida', afastamento: 'Sim, 45 dias',
    sequelas: 'Dor lombar crônica', descricao: 'Esforço repetitivo no carregamento de baldes.',
    obs: 'Possui laudo do ortopedista.',
  },

  pedidos: ['Verbas rescisórias', 'Horas extras e reflexos', 'Adicional de insalubridade',
            'Dano moral por assédio', 'Multa do art. 477 da CLT', 'Multa do art. 467 da CLT'],
  obs_pedidos: 'Avaliar pedido de reconhecimento de desvio de função.',

  docsEntregues: ['CTPS', 'RG e CPF', 'Comprovante de residência', 'Holerites'],
  docsEntreguesObs: 'Fotos das conversas de WhatsApp.',
  docsPendentes: 'Extrato do FGTS e laudo médico completo',
  obs_docs: 'Cliente enviará o restante pelo WhatsApp.',

  ultimoDia: '2026-06-20', prazoBienal: '2028-06-20', diasRestantes: '654',
  urgencia: 'Normal', obs_presc: 'Sem risco imediato de prescrição.',

  testemunhas: [
    { nome: 'Joana Ferreira', tel: '(61) 98888-1111', tipo: 'Colega de trabalho', obs: 'Presenciou os fatos' },
    { nome: 'Carlos Andrade', tel: '(61) 97777-2222', tipo: 'Ex-colega', obs: 'Trabalhou até 2024' },
  ],
  obs_test: 'Ambas dispostas a comparecer.',

  prev_benef: 'Auxílio-doença em 2025', prev_prob: 'Benefício cessado indevidamente',
  prev_obs: 'Avaliar ação previdenciária em paralelo.',

  advogado: 'Dr. Pedro Martins', atendente: 'Ana Paula',
  comoConheceu: 'Indicação de cliente', viabilidade: 'Alta',
  proximoPasso: 'Elaborar petição inicial',
  resumoCaso: 'Trabalhadora terceirizada dispensada sem justa causa após 7 anos, sem pagamento de verbas rescisórias.\nRelata jornada extraordinária habitual e assédio moral praticado pela supervisora.',
  obs_final: 'Cliente autorizou contato por WhatsApp.',
};

(async () => {
  const saida = path.join(__dirname, '..', '_saida_teste');
  fs.mkdirSync(saida, { recursive: true });

  console.log('Gerando documentos...\n');
  const arquivos = await Docs.gerarTodos(CASO, CASO._id, new Date());

  let problemas = 0;
  const PizZip = require('pizzip');

  for (const a of arquivos) {
    fs.writeFileSync(path.join(saida, a.nome), a.buffer);

    // Confere se o arquivo saiu íntegro e sem marcadores pendentes
    let situacao = 'OK';
    if (a.nome.endsWith('.pdf')) {
      const cabecalho = a.buffer.slice(0, 5).toString('latin1');
      if (cabecalho !== '%PDF-') situacao = 'ERRO: não é um PDF válido';
      else if (a.buffer.length < 1000) situacao = 'ATENÇÃO: PDF muito pequeno';
      console.log(`  ${situacao === 'OK' ? '✓' : '✗'} ${a.nome.padEnd(45)} ${(a.buffer.length / 1024).toFixed(0).padStart(5)} KB   ${situacao}`);
      if (situacao !== 'OK') problemas++;
      continue;
    }
    try {
      const zip = new PizZip(a.buffer);
      const xml = zip.file('word/document.xml').asText();
      if (!xml || xml.length < 500) situacao = 'ATENÇÃO: documento vazio';
      const sobrando = xml.match(/\{\{[a-zA-Z]+\}\}/g);
      if (sobrando) situacao = 'ATENÇÃO: marcadores não preenchidos → ' + [...new Set(sobrando)].join(', ');
    } catch (e) {
      situacao = 'ERRO: ' + e.message;
    }
    if (situacao !== 'OK') problemas++;
    console.log(`  ${situacao === 'OK' ? '✓' : '✗'} ${a.nome.padEnd(45)} ${(a.buffer.length / 1024).toFixed(0).padStart(5)} KB   ${situacao}`);
  }

  const zip = Docs.montarZip(arquivos);
  fs.writeFileSync(path.join(saida, 'documentos.zip'), zip);
  console.log(`\n  ✓ documentos.zip                              ${(zip.length / 1024).toFixed(0).padStart(5)} KB`);
  console.log(`\nArquivos em: ${saida}`);
  console.log(problemas ? `\n${problemas} problema(s) encontrado(s).` : '\nTudo certo.');
  process.exit(problemas ? 1 : 0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
