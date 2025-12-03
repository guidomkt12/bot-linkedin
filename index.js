const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const multer = require('multer');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;
const upload = multer({ dest: '/tmp/uploads/' });

const server = app.listen(PORT, () => console.log(`Bot V11 (Cirúrgico) rodando na porta ${PORT}`));
server.setTimeout(600000);

// Função de Download
async function downloadImage(url) {
    const tempPath = path.resolve('/tmp', `img_${Date.now()}.jpg`);
    const writer = fs.createWriteStream(tempPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(tempPath));
        writer.on('error', reject);
    });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => res.send('Bot V11 Online 🎯'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    try {
        console.log('--- TENTATIVA V11 (Foco no Dashboard) ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        // 1. Download Imagem
        if (!imagePath && imagemUrl) {
            try {
                console.log('Baixando imagem...');
                imagePath = await downloadImage(imagemUrl);
            } catch (e) { console.error('Erro download:', e.message); }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        // 2. Navegador
        browser = await puppeteer.launch({
            headless: true, // headless: false se quiser ver rodando localmente
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled' // Esconde que é robô
            ],
            defaultViewport: { width: 1920, height: 1080 },
            timeout: 0,
            userDataDir: '/tmp/session_v11' // Nova pasta de sessão
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 3. Cookies
        console.log('Injetando cookies...');
        try {
            const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
            if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);
        } catch (e) { console.log('Erro cookies:', e.message); }

        // 4. Navegação
        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // VERIFICAÇÃO DE SEGURANÇA
        const title = await page.title();
        console.log(`Estamos em: ${title}`);
        if (title.includes('Login') || title.includes('Sign')) throw new Error('Caiu no Login. Renove os Cookies.');

        // 5. CLIQUE CIRÚRGICO
        console.log('Procurando a caixa de postagem...');
        
        // Seletores específicos da HOME da empresa (não da aba de posts)
        // O LinkedIn tem um botão "Start a post" que é um button.share-box-feed-entry__trigger
        const postBoxSelectors = [
            'button.share-box-feed-entry__trigger', // Padrão
            'div.share-box-feed-entry__trigger',    // Variação
            'button[aria-label="Start a post"]',    // Acessibilidade EN
            'button[aria-label="Começar publicação"]', // Acessibilidade PT
            'div.share-box-feed-entry__top-bar'     // Clica na barra inteira
        ];

        let found = false;
        for (const sel of postBoxSelectors) {
            const el = await page.$(sel);
            if (el) {
                console.log(`Clicando no seletor: ${sel}`);
                await el.click();
                found = true;
                break;
            }
        }

        if (!found) {
            console.log('Seletores falharam. Tentando forçar abertura do modal via Texto...');
            // Procura SOMENTE botões visíveis no meio da tela, ignorando topo
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                // Evita clicar em "Criar Evento" ou "Escrever Artigo"
                if (text && (text.includes('Começar publicação') || text.includes('Start a post'))) {
                    await btn.click();
                    found = true;
                    break;
                }
            }
        }

        if (!found) throw new Error(`Não achei a caixa de postar. Print salvo.`);

        // Espera modal abrir
        await page.waitForSelector('div[role="dialog"], .share-creation-state', { timeout: 10000 });
        console.log('Modal aberto!');

        // 6. UPLOAD
        if (imagePath) {
            console.log('Upload Imagem...');
            // Às vezes precisa clicar no ícone de imagem primeiro dentro do modal
            const imageBtn = await page.$('button[aria-label="Adicionar mídia"], button[aria-label="Add media"]');
            if (imageBtn) await imageBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
            await input.uploadFile(imagePath);
            
            // Espera preview
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 90000 });
            console.log('Imagem carregada.');
            await new Promise(r => setTimeout(r, 2000));
        }

        // 7. TEXTO
        if (texto) {
            console.log('Escrevendo...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // 8. PUBLICAR
        console.log('Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Checa se está habilitado
        const isDisabled = await page.evaluate(el => el.disabled, btnPost);
        if (isDisabled) await new Promise(r => setTimeout(r, 5000)); // Espera se estiver cinza

        await btnPost.click();
        await new Promise(r => setTimeout(r, 10000));

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado V11!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) {
            try {
                await page.screenshot({ path: '/tmp/erro_v11.png', fullPage: true });
                res.sendFile('/tmp/erro_v11.png');
            } catch (e) { res.status(500).json({ erro: error.message }); }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
