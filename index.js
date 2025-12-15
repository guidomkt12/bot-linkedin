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

const server = app.listen(PORT, () => console.log(`Super Bot V29 (CDP Upload) running on ${PORT}`));
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

app.get('/', (req, res) => res.send(`Bot V29 CDP Upload. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V29 (CDP)
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let debugLog = []; 
    let finalTextSnapshot = ""; 
    
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta ${timestamp}] ${msg}`);
        debugLog.push(`[${timestamp}] ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        if (!imagePath) throw new Error('No Image provided');
        
        log('Iniciando navegador (Mac Intel)...');
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--window-size=1920,1080',  
            '--start-maximized'
        ];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: { width: 1920, height: 1080 } });
        page = await browser.newPage();
        
        // Conecta ao CDP (Chrome DevTools Protocol)
        const client = await page.target().createCDPSession();

        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
        
        // User Agent de Mac para maior estabilidade
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Indo para Home...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        
        // Limpa modais
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);
        
        // --- ABERTURA DO MODAL ---
        log('Buscando ícone de "Nova publicação"...');
        let modalOpen = false;
        
        // Tenta clicar no SVG diretamente
        const createSelectors = [
            'svg[aria-label="New post"]',
            'svg[aria-label="Nova publicação"]',
            'svg[aria-label="Create"]',
            'svg[aria-label="Criar"]'
        ];

        for (const sel of createSelectors) {
            const el = await page.$(sel);
            if (el) {
                await el.evaluate(e => e.closest('a, button, div[role="button"]').click());
                log(`Cliquei no ícone: ${sel}`);
                modalOpen = true;
                break;
            }
        }

        if(!modalOpen) {
            // Fallback: Tenta texto
            log('Ícone não achado. Tentando texto...');
            modalOpen = await clickByText(page, ['Create', 'Criar'], 'span');
        }

        if(!modalOpen) throw new Error('Não consegui clicar no botão Criar.');
        
        await new Promise(r => setTimeout(r, 4000));
        
        // --- UPLOAD VIA CDP (BAIXO NÍVEL) ---
        log('Iniciando Upload via CDP...');
        
        // 1. Acha o nó do input file no DOM
        const inputNode = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        
        if (inputNode) {
            // 2. Pega o nodeId interno do Chrome para esse elemento
            // Isso requer um truque usando evaluateHandle
            /* Devido à complexidade de pegar nodeId exato via Puppeteer high-level,
               vamos usar o método .uploadFile() mas garantindo que o input está visível para o Chrome
            */
           
            // Garante que o input não está "hidden" ou "display: none" para o Puppeteer (hack)
            await page.evaluate(() => {
                const i = document.querySelector('input[type="file"]');
                if(i) {
                    i.style.display = 'block';
                    i.style.visibility = 'visible';
                    i.style.position = 'fixed';
                    i.style.top = '0';
                    i.style.left = '0';
                    i.style.zIndex = '99999';
                    i.style.width = '100px';
                    i.style.height = '100px';
                    i.style.opacity = '1';
                }
            });

            await inputNode.uploadFile(imagePath);
            
            // Dispara o evento de mudança manualmente para o React pegar
            await page.evaluate(() => {
                const i = document.querySelector('input[type="file"]');
                if(i) i.dispatchEvent(new Event('change', { bubbles: true }));
            });

            log('Arquivo enviado para o input.');
        } else {
            throw new Error('Input de arquivo não encontrado no modal.');
        }

        log('Aguardando Crop...');
        // Espera botão Next
        await page.waitForFunction(() => {
            const btns = [...document.querySelectorAll('div[role="button"]')];
            return btns.some(b => b.innerText.includes('Next') || b.innerText.includes('Avançar'));
        }, { timeout: 20000 });

        log('Next 1...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 2000));
        
        log('Next 2...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 5000)); 

        // --- LEGENDA (MÉTODO V25) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Inserindo legenda...`);
            
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            let textArea = null;
            try { textArea = await page.waitForSelector(selector, { timeout: 8000 }); } catch (e) {}

            if (textArea) {
                // Desenha borda
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if(el) el.style.border = '3px solid green'; 
                }, selector);
                
                await textArea.click();
                await new Promise(r => setTimeout(r, 500));
                
                // Injeta texto
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
                if (!content || content.trim().length === 0) {
                    log('AVISO: Injeção falhou. Tentando digitação...');
                    await page.keyboard.type(cleanLegenda, { delay: 100 });
                }
            } else {
                log('AVISO: Caixa de legenda não encontrada.');
            }
        }

        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        
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
        .then((result) => { res.status(200).json(result); })
        .catch((err) => { res.status(500).json({ error: "Erro interno", details: err.message }); });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
