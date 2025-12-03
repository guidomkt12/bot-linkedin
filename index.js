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

const server = app.listen(PORT, () => console.log(`Bot V24 (Texto Primeiro) rodando na porta ${PORT} ⚡`));
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

app.get('/', (req, res) => res.send('Bot V24 Online 📝'));

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

    const checkSession = async (p) => {
        const url = await p.url();
        if (url.includes('login') || url.includes('signup')) throw new Error('SESSÃO CAIU.');
    };

    try {
        console.log('--- INICIANDO V24 (TEXTO PRIMEIRO) ---');
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
        // Timeout longo para garantir carregamento
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao entrar.'); }

        // --- GARANTIR MODAL (Estratégia Redundante) ---
        console.log('Verificando modal...');
        const editorSelector = '.ql-editor, div[role="textbox"]';
        
        // Se não achar o editor, tenta clicar no botão de abrir
        if (!await page.$(editorSelector)) {
            console.log('Editor não visível. Clicando no botão...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { 
                await btn.click(); 
                await new Promise(r => setTimeout(r, 3000));
            } else {
                return await abortWithProof(page, 'Não achei botão nem editor.');
            }
        }

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado no modal.'); }

        // --- 1. INJETAR TEXTO (PRIORIDADE) ---
        if (texto) {
            console.log('📝 Injetando texto via DOM...');
            try {
                // Foca na caixa primeiro
                await page.click(editorSelector).catch(() => {});
                await new Promise(r => setTimeout(r, 500));

                // MÉTODO INFALÍVEL: Injeta o HTML direto no elemento
                // Isso ignora qualquer bloqueio de teclado/cola
                await page.evaluate((sel, txt) => {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.innerHTML = `<p>${txt}</p>`; // Formato que o LinkedIn aceita
                        el.dispatchEvent(new Event('input', { bubbles: true })); // Avisa que mudou
                    } else {
                        throw new Error('Elemento de texto sumiu.');
                    }
                }, editorSelector, texto);
                
                console.log('📝 Texto injetado.');
                await new Promise(r => setTimeout(r, 1000)); // Espera LinkedIn reconhecer
            } catch(e) {
                console.log('Erro na injeção de texto: ' + e.message);
                return await abortWithProof(page, 'Falha ao escrever texto.');
            }
        }

        // --- 2. UPLOAD (Agora que o texto já está lá) ---
        if (imagePath) {
            console.log('📸 Tentando upload...');
            try {
                // Tenta achar qualquer input file
                let fileInput = await page.$('input[type="file"]');
                
                // Se não achar, tenta clicar no botão de imagem para gerar o input
                if (!fileInput) {
                    console.log('Input invisível. Clicando no ícone de imagem...');
                    const imgBtn = await page.$('button[aria-label="Adicionar mídia"], button[aria-label="Add media"]');
                    if (imgBtn) {
                        await imgBtn.click();
                        await new Promise(r => setTimeout(r, 1000));
                        fileInput = await page.$('input[type="file"]');
                    }
                }

                if (fileInput) {
                    // TRUQUE: Torna o input visível à força para garantir que o Puppeteer consiga interagir
                    await page.evaluate((el) => {
                        el.style.display = 'block';
                        el.style.visibility = 'visible';
                        el.style.position = 'fixed';
                        el.style.zIndex = '9999';
                        el.style.top = '0';
                        el.style.left = '0';
                    }, fileInput);

                    console.log('Enviando arquivo...');
                    await fileInput.uploadFile(imagePath);
                    
                    // Espera preview
                    await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 45000 });
                    console.log('📸 Imagem carregada!');
                } else {
                    console.log('Input de arquivo não encontrado de jeito nenhum.');
                    // Não aborta, tenta postar só o texto
                }
            } catch (e) {
                console.log('Erro no upload (Seguindo só com texto): ' + e.message);
            }
        }

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado antes de publicar.'); }

        // --- 3. PUBLICAR ---
        console.log('🚀 Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se habilitado
        const disabled = await page.evaluate(el => el.disabled, btnPost);
        if (disabled) return await abortWithProof(page, 'Botão publicar bloqueado (LinkedIn não validou o texto/foto).');

        await btnPost.click();
        await new Promise(r => setTimeout(r, 8000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Caiu ao finalizar.'); }

        console.log('✅ SUCESSO V24!');
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
