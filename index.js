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

const server = app.listen(PORT, () => console.log(`Super Bot V40 (Slow Observer) running on ${PORT}`));
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

app.get('/', (req, res) => res.send(`Bot V40 Slow. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V40
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta V40] ${msg}`);
        debugLog.push(`[${timestamp}] ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        if (!imagePath) throw new Error('No Image provided');
        
        log('Iniciando navegador (Desktop)...');
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--window-size=1280,800', // Desktop padrão
            '--start-maximized'
        ];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: { width: 1280, height: 800 } });
        page = await browser.newPage();
        
        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
        
        // User Agent Desktop (Voltando ao que funcionava na V19/33)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel', 'Cancelar']);
        
        // --- ABERTURA DO MODAL ---
        log('Abrindo Modal...');
        // Tenta SVG primeiro
        const createSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"], svg[aria-label="Criar"]';
        const iconEl = await page.$(createSelector);
        if (iconEl) {
             await iconEl.evaluate(e => e.closest('a, button, div[role="button"]').click());
        } else {
             await clickByText(page, ['Create', 'Criar'], 'span');
        }
        
        await new Promise(r => setTimeout(r, 5000));

        // --- UPLOAD (V33) ---
        log('Upload...');
        try {
            const fileChooserPromise = page.waitForFileChooser({timeout: 10000});
            await clickByText(page, ['Select from computer', 'Selecionar do computador'], 'button');
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
        } catch (e) {
            // Fallback
            const inputUpload = await page.$('input[type="file"]');
            if(inputUpload) await inputUpload.uploadFile(imagePath);
            else throw new Error('Upload falhou.');
        }

        log('Esperando Crop (10s)...');
        await new Promise(r => setTimeout(r, 10000));

        // --- NAVEGAÇÃO LENTA ---
        log('Next 1...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        
        log('Esperando Filtros (5s)...');
        await new Promise(r => setTimeout(r, 5000));
        
        log('Next 2...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');

        log('Esperando Tela Final (10s)...');
        await new Promise(r => setTimeout(r, 10000)); 

        // --- LEGENDA (MÉTODO V25/33 - INJECTION) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Procurando campo de legenda...`);
            
            // Procura o campo específico de legenda do Desktop
            // Geralmente é uma div com role="textbox" e contenteditable="true" dentro do modal
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            const textArea = await page.$(selector);
            
            if (textArea) {
                log('Campo encontrado. Focando...');
                await textArea.click();
                await new Promise(r => setTimeout(r, 2000));

                log('Injetando texto (execCommand)...');
                await page.evaluate((sel, txt) => {
                    const el = document.querySelector(sel);
                    if(el) {
                        el.focus();
                        // Limpa qualquer coisa que tiver antes (espaços fantasmas)
                        el.innerText = ''; 
                        // Injeta
                        document.execCommand('insertText', false, txt);
                    }
                }, selector, cleanLegenda);
                
                await new Promise(r => setTimeout(r, 2000));
                
                // Valida
                const content = await page.evaluate(s => document.querySelector(s)?.innerText, selector);
                log(`Conteúdo validado: "${content?.substring(0, 15)}..."`);
                
            } else {
                log('AVISO CRÍTICO: Campo de legenda NÃO apareceu.');
                // Tira print para ver onde estamos
                const errShot = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
                return { 
                    status: "error", 
                    error: "Caption field missing in final screen", 
                    logs: debugLog, 
                    debug_image: errShot.toString('base64') 
                };
            }
        }

        // Tira foto ANTES de clicar em compartilhar para provar que o texto estava lá
        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        
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
