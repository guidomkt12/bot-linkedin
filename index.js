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

const server = app.listen(PORT, () => console.log(`Bot V22 (Full Clipboard) rodando na porta ${PORT} 📋`));
server.setTimeout(600000);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Função Download
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

// Rota de Teste
app.get('/', (req, res) => res.send('Bot V22 Online 📋'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    const abortWithProof = async (p, msg) => {
        console.error(`❌ ERRO: ${msg}`);
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length, 'X-Error-Msg': msg });
            res.end(imgBuffer);
        } catch (e) { res.status(500).json({ erro: msg }); }
    };

    const checkSession = async (p) => {
        const url = await p.url();
        if (url.includes('login') || url.includes('signup')) throw new Error('SESSÃO CAIU.');
    };

    try {
        console.log('--- V22: TUDO NO CTRL+V ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;
        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--window-size=1280,800',
                '--disable-blink-features=AutomationControlled',
                '--enable-features=ClipboardAPI,ClipboardAPIAsync' // Habilita API de Clipboard
            ],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 40000
        });

        // Permissões de Clipboard são CRUCIAIS
        const context = browser.defaultBrowserContext();
        // Tenta dar permissão para o domínio do LinkedIn
        try {
            await context.overridePermissions('https://www.linkedin.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
        } catch (e) { console.log('Aviso permissão:', e.message); }

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao entrar.'); }

        // Garantir Modal Aberto
        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('Abrindo modal...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { await btn.click(); await new Promise(r => setTimeout(r, 3000)); }
        }
        
        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado no modal.'); }

        // --- COLAR IMAGEM (A MÁGICA) ---
        if (imagePath) {
            console.log('📋 Convertendo imagem para Clipboard...');
            
            // Lê o arquivo do disco para Base64
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;

            // Foca no editor ANTES de mexer na area de transferencia
            await page.click(editorSelector);
            await new Promise(r => setTimeout(r, 1000));

            // Executa script DENTRO do navegador para escrever no Clipboard do Chrome
            await page.evaluate(async (base64Data) => {
                const res = await fetch(base64Data);
                const blob = await res.blob();
                // Escreve o blob da imagem na área de transferência
                await navigator.clipboard.write([
                    new ClipboardItem({ [blob.type]: blob })
                ]);
            }, imgBase64);

            console.log('📋 Imagem copiada! Executando Ctrl+V...');
            
            // Simula Ctrl+V físico
            await page.keyboard.down('Control');
            await page.keyboard.press('V');
            await page.keyboard.up('Control');

            // Espera o LinkedIn processar a colagem
            console.log('Aguardando processamento da imagem...');
            try {
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                console.log('✅ Imagem colada com sucesso!');
            } catch (e) {
                return await abortWithProof(page, 'Imagem não apareceu após Ctrl+V.');
            }
        }

        // --- COLAR TEXTO ---
        if (texto) {
            console.log('📝 Colando texto...');
            try {
                // Limpa seleção ou pula linha se já tiver imagem
                await page.click(editorSelector);
                
                // Cola texto usando execCommand (mais seguro que Ctrl+V para texto misto)
                await page.evaluate((txt) => document.execCommand('insertText', false, txt), texto);
            } catch(e) {}
        }

        // --- PUBLICAR ---
        console.log('🚀 Publicando...');
        await new Promise(r => setTimeout(r, 3000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        if (await page.evaluate(el => el.disabled, btnPost)) return await abortWithProof(page, 'Botão desabilitado.');
        
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao publicar.'); }

        console.log('✅ SUCESSO V22!');
        const finalImg = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': finalImg.length });
        res.end(finalImg);

    } catch (error) {
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
