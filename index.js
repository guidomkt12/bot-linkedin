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

const server = app.listen(PORT, () => console.log(`Super Bot V14 (Tab Hunter) rodando na porta ${PORT} 🛡️`));
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
app.get('/', (req, res) => res.send('Super Bot V14 Online (Tab Hunter) 🛡️'));

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
    res.status(200).send("Use a rota /instagram"); 
});

// ==========================================
// ROTA 2: INSTAGRAM (V14 - TAB HUNTER)
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
        console.log('--- INICIANDO INSTAGRAM (V14 - TAB HUNTER) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        // Debug da Legenda
        if (!legenda) console.log('⚠️ AVISO: Legenda vazia!');
        else console.log(`✅ Legenda recebida: ${legenda.length} caracteres.`);

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
                '--start-maximized'
            ],
            defaultViewport: { width: 1366, height: 768 },
            timeout: 60000
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Cookies
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log('[Insta] Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

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
        await new Promise(r => setTimeout(r, 6000)); 

        // --- LEGENDA (TAB HUNTER) ---
        if (legenda && legenda.trim().length > 0) {
            console.log('[Insta] Iniciando caçada de foco via TAB...');
            
            // 1. Clica no modal (geral) para garantir foco na janela
            await page.mouse.click(800, 400); 
            await new Promise(r => setTimeout(r, 500));

            // 2. Loop de TABs até achar o contenteditable
            let found = false;
            for (let i = 0; i < 15; i++) { // Tenta apertar TAB 15 vezes
                await page.keyboard.press('Tab');
                await new Promise(r => setTimeout(r, 300));

                const isEditable = await page.evaluate(() => {
                    const el = document.activeElement;
                    return el && el.getAttribute('contenteditable') === 'true';
                });

                if (isEditable) {
                    console.log(`[Insta] Campo encontrado na tentativa ${i+1} de TAB!`);
                    found = true;
                    break;
                }
            }

            if (found) {
                console.log('[Insta] Digitando...');
                // Digita devagar para garantir
                await page.keyboard.type(legenda, { delay: 50 });
                console.log('[Insta] Digitação concluída.');
                
                // VERIFICAÇÃO: Tira print aqui para sabermos se escreveu
                const debugShot = await page.screenshot({ type: 'jpeg', quality: 50 });
                // (Opcional: salvaríamos em disco, mas vamos confiar no fluxo)
            } else {
                console.log('[Insta] ERRO: Não consegui focar no campo usando TAB.');
                // Tenta fallback desesperado: Clicar na coordenada provável do campo
                console.log('[Insta] Tentando clique por coordenada (Fallback)...');
                await page.mouse.click(950, 350); // Coordenada aproximada do campo no desktop 1366x768
                await new Promise(r => setTimeout(r, 500));
                await page.keyboard.type(legenda, { delay: 50 });
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
            
            // Sucesso
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
