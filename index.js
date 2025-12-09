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

const server = app.listen(PORT, () => console.log(`Super Bot V12 (Debug & Precision) rodando na porta ${PORT} 🛡️`));
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
app.get('/', (req, res) => res.send('Super Bot V12 Online 🛡️'));

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
    // ... (Código do LinkedIn mantido igual para economizar espaço, se precisar me avise) ...
    // Vou focar na correção do Instagram abaixo
    res.status(200).send("Use a rota /instagram"); 
});

// ==========================================
// ROTA 2: INSTAGRAM (V12 - PASSO A PASSO DEBUGADO)
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
        console.log('--- INICIANDO INSTAGRAM (V12) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        // 1. DIAGNÓSTICO DE ENTRADA
        if (!legenda) console.log('⚠️ [ALERTA] A variável "legenda" chegou VAZIA ou UNDEFINED. Verifique o n8n!');
        else console.log(`[Insta] Legenda recebida (${legenda.length} caracteres).`);

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

        console.log('[Insta] Acessando Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // Limpeza de Popups
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);
        
        // --- ABRIR CRIAÇÃO ---
        console.log('[Insta] Abrindo Modal Criar...');
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
        
        console.log('[Insta] Arquivo enviado. Esperando Crop...');
        await new Promise(r => setTimeout(r, 5000));

        // --- NAVEGAÇÃO 1: CROP -> FILTROS ---
        console.log('[Insta] Passo 1: Crop -> Filtros (Clicando em Next)...');
        // Botão Next geralmente fica no topo direito do modal
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]'); 
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        
        if (!next1) return await abortWithProof(page, 'Travou na tela de corte (Crop).');
        await new Promise(r => setTimeout(r, 3000)); // Espera animação

        // --- NAVEGAÇÃO 2: FILTROS -> LEGENDA ---
        console.log('[Insta] Passo 2: Filtros -> Legenda (Clicando em Next)...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        if(!next2) next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        
        if (!next2) return await abortWithProof(page, 'Travou
