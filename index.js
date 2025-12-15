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

// --- CONFIGURAÇÃO SAAS ---
const MAX_CONCURRENT = 5; 
const PROXY_HOST = process.env.PROXY_HOST || ''; 
const PROXY_USER = process.env.PROXY_USER || '';
const PROXY_PASS = process.env.PROXY_PASS || '';
const USE_PROXY = PROXY_HOST && PROXY_HOST.length > 0;

let activeProcesses = 0;
const requestQueue = [];

process.on('uncaughtException', (err) => { console.error('⚠️ CRITICAL:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ REJECTION:', reason); });

const server = app.listen(PORT, () => console.log(`Super Bot V26 (Direct Upload) running on ${PORT}`));
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

app.get('/', (req, res) => res.send(`Bot V26 Direct Upload. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V26
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta ${timestamp}] ${msg}`);
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

        // --- UPLOAD FLOW (MÉTODO DIRETO V26) ---
        log('Abrindo Modal Criar...');
        let createFound = await clickByText(page, ['Create', 'Criar'], 'span');
        if(!createFound) {
             const svgSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
             if(await page.$(svgSelector)) { await page.click(svgSelector); createFound = true; }
        }
        if(!createFound) throw new Error('Botão Create não encontrado');
        
        await new Promise(r => setTimeout(r, 2000)); // Espera o modal renderizar

        log('Buscando input[type="file"] oculto...');
        // Em vez de clicar no botão "Selecionar", buscamos o input direto no DOM
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        
        if (fileInput) {
            log('Input encontrado! Realizando upload direto...');
            await fileInput.uploadFile(imagePath);
        } else {
            throw new Error('Input de arquivo não encontrado no modal.');
        }

        log('Aguardando tela de corte (Crop)...');
        await new Promise(r => setTimeout(r, 5000));

        // Navegação Next -> Next
        log('Next 1...');
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if(!next1) throw new Error('Botão Next 1 não apareceu (Upload falhou?)');
        
        await new Promise(r => setTimeout(r, 2000));
        
        log('Next 2...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        if(!next2) next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        
        await new Promise(r => setTimeout(r, 5000)); // Espera carregar campo de legenda

        // --- LEGENDA (MÉTODO V25 FORCED) ---
        let finalTextSnapshot = ""; 
        
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Inserindo legenda (${cleanLegenda.length} chars)...`);
            
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            let textArea = null;
            try { textArea = await page.waitForSelector(selector, { timeout: 5000 }); } catch (e) {}

            if (textArea) {
                // Desenha borda para debug
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if(el) el.style.border = '5px solid red';
                }, selector);
                
                await textArea.click();
                await new Promise(r => setTimeout(r, 500));
                
                // Injeta texto e dispara eventos
                log('Executando injecao de texto...');
                const evalRes = await page.evaluate((sel, txt) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    el.innerText = txt; 
                    ['input', 'change', 'keydown', 'keyup'].forEach(evt => {
                        el.dispatchEvent(new Event(evt, { bubbles: true }));
                    });
                    return true;
                }, selector, cleanLegenda);

                await new Promise(r => setTimeout(r, 1000));
                
                // Valida
                const content = await page.evaluate(s => document.querySelector(s)?.innerText, selector);
                log(`Texto lido após inserção: "${content?.substring(0,10)}..."`);
                
                if (!content || content.trim().length === 0) {
                    log('AVISO: Texto vazio após injeção. Tentando fallback digitação...');
                    await page.keyboard.type(cleanLegenda, { delay: 50 });
                }
            } else {
                log('AVISO: Caixa de legenda não encontrada.');
            }
        }

        // Tira foto de diagnóstico
        log('Capturando evidência...');
        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!shareClicked) shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'button');
        
        if (shareClicked) {
            await new Promise(r => setTimeout(r, 10000));
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
        .then((result) => {
            res.status(200).json(result);
        })
        .catch((err) => {
            res.status(500).json({ error: "Erro interno", details: err.message });
        });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
