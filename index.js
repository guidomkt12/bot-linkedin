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

const server = app.listen(PORT, () => console.log(`Bot V18 (Blind Mode) rodando na porta ${PORT} ⚡`));
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

// Rota de Teste
app.get('/', (req, res) => res.send('Bot V18 Online (Sem Verificações) 🚀'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função de Print
    const sendEvidence = async (p, headerMsg) => {
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': imgBuffer.length,
                'X-Status-Msg': headerMsg
            });
            res.end(imgBuffer);
        } catch (e) { res.status(500).json({ erro: 'Falha print' }); }
    };

    try {
        console.log('--- V18: MODO CEGO ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        // 1. Download
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('Preciso de Cookies.');

        // 2. Navegador
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 0
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 3. Cookies
        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        // 4. Navegação
        console.log(`Indo para URL (Assumindo modal aberto): ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // ESPERA FIXA - SEM VERIFICAÇÃO
        console.log('Esperando 8 segundos para garantir carregamento...');
        await new Promise(r => setTimeout(r, 8000));

        // 5. UPLOAD FORÇADO (Sem esperar botão aparecer)
        if (imagePath) {
            console.log('Forçando upload no input oculto...');
            try {
                // O LinkedIn sempre tem um input type=file, mesmo escondido. Vamos injetar nele.
                const input = await page.$('input[type="file"]');
                if (input) {
                    await input.uploadFile(imagePath);
                    console.log('Arquivo injetado. Esperando 10s pelo processamento...');
                    await new Promise(r => setTimeout(r, 10000));
                } else {
                    console.log('Input de arquivo não encontrado no DOM.');
                }
            } catch (e) {
                console.log('Erro no upload cego: ' + e.message);
            }
        }

        // 6. TEXTO FORÇADO
        if (texto) {
            console.log('Digitando texto às cegas...');
            try {
                // Tenta focar na div de texto
                await page.click('div[role="textbox"]'); 
            } catch(e) {
                console.log('Não consegui clicar na caixa, tentando TAB...');
                await page.keyboard.press('Tab');
                await page.keyboard.press('Tab');
            }
            
            await new Promise(r => setTimeout(r, 1000));
            await page.keyboard.type(texto, { delay: 10 });
        }

        // 7. PUBLICAR
        console.log('Procurando botão Publicar...');
        await new Promise(r => setTimeout(r, 2000));
        
        try {
            // Tenta clicar no botão principal
            const btnPost = await page.waitForSelector('button.share-actions__primary-action', { timeout: 5000 });
            await btnPost.click();
            console.log('Cliquei em publicar.');
        } catch (e) {
            console.log('Botão publicar não achado. Enviando print.');
            await sendEvidence(page, 'ERRO_BOTAO_PUBLICAR');
            return;
        }

        // Espera confirmar
        await new Promise(r => setTimeout(r, 5000));
        
        console.log('SUCESSO (Assumido)');
        await sendEvidence(page, 'SUCESSO_FINAL');

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) await sendEvidence(page, 'ERRO_FATAL_' + error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
