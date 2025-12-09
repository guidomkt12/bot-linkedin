const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { KnownDevices } = require('puppeteer'); 
puppeteer.use(StealthPlugin());

const multer = require('multer');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;
const upload = multer({ dest: '/tmp/uploads/' });

// --- SISTEMA ANTI-CRASH (SEGURA O SERVIDOR LIGADO) ---
process.on('uncaughtException', (err) => {
    console.error('⚠️ ERRO CRÍTICO (Mas o servidor continua vivo):', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ PROMESSA REJEITADA (Servidor vivo):', reason);
});

const server = app.listen(PORT, () => console.log(`Super Bot V4 (Anti-Crash) rodando na porta ${PORT} 🛡️`));
server.setTimeout(600000); 

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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

// Rota de Teste (Para saber se atualizou)
app.get('/', (req, res) => res.send('Super Bot V4 Online (Fix Insta +) 🛡️'));

// --- FUNÇÃO DE CLIQUE SEGURA (INSTAGRAM) ---
async function clickByText(page, textsToFind) {
    try {
        return await page.evaluate((texts) => {
            const elements = [...document.querySelectorAll('button, div[role="button"], span, a')];
            for (const el of elements) {
                if (texts.some(t => el.innerText && el.innerText.toLowerCase().includes(t.toLowerCase()))) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, textsToFind);
    } catch (e) { return false; }
}

// ==========================================
// ROTA 1: LINKEDIN (V33 - MANTIDA)
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
        console.log('--- INICIANDO LINKEDIN (V4) ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 40000
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
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
            console.log('[LinkedIn] Colando imagem...');
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

            if (result !== 'OK') console.log('Aviso imagem: ' + result);
            await new Promise(r => setTimeout(r, 10000));
        }

        if (texto) {
            console.log('[LinkedIn] Texto...');
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
// ROTA 2: INSTAGRAM (CORRIGIDA - FIX BOTÃO +)
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
        console.log('--- INICIANDO INSTAGRAM (V4 - FIX) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        if (!imagePath) throw new Error('Imagem é obrigatória.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            timeout: 60000
        });

        page = await browser.newPage();
        const iPhone = KnownDevices['iPhone 12 Pro'];
        await page.emulate(iPhone);

        console.log('[Insta] Cookies...');
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log('[Insta] Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        const url = await page.url();
        if (url.includes('login') || url.includes('accounts/login')) {
            return await abortWithProof(page, 'Caiu no Login.');
        }

        // --- MATA POPUPS (COM FUNÇÃO SEGURA) ---
        console.log('[Insta] Caçando popups...');
        for (let i = 0; i < 4; i++) {
            const closed = await clickByText(page, ['Not now', 'Agora não', 'Agora nao', 'Cancel', 'Cancelar', 'Salvar informações', 'Save info']);
            if (closed) {
                console.log('[Insta] Popup fechado.');
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        // Clica no centro da tela (Safe zone) para fechar modais soltos
        try { await page.mouse.click(190, 400); } catch(e){}

        // --- CORREÇÃO DO BOTÃO (+) ---
        console.log('[Insta] Buscando (+)...');
        
        // Seletor universal (PT/EN/SVG)
        const selectorPost = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
        
        try {
            // Espera explícita para garantir que o elemento carregou
            await page.waitForSelector(selectorPost, { visible: true, timeout: 12000 });
        } catch (e) {
            console.log('[Insta] Aviso: Botão (+) demorou. Tentando limpar popup novamente...');
            await clickByText(page, ['Not now', 'Agora não']);
        }

        // Tenta pegar o elemento SVG e subir para o botão clicável
        const btnIcon = await page.$(selectorPost);
        let uploadBtn = null;
        if (btnIcon) {
            uploadBtn = await btnIcon.evaluateHandle(el => el.closest('div[role="button"]') || el.closest('a'));
        }

        if (!uploadBtn) {
            return await abortWithProof(page, 'Não achei botão (+). Veja o print.');
        }

        const fileChooserPromise = page.waitForFileChooser();
        await uploadBtn.click();
        console.log('[Insta] Enviando arquivo...');
        
        const fileChooser = await fileChooserPromise;
        await fileChooser.accept([imagePath]);
        await new Promise(r => setTimeout(r, 6000)); // Delay maior para carregar preview

        // Avançar 1
        console.log('[Insta] Avançar 1...');
        const next1 = await clickByText(page, ['Next', 'Avançar']);
        if (!next1) return await abortWithProof(page, 'Botão Avançar 1 sumiu.');
        await new Promise(r => setTimeout(r, 3000));

        // Avançar 2
        console.log('[Insta] Avançar 2...');
        await clickByText(page, ['Next', 'Avançar']);
        await new Promise(r => setTimeout(r, 3000));

        // Legenda
        if (legenda) {
            console.log('[Insta] Legenda...');
            try {
                const textArea = await page.waitForSelector('textarea[aria-label="Write a caption..."], textarea[aria-label="Escreva uma legenda..."]', { timeout: 5000 });
                await textArea.type(legenda, { delay: 50 });
            } catch(e) {}
        }

        // Compartilhar
        console.log('[Insta] Compartilhando...');
        const shared = await clickByText(page, ['Share', 'Compartilhar']);
        
        if (shared) {
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
