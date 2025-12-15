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

// --- CONFIGURAÇÃO ---
const MAX_CONCURRENT = 5; 
const PROXY_HOST = process.env.PROXY_HOST || ''; 
const PROXY_USER = process.env.PROXY_USER || '';
const PROXY_PASS = process.env.PROXY_PASS || '';
const USE_PROXY = PROXY_HOST && PROXY_HOST.length > 0;

let activeProcesses = 0;
const requestQueue = [];

process.on('uncaughtException', (err) => { console.error('⚠️ CRITICAL:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ REJECTION:', reason); });

const server = app.listen(PORT, () => console.log(`Super Bot V33 (Completed) running on ${PORT}`));
server.setTimeout(1200000); 

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --- QUEUE ---
function processQueue() {
    if (activeProcesses >= MAX_CONCURRENT || requestQueue.length === 0) return; 
    const nextJob = requestQueue.shift();
    activeProcesses++;
    nextJob().finally(() => {
        activeProcesses--;
        processQueue();
    });
}

function addJobToQueue(jobFunction) {
    return new Promise((resolve, reject) => {
        requestQueue.push(async () => {
            try { resolve(await jobFunction()); } 
            catch (error) { reject(error); }
        });
        processQueue();
    });
}

// --- UTILS ---
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

function cleanText(text) {
    if (!text) return "";
    return text.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}]/gu, '');
}

async function clickByText(page, textsToFind, tag = '*') {
    try {
        return await page.evaluate((texts, tagName) => {
            const elements = [...document.querySelectorAll(tagName)];
            for (const el of elements) {
                const txt = el.innerText || el.getAttribute('aria-label') || '';
                if (texts.some(t => txt.toLowerCase().includes(t.toLowerCase()))) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, textsToFind, tag);
    } catch (e) { return false; }
}

app.get('/', (req, res) => res.send(`Bot V33 Complete. Queue: ${requestQueue.length}`));

// ==========================================
// 1. INSTAGRAM (V33 - Frankenstein)
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta] ${msg}`);
        debugLog.push(`[${timestamp}] ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        if (!imagePath) throw new Error('No Image provided');
        
        log('Iniciando navegador...');
        const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1366,768', '--start-maximized'];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: { width: 1366, height: 768 } });
        page = await browser.newPage();
        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Indo para Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);
        
        // --- ABERTURA DO MODAL ---
        log('Abrindo Modal Criar...');
        let createFound = false;
        
        // Tenta Ícone
        const createSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"], svg[aria-label="Criar"]';
        const iconEl = await page.$(createSelector);
        if (iconEl) {
             await iconEl.evaluate(e => e.closest('a, button, div[role="button"]').click());
             createFound = true;
        } else {
             createFound = await clickByText(page, ['Create', 'Criar'], 'span');
        }
        
        if(!createFound) throw new Error('Botão Create não encontrado');
        await new Promise(r => setTimeout(r, 3000));

        // --- UPLOAD (MÉTODO CLÁSSICO) ---
        log('Selecionando arquivo (FileChooser)...');
        try {
            const fileChooserPromise = page.waitForFileChooser({timeout: 10000});
            const btnClicked = await clickByText(page, ['Select from computer', 'Selecionar do computador', 'Select'], 'button');
            
            if (btnClicked) {
                const fileChooser = await fileChooserPromise;
                await fileChooser.accept([imagePath]);
                log('Upload iniciado.');
            } else {
                throw new Error('Botão azul não clicável.');
            }
        } catch (e) {
            log('Erro no upload: ' + e.message);
            throw e;
        }

        log('Aguardando Crop...');
        await page.waitForFunction(() => {
            const btns = [...document.querySelectorAll('div[role="button"]')];
            return btns.some(b => b.innerText.includes('Next') || b.innerText.includes('Avançar'));
        }, { timeout: 40000 });

        log('Next 1...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 2000));
        
        log('Next 2...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 5000)); 

        // --- LEGENDA (MÉTODO INJEÇÃO) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Inserindo legenda (${cleanLegenda.length} chars)...`);
            
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            try { await page.waitForSelector(selector, { timeout: 8000 }); } catch(e){}
            
            const textArea = await page.$(selector);
            if (textArea) {
                await textArea.click();
                await new Promise(r => setTimeout(r, 500));

                await page.evaluate((sel, txt) => {
                    const el = document.querySelector(sel);
                    if(el) {
                        el.focus();
                        document.execCommand('insertText', false, txt); 
                    }
                }, selector, cleanLegenda);
                
                await new Promise(r => setTimeout(r, 1000));
            } else {
                log('AVISO: Campo de legenda não encontrado.');
            }
        }

        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!shareClicked) shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'button');

        if (shareClicked) {
            await new Promise(r => setTimeout(r, 15000)); 
            log('Finalizado.');
        } else {
            log('ERRO: Botão Share não encontrado.');
        }

        return {
            status: "finished",
            logs: debugLog,
            debug_image: finalTextSnapshot 
        };

    } catch (error) {
        log(`ERRO FATAL: ${error.message}`);
        let errImg = "";
        if (page && !page.isClosed()) {
            try { 
                const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
                errImg = buf.toString('base64');
            } catch(e){}
        }
        
        return {
            status: "error",
            error: error.message,
            logs: debugLog,
            debug_image: errImg
        };
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
}

