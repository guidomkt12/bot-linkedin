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

const server = app.listen(PORT, () => console.log(`Bot V28 (Híbrido Imagem V26 + Texto V27) rodando na porta ${PORT} 🧬`));
server.setTimeout(600000);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

app.get('/', (req, res) => res.send('Bot V28 Online 🧬'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;
    const screenshots = [];

    // Função Paparazzi para debug
    const captureStep = async (p, stepName) => {
        try {
            const imgBuffer = await p.screenshot({ encoding: 'base64', fullPage: true });
            screenshots.push({ step: stepName, img: `data:image/jpeg;base64,${imgBuffer}`, time: new Date().toLocaleTimeString() });
            
            const url = await p.url();
            if (url.includes('login') || url.includes('signup')) throw new Error(`SESSÃO CAIU em: ${stepName}`);
        } catch (e) { throw e; }
    };

    try {
        console.log('--- INICIANDO V28 (HÍBRIDO) ---');
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
        await captureStep(page, '1. Chegada');

        // --- GARANTIR MODAL ABERTO ---
        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('Abrindo modal...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { 
                await btn.click(); 
                await new Promise(r => setTimeout(r, 3000));
            } else {
                await captureStep(page, 'ERRO: Modal não abriu');
                throw new Error('Modal falhou.');
            }
        }
        await captureStep(page, '2. Modal Aberto');

        // --- 1. IMAGEM (ESTRATÉGIA V26 - SYNTHETIC PASTE) ---
        if (imagePath) {
            console.log('🧪 Iniciando Synthetic Paste da Imagem...');
            
            // Lê a imagem em Base64
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = imgBuffer.toString('base64');
            const mimeType = 'image/jpeg';

            // Executa script de injeção de evento
            const pasteResult = await page.evaluate(async (selector, base64, mime) => {
                try {
                    const target = document.querySelector(selector);
                    if (!target) return 'Editor não encontrado';

                    const byteCharacters = atob(base64);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: mime });
                    const file = new File([blob], "upload.jpg", { type: mime });

                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);

                    const pasteEvent = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dataTransfer
                    });

                    target.focus();
                    target.dispatchEvent(pasteEvent);
                    
                    return 'SUCCESS';
                } catch (err) { return err.toString(); }
            }, editorSelector, imgBase64, mimeType);

            console.log(`Resultado Paste: ${pasteResult}`);
            if (pasteResult !== 'SUCCESS') throw new Error('Falha no script de colar imagem.');

            console.log('Aguardando processamento da imagem...');
            try {
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                console.log('✅ Imagem colada com sucesso!');
                await captureStep(page, '3. Imagem Colada');
            } catch (e) {
                await captureStep(page, 'ERRO: Imagem não carregou');
                throw new Error('Timeout imagem.');
            }
        }

        // --- 2. TEXTO (ESTRATÉGIA V27 - DOM INJECTION) ---
        if (texto) {
            console.log('📝 Injetando texto (Append Mode)...');
            try {
                await page.evaluate((sel, txt) => {
                    const editor = document.querySelector(sel);
                    // Cria parágrafo
                    const p = document.createElement('p');
                    p.innerText = txt; // Texto bruto
                    
                    // Adiciona quebra de linha antes para garantir que não fique em cima da foto
                    const br = document.createElement('br');
                    editor.appendChild(br);
                    editor.appendChild(p);
                    
                    // Força evento de input para o LinkedIn salvar
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                }, editorSelector, texto);
                
                await new Promise(r => setTimeout(r, 1000));
                console.log('Texto injetado!');
                await captureStep(page, '4. Texto Injetado');
            } catch(e) {
                console.log('Erro texto: ' + e.message);
            }
        }

        // --- 3. PUBLICAR ---
        console.log('🚀 Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        if (await page.evaluate(el => el.disabled, btnPost)) {
            await captureStep(page, 'ERRO: Botão Travado');
            throw new Error('Botão des
