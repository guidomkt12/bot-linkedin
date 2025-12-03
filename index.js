const express = require('express');
// Importa o Puppeteer com Stealth
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
const server = app.listen(PORT, () => console.log(`Bot V9 (Stealth & Human) rodando na porta ${PORT}`));
server.setTimeout(600000);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Função para pausas aleatórias (Humanização)
const humanDelay = (min = 1000, max = 3000) => new Promise(r => setTimeout(r, Math.random() * (max - min) + min));

app.get('/', (req, res) => res.send('Bot LinkedIn V9 (Stealth Mode) 🥷'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    try {
        console.log('--- REQUISIÇÃO STEALTH ---');
        const { texto, paginaUrl, email, senha, cookies, imagemUrl } = req.body;
        
        // 1. Baixar imagem se vier URL
        if (!imagePath && imagemUrl) {
            try {
                console.log('Baixando imagem...');
                imagePath = await downloadImage(imagemUrl);
            } catch (e) { console.error('Erro download img:', e.message); }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal && (!email || !senha)) throw new Error('Preciso de Cookies ou Login.');

        // 2. Lançar Navegador com Argumentos Anti-Detecção
        browser = await puppeteer.launch({
            headless: true, // Mude para false se testar no PC
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1366,768', // Tamanho de tela de notebook comum
                '--disable-blink-features=AutomationControlled' // Oculta flag de automação
            ],
            defaultViewport: { width: 1366, height: 768 },
            timeout: 0
        });

        page = await browser.newPage();
        
        // Simula um User Agent real de Windows
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- LOGIN INTELIGENTE ---
        let loggedIn = false;
        if (cookiesFinal) {
            console.log('🍪 Injetando Cookies...');
            try {
                const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
                if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);
                loggedIn = true;
            } catch (e) { console.log('Erro cookies, tentando senha...'); }
        }

        // Se não tiver cookies, tenta login manual (mas com delay humano)
        if (!loggedIn && email && senha) {
            console.log('Logando com senha (Cuidado)...');
            await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
            await humanDelay(1000, 3000);
            await page.type('#username', email, { delay: 100 }); // Digitação lenta
            await humanDelay(500, 1000);
            await page.type('#password', senha, { delay: 100 });
            await humanDelay(500, 1500);
            await page.click('[type="submit"]');
            await page.waitForNavigation().catch(()=>{});
        }

        // --- IR PARA O PAINEL ---
        console.log(`Indo para admin: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await humanDelay(5000, 8000); // Espera carregar como um humano lendo a tela

        // --- ENCONTRAR BOTÃO ---
        console.log('Procurando botão...');
        const texts = ['Começar', 'Start', 'Criar', 'Publicar', 'Create', 'Write'];
        
        // Tenta achar botão pelo texto
        const buttons = await page.$$('button, div[role="button"], span');
        let found = false;
        
        for (const btn of buttons) {
            const t = await page.evaluate(el => el.textContent, btn);
            if (t && texts.some(x => t.trim().includes(x))) {
                // Move o mouse para o botão antes de clicar (Humanização)
                try {
                    await btn.hover();
                    await humanDelay(500, 1000);
                } catch(e){}
                
                await btn.click();
                found = true;
                break;
            }
        }
        
        if (!found) {
            const btn = await page.$('button.share-box-feed-entry__trigger, button.share-box__open');
            if (btn) { await btn.click(); found = true; }
        }

        if (!found) throw new Error('Não achei o botão de postar. Sessão pode ter caído.');

        await humanDelay(2000, 4000);

        // --- UPLOAD DA IMAGEM ---
        if (imagePath) {
            console.log('📸 Upload da imagem...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 30000 }).catch(()=>null);
            
            if (input) {
                await input.uploadFile(imagePath);
                // Espera preview
                try {
                    await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                    console.log('Imagem carregada.');
                } catch(e) { console.log('Aviso: Preview demorou.'); }
                await humanDelay(2000, 4000);
            }
        }

        // --- TEXTO ---
        if (texto) {
            console.log('Digitando texto...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await humanDelay(500, 1000);
            await page.keyboard.type(texto, { delay: 30 }); // Digitação humana
        }

        // --- PUBLICAR ---
        console.log('Publicando...');
        await humanDelay(2000, 4000);
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se está habilitado
        const isDisabled = await page.evaluate(el => el.disabled, btnPost);
        if (isDisabled) await humanDelay(2000, 5000); // Espera mais um pouco

        await btnPost.click();
        await humanDelay(5000, 10000); // Espera post ser enviado

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado em modo Stealth!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) {
            try {
                await page.screenshot({ path: '/tmp/erro_stealth.png' });
                res.sendFile('/tmp/erro_stealth.png');
            } catch (e) { res.status(500).json({ erro: error.message }); }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
