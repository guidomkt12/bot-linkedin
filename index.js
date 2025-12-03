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

const server = app.listen(PORT, () => console.log(`Bot V20 (Upload Moderno) rodando na porta ${PORT} ⚡`));
server.setTimeout(600000);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Função Download
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
app.get('/', (req, res) => res.send('Bot V20 Online 🖼️'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função abortar com print
    const abortWithProof = async (p, msg) => {
        console.error(`❌ ERRO: ${msg}`);
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length, 'X-Error-Msg': msg });
            res.end(imgBuffer);
        } catch (e) { res.status(500).json({ erro: msg }); }
    };

    // Checar sessão
    const checkSession = async (p) => {
        const url = await p.url();
        if (url.includes('login') || url.includes('signup')) throw new Error('SESSÃO CAIU.');
    };

    try {
        console.log('--- INICIANDO V20 (UPLOAD MODERNO + COLAR TEXTO) ---');
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
        await new Promise(r => setTimeout(r, 5000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao entrar.'); }

        // Garantir Modal Aberto
        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('Modal fechado. Clicando para abrir...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { await btn.click(); await new Promise(r => setTimeout(r, 3000)); }
        }
        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao abrir modal.'); }

        // --- UPLOAD V20 (O INTERCEPTADOR) ---
        if (imagePath) {
            console.log('📸 UPLOAD V20: Preparando...');
            
            // 1. Prepara o interceptador de arquivos
            const fileChooserPromise = page.waitForFileChooser({ timeout: 15000 });
            
            // 2. Clica no botão de imagem (ícone)
            const iconSelectors = [
                'button[aria-label="Adicionar mídia"]', 
                'button[aria-label="Add media"]',
                'svg[data-test-icon="image-medium"]', // Ícone direto
                'button.share-promoted-detour-button' // Botão genérico de mídia
            ];
            
            let clickedIcon = false;
            for (const sel of iconSelectors) {
                const el = await page.$(sel);
                // Verifica se o botão está visível e dentro do modal
                if (el && await el.boundingBox()) {
                    console.log(`Clicando no ícone de imagem: ${sel}`);
                    await el.click();
                    clickedIcon = true;
                    break;
                }
            }

            if (!clickedIcon) {
                // Tenta clicar por coordenadas no canto inferior esquerdo do modal (último recurso)
                console.log('Ícones falharam. Tentando clique genérico na área de mídia...');
                try { await page.mouse.click(300, 500); } catch(e) {}
            }

            try {
                // 3. Espera o interceptador pegar o diálogo
                console.log('Aguardando diálogo de arquivo...');
                const fileChooser = await fileChooserPromise;
                console.log('Diálogo interceptado! Enviando imagem...');
                // 4. Entrega a imagem
                await fileChooser.accept([imagePath]);
                
                // 5. Espera preview
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                console.log('📸 UPLOAD: Sucesso! Preview carregado.');
            } catch (e) {
                return await abortWithProof(page, 'Falha no Upload V20: ' + e.message);
            }
        }

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado após upload.'); }

        // --- TEXTO (COLAR) ---
        if (texto) {
            console.log('📝 TEXTO: Colando...');
            try {
                await page.click(editorSelector);
                await new Promise(r => setTimeout(r, 500));
                await page.evaluate((txt) => document.execCommand('insertText', false, txt), texto);
            } catch(e) { console.log('Erro ao colar: ' + e.message); }
        }

        // --- PUBLICAR ---
        console.log('🚀 PUBLICAR...');
        await new Promise(r => setTimeout(r, 2000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        if (await page.evaluate(el => el.disabled, btnPost)) return await abortWithProof(page, 'Botão publicar desabilitado.');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao publicar.'); }

        console.log('✅ SUCESSO V20!');
        const imgBuffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length });
        res.end(imgBuffer);

    } catch (error) {
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
