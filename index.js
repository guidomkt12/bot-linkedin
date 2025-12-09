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

const server = app.listen(PORT, () => console.log(`Super Bot V15 (CDP Protocol) rodando na porta ${PORT} 🛡️`));
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
app.get('/', (req, res) => res.send('Super Bot V15 Online (CDP) 🛡️'));

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
// ROTA 2: INSTAGRAM (V15 - PROTOCOLO CDP)
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
        console.log('--- INICIANDO INSTAGRAM (V15 - CDP) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        // Debug Entrada
        if (!legenda) console.log('⚠️ AVISO: Legenda VAZIA no body!');
        else console.log(`✅ Legenda recebida: ${legenda.length} chars.`);

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
                '--window-size=1366,900', // Altura maior para ver a caixa
                '--start-maximized'
            ],
            defaultViewport: { width: 1366, height: 900 },
            timeout: 60000
        });

        page = await browser.newPage();
        const client = await page.target().createCDPSession(); // Cria sessão de baixo nível

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
        await new Promise(r => setTimeout(r, 6000));

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
        
        console.log('[Insta] Tela final. Aguardando renderização...');
        await new Promise(r => setTimeout(r, 6000)); 

        // --- LEGENDA (CDP PROTOCOL) ---
        if (legenda && legenda.trim().length > 0) {
            console.log('[Insta] Iniciando Protocolo CDP...');
            
            // 1. Tenta encontrar a div exata
            const captionSelector = 'div[role="dialog"] div[contenteditable="true"]';
            let textArea = await page.$(captionSelector);
            
            if (!textArea) {
                console.log('[Insta] Seletor padrão falhou. Tentando clique por coordenada...');
                // Clica na região onde a legenda costuma ficar (lado direito do modal)
                // O modal é centralizado. Vamos tentar clicar e ver se foca.
                await page.mouse.click(900, 300); 
            } else {
                console.log('[Insta] Campo detectado. Clicando...');
                await textArea.click();
            }
            
            await new Promise(r => setTimeout(r, 1000)); // Espera foco

            // 2. DEBUG: O que tem dentro do modal agora?
            const modalHTML = await page.evaluate(() => {
                const m = document.querySelector('div[role="dialog"]');
                return m ? m.innerHTML.substring(0, 200) + '...' : 'SEM MODAL';
            });
            console.log(`[Insta HTML Debug]: ${modalHTML}`);

            // 3. DIGITAÇÃO VIA CDP (Baixo Nível)
            console.log('[Insta] Enviando keystrokes via CDP...');
            
            // Envia cada letra como um evento de hardware
            for (const char of legenda) {
                await client.send('Input.dispatchKeyEvent', {
                    type: 'char',
                    text: char
                });
                // Delay minúsculo para não travar
                await new Promise(r => setTimeout(r, 10));
            }
            
            console.log('[Insta] Digitação CDP finalizada.');
            await new Promise(r => setTimeout(r, 2000));
            
            // VERIFICAÇÃO VISUAL (Salvando no log se falhar)
            const finalTextCheck = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.innerText : 'ELEMENTO_NAO_ACHADO';
            }, captionSelector);
            console.log(`[Insta] Texto lido no campo: "${finalTextCheck.substring(0, 20)}..."`);

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
            
            const success = await clickByText(page, ['Post shared', 'Publicação compartilhada', 'Your post has been shared'], 'span');
            if (success) console.log('[Insta] Confirmado!');
            
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
        if
