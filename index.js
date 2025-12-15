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

// --- CONFIG ---
const MAX_CONCURRENT = 8;
const PROXY_HOST = process.env.PROXY_HOST || ''; 
const PROXY_USER = process.env.PROXY_USER || '';
const PROXY_PASS = process.env.PROXY_PASS || '';
const USE_PROXY = PROXY_HOST && PROXY_HOST.length > 0;

let activeProcesses = 0;
const requestQueue = [];

// --- LOGS ---
process.on('uncaughtException', (err) => { console.error('⚠️ CRITICAL:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ REJECTION:', reason); });

const server = app.listen(PORT, () => console.log(`Super Bot V25 (React Force + Debug) running on ${PORT}`));
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

app.get('/', (req, res) => res.send(`Bot V25 Online. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; // Log acumulativo para retornar ao n8n
    
    // Função auxiliar de log interno
    const log = (msg) => {
        console.log(`[Insta] ${msg}`);
        debugLog.push(`${new Date().toISOString().split('T')[1]} - ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        if (!imagePath) throw new Error('No Image provided');
        if (!cookies) throw new Error('No Cookies provided');

        const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1366,768', '--start-maximized'];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: { width: 1366, height: 768 } });
        page = await browser.newPage();
        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Cookies
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Navegando para Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);

        // Flow de Upload
        log('Abrindo Modal...');
        let createFound = await clickByText(page, ['Create', 'Criar'], 'span');
        if(!createFound) {
             const svgSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
             if(await page.$(svgSelector)) { await page.click(svgSelector); createFound = true; }
        }
        if(!createFound) throw new Error('Botão Create não encontrado');
        await new Promise(r => setTimeout(r, 2000));

        log('Upload...');
        const [fileChooser] = await Promise.all([page.waitForFileChooser(), clickByText(page, ['Select from computer', 'Selecionar'], 'button')]);
        await fileChooser.accept([imagePath]);
        await new Promise(r => setTimeout(r, 4000));

        log('Next 1...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 2000));
        log('Next 2...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 5000));

        // --- DIAGNÓSTICO E INSERÇÃO DE LEGENDA ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Tentando inserir texto (${cleanLegenda.length} chars)...`);
            
            // 1. Identificar o seletor exato
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                log('Seletor encontrado.');
            } catch (e) {
                // Snapshot do HTML se não achar
                const htmlDump = await page.evaluate(() => document.querySelector('div[role="dialog"]')?.outerHTML || 'SEM_DIALOG');
                log(`FALHA AO ACHAR CAIXA. HTML Dump: ${htmlDump.substring(0, 100)}...`);
                throw new Error('Caixa de texto não apareceu.');
            }

            // 2. FORÇAR O REACT (A TÉCNICA SECRETA)
            // Em vez de digitar, vamos injetar o valor e disparar eventos
            const evalResult = await page.evaluate((sel, txt) => {
                const el = document.querySelector(sel);
                if (!el) return { success: false, reason: 'element_missing' };

                el.focus();
                
                // Método 1: innerText direto
                el.innerText = txt; 
                
                // Método 2: Disparar eventos para acordar o React
                const eventTypes = ['input', 'change', 'compositionstart', 'compositionend', 'keydown', 'keyup'];
                eventTypes.forEach(evt => {
                    el.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
                });

                return { 
                    success: true, 
                    currentText: el.innerText,
                    activeElement: document.activeElement === el ? 'CORRETO' : 'ERRADO'
                };
            }, selector, cleanLegenda);

            log(`Resultado da Injeção: ${JSON.stringify(evalResult)}`);
            await new Promise(r => setTimeout(r, 1000));

            // 3. Validação Final
            const finalRead = await page.evaluate(s => document.querySelector(s)?.innerText, selector);
            log(`Leitura final do DOM: "${finalRead?.substring(0, 15)}..."`);

            if (!finalRead || finalRead.trim().length === 0) {
                // Se falhou, desenha borda vermelha e tira print de erro
                await page.evaluate(s => { 
                    const e = document.querySelector(s); 
                    if(e) e.style.border = '5px solid red'; 
                }, selector);
                const errPic = await page.screenshot({ type: 'jpeg', quality: 60 });
                return { success: false, logs: debugLog, image: errPic.toString('base64'), error: 'Texto não persistiu' };
            }
        }

        // Share
        log('Clicando Share...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if (!shareClicked) throw new Error('Botão Share sumiu');

        await new Promise(r => setTimeout(r, 12000));
        
        // Sucesso?
        const successMsg = await page.evaluate(() => document.body.innerText.includes('Post shared') || document.body.innerText.includes('compartilhada'));
        log(`Sucesso detectado no texto da página: ${successMsg}`);

        const finalImg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        
        return { 
            success: true, 
            logs: debugLog, 
            image: finalImg.toString('base64') // Retorna base64 para o n8n montar se quiser
        };

    } catch (error) {
        log(`ERRO FINAL: ${error.message}`);
        let errImg = null;
        if (page && !page.isClosed()) errImg = await page.screenshot({ type: 'jpeg', quality: 60 });
        
        return { 
            success: false, 
            logs: debugLog, 
            error: error.message,
            image: errImg ? errImg.toString('base64') : null
        };
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
}

// ROTA UNIFICADA
app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((result) => {
            // Se tiver imagem (buffer convertido em base64), transformamos de volta em buffer para enviar como imagem
            if (result.image) {
                const imgBuffer = Buffer.from(result.image, 'base64');
                // Headers customizados para você ver o debug no n8n
                res.writeHead(result.success ? 200 : 500, { 
                    'Content-Type': 'image/jpeg',
                    'Content-Length': imgBuffer.length,
                    'X-Debug-Logs': JSON.stringify(result.logs).substring(0, 5000) // Cabeçalho tem limite, cuidado
                });
                res.end(imgBuffer);
            } else {
                res.status(result.success ? 200 : 500).json(result);
            }
        })
        .catch((err) => {
            res.status(500).json({ error: err.message });
        });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
