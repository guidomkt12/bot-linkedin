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

const server = app.listen(PORT, () => console.log(`Bot V19 (Ctrl+V) rodando na porta ${PORT} ⚡`));
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
app.get('/', (req, res) => res.send('Bot V19 Online 📋'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função para tirar foto e encerrar se der erro
    const abortWithProof = async (p, msg) => {
        console.error(`❌ ERRO: ${msg}`);
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': imgBuffer.length,
                'X-Error-Msg': msg
            });
            res.end(imgBuffer);
        } catch (e) {
            res.status(500).json({ erro: msg });
        }
    };

    // Função para checar se a sessão caiu
    const checkSession = async (p) => {
        const url = await p.url();
        const title = await p.title();
        if (url.includes('login') || url.includes('signup') || title.includes('Entrar')) {
            throw new Error('SESSÃO CAIU (Desconectado).');
        }
    };

    try {
        console.log('--- INICIANDO V19 (IMAGEM PRIMEIRO + CTRL-V) ---');
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
        // Se a URL já tiver ?share=true, ele abre o modal direto
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // CHECAGEM 1
        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao entrar.'); }

        // 5. Garantir Modal Aberto
        console.log('Verificando modal...');
        const editorSelector = '.ql-editor, div[role="textbox"]';
        
        // Tenta achar o editor direto. Se não achar, clica no botão.
        if (!await page.$(editorSelector)) {
            console.log('Modal fechado. Clicando no botão...');
            const selectors = ['button.share-box-feed-entry__trigger', 'div.share-box-feed-entry__trigger', 'button[aria-label="Começar publicação"]'];
            let clicked = false;
            for (const sel of selectors) {
                const el = await page.$(sel);
                if (el) { await el.click(); clicked = true; break; }
            }
            if(clicked) await new Promise(r => setTimeout(r, 3000));
        }

        // CHECAGEM 2
        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao abrir modal.'); }

        // 6. UPLOAD DE IMAGEM (PRIORIDADE TOTAL)
        if (imagePath) {
            console.log('📸 UPLOAD: Iniciando...');
            
            // Procura o botão de imagem e clica (garante que o input apareça)
            const imgBtn = await page.$('button[aria-label="Adicionar mídia"], button[aria-label="Add media"]');
            if(imgBtn) await imgBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 }).catch(()=>null);
            
            if (input) {
                await input.uploadFile(imagePath);
                console.log('📸 UPLOAD: Arquivo enviado. Aguardando preview...');
                
                // Espera o preview aparecer. Se cair a conexão aqui, ele avisa.
                try {
                    await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                    console.log('📸 UPLOAD: Sucesso!');
                } catch(e) {
                    return await abortWithProof(page, 'Erro/Timeout no Upload.');
                }
            } else {
                return await abortWithProof(page, 'Não achei onde subir a foto.');
            }
        }

        // CHECAGEM 3
        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado após upload.'); }

        // 7. TEXTO (MODO CTRL+V)
        if (texto) {
            console.log('📝 TEXTO: Colando conteúdo...');
            try {
                // Foca na caixa
                await page.click(editorSelector);
                await new Promise(r => setTimeout(r, 500));
                
                // MÁGICA: Usa comando de sistema para "Inserir Texto" (como um Ctrl+V)
                // Isso é instantâneo e não dispara gatilhos de digitação robótica
                await page.evaluate((txt) => {
                    document.execCommand('insertText', false, txt);
                }, texto);
                
                console.log('📝 TEXTO: Colado.');
            } catch(e) {
                console.log('Erro ao colar texto: ' + e.message);
            }
        }

        // 8. PUBLICAR
        console.log('🚀 PUBLICAR: Clicando...');
        await new Promise(r => setTimeout(r, 2000));

        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se habilitado
        const disabled = await page.evaluate(el => el.disabled, btnPost);
        if (disabled) {
            return await abortWithProof(page, 'Botão publicar desabilitado (Upload falhou?).');
        }

        await btnPost.click();
        
        // Espera confirmação
        await new Promise(r => setTimeout(r, 5000));

        // CHECAGEM FINAL
        try { await checkSession(page); } catch(e) { return await abortWithProof(page, 'Desconectado ao publicar.'); }

        console.log('✅ SUCESSO V19!');
        
        // Manda print do sucesso
        const imgBuffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length });
        res.end(imgBuffer);

    } catch (error) {
        console.error('ERRO FATAL:', error.message);
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
