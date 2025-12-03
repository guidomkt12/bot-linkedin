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

// Aumenta timeouts globais
const server = app.listen(PORT, () => console.log(`Bot V10 (Debug Visual) rodando na porta ${PORT}`));
server.setTimeout(600000);

// Função de download (mantida)
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => res.send('Bot V10 Online 🟢'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // Configura timeout de resposta para 10 minutos
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    try {
        console.log('--- NOVA TENTATIVA (V10) ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        // Prioridade: URL > Arquivo
        if (!imagePath && imagemUrl) {
            try {
                console.log('Baixando imagem...');
                imagePath = await downloadImage(imagemUrl);
            } catch (e) { console.error('Erro download:', e.message); }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('ERRO: É obrigatório enviar COOKIES atualizados.');

        // Lança navegador com perfil temporário persistente
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: { width: 1920, height: 1080 },
            timeout: 0,
            userDataDir: '/tmp/chrome-session' // Tenta manter cache da sessão
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- INJETAR COOKIES ---
        console.log('Injetando cookies...');
        try {
            const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
            if (Array.isArray(cookiesJson)) {
                await page.setCookie(...cookiesJson);
            }
        } catch (e) { console.error('Erro cookies:', e.message); }

        // --- NAVEGAÇÃO ---
        console.log(`Indo para: ${paginaUrl}`);
        
        // Tenta ir direto. Se falhar, tira print.
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // VERIFICAÇÃO CRÍTICA: Onde estamos?
        const title = await page.title();
        console.log(`Título da página atual: ${title}`);

        // Se caiu no login ou feed, avisa
        if (title.includes('Login') || title.includes('Sign In') || title.includes('Feed')) {
            // Se cair no Feed, tenta ir pro admin de novo
            if (title.includes('Feed')) {
                console.log('Caiu no Feed pessoal. Redirecionando para Admin...');
                await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 5000));
            } else {
                throw new Error(`Sessão caiu. Título: ${title}. Renove os cookies.`);
            }
        }

        // --- BUSCA BOTÃO (Simplificada) ---
        console.log('Procurando botão de postar...');
        
        // Lista de seletores conhecidos do LinkedIn Admin
        const selectors = [
            'button.share-box-feed-entry__trigger',
            'div.share-box-feed-entry__trigger',
            'button.share-box__open',
            'button[aria-label="Começar publicação"]',
            'button[aria-label="Start a post"]'
        ];

        let found = false;
        for (const sel of selectors) {
            const el = await page.$(sel);
            if (el) {
                console.log(`Botão encontrado via: ${sel}`);
                await el.click();
                found = true;
                break;
            }
        }

        // Se não achou por seletor, tenta texto bruto (último recurso)
        if (!found) {
            console.log('Seletores falharam. Varrendo textos...');
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const t = await page.evaluate(el => el.textContent, btn);
                if (t && (t.includes('Começar') || t.includes('Start') || t.includes('Criar'))) {
                    await btn.click();
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            throw new Error(`BOTÃO NÃO LOCALIZADO. Título: ${await page.title()}`);
        }

        await new Promise(r => setTimeout(r, 3000));

        // --- UPLOAD ---
        if (imagePath) {
            console.log('Upload imagem...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 }).catch(()=>null);
            if (input) {
                await input.uploadFile(imagePath);
                // Espera preview aparecer (aumentei timeout)
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 }).catch(()=>console.log('Preview demorou...'));
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        // --- TEXTO ---
        if (texto) {
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // --- PUBLICAR ---
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado V10!' });

    } catch (error) {
        console.error('ERRO FATAL:', error.message);
        
        // --- GERA PRINT DO ERRO ---
        if (page) {
            try {
                const erroPath = '/tmp/erro_v10.png';
                await page.screenshot({ path: erroPath, fullPage: true });
                console.log('Print de erro gerado. Enviando...');
                res.sendFile(erroPath); // Manda a imagem do erro pro n8n
            } catch (e) {
                res.status(500).json({ erro: error.message, erro_print: 'Falha ao gerar print' });
            }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
