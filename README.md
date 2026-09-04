# Martins & Filho — Sistema de Atendimento Trabalhista

O funcionário preenche a ficha no site e, com **um clique**, o sistema:

1. Gera **7 documentos**:
   - `0_Boas_Vindas` — **PDF** de boas-vindas já com o nome do cliente e o gênero certo
   - `1_Ficha_Atendimento` — a ficha completa preenchida (todas as 13 seções)
   - `2_Resumo_Juridico` — resumo do caso com as teses identificadas
   - `3_Contrato` — contrato de honorários (template timbrado)
   - `4_Procuracao` — procuração (template timbrado)
   - `5_Declaracao` — declaração de hipossuficiência (template timbrado)
   - `6_Termo_Ciencia` — termo de ciência (template timbrado)
2. Cria a pasta **`CLIENTE x EMPRESA — DATA`** dentro da pasta automatizada do Drive e sobe os 6 documentos.
3. Registra o atendimento na planilha do Google Sheets (com o link da pasta).
4. Baixa o `.zip` com tudo no computador do funcionário.
5. Abre a pasta do Drive numa aba nova.
6. Opcional: envia contrato, procuração, declaração e termo para **assinatura no ZapSign**.

---

## 1. Publicar no Render

O código precisa estar no GitHub. O Render pega de lá sozinho a cada alteração.

### Se o repositório já existe

1. Abra o repositório no GitHub.
2. Clique em **Add file → Upload files**.
3. Arraste **todos** os arquivos e pastas desta pasta (`index.js`, `package.json`, `lib/`, `public/`, `templates/`, `scripts/`).
   > Não suba a pasta `node_modules` nem `_saida_teste` — elas são geradas automaticamente.
4. Escreva uma descrição (ex.: "ficha de atendimento e envio ao Drive") e clique em **Commit changes**.
5. O Render detecta a mudança e republica em 2 a 3 minutos. Acompanhe em **Logs**, no painel do serviço.

### Se precisar criar o serviço do zero

