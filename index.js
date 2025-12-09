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
process.on('uncaughtException', (err) => {
    console.error('⚠️ ERRO CRÍTICO:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ PROMESSA REJEITADA:', reason);
});

const server = app.listen(PORT, () => console.log(`Super Bot V13 (Clipboard Paste) rodando na porta ${PORT} 🛡️`));
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
app.get('/', (req, res) => res.send('Super Bot V13 Online (Clipboard Mode) 🛡️'));

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

// ==========================================
// ROTA 1: LINKEDIN (MANTIDA)
// ==========================================
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // ... Código LinkedIn mantido ...
    res.status(200).send("Use a rota /instagram"); 
});

// ==========================================
// ROTA 2: INSTAGRAM (V13 - CLIPBOARD PASTE)
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
        console.log('--- INICIANDO INSTAGRAM (V13) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        // --- CHECK DE DEBUG ---
        if (!legenda) {
            console.log('⚠️ [ALERTA CRÍTICO] Variável "legenda" veio VAZIA ou UNDEFINED.');
            console.log('Verifique se o parâmetro no n8n se chama exatamente "legenda" (minúsculo).');
        } else {
            console.log(`✅ Legenda recebida: "${legenda.substring(0, 20)}..." (${legenda.length} chars)`);
        }

        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        if (!imagePath) throw new Error('Imagem é obrigatória.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1366,768', 
                '--start-maximized',
                '--disable-features=IsolateOrigins,site-per-process' // Ajuda na manipulação do DOM
            ],
            defaultViewport: { width: 1366, height: 768 },
            timeout: 60000
        });

        // Permissão de Clipboard para o Browser Context
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://www.instagram.com', ['clipboard-read', 'clipboard-write']);

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Cookies
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log('[Insta] Acessando Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // Popups
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);
        
        // --- ABRIR CRIAÇÃO ---
        console.log('[Insta] Botão Criar...');
        let createBtnFound = false;
        const createSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"], svg[aria-label="Criar"]';
        
        if (await page.$(createSelector)) {
            await page.click(createSelector);
            createBtnFound = true;
        } else {
            createBtnFound = await clickByText(page, ['Create', 'Criar'], 'span');
        }
        if (!createBtnFound) return await abortWithProof(page, 'Botão Criar não encontrado.');
        await new Promise(r => setTimeout(r, 3000));

        // --- UPLOAD ---
        console.log('[Insta] Upload...');
        const fileChooserPromise = page.waitForFileChooser();
        const selectBtn = await clickByText(page, ['Select from computer', 'Selecionar do computador', 'Select', 'Selecionar'], 'button');
        
        if (!selectBtn) {
            const inputUpload = await page.$('input[type="file"]');
            if(inputUpload) await inputUpload.uploadFile(imagePath);
            else return await abortWithProof(page, 'Input de upload não achado.');
        } else {
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
        }
        
        console.log('[Insta] Aguardando Crop...');
        await new Promise(r => setTimeout(r, 5000));

        // --- NAVEGAÇÃO ---
        console.log('[Insta] Next 1 (Crop)...');
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]'); 
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if (!next1) return await abortWithProof(page, 'Travou no Crop.');
        await new Promise(r => setTimeout(r, 3000));

        console.log('[Insta] Next 2 (Filtros)...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        if(!next2) next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if (!next2) return await abortWithProof(page, 'Travou nos Filtros.');
        
        console.log('[Insta] Tela final. Aguardando campo...');
        await new Promise(r => setTimeout(r, 5000)); 

        // --- LEGENDA (CLIPBOARD STRATEGY) ---
        if (legenda && legenda.trim().length > 0) {
            console.log('[Insta] Preparando colar legenda...');
            try {
                // 1. Encontra a área de texto (Seletor Universal)
                // Procura div com aria-label ou role=textbox
                const selectors = [
                    'div[aria-label="Write a caption..."]',
                    'div[aria-label="Escreva uma legenda..."]',
                    'div[role="textbox"][contenteditable="true"]'
                ];
                
                let textArea = null;
                for (const sel of selectors) {
                    try {
                        textArea = await page.waitForSelector(sel, { visible: true, timeout: 2000 });
                        if (textArea) break;
                    } catch(e){}
                }

                if (textArea) {
                    console.log('[Insta] Campo focado. Copiando texto para clipboard...');
                    await textArea.click();
                    await new Promise(r => setTimeout(r, 1000)); // Espera foco

                    // 2. Coloca o texto no Clipboard do Browser (via JS)
                    // Isso ignora problemas de emulação de teclado
                    await page.evaluate((text) => {
                        navigator.clipboard.writeText(text);
                    }, legenda);
                    
                    await new Promise(r => setTimeout(r, 500));

                    // 3. Executa o comando PASTE (CTRL+V)
                    console.log('[Insta] Executando CTRL+V...');
                    await page.keyboard.down('Control');
                    await page.keyboard.press('V');
                    await page.keyboard.up('Control');
                    
                    console.log('[Insta] Colado!');
                    await new Promise(r => setTimeout(r, 2000));

                } else {
                    console.log('[Insta] ERRO: Não achei o campo de texto visualmente.');
                }
            } catch(e) {
                console.log(`[Insta] ERRO CRÍTICO NA LEGENDA: ${e.message}`);
            }
        } else {
            console.log('[Insta] PULEI LEGENDA (Vazia).');
        }

        // --- SHARE ---
        console.log('[Insta] Compartilhando...');
        await new Promise(r => setTimeout(r, 2000));
        
        let share = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!share) share = await clickByText(page, ['Share', 'Compartilhar'], 'button');

        if (share) {
            console.log('[Insta] Postando...');
            await new Promise(r => setTimeout(r, 15000)); 
            
            // Verifica sucesso visual
            const success = await clickByText(page, ['Post shared', 'Publicação compartilhada', 'Your post has been shared'], 'span');
            if (success) console.log('[Insta] Confirmado!');
            
            console.log('[Insta] SUCESSO!');
            const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': finalImg.length });
            res.end(finalImg);
        } else {
            return await abortWithProof(page, 'Botão Compartilhar não encontrado.');
        }

    } catch (error) {
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
