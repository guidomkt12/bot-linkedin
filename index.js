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

// --- SISTEMA ANTI-CRASH ---
process.on('uncaughtException', (err) => { console.error('⚠️ ERRO CRÍTICO:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ PROMESSA REJEITADA:', reason); });

const server = app.listen(PORT, () => console.log(`Super Bot V16 (DEBUG MODE) rodando na porta ${PORT} 📸`));
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

app.get('/', (req, res) => res.send('Super Bot V16 Online (DEBUG MODE) 📸'));

// --- FUNÇÃO AUXILIAR: CLIQUE ROBUSTO ---
async function clickByText(page, textsToFind, tag = '*') {
    try {
        return await page.evaluate((texts, tagName) => {
            const elements = [...document.querySelectorAll(tagName)];
            for (const el of elements) {
                const txt = el.innerText || el.getAttribute('aria-label') || '';
                if (texts.some(t => txt.toLowerCase().includes(t.toLowerCase()))) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, textsToFind, tag);
    } catch (e) { return false; }
}

// --- FUNÇÃO DE DEBUG (O PAPARAZZI) ---
async function checkDebug(page, reqStep, currentStepStr, res, browser, imagePath) {
    if (reqStep && reqStep === currentStepStr) {
        console.log(`[DEBUG] 📸 Parada solicitada no passo: ${currentStepStr}. Tirando print e saindo.`);
        const debugImg = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'X-Debug-Stop': currentStepStr });
        res.end(debugImg);
        
        // Limpeza antes de forçar a parada
        await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
        return true; // Sinaliza que deve parar
    }
    return false; // Continua
}

// ==========================================
// ROTA INSTAGRAM (V16 - DEBUG)
// ==========================================
app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;
    // Captura o passo de debug da URL (ex: ?debug=5)
    const debugStep = req.query.debug; 

    const abortWithProof = async (p, msg) => {
        console.error(`[Insta] ❌ ERRO: ${msg}`);
        try {
            if(p && !p.isClosed()) {
                const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
                if(!res.headersSent) {
                    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'X-Error-Msg': msg });
                    res.end(imgBuffer);
                }
            } else { throw new Error('Page closed'); }
        } catch (e) { if(!res.headersSent) res.status(500).json({ erro: msg }); }
    };

    try {
        console.log(`--- INICIANDO INSTAGRAM (V16)${debugStep ? ` - DEBUG PASSO ${debugStep}` : ''} ---`);
        const { legenda, cookies, imagemUrl } = req.body;

        if (!imagePath && imagemUrl) { try { imagePath = await downloadImage(imagemUrl); } catch (e) {} }
        if (!imagePath) throw new Error('Imagem é obrigatória.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1366,768', '--start-maximized', '--disable-features=IsolateOrigins,site-per-process'],
            defaultViewport: { width: 1366, height: 768 },
            timeout: 60000
        });
        
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://www.instagram.com', ['clipboard-read', 'clipboard-write']);

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log('[Insta] Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);
        
        // --- DEBUG 1: Home Limpa ---
        if(await checkDebug(page, debugStep, '1', res, browser, imagePath)) return;

        console.log('[Insta] Botão Criar...');
        let createBtnFound = false;
        const createSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"], svg[aria-label="Criar"]';
        if (await page.$(createSelector)) { await page.click(createSelector); createBtnFound = true; } 
        else { createBtnFound = await clickByText(page, ['Create', 'Criar'], 'span'); }
        if (!createBtnFound) return await abortWithProof(page, 'Botão Criar não encontrado.');
        await new Promise(r => setTimeout(r, 3000));

        // --- DEBUG 2: Modal Aberto ---
        if(await checkDebug(page, debugStep, '2', res, browser, imagePath)) return;

        console.log('[Insta] Upload...');
        const fileChooserPromise = page.waitForFileChooser();
        const selectBtn = await clickByText(page, ['Select from computer', 'Selecionar do computador', 'Select'], 'button');
        if (!selectBtn) {
            const inputUpload = await page.$('input[type="file"]');
            if(inputUpload) await inputUpload.uploadFile(imagePath);
            else return await abortWithProof(page, 'Input de upload não achado.');
        } else { const fileChooser = await fileChooserPromise; await fileChooser.accept([imagePath]); }
        console.log('[Insta] Aguardando Crop...');
        await new Promise(r => setTimeout(r, 5000));

        // --- DEBUG 3: Tela de Crop ---
        if(await checkDebug(page, debugStep, '3', res, browser, imagePath)) return;

        console.log('[Insta] Next 1 (Crop)...');
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]'); 
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if (!next1) return await abortWithProof(page, 'Travou no Crop.');
        await new Promise(r => setTimeout(r, 3000));

        // --- DEBUG 4: Tela de Filtros ---
        if(await checkDebug(page, debugStep, '4', res, browser, imagePath)) return;

        console.log('[Insta] Next 2 (Filtros)...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        if(!next2) next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if (!next2) return await abortWithProof(page, 'Travou nos Filtros.');
        console.log('[Insta] Tela final. Aguardando campo...');
        await new Promise(r => setTimeout(r, 6000)); 

        // --- DEBUG 5: A HORA DA VERDADE (Antes de digitar) ---
        // Use este para ver se o campo de texto existe na tela
        if(await checkDebug(page, debugStep, '5', res, browser, imagePath)) return;

        // --- LEGENDA (Método Clipboard V13) ---
        if (legenda && legenda.trim().length > 0) {
            console.log('[Insta] Tentando colar legenda...');
            try {
                const selectors = ['div[aria-label="Write a caption..."]', 'div[aria-label="Escreva uma legenda..."]', 'div[role="textbox"]'];
                let textArea = null;
                for (const sel of selectors) {
                    try { textArea = await page.waitForSelector(sel, { visible: true, timeout: 3000 }); if (textArea) break; } catch(e){}
                }

                if (textArea) {
                    await textArea.click(); await new Promise(r => setTimeout(r, 1000));
                    await page.evaluate((text) => { navigator.clipboard.writeText(text); }, legenda);
                    await new Promise(r => setTimeout(r, 500));
                    await page.keyboard.down('Control'); await page.keyboard.press('V'); await page.keyboard.up('Control');
                    console.log('[Insta] CTRL+V executado.');
                    await new Promise(r => setTimeout(r, 2000));
                } else { console.log('[Insta] ERRO: Campo de legenda não achado visualmente.'); }
            } catch(e) { console.log(`[Insta] ERRO CRÍTICO NA LEGENDA: ${e.message}`); }
        }

        // --- DEBUG 6: TIRA-TEIMA (Depois de digitar) ---
        // Use este para ver se o texto apareceu depois do CTRL+V
        if(await checkDebug(page, debugStep, '6', res, browser, imagePath)) return;

        console.log('[Insta] Compartilhando...');
        let share = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!share) share = await clickByText(page, ['Share', 'Compartilhar'], 'button');

        if (share) {
            console.log('[Insta] Postando (Aguarde 20s)...');
            await new Promise(r => setTimeout(r, 20000)); 
            console.log('[Insta] SUCESSO (Provável)!');
            const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': finalImg.length });
            res.end(finalImg);
        } else { return await abortWithProof(page, 'Botão Compartilhar sumiu.'); }

    } catch (error) {
        if (page && !page.isClosed()) await abortWithProof(page, error.message);
        else if (!res.headersSent) res.status(500).json({ erro: error.message });
    } finally {
        if (browser && !browser.isConnected()) await browser.close().catch(()=>{});
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
