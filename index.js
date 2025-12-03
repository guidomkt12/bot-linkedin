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

const server = app.listen(PORT, () => console.log(`Bot V17 (Direto no Modal) rodando na porta ${PORT} ⚡`));
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

// Rota para ver se está vivo
app.get('/', (req, res) => res.send('Bot V17 Online 🎯'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função de Print de Evidência
    const sendEvidence = async (p, headerMsg) => {
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': imgBuffer.length,
                'X-Status-Msg': headerMsg
            });
            res.end(imgBuffer);
        } catch (e) {
            res.status(500).json({ erro: 'Falha ao gerar imagem.' });
        }
    };

    try {
        console.log('--- INICIANDO V17 (DIRETO NO MODAL) ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;

        // 1. Download
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        // 2. Navegador
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 30000
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 3. Cookies
        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        // 4. Navegação
        console.log(`Indo para: ${paginaUrl}`);
        // Timeout maior caso a página demore
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Verifica queda de sessão
        const urlNow = await page.url();
        if (urlNow.includes('login') || urlNow.includes('signup')) {
            console.log('Caiu no login.');
            await sendEvidence(page, 'ERRO_LOGIN_DETECTADO');
            return;
        }

        await new Promise(r => setTimeout(r, 5000));

        // 5. CHECAGEM INTELIGENTE: O modal já está aberto?
        console.log('Verificando se o modal já está na tela...');
        let modalOpen = false;
        
        // Procura pela caixa de texto ou pelo container do modal
        try {
            // Tenta achar direto a caixa de texto
            await page.waitForSelector('.ql-editor, div[role="textbox"]', { timeout: 5000 });
            console.log('Modal JÁ ABERTO detectado! Pulando clique.');
            modalOpen = true;
        } catch (e) {
            console.log('Modal não detectado de imediato. Tentando clicar no botão...');
        }

        // Se não estiver aberto, clica no botão (Fallback)
        if (!modalOpen) {
            const selectors = ['button.share-box-feed-entry__trigger', 'div.share-box-feed-entry__trigger', 'button[aria-label="Começar publicação"]'];
            for (const sel of selectors) {
                const el = await page.$(sel);
                if (el) { await el.click(); modalOpen = true; break; }
            }
            if (modalOpen) await new Promise(r => setTimeout(r, 3000));
        }

        // Tenta focar no editor de novo
        if (modalOpen) {
            try {
                await page.waitForSelector('.ql-editor, div[role="textbox"]', { timeout: 10000 });
            } catch(e) {
                console.log('Não achei a caixa de texto. Enviando print do que estou vendo.');
                await sendEvidence(page, 'ERRO_NAO_ACHEI_CAIXA_TEXTO');
                return;
            }
        } else {
             await sendEvidence(page, 'ERRO_MODAL_NAO_ABRIU');
             return;
        }

        // 6. UPLOAD
        if (imagePath) {
            console.log('Upload...');
            // Tenta clicar no botão de imagem se ele estiver visível
            const imgBtn = await page.$('button[aria-label="Adicionar mídia"], button[aria-label="Add media"]');
            if (imgBtn) await imgBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
            await input.uploadFile(imagePath);
            // Espera preview
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 90000 });
            console.log('Imagem OK.');
        }

        // 7. TEXTO
        if (texto) {
            console.log('Escrevendo...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // 8. PUBLICAR
        console.log('Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se habilitado
        const disabled = await page.evaluate(el => el.disabled, btnPost);
        if (disabled) await new Promise(r => setTimeout(r, 3000));

        await btnPost.click();
        await new Promise(r => setTimeout(r, 8000));

        console.log('SUCESSO!');
        await sendEvidence(page, 'SUCESSO_POSTADO');

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) await sendEvidence(page, 'ERRO_GERAL_' + error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