1. Em [render.com](https://render.com) → **New** → **Web Service**.
2. Conecte o repositório do GitHub.
3. Configure:
   - **Name:** `atendimento-mf`
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** qualquer plano pago mantém o site sempre no ar. No plano gratuito o site "dorme" e a primeira abertura do dia demora cerca de 1 minuto.
4. Preencha as variáveis abaixo e clique em **Create Web Service**.

---

## 2. Variáveis de ambiente (Render → Environment)

| Variável | Obrigatória | O que é |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | Sim | O arquivo `.json` inteiro da conta de serviço do Google, colado das chaves `{` até `}`. |
| `FOLDER_ID` | Sim | ID da pasta **PASTA CLIENTES - AUTOMATIZADA**: `1EpvGtzCR8ZUhlFG5Gsbwgx6YveWucS9d` |
| `SHEET_ID` | Sim | ID da planilha de atendimentos (está na URL da planilha, entre `/d/` e `/edit`). |
| `IMPERSONATE_USER` | Recomendada | E-mail do escritório (ex.: `pedromartins@pedromartins.adv.br`). Ver seção 3. |
| `ZAPSIGN_TOKEN` | Não | Token da API do ZapSign. Sem ele, o botão de assinatura não aparece. |
| `ZAPSIGN_AUTH_MODE` | Não | Como o cliente assina. Padrão: `assinaturaTela` (desenha a assinatura). |

Depois de mexer em qualquer variável, clique em **Save Changes** — o Render reinicia sozinho.

---

## 3. Permissão da pasta no Google Drive

A pasta precisa estar compartilhada com a conta de serviço.

1. Abra `https://atendimento-mf.onrender.com/diag` e anote o e-mail em **`contaDeServico`** (termina em `@...iam.gserviceaccount.com`).
2. No Drive, abra a pasta **PASTA CLIENTES - AUTOMATIZADA** → **Compartilhar** → cole esse e-mail → permissão **Editor**.
3. Faça o mesmo com a **planilha** de atendimentos.

### Sobre o `IMPERSONATE_USER`

Contas de serviço do Google **não têm espaço de armazenamento próprio**. Sem esse ajuste, o Drive pode recusar o envio com erro de cota. Duas formas de resolver:

**Opção A — delegação em todo o domínio (recomendada):**
1. No `/diag`, copie o **Client ID** da conta de serviço (no Google Cloud, em Contas de Serviço → a conta → Detalhes).
2. No [Admin do Google Workspace](https://admin.google.com) → **Segurança** → **Controle de acesso e dados** → **Controles de API** → **Delegação em todo o domínio** → **Adicionar novo**.
3. Cole o Client ID e, em escopos, cole:
   `https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets`
4. No Render, preencha `IMPERSONATE_USER` com o e-mail do escritório.

**Opção B — Drive compartilhado:** mover a pasta para um *Drive compartilhado* (Shared Drive) do Workspace e adicionar a conta de serviço como membro. Arquivos em Drive compartilhado não consomem cota individual.

---

## 4. Conferir se está tudo certo

Abra no navegador: **`https://atendimento-mf.onrender.com/diag`**

Essa página testa tudo de uma vez e responde em português:

- `variaveis` — quais variáveis estão preenchidas
- `contaDeServico` — o e-mail para compartilhar a pasta
- `templates` — se os 4 modelos .docx estão no servidor
- `geracaoDocumentos` — se os 6 documentos são gerados
- `pastaDrive` — se a pasta foi encontrada e aceita novos arquivos
- `gravacaoNoDrive` — cria um arquivo de teste na pasta e apaga em seguida (é o teste que vale)
- `planilha` — quantos atendimentos já estão registrados

Se algum item disser `ERRO`, a própria mensagem explica o que fazer.

---

## 5. Assinatura eletrônica (ZapSign)

1. No ZapSign: **Configurações → Integrações → API ZAPSIGN** e copie o token.
2. No Render, crie a variável `ZAPSIGN_TOKEN` com esse valor e salve.
3. Depois de salvar um atendimento, aparece o botão **✍️ Enviar para assinatura (ZapSign)**.

São enviados 4 documentos: contrato, procuração, declaração e termo de ciência. A ficha e o resumo jurídico são internos e não vão para assinatura.

O cliente recebe o link por e-mail e/ou WhatsApp, conforme o que estiver preenchido na ficha.

---

## 5-B. Carta de boas-vindas em PDF

O sistema já monta a carta com o nome do cliente e a concordância de gênero correta
(*bem-vinda* / *bem-vindo*), sem ninguém precisar editar nada.

**Como o gênero é definido:** pelo campo *Tratamento* na primeira seção da ficha.
Se ficar em branco, o sistema deduz pelo estado civil (Casada → feminino). Não
conseguindo deduzir, usa a forma neutra "bem-vindo(a)".

**Um único design no Canva serve para os dois gêneros.** O escritório mantém só a
versão feminina; a masculina é gerada a partir dela, com a concordância trocada.
Assim as duas nunca mais saem do lugar uma da outra.

| Arquivo em `templates/` | O que é |
|---|---|
| `BOAS_VINDAS_PADRAO.pdf` | **O design do Canva**, exportado como está. É a referência. |
| `BOAS_VINDAS_F_LIMPO.pdf` | Gerado — carta da cliente mulher |
| `BOAS_VINDAS_M_LIMPO.pdf` | Gerado — carta do cliente homem, com a concordância trocada |
| `Ubuntu-Regular.ttf` / `Ubuntu-Bold.ttf` | A mesma fonte do Canva, para o nome sair com a letra certa |

### O que o preparo faz

| Onde | O quê |
|---|---|
| Páginas 1 e 7 | Tira o nome do cliente anterior; o sistema escreve o nome de cada cliente na hora |
| Página 1 (masculino) | "SEJA BEM VINDA" → "VINDO", "bem vinda" → "bem vindo", "como nossa" → "como nosso" |
| Página 2 (masculino) | "guiá-**la**" → "guiá-**lo**" |
| Páginas 3 e 7 (masculino) | "nossa cliente" → "nosso cliente" |

O nome sai em **dois lugares**: na capa, em negrito e caixa alta, logo depois do "Olá,";
e no começo da página 7, em negrito. O sistema usa **primeiro e segundo nome**
("Maria Aparecida de Souza" vira "Maria Aparecida").

O texto do cliente anterior é **removido de dentro do arquivo**, não apenas coberto —
senão apareceria para quem copiasse o conteúdo do PDF. Os **8 links clicáveis**
(WhatsApp, Instagram, Facebook, site e localização) continuam funcionando.

### Se você mexer no design do Canva

1. Exporte em PDF e substitua `templates/BOAS_VINDAS_PADRAO.pdf`.
2. Rode:

```bash
node scripts/preparar-modelos.js
```

Ele gera as duas versões, confere que nada foi perdido e avisa se algo não bateu.
Em seguida:

```bash
node scripts/teste-boas-vindas.js
```

Gera cartas de teste em `_saida_teste/` (PDF e imagem) e acusa nome antigo esquecido
ou concordância errada.

**Se você mudar o texto da carta**, rode antes:

```bash
node scripts/mapear-genero.js
```

Ele lista todo trecho com marca de gênero, para conferir se a lista `TROCAS_MASCULINO`
(em `scripts/preparar-modelos.js`) ainda cobre tudo.

**Se o nome mudar de lugar no layout**, rode:

```bash
node scripts/calibrar-boas-vindas.js
```

Ele imprime as coordenadas novas para atualizar `LOCAIS_DO_NOME`, em `lib/boasvindas.js`.

Dá também para ajustar a saudação da capa sem mexer no código, pelas variáveis abaixo.
As medidas são em pontos, contados a partir do canto superior esquerdo da página.

| Variável | Padrão | O que faz |
|---|---|---|
| `BV_X` / `BV_Y` | 174,2 / 233,3 | Onde o nome é escrito na capa (linha de base) |
| `BV_TAM` | 24,3 | Tamanho da letra do nome na capa |

---

## 6. Rotas do sistema

| Rota | Para que serve |
|---|---|
| `/` | Formulário de atendimento |
| `/diag` | Diagnóstico da configuração |
| `/salvar` | Salva o atendimento (documentos + Drive + planilha) |
| `/baixar/:protocolo` | Baixa de novo o .zip (vale 1 hora) |
| `/gerar-docs` | Só gera o .zip, sem tocar no Drive |
| `/zapsign` | Envia os documentos para assinatura |
| `/listar` | Lista os atendimentos da planilha |
| `/ping` | Confirma que o servidor está no ar |

---

## 7. Testar na sua máquina (opcional)

```bash
npm install
node scripts/teste-local.js
```

Gera os 6 documentos na pasta `_saida_teste/`, sem tocar no Drive nem na planilha. Serve para conferir os textos depois de mexer em algum template.

Para rodar o site inteiro localmente:

```bash
npm start
```

E abrir `http://localhost:3000`.

---

## 8. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| "Drive: O Google recusou o envio por cota de armazenamento" | Falta o `IMPERSONATE_USER` ou usar Drive compartilhado. Ver seção 3. |
| "A pasta informada em FOLDER_ID não foi encontrada" | ID errado, ou a pasta não foi compartilhada com a conta de serviço. |
| "Sem permissão na pasta do Drive" | Compartilhe a pasta como **Editor**, não como Leitor. |
| Documento sai com `{{nomeCliente}}` no lugar do nome | O template foi editado e o marcador quebrou no meio. Reescreva o marcador de uma vez só, sem formatar letra por letra. |
| O site demora 1 minuto para abrir | Plano gratuito do Render "dorme" após 15 minutos parado. |
| O .zip não baixa | O navegador pode estar bloqueando. Use o botão **⬇️ Baixar documentos de novo**. |
| A pasta do Drive não abre sozinha | Bloqueio de pop-up. Use o botão **📂 Abrir pasta no Drive**. |

---

## 9. Onde mexer em cada coisa

| Quero mudar | Arquivo |
|---|---|
| Campos do formulário, textos da tela | `public/index.html` |
| O que entra na ficha e no resumo jurídico | `lib/docs.js` |
| Texto da carta de boas-vindas | `lib/boasvindas.js` |
| Contrato, procuração, declaração, termo | `templates/*.docx` (marcadores `{{assim}}`) |
| Colunas da planilha | `lib/google.js` (constante `CABECALHO`) |
| Nome da pasta criada no Drive | `index.js` (função `nomeDaPasta`) |
| Quais documentos vão para assinatura | `lib/docs.js` (constante `PARA_ASSINATURA`) |
