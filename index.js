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

const server = app.listen(PORT, () => console.log(`Bot V26 (Synthetic Paste) rodando na porta ${PORT} 🧪`));
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

app.get('/', (req, res) => res.send('Bot V26 Online 🧪'));

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

    try {
        console.log('--- V26: SYNTHETIC PASTE EVENT ---');
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

        // Checagem Inicial
        const title = await page.title();
        if (title.includes('Login') || title.includes('Sign')) return await abortWithProof(page, 'Caiu no login ao entrar.');

        // --- GARANTIR MODAL ABERTO ---
        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('Abrindo modal...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { await btn.click(); await new Promise(r => setTimeout(r, 3000)); }
        }

        // --- A MÁGICA DA V26: FORJAR O COLAR ---
        if (imagePath) {
            console.log('🧪 Iniciando injeção via Evento Sintético...');
            
            // 1. Lê a imagem em Base64 no Node
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = imgBuffer.toString('base64');
            const mimeType = 'image/jpeg'; // Assumindo JPEG

            // 2. Executa script no navegador para criar o evento
            const pasteResult = await page.evaluate(async (selector, base64, mime) => {
                try {
                    const target = document.querySelector(selector);
                    if (!target) return 'Editor não encontrado';

                    // Converte base64 para Blob
                    const byteCharacters = atob(base64);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: mime });
                    const file = new File([blob], "image.jpg", { type: mime });

                    // Cria o DataTransfer (a "Area de Transferencia Fake")
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);

                    // Cria o evento de colar
                    const pasteEvent = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dataTransfer
                    });

                    // Dispara no elemento
                    target.focus();
                    target.dispatchEvent(pasteEvent);
                    
                    return 'SUCCESS';
                } catch (err) {
                    return err.toString();
                }
            }, editorSelector, imgBase64, mimeType);

            console.log(`Resultado da injeção: ${pasteResult}`);

            if (pasteResult !== 'SUCCESS') {
                return await abortWithProof(page, 'Falha no script de colar: ' + pasteResult);
            }

            // Espera o LinkedIn processar
            console.log('Aguardando LinkedIn processar a "colagem"...');
            try {
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                console.log('✅ Imagem processada com sucesso!');
            } catch (e) {
                return await abortWithProof(page, 'LinkedIn ignorou o evento de colar.');
            }
        }

        // --- TEXTO ---
        if (texto) {
            console.log('📝 Escrevendo texto...');
            try {
                // Injeta texto via DOM (mais seguro que digitar)
                await page.evaluate((sel, txt) => {
                    const el = document.querySelector(sel);
                    // Adiciona o texto sem apagar a imagem (append)
                    const p = document.createElement('p');
                    p.innerText = txt;
                    el.appendChild(p);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }, editorSelector, texto);
            } catch(e) {}
        }

        // --- PUBLICAR ---
        console.log('🚀 Publicando...');
        await new Promise(r => setTimeout(r, 2000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        if (await page.evaluate(el => el.disabled, btnPost)) return await abortWithProof(page, 'Botão desabilitado.');
        
        await btnPost.click();
        await new Promise(r => setTimeout(r, 8000));

        console.log('✅ SUCESSO V26!');
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
