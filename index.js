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

const server = app.listen(PORT, () => console.log(`Super Bot V27 (Hybrid Upload) running on ${PORT}`));
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

// Função de clique mais agressiva
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

app.get('/', (req, res) => res.send(`Bot V27 Hybrid. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V27
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

        // --- ABERTURA DO MODAL (REFORÇADA) ---
        log('Abrindo Modal Criar...');
        let modalOpen = false;
        
        // Tenta abrir até 2 vezes
        for(let i=0; i<2; i++) {
            let createFound = await clickByText(page, ['Create', 'Criar'], 'span');
            if(!createFound) {
                 const svgSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
                 if(await page.$(svgSelector)) { await page.click(svgSelector); createFound = true; }
            }
            
            await new Promise(r => setTimeout(r, 3000));
            
            // Verifica se abriu procurando pelo texto de "Arrastar fotos" ou o header do modal
            modalOpen = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes('Drag photos') || bodyText.includes('Arrastar fotos') || document.querySelector('div[role="dialog"]');
            });

            if(modalOpen) break;
            log('Modal não abriu na tentativa ' + (i+1) + ', tentando de novo...');
        }

        if(!modalOpen) throw new Error('Falha crítica: Modal de criação não abriu após tentativas.');
        log('Modal CONFIRMADO aberto.');

        // --- UPLOAD HÍBRIDO (V19 + V26) ---
        log('Iniciando Upload...');
        let uploadSuccess = false;

        // Tenta achar o input direto primeiro (Mais rápido)
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            log('Input de arquivo encontrado direto no DOM. Uploading...');
            await fileInput.uploadFile(imagePath);
            uploadSuccess = true;
        } else {
            // Se não achou input, tenta o método FileChooser (Clicar no botão azul)
            log('Input oculto não achado. Tentando clicar no botão "Select"...');
            try {
                const fileChooserPromise = page.waitForFileChooser({ timeout: 5000 });
                const btnClicked = await clickByText(page, ['Select from computer', 'Selecionar do computador', 'Select'], 'button');
                
                if(btnClicked) {
                    const fileChooser = await fileChooserPromise;
                    await fileChooser.accept([imagePath]);
                    uploadSuccess = true;
                    log('Upload via FileChooser iniciado.');
                }
            } catch(e) {
                log('Erro no FileChooser: ' + e.message);
            }
        }

        if(!uploadSuccess) throw new Error('Todos os métodos de upload falharam.');

        log('Aguardando tela de corte (Crop)...');
        // Espera o botão "Next" aparecer para confirmar que o upload rolou
        try {
            await page.waitForFunction(() => {
                const btns = [...document.querySelectorAll('div[role="button"]')];
                return btns.some(b => b.innerText.includes('Next') || b.innerText.includes('Avançar'));
            }, { timeout: 15000 });
        } catch(e) {
            throw new Error('Upload parece ter travado (Botão Next não apareceu).');
        }

        log('Next 1 (Crop)...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 2000));
        
        log('Next 2 (Filtros)...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 5000)); 

        // --- LEGENDA (MÉTODO V25 - EXEC COMMAND) ---
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Inserindo legenda...`);
            
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            let textArea = null;
            try { textArea = await page.waitForSelector(selector, { timeout: 5000 }); } catch (e) {}

            if (textArea) {
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if(el) el.style.border = '3px solid blue'; // Marca visual
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
                
                // Valida e fallback
                const content = await page.evaluate(s => document.querySelector(s)?.innerText, selector);
                if (!content || content.trim().length === 0) {
                    log('AVISO: Injeção falhou. Tentando digitação lenta...');
                    await page.keyboard.type(cleanLegenda, { delay: 100 });
                }
            } else {
                log('AVISO: Caixa de legenda não encontrada.');
            }
        }

        // Tira foto de diagnóstico antes de enviar
        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!shareClicked) shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'button');
        
        if (shareClicked) {
            await new Promise(r => setTimeout(r, 10000));
            log('Finalizado com sucesso provável.');
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
