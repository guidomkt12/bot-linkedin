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

// Log de início
const server = app.listen(PORT, () => console.log(`Bot V32 (Combo Perfeito + Verificação) rodando na porta ${PORT} 🛡️`));
server.setTimeout(600000);

// Aumenta limite para aguentar imagens grandes em base64
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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

app.get('/', (req, res) => res.send('Bot V32 Online 🛡️'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função de Print de Evidência (ESSENCIAL PARA DEBUG)
    const abortWithProof = async (p, msg) => {
        console.error(`❌ ERRO: ${msg}`);
        try {
            const imgBuffer = await p.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            res.writeHead(200, { 
                'Content-Type': 'image/jpeg', 
                'Content-Length': imgBuffer.length,
                'X-Error-Msg': msg 
            });
            res.end(imgBuffer);
        } catch (e) { res.status(500).json({ erro: msg }); }
    };

    try {
        console.log('--- INICIANDO V32 ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;
        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--window-size=1280,800',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 60000 // Timeout geral maior
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        const title = await page.title();
        if (title.includes('Login') || title.includes('Sign')) {
            return await abortWithProof(page, 'Caiu no login. Troque os cookies.');
        }

        // --- ABRIR MODAL ---
        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('Abrindo modal...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { 
                await btn.click(); 
                await new Promise(r => setTimeout(r, 4000)); 
            } else {
                return await abortWithProof(page, 'Não achei o botão de postar.');
            }
        }

        // --- 1. IMAGEM (MÉTODO V26 - SYNTHETIC PASTE) ---
        if (imagePath) {
            console.log('🧪 Colando imagem (Synthetic Paste)...');
            
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = imgBuffer.toString('base64');
            const mimeType = 'image/jpeg';

            // Script de injeção de evento 'paste'
            const result = await page.evaluate(async (sel, b64, mime) => {
                const target = document.querySelector(sel);
                if (!target) return 'No editor';
                
                const byteChars = atob(b64);
                const byteNums = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                const byteArray = new Uint8Array(byteNums);
                const blob = new Blob([byteArray], { type: mime });
                const file = new File([blob], "paste.jpg", { type: mime });

                const dt = new DataTransfer();
                dt.items.add(file);
                const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
                target.focus();
                target.dispatchEvent(evt);
                return 'OK';
            }, editorSelector, imgBase64, mimeType);

            if (result !== 'OK') return await abortWithProof(page, 'Falha no script de colar imagem.');

            console.log('Aguardando processamento da imagem (Preview)...');
            // VERIFICAÇÃO RESTAURADA: Espera o preview aparecer de verdade
            try {
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"], div[data-test-media-viewer]', { timeout: 60000 });
                console.log('✅ Imagem processada e visível no editor!');
                // Pausa extra para o DOM assentar
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                return await abortWithProof(page, 'ERRO: A imagem foi colada, mas o preview não apareceu (LinkedIn bloqueou?).');
            }
        }

        // --- 2. TEXTO FORMATADO (MÉTODO V31 - DOM INJECTION) ---
        if (texto) {
            console.log('📝 Injetando texto formatado abaixo da imagem...');
            try {
                await page.evaluate((sel, txt) => {
                    const editor = document.querySelector(sel);
                    
                    // Divide o texto por quebra de linha
                    const lines = txt.split(/\r?\n/);

                    lines.forEach(line => {
                        const p = document.createElement('p');
                        // Se linha vazia, usa <br> para espaçamento visual
                        if (!line.trim()) {
                            p.innerHTML = '<br>';
                        } else {
                            p.innerText = line;
                        }
                        // Adiciona no FINAL do editor (abaixo da imagem que já está lá)
                        editor.appendChild(p);
                    });

                    // Força atualização do editor
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                }, editorSelector, texto);
                console.log('Texto injetado.');
            } catch(e) {
                console.log('Erro na injeção de texto: ' + e.message);
                // Não aborta se o texto falhar, tenta postar a imagem
            }
        }

        // --- 3. PUBLICAR ---
        console.log('🚀 Publicando...');
        await new Promise(r => setTimeout(r, 3000));
        
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se está habilitado
        const isDisabled = await page.evaluate(el => el.disabled, btnPost);
        if (isDisabled) {
             return await abortWithProof(page, 'Botão Publicar está desabilitado (Algo deu errado no conteúdo).');
        }

        await btnPost.click();
        // Espera longa para upload e confirmação
        await new Promise(r => setTimeout(r, 10000));

        console.log('✅ SUCESSO V32 (COMBO COMPLETO)!');
        const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': finalImg.length });
        res.end(finalImg);

    } catch (error) {
        if (page) await abortWithProof(page, error.message);
        else res.status(500).json({ erro: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
