# Martins & Filho — Sistema de Atendimento Trabalhista

## Estrutura
```
atendimento-server/
├── index.js              ← Servidor Node.js
├── package.json
├── templates/            ← 4 templates .docx com marcadores
│   ├── TEMPLATE_CONTRATO_DE_HONORARIOS.docx
│   ├── TEMPLATE_PROCURACAO.docx
│   ├── TEMPLATE_DECLARACAO_HIPOSSUFICIENCIA.docx
│   └── TEMPLATE_TERMO_CIENCIA.docx
└── public/
    └── index.html        ← Ficha de atendimento (frontend)
```

## Deploy no Render

### 1. Subir no GitHub
1. Crie um repositório: `atendimento-martinsefilho`
2. Suba todos os arquivos desta pasta

### 2. Criar Web Service no Render
1. Acesse render.com → New → Web Service
2. Conecte o repositório
3. Configure:
   - **Name:** atendimento-martinsefilho
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`

### 3. Configurar variáveis de ambiente no Render
Em "Environment Variables", adicione:

| Variável | Valor |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | JSON da conta de serviço Google (ver abaixo) |
| `FOLDER_ID` | `1EvvjvZEqdKrhkgKGJ_WpQC1GkXyZMQs5` |
| `SHEET_ID` | `1-bnO144C_lDC4IjZn_H7gpsx0C2lAZuaxiM3CloVKGo` |

### 4. Criar conta de serviço Google
1. Acesse console.cloud.google.com
2. Crie um projeto ou use um existente
3. Ative as APIs: **Google Drive API** e **Google Sheets API**
4. Vá em "Credenciais" → "Criar credenciais" → "Conta de serviço"
5. Baixe o JSON da chave
6. Cole o conteúdo JSON inteiro na variável `GOOGLE_SERVICE_ACCOUNT`
7. No Google Drive, compartilhe a pasta `1EvvjvZEqdKrhkgKGJ_WpQC1GkXyZMQs5`
   com o e-mail da conta de serviço (termina em @...iam.gserviceaccount.com)
8. No Google Sheets, compartilhe a planilha com o mesmo e-mail

## Uso
Após o deploy, a URL do sistema será:
`https://atendimento-martinsefilho.onrender.com`

Compartilhe com o time. Ao clicar em "Salvar no Drive":
- Cria linha na planilha Google Sheets
- Cria pasta `CLIENTE x EMPRESA — DATA` no Drive
- Gera os 4 documentos .docx preenchidos na pasta
