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

const server = app.listen(PORT, () => console.log(`Bot V23 (Injeção Direta) rodando na porta ${PORT} 💉`));
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

app.get('/', (req, res) => res.send('Bot V23 Online 💉'));

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
        console.log('--- V23: INJEÇÃO DIRETA DE ARQUIVO ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;
        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 40000
        });

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

        // --- UPLOAD VIA INJEÇÃO DIRETA (SEM CLICAR EM ÍCONES) ---
        if (imagePath) {
            console.log('💉 Procurando input de arquivo escondido...');
            // Tenta encontrar qualquer input do tipo file na página
            const fileInput = await page.$('input[type="file"]');
            
            if (fileInput) {
                console.log('💉 Input encontrado! Injetando arquivo à força...');
                // Força o upload do arquivo diretamente no elemento, ignorando a UI
                await fileInput.uploadFile(imagePath);
                
                console.log('Aguardando processamento do preview...');
                // Espera o LinkedIn reagir à injeção
                try {
                    await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                    console.log('✅ Imagem injetada e processada!');
                } catch (e) {
                    // Se falhar, tenta um truque: disparar um evento de 'change' no input
                    console.log('Preview não apareceu. Forçando evento "change"...');
                    await page.evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })), fileInput);
                    try {
                        await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 30000 });
                         console.log('✅ Imagem processada após forçar evento!');
                    } catch(e2) {
                         return await abortWithProof(page, 'Injeção falhou: LinkedIn ignorou o arquivo.');
                    }
                }
            } else {
                return await abortWithProof(page, 'Não encontrei o input de arquivo escondido na página.');
            }
        }

        // --- TEXTO (COLAR) ---
        if (texto) {
            console.log('📝 Colando texto...');
            try {
                await page.click(editorSelector);
                await new Promise(r => setTimeout(r, 500));
                await page.evaluate((txt) => document.execCommand('insertText', false, txt), texto);
            } catch(e) {}
        }

        // --- PUBLICAR ---
        console.log('🚀 Publicando...');
        await new Promise(r => setTimeout(r, 3000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        if (await page.evaluate(el => el.disabled, btnPost)) return await abortWithProof(page, 'Botão desabilitado (Upload deve ter falhado).');
        
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao publicar.'); }

        console.log('✅ SUCESSO V23!');
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
