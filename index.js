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

const server = app.listen(PORT, () => console.log(`Super Bot V41 (Finisher) running on ${PORT}`));
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

async function tapByText(page, textOptions) {
    try {
        const xpaths = textOptions.map(t => `contains(text(), "${t}")`);
        const query = `//*[${xpaths.join(' or ')}]`;
        const elements = await page.$x(query);
        if (elements.length > 0) {
            for (const el of elements) {
                try {
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

app.get('/', (req, res) => res.send(`Bot V41 Finisher. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V41
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta V41] ${msg}`);
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

        // --- NAVEGAÇÃO ---
        log('Next 1...');
        let clickedNext = await tapByText(page, ['Next', 'Avançar']);
        if (!clickedNext) await page.mouse.click(350, 50); 

        await new Promise(r => setTimeout(r, 3000));

        log('Next 2...');
        clickedNext = await tapByText(page, ['Next', 'Avançar']);
        if (!clickedNext) await page.mouse.click(350, 50);
        
        await new Promise(r => setTimeout(r, 5000)); // Espera carregar a tela final

        // --- LEGENDA (MÉTODO BLIND TYPING) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log('Tentando focar no campo de legenda (Blind Click)...');
            
            // Clica na área onde o campo de legenda costuma ficar no mobile (topo/meio, logo abaixo da foto)
            // No iPhone X/12, a foto fica pequena na esquerda e o campo à direita ou embaixo.
            // Vamos clicar em X=100, Y=150 (um pouco abaixo do topo)
            await page.mouse.click(100, 150);
            await new Promise(r => setTimeout(r, 500));
            
            // Clica mais pro meio caso o layout seja diferente
            await page.mouse.click(200, 200);
            await new Promise(r => setTimeout(r, 500));

            // Tenta achar textarea real se possível
            const textArea = await page.$('textarea');
            if (textArea) await textArea.tap();

            log('Digitando texto cegamente...');
            await page.keyboard.type(cleanLegenda, { delay: 30 });
            
            await new Promise(r => setTimeout(r, 2000));
        }

        // --- SHARE (CLICK SPAM) ---
        log('Compartilhando (Spam Click)...');
        
        // Clica no botão Share (Canto superior direito)
        // Fazemos isso 3 vezes com intervalo para garantir
        for(let i=0; i<3; i++) {
            log(`Click Share ${i+1}...`);
            await page.mouse.click(350, 50); // Canto superior direito
            await new Promise(r => setTimeout(r, 3000));
            
            // Verifica se mudou a URL ou apareceu mensagem de sucesso
            const url = page.url();
            if(!url.includes('create/style') && !url.includes('create/details')) {
                log('URL mudou, provavel sucesso.');
                break;
            }
        }
        
        await new Promise(r => setTimeout(r, 10000));
        log('Finalizado.');
            
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