// ==========================================
// 2. LINKEDIN (Restaurado)
// ==========================================
async function runLinkedinBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let resultBuffer = null;

    try {
        console.log('[LinkedIn] Iniciando...');
        const { texto, paginaUrl, cookies, imagemUrl } = body;
        
        if (!imagePath && imagemUrl) { try { imagePath = await downloadImage(imagemUrl); } catch (e) {} }
        if (!cookies) throw new Error('Cookies obrigatórios.');

        const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'];
        if (USE_PROXY) launchArgs.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args: launchArgs, defaultViewport: { width: 1280, height: 800 }, timeout: 60000 });
        page = await browser.newPage();
        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        const targetUrl = paginaUrl || 'https://www.linkedin.com/feed/';
        console.log(`[LinkedIn] Indo para: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // Lógica de Postagem LinkedIn
        const editorSelector = '.ql-editor, div[role="textbox"]';
        
        // Tenta abrir o modal se o editor não estiver visível
        if (!await page.$(editorSelector)) {
            console.log('[LinkedIn] Tentando abrir modal...');
            const startPostBtn = await clickByText(page, ['Começar publicação', 'Start a post'], 'button');
            if(!startPostBtn) {
                 const btnClass = await page.$('button.share-box-feed-entry__trigger');
                 if(btnClass) await btnClass.click();
            }
            await new Promise(r => setTimeout(r, 4000));
        }

        if (imagePath) {
            console.log('[LinkedIn] Colando imagem...');
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = imgBuffer.toString('base64');
            const mimeType = 'image/jpeg';
            
            // Garante foco
            await page.click(editorSelector);
            await new Promise(r => setTimeout(r, 500));
            
            await page.evaluate(async (sel, b64, mime) => {
                const target = document.querySelector(sel);
                if (!target) return;
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
            }, editorSelector, imgBase64, mimeType);
            await new Promise(r => setTimeout(r, 10000)); 
        }

        if (texto) {
            console.log('[LinkedIn] Escrevendo texto...');
            await page.click(editorSelector);
            await page.keyboard.press('Enter'); 
            await page.evaluate((txt) => { document.execCommand('insertText', false, txt); }, texto);
        }

        console.log('[LinkedIn] Publicando...');
        await new Promise(r => setTimeout(r, 3000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 12000));
        
        console.log('[LinkedIn] Sucesso!');
        resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });

    } catch (error) {
        if (page && !page.isClosed()) try { resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true }); } catch(e){}
        throw error;
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
    return resultBuffer;
}

// --- ROTAS ---
app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((result) => { res.status(200).json(result); })
        .catch((err) => { res.status(500).json({ error: "Erro interno", details: err.message }); });
});

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runLinkedinBot(req.body, req.file))
        .then((img) => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length }); res.end(img); })
        .catch((err) => { res.status(500).json({ erro: err.message }); });
});
