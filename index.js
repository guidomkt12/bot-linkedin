const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const multer = require('multer');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;
const upload = multer({ dest: '/tmp/uploads/' });

const server = app.listen(PORT, () => console.log(`Bot V27 (Combo Paparazzi) rodando na porta ${PORT} 📸`));
server.setTimeout(600000);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => res.send('Bot V27 Online 📸'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    let browser = null;
    let page = null;
    const screenshots = []; // Álbum de fotos

    // Função Paparazzi
    const captureStep = async (p, stepName) => {
        try {
            const imgBuffer = await p.screenshot({ encoding: 'base64', fullPage: true });
            screenshots.push({ step: stepName, img: `data:image/jpeg;base64,${imgBuffer}`, time: new Date().toLocaleTimeString() });
            
            const url = await p.url();
            if (url.includes('login') || url.includes('signup')) throw new Error(`SESSÃO CAIU em: ${stepName}`);
        } catch (e) { throw e; }
    };

    try {
        console.log('--- V27: COMBO COMPLETO ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;
        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');
        if (!imagemUrl) throw new Error('V27 exige imagemUrl!');

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 800 },
            timeout: 60000
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        await captureStep(page, '1. Chegada na Página');

        // --- GARANTIR MODAL ---
        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            console.log('Abrindo modal...');
            const btn = await page.$('button.share-box-feed-entry__trigger, div.share-box-feed-entry__trigger, button[aria-label="Começar publicação"]');
            if (btn) { 
                await btn.click(); 
                await new Promise(r => setTimeout(r, 3000));
            } else {
                await captureStep(page, 'ERRO: Modal não abriu');
                throw new Error('Modal falhou.');
            }
        }
        await captureStep(page, '2. Modal Aberto');

        // --- 1. LINK PREVIEW (IMAGEM) ---
        console.log(`🔗 Colando link: ${imagemUrl}`);
        await page.click(editorSelector);
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.type(imagemUrl, { delay: 5 });
        await page.keyboard.press('Enter');
        
        console.log('Aguardando preview...');
        await new Promise(r => setTimeout(r, 10000)); // Espera o card gerar
        await page.keyboard.press('Enter'); // Pula linha para garantir
        await captureStep(page, '3. Preview Gerado');

        // --- 2. INJEÇÃO DE TEXTO BRUTA ---
        if (texto) {
            console.log('📝 Injetando texto via DOM...');
            await page.evaluate((sel, txt) => {
                const editor = document.querySelector(sel);
                // Cria um novo parágrafo para o texto
                const p = document.createElement('p');
                p.innerText = txt;
                // Adiciona ao final do editor (abaixo do card da imagem)
                editor.appendChild(p);
                // Força atualização do LinkedIn
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }, editorSelector, texto);
            await new Promise(r => setTimeout(r, 1000));
            await captureStep(page, '4. Texto Injetado');
        }

        // --- 3. PUBLICAR ---
        console.log('🚀 Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        if (await page.evaluate(el => el.disabled, btnPost)) {
            await captureStep(page, 'ERRO: Botão Desabilitado');
            throw new Error('Botão publicar travado.');
        }
        await btnPost.click();
        await new Promise(r => setTimeout(r, 8000));
        await captureStep(page, '5. Resultado Final');

        // GERA RELATÓRIO HTML
        const html = generateReport(screenshots, 'SUCESSO', 'Postagem concluída!');
        res.send(html);

    } catch (error) {
        console.error(error);
        if (page) try { await captureStep(page, 'ERRO FATAL: ' + error.message); } catch(e){}
        const html = generateReport(screenshots, 'ERRO', error.message);
        res.send(html);
    } finally {
        if (browser) await browser.close();
    }
});

// Gerador de Relatório Bonito
function generateReport(shots, status, msg) {
    const color = status === 'SUCESSO' ? 'green' : 'red';
    return `<html><head><style>body{font-family:sans-serif;padding:20px;background:#f4f4f9}.card{background:#fff;padding:15px;margin-bottom:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}h1{color:${color}}img{max-width:100%;border:1px solid #ddd;margin-top:10px}.step{font-weight:bold;font-size:1.2em;margin-bottom:5px}.time{color:#888;font-size:0.9em}</style></head><body><h1>Relatório V27: ${status}</h1><p>${msg}</p>${shots.map(s=>`<div class="card"><div class="step">${s.step}</div><div class="time">${s.time}</div><img src="${s.img}"/></div>`).join('')}</body></html>`;
}
