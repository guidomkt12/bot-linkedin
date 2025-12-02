const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;

// Configuração do upload (imagens temporárias)
const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => {
    res.send('Bot LinkedIn Online! 🚀 Aguardando requisições POST em /publicar');
});

// Endpoint principal
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // Caminho da imagem (se houver)
    const imagePath = req.file ? req.file.path : null;

    try {
        console.log('Recebendo requisição...');
        
        // 1. Captura dados (prioriza o que vem do n8n, senão usa do ambiente)
        const { texto, paginaUrl, email: emailBody, senha: senhaBody } = req.body;
        
        const email = emailBody || process.env.LINKEDIN_EMAIL;
        const senha = senhaBody || process.env.LINKEDIN_PASSWORD;

        // 2. Validações básicas
        if (!email || !senha) {
            throw new Error('Email e Senha são obrigatórios (envie pelo n8n ou configure no Painel).');
        }
        if (!paginaUrl) {
            throw new Error('A URL da página (paginaUrl) é obrigatória.');
        }

        console.log(`Iniciando login com usuário: ${email}`);

        // 3. Inicia o Navegador
        const browser = await puppeteer.launch({
            headless: true, // true para servidor, false para teste local
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();

        // --- Fluxo de Login ---
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
        await page.type('#username', email, { delay: 50 });
        await page.type('#password', senha, { delay: 50 });
        await page.click('[type="submit"]');
        
        // Espera login concluir
        try {
            await page.waitForNavigation({ timeout: 15000 });
        } catch (e) {
            // Se der timeout, verifica se pediu PIN/Código
            if (await page.$('input[name="pin"]')) {
                throw new Error('O LinkedIn pediu verificação de segurança (PIN/2FA).');
            }
        }
        
        console.log('Login efetuado (supostamente). Navegando para a página...');

        // --- Fluxo de Postagem ---
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 5000)); // Espera carregar a página admin

        // Clica em "Começar publicação"
        const btnSelector = 'button.share-box-feed-entry__trigger, button.share-box__open';
        try {
            await page.waitForSelector(btnSelector, { timeout: 10000 });
            await page.click(btnSelector);
        } catch (e) {
            throw new Error('Não encontrei o botão de criar post. Verifique se o link é da página ADMIN.');
        }

        await new Promise(r => setTimeout(r, 2000));

        // Upload de Imagem (se enviada)
        if (imagePath) {
            console.log('Anexando imagem...');
            // Tenta clicar no ícone de foto/mídia se necessário
            const mediaBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="foto"], button.share-actions__primary-action--media');
            if (mediaBtn) await mediaBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const inputUpload = await page.waitForSelector('input[type="file"]');
            await inputUpload.uploadFile(imagePath);
            
            // Espera preview aparecer
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
        }

        // Digitar Texto
        if (texto) {
            console.log('Digitando texto...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 20 });
            await new Promise(r => setTimeout(r, 1000));
        }

        // Publicar
        console.log('Clicando em Publicar...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se está habilitado
        const isDisabled = await page.evaluate(el => el.disabled, btnPost);
        if (isDisabled) throw new Error('Botão de publicar está desabilitado (algo faltando?).');

        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000)); // Espera confirmar

        console.log('Post realizado com sucesso!');
        await browser.close();

        // Limpa arquivo temporário
        if (imagePath) await fs.remove(imagePath);

        res.json({ status: 'sucesso', mensagem: 'Post publicado com sucesso!' });

    } catch (error) {
        console.error('Erro na execução:', error.message);
        // Limpa arquivo se der erro
        if (imagePath) await fs.remove(imagePath).catch(() => {});
        
        res.status(500).json({ 
            status: 'erro', 
            mensagem: error.message,
            dica: 'Verifique os Logs do Easypanel para ver detalhes.'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
