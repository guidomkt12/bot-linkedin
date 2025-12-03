const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;

// Configuração básica do multer (agora opcional, pois vamos priorizar URL)
const upload = multer({ dest: '/tmp/uploads/' });

// Aumenta timeouts para evitar quedas
const server = app.listen(PORT, () => console.log(`Bot V8 (URL Edition) rodando na porta ${PORT}`));
server.setTimeout(600000);

// Função auxiliar para baixar imagem da URL
async function downloadImage(url) {
    const tempPath = path.resolve('/tmp', `img_${Date.now()}.jpg`);
    const writer = fs.createWriteStream(tempPath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(tempPath));
        writer.on('error', reject);
    });
}

app.use(express.json()); // Permite JSON no body
app.use(express.urlencoded({ extended: true })); // Permite URL Encoded

app.get('/', (req, res) => res.send('Bot LinkedIn V8 (URL Image Support) 🟢'));

// Aceita tanto multipart (upload) quanto JSON normal
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;

    try {
        console.log('--- NOVA REQUISIÇÃO (V8) ---');
        
        // Dados podem vir do body (JSON) ou do form-data
        const { texto, paginaUrl, email, senha, cookies, imagemUrl } = req.body;
        
        // Lógica de Imagem: Se veio URL, baixa ela. Se veio arquivo, usa arquivo.
        if (!imagePath && imagemUrl) {
            console.log(`Baixando imagem da URL: ${imagemUrl}`);
            try {
                imagePath = await downloadImage(imagemUrl);
                console.log('Imagem baixada com sucesso:', imagePath);
            } catch (err) {
                console.error('Erro ao baixar imagem:', err.message);
                // Não para o fluxo, tenta postar sem imagem ou avisa
            }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal && (!email || !senha)) {
            throw new Error('Faltam dados de autenticação (Cookies ou Email/Senha).');
        }

        // --- INÍCIO PUPPETEER ---
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1920,1080'
            ],
            defaultViewport: { width: 1920, height: 1080 },
            timeout: 0
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(0);
        page.setDefaultTimeout(0);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36');

        // --- LOGIN ---
        let loggedIn = false;
        if (cookiesFinal) {
            console.log('Usando Cookies...');
            try {
                const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
                if (Array.isArray(cookiesJson)) {
                    await page.setCookie(...cookiesJson);
                    loggedIn = true;
                }
            } catch (e) { console.log('Erro cookies:', e.message); }
        }

        if (!loggedIn && email && senha) {
            console.log('Usando Senha...');
            await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
            await page.type('#username', email);
            await page.type('#password', senha);
            await page.click('[type="submit"]');
            await page.waitForNavigation().catch(()=>{});
        }

        // --- NAVEGAÇÃO ---
        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 5000));

        // --- BUSCA BOTÃO ---
        console.log('Buscando botão de postar...');
        const texts = ['Começar', 'Start', 'Criar', 'Publicar', 'Create'];
        const buttons = await page.$$('button, div[role="button"]');
        let found = false;

        for (const btn of buttons) {
            const t = await page.evaluate(el => el.textContent, btn);
            if (t && texts.some(x => t.includes(x))) {
                await btn.click();
                found = true;
                break;
            }
        }

        if (!found) {
            const btn = await page.$('button.share-box-feed-entry__trigger, button.share-box__open');
            if (btn) { await btn.click(); found = true; }
        }

        if (!found) throw new Error(`Botão de postar não encontrado. Título: ${await page.title()}`);

        await new Promise(r => setTimeout(r, 3000));

        // --- UPLOAD DA IMAGEM (Local) ---
        if (imagePath) {
            console.log('Fazendo upload da imagem local...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 60000 }).catch(()=>null);
            
            if (input) {
                await input.uploadFile(imagePath);
                // Espera preview
                try {
                    await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 120000 });
                    console.log('Preview OK!');
                } catch(e) {
                    console.log('Aviso: Preview demorou.');
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // --- TEXTO ---
        if (texto) {
            console.log('Digitando texto...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // --- PUBLICAR ---
        console.log('Clicando em Publicar...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 10000));

        console.log('Sucesso!');
        res.json({ status: 'sucesso', mensagem: 'Postado (Via URL)!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) {
            try {
                await page.screenshot({ path: '/tmp/erro_url.png' });
                res.sendFile('/tmp/erro_url.png');
            } catch (e) { res.status(500).json({ erro: error.message }); }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
