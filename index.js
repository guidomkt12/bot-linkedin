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

// --- SISTEMA ANTI-CRASH ---
process.on('uncaughtException', (err) => {
    console.error('⚠️ ERRO CRÍTICO:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ PROMESSA REJEITADA:', reason);
});

const server = app.listen(PORT, () => console.log(`Super Bot V8 (Hybrid Aggressive) rodando na porta ${PORT} 🛡️`));
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

// Rota de Teste
app.get('/', (req, res) => res.send('Super Bot V8 Online (Hybrid) 🛡️'));

// --- FUNÇÃO AUXILIAR: TAP POR TEXTO ---
async function tapByText(page, textsToFind) {
    try {
        return await page.evaluate((texts) => {
            const elements = [...document.querySelectorAll('button, div[role="button"], span, a, h1, div')];
            for (const el of elements) {
                const txt = el.innerText || el.getAttribute('aria-label') || '';
                if (texts.some(t => txt.toLowerCase().includes(t.toLowerCase()))) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, textsToFind);
    } catch (e) { return false; }
}

// ==========================================
// ROTA 1: LINKEDIN (MANTIDA)
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
        console.log('--- INICIANDO LINKEDIN (V8) ---');
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
// ROTA 2: INSTAGRAM (V8 - HÍBRIDO GEOMÉTRICO + INJECT)
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
        console.log('--- INICIANDO INSTAGRAM (V8 - Hybrid) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        if (!imagePath) throw new Error('Imagem é obrigatória.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-features=IsolateOrigins,site-per-process'],
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

        // --- 1. REMOÇÃO DE BANNERS ---
        console.log('[Insta] Limpeza visual...');
        await page.evaluate(() => {
            const sels = ['div[role="dialog"]', 'div.x1n2onr6', '[aria-label="Use the app"]', 'div._aagw', '.x1lliihq'];
            sels.forEach(s => document.querySelectorAll(s).forEach(e => e.remove()));
            const closeBtns = document.querySelectorAll('button._a9--');
            closeBtns.forEach(b => b.click());
        });
        await new Promise(r => setTimeout(r, 1000));

        // --- 2. LOCALIZAR BOTÃO (+) VIA GEOMETRIA (V6 Lógica) ---
        console.log('[Insta] Escaneando posição do botão...');
        
        const btnLocation = await page.evaluate(() => {
            const width = window.innerWidth;
            const scanZone = { xMin: width - 100, yMax: 70 };
            const svgs = Array.from(document.querySelectorAll('svg'));
            
            // Procura o SVG no canto superior direito
            for (const svg of svgs) {
                const rect = svg.getBoundingClientRect();
                if (rect.x > scanZone.xMin && rect.y < scanZone.yMax && rect.width > 15) {
                    return { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2), found: true };
                }
            }
            return { found: false, x: 355, y: 45 }; // Fallback XY
        });

        console.log(`[Insta] Alvo em X:${btnLocation.x}, Y:${btnLocation.y}. Atacando...`);

        // --- 3. ATAQUE DE CLIQUE (Click + Tap + Event) ---
        // Tenta abrir o modal clicando de todas as formas
        let inputFound = false;
        
        for(let attempt = 0; attempt < 3; attempt++) {
            // Ação 1: Tap Touchscreen
            await page.touchscreen.tap(btnLocation.x, btnLocation.y);
            await new Promise(r => setTimeout(r, 500));
            
            // Ação 2: Clique Mouse
            await page.mouse.click(btnLocation.x, btnLocation.y);
            await new Promise(r => setTimeout(r, 1500)); // Espera modal abrir

            // Checa se o input apareceu
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                console.log('[Insta] Input detectado! Injetando arquivo...');
                await fileInput.uploadFile(imagePath);
                await page.evaluate(() => {
                    const i = document.querySelector('input[type="file"]');
                    if(i) i.dispatchEvent(new Event('change', { bubbles: true }));
                });
                inputFound = true;
                break;
            } else {
                console.log(`[Insta] Tentativa ${attempt+1} falhou. Tentando de novo...`);
            }
        }

        if (!inputFound) {
             // Última chance: Tenta FileChooser tradicional se o Input Injection falhou
             console.log('[Insta] Input não abriu. Tentando FileChooser tradicional...');
             try {
                const [fileChooser] = await Promise.all([
                    page.waitForFileChooser({ timeout: 5000 }),
                    page.touchscreen.tap(btnLocation.x, btnLocation.y),
                ]);
                await fileChooser.accept([imagePath]);
                inputFound = true;
             } catch(e) {
                return await abortWithProof(page, 'Não consegui abrir a janela de upload.');
             }
        }

        console.log('[Insta] Arquivo enviado! Aguardando preview...');
        await new Promise(r => setTimeout(r, 8000));

        // --- 4. POSTAGEM (NEXT -> NEXT -> SHARE) ---
        
        // Next 1
        console.log('[Insta] Avançar 1...');
        let next1 = await tapByText(page, ['Next', 'Avançar']);
        if (!next1) await page.touchscreen.tap(360, 45); // Topo direito
        await new Promise(r => setTimeout(r, 4000));

        // Next 2
        console.log('[Insta] Avançar 2...');
        let next2 = await tapByText(page, ['Next', 'Avançar']);
        if (!next2) await page.touchscreen.tap(360, 45);
        await new Promise(r => setTimeout(r, 4000));

        // Legenda
        if (legenda) {
            console.log('[Insta] Legenda...');
            try {
                const textArea = await page.waitForSelector('textarea, div[role="textbox"]', { timeout: 5000 });
                await textArea.tap();
                await textArea.type(legenda, { delay: 50 });
            } catch(e) {}
        }

        // Share
        console.log('[Insta] Compartilhando...');
        let shared = await tapByText(page, ['Share', 'Compartilhar']);
        if (!shared) await page.touchscreen.tap(360, 45);

        await new Promise(r => setTimeout(r, 15000));
        console.log('[Insta] SUCESSO!');
        
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
