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

const server = app.listen(PORT, () => console.log(`Super Bot V37 (Manual Mobile) running on ${PORT}`));
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

app.get('/', (req, res) => res.send(`Bot V37 Manual Mobile. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V37 (MANUAL MOBILE)
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta Mob] ${msg}`);
        debugLog.push(`[${timestamp}] ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        if (!imagePath) throw new Error('No Image provided');
        
        log('Iniciando navegador (iPhone 12 Pro Manual)...');
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--window-size=390,844', // Tamanho real do iPhone 12 Pro
            '--start-maximized'
        ];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: null });
        page = await browser.newPage();
        
        // --- CONFIGURAÇÃO MANUAL DO IPHONE ---
        // User Agent de iPhone no iOS 15
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
        // Viewport com Touch habilitado
        await page.setViewport({
            width: 390,
            height: 844,
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 3
        });

        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Acessando Home Mobile...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        // Fecha popups chatos
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel', 'Cancelar'], 'button');
        
        // --- UPLOAD MOBILE ---
        log('Buscando botão de upload...');
        
        // No mobile web, o botão de criar geralmente é um SVG de [+]
        // Vamos tentar clicar nele ou injetar no input file se ele existir
        
        const newPostSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
        const newPostBtn = await page.$(newPostSelector);
        
        if (newPostBtn) {
            log('Botão [+] encontrado. Clicando...');
            const fileChooserPromise = page.waitForFileChooser({ timeout: 15000 });
            
            // Clica no pai do SVG (geralmente uma div ou a)
            await newPostBtn.evaluate(e => e.closest('div[role="button"], a').click());
            
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
            log('Arquivo selecionado.');
        } else {
             log('Botão [+] não achado. Tentando Input direto...');
             const inputUpload = await page.$('input[type="file"]');
             if(inputUpload) {
                 await inputUpload.uploadFile(imagePath);
                 await inputUpload.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
                 log('Upload forçado via Input OK.');
             } else {
                 throw new Error('Botão de upload mobile não encontrado.');
             }
        }

        log('Aguardando tela de edição...');
        await new Promise(r => setTimeout(r, 6000));

        // Next 1
        log('Clicando Next 1...');
        // No mobile, o botão "Next" costuma ser um texto azul no topo direito
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'div');
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Verifica se tem tela de filtros (às vezes pula)
        log('Verificando segunda tela...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if(!next2) next2 = await clickByText(page, ['Next', 'Avançar'], 'div');
        
        if (next2) {
             await new Promise(r => setTimeout(r, 3000));
        }

        // --- LEGENDA (MOBILE) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Procurando campo de legenda (${cleanLegenda.length} chars)...`);
            
            // Seletores comuns no mobile
            const selectors = [
                'textarea', 
                'div[contenteditable="true"]',
                'textarea[aria-label="Write a caption..."]',
                'div[aria-label="Escreva uma legenda..."]'
            ];
            
            let textArea = null;
            for (const sel of selectors) {
                textArea = await page.$(sel);
                if (textArea) break;
            }

            if (textArea) {
                log('Campo encontrado. Digitando...');
                await textArea.click(); // Tap
                await new Promise(r => setTimeout(r, 500));
                
                // No mobile, 'type' é muito mais seguro que 'execCommand'
                await page.keyboard.type(cleanLegenda, { delay: 30 });
                await new Promise(r => setTimeout(r, 2000));
            } else {
                log('AVISO: Campo de legenda não encontrado no modo Mobile.');
            }
        }

        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'button');
        if(!shareClicked) shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div');

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

app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((result) => { res.status(200).json(result); })
        .catch((err) => { res.status(500).json({ error: "Erro interno", details: err.message }); });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
