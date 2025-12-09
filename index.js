const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// Removemos o KnownDevices pois não vamos mais emular celular
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

const server = app.listen(PORT, () => console.log(`Super Bot V9 (Desktop Mode) rodando na porta ${PORT} 🛡️`));
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
app.get('/', (req, res) => res.send('Super Bot V9 Online (Desktop Logic) 🛡️'));

// --- FUNÇÃO AUXILIAR: CLIQUE POR TEXTO (ROBUSTA) ---
async function clickByText(page, textsToFind, tag = '*') {
    try {
        return await page.evaluate((texts, tagName) => {
            // Procura em botões, spans, divs e a (links)
            const elements = [...document.querySelectorAll(tagName)];
            for (const el of elements) {
                // Pega texto visível ou aria-label
                const txt = el.innerText || el.getAttribute('aria-label') || '';
                // Verifica se contem algum dos textos procurados
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
// ROTA 1: LINKEDIN (MANTIDA IGUAL)
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
        console.log('--- INICIANDO LINKEDIN (V9) ---');
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
// ROTA 2: INSTAGRAM (V9 - MODO DESKTOP)
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
        console.log('--- INICIANDO INSTAGRAM (V9 - Desktop) ---');
        const { legenda, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        if (!imagePath) throw new Error('Imagem é obrigatória.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            // Argumentos otimizados para Desktop Linux/Docker
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1366,768', // Resolução de Laptop Comum
                '--start-maximized'
            ],
            defaultViewport: { width: 1366, height: 768 },
            timeout: 60000
        });

        page = await browser.newPage();
        // User Agent de Windows PC para garantir interface Desktop
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        console.log('[Insta] Cookies...');
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log('[Insta] Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // --- 1. LIMPEZA DE POPUPS (DESKTOP) ---
        console.log('[Insta] Verificando notificações...');
        // No desktop, costuma aparecer "Ativar Notificações". Clicamos em "Agora não".
        await clickByText(page, ['Not Now', 'Agora não', 'Agora nao', 'Cancel']);
        await new Promise(r => setTimeout(r, 2000));

        // --- 2. ABRIR MODAL DE CRIAÇÃO ---
        console.log('[Insta] Buscando botão (+) na barra lateral...');
        
        // No desktop, o botão Criar é um item da sidebar esquerda.
        // Procuramos pelo SVG ou pelo Texto "Create"/"Criar"
        let createBtnFound = false;
        
        // Tenta pelo SVG específico do Desktop
        const createSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"], svg[aria-label="Criar"]';
        if (await page.$(createSelector)) {
            await page.click(createSelector);
            createBtnFound = true;
        } else {
            // Fallback: Procura pelo texto "Criar" na sidebar
            createBtnFound = await clickByText(page, ['Create', 'Criar'], 'span');
        }

        if (!createBtnFound) {
            return await abortWithProof(page, 'Não achei o botão Criar da barra lateral.');
        }

        await new Promise(r => setTimeout(r, 3000)); // Espera o Modal abrir

        // --- 3. SELEÇÃO DE ARQUIVO (MODAL) ---
        console.log('[Insta] Modal aberto. Buscando botão "Selecionar do computador"...');
        
        // No desktop, aparece um modal com um botão azul "Select from computer"
        const fileChooserPromise = page.waitForFileChooser();
        
        // Tenta clicar no botão azul pelo texto
        const selectBtn = await clickByText(page, ['Select from computer', 'Selecionar do computador', 'Select', 'Selecionar'], 'button');
        
        if (!selectBtn) {
            // Se não achar o botão texto, tenta achar o input file oculto que o modal cria
            console.log('[Insta] Botão azul não achado. Tentando input direto...');
            const inputUpload = await page.$('input[type="file"]');
            if (inputUpload) {
                await inputUpload.uploadFile(imagePath);
            } else {
                return await abortWithProof(page, 'Botão de upload e input sumiram.');
            }
        } else {
            // Se clicou no botão, espera o seletor
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
        }

        console.log('[Insta] Arquivo carregado! Aguardando crop...');
        await new Promise(r => setTimeout(r, 6000));

        // --- 4. FLUXO "NEXT" -> "NEXT" -> "SHARE" (TOPO DO MODAL) ---
        // No desktop, os botões ficam no cabeçalho do modal (top right do modal)
        
        // Next 1 (Crop)
        console.log('[Insta] Next 1...');
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]'); 
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        
        if (!next1) return await abortWithProof(page, 'Botão Next 1 não encontrado.');
        await new Promise(r => setTimeout(r, 3000));

        // Next 2 (Filtros)
        console.log('[Insta] Next 2...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        if(!next2) next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        await new Promise(r => setTimeout(r, 3000));

        // Legenda
        if (legenda) {
            console.log('[Insta] Escrevendo legenda...');
            try {
                // No desktop a area de texto tem aria-label claro
                const textArea = await page.waitForSelector('div[aria-label="Write a caption..."], div[aria-label="Escreva uma legenda..."]', { timeout: 5000 });
                await textArea.click();
                await textArea.type(legenda, { delay: 30 });
            } catch(e) {
                console.log('[Insta] Erro legenda (não crítico): ' + e.message);
            }
        }

        // Share
        console.log('[Insta] Compartilhando...');
        let share = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!share) share = await clickByText(page, ['Share', 'Compartilhar'], 'button');

        if (share) {
            // Espera a confirmação visual "Your post has been shared"
            await new Promise(r => setTimeout(r, 12000));
            console.log('[Insta] SUCESSO!');
            const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': finalImg.length });
            res.end(finalImg);
        } else {
            return await abortWithProof(page, 'Botão Share sumiu.');
        }

    } catch (error) {
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
