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

const server = app.listen(PORT, () => console.log(`Bot V13 (Fail Fast) rodando na porta ${PORT}`));
server.setTimeout(300000); // 5 min max

// Função download
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => res.send('Bot V13 Online 🔴'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // Timeout de resposta menor para não travar o n8n
    req.setTimeout(300000);
    res.setTimeout(300000);

    let imagePath = req.file ? req.file.path : null;
    let browser = null;
    let page = null;

    // Função auxiliar para checar se caiu
    const checkLogin = async (p, stepName) => {
        try {
            const title = await p.title();
            const url = await p.url();
            console.log(`[${stepName}] Status: ${title}`);
            
            if (title.includes('Login') || title.includes('Sign') || title.includes('Entrar') || url.includes('/login')) {
                throw new Error(`SESSÃO CAIU em: ${stepName}. Redirecionado para Login.`);
            }
            if (title.includes('Security') || title.includes('Challenge') || title.includes('Verificação')) {
                throw new Error(`BLOQUEIO DE SEGURANÇA em: ${stepName}.`);
            }
        } catch (e) {
            throw e; // Repassa o erro para o catch principal
        }
    };

    try {
        console.log('--- TENTATIVA V13 (Verificação Constante) ---');
        const { texto, paginaUrl, cookies, imagemUrl } = req.body;
        
        if (!imagePath && imagemUrl) {
            try {
                console.log('Baixando imagem...');
                imagePath = await downloadImage(imagemUrl);
            } catch (e) { console.error('Erro download:', e.message); }
        }

        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal) throw new Error('Cookies obrigatórios.');

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: { width: 1920, height: 1080 },
            timeout: 30000, // Timeout curto de 30s para abrir
            userDataDir: '/tmp/session_v13' // Persistência
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Cookies
        console.log('Injetando cookies...');
        const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
        if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);

        // Navegação
        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));

        // CHECAGEM 1: Chegou vivo?
        await checkLogin(page, 'Navegação Inicial');

        // BUSCA BOTÃO (Com timeout curto para falhar rápido se não achar)
        console.log('Procurando botão...');
        const postBoxSelectors = ['button.share-box-feed-entry__trigger', 'div.share-box-feed-entry__trigger', 'button[aria-label="Start a post"]', 'button[aria-label="Começar publicação"]'];
        
        let found = false;
        for (const sel of postBoxSelectors) {
            const el = await page.$(sel);
            if (el) {
                await el.click();
                found = true;
                break;
            }
        }
        
        // CHECAGEM 2: Ainda logado após tentar clicar?
        await checkLogin(page, 'Após Busca de Botão');

        if (!found) {
            // Se não achou seletor, tenta texto
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && (text.includes('Começar publicação') || text.includes('Start a post'))) {
                    await btn.click();
                    found = true;
                    break;
                }
            }
        }

        if (!found) throw new Error('Botão de postar sumiu (Provável layout diferente ou deslogado).');

        // Espera modal
        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        console.log('Modal aberto.');

        // UPLOAD
        if (imagePath) {
            console.log('Upload Imagem...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
            await input.uploadFile(imagePath);
            
            // Espera preview (Aumentado timeout mas checando erro)
            try {
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 60000 });
                console.log('Imagem carregada.');
            } catch (e) {
                await checkLogin(page, 'Durante Upload'); // Verifica se caiu durante upload
                throw new Error('Timeout no upload da imagem.');
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        // TEXTO
        if (texto) {
            console.log('Escrevendo...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // PUBLICAR
        console.log('Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        
        // Verifica se habilitado
        const isDisabled = await page.evaluate(el => el.disabled, btnPost);
        if (isDisabled) await new Promise(r => setTimeout(r, 3000));

        await btnPost.click();
        
        // Espera confirmação ou erro
        await new Promise(r => setTimeout(r, 5000));
        await checkLogin(page, 'Pós-Clique Publicar');

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado V13!' });

    } catch (error) {
        console.error('ERRO FATAL:', error.message);
        
        if (page) {
            try {
                // Tira print IMEDIATAMENTE e manda buffer direto (mais rápido que salvar arquivo)
                const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 });
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': screenshotBuffer.length,
                    'X-Error-Message': error.message // Manda o erro no header
                });
                res.end(screenshotBuffer);
            } catch (e) {
                res.status(500).json({ erro: error.message, erro_print: 'Falha no print' });
            }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});            headless: true, // "true" para servidor
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled', // ESCONDE O ROBÔ
                '--disable-infobars',
                '--start-maximized'
            ],
            defaultViewport: { width: 1920, height: 1080 },
            timeout: 0,
            ignoreDefaultArgs: ['--enable-automation'] // Remove barra de "Chrome controlado por automação"
        });

        page = await browser.newPage();
        
        // TRUQUE 1: User Agent de Windows 10 Real
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // TRUQUE 2: Remove a propriedade webdriver via script antes da página carregar
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });

        // Injetando cookies
        console.log('Injetando cookies...');
        try {
            const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
            if (Array.isArray(cookiesJson)) await page.setCookie(...cookiesJson);
        } catch (e) { console.log('Erro cookies:', e.message); }

        // Navegação
        console.log(`Indo para: ${paginaUrl}`);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 8000)); // Espera longa para não assustar o site

        // VERIFICAÇÃO DE QUEDA DE SESSÃO
        const title = await page.title();
        console.log(`Estamos em: ${title}`);
        
        if (title.includes('Login') || title.includes('Sign') || title.includes('Challenge') || title.includes('Security')) {
            throw new Error(`SESSÃO CAIU! O LinkedIn bloqueou o acesso. Título: ${title}. Você precisa pegar cookies novos e tentar de novo.`);
        }

        // --- LÓGICA DE CLIQUE (Mantida da V11 pois funciona) ---
        console.log('Procurando a caixa de postagem...');
        const postBoxSelectors = ['button.share-box-feed-entry__trigger', 'div.share-box-feed-entry__trigger', 'button[aria-label="Começar publicação"]', 'button[aria-label="Start a post"]'];
        
        let found = false;
        for (const sel of postBoxSelectors) {
            const el = await page.$(sel);
            if (el) {
                await el.click();
                found = true;
                break;
            }
        }

        if (!found) {
            // Fallback Texto
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && (text.includes('Começar publicação') || text.includes('Start a post'))) {
                    await btn.click();
                    found = true;
                    break;
                }
            }
        }

        if (!found) throw new Error('Não achei a caixa de postar. A sessão pode ter caído silenciosamente.');

        // Espera modal
        await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });
        console.log('Modal aberto!');

        // UPLOAD
        if (imagePath) {
            console.log('Upload Imagem...');
            const imageBtn = await page.$('button[aria-label="Adicionar mídia"], button[aria-label="Add media"]');
            if (imageBtn) await imageBtn.click();
            await new Promise(r => setTimeout(r, 2000));

            const input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
            await input.uploadFile(imagePath);
            
            // Espera preview
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 120000 });
            console.log('Imagem carregada.');
            await new Promise(r => setTimeout(r, 3000));
        }

        // TEXTO
        if (texto) {
            console.log('Escrevendo...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 30 }); // Digitação humana lenta
        }

        // PUBLICAR
        console.log('Publicando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await new Promise(r => setTimeout(r, 3000)); // Pausa dramática antes de clicar
        await btnPost.click();
        await new Promise(r => setTimeout(r, 10000));

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado V12 Camuflado!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) {
            try {
                await page.screenshot({ path: '/tmp/erro_v12.png', fullPage: true });
                res.sendFile('/tmp/erro_v12.png');
            } catch (e) { res.status(500).json({ erro: error.message }); }
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});
