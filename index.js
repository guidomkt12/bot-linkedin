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
const MAX_CONCURRENT = 5; // Reduzi para 5 para garantir estabilidade no debug
const PROXY_HOST = process.env.PROXY_HOST || ''; 
const PROXY_USER = process.env.PROXY_USER || '';
const PROXY_PASS = process.env.PROXY_PASS || '';
const USE_PROXY = PROXY_HOST && PROXY_HOST.length > 0;

let activeProcesses = 0;
const requestQueue = [];

process.on('uncaughtException', (err) => { console.error('⚠️ CRITICAL:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ REJECTION:', reason); });

const server = app.listen(PORT, () => console.log(`Super Bot V25 (DIAGNOSTIC MODE) running on ${PORT}`));
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

app.get('/', (req, res) => res.send(`Bot V25 Diagnostic. Queue: ${requestQueue.length}`));

// ==========================================
// CORE LOGIC - INSTAGRAM DIAGNOSTIC
// ==========================================
async function runInstagramBot(body, file) {
    let imagePath = file ? file.path : null;
    let browser = null;
    let page = null;
    
    // LOGS DE DIAGNÓSTICO
    let debugLog = []; 
    const log = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[Insta ${timestamp}] ${msg}`);
        debugLog.push(`[${timestamp}] ${msg}`);
    };

    try {
        const { legenda, cookies, imagemUrl } = body;
        if (!imagePath && imagemUrl) try { imagePath = await downloadImage(imagemUrl); } catch (e) {}
        
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

        // --- UPLOAD FLOW ---
        log('Abrindo Modal Criar...');
        let createFound = await clickByText(page, ['Create', 'Criar'], 'span');
        if(!createFound) {
             const svgSelector = 'svg[aria-label="New post"], svg[aria-label="Nova publicação"], svg[aria-label="Create"]';
             if(await page.$(svgSelector)) { await page.click(svgSelector); createFound = true; }
        }
        if(!createFound) {
            log('ERRO: Botão Criar não achado.');
            throw new Error('Botão Create não encontrado');
        }
        await new Promise(r => setTimeout(r, 2000));

        log('Selecionando arquivo...');
        const [fileChooser] = await Promise.all([page.waitForFileChooser(), clickByText(page, ['Select from computer', 'Selecionar'], 'button')]);
        await fileChooser.accept([imagePath]);
        await new Promise(r => setTimeout(r, 5000));

        log('Clicando Next 1 (Crop)...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 2000));
        
        log('Clicando Next 2 (Filtros)...');
        await clickByText(page, ['Next', 'Avançar'], 'div[role="button"]');
        await new Promise(r => setTimeout(r, 5000)); // Espera carregar a tela de legenda

        // --- DIAGNÓSTICO DE LEGENDA ---
        let finalTextSnapshot = ""; // Para guardar o print final
        
        if (legenda) {
            const cleanLegenda = cleanText(legenda);
            log(`Tentando inserir texto (${cleanLegenda.length} chars)...`);
            
            // 1. ACHAR O SELETOR
            const selector = 'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
            let textArea = null;
            try {
                textArea = await page.waitForSelector(selector, { timeout: 5000 });
                log('Seletor da caixa de texto ENCONTRADO.');
            } catch (e) {
                log('FALHA AO ACHAR SELETOR ESPECÍFICO. Tentando genérico...');
                // Fallback
            }

            if (textArea) {
                // 2. DESENHAR BORDA VERMELHA (DIAGNÓSTICO VISUAL)
                log('Desenhando borda vermelha em volta do campo encontrado...');
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if(el) el.style.border = '5px solid red';
                }, selector);
                
                // 3. TENTAR INSERIR TEXTO (FORÇADO)
                log('Executando comando de inserção (execCommand)...');
                await textArea.click(); // Foco
                await new Promise(r => setTimeout(r, 500));
                
                await page.evaluate((txt) => {
                    document.execCommand('insertText', false, txt);
                }, cleanLegenda);
                
                await new Promise(r => setTimeout(r, 1000));

                // 4. LER O QUE FICOU NA CAIXA
                const content = await page.evaluate(el => el.innerText, textArea);
                log(`Conteúdo lido na caixa após inserção: "${content}"`);
                
                if (!content || content.trim().length === 0) {
                    log('ERRO: O texto não persistiu. Tentando fallback de Digitação...');
                    await page.keyboard.type(cleanLegenda, { delay: 100 });
                }
            } else {
                log('ERRO CRÍTICO: Não achei onde digitar.');
            }
        }

        // TIRA FOTO DO RESULTADO (ANTES DE POSTAR)
        // Isso vai pro JSON de resposta para você ver
        log('Tirando print de diagnóstico...');
        const finalImgBuffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
        finalTextSnapshot = finalImgBuffer.toString('base64');

        // Share (Só clica se tiver texto ou se o usuário quiser forçar)
        log('Clicando em Compartilhar...');
        let shareClicked = await clickByText(page, ['Share', 'Compartilhar'], 'div[role="button"]');
        
        if (shareClicked) {
            await new Promise(r => setTimeout(r, 10000));
            log('Processo finalizado. Verifique a imagem de diagnóstico.');
        } else {
            log('ERRO: Botão Compartilhar não encontrado.');
        }

        // RETORNA O RELATÓRIO (NÃO ERRO)
        return {
            status: "finished",
            logs: debugLog,
            // Retorna a imagem em base64 para você ver no n8n
            debug_image: finalTextSnapshot 
        };

    } catch (error) {
        log(`ERRO FATAL: ${error.message}`);
        // Tenta tirar print do erro
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

// ROTA INSTAGRAM UNIFICADA
app.post('/instagram', upload.single('imagem'), async (req, res) => {
    req.setTimeout(1200000); res.setTimeout(1200000);
    
    addJobToQueue(() => runInstagramBot(req.body, req.file))
        .then((result) => {
            // Retorna sempre 200 para o n8n ler o JSON, mesmo se deu erro lógico
            res.status(200).json(result);
        })
        .catch((err) => {
            res.status(500).json({ error: "Erro interno no servidor", details: err.message });
        });
});

app.post('/publicar', (req, res) => res.json({msg: "Use /instagram"}));
