const express = require('express');
// Importa o Puppeteer com Stealth (Camuflagem)
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

// Configuração do Multer (Upload)
const upload = multer({ dest: '/tmp/uploads/' });

// Inicia servidor com timeout alto
const server = app.listen(PORT, () => console.log(`Bot V14 Rodando na porta ${PORT} 🟢`));
server.setTimeout(600000); // 10 min

// Middleware para aceitar JSON grande
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rota de teste
app.get('/', (req, res) => res.send('Bot V14 Online!'));

// Função para baixar imagem
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

// Rota Principal
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // Configura timeout da requisição
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    try {
        console.log('--- INICIANDO PROCESSO V14 ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;

        // 1. Baixar imagem se for URL
        if (!imagePath && imagemUrl) {
            try {
                console.log('Baixando imagem...');
                imagePath = await downloadImage(imagemUrl);
            } catch (e) { console.error('Erro no download:', e.message); }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('ERRO: Cookies são obrigatórios.');

        // 2. Abrir Navegador
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: { width: 1920, height: 1080 },
            timeout: 0
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 3. Injetar Cookies
        console.log('Aplicando cookies...');
        try {
            const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
            if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);
        } catch (e) { console.log('Aviso nos cookies:', e.message); }

        // 4. Navegar
        console.log(`Indo para: ${paginaUrl}`);
        // Timeout de navegação de 1 minuto para não travar
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // 5. Checar se estamos logados
        const title = await page.title();
        console.log(`Título da página: ${title}`);
        
        if (title.includes('Login') || title.includes('Sign') || title.includes('Entrar')) {
            throw new Error(`SESSÃO CAIU! Título: ${title}. Pegue novos cookies.`);
        }

        // 6. Clicar no botão (Tenta seletor, depois texto)
        console.log('Buscando botão de postar...');
        let found = false;

        // Tenta seletores conhecidos
        const selectors = [
            'button.share-box-feed-entry__trigger',
            'div.share-box-feed-entry__trigger', 
            'button[aria-label="Start a post"]',
            'button[aria-label="Começar publicação"]'
        ];
        
        for (const sel of selectors) {
            const el = await page.$(sel);
            if (el) { await el.click(); found = true; break; }
        }

        // Se falhar, tenta texto bruto
        if (!found) {
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && (text.includes('Começar') || text.includes('Start'))) {
                    await btn.click(); found = true; break;
                }
            }
        }

        if (!found) throw new Error(`Botão de postar não encontrado. Veja o print.`);

        await new Promise(r => setTimeout(r, 3000));

        // 7. Upload Imagem
        if (imagePath) {
            console.log('Subindo imagem...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
            await input.uploadFile(imagePath);
            // Espera preview (Timeout longo para internet lenta)
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 90000 });
            console.log('Imagem carregada.');
            await new Promise(r => setTimeout(r, 2000));
        }

        // 8. Texto
        if (texto) {
            console.log('Escrevendo...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // 9. Publicar
        console.log('Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 10000));

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado V14!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        // Tira Print do erro e manda pro n8n
        if (page) {
            try {
                const imgErro = await page.screenshot({ fullPage: true, encoding: 'base64' });
                const imgBuffer = Buffer.from(imgErro, 'base64');
                
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': imgBuffer.length,
                    'X-Error-Message': error.message
                });
                res.end(imgBuffer);
            } catch (e) {
                res.status(500).json({ erro: error.message });
            }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
