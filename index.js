const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;

// Configuração para salvar imagens temporariamente
const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => res.send('Bot LinkedIn Atualizado (Aceita params)! 🚀'));

// Endpoint principal
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    try {
        // Pega os dados vindos do n8n
        const { texto, paginaUrl, email: emailBody, senha: senhaBody } = req.body;
        const imagePath = req.file ? req.file.path : null;

        // PRIORIDADE: Usa o que veio do n8n. Se não tiver, tenta usar do servidor.
        const email = emailBody || process.env.LINKEDIN_EMAIL;
        const senha = senhaBody || process.env.LINKEDIN_PASSWORD;

        // Validação
        if (!email || !senha) {
            if (imagePath) await fs.remove(imagePath);
            return res.status(400).json({ erro: 'Faltam dados de LOGIN (email ou senha).' });
        }
        if (!paginaUrl) {
            if (imagePath) await fs.remove(imagePath);
            return res.status(400).json({ erro: 'Falta a URL da página (paginaUrl).' });
        }

        console.log(`Iniciando login com: ${email}`);
        
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();

        // --- 1. Login ---
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
        await page.type('#username', email, { delay: 30 });
        await page.type('#password', senha, { delay: 30 });
        await page.click('[type="submit"]');
        
        try {
            await page.waitForNavigation({ timeout: 15000 });
        } catch (e) {
            // Verifica se pediu PIN
            if (await page.$('input[name="pin"]')) throw new Error('LinkedIn pediu verificação de 2FA (PIN).');
        }

        // --- 2. Postar ---
        console.log('Indo para:', paginaUrl);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 4000));

        // Clica para começar post
        const btnStart = await page.waitForSelector('button.share-box-feed-entry__trigger, button.share-box__open', { timeout: 15000 });
        await btnStart.click();
        await new Promise(r => setTimeout(r, 2000));

        // Upload de imagem
        if (imagePath) {
            console.log('Subindo imagem...');
            // Tenta clicar no botão de mídia se necessário
            const mediaBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="foto"], button.share-actions__primary-action--media');
            if (mediaBtn) await mediaBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const input = await page.waitForSelector('input[type="file"]');
            await input.uploadFile(imagePath);
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
        }

        // Texto
        if (texto) {
            console.log('Digitando texto...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
            await new Promise(r => setTimeout(r, 1000));
        }

        // Publicar
        console.log('Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        console.log('Sucesso!');
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath);

        res.json({ status: 'su
