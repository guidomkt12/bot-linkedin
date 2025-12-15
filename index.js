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
const MAX_CONCURRENT = 8; 

// --- PROXY (Opcional) ---
const PROXY_HOST = process.env.PROXY_HOST || ''; 
const PROXY_USER = process.env.PROXY_USER || '';
const PROXY_PASS = process.env.PROXY_PASS || '';
const USE_PROXY = PROXY_HOST && PROXY_HOST.length > 0;

let activeProcesses = 0;
const requestQueue = [];

// --- SISTEMA ANTI-CRASH ---
process.on('uncaughtException', (err) => { console.error('⚠️ ERRO CRÍTICO:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ PROMESSA REJEITADA:', reason); });

const server = app.listen(PORT, () => console.log(`Super Bot V23 (Focus Guard) rodando na porta ${PORT} 🛡️`));
server.setTimeout(1200000); 

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --- PROCESSADOR DE FILA ---
function processQueue() {
    if (activeProcesses >= MAX_CONCURRENT) return; 
    if (requestQueue.length === 0) return; 

    const nextJob = requestQueue.shift();
    activeProcesses++;
    console.log(`[Queue] Iniciando job. Ativos: ${activeProcesses}/${MAX_CONCURRENT}`);

    nextJob()
        .finally(() => {
            activeProcesses--;
            console.log(`[Queue] Job finalizado. Restam: ${requestQueue.length}`);
            processQueue();
        });
}

function addJobToQueue(jobFunction) {
    return new Promise((resolve, reject) => {
        const queueItem = async () => {
            try { resolve(await jobFunction()); } 
            catch (error) { reject(error); }
        };
        requestQueue.push(queueItem);
        processQueue();
    });
}

