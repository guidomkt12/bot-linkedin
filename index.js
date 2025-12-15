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

const server = app.listen(PORT, () => console.log(`Super Bot V38 (Mobile Hunter) running on ${PORT}`));
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

// NOVO: Clique inteligente por Texto (XPath)
async function tapByText(page, textOptions) {
    try {
        const xpaths = textOptions.map(t => `contains(text(), "${t}")`);
        const query = `//*[${xpaths.join(' or ')}]`;
        
        const elements = await page.$x(query);
        if (elements.length > 0) {
            // Tenta clicar no primeiro visível
            for (const el of elements) {
                try {
                    await el.tap(); // Tap é melhor para mobile
                    return true;
                } catch (e) {}
            }
        }
        return false;
    } catch (e) { return false; }
}

app.get('/', (req, res) => res.send(`Bot V38 Mobile Hunter. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V38
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta V38] ${msg}`);
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
        await new Promise(r => setTimeout(r, 4000));
        
        // Limpa popups usando XPath (mais seguro)
        await tapByText(page, ['Not Now', 'Agora não', 'Cancel', 'Cancelar']);
        
        // --- UPLOAD (Input Forçado - V37) ---
        log('Upload...');
        
        // Tenta achar botão [+] ou Input
        const newPostSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
        const newPostBtn = await page.$(newPostSelector);
        
        if (newPostBtn) {
            const fileChooserPromise = page.waitForFileChooser({ timeout: 10000 });
            await newPostBtn.tap(); // Tap no ícone
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
        } else {
             // Fallback Input direto
             const inputUpload = await page.$('input[type="file"]');
             if(inputUpload) {
                 await inputUpload.uploadFile(imagePath);
                 await inputUpload.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
             } else {
                 throw new Error('Botão/Input upload não encontrado.');
             }
        }
        
        log('Aguardando processamento...');
        await new Promise(r => setTimeout(r, 6000));

        // --- NAVEGAÇÃO NEXT/AVANÇAR (XPath) ---
        // Aqui o mobile costuma ter um fluxo: Crop -> (Next) -> Filtro -> (Next) -> Legenda
        
        // Next 1
        log('Tentando Next 1...');
        let clickedNext = await tapByText(page, ['Next', 'Avançar']);
        if (!clickedNext) {
             // Tenta clicar na seta azul (comum no mobile)
             const arrowBtn = await page.$('svg[aria-label="Next"], svg[aria-label="Avançar"]');
             if (arrowBtn) await arrowBtn.tap();
        }
        await new Promise(r => setTimeout(r, 3000));

        // Next 2 (Verifica se precisa clicar de novo)
        log('Tentando Next 2...');
        let clickedNext2 = await tapByText(page, ['Next', 'Avançar']);
        if (clickedNext2) {
             log('Clicado Next 2. Aguardando tela final...');
             await new Promise(r => setTimeout(r, 4000));
        }

        // --- LEGENDA (BUSCA GENÉRICA) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log('Procurando textarea...');
            
            // Procura QUALQUER textarea na página (no mobile costuma ter só um nessa tela)
            const textArea = await page.$('textarea');
            
            if (textArea) {
                log('Campo encontrado! Digitando...');
                await textArea.tap();
                await new Promise(r => setTimeout(r, 500));
                
                await page.keyboard.type(cleanLegenda, { delay: 20 });
                await new Promise(r => setTimeout(r, 1000));
                
                // Validação
                const valor = await page.evaluate(e => e.value, textArea);
                log(`Valor no campo: "${valor.substring(0, 10)}..."`);
            } else {
                // SE DER ERRO AQUI, VAMOS TIRAR PRINT PARA VOCÊ VER
                log('AVISO CRÍTICO: Textarea não achado. Tirando print do erro...');
                const errShot = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
                return {
                    status: "error",
                    error: "Campo de legenda não encontrado na tela.",
                    logs: debugLog,
                    debug_image: errShot.toString('base64') // VAI RETORNAR A FOTO DA TELA
                };
            }
        }

        // --- SHARE ---
        log('Compartilhando...');
        let shareClicked = await tapByText(page, ['Share', 'Compartilhar']);
        
        if (shareClicked) {
            await new Promise(r => setTimeout(r, 15000));
            log('Finalizado.');
            
            // Print de sucesso
            const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            finalTextSnapshot = finalImgBuffer.toString('base64');
        } else {
            log('ERRO: Botão Share não achado (Texto).');
            // Tenta achar link azul no topo
            const headerAction = await page.$('header button, header a');
            if (headerAction) {
                const text = await page.evaluate(el => el.innerText, headerAction);
                if (text.includes('Share') || text.includes('Compartilhar')) {
                    await headerAction.tap();
                    log('Clicado via Header Action.');
                    await new Promise(r => setTimeout(r, 15000));
                }
            } else {
                 const errShot = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
                 return { status: "error", error: "Share button missing", logs: debugLog, debug_image: errShot.toString('base64') };
            }
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

app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((result) => { res.status(200).json(result); })
        .catch((err) => { res.status(500).json({ error: "Erro interno", details: err.message }); });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
