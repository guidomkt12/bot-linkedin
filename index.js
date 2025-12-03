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

// Servidor Rápido
const server = app.listen(PORT, () => console.log(`Bot V16 (Raio-X) rodando na porta ${PORT} ⚡`));
server.setTimeout(300000);

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
app.get('/', (req, res) => res.send('Bot V16 Online ⚡'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // Timeout de 5 min
    req.setTimeout(300000);
    res.setTimeout(300000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função para enviar a foto e encerrar IMEDIATAMENTE
    const sendEvidence = async (p, statusHeader) => {
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 80, fullPage: true });
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': imgBuffer.length,
                'X-Status': statusHeader // Cabeçalho para você ler no n8n se deu erro ou sucesso
            });
            res.end(imgBuffer);
        } catch (e) {
            res.status(500).json({ erro: 'Falha ao gerar imagem: ' + e.message });
        }
    };

    try {
        console.log('--- V16 INICIANDO ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        // 1. Download
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('Sem cookies.');

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
        console.log('Cookies...');
        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        // 4. Navegação (Com Checagem Rápida)
        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // CHECAGEM DE QUEDA IMEDIATA
        const url1 = await page.url();
        if (url1.includes('login') || url1.includes('signup')) {
            console.log('Caiu no login ao entrar.');
            await sendEvidence(page, 'ERRO_LOGIN_INICIAL'); // Manda a foto AGORA
            return; // Para tudo
        }

        // 5. Busca Botão
        console.log('Botão...');
        // Espera o seletor aparecer (máx 10s). Se não aparecer, dá erro e manda foto.
        try {
            const btn = await page.waitForSelector('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Start a post"]', { timeout: 10000 });
            await btn.click();
        } catch (e) {
            console.log('Botão não achado.');
            await sendEvidence(page, 'ERRO_BOTAO_NAO_ENCONTRADO');
            return;
        }

        // 6. Upload
        if (imagePath) {
            console.log('Upload...');
            try {
                const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
                await input.uploadFile(imagePath);
                // Espera preview (Máx 60s)
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
            } catch (e) {
                console.log('Erro no upload.');
                await sendEvidence(page, 'ERRO_UPLOAD_FALHOU');
                return;
            }
        }

        // 7. Texto
        if (texto) {
            try {
                const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]', { timeout: 5000 });
                await editor.click();
                await page.keyboard.type(texto, { delay: 0 }); // Digitação instantânea
            } catch (e) {
                // Se falhar texto, tenta seguir
            }
        }

        // 8. Publicar
        console.log('Publicando...');
        try {
            const btnPost = await page.waitForSelector('button.share-actions__primary-action', { timeout: 5000 });
            await btnPost.click();
            await new Promise(r => setTimeout(r, 4000)); // Espera rápida pra confirmar
        } catch (e) {
            await sendEvidence(page, 'ERRO_BOTAO_PUBLICAR');
            return;
        }

        // SUCESSO
        console.log('Sucesso!');
        await sendEvidence(page, 'SUCESSO_POSTADO');

    } catch (error) {
        console.error('ERRO GERAL:', error.message);
        if (page) await sendEvidence(page, 'ERRO_GERAL_' + error.message);
        else res.status(500).send('Erro sem navegador: ' + error.message);
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