async function downloadImage(url) {
    const tempPath = path.resolve('/tmp', `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
    const writer = fs.createWriteStream(tempPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(tempPath));
        writer.on('error', reject);
    });
}

app.get('/', (req, res) => {
    res.send(`Super Bot V23 Online 🛡️<br>LinkedIn: /publicar<br>Instagram: /instagram<br>Fila: ${requestQueue.length}`);
});

function cleanTextForTyping(text) {
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

// ==========================================
// FUNÇÃO LÓGICA: INSTAGRAM
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let resultBuffer = null;

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) { try { imagePath = await downloadImage(imagemUrl); } catch (e) {} }
        if (!imagePath) throw new Error('Imagem é obrigatória.');
        if (!cookies) throw new Error('Cookies obrigatórios.');

        const launchArgs = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--window-size=1366,768', 
            '--start-maximized',
            '--disable-features=IsolateOrigins,site-per-process'
        ];
        if (USE_PROXY) launchArgs.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args: launchArgs, defaultViewport: { width: 1366, height: 768 }, timeout: 90000 });
        
        // Permissões de Clipboard para Colar (Essencial para V23)
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://www.instagram.com', ['clipboard-read', 'clipboard-write']);

        page = await browser.newPage();
        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        await clickByText(page, ['Not Now', 'Agora não', 'Cancel']);
        
        // Criar
        let createBtnFound = false;
        const createSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"], svg[aria-label="Criar"]';
        if (await page.$(createSelector)) { await page.click(createSelector); createBtnFound = true; } 
        else { createBtnFound = await clickByText(page, ['Create', 'Criar'], 'span'); }
        if (!createBtnFound) throw new Error('Botão Criar não encontrado.');
        await new Promise(r => setTimeout(r, 3000));

        // Upload
        const fileChooserPromise = page.waitForFileChooser();
        const selectBtn = await clickByText(page, ['Select from computer', 'Selecionar do computador', 'Select'], 'button');
        if (!selectBtn) {
            const inputUpload = await page.$('input[type="file"]');
            if(inputUpload) await inputUpload.uploadFile(imagePath);
            else throw new Error('Input upload sumiu.');
        } else { const fileChooser = await fileChooserPromise; await fileChooser.accept([imagePath]); }
        await new Promise(r => setTimeout(r, 6000));

        // Next -> Next
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 3000));
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 6000)); 

        // --- LEGENDA (FOCUS GUARD + VERIFICAÇÃO) ---
        if (legenda && legenda.trim().length > 0) {
            const cleanLegenda = cleanTextForTyping(legenda);
            
            // 1. Encontra a área de texto
            const selectors = ['div[aria-label="Write a caption..."]', 'div[aria-label="Escreva uma legenda..."]', 'div[role="textbox"]'];
            let textArea = null;
            for (const sel of selectors) {
                try { textArea = await page.waitForSelector(sel, { visible: true, timeout: 3000 }); if(textArea) break; } catch(e){}
            }

            if (textArea) {
                console.log('[Insta] Campo detectado. Tentando focar...');
                
                // 2. Loop de Foco (Garante que o cursor está lá)
                let isFocused = false;
                for(let i=0; i<5; i++) {
                    await textArea.click();
                    await new Promise(r => setTimeout(r, 500));
                    isFocused = await page.evaluate((el) => document.activeElement === el, textArea);
                    if(isFocused) break;
                    console.log('[Insta] Foco falhou, tentando de novo...');
                }

                if(isFocused) {
                    console.log('[Insta] Focado! Colando texto...');
                    
                    // Tenta COLAR (CTRL+V) - Melhor para Emojis
                    await page.evaluate((text) => navigator.clipboard.writeText(text), cleanLegenda);
                    await page.keyboard.down('Control');
                    await page.keyboard.press('V');
                    await page.keyboard.up('Control');
                    await new Promise(r => setTimeout(r, 1000));

                    // VERIFICAÇÃO: O texto entrou?
                    let content = await page.evaluate(el => el.innerText, textArea);
                    
                    if(!content || content.trim().length === 0) {
                        console.log('[Insta] Colar falhou. Tentando Digitação Lenta...');
                        await page.keyboard.type(cleanLegenda, { delay: 100 });
                        await new Promise(r => setTimeout(r, 1000));
                        content = await page.evaluate(el => el.innerText, textArea);
                    }

                    // CHECK FINAL: SE ESTIVER VAZIO, ABORTA!
                    if(!content || content.trim().length === 0) {
                        throw new Error('ERRO CRÍTICO: Não foi possível inserir a legenda. Cancelando para não postar vazio.');
                    } else {
                        console.log(`[Insta] Texto validado: "${content.substring(0, 20)}..."`);
                    }

                } else {
                    throw new Error('Não consegui dar foco na caixa de texto.');
                }
            } else {
                throw new Error('Campo de legenda não apareceu na tela.');
            }
        }

        // Share
        let share = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        if(!share) share = await clickByText(page, ['Share', 'Compartilhar'], 'button');

        if (share) {
            await new Promise(r => setTimeout(r, 15000)); 
            
            // Verifica sucesso visual
            const success = await clickByText(page, ['Post shared', 'Publicação compartilhada', 'Your post has been shared'], 'span');
            if (success) {
                console.log('[Insta] Sucesso confirmado!');
                resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            } else {
                // Se não apareceu sucesso, tira print para ver o erro
                console.log('[Insta] Aviso: Mensagem de sucesso não vista. Verificando erros...');
                resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
            }
        } else { throw new Error('Botão Compartilhar não encontrado.'); }

    } catch (error) {
        console.error(`[Insta Error] ${error.message}`);
        if (page && !page.isClosed()) try { resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true }); } catch(e){}
        // Repassa o erro para o n8n saber que falhou
        throw error; 
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
    return resultBuffer;
}

// ==========================================
// FUNÇÃO LÓGICA: LINKEDIN (V21 Restaurado)
// ==========================================
async function runLinkedinBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    let resultBuffer = null;

    try {
        console.log('[LinkedIn] Iniciando...');
        const { texto, paginaUrl, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) { try { imagePath = await downloadImage(imagemUrl); } catch (e) {} }
        if (!cookies) throw new Error('Cookies obrigatórios.');

        const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'];
        if (USE_PROXY) launchArgs.push(`--proxy-server=${PROXY_HOST}`);

        browser = await puppeteer.launch({ headless: true, args: launchArgs, defaultViewport: { width: 1280, height: 800 }, timeout: 60000 });
        page = await browser.newPage();
        if (USE_PROXY && PROXY_USER) await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        const cookiesJson = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        const targetUrl = paginaUrl || 'https://www.linkedin.com/feed/';
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        const editorSelector = '.ql-editor, div[role="textbox"]';
        if (!await page.$(editorSelector)) {
            const startPostBtn = await clickByText(page, ['Começar publicação', 'Start a post'], 'button');
            if(!startPostBtn) {
                 const btnClass = await page.$('button.share-box-feed-entry__trigger');
                 if(btnClass) await btnClass.click();
            }
            await new Promise(r => setTimeout(r, 4000));
        }

        if (imagePath) {
            const imgBuffer = await fs.readFile(imagePath);
            const imgBase64 = imgBuffer.toString('base64');
            const mimeType = 'image/jpeg';
            await page.click(editorSelector);
            await new Promise(r => setTimeout(r, 500));
            await page.evaluate(async (sel, b64, mime) => {
                const target = document.querySelector(sel);
                if (!target) return;
                const byteChars = atob(b64);
                const byteNums = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                const byteArray = new Uint8Array(byteNums);
                const blob = new Blob([byteArray], { type: mime });
                const file = new File([blob], "paste.jpg", { type: mime });
                const dt = new DataTransfer();
                dt.items.add(file);
                const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
                target.focus();
                target.dispatchEvent(evt);
            }, editorSelector, imgBase64, mimeType);
            await new Promise(r => setTimeout(r, 10000));
        }

        if (texto) {
            await page.click(editorSelector);
            await page.keyboard.press('Enter'); 
            await page.evaluate((txt) => { document.execCommand('insertText', false, txt); }, texto);
        }

        await new Promise(r => setTimeout(r, 3000));
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 12000));
        
        resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });

    } catch (error) {
        if (page && !page.isClosed()) try { resultBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true }); } catch(e){}
        throw error;
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
    return resultBuffer;
}

// ROTA PUBLICAR (LINKEDIN)
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runLinkedinBot(req.body, req.file))
        .then((img) => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length }); res.end(img); })
        .catch((err) => { res.status(500).json({ erro: err.message }); });
});

// ROTA INSTAGRAM
app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((img) => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length }); res.end(img); })
        .catch((err) => { 
            // Se cair aqui, é porque a verificação de texto falhou ou outro erro ocorreu
            res.status(500).json({ erro: err.message }); 
        });
});
