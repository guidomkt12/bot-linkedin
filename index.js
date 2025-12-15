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

const server = app.listen(PORT, () => console.log(`Super Bot V36 (Mobile Mode) running on ${PORT}`));
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

// Função de clique/toque universal
async function clickByText(page, textsToFind, tag = '*') {
    try {
        return await page.evaluate((texts, tagName) => {
            const elements = [...document.querySelectorAll(tagName)];
            for (const el of elements) {
                const txt = el.innerText || el.getAttribute('aria-label') || '';
                if (texts.some(t => txt.toLowerCase().includes(t.toLowerCase()))) {
                    el.click(); // Mobile often responds better to standard click events simulated by JS
                    return true;
                }
            }
            return false;
        }, textsToFind, tag);
    } catch (e) { return false; }
}

app.get('/', (req, res) => res.send(`Bot V36 Mobile. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM V36 (MOBILE)
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
        
        log('Iniciando navegador (Emulando iPhone)...');
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--window-size=375,812', // Tamanho iPhone X
            '--start-maximized'
        ];
        if (USE_PROXY) args.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args, defaultViewport: null });
        page = await browser.newPage();
        
        // Emula iPhone 12 Pro
        const iPhone = puppeteer.devices['iPhone 12 Pro'];
        await page.emulate(iPhone);

        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });

        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        log('Acessando Home Mobile...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        
        // Fecha popups (App, Cookies, Notificações)
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel', 'Cancelar'], 'button');
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel', 'Cancelar'], 'div'); // Às vezes é div

        // --- UPLOAD MOBILE ---
        // No mobile, o botão "Nova publicação" geralmente é o [+] no rodapé ou topo
        log('Buscando botão de upload (Mobile)...');
        
        // Tenta achar o input file diretamente (o botão [+] é um label para ele muitas vezes)
        // Se não achar, clica no ícone de "New Post"
        
        const newPostSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
        const newPostBtn = await page.$(newPostSelector);
        
        if (newPostBtn) {
            // Em mobile, clicar no [+] abre o file picker do sistema
            // Puppeteer intercepta isso com waitForFileChooser
            const fileChooserPromise = page.waitForFileChooser({ timeout: 10000 });
            
            // Clica no botão (elemento pai do SVG geralmente)
            await newPostBtn.evaluate(e => e.closest('div[role="button"]').click());
            
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([imagePath]);
            log('Upload iniciado (Mobile).');
        } else {
             // Fallback: Tenta achar input file na página inteira e forçar upload
             const inputUpload = await page.$('input[type="file"]');
             if(inputUpload) {
                 await inputUpload.uploadFile(imagePath);
                 await inputUpload.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
                 log('Upload forçado via Input.');
             } else {
                 throw new Error('Botão de upload mobile não encontrado.');
             }
        }

        log('Aguardando tela de edição...');
        await new Promise(r => setTimeout(r, 5000));

        // Next 1 (Filtros -> Avançar)
        // No mobile, geralmente é um texto "Next" ou "Avançar" no topo direito
        log('Clicando Next 1...');
        let next1 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if(!next1) next1 = await clickByText(page, ['Next', 'Avançar'], 'div'); // Texto puro as vezes
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Next 2 (Se houver tela de edição extra)
        // Às vezes vai direto para a legenda
        log('Verificando segunda tela...');
        let next2 = await clickByText(page, ['Next', 'Avançar'], 'button');
        if (next2) {
             await new Promise(r => setTimeout(r, 3000));
        }

        // --- LEGENDA (MOBILE) ---
        // A tela de legenda mobile é mais simples. Geralmente um <textarea> ou <div contenteditable>
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log('Procurando campo de legenda...');
            
            // Tenta seletores comuns mobile
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
                
                // Em mobile, type costuma ser mais confiável que execCommand
                await page.keyboard.type(cleanLegenda, { delay: 10 });
                await new Promise(r => setTimeout(r, 1000));
            } else {
                log('AVISO: Campo de legenda não encontrado no modo Mobile.');
            }
        }

        // Tira foto de diagnóstico
        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share
        log('Compartilhando...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'button');
        if(!shareClicked) shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div'); // Texto azul no topo

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
