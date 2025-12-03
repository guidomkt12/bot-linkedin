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

// Servidor com timeout alto
const server = app.listen(PORT, () => console.log(`Bot V15 (Paparazzi) rodando na porta ${PORT} 📸`));
server.setTimeout(600000);

// Middleware para HTML e JSON
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
app.get('/', (req, res) => res.send('Bot V15 Online - Modo Paparazzi Ativado 📸'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;
    
    // Array para guardar os prints da história
    const screenshots = [];

    // Função para tirar print e checar sessão
    const captureStep = async (p, stepName) => {
        try {
            // Tira print em Base64
            const imgBuffer = await p.screenshot({ encoding: 'base64', fullPage: true });
            screenshots.push({
                step: stepName,
                img: `data:image/jpeg;base64,${imgBuffer}`,
                time: new Date().toLocaleTimeString()
            });

            // CHECAGEM DE QUEDA
            const url = await p.url();
            const title = await p.title();
            console.log(`[${stepName}] URL: ${url} | Título: ${title}`);

            if (url.includes('login') || url.includes('signup') || url.includes('checkpoint') || title.includes('Entrar') || title.includes('Sign')) {
                throw new Error(`⛔ SESSÃO CAIU durante: ${stepName}. O LinkedIn desconectou.`);
            }
        } catch (e) {
            throw e; // Repassa erro para parar tudo
        }
    };

    try {
        console.log('--- INICIANDO V15 ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        // 1. Download
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) { console.error('Erro download img'); }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('Sem cookies, sem chance.');

        // 2. Browser
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--window-size=1280,800',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 30000
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 3. Cookies
        console.log('Aplicando cookies...');
        try {
            const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
            if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);
        } catch (e) {}

        // 4. Navegação (Momento Crítico)
        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 5000));
        
        // FOTO 1: Chegada na Página
        await captureStep(page, '1. Chegada na Página');

        // 5. Busca Botão
        console.log('Buscando botão...');
        const selectors = ['button.share-box-feed-entry__trigger', 'div.share-box-feed-entry__trigger', 'button[aria-label="Começar publicação"]', 'button[aria-label="Start a post"]'];
        let found = false;
        
        for (const sel of selectors) {
            const el = await page.$(sel);
            if (el) {
                await el.click();
                found = true;
                break;
            }
        }

        if (!found) {
            // Tenta texto
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && (text.includes('Começar') || text.includes('Start'))) {
                    await btn.click(); found = true; break;
                }
            }
        }

        // FOTO 2: Após tentar clicar
        await captureStep(page, found ? '2. Clique no Botão (Sucesso)' : '2. Falha ao achar botão');
        
        if (!found) throw new Error('Não achei o botão de postar.');

        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });

        // 6. Upload
        if (imagePath) {
            console.log('Upload...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
            await input.uploadFile(imagePath);
            await captureStep(page, '3. Arquivo enviado ao input');
            
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));
            await captureStep(page, '4. Preview Carregado');
        }

        // 7. Texto
        if (texto) {
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // FOTO 5: Tudo pronto para postar
        await captureStep(page, '5. Pronto para Publicar');

        // 8. Publicar
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        // FOTO FINAL
        await captureStep(page, '6. Resultado Final');

        // GERA RELATÓRIO HTML
        const html = generateReport(screenshots, 'SUCESSO', 'O post foi enviado.');
        res.send(html);

    } catch (error) {
        console.error('ERRO:', error.message);
        // Tenta tirar um último print do erro
        if (page) {
            try {
                const imgBuffer = await page.screenshot({ encoding: 'base64', fullPage: true });
                screenshots.push({ step: 'ERRO FATAL: ' + error.message, img: `data:image/jpeg;base64,${imgBuffer}`, time: new Date().toLocaleTimeString() });
            } catch(e) {}
        }
        
        const html = generateReport(screenshots, 'ERRO', error.message);
        res.status(200).send(html); // Manda 200 para o n8n mostrar o HTML
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});

// Helper para gerar o HTML bonitinho
function generateReport(shots, status, msg) {
    const color = status === 'SUCESSO' ? '#4CAF50' : '#F44336';
    return `
    <html>
        <head>
            <style>
                body { font-family: sans-serif; background: #f0f0f0; padding: 20px; }
                .card { background: white; padding: 15px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                h1 { color: ${color}; }
                img { max-width: 100%; border: 1px solid #ddd; margin-top: 10px; }
                .step-title { font-weight: bold; font-size: 1.1em; }
                .timestamp { color: #888; font-size: 0.8em; }
            </style>
        </head>
        <body>
            <h1>Status: ${status}</h1>
            <p>${msg}</p>
            <hr>
            ${shots.map(s => `
                <div class="card">
                    <div class="step-title">${s.step}</div>
                    <div class="timestamp">${s.time}</div>
                    <img src="${s.img}" />
                </div>
            `).join('')}
        </body>
    </html>
    `;
}
