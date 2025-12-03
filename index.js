const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { KnownDevices } = require('puppeteer'); // Necessário para o Instagram
puppeteer.use(StealthPlugin());

const multer = require('multer');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;
const upload = multer({ dest: '/tmp/uploads/' });

// Inicia servidor unificado
const server = app.listen(PORT, () => console.log(`Super Bot (LinkedIn + Insta) rodando na porta ${PORT} 🚀`));
server.setTimeout(600000); // 10 minutos global

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Função auxiliar de download (usada por ambos)
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

app.get('/', (req, res) => res.send('Super Bot Online: Use POST /publicar (LinkedIn) ou POST /instagram 🤖'));

// ==========================================
// ROTA 1: LINKEDIN (V33 - A VENCEDORA)
// ==========================================
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    const abortWithProof = async (p, msg) => {
        console.error(`[LinkedIn] ❌ ERRO: ${msg}`);
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length, 'X-Error-Msg': msg });
            res.end(imgBuffer);
        } catch (e) { res.status(500).json({ erro: msg }); }
    };

    try {
        console.log('--- INICIANDO LINKEDIN (V33) ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;
        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 40000
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log(`[LinkedIn] Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        const title = await page.title();
        if (title.includes('Login') || title.includes('Sign')) return await abortWithProof(page, 'Caiu no login.');

        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('[LinkedIn] Abrindo modal...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { 
                await btn.click(); 
                await new Promise(r => setTimeout(r, 4000)); 
            } else {
                if (!await page.$(editorSelector)) return await abortWithProof(page, 'Não achei o botão de postar.');
            }
        }

        if (imagePath) {
            console.log('[LinkedIn] Colando imagem (V26)...');
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = imgBuffer.toString('base64');
            const mimeType = 'image/jpeg';

            await page.click(editorSelector);
            await new Promise(r => setTimeout(r, 500));

            const result = await page.evaluate(async (sel, b64, mime) => {
                const target = document.querySelector(sel);
                if (!target) return 'No editor';
                const byteChars = atob(b64);
                const byteNums = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                const byteArray = new Uint8Array(byteNums);
                const blob = new Blob([byteArray], { type: mime });
                const file = new File([blob], "paste.jpg", { type: mime });
                const dt = new DataTransfer();
                dt.items.add(file);
                const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
                target.focus();
                target.dispatchEvent(evt);
                return 'OK';
            }, editorSelector, imgBase64, mimeType);

            if (result !== 'OK') console.log('Aviso: Script de imagem retornou ' + result);
            console.log('[LinkedIn] Esperando 10s cego...');
            await new Promise(r => setTimeout(r, 10000));
        }

        if (texto) {
            console.log('[LinkedIn] Inserindo texto...');
            try {
                await page.click(editorSelector);
                await page.keyboard.press('Enter'); 
                await page.evaluate((txt) => {
                    document.execCommand('insertText', false, txt);
                }, texto);
            } catch(e) {}
        }

        console.log('[LinkedIn] Publicando...');
        await new Promise(r => setTimeout(r, 3000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 12000));

        console.log('[LinkedIn] SUCESSO!');
        const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
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

// ==========================================
// ROTA 2: INSTAGRAM (NOVO)
// ==========================================
app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    const abortWithProof = async (p, msg) => {
        console.error(`[Insta] ❌ ERRO: ${msg}`);
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length, 'X-Error-Msg': msg });
            res.end(imgBuffer);
        } catch (e) { res.status(500).json({ erro: msg }); }
    };

    try {
        console.log('--- INICIANDO INSTAGRAM ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        if (!imagePath) throw new Error('Imagem é obrigatória para o Instagram.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            timeout: 60000
        });

        page = await browser.newPage();
        // Emula iPhone para aparecer o botão (+)
        const iPhone = KnownDevices['iPhone 12 Pro'];
        await page.emulate(iPhone);

        console.log('[Insta] Aplicando cookies...');
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log('[Insta] Indo para home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        const url = await page.url();
        if (url.includes('login') || url.includes('accounts/login')) {
            return await abortWithProof(page, 'Caiu no Login. Cookies inválidos.');
        }

        try {
            const closeBtn = await page.$x("//button[contains(text(), 'Agora não') or contains(text(), 'Not Now') or contains(text(), 'Cancelar')]");
            if (closeBtn.length > 0) { await closeBtn[0].click(); await new Promise(r => setTimeout(r, 2000)); }
        } catch(e) {}

        console.log('[Insta] Procurando botão (+)...');
        const newPostSelectors = ['svg[aria-label="New post"]', 'svg[aria-label="Nova publicação"]', 'div[role="menuitem"] svg polygon'];
        let uploadBtn = null;
        for (const sel of newPostSelectors) {
            try {
                const el = await page.$(sel);
                if (el) {
                    uploadBtn = await el.evaluateHandle(el => el.closest('div[role="button"]') || el.closest('a'));
                    break;
                }
            } catch(e){}
        }

        if (!uploadBtn) return await abortWithProof(page, 'Não achei botão (+).');

        const fileChooserPromise = page.waitForFileChooser();
        await uploadBtn.click();
        console.log('[Insta] Enviando arquivo...');
        const fileChooser = await fileChooserPromise;
        await fileChooser.accept([imagePath]);
        await new Promise(r => setTimeout(r, 5000));

        // Avançar 1 (Filtro)
        console.log('[Insta] Avançar 1...');
        let nextBtn = await page.$x("//div[contains(text(), 'Next') or contains(text(), 'Avançar')]");
        if (nextBtn.length > 0) { await nextBtn[0].click(); await new Promise(r => setTimeout(r, 3000)); } 
        else return await abortWithProof(page, 'Botão Avançar 1 não achado.');

        // Avançar 2 (Edição)
        console.log('[Insta] Avançar 2...');
        nextBtn = await page.$x("//div[contains(text(), 'Next') or contains(text(), 'Avançar')]");
        if (nextBtn.length > 0) { await nextBtn[0].click(); await new Promise(r => setTimeout(r, 3000)); }

        // Legenda
        if (legenda) {
            console.log('[Insta] Escrevendo legenda...');
            try {
                const textArea = await page.waitForSelector('textarea[aria-label="Write a caption..."], textarea[aria-label="Escreva uma legenda..."]', { timeout: 5000 });
                await textArea.type(legenda, { delay: 50 });
            } catch(e) {}
        }

        // Compartilhar
        console.log('[Insta] Compartilhando...');
        const shareBtn = await page.$x("//div[contains(text(), 'Share') or contains(text(), 'Compartilhar')]");
        if (shareBtn.length > 0) {
            await shareBtn[0].click();
            await new Promise(r => setTimeout(r, 10000));
            console.log('[Insta] SUCESSO!');
            const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': finalImg.length });
            res.end(finalImg);
        } else {
            return await abortWithProof(page, 'Botão Compartilhar sumiu.');
        }

    } catch (error) {
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
