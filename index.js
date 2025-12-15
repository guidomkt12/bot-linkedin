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

const server = app.listen(PORT, () => console.log(`Super Bot V39 (Visual Hunter) running on ${PORT}`));
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

// Tenta clicar por texto (XPath)
async function tapByText(page, textOptions) {
    try {
        const xpaths = textOptions.map(t => `contains(text(), "${t}")`);
        const query = `//*[${xpaths.join(' or ')}]`;
        const elements = await page.$x(query);
        if (elements.length > 0) {
            for (const el of elements) {
                try {
                    // Verifica se está visível
                    const box = await el.boundingBox();
                    if(box) {
                        await el.tap();
                        return true;
                    }
                } catch (e) {}
            }
        }
        return false;
    } catch (e) { return false; }
}

app.get('/', (req, res) => res.send(`Bot V39 Visual Hunter. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V39
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta V39] ${msg}`);
        debugLog.push(`[${timestamp}] ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        if (!imagePath) throw new Error('No Image provided');
        
        log('Iniciando navegador Mobile Manual...');
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--window-size=390,844', 
            '--start-maximized'
        ];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: null });
        page = await browser.newPage();
        
        // Emulação Manual iPhone
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        await tapByText(page, ['Not Now', 'Agora não', 'Cancel', 'Cancelar']);
        
        // --- UPLOAD ---
        log('Upload...');
        const newPostSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
        const newPostBtn = await page.$(newPostSelector);
        
        if (newPostBtn) {
            const fileChooserPromise = page.waitForFileChooser({ timeout: 10000 });
            await newPostBtn.tap(); 
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
        } else {
             const inputUpload = await page.$('input[type="file"]');
             if(inputUpload) {
                 await inputUpload.uploadFile(imagePath);
                 await inputUpload.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
             } else {
                 throw new Error('Botão/Input upload não encontrado.');
             }
        }
        
        log('Aguardando Crop...');
        await new Promise(r => setTimeout(r, 6000));

        // --- NAVEGAÇÃO NEXT/AVANÇAR ---
        // Tenta achar o botão "Next" no topo direito
        log('Tentando Next 1...');
        // Clica na região do topo direito (coordenada aproximada no iPhone)
        // Geralmente o botão "Next" fica em x=350, y=50
        let clickedNext = await tapByText(page, ['Next', 'Avançar']);
        
        if (!clickedNext) {
            log('Texto Next não achado. Clicando no canto superior direito (Blind Click)...');
            await page.mouse.click(350, 50); // Clicar no canto superior direito
        }

        await new Promise(r => setTimeout(r, 3000));

        // Next 2 (Filtros -> Legenda)
        log('Tentando Next 2...');
        clickedNext = await tapByText(page, ['Next', 'Avançar']);
        if (!clickedNext) {
             log('Texto Next 2 não achado. Clicando no canto superior direito (Blind Click)...');
             await page.mouse.click(350, 50);
        }
        await new Promise(r => setTimeout(r, 4000));

        // --- LEGENDA (Mobile V39) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log('Procurando textarea...');
            
            // Procura o PRIMEIRO textarea da página. No mobile, só existe um.
            const textArea = await page.$('textarea');
            
            if (textArea) {
                log('Textarea encontrado! Digitando...');
                await textArea.tap();
                await new Promise(r => setTimeout(r, 500));
                
                await page.keyboard.type(cleanLegenda, { delay: 30 });
                await new Promise(r => setTimeout(r, 1000));
            } else {
                log('AVISO: Textarea não achado.');
                // Tenta div contenteditable como fallback
                const divEdit = await page.$('div[contenteditable="true"]');
                if(divEdit) {
                    log('Div editável encontrada. Digitando...');
                    await divEdit.tap();
                    await page.keyboard.type(cleanLegenda, { delay: 30 });
                } else {
                    log('ERRO CRÍTICO: Nenhum campo de texto achado. Tirando print...');
                    const errShot = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
                    return { status: "error", error: "Caption field missing", logs: debugLog, debug_image: errShot.toString('base64') };
                }
            }
        }

        // --- SHARE ---
        log('Compartilhando...');
        
        // 1. Tenta pelo texto
        let shareClicked = await tapByText(page, ['Share', 'Compartilhar']);
        
        // 2. Se falhar, BLIND CLICK no canto superior direito (onde fica o botão "Share")
        if (!shareClicked) {
            log('Botão Share (Texto) não achado. Clicando no canto superior direito (Blind Click)...');
            await page.mouse.click(350, 50); // Clica em X=350, Y=50
            shareClicked = true;
        }
        
        await new Promise(r => setTimeout(r, 15000));
        log('Finalizado.');
            
        // Print de sucesso
        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

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

app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((result) => { res.status(200).json(result); })
        .catch((err) => { res.status(500).json({ error: "Erro interno", details: err.message }); });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
