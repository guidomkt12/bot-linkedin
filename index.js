const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;
const upload = multer({ dest: '/tmp/uploads/' });

// Aumenta o timeout do servidor Express para 5 minutos (300000ms)
const server = app.listen(PORT, () => console.log(`Rodando na porta ${PORT} (Timeout aumentado)`));
server.setTimeout(300000);

app.get('/', (req, res) => res.send('Bot LinkedIn v6 (High Timeout) ⏳'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // Configura timeout de resposta do endpoint também
    res.setTimeout(300000);
    
    const imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    try {
        const { texto, paginaUrl, email, senha, cookies } = req.body;
        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        console.log('--- NOVA REQUISIÇÃO (V6) ---');

        if (!cookiesFinal && (!email || !senha)) throw new Error('Obrigatório enviar COOKIES ou Email/Senha.');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1920, height: 1080 },
            // Tira o limite de tempo do browser
            timeout: 0
        });

        page = await browser.newPage();
        // Tira o limite de tempo da página (padrão é 30s)
        page.setDefaultNavigationTimeout(0); 
        page.setDefaultTimeout(0); 

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36');

        // --- LOGIN (Com Cookies) ---
        if (cookiesFinal) {
            console.log('🍪 Tentando logar com Cookies...');
            try {
                const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
                if (Array.isArray(cookiesJson)) {
                    await page.setCookie(...cookiesJson);
                }
            } catch (e) { console.error('Erro cookie:', e.message); }
        }

        console.log('Navegando para:', paginaUrl);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 5000));

        // --- POSTAR ---
        console.log('Procurando botão...');
        const texts = ['Começar', 'Start', 'Criar', 'Publicar', 'Create'];
        const buttons = await page.$$('button, div[role="button"]');
        let found = false;

        for (const btn of buttons) {
            const t = await page.evaluate(el => el.textContent, btn);
            if (t && texts.some(x => t.includes(x))) {
                await btn.click();
                found = true;
                break;
            }
        }
        
        if (!found) {
            const btn = await page.$('button.share-box-feed-entry__trigger, button.share-box__open');
            if (btn) { await btn.click(); found = true; }
        }

        if (!found) throw new Error(`Botão não encontrado. Título: ${await page.title()}`);

        await new Promise(r => setTimeout(r, 3000));

        // --- UPLOAD DA IMAGEM (A PARTE CRÍTICA) ---
        if (imagePath) {
            console.log('📸 Subindo imagem (Pode demorar)...');
            
            // 1. Tenta achar input
            const input = await page.waitForSelector('input[type="file"]', { timeout: 60000 }).catch(()=>null);
            
            if (input) {
                // 2. Sobe o arquivo
                await input.uploadFile(imagePath);
                console.log('Arquivo enviado pro input. Esperando preview...');

                // 3. Espera o LinkedIn processar (AQUI DEMORA!)
                // Aumentei a espera do preview para 2 minutos (120000ms)
                try {
                    await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"], div.media-container', { timeout: 120000 });
                    console.log('Preview carregado! Upload concluído.');
                } catch (e) {
                    console.log('Aviso: Preview demorou, mas vamos tentar postar mesmo assim.');
                }
                
                await new Promise(r => setTimeout(r, 5000));
            } else {
                console.log('Input de arquivo não encontrado.');
            }
        }

        // Texto
        if (texto) {
            console.log('Escrevendo texto...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 5 });
        }

        // Publicar
        console.log('Clicando em Publicar...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se botão está habilitado
        const isDisabled = await page.evaluate(el => el.disabled, btnPost);
        if (isDisabled) {
            console.log('Botão desabilitado. Esperando mais 10s pelo upload...');
            await new Promise(r => setTimeout(r, 10000));
        }

        await btnPost.click();
        await new Promise(r => setTimeout(r, 10000)); // Espera confirmação

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado com paciência extra!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) {
            try {
                await page.screenshot({ path: '/tmp/erro_timeout.png' });
                res.sendFile('/tmp/erro_timeout.png');
            } catch(e) { res.status(500).json({ erro: error.message }); }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
